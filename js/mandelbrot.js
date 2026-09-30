// Escape-time Mandelbrot with smooth (continuous) iteration count.
// Returns -1 for points inside the set, otherwise a depth value >= 0.
export function escapeValue(cr, ci, maxIter) {
  // Skip the main cardioid and period-2 bulb: they are always inside.
  const xq = cr - 0.25;
  const q = xq * xq + ci * ci;
  if (q * (q + xq) <= 0.25 * ci * ci) return -1;
  if ((cr + 1) * (cr + 1) + ci * ci <= 0.0625) return -1;

  let zr = 0, zi = 0, zr2 = 0, zi2 = 0, n = 0;
  // Periodicity check: if z revisits a saved value, the orbit is a cycle → inside.
  let pr = 0, pi = 0, steps = 0, window = 8;
  while (n < maxIter && zr2 + zi2 <= 256) {
    zi = 2 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    zr2 = zr * zr;
    zi2 = zi * zi;
    n++;
    if (Math.abs(zr - pr) < 1e-15 && Math.abs(zi - pi) < 1e-15) return -1;
    if (++steps === window) {
      steps = 0;
      window *= 2;
      pr = zr;
      pi = zi;
    }
  }
  if (n >= maxIter) return -1;
  const smooth = n + 1 - Math.log2(0.5 * Math.log(zr2 + zi2));
  return smooth > 0 ? smooth : 0;
}

// Deterministic pseudo-random value in [0, 1) for a sample (integer hash), so jittered
// renders are identical every time.
function hash01(i, j, a, b) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(a * 131 + b, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// k-th smallest of arr[0..n) (quickselect, in place).
function select(arr, n, k) {
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const pivot = arr[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (arr[i] < pivot) i++;
      while (arr[j] > pivot) j--;
      if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return arr[k];
  }
  return arr[k];
}

// Depth values for rows [rowStart, rowEnd) of a grid of cells.
// grid: { x0, y0, ux, uy, vx, vy, cols, ss, maxIter, clean }. Cell (i, j) spans the parallelogram at
// (x0, y0) + i·(ux, uy) + j·(vx, vy): u steps one column, v one row (rotated grids allowed).
// With ss > 1 each cell takes ss×ss samples and is inside if most samples are inside. Otherwise:
//   default:     the mean depth of the outside samples
//   clean: true  jittered (stratified) samples and the *median* outside depth. Robust against the
//                huge depths of a few samples near the set's edge, so no noisy single stitches.
export function renderRows(grid, rowStart, rowEnd) {
  const { x0, y0, ux, uy, vx, vy, cols, ss, maxIter, clean } = grid;
  const out = new Float32Array((rowEnd - rowStart) * cols);
  const n = ss * ss;
  const buf = new Float64Array(n);
  let k = 0;
  for (let j = rowStart; j < rowEnd; j++) {
    for (let i = 0; i < cols; i++) {
      if (ss === 1) {
        const a = i + 0.5, b = j + 0.5;
        out[k++] = escapeValue(x0 + a * ux + b * vx, y0 + a * uy + b * vy, maxIter);
        continue;
      }
      let inside = 0, sum = 0, m = 0;
      for (let sb = 0; sb < ss; sb++) {
        for (let sa = 0; sa < ss; sa++) {
          const ja = clean ? hash01(i, j, sa, sb) : 0.5, jb = clean ? hash01(j, i, sb, sa) : 0.5;
          const a = i + (sa + ja) / ss, b = j + (sb + jb) / ss;
          const v = escapeValue(x0 + a * ux + b * vx, y0 + a * uy + b * vy, maxIter);
          if (v < 0) inside++;
          else if (clean) buf[m++] = v;
          else sum += v;
        }
      }
      if (inside > n / 2) out[k++] = -1;
      else if (clean) out[k++] = select(buf, m, m >> 1);
      else out[k++] = sum / (n - inside);
    }
  }
  return out;
}

// Grid for a (possibly rotated) selection sampled as cols × rows cells.
// sel: { cx, cy, w, rot } — center, width in complex units, rotation in radians (counter-clockwise);
// height = w · H / W. Column axis = (cos rot, sin rot), row axis (downwards) = (sin rot, −cos rot).
export function selectionGrid(sel, W, H, cols, rows, maxIter, ss = 1) {
  const rot = sel.rot || 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  const w = sel.w, h = (sel.w * H) / W;
  return {
    x0: sel.cx - (w / 2) * c - (h / 2) * s,
    y0: sel.cy - (w / 2) * s + (h / 2) * c,
    ux: (w / cols) * c, uy: (w / cols) * s,
    vx: (h / rows) * s, vy: -(h / rows) * c,
    cols, ss, maxIter,
  };
}

// Depth distribution of a selection, from a coarse n-wide sample grid.
// Returns { q: Float64Array(257) quantiles of the outside points, insideShare }.
export function sampleDepthStats(sel, W, H, maxIter, n = 128) {
  const m = Math.max(1, Math.round((n * H) / W));
  const field = renderRows(selectionGrid(sel, W, H, n, m, maxIter), 0, m);
  const vals = [];
  for (const v of field) if (v >= 0) vals.push(v);
  const q = new Float64Array(257);
  if (vals.length) {
    vals.sort((a, b) => a - b);
    for (let k = 0; k <= 256; k++) q[k] = vals[Math.round((k / 256) * (vals.length - 1))];
  } else {
    for (let k = 0; k <= 256; k++) q[k] = k / 256;
  }
  return { q, insideShare: 1 - vals.length / (n * m) };
}
