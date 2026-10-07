import type { Rect } from './types';

/** A line drawn while snapping: an alignment guide, or a gap marker (with its size as the label). */
export interface Guide { x1: number; y1: number; x2: number; y2: number; label?: string }

interface AxisSnap { diff: number; guides: Guide[] }

const T = (r: Rect): Rect => ({ x: r.y, y: r.x, w: r.h, h: r.w });
const TG = (g: Guide): Guide => ({ x1: g.y1, y1: g.x1, x2: g.y2, y2: g.x2, label: g.label });

/**
 * Snapping along x for a box being moved: line up its left/centre/right with other cards' edges
 * and centres, or match the gaps between neighbouring cards in the same row (Figma-style).
 * Returns how far to shift the box (0 if nothing is within `th`) and the guides to draw.
 */
function snapX(box: Rect, others: Rect[], th: number): AxisSnap {
  let best: { diff: number; make: (b: Rect) => Guide[] } | null = null;
  const consider = (diff: number, make: (b: Rect) => Guide[]) => {
    if (Math.abs(diff) <= th && (!best || Math.abs(diff) < Math.abs(best.diff) - 0.01)) best = { diff, make };
  };

  // Alignment: edges and centres.
  const offs = [0, box.w / 2, box.w];
  for (const o of others) {
    for (const t of [o.x, o.x + o.w / 2, o.x + o.w]) {
      for (const off of offs) {
        consider(t - (box.x + off), (b) => {
          const hits = others.filter((r) => [r.x, r.x + r.w / 2, r.x + r.w].some((v) => Math.abs(v - t) < 0.5));
          const ys = [b.y, b.y + b.h, ...hits.flatMap((r) => [r.y, r.y + r.h])];
          return [{ x1: t, y1: Math.min(...ys), x2: t, y2: Math.max(...ys) }];
        });
      }
    }
  }

  // Equal spacing with the cards in the same row.
  const row = others.filter((o) => o.y < box.y + box.h && o.y + o.h > box.y).sort((a, b) => a.x - b.x);
  const cx = box.x + box.w / 2;
  const left = row.filter((o) => o.x + o.w <= cx).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
  const right = row.filter((o) => o.x >= cx).sort((a, b) => a.x - b.x)[0];
  const gaps: { g: number; a: Rect; b: Rect }[] = [];
  for (let i = 0; i < row.length; i++) {
    for (let j = i + 1; j < row.length; j++) {
      const g = row[j].x - (row[i].x + row[i].w);
      // Neighbours only: nothing else sits between them.
      if (g > 0 && !row.some((k, n) => n !== i && n !== j && k.x >= row[i].x + row[i].w && k.x + k.w <= row[j].x)) gaps.push({ g, a: row[i], b: row[j] });
    }
  }
  const midY = (a: Rect, b: Rect) => (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
  const gapLine = (x1: number, x2: number, y: number): Guide => ({ x1, y1: y, x2, y2: y, label: String(Math.round(x2 - x1)) });
  if (left) {
    for (const { g, a, b } of gaps) {
      consider(left.x + left.w + g - box.x, (bb) => [gapLine(left.x + left.w, bb.x, midY(left, bb)), gapLine(a.x + a.w, b.x, midY(a, b))]);
    }
  }
  if (right) {
    for (const { g, a, b } of gaps) {
      consider(right.x - g - (box.x + box.w), (bb) => [gapLine(bb.x + bb.w, right.x, midY(right, bb)), gapLine(a.x + a.w, b.x, midY(a, b))]);
    }
  }
  if (left && right && right.x - (left.x + left.w) > box.w) {
    consider((left.x + left.w + right.x) / 2 - cx, (bb) => [gapLine(left.x + left.w, bb.x, midY(left, bb)), gapLine(bb.x + bb.w, right.x, midY(right, bb))]);
  }

  if (!best) return { diff: 0, guides: [] };
  const { diff, make } = best as { diff: number; make: (b: Rect) => Guide[] };
  return { diff, guides: make({ ...box, x: box.x + diff }) };
}

/** Snap a moving box on both axes. `th` is the snap distance in board units. */
export function snapMove(box: Rect, others: Rect[], th: number) {
  const sx = snapX(box, others, th);
  const moved = { ...box, x: box.x + sx.diff };
  const sy = snapX(T(moved), others.map(T), th);
  // Recompute x guides with the final y so their extents are right.
  const fx = sx.diff ? snapX({ ...moved, y: moved.y + sy.diff }, others, 0.5) : { diff: 0, guides: [] };
  return { dx: sx.diff, dy: sy.diff, guides: [...fx.guides, ...sy.guides.map(TG)] };
}

/** Snap one vertical edge (at `x`, spanning y0–y1) to other cards' edges and centres. */
export function snapEdge(x: number, y0: number, y1: number, others: Rect[], th: number) {
  let best: number | null = null;
  for (const o of others) {
    for (const t of [o.x, o.x + o.w / 2, o.x + o.w]) {
      if (Math.abs(t - x) <= th && (best === null || Math.abs(t - x) < Math.abs(best - x))) best = t;
    }
  }
  if (best === null) return { x, guides: [] as Guide[] };
  const t = best;
  const hits = others.filter((r) => [r.x, r.x + r.w / 2, r.x + r.w].some((v) => Math.abs(v - t) < 0.5));
  const ys = [y0, y1, ...hits.flatMap((r) => [r.y, r.y + r.h])];
  return { x: t, guides: [{ x1: t, y1: Math.min(...ys), x2: t, y2: Math.max(...ys) }] };
}
