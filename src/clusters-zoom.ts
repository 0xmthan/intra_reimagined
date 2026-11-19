// Clusters map (meta.intra.42.fr/clusters, also inside our Clusters window): pinch to zoom, drag to
// pan once zoomed, double-tap to zoom in / back out; a trackpad pinch (ctrl + wheel) zooms too.
// Each floor is an inline SVG, so zooming moves its viewBox: it stays sharp, and intra's seats
// (links and click handlers) keep working. A tap still clicks a seat; a drag or pinch doesn't.
const MAX = 8; // furthest zoom
const DOUBLE_TAP_MS = 300;

type Box = { x: number; y: number; w: number; h: number };

const parse = (vb: string | null): Box | undefined => {
  const n = vb?.trim().split(/[\s,]+/).map(Number);
  return n && n.length === 4 && n.every(Number.isFinite) ? { x: n[0], y: n[1], w: n[2], h: n[3] } : undefined;
};

function attach(container: HTMLElement) {
  const svg = container.querySelector<SVGSVGElement>(':scope > svg');
  if (!svg || svg.dataset.irZoom) return;
  const base = parse(svg.getAttribute('viewBox'));
  if (!base) return;
  svg.dataset.irZoom = '1';
  container.classList.add('ir-zoomable');
  let box = { ...base };

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'ir-zoom-reset';
  reset.textContent = 'Reset zoom';
  reset.hidden = true;
  container.append(reset);

  const apply = () => {
    // Keep the map in view: no smaller than the floor, and no panning past its edges.
    box.w = Math.min(base.w, Math.max(base.w / MAX, box.w));
    box.h = box.w * (base.h / base.w);
    box.x = Math.min(base.x + base.w - box.w, Math.max(base.x, box.x));
    box.y = Math.min(base.y + base.h - box.h, Math.max(base.y, box.y));
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    const zoomed = box.w < base.w - 0.5;
    reset.hidden = !zoomed;
    container.classList.toggle('ir-zoomed', zoomed);
  };

  /** A point on screen, in the map's own (base) coordinates. */
  const toMap = (cx: number, cy: number) => {
    const r = svg.getBoundingClientRect();
    // preserveAspectRatio "xMidYMid meet": the box is scaled to fit and centered.
    const s = Math.min(r.width / box.w, r.height / box.h);
    const ox = r.left + (r.width - box.w * s) / 2;
    const oy = r.top + (r.height - box.h * s) / 2;
    return { x: box.x + (cx - ox) / s, y: box.y + (cy - oy) / s, s };
  };

  /** Zoom by `k` (>1 in) keeping the map point under (cx, cy) under it. */
  const zoomAt = (k: number, cx: number, cy: number) => {
    const p = toMap(cx, cy);
    const w = Math.min(base.w, Math.max(base.w / MAX, box.w / k));
    const f = w / box.w;
    box = { x: p.x - (p.x - box.x) * f, y: p.y - (p.y - box.y) * f, w, h: w * (base.h / base.w) };
    apply();
  };

  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    box = { ...base };
    apply();
  });

  // ---- touch: pinch, pan, double-tap ----
  const pts = new Map<number, { x: number; y: number }>();
  let moved = false;
  let pinch: { d: number } | undefined;
  let lastTap = 0;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = () => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) moved = false;
    if (pts.size === 2) pinch = { d: dist() };
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    if (pts.size === 2 && pinch) {
      const before = mid();
      pts.set(e.pointerId, now);
      const d = dist();
      const after = mid();
      zoomAt(d / pinch.d, after.x, after.y);
      // and follow the fingers' midpoint
      const s = toMap(0, 0).s;
      box.x -= (after.x - before.x) / s;
      box.y -= (after.y - before.y) / s;
      apply();
      pinch.d = d;
      moved = true;
      return;
    }
    pts.set(e.pointerId, now);
    if (Math.hypot(now.x - prev.x, now.y - prev.y) > 0 && container.classList.contains('ir-zoomed')) {
      const s = toMap(0, 0).s;
      box.x -= (now.x - prev.x) / s;
      box.y -= (now.y - prev.y) / s;
      apply();
    }
    if (Math.abs(now.x - prev.x) + Math.abs(now.y - prev.y) > 2) moved = true;
  });
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = undefined;
    if (e.type !== 'pointerup' || moved || pts.size) return;
    // A tap: a second one soon after zooms in there, or back out.
    const t = performance.now();
    if (t - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      if (container.classList.contains('ir-zoomed')) box = { ...base };
      else zoomAt(2.5, e.clientX, e.clientY);
      apply();
      moved = true; // not a seat click
    } else lastTap = t;
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  // A drag or pinch that ends on a seat must not open it.
  svg.addEventListener(
    'click',
    (e) => {
      if (!moved) return;
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    },
    true,
  );

  // ---- trackpad pinch on a laptop (ctrl + wheel) ----
  svg.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY / 100), e.clientX, e.clientY);
    },
    { passive: false },
  );
}

export function initClusterZoom() {
  if (location.hostname !== 'meta.intra.42.fr' || !location.pathname.startsWith('/clusters')) return;
  let queued = false;
  const run = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      document.querySelectorAll<HTMLElement>('.map-container').forEach(attach);
    });
  };
  run();
  // Floors' maps may be (re)drawn later by intra's script.
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}
