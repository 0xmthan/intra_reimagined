// Student comments under project pages (projects.intra.42.fr/projects/<slug>), shown by the extension.
// Each comment keeps where its author stood on the project when they wrote it (validated or failed with
// the mark, doing it, or never did it) and how many times they had evaluated it as a corrector. Both
// come from 42, never from the request. Replies go one level deep. Authors edit and delete their own;
// ADMIN_LOGINS can delete anyone's. Bodies are Markdown, rendered by the extension (never as HTML);
// images are uploaded here and served by content hash, with the banners' checks (banners.ts).
//
//   GET    /v1/projects/:slug/comments  →  { project, me: { standing, evaluated, admin }, comments: [...] }
//   POST   /v1/projects/:slug/comments  ←  { body, parent? }   → { comment }
//   PUT    /v1/comments/:id             ←  { body }            → { comment }   (author)
//   DELETE /v1/comments/:id             →  { ok }                              (author or admin)
//   PUT|DELETE /v1/comments/:id/helpful →  { helpful, voted }
//   POST   /v1/comment-images           ←  raw image bytes     → { url: "/comment-images/<sha256>.<ext>" }
//   GET    /comment-images/<sha256>.<ext>  →  the image (public)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FtApiError, type FtApi } from './ft-api.ts';
import type { Db, ProjectComment, Standing } from './db.ts';
import type { EvalService } from './evals.ts';
import { TtlCache } from './cache.ts';
import { RateLimiter } from './rate-limit.ts';
import { BannerError, MIME, bannerPath, processUpload, readBody, serveBanner, type ImageType } from './banners.ts';

export const IMAGE_DIR = 'comment-images';
const MAX_BODY = 4000; // characters of Markdown
const MAX_JSON = 32 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const STANDING_TTL = 10 * 60_000;
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,99}$/;

type Send = (res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>) => void;

class CommentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The routes this module answers (index.ts checks auth and the method gate with it). */
export const isCommentRoute = (path: string) =>
  /^\/v1\/projects\/[^/]+\/comments$/.test(path) || /^\/v1\/comments\/\d{1,12}(\/helpful)?$/.test(path) || path === '/v1/comment-images';

export class CommentService {
  readonly #api: FtApi;
  readonly #db: Db;
  readonly #evals: EvalService;
  readonly #admins: Set<string>;
  readonly #send: Send;
  #projects = new TtlCache<{ id: number; name: string } | null>(2000);
  #standings = new TtlCache<Promise<Standing>>(5000);
  #writes = new RateLimiter(20, 10 * 60_000); // per login: comments and edits per 10 minutes
  #uploads = new RateLimiter(30, 3_600_000); // per login: images per hour

  constructor(api: FtApi, db: Db, evals: EvalService, admins: string[], send: Send) {
    this.#api = api;
    this.#db = db;
    this.#evals = evals;
    this.#admins = new Set(admins);
    this.#send = send;
  }

  /** 42's project for a page slug (memory → Postgres → 42); null = no such project. */
  async #project(slug: string): Promise<{ id: number; name: string } | null> {
    const hit = this.#projects.get(slug);
    if (hit !== undefined) return hit;
    let p: { id: number; name: string } | null | undefined = await this.#db.getProjectSlug(slug);
    if (!p) {
      try {
        const j = await this.#api.get<{ id: number; name: string }>(`/v2/projects/${encodeURIComponent(slug)}`);
        p = { id: j.id, name: j.name };
        await this.#db.saveProjectSlug(slug, p.id, p.name);
      } catch (e) {
        if (!(e instanceof FtApiError && e.status === 404)) throw e;
        p = null;
      }
    }
    this.#projects.set(slug, p, p ? 24 * 3_600_000 : 3_600_000);
    return p;
  }

  /** Where `login` is on the project now: their projects_users row (cached a few minutes). */
  #standing(login: string, projectId: number): Promise<Standing> {
    const key = `${login}:${projectId}`;
    let p = this.#standings.get(key);
    if (!p) {
      p = this.#api
        .get<{ status: string; 'validated?': boolean | null; final_mark: number | null }[]>(
          `/v2/users/${encodeURIComponent(login)}/projects_users?filter[project_id]=${projectId}`,
        )
        .then(([pu]): Standing => {
          if (!pu) return { kind: 'none' };
          if (pu.status === 'finished' && pu['validated?'] !== null) {
            return { kind: pu['validated?'] ? 'validated' : 'failed', mark: pu.final_mark ?? 0 };
          }
          return { kind: 'doing' };
        });
      p.catch(() => this.#standings.delete(key));
      this.#standings.set(key, p, STANDING_TTL);
    }
    return p;
  }

  /**
   * How many evaluations `login` did on the project as a corrector. Someone's first read of their
   * history can take a while: listing waits a few seconds (0 meanwhile), posting waits longer, since
   * the count is saved with the comment.
   */
  async #evaluated(login: string, projectId: number, waitMs: number): Promise<number> {
    const stats = await Promise.race([
      this.#evals.get(login).catch(() => undefined),
      new Promise<undefined>((r) => setTimeout(r, waitMs)), // the read goes on behind either way
    ]);
    const evaluations = new Set<number>(); // one per evaluation: its filled-in time, shared by its correcteds
    for (const list of Object.values(stats?.partnerEvals ?? {})) for (const [id, at] of list) if (id === projectId) evaluations.add(at);
    return evaluations.size;
  }

  #out(c: ProjectComment, me: string) {
    return {
      id: c.id,
      parent: c.parent,
      login: c.deleted ? null : c.login,
      body: c.body,
      standing: c.deleted ? null : c.standing,
      evaluated: c.deleted ? 0 : c.evaluated,
      at: c.at.getTime(),
      editedAt: c.editedAt?.getTime() ?? null,
      deleted: c.deleted,
      helpful: c.helpful,
      voted: c.voted,
      mine: !c.deleted && c.login === me,
    };
  }

  async #one(projectId: number, id: number, me: string) {
    const c = (await this.#db.listComments(projectId, me)).find((x) => x.id === id);
    if (!c) throw new CommentError(404, 'No such comment.');
    return this.#out(c, me);
  }

  async #json(req: IncomingMessage): Promise<Record<string, unknown>> {
    const raw = await readBody(req, MAX_JSON);
    try {
      const j = JSON.parse(raw.toString('utf8')) as unknown;
      if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch {}
    throw new CommentError(400, 'Expected a JSON object.');
  }

  #text(j: Record<string, unknown>): string {
    const body = typeof j.body === 'string' ? j.body.replace(/\r\n?/g, '\n').trim() : '';
    if (!body) throw new CommentError(400, 'Write something first.');
    if (body.length > MAX_BODY) throw new CommentError(400, `Keep it under ${MAX_BODY} characters.`);
    return body;
  }

  /** /comment-images/<hash>.<ext> (public, no login: the images show in everyone's comments). */
  serveImage(pathname: string, res: ServerResponse) {
    return serveBanner(
      pathname,
      res,
      async (hash) => {
        const row = await this.#db.getCommentImage(hash);
        return row && row.type in MIME ? { type: row.type as ImageType, data: row.data } : undefined;
      },
      IMAGE_DIR,
    );
  }

  /** The /v1 comment routes, for the signed-in `me`. */
  async handle(req: IncomingMessage, res: ServerResponse, path: string, me: string) {
    const send = this.#send;
    try {
      if (path === '/v1/comment-images') {
        if (req.method !== 'POST') throw new CommentError(405, 'method not allowed');
        if (!this.#uploads.take(me)) throw new CommentError(429, 'Too many images; try again in an hour.');
        const img = processUpload(await readBody(req, MAX_IMAGE), { width: 1, height: 1 });
        await this.#db.saveCommentImage(img.hash, me, img.type, img.data);
        return send(res, 200, { url: bannerPath(img.hash, img.type, IMAGE_DIR) });
      }

      const pm = path.match(/^\/v1\/projects\/([^/]+)\/comments$/);
      if (pm) {
        const slug = decodeURIComponent(pm[1]).toLowerCase();
        if (!SLUG.test(slug)) throw new CommentError(404, 'No such project.');
        const project = await this.#project(slug);
        if (!project) throw new CommentError(404, 'No such project.');
        if (req.method === 'GET') {
          const [rows, standing, evaluated] = await Promise.all([
            this.#db.listComments(project.id, me),
            this.#standing(me, project.id).catch(() => null),
            this.#evaluated(me, project.id, 4000),
          ]);
          // A deleted comment stays only as the place its replies hang from.
          const replied = new Set(rows.filter((c) => !c.deleted && c.parent).map((c) => c.parent));
          const comments = rows.filter((c) => !c.deleted || replied.has(c.id)).map((c) => this.#out(c, me));
          return send(res, 200, { project, me: { login: me, standing, evaluated, admin: this.#admins.has(me) }, comments }, { 'Cache-Control': 'no-store' });
        }
        if (req.method !== 'POST') throw new CommentError(405, 'method not allowed');
        if (!this.#writes.take(me)) throw new CommentError(429, 'Slow down a little; try again in a few minutes.');
        const j = await this.#json(req);
        const body = this.#text(j);
        let parent: number | null = null;
        if (j.parent !== undefined && j.parent !== null) {
          const p = Number.isInteger(j.parent) ? await this.#db.getComment(j.parent as number) : undefined;
          if (!p || p.projectId !== project.id || p.deleted) throw new CommentError(400, 'That comment is gone.');
          parent = p.parent ?? p.id; // replies to a reply go under the same comment
        }
        const [standing, evaluated] = await Promise.all([this.#standing(me, project.id), this.#evaluated(me, project.id, 25_000)]);
        const id = await this.#db.addComment({ projectId: project.id, parent, login: me, body, standing, evaluated });
        return send(res, 200, { comment: await this.#one(project.id, id, me) });
      }

      const cm = path.match(/^\/v1\/comments\/(\d{1,12})(\/helpful)?$/);
      if (!cm) throw new CommentError(404, 'not found');
      const c = await this.#db.getComment(Number(cm[1]));
      if (!c || c.deleted) throw new CommentError(404, 'That comment is gone.');
      if (cm[2]) {
        if (req.method !== 'PUT' && req.method !== 'DELETE') throw new CommentError(405, 'method not allowed');
        if (c.login === me) throw new CommentError(400, 'Not on your own comment.');
        await this.#db.voteComment(c.id, me, req.method === 'PUT');
        const { helpful, voted } = await this.#one(c.projectId, c.id, me);
        return send(res, 200, { helpful, voted });
      }
      if (req.method === 'DELETE') {
        if (c.login !== me && !this.#admins.has(me)) throw new CommentError(403, 'Only its author can delete it.');
        await this.#db.deleteComment(c.id);
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'PUT') throw new CommentError(405, 'method not allowed');
      if (c.login !== me) throw new CommentError(403, 'Only its author can edit it.');
      if (!this.#writes.take(me)) throw new CommentError(429, 'Slow down a little; try again in a few minutes.');
      await this.#db.editComment(c.id, this.#text(await this.#json(req)));
      return send(res, 200, { comment: await this.#one(c.projectId, c.id, me) });
    } catch (e) {
      if (e instanceof CommentError || e instanceof BannerError) {
        if (!req.readableEnded) {
          // The body may be unread (too big): answer, then drop the connection instead of draining it.
          res.on('finish', () => req.socket.destroy());
          return send(res, e.status, { error: e.message }, { Connection: 'close' });
        }
        return send(res, e.status, { error: e.message });
      }
      console.error('comments', e);
      return send(res, 502, { error: 'Something went wrong; try again.' });
    }
  }
}
