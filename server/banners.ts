// Custom profile banners: a student uploads an image or GIF; everyone using the extension sees it
// on their profile instead of the coalition cover.
//
//   GET    /v1/users/:login/banner  →  { url: "/banners/<sha256>.<ext>" | null }   (signed in)
//   PUT    /v1/me/banner            ←  raw image bytes; → { url }                  (signed in, own only)
//   DELETE /v1/me/banner            →  { url: null }  (back to the coalition cover)
//   GET    /banners/<sha256>.<ext>  →  the image (public, immutable, never anything but an image)
//
// Uploads are untrusted, so nothing here trusts a name, a header or a claimed type:
//   - the type comes from the file's magic bytes, and only PNG, JPEG, GIF and WebP pass (no SVG:
//     it can carry script); the response type is always ours, with nosniff and a sandbox CSP
//   - the body is capped while it streams in (no buffering of something huge)
//   - width/height come from the format's own header and are bounded, so a small file can't
//     decode into an enormous image in viewers' browsers
//   - metadata blocks (EXIF with GPS, XMP, text chunks) are removed before anything is stored
//   - who you are comes from the signed token, never from the request: you only change your own
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_PIXELS = 4096 * 2048;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 80;

export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp';
export const MIME: Record<ImageType, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const EXT: Record<ImageType, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' };
const BY_EXT: Record<string, ImageType> = { png: 'png', jpg: 'jpeg', gif: 'gif', webp: 'webp' };

export class BannerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const bad = (message: string) => new BannerError(422, message);

/** Identifies the format from its first bytes; anything else is refused. */
export function sniff(b: Buffer): ImageType | undefined {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) return 'gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return undefined;
}

/** Width and height from the format's header (never by decoding the image). */
export function dimensions(type: ImageType, b: Buffer): { width: number; height: number } {
  const need = (n: number) => {
    if (b.length < n) throw bad('The file is cut short.');
  };
  switch (type) {
    case 'png':
      need(24);
      if (b.toString('latin1', 12, 16) !== 'IHDR') throw bad('Not a valid PNG.');
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    case 'gif':
      need(10);
      return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    case 'webp': {
      need(30);
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
      throw bad('Not a valid WebP.');
    }
    case 'jpeg': {
      // Walk the marker segments to the first frame header (SOFn).
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) throw bad('Not a valid JPEG.');
        const marker = b[i + 1];
        if (marker === 0xff) {
          i++; // fill byte
          continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2; // no length
          continue;
        }
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        if (marker === 0xd9 || marker === 0xda) break; // end of image / scan data before any frame header
        i += 2 + b.readUInt16BE(i + 2);
      }
      throw bad('Not a valid JPEG.');
    }
  }
}

/** Removes metadata (EXIF/GPS, XMP, ICC-adjacent text, comments) without touching image data. */
export function stripMetadata(type: ImageType, b: Buffer): Buffer {
  switch (type) {
    case 'jpeg': {
      // Keep SOI, APP0 (JFIF), APP14 (Adobe colour transform), and everything from SOF/DQT/... on;
      // drop APP1..APP13, APP15 (EXIF, XMP, Photoshop/IPTC...) and COM segments before the scan.
      const out: Buffer[] = [b.subarray(0, 2)];
      let i = 2;
      while (i + 4 <= b.length) {
        if (b[i] !== 0xff) throw bad('Not a valid JPEG.');
        const marker = b[i + 1];
        if (marker === 0xda) {
          out.push(b.subarray(i)); // start of scan: the rest is image data
          return Buffer.concat(out);
        }
        const len = b.readUInt16BE(i + 2);
        if (len < 2 || i + 2 + len > b.length) throw bad('Not a valid JPEG.');
        const seg = b.subarray(i, i + 2 + len);
        const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
        if (!drop) out.push(seg);
        i += 2 + len;
      }
      throw bad('Not a valid JPEG.');
    }
    case 'png': {
      const out: Buffer[] = [b.subarray(0, 8)];
      let i = 8;
      while (i + 12 <= b.length) {
        const len = b.readUInt32BE(i);
        const kind = b.toString('latin1', i + 4, i + 8);
        const end = i + 12 + len;
        if (end > b.length) throw bad('Not a valid PNG.');
        if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(kind)) out.push(b.subarray(i, end));
        i = end;
        if (kind === 'IEND') return Buffer.concat(out);
      }
      throw bad('Not a valid PNG.');
    }
    case 'webp': {
      // RIFF container: drop EXIF and XMP chunks, clear their flags in VP8X, fix the RIFF size.
      const chunks: Buffer[] = [];
      let i = 12;
      let vp8x: Buffer | undefined;
      while (i + 8 <= b.length) {
        const kind = b.toString('latin1', i, i + 4);
        const size = b.readUInt32LE(i + 4);
        const end = i + 8 + size + (size & 1); // chunks are padded to even sizes
        if (i + 8 + size > b.length) throw bad('Not a valid WebP.');
        const chunk = Buffer.from(b.subarray(i, Math.min(end, b.length)));
        if (kind === 'VP8X') vp8x = chunk;
        if (kind !== 'EXIF' && kind !== 'XMP ') chunks.push(chunk);
        i = end;
      }
      if (vp8x) vp8x[8] &= ~(0x08 | 0x04); // EXIF and XMP flags
      const body = Buffer.concat(chunks);
      const head = Buffer.alloc(12);
      head.write('RIFF', 0, 'latin1');
      head.writeUInt32LE(body.length + 4, 4);
      head.write('WEBP', 8, 'latin1');
      return Buffer.concat([head, body]);
    }
    case 'gif':
      return b; // no location metadata in GIF; comment blocks are harmless text
  }
}

/** Validates an upload and returns what to store. Throws BannerError with a user-facing message. */
export function processUpload(raw: Buffer): { type: ImageType; data: Buffer; hash: string } {
  const type = sniff(raw);
  if (!type) throw new BannerError(415, 'Only PNG, JPEG, GIF or WebP images.');
  const { width, height } = dimensions(type, raw);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS)
    throw bad(`Too large: ${width}×${height}. Keep it within ${MAX_SIDE}px a side and ${Math.round(MAX_PIXELS / 1e6)} megapixels.`);
  if (width < MIN_WIDTH || height < MIN_HEIGHT) throw bad(`Too small: ${width}×${height}. At least ${MIN_WIDTH}×${MIN_HEIGHT}.`);
  const data = stripMetadata(type, raw);
  return { type, data, hash: createHash('sha256').update(data).digest('hex') };
}

/** Reads a request body, refusing more than `max` bytes (checked as it streams, not after). */
export function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > max) {
      reject(new BannerError(413, `Too big: up to ${max / 1024 / 1024} MB.`));
      req.resume();
      return;
    }
    const parts: Buffer[] = [];
    let size = 0;
    const onData = (c: Buffer) => {
      size += c.length;
      if (size > max) {
        // Stop reading (nothing more is buffered); the caller answers 413 and then closes the
        // connection, so the client gets the message instead of a reset.
        req.off('data', onData);
        req.pause();
        parts.length = 0;
        reject(new BannerError(413, `Too big: up to ${max / 1024 / 1024} MB.`));
        return;
      }
      parts.push(c);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export const bannerPath = (hash: string, type: ImageType) => `/banners/${hash}.${EXT[type]}`;

const PUBLIC = /^\/banners\/([a-f0-9]{64})\.(png|jpg|gif|webp)$/;

/** /banners/<hash>.<ext> → the stored image, with headers that only ever let it be an image. */
export async function serveBanner(
  pathname: string,
  res: ServerResponse,
  load: (hash: string) => Promise<{ type: ImageType; data: Buffer } | undefined>,
): Promise<boolean> {
  const m = pathname.match(PUBLIC);
  if (!m) return false;
  const found = await load(m[1]);
  if (!found || EXT[found.type] !== m[2] || BY_EXT[m[2]] !== found.type) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return true;
  }
  res.writeHead(200, {
    'Content-Type': MIME[found.type],
    'Content-Length': String(found.data.length),
    'Cache-Control': 'public, max-age=31536000, immutable', // the name is the content's hash
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline',
    'Cross-Origin-Resource-Policy': 'cross-origin', // shown on intra pages
    'Referrer-Policy': 'no-referrer',
  });
  res.end(found.data);
  return true;
}
