// Framing guides (composition overlays) drawn over a rectangular frame: the explorer's (possibly rotated) selection
// and the stitch preview. Shapes are defined in unit frame coordinates (u → right, v → down, both 0…1) and mapped
// through the frame's top-left corner o and edge vectors U (top edge) and V (left edge), so they rotate with it.
// Angles that must look right (perpendiculars) are computed at the frame's real aspect, width / height.

const PHI = (1 + Math.sqrt(5)) / 2;

export const GUIDES = [
  ['none', 'No guide'],
  ['thirds', 'Rule of thirds'],
  ['golden', 'Golden ratio grid'],
  ['spiral', 'Golden spiral'],
  ['triangles', 'Golden triangles'],
  ['diagonals', 'Diagonals'],
  ['armature', 'Harmonic armature'],
  ['center', 'Center cross'],
];
// Guides that are not symmetric and come in 4 orientations (flip horizontally / vertically).
export const ORIENTED = new Set(['spiral', 'triangles']);

// Shapes in unit coordinates: { lines: [[u1, v1, u2, v2]], faint: [[…]], curves: [[[u, v], …]] }.
const cache = new Map();
function shapes(kind, aspect) {
  const key = `${kind}:${aspect.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);
  const lines = [], faint = [], curves = [];
  const a = aspect;
  // Real coordinates: x = u·a, y = v. Segment from a corner along a direction to the frame border.
  const toBorder = (x0, y0, dx, dy) => {
    let t = Infinity;
    if (dx > 1e-12) t = Math.min(t, (a - x0) / dx); else if (dx < -1e-12) t = Math.min(t, -x0 / dx);
    if (dy > 1e-12) t = Math.min(t, (1 - y0) / dy); else if (dy < -1e-12) t = Math.min(t, -y0 / dy);
    return [x0 / a, y0, (x0 + dx * t) / a, y0 + dy * t];
  };
  // Foot of the perpendicular from (px, py) onto the line through (x0, y0) with direction (dx, dy).
  const foot = (px, py, x0, y0, dx, dy) => {
    const t = ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy);
    return [(x0 + dx * t) / a, y0 + dy * t];
  };

  if (kind === 'thirds' || kind === 'golden') {
    const f = kind === 'thirds' ? 1 / 3 : 1 - 1 / PHI; // 0.382 / 0.618 for the golden grid
    for (const p of [f, 1 - f]) lines.push([p, 0, p, 1], [0, p, 1, p]);
  } else if (kind === 'center') {
    lines.push([0.5, 0, 0.5, 1], [0, 0.5, 1, 0.5]);
    faint.push([0, 0, 1, 1], [1, 0, 0, 1]);
  } else if (kind === 'diagonals') {
    // Main diagonals plus 45° lines from each corner (the "baroque" and "sinister" lines of the square inside).
    lines.push([0, 0, 1, 1], [1, 0, 0, 1]);
    for (const [x, y, dx, dy] of [[0, 0, 1, 1], [a, 0, -1, 1], [0, 1, 1, -1], [a, 1, -1, -1]]) faint.push(toBorder(x, y, dx, dy));
  } else if (kind === 'armature') {
    // Dynamic symmetry: both diagonals, the 4 reciprocals (from each corner, perpendicular to the diagonal it isn't on),
    // and the rhombus through the midpoints of the sides.
    lines.push([0, 0, 1, 1], [1, 0, 0, 1]);
    faint.push(toBorder(0, 0, 1, a), toBorder(a, 1, -1, -a)); // ⟂ to the TR–BL diagonal (direction (−a, 1))
    faint.push(toBorder(a, 0, -1, a), toBorder(0, 1, 1, -a)); // ⟂ to the TL–BR diagonal (direction (a, 1))
    faint.push([0.5, 0, 1, 0.5], [1, 0.5, 0.5, 1], [0.5, 1, 0, 0.5], [0, 0.5, 0.5, 0]);
  } else if (kind === 'triangles') {
    // One diagonal (TL → BR) and the perpendiculars from the other two corners to it.
    lines.push([0, 0, 1, 1]);
    const [fx1, fy1] = foot(a, 0, 0, 0, a, 1), [fx2, fy2] = foot(0, 1, 0, 0, a, 1);
    lines.push([1, 0, fx1, fy1], [0, 1, fx2, fy2]);
  } else if (kind === 'spiral') {
    // Golden spiral in a φ × 1 rectangle, cut into squares clockwise (left, top, right, bottom, …), one quarter arc per
    // square; then stretched to the frame. Each arc ends where the next one starts.
    let x = 0, y = 0, w = PHI, h = 1;
    const pts = [];
    const arc = (cx, cy, x0, y0, x1, y1) => {
      const r = Math.hypot(x0 - cx, y0 - cy);
      let t0 = Math.atan2(y0 - cy, x0 - cx), t1 = Math.atan2(y1 - cy, x1 - cx);
      let d = t1 - t0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      for (let s = pts.length ? 1 : 0; s <= 16; s++) {
        const t = t0 + (d * s) / 16;
        pts.push([(cx + r * Math.cos(t)) / PHI, cy + r * Math.sin(t)]);
      }
    };
    for (let k = 0; k < 12; k++) {
      const side = k % 4;
      if (side === 0) { const s = h; arc(x + s, y + s, x, y + s, x + s, y); faint.push([(x + s) / PHI, y, (x + s) / PHI, y + h]); x += s; w -= s; }
      else if (side === 1) { const s = w; arc(x, y + s, x, y, x + s, y + s); faint.push([x / PHI, y + s, (x + w) / PHI, y + s]); y += s; h -= s; }
      else if (side === 2) { const s = h; arc(x + w - s, y, x + w, y, x + w - s, y + s); faint.push([(x + w - s) / PHI, y, (x + w - s) / PHI, y + h]); w -= s; }
      else { const s = w; arc(x + s, y + h - s, x + s, y + h, x, y + h - s); faint.push([x / PHI, y + h - s, (x + w) / PHI, y + h - s]); h -= s; }
    }
    curves.push(pts);
  }
  const out = { lines, faint, curves };
  cache.set(key, out);
  return out;
}

// Draw a guide. o = top-left corner, U = top edge vector, V = left edge vector (screen px); aspect = width / height of
// the frame in real units; orient 0…3 flips horizontally (bit 1) and vertically (bit 2) for the oriented guides.
export function drawGuide(ctx, kind, orient, o, U, V, aspect) {
  if (!kind || kind === 'none') return;
  const { lines, faint, curves } = shapes(kind, aspect);
  const fx = ORIENTED.has(kind) && orient & 1, fy = ORIENTED.has(kind) && orient & 2;
  const P = (u, v) => {
    if (fx) u = 1 - u;
    if (fy) v = 1 - v;
    return [o[0] + U[0] * u + V[0] * v, o[1] + U[1] * u + V[1] * v];
  };
  const path = segs => {
    ctx.beginPath();
    for (const [u1, v1, u2, v2] of segs) { ctx.moveTo(...P(u1, v1)); ctx.lineTo(...P(u2, v2)); }
  };
  const curvePath = () => {
    ctx.beginPath();
    for (const pts of curves) pts.forEach(([u, v], k) => (k ? ctx.lineTo(...P(u, v)) : ctx.moveTo(...P(u, v))));
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Each line twice: a dark halo, then light, so guides read on both dark and light areas.
  const stroke = (build, light, width) => {
    build();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = width + 2;
    ctx.stroke();
    ctx.strokeStyle = light;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  if (faint.length) {
    ctx.setLineDash([6, 5]);
    stroke(() => path(faint), 'rgba(255,255,255,0.55)', 1);
    ctx.setLineDash([]);
  }
  if (lines.length) stroke(() => path(lines), 'rgba(255,255,255,0.9)', 1.25);
  if (curves.length) stroke(curvePath, 'rgba(255,209,102,0.95)', 2); // the spiral in gold
  ctx.restore();
}
