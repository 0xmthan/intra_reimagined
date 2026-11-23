// The blackhole on the profile's deadline card while on probation (or the old blackhole system):
// drawn on a canvas behind the card's text, no images. An event horizon with its photon ring, an
// accretion disk seen almost edge-on (inner matter orbits faster, hotter and whiter; the side
// coming towards you brighter), the far side of the disk lensed into a halo over the top of the
// hole (and a faint one under it), and stars drifting in.
// It gets closer as the deadline does: the fewer days left, the bigger the hole, the faster and
// hotter the disk. Once blackholed, you're in it: a huge, slow hole with only embers left.
// One frame for prefers-reduced-motion; paused while off screen or in a hidden tab.

const DISK_N = 700;
const STAR_N = 46;
const R_IN = 1.45; // disk inner edge, in horizon radii
const R_OUT = 3.7;
const TILT = 0.2; // how flat the disk looks (0 = edge-on)
const ROLL = -0.13; // the disk's slant, radians
const FAR_DAYS = 120; // this far out (or more), the hole is as small as it gets

interface Bit {
  r: number; // in horizon radii
  a: number;
  w: number; // speed jitter
  s: number; // size
  b: number; // brightness jitter
}
interface Star {
  r: number; // 0..1 of the card's diagonal
  a: number;
  s: number;
  t: number; // twinkle phase
}

/** Disk colours, cool (outer) → hot (inner), drawn additively. */
const STOPS: [number, number, number][] = [
  [150, 30, 20],
  [230, 70, 35],
  [255, 130, 50],
  [255, 185, 95],
  [255, 228, 175],
  [255, 250, 235],
];
function color(t: number): [number, number, number] {
  const x = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const newBit = (outer = false): Bit => ({
  // denser towards the inside, like a real disk
  r: outer ? rand(R_OUT - 0.4, R_OUT) : R_IN + (R_OUT - R_IN) * Math.pow(Math.random(), 1.6),
  a: rand(0, Math.PI * 2),
  w: rand(0.85, 1.15),
  s: rand(0.6, 1.4),
  b: rand(0.55, 1),
});
const newStar = (edge = false): Star => ({ r: edge ? rand(0.85, 1) : rand(0.15, 1), a: rand(0, Math.PI * 2), s: rand(0.4, 1.1), t: rand(0, 7) });

// Kept across re-renders of the card, so the disk doesn't restart each time the hero redraws.
const bits: Bit[] = Array.from({ length: DISK_N }, () => newBit());
const stars: Star[] = Array.from({ length: STAR_N }, () => newStar());
let shown = 0; // closeness as drawn: eases towards the target on first show
let stop: (() => void) | undefined;

/** How close the hole is, 0 (far) … 1 (at the deadline): grows faster as the last days go. */
export function closeness(days: number) {
  return 1 - Math.sqrt(Math.min(1, Math.max(0, days) / FAR_DAYS));
}

/** Starts the blackhole on `canvas` (data-days, data-gone); stops the previous one. */
export function attachBlackhole(canvas: HTMLCanvasElement | null) {
  stop?.();
  stop = undefined;
  if (!canvas) return;
  const gone = canvas.dataset.gone === '1';
  const target = gone ? 1 : closeness(Number(canvas.dataset.days));
  const g = canvas.getContext('2d');
  if (!g) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) shown = target;

  let w = 0;
  let h = 0;
  let dpr = 1;
  const size = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };

  let visible = true;
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!canvas.isConnected) return cleanup();
    if (!w || !h) size();
    if (w && h) {
      shown += (target - shown) * (1 - Math.exp(-dt * 2.2));
      draw(g, w, h, dpr, shown, gone, still ? 0 : dt, now / 1000);
    }
    if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && !still && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  const ro = new ResizeObserver(() => {
    size();
    if (still || !raf) frame(performance.now());
  });
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    kick();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', kick);

  const cleanup = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', kick);
  };
  stop = cleanup;
  size();
  frame(performance.now());
}

function draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, p: number, gone: boolean, dt: number, t: number) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);

  // Where and how big: on the right, far and small; closer, bigger and drifting in.
  const S = Math.min(h, w * 0.62);
  const rh = gone ? S * 0.3 : S * (0.07 + 0.13 * p);
  const cx = gone ? w * 0.84 : w * (0.8 + 0.04 * p);
  const cy = h * (gone ? 0.56 : 0.54);
  const heat = gone ? 0.4 : 0.55 + 0.45 * p; // how hot the disk burns
  const spin = gone ? 0.25 : 0.7 + 1.6 * p;
  const cos = Math.cos(ROLL);
  const sin = Math.sin(ROLL);
  const at = (x: number, y: number): [number, number] => [cx + x * cos - y * sin, cy + x * sin + y * cos];

  // The glow it casts on the card, and the dark it pulls in around itself.
  const glow = g.createRadialGradient(cx, cy, rh * 0.8, cx, cy, rh * (gone ? 4.2 : 4.8));
  glow.addColorStop(0, `rgba(255, 120, 60, ${(gone ? 0.1 : 0.16 + 0.18 * p).toFixed(3)})`);
  glow.addColorStop(1, 'rgba(255, 80, 60, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  if (gone) {
    const dark = g.createRadialGradient(cx, cy, rh, cx, cy, Math.hypot(w, h));
    dark.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    dark.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = dark;
    g.fillRect(0, 0, w, h);
  }

  // Stars, falling in, faster as it gets closer; they fade out as they near the hole.
  const diag = Math.hypot(w, h);
  g.globalCompositeOperation = 'lighter';
  for (const s of stars) {
    s.r -= dt * (0.004 + 0.03 * p) / Math.max(0.2, s.r);
    s.a += dt * 0.05 / Math.max(0.2, s.r);
    const d = s.r * diag;
    if (d < rh * 1.6) {
      Object.assign(s, newStar(true));
      continue;
    }
    const fade = Math.min(1, (d - rh * 1.6) / (rh * 2));
    const tw = 0.55 + 0.45 * Math.sin(t * 1.7 + s.t);
    g.fillStyle = `rgba(255, 236, 220, ${(0.5 * fade * tw).toFixed(3)})`;
    g.fillRect(cx + Math.cos(s.a) * d, cy + Math.sin(s.a) * d, s.s, s.s);
  }

  // Move the disk: inner orbits faster (Kepler), and everything slowly spirals in.
  for (const b of bits) {
    b.a += dt * spin * b.w * Math.pow(b.r, -1.5) * 2.2;
    b.r -= dt * (0.015 + 0.07 * p) / b.r;
    if (b.r < R_IN * 0.92) Object.assign(b, newBit(true));
  }

  // Each bit is drawn as a short streak along its orbit (motion blur), so the disk reads as smooth
  // swirling rings; overlapping streaks add up to white where the disk is dense and hot.
  const lw = Math.max(0.7, rh * 0.06);
  const hotOf = (b: Bit) => (1 - (b.r - R_IN) / (R_OUT - R_IN)) * heat; // 0 outer … 1 inner
  const streak = (b: Bit, pt: (a: number) => [number, number], alpha: number, width = 1) => {
    const hot = hotOf(b);
    const len = Math.min(0.55, 0.16 + 0.5 * Math.pow(b.r, -1.5)) * (0.6 + 0.4 * spin);
    const [r, gg, bb] = color(hot);
    g.globalAlpha = Math.min(1, alpha);
    g.strokeStyle = `rgb(${r | 0},${gg | 0},${bb | 0})`;
    g.lineWidth = lw * b.s * width * (0.6 + hot * 0.7);
    g.beginPath();
    g.moveTo(...pt(b.a - len));
    g.lineTo(...pt(b.a - len / 2));
    g.lineTo(...pt(b.a));
    g.stroke();
  };
  const onDisk = (b: Bit) => (a: number): [number, number] => at(Math.cos(a) * b.r * rh, Math.sin(a) * b.r * rh * TILT);
  // The lensed images ride circles around the hole: over the top, and a thinner one underneath.
  const onHalo = (rad: number, side: -1 | 1) => (a: number): [number, number] => {
    const c = Math.cos(a);
    return at(c * rad, side * Math.sqrt(Math.max(0, 1 - c * c)) * rad);
  };
  // Doppler beaming: the side coming towards you is brighter.
  const beam = (a: number) => 0.72 + 0.38 * Math.cos(a + 0.4);
  const edgeFade = (r: number) => Math.min(1, (R_OUT - r) / 0.6) * Math.min(1, (r - R_IN * 0.92) / 0.25);
  const base = gone ? 0.4 : 0.42 + 0.3 * p;
  g.lineCap = 'round';

  // The far half of the disk (behind the hole), and its lensed images.
  for (const b of bits) {
    if (Math.sin(b.a) >= 0) continue;
    const a = base * b.b * beam(b.a) * edgeFade(b.r);
    streak(b, onDisk(b), a);
    streak(b, onHalo(rh * (1.07 + (b.r - R_IN) * 0.3), -1), a * 0.55, 0.7);
    streak(b, onHalo(rh * (1.03 + (b.r - R_IN) * 0.1), 1), a * 0.2, 0.5);
  }
  g.globalAlpha = 1;

  // The event horizon: black, with a thin photon ring hugging it.
  g.globalCompositeOperation = 'source-over';
  const shadow = g.createRadialGradient(cx, cy, rh * 0.9, cx, cy, rh * 1.04);
  shadow.addColorStop(0, '#000');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = shadow;
  g.beginPath();
  g.arc(cx, cy, rh * 1.04, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'lighter';
  g.lineWidth = Math.max(0.8, rh * 0.045);
  g.shadowColor = 'rgba(255, 160, 90, 0.9)';
  g.shadowBlur = rh * 0.35;
  g.strokeStyle = `rgba(255, 225, 190, ${(gone ? 0.35 : 0.55 + 0.35 * p).toFixed(3)})`;
  g.beginPath();
  g.arc(cx, cy, rh * 1.05, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;

  // The near half, in front of the hole.
  for (const b of bits) {
    if (Math.sin(b.a) < 0) continue;
    streak(b, onDisk(b), base * 1.1 * b.b * beam(b.a) * edgeFade(b.r));
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
