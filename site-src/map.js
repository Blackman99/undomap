// Flood-zone survey map: seeded terrain -> contour lines (d3-contour) -> flood fills whose area is the
// share of bytes in each zone -> benchmarks (one per finding) that flash as the water reaches them.
import { contours } from "d3-contour";

export const VB_W = 1440;
export const VB_H = 720;
export const GW = 160;
export const GH = 80;
const SX = VB_W / GW;
const SY = VB_H / GH;
const NS = "http://www.w3.org/2000/svg";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2(seed) {
  const r = rng(seed);
  const N = 64;
  const lat = new Float64Array(N * N).map(() => r());
  const at = (i, j) => lat[((j % N) + N) % N * N + (((i % N) + N) % N)];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = sm(x - i), fy = sm(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

export function terrain(seed) {
  const n = noise2(seed);
  const r = rng(seed * 7 + 3);
  const a = r() * 6.28, b = r() * 6.28, tilt = 0.5 + r() * 0.12;
  const river = (x) => GH * (tilt + 0.12 * Math.sin((x / GW) * 6.28 * 0.85 + a) + 0.05 * Math.sin((x / GW) * 6.28 * 2.2 + b));
  const ridge = { x: GW * (0.12 + r() * 0.2), y: GH * 0.14 };
  const v = new Float64Array(GW * GH);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const d = Math.abs(y - river(x)) / GH;
      let f = 0, amp = 0.5, fr = 0.045;
      for (let o = 0; o < 4; o++, amp *= 0.5, fr *= 2.1) f += n(x * fr + o * 17, y * fr + o * 31) * amp;
      const rd = Math.hypot((x - ridge.x) / GW, (y - ridge.y) / GH);
      v[y * GW + x] = d * 1.85 + f * 0.6 + (x / GW) * 0.1 + Math.max(0, 0.35 - rd) * 0.9;
    }
  const sorted = Float64Array.from(v).sort();
  const neg = v.map((h) => -h);
  const pts = [];
  for (let x = 0; x <= GW; x += 2) pts.push([x * SX, river(x) * SY]);
  return { v, neg, sorted, min: sorted[0], max: sorted[sorted.length - 1], river: pts, ridge };
}

export const quantile = (t, q) => t.sorted[Math.min(t.sorted.length - 1, Math.max(0, Math.floor(q * (t.sorted.length - 1))))];

function ringPath(ring, smooth) {
  let pts = ring.map(([x, y]) => [x * SX, y * SY]);
  if (smooth && pts.length > 4) {
    for (let k = 0; k < 2; k++) {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
      }
      out.push(out[0]);
      pts = out;
    }
  }
  return "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

export function polyPath(multi, smooth = false) {
  return multi.coordinates.map((poly) => poly.map((ring) => ringPath(ring, smooth)).join("")).join("");
}

const C = contours().size([GW, GH]);
/** Path of {h <= level}. */
export function floodPath(t, level, smooth = false) {
  if (level <= t.min) return "";
  return polyPath(C.thresholds([-level])(t.neg)[0], smooth);
}

export function contourPaths(t, n = 24) {
  const step = (t.max - t.min) / n;
  const th = Array.from({ length: n - 1 }, (_, i) => t.min + step * (i + 1));
  return C.thresholds(th)(t.v).map((c, i) => ({ d: polyPath(c, true), index: (i + 1) % 5 === 0, level: c.value }));
}

/** Pick spread-out grid points inside a height band, avoiding a rectangle (in grid cells). */
export function pickPoints(t, lo, hi, count, avoid, taken, rows = [6, GH - 6], cols = [6, GW - 8]) {
  const cands = [];
  for (let y = rows[0]; y < rows[1]; y += 1)
    for (let x = cols[0]; x < cols[1]; x += 1) {
      if (avoid && x > avoid.x0 && x < avoid.x1 && y > avoid.y0 && y < avoid.y1) continue;
      const h = t.v[y * GW + x];
      if (h > lo && h <= hi) cands.push([x, y, h]);
    }
  // deepest first inside the band, so VE benchmarks sit in the channel
  cands.sort((p, q) => p[2] - q[2]);
  const out = [];
  for (const minD of [20, 14, 9, 5]) {
    for (const c of cands) {
      if (out.length >= count) break;
      if ([...taken, ...out].every((p) => Math.hypot(p[0] - c[0], (p[1] - c[1]) * 1.4) >= minD)) out.push(c);
    }
    if (out.length >= count) break;
  }
  return out.map(([x, y, h]) => ({ x: x * SX + SX / 2, y: y * SY + SY / 2, h }));
}

export const toGrid = (rect) => ({ x0: rect.x0 / SX, x1: rect.x1 / SX, y0: rect.y0 / SY, y1: rect.y1 / SY });
export const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
};
