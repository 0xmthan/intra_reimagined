// Clusters map (meta.intra.42.fr/clusters, also inside our Clusters window): pinch to zoom, drag to
// pan once zoomed, double-tap to zoom in / back out. With a mouse or trackpad: pinch (ctrl + wheel)
// zooms, and once zoomed a drag or a two-finger scroll moves the map.
// Each floor is an inline SVG, so zooming moves its viewBox: it stays sharp, and intra's seats
// (links and click handlers) keep working. A tap still clicks a seat; a drag or pinch doesn't.
const MAX = 8; // furthest zoom
const DOUBLE_TAP_MS = 300;

type Box = { x: number; y: number; w: number; h: number };

/** Each map's "show this area": zoom so `w` map units fit, centered on (cx, cy); `ms` animates it. */
const zoomers = new WeakMap<SVGSVGElement, (cx: number, cy: number, w: number, ms?: number) => void>();
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // ease-in-out

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
  svg.dataset.irBase = `${base.x} ${base.y} ${base.w} ${base.h}`;
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

  let anim = 0;
  zoomers.set(svg, (cx, cy, w, ms = 0) => {
    const h = w * (base.h / base.w);
    // The target, kept inside the floor like any other zoom.
    const to = { x: Math.min(base.x + base.w - w, Math.max(base.x, cx - w / 2)), y: Math.min(base.y + base.h - h, Math.max(base.y, cy - h / 2)), w, h };
    cancelAnimationFrame(anim);
    if (!ms || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      box = to;
      return apply();
    }
    const from = { ...box };
    const t0 = performance.now();
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / ms));
      box = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k };
      apply();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  });

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

  // ---- mouse: drag to pan once zoomed in (a click without moving still opens a seat) ----
  let drag: { x: number; y: number; id: number; on: boolean } | undefined;
  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || !container.classList.contains('ir-zoomed')) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.hypot(dx, dy) < 4) return; // still a click
      drag.on = true;
      moved = true;
      svg.setPointerCapture(e.pointerId);
      container.classList.add('ir-dragging');
    }
    const s = toMap(0, 0).s;
    box.x -= dx / s;
    box.y -= dy / s;
    apply();
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const dragEnd = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = undefined;
    container.classList.remove('ir-dragging');
  };
  svg.addEventListener('pointerup', dragEnd);
  svg.addEventListener('pointercancel', dragEnd);
  svg.addEventListener('dragstart', (e) => e.preventDefault()); // seat photos: no image drag-and-drop

  // ---- trackpad: pinch (ctrl + wheel) zooms; two-finger scroll pans once zoomed in ----
  svg.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY / 100), e.clientX, e.clientY);
        return;
      }
      if (!container.classList.contains('ir-zoomed')) return; // not zoomed: the page scrolls as usual
      e.preventDefault();
      const s = toMap(0, 0).s;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines / pages → pixels
      box.x += (e.deltaX * unit) / s;
      box.y += (e.deltaY * unit) / s;
      apply();
    },
    { passive: false },
  );
}

/**
 * ?ir-seat=k0m07s03 (our Clusters window opened from someone's seat): switch to that seat's floor,
 * ring the seat, start zoomed in on it, pull back to the whole floor, then name the floor.
 */
function showSeat(seat: string) {
  const rect = document.querySelector<SVGGraphicsElement>(`.map-container svg rect[id="${CSS.escape(seat)}"]`);
  const svg = rect?.ownerSVGElement;
  const pane = rect?.closest<HTMLElement>('.tab-pane');
  if (!rect || !svg || !pane) return false;
  // intra's floor tabs (Bootstrap): click the one for this pane.
  if (!pane.classList.contains('active')) document.querySelector<HTMLElement>(`a[data-toggle="tab"][href="#${CSS.escape(pane.id)}"]`)?.click();
  const b = rect.getBBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  // Wait for the pane to show (it has no size while hidden), then zoom.
  const go = (tries = 0) => {
    if (!svg.getBoundingClientRect().width && tries < 40) return void setTimeout(() => go(tries + 1), 50);
    // Close on them first, then pull back to the whole floor so you see where they sit.
    const zoom = zoomers.get(svg);
    zoom?.(cx, cy, Math.max(b.width, b.height) * 7);
    setTimeout(() => {
      const full = parse(svg.dataset.irBase ?? null);
      if (full) zoom?.(full.x + full.w / 2, full.y + full.h / 2, full.w, 1400);
      // Then the floor's name, over the map for a moment.
      const floor = pane.dataset.floor;
      const box = svg.closest<HTMLElement>('.map-container');
      if (!floor || !box) return;
      setTimeout(() => {
        box.querySelector('.ir-floor-name')?.remove();
        const label = document.createElement('div');
        label.className = 'ir-floor-name';
        label.textContent = floor;
        label.addEventListener('animationend', () => label.remove());
        box.append(label);
      }, 1300);
    }, 900);
    // A steady ring on the seat and a pulse around it (lines as thick zoomed out as in).
    svg.querySelectorAll('.ir-seat-ring, .ir-seat-mark').forEach((e) => e.remove());
    for (const cls of ['ir-seat-mark', 'ir-seat-ring']) {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('class', cls);
      ring.setAttribute('cx', String(cx));
      ring.setAttribute('cy', String(cy));
      ring.setAttribute('r', String(Math.max(b.width, b.height) * 1.1));
      ring.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(ring);
    }
    svg.closest('.map-container')?.scrollIntoView({ block: 'nearest' });
  };
  go();
  return true;
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
  const seat = new URLSearchParams(location.search).get('ir-seat');
  if (seat && /^[a-z0-9]{2,20}$/i.test(seat)) {
    // The maps get their people a moment after load: try until the seat is there.
    let tries = 0;
    const find = () => {
      if (showSeat(seat.toLowerCase()) || ++tries > 30) return;
      setTimeout(find, 200);
    };
    requestAnimationFrame(() => requestAnimationFrame(find));
  }
  // Floors' maps may be (re)drawn later by intra's script.
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}
