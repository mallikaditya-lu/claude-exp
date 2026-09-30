import type { Connection, Rect, Side } from './types';

type Pt = { x: number; y: number };

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const NORMAL: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
export const STROKE: Record<number, number> = { 1: 1.6, 2: 2.6, 3: 4 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (a: Pt, b: Pt): Pt => { const l = len(a, b) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (p: Pt) => `${r1(p.x)} ${r1(p.y)}`;

/** Midpoint of a card's side, pushed out by `gap`. */
export function anchor(r: Rect, side: Side, gap = 0): Pt {
  const n = NORMAL[side];
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { x: cx + n.x * (r.w / 2 + gap), y: cy + n.y * (r.h / 2 + gap) };
}

/**
 * The pair of sides that face each other. Like a flowchart: if one card is clearly above the
 * other, connect bottom → top; cards side by side connect right → left.
 */
export function autoSides(a: Rect, b: Rect): [Side, Side] {
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const vertical = vGap >= 20 || (vGap > hGap && vGap > 0);
  if (vertical) return b.y + b.h / 2 >= a.y + a.h / 2 ? ['bottom', 'top'] : ['top', 'bottom'];
  return b.x + b.w / 2 >= a.x + a.w / 2 ? ['right', 'left'] : ['left', 'right'];
}

/** Side of `r` a dropped point should attach to, or undefined (automatic) when dropped near the centre. */
export function sideForPoint(r: Rect, p: Pt): Side | undefined {
  const fx = (p.x - r.x) / (r.w || 1);
  const fy = (p.y - r.y) / (r.h || 1);
  if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) return undefined;
  const d: Record<Side, number> = { top: Math.abs(p.y - r.y), bottom: Math.abs(p.y - (r.y + r.h)), left: Math.abs(p.x - r.x), right: Math.abs(p.x - (r.x + r.w)) };
  return SIDES.reduce((best, s) => (d[s] < d[best] ? s : best), 'top' as Side);
}

/** Polyline with rounded corners. */
function rounded(pts: Pt[], radius = 14) {
  // Drop duplicate and collinear points so corners are real corners.
  const p: Pt[] = [];
  for (const q of pts) {
    const last = p[p.length - 1];
    if (last && len(last, q) < 0.5) continue;
    if (p.length >= 2) {
      const a = p[p.length - 2];
      const b = last!;
      if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - q.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - q.y) < 0.5)) p.pop();
    }
    p.push(q);
  }
  let d = `M${fmt(p[0])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const r = Math.min(radius, len(p[i - 1], p[i]) / 2, len(p[i], p[i + 1]) / 2);
    const u1 = unit(p[i - 1], p[i]);
    const u2 = unit(p[i], p[i + 1]);
    d += ` L${fmt({ x: p[i].x - u1.x * r, y: p[i].y - u1.y * r })} Q${fmt(p[i])} ${fmt({ x: p[i].x + u2.x * r, y: p[i].y + u2.y * r })}`;
  }
  d += ` L${fmt(p[p.length - 1])}`;
  return { d, pts: p };
}

function alongPolyline(p: Pt[], f = 0.5): Pt {
  const total = p.slice(1).reduce((s, q, i) => s + len(p[i], q), 0);
  let left = total * f;
  for (let i = 1; i < p.length; i++) {
    const l = len(p[i - 1], p[i]);
    if (left <= l) { const u = unit(p[i - 1], p[i]); return { x: p[i - 1].x + u.x * left, y: p[i - 1].y + u.y * left }; }
    left -= l;
  }
  return p[p.length - 1];
}

export interface Route {
  d: string;
  /** Label / toolbar position. */
  mid: Pt;
  start: Pt;
  end: Pt;
  /** Open-chevron arrowheads, already positioned. */
  endArrow: string;
  startArrow: string;
  /** Draggable handle for the elbow's middle segment. */
  bend?: { x: number; y: number; axis: 'x' | 'y'; from: number; to: number };
}

function chevron(tip: Pt, dir: Pt, size: number) {
  const px = -dir.y;
  const py = dir.x;
  const back = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  return `M${fmt({ x: back.x + px * size * 0.7, y: back.y + py * size * 0.7 })} L${fmt(tip)} L${fmt({ x: back.x - px * size * 0.7, y: back.y - py * size * 0.7 })}`;
}

/** Compute the drawn path for a connection between two rects. */
export function route(c: Pick<Connection, 'shape' | 'fromSide' | 'toSide' | 'bend' | 'weight'>, a: Rect, b: Rect): Route {
  const [autoA, autoB] = autoSides(a, b);
  const s1 = c.fromSide || autoA;
  const s2 = c.toSide || autoB;
  const n1 = NORMAL[s1];
  const n2 = NORMAL[s2];
  const p1 = anchor(a, s1, 3);
  const p2 = anchor(b, s2, 4);
  const size = 7 + (c.weight || 1) * 2;
  const shape = c.shape || 'curved';

  let d: string;
  let mid: Pt;
  let startDir: Pt;
  let endDir: Pt;
  let bend: Route['bend'];

  if (shape === 'straight') {
    d = `M${fmt(p1)} L${fmt(p2)}`;
    mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    endDir = unit(p1, p2);
    startDir = unit(p2, p1);
  } else if (shape === 'curved') {
    const k = clamp(len(p1, p2) * 0.5, 24, 180);
    const c1 = { x: p1.x + n1.x * k, y: p1.y + n1.y * k };
    const c2 = { x: p2.x + n2.x * k, y: p2.y + n2.y * k };
    d = `M${fmt(p1)} C${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`;
    mid = { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 };
    endDir = unit(c2, p2);
    startDir = unit(c1, p1);
  } else {
    // Elbow: orthogonal segments with rounded corners (FigJam-style).
    const STUB = 22;
    const h1 = n1.x !== 0;
    const h2 = n2.x !== 0;
    const a1 = { x: p1.x + n1.x * STUB, y: p1.y + n1.y * STUB };
    const b1 = { x: p2.x + n2.x * STUB, y: p2.y + n2.y * STUB };
    let pts: Pt[];
    if (h1 && h2) {
      const t = c.bend ?? 0.5;
      const mx = p1.x + (p2.x - p1.x) * t;
      const ok = c.bend !== undefined || ((mx - p1.x) * n1.x >= STUB && (mx - p2.x) * n2.x >= STUB);
      if (ok) {
        pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
        if (Math.abs(p2.x - p1.x) > 2) bend = { x: mx, y: (p1.y + p2.y) / 2, axis: 'x', from: p1.x, to: p2.x };
      } else {
        const my = (p1.y + p2.y) / 2;
        pts = [p1, a1, { x: a1.x, y: my }, { x: b1.x, y: my }, b1, p2];
      }
    } else if (!h1 && !h2) {
      const t = c.bend ?? 0.5;
      const my = p1.y + (p2.y - p1.y) * t;
      const ok = c.bend !== undefined || ((my - p1.y) * n1.y >= STUB && (my - p2.y) * n2.y >= STUB);
      if (ok) {
        pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
        if (Math.abs(p2.y - p1.y) > 2) bend = { x: (p1.x + p2.x) / 2, y: my, axis: 'y', from: p1.y, to: p2.y };
      } else {
        const mx = (p1.x + p2.x) / 2;
        pts = [p1, a1, { x: mx, y: a1.y }, { x: mx, y: b1.y }, b1, p2];
      }
    } else if (h1) {
      const corner = { x: p2.x, y: p1.y };
      pts = (corner.x - p1.x) * n1.x > 0 && (corner.y - p2.y) * n2.y > 0
        ? [p1, corner, p2]
        : [p1, a1, { x: a1.x, y: b1.y }, b1, p2];
    } else {
      const corner = { x: p1.x, y: p2.y };
      pts = (corner.y - p1.y) * n1.y > 0 && (corner.x - p2.x) * n2.x > 0
        ? [p1, corner, p2]
        : [p1, a1, { x: b1.x, y: a1.y }, b1, p2];
    }
    const r = rounded(pts);
    d = r.d;
    mid = alongPolyline(r.pts);
    const n = r.pts.length;
    endDir = unit(r.pts[n - 2], r.pts[n - 1]);
    startDir = unit(r.pts[1], r.pts[0]);
  }

  return { d, mid, start: p1, end: p2, bend, endArrow: chevron(p2, endDir, size), startArrow: chevron(p1, startDir, size) };
}
