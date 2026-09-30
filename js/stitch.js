import { THREADS } from './dmc.js';
import { wheelZoom } from './selector.js';
import { drawGuide } from './guides.js';

const TILE = 2048;              // pattern bitmap is split into tiles to stay under canvas size limits
const MAX_ZOOM = 64;
const STITCH_BUDGET = 16e6;     // max device pixels of the rasterized stitch image (≈ 64 MB)
const STITCH_MIN_K = 3;         // render at least this many device px per stitch, then scale down (fit views)
const HOLE = [46, 38, 30];      // what shows through the holes at the stitch corners (#2e261e)
const FABRIC = [244, 240, 230];
const SURROUND = '#d6d0c1';
const MINI = 180;               // overview inset size

const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
const mix = ([r, g, b], [r2, g2, b2], t) =>
  [r + (r2 - r) * t, g + (g2 - g) * t, b + (b2 - b) * t].map(Math.round);

// ---- Rasterized half-stitch look ----
// Each "/" is an oval from corner to corner, like thread pulled through the canvas holes: wide in the middle so
// neighbouring diagonals (0.71 cell apart) overlap, and pinched at the corners. The corner gaps show a dark hole
// color, not bright fabric: tiny bright specks aliased into moiré patterns. The pinch opens gradually with zoom
// (none below ~6 px/stitch, full from ~16), for the same reason. The dark corners line up into the row and column
// lines real stitching shows.
// Drawn in passes over all stitches: dark outline, then thread, then sheen, so a later pass always covers an earlier
// one. Instead of drawing ellipses, a cell map records for each device pixel of a k × k cell which stitch shows there
// and in which pass (from subsamples); the image is then filled per pixel.
//
// 10-point (gros point) on the Penelope canvas: the fine cells are grouped into a fixed grid of 2 × 2 blocks anchored
// at the pattern's top-left (columns 0–1, 2–3, …; never shifted). A block whose 4 cells share a thread is one big
// stitch over the whole block (the same oval at 2× scale); other blocks are 4 small stitches. A big oval reaches only
// ~0.3 cells past its block and a small one ~0.15 past its cell, so the stitches that can cover a cell are its 9 fine
// neighbours (when their block is small) and the big stitches of the 4 blocks on the cell's side: its own block, the
// horizontal and vertical neighbours toward the cell's corner, and the diagonal one. The cell map therefore depends on
// the cell's position in its block (q = 0…3) and on which of those 4 blocks are big (cfg, 4 bits): geom = q·16 + cfg.
// Owners: 0…8 = fine neighbour (row-major 3 × 3), 9…12 = big stitch of relative block rb (0 own, 1 horizontal,
// 2 vertical, 3 diagonal). With no big blocks around (cfg 0) it is the plain petit point look.
const K = Math.SQRT1_2;
const cellMaps = new Map();
function cellMap(k, open, geom) {
  const key = `${k}:${open}:${geom}`;
  let m = cellMaps.get(key);
  if (m) return m;
  const reach = 0.77 - 0.1 * open;
  // [semi-major, semi-minor, shift across the stitch] in stitch units; the sheen sits slightly off the middle.
  const passes = [[reach, 0.5, 0], [reach - 0.06, 0.45, 0], [0.46, 0.06, 0.16]];
  const q = geom >> 4, cfg = geom & 15;
  const qx = q & 1, qy = q >> 1, sx = qx ? 1 : -1, sy = qy ? 1 : -1;
  const isBig = rb => (cfg >> rb) & 1;
  const cand = []; // [owner, center x, center y (cell units, relative to this cell's top-left), scale]
  for (let n = 0; n < 9; n++) {
    const dx = (n % 3) - 1, dy = Math.floor(n / 3) - 1;
    const rb = (Math.floor((qx + dx) / 2) ? 1 : 0) + (Math.floor((qy + dy) / 2) ? 2 : 0);
    if (!isBig(rb)) cand.push([n, dx + 0.5, dy + 0.5, 1]);
  }
  for (let rb = 0; rb < 4; rb++) {
    if (!isBig(rb)) continue;
    const bx = rb & 1 ? sx : 0, by = rb & 2 ? sy : 0;
    cand.push([9 + rb, 2 * bx + 1 - qx, 2 * by + 1 - qy, 2]);
  }
  const S = k >= 16 ? 2 : 4, n = k * k; // fewer subsamples when cells are big (edges are fine anyway)
  const single = new Int16Array(n); // code = owner * 4 + layer (layer 0 = hole), or -1 = blended pixel
  const multi = [];                  // [pixel, codes[], weights[]] for blended (edge) pixels
  const owners = new Set();
  for (let py = 0; py < k; py++) for (let px = 0; px < k; px++) {
    const counts = new Map();
    for (let ssy = 0; ssy < S; ssy++) for (let ssx = 0; ssx < S; ssx++) {
      const x = (px + (ssx + 0.5) / S) / k, y = (py + (ssy + 0.5) / S) / k;
      let bestLayer = 0, bestOwner = 0, bestV = Infinity;
      for (const [owner, cx, cy, sc] of cand) {
        const u = (x - cx) / sc, v = (y - cy) / sc;
        const along = (u - v) * K, across = (u + v) * K; // the "/" axis on screen (y down)
        for (let layer = 3; layer >= 1 && layer >= bestLayer; layer--) {
          const [pa, pb, ps] = passes[layer - 1];
          const e = (along / pa) ** 2 + ((across - ps) / pb) ** 2;
          if (e <= 1) {
            if (layer > bestLayer || e < bestV) { bestLayer = layer; bestOwner = owner; bestV = e; }
            break;
          }
        }
      }
      const code = bestLayer ? bestOwner * 4 + bestLayer : 0;
      if (bestLayer) owners.add(bestOwner);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    const p = py * k + px;
    if (counts.size === 1) single[p] = counts.keys().next().value;
    else {
      single[p] = -1;
      multi.push([p, [...counts.keys()], [...counts.values()].map(c => c / (S * S))]);
    }
  }
  m = { k, single, multi, owners: [...owners] };
  cellMaps.set(key, m);
  if (cellMaps.size > 400) cellMaps.delete(cellMaps.keys().next().value);
  return m;
}

// Pannable, zoomable view of a stitch pattern. Zoomed out it shows the pattern as a
// bitmap (1 px per stitch); zoomed in it draws each visible stitch as a "/" half stitch.
// pattern: { W, H, indices: Uint16Array (THREADS index per stitch, row-major), counts,
//            blocks: { BW, BH, t } 10-point block threads (-1 = small stitches) or null }
export class PatternView {
  // getFreeRect (optional): () → { x, y, w, h } — the part of the canvas not covered by floating panels (CSS px);
  // Fit places the pattern there.
  // afterDraw (optional): (ctx, { ox, oy, z, i0, j0, i1, j1, W, H }) → draw overlays on top (CSS px, stitch coords).
  // paint (optional): { active(event) → bool, stroke('down' | 'move' | 'up', cell {i, j} | null) } — when active on
  // pointerdown, dragging paints cells instead of panning (the stitching view's marking tools).
  constructor(canvas, { onHover, onZoom, getFreeRect, afterDraw, paint }) {
    this.canvas = canvas;
    this.getFreeRect = getFreeRect;
    this.afterDraw = afterDraw;
    this.paint = paint;
    this.painting = null;
    this.ctx = canvas.getContext('2d');
    this.onHover = onHover;
    this.onZoom = onZoom;
    this.pattern = null;
    this.tiles = [];
    this.mini = null;
    this.highlight = null;
    this.highlightStyle = null;
    this.grid = true;
    this.look = 'stitch'; // zoomed-in look: 'stitch' (/ half stitches) or 'pixels' (flat squares)
    this.z = 1;
    this.ox = 0;
    this.oy = 0;
    this.cssW = 0;
    this.cssH = 0;
    this.drag = null;
    this.frame = 0;
    this.gros = true;   // 10-point blocks (see cellMap)
    this.guide = { kind: 'none', orient: 0 }; // framing guide over the pattern
    this.version = 0;   // bumps when the pattern or highlight changes (invalidates the stitch image)
    this.sr = null;     // cached stitch image: { canvas, ci0, cj0, ci1, cj1, k, open, version }
    this.srTimer = 0;

    canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    // Drag pans; two pointers pinch-zoom (touch). Wheel / trackpad scroll / trackpad pinch zoom.
    this.pointers = new Map();
    const local = e => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pinchInfo = () => {
      const [a, b] = [...this.pointers.values()];
      return { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    };
    canvas.addEventListener('pointerdown', e => {
      if (this.paint && !this.pointers.size && this.pattern && this.paint.active(e)) {
        canvas.setPointerCapture(e.pointerId);
        this.painting = e.pointerId;
        this.paint.stroke('down', this.cellAt(e));
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      if (this.pointers.size === 2) {
        const { dist, mid } = pinchInfo();
        this.drag = { pinch: true, dist, mid, z: this.z, ox: this.ox, oy: this.oy };
      } else if (this.pointers.size === 1) {
        this.drag = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy };
        canvas.style.cursor = 'grabbing';
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (this.painting === e.pointerId) {
        this.paint.stroke('move', this.cellAt(e));
        this.hover(e);
        return;
      }
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, local(e));
      const d = this.drag;
      if (d?.pinch) {
        if (this.pointers.size < 2) return;
        const { dist, mid } = pinchInfo();
        const z = Math.min(MAX_ZOOM, Math.max(this.minZoom(), d.z * (dist / d.dist)));
        this.fitted = false;
        // Keep the stitch under the pinch start point under the fingers' midpoint.
        this.ox = d.ox + d.mid[0] / d.z - mid[0] / z;
        this.oy = d.oy + d.mid[1] / d.z - mid[1] / z;
        this.z = z;
        this.rememberBox();
        this.onZoom?.(z);
        this.requestDraw();
        return;
      }
      if (d) {
        this.fitted = false;
        this.ox = d.ox - (e.clientX - d.x) / this.z;
        this.oy = d.oy - (e.clientY - d.y) / this.z;
        this.rememberBox();
        this.requestDraw();
      }
      this.hover(e);
    });
    const end = e => {
      if (this.painting === e.pointerId) {
        this.painting = null;
        this.paint.stroke('up', null);
        return;
      }
      this.pointers.delete(e.pointerId);
      if (this.drag?.pinch && this.pointers.size) return; // wait until all fingers lift
      this.drag = null;
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('mouseleave', () => this.onHover(null));
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    if (this.needsFit || this.fitted) this.fit();
    else if (this.box) this.applyBox();
    else this.draw();
  }

  setPattern(p) {
    const dimsChanged = !this.pattern || p.W !== this.pattern.W || p.H !== this.pattern.H;
    this.pattern = p;
    if (this.highlight != null && !p.counts.has(this.highlight)) this.highlight = null;
    this.version++;
    this.buildTiles();
    if (dimsChanged) this.fit();
    else this.requestDraw();
  }

  // Highlight a thread (the others fade). style (optional): 'big' | 'small' — only its 10-point / 20-point stitches
  // stay lit (the stitching view treats each thread + stitch type as its own item).
  setHighlight(t, style = null) {
    this.highlight = t;
    this.highlightStyle = t == null ? null : style;
    this.version++;
    this.buildTiles();
    this.requestDraw();
  }

  // Remember the stitch area in view (center + size). It changes only on user pan/zoom, so resizes
  // (e.g. fullscreen and back) fit the same area again instead of drifting.
  rememberBox() {
    if (!this.cssW) return;
    this.box = {
      cx: this.ox + this.cssW / 2 / this.z,
      cy: this.oy + this.cssH / 2 / this.z,
      w: this.cssW / this.z,
      h: this.cssH / this.z,
    };
  }

  applyBox() {
    const b = this.box;
    this.z = Math.min(MAX_ZOOM, Math.min(this.cssW / b.w, this.cssH / b.h));
    this.ox = b.cx - this.cssW / 2 / this.z;
    this.oy = b.cy - this.cssH / 2 / this.z;
    this.onZoom?.(this.z);
    this.draw();
  }

  setGuide(kind, orient) {
    this.guide = { kind, orient };
    this.requestDraw();
  }

  // 10-point: draw same-thread 2 × 2 blocks (on the fixed block grid) as one big stitch.
  setGros(on) {
    if (this.gros === on) return;
    this.gros = on;
    this.version++;
    this.requestDraw();
  }

  setLook(look) {
    this.look = look;
    this.requestDraw();
  }

  setGrid(on) {
    this.grid = on;
    this.requestDraw();
  }

  fitZoom(r = this.freeRect()) {
    const { W, H } = this.pattern;
    return Math.min(r.w / W, r.h / H) * 0.96;
  }

  freeRect() {
    const full = { x: 0, y: 0, w: this.cssW, h: this.cssH };
    const r = this.getFreeRect?.();
    return r && r.w >= 40 && r.h >= 40 ? r : full;
  }

  fit() {
    if (!this.pattern) return;
    this.needsFit = !this.cssW;
    if (this.needsFit) return;
    this.fitted = true; // stays fitted across resizes until the user zooms or pans
    // Center the pattern in the free area; the view (and remembered box) stays relative to the whole canvas.
    const r = this.freeRect(), z = this.fitZoom(r);
    this.zoomTo(z, this.pattern.W / 2 + (this.cssW / 2 - (r.x + r.w / 2)) / z, this.pattern.H / 2 + (this.cssH / 2 - (r.y + r.h / 2)) / z);
  }

  // Re-fit if the view is still in its fitted state (e.g. after a floating panel moved or was hidden).
  refit() {
    if (this.fitted) this.fit();
  }

  // Zoom so that stitch coordinate (si, sj) sits at the view center.
  zoomTo(z, si, sj) {
    this.z = z;
    this.ox = si - this.cssW / 2 / z;
    this.oy = sj - this.cssH / 2 / z;
    this.rememberBox();
    this.onZoom?.(z);
    this.requestDraw();
  }

  zoomCenter(z) {
    this.fitted = false;
    this.zoomTo(z, this.ox + this.cssW / 2 / this.z, this.oy + this.cssH / 2 / this.z);
  }

  minZoom() {
    return Math.min(0.5 * this.fitZoom({ w: this.cssW, h: this.cssH }), 1);
  }

  onWheel(e) {
    e.preventDefault();
    if (!this.pattern) return;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const z = Math.min(MAX_ZOOM, Math.max(this.minZoom(), this.z / wheelZoom(e)));
    this.fitted = false;
    this.ox += x / this.z - x / z;
    this.oy += y / this.z - y / z;
    this.z = z;
    this.rememberBox();
    this.onZoom?.(z);
    this.requestDraw();
  }

  // Stitch cell under a pointer event, or null outside the pattern.
  cellAt(e) {
    const p = this.pattern;
    if (!p) return null;
    const r = this.canvas.getBoundingClientRect();
    const i = Math.floor(this.ox + (e.clientX - r.left) / this.z);
    const j = Math.floor(this.oy + (e.clientY - r.top) / this.z);
    return i < 0 || j < 0 || i >= p.W || j >= p.H ? null : { i, j };
  }

  hover(e) {
    const p = this.pattern;
    if (!p) return;
    const r = this.canvas.getBoundingClientRect();
    const i = Math.floor(this.ox + (e.clientX - r.left) / this.z);
    const j = Math.floor(this.oy + (e.clientY - r.top) / this.z);
    if (i < 0 || j < 0 || i >= p.W || j >= p.H) return this.onHover(null);
    this.onHover({ i, j, dmc: THREADS[p.indices[j * p.W + i]] });
  }

  // Pattern bitmap, 1 px per stitch, in tiles; plus a small overview for the inset.
  buildTiles() {
    const { W, H, indices, blocks } = this.pattern;
    const pk = ([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r; // RGBA little-endian
    const lit = THREADS.map(d => pk(d.rgb)), faded = THREADS.map(d => pk(mix(d.rgb, FABRIC, 0.85)));
    const hl = this.highlight, hs = this.highlightStyle;
    const bigCell = k => {
      if (!blocks) return false;
      const bx = (k % W) >> 1, by = ((k / W) | 0) >> 1;
      return bx < blocks.BW && by < blocks.BH && blocks.t[by * blocks.BW + bx] >= 0;
    };
    // Color of cell k: lit unless another thread (or the other stitch type of the thread) is highlighted.
    const colorOf = k => {
      const t = indices[k];
      if (hl == null) return lit[t];
      if (t !== hl) return faded[t];
      return !hs || bigCell(k) === (hs === 'big') ? lit[t] : faded[t];
    };
    this.tiles = [];
    for (let ty = 0; ty < H; ty += TILE) {
      for (let tx = 0; tx < W; tx += TILE) {
        const w = Math.min(TILE, W - tx), h = Math.min(TILE, H - ty);
        const img = new ImageData(w, h);
        const u32 = new Uint32Array(img.data.buffer);
        for (let y = 0; y < h; y++) {
          const src = (ty + y) * W + tx, dst = y * w;
          for (let x = 0; x < w; x++) u32[dst + x] = colorOf(src + x);
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').putImageData(img, 0, 0);
        this.tiles.push({ c, x: tx, y: ty, w, h });
      }
    }
    const k = Math.min(1, MINI / Math.max(W, H));
    const mini = document.createElement('canvas');
    mini.width = Math.max(1, Math.round(W * k));
    mini.height = Math.max(1, Math.round(H * k));
    const mctx = mini.getContext('2d');
    mctx.imageSmoothingQuality = 'high';
    for (const t of this.tiles) mctx.drawImage(t.c, t.x * k, t.y * k, t.w * k, t.h * k);
    this.mini = mini;
  }

  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURROUND;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const p = this.pattern;
    if (!p) return;

    const { W, H } = p;
    const z = this.z;
    const i0 = Math.max(0, Math.floor(this.ox));
    const j0 = Math.max(0, Math.floor(this.oy));
    const i1 = Math.min(W, Math.ceil(this.ox + this.cssW / z));
    const j1 = Math.min(H, Math.ceil(this.oy + this.cssH / z));
    if (i1 <= i0 || j1 <= j0) return;

    if (this.look === 'stitch' && this.drawStitchImage(i0, j0, i1, j1)) {
      // rasterized "/" stitches at any zoom (see drawStitchImage)
    } else {
      ctx.imageSmoothingEnabled = z < 1;
      ctx.imageSmoothingQuality = 'high';
      for (const t of this.tiles) {
        const x0 = Math.round((t.x - this.ox) * z), y0 = Math.round((t.y - this.oy) * z);
        const x1 = Math.round((t.x + t.w - this.ox) * z), y1 = Math.round((t.y + t.h - this.oy) * z);
        if (x1 < 0 || y1 < 0 || x0 > this.cssW || y0 > this.cssH) continue;
        ctx.drawImage(t.c, x0, y0, x1 - x0, y1 - y0);
      }
      if (this.grid && z >= 6 && this.look === 'pixels') this.drawCellLines(i0, j0, i1, j1, 'rgba(0,0,0,0.18)');
    }
    if (this.grid) this.drawCountLines(i0, j0, i1, j1);
    if (this.guide.kind !== 'none') {
      const x0 = -this.ox * z, y0 = -this.oy * z;
      drawGuide(ctx, this.guide.kind, this.guide.orient, [x0, y0], [W * z, 0], [0, H * z], W / H);
    }
    this.afterDraw?.(ctx, { ox: this.ox, oy: this.oy, z, i0, j0, i1, j1, W, H });
    this.drawMini();
  }

  // The "/ Stitches" look at any zoom: the stitches are rasterized into an offscreen image at k device px per stitch
  // (at least STITCH_MIN_K, so zoomed-out views are rendered finer and scaled down smoothly, like seeing the real
  // piece from a distance), then drawn scaled to the view. The image covers the view plus a margin and is reused
  // while panning; after a zoom change the old image is shown scaled until the view rests, then re-rendered.
  // Returns false when even k = 2 would exceed the pixel budget (huge patterns zoomed out): use the bitmap instead.
  drawStitchImage(i0, j0, i1, j1) {
    const { ctx, z } = this;
    const dpr = window.devicePixelRatio || 1;
    const cells = (i1 - i0) * (j1 - j0);
    // Below 2 device px per stitch the stitch texture can't be shown (it only aliases into moiré): render at 2 px
    // per stitch and shrink that exactly 2:1, which gives each stitch its average color including the outline and
    // hole shading, i.e. how the piece looks from a distance.
    const avg = z * dpr < 2;
    let k = avg ? 2 : Math.max(STITCH_MIN_K, Math.round(z * dpr));
    k = Math.min(k, Math.floor(Math.sqrt(STITCH_BUDGET / cells)));
    if (k < 2) return false;
    const open = Math.round(Math.min(1, Math.max(0, (z - 6) / 10)) * 10) / 10;
    let c = this.sr;
    const covers = c && c.version === this.version && c.ci0 <= i0 && c.cj0 <= j0 && c.ci1 >= i1 && c.cj1 >= j1;
    const stale = covers && (c.k !== k || c.open !== open || !!c.avg !== avg);
    if (!covers || (stale && this.srForce)) {
      c = this.sr = this.renderStitchImage(i0, j0, i1, j1, k, open);
      if (avg) {
        // Exact 2:1 shrink: every output pixel is the mean of one stitch's 2 × 2 pixels.
        const a = document.createElement('canvas');
        a.width = c.ci1 - c.ci0;
        a.height = c.cj1 - c.cj0;
        const actx = a.getContext('2d');
        actx.imageSmoothingEnabled = true;
        actx.imageSmoothingQuality = 'high';
        actx.drawImage(c.canvas, 0, 0, a.width, a.height);
        c.canvas = a;
        c.avg = true;
      }
      this.srForce = false;
    } else if (stale) {
      clearTimeout(this.srTimer);
      this.srTimer = setTimeout(() => { this.srForce = true; this.requestDraw(); }, 150);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = c.avg ? 'medium' : c.k > z * dpr * 1.5 ? 'high' : 'low';
    ctx.drawImage(c.canvas, (c.ci0 - this.ox) * z, (c.cj0 - this.oy) * z, (c.ci1 - c.ci0) * z, (c.cj1 - c.cj0) * z);
    return true;
  }

  renderStitchImage(i0, j0, i1, j1, k, open) {
    const { W, H, indices } = this.pattern;
    // Margin of a quarter view on each side (so panning reuses the image), if it fits the budget.
    const mw = Math.ceil((i1 - i0) / 4), mh = Math.ceil((j1 - j0) / 4);
    let ci0 = Math.max(0, i0 - mw), cj0 = Math.max(0, j0 - mh), ci1 = Math.min(W, i1 + mw), cj1 = Math.min(H, j1 + mh);
    if ((ci1 - ci0) * (cj1 - cj0) * k * k > STITCH_BUDGET) [ci0, cj0, ci1, cj1] = [i0, j0, i1, j1];
    const cols = ci1 - ci0, rows = cj1 - cj0, OW = cols * k, OH = rows * k;

    // Shaded colors per thread (packed RGBA and RGB): layer 0 = hole, 1 = outline, 2 = thread, 3 = sheen.
    // Color index t = thread t lit, t + F = thread t faded (highlighting); nT = no stitch (outside the pattern).
    const nT = THREADS.length, F = nT + 1;
    const rgb = [[], [], [], []];
    const packed = [0, 1, 2, 3].map(() => new Uint32Array(2 * F));
    const pack = ([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r;
    for (let layer = 0; layer < 4; layer++) {
      for (const n of [nT, nT + F]) { rgb[layer][n] = HOLE; packed[layer][n] = pack(HOLE); }
    }
    for (const t of this.pattern.counts.keys()) {
      for (const [n, c] of [[t, THREADS[t].rgb], [t + F, mix(THREADS[t].rgb, FABRIC, 0.85)]]) {
        const shades = [HOLE, mix(c, [0, 0, 0], 0.4), c, mix(c, [255, 255, 255], 0.3)];
        for (let layer = 0; layer < 4; layer++) { rgb[layer][n] = shades[layer]; packed[layer][n] = pack(shades[layer]); }
      }
    }
    const hl = this.highlight, hs = this.highlightStyle;

    // 10-point blocks from the pattern (thread per 2 × 2 block, -1 = four small stitches; islands already split).
    const blocks = this.gros ? this.pattern.blocks : null;
    const bigAt = blocks
      ? (bx, by) => (bx < 0 || by < 0 || bx >= blocks.BW || by >= blocks.BH ? -1 : blocks.t[by * blocks.BW + bx])
      : () => -1;

    const img = new ImageData(OW, OH);
    const out = new Uint32Array(img.data.buffer);
    const kk = k * k;
    const ownerT = new Int32Array(13); // thread per owner (0…8 fine neighbours, 9…12 big stitches)
    const block = new Uint32Array(kk);
    const maps = new Array(64);
    const uniform = new Map(); // geom·nT + thread → cached k × k block when every stitch that shows is that thread
    const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? nT : indices[j * W + i]);
    const fill = (dst, map) => {
      const { single, multi } = map;
      for (let p = 0; p < kk; p++) {
        const code = single[p];
        if (code >= 0) {
          const layer = code & 3;
          dst[p] = layer ? packed[layer][ownerT[code >> 2]] : packed[0][nT];
        }
      }
      for (const [p, codes, ws] of multi) {
        let r = 0, g = 0, b = 0;
        for (let qn = 0; qn < codes.length; qn++) {
          const code = codes[qn], layer = code & 3;
          const c = layer ? rgb[layer][ownerT[code >> 2]] : HOLE;
          r += c[0] * ws[qn]; g += c[1] * ws[qn]; b += c[2] * ws[qn];
        }
        dst[p] = (255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
      }
    };
    for (let j = cj0; j < cj1; j++) {
      const qy = j & 1, sy = qy ? 1 : -1, by = j >> 1;
      const edgeRow = j === 0 || j === H - 1;
      for (let i = ci0; i < ci1; i++) {
        const qx = i & 1, sx = qx ? 1 : -1, bx = i >> 1;
        // Fine neighbours.
        const c = j * W + i;
        if (edgeRow || i === 0 || i === W - 1) {
          for (let nb = 0; nb < 9; nb++) ownerT[nb] = at(i + (nb % 3) - 1, j + Math.floor(nb / 3) - 1);
        } else {
          const u = c - W, d = c + W;
          ownerT[0] = indices[u - 1]; ownerT[1] = indices[u]; ownerT[2] = indices[u + 1];
          ownerT[3] = indices[c - 1]; ownerT[4] = indices[c]; ownerT[5] = indices[c + 1];
          ownerT[6] = indices[d - 1]; ownerT[7] = indices[d]; ownerT[8] = indices[d + 1];
        }
        // Big stitches of the 4 blocks on this cell's side.
        let cfg = 0;
        const b0 = bigAt(bx, by), b1 = bigAt(bx + sx, by), b2 = bigAt(bx, by + sy), b3 = bigAt(bx + sx, by + sy);
        if (b0 >= 0) { cfg |= 1; ownerT[9] = b0; }
        if (b1 >= 0) { cfg |= 2; ownerT[10] = b1; }
        if (b2 >= 0) { cfg |= 4; ownerT[11] = b2; }
        if (b3 >= 0) { cfg |= 8; ownerT[12] = b3; }
        if (hl != null) {
          // Fade every stitch that isn't the highlighted thread (and stitch type): owners 0…8 are small stitches,
          // 9…12 big ones.
          for (let o = 0; o < 13; o++) {
            if (o >= 9 && !(cfg & (1 << (o - 9)))) continue;
            const t = ownerT[o];
            if (t === nT) continue;
            if (t !== hl || (hs && (o >= 9) !== (hs === 'big'))) ownerT[o] = t + F;
          }
        }
        const geom = (qy * 2 + qx) * 16 + cfg;
        const map = maps[geom] || (maps[geom] = cellMap(k, open, geom));
        // Every stitch that can show here has the same thread → reuse a cached block.
        const os = map.owners;
        const t0 = os.length ? ownerT[os[0]] : nT;
        let same = true;
        for (let o = 1; o < os.length; o++) if (ownerT[os[o]] !== t0) { same = false; break; }
        let src;
        if (same) {
          const key = geom * 2 * F + t0;
          src = uniform.get(key);
          if (!src) { src = new Uint32Array(kk); fill(src, map); uniform.set(key, src); }
        } else {
          fill(block, map);
          src = block;
        }
        const x0 = (i - ci0) * k, y0 = (j - cj0) * k;
        for (let y = 0, s = 0; y < k; y++) {
          let o = (y0 + y) * OW + x0;
          for (let x = 0; x < k; x++) out[o++] = src[s++];
        }
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = OW;
    canvas.height = OH;
    canvas.getContext('2d').putImageData(img, 0, 0);
    return { canvas, ci0, cj0, ci1, cj1, k, open, version: this.version };
  }

  // Thin lines on every stitch boundary in the visible range.
  drawCellLines(i0, j0, i1, j1, color) {
    const { ctx, z } = this;
    const X = i => Math.round((i - this.ox) * z) + 0.5, Y = j => Math.round((j - this.oy) * z) + 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = i0 + 1; i < i1; i++) { ctx.moveTo(X(i), Y(j0)); ctx.lineTo(X(i), Y(j1)); }
    for (let j = j0 + 1; j < j1; j++) { ctx.moveTo(X(i0), Y(j)); ctx.lineTo(X(i1), Y(j)); }
    ctx.stroke();
  }

  // Bold counting lines every 10 stitches (every 100 when zoomed far out). Zoomed in they get thicker and have a light
  // halo under a dark core, so they read on black and on pale areas alike; from 16 px/stitch fainter 5-stitch lines
  // help counting in between.
  drawCountLines(i0, j0, i1, j1) {
    const { ctx, z } = this;
    const { W, H } = this.pattern;
    // Only when there's room between them: a dense grid hides the picture in zoomed-out views.
    const step = z * 10 >= 20 ? 10 : z * 100 >= 20 ? 100 : 0;
    if (!step) return;
    const lines = (every, skip, width) => {
      const off = width % 2 ? 0.5 : 0; // crisp lines on the pixel grid
      const X = i => Math.round((i - this.ox) * z) + off, Y = j => Math.round((j - this.oy) * z) + off;
      ctx.beginPath();
      for (let i = Math.ceil(i0 / every) * every; i <= i1; i += every) {
        if (i > 0 && i < W && !(skip && i % skip === 0)) { ctx.moveTo(X(i), Y(j0)); ctx.lineTo(X(i), Y(j1)); }
      }
      for (let j = Math.ceil(j0 / every) * every; j <= j1; j += every) {
        if (j > 0 && j < H && !(skip && j % skip === 0)) { ctx.moveTo(X(i0), Y(j)); ctx.lineTo(X(i1), Y(j)); }
      }
    };
    if (z < 6) { // zoomed out: subtle
      lines(step, 0, 1);
      ctx.strokeStyle = 'rgba(40,30,20,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    const w = z >= 24 ? 3 : z >= 12 ? 2 : 1;
    if (z >= 16) { // 5-stitch lines, thin and dashed
      lines(5, 10, 1);
      ctx.setLineDash([Math.max(2, z / 4), Math.max(2, z / 4)]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,15,10,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    lines(step, 0, w);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = w + 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,15,10,0.9)';
    ctx.lineWidth = w;
    ctx.stroke();
  }

  // Overview inset showing where the current view is, when zoomed in.
  drawMini() {
    const { ctx, mini } = this;
    const { W, H } = this.pattern;
    const vw = this.cssW / this.z, vh = this.cssH / this.z;
    if (!mini || (vw >= W && vh >= H)) return;
    const mx = this.cssW - mini.width - 10, my = this.cssH - mini.height - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(mx - 3, my - 3, mini.width + 6, mini.height + 6);
    ctx.drawImage(mini, mx, my);
    const k = mini.width / W;
    const rx = mx + Math.max(0, this.ox) * k, ry = my + Math.max(0, this.oy) * k;
    const rw = Math.min(W, this.ox + vw) * k - Math.max(0, this.ox) * k;
    const rh = Math.min(H, this.oy + vh) * k - Math.max(0, this.oy) * k;
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, Math.max(2, rw), Math.max(2, rh));
  }

  // Full pattern as one canvas, 1 px per stitch (for export). Throws if too large.
  fullCanvas() {
    const { W, H } = this.pattern;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cctx = c.getContext('2d');
    if (!cctx) throw new Error('canvas too large');
    for (const t of this.tiles) cctx.drawImage(t.c, t.x, t.y);
    return c;
  }
}

// Largest rectangle inside `bounds` that overlaps none of `obstacles` (all { x, y, w, h }), scored by how big a
// W × H pattern fitted into it would be. Candidate edges are the bounds' and obstacles' edges (a handful of panels,
// so brute force is instant).
export function largestFreeRect(bounds, obstacles, W, H) {
  const xs = [bounds.x, bounds.x + bounds.w], ys = [bounds.y, bounds.y + bounds.h];
  for (const o of obstacles) xs.push(o.x, o.x + o.w), ys.push(o.y, o.y + o.h);
  const clampX = v => Math.min(bounds.x + bounds.w, Math.max(bounds.x, v));
  const clampY = v => Math.min(bounds.y + bounds.h, Math.max(bounds.y, v));
  const X = [...new Set(xs.map(clampX))].sort((a, b) => a - b), Y = [...new Set(ys.map(clampY))].sort((a, b) => a - b);
  let best = bounds, bestZ = -1;
  for (let a = 0; a < X.length; a++) for (let b = a + 1; b < X.length; b++) {
    for (let c = 0; c < Y.length; c++) for (let d = c + 1; d < Y.length; d++) {
      const r = { x: X[a], y: Y[c], w: X[b] - X[a], h: Y[d] - Y[c] };
      const z = Math.min(r.w / W, r.h / H);
      if (z <= bestZ) continue;
      const hit = obstacles.some(o => o.x < r.x + r.w && o.x + o.w > r.x && o.y < r.y + r.h && o.y + o.h > r.y);
      if (!hit) { best = r; bestZ = z; }
    }
  }
  return best;
}

const unusedTip = ' title="The depth mapping never reaches this part of the gradient"';
const stitchCells = (n, st, gros) => {
  const tip = n === 0 ? unusedTip : '';
  if (!gros) return `<td class="num"${tip}>${n.toLocaleString()}</td>`;
  return `<td class="num"${tip}>${st.big.toLocaleString()}</td><td class="num"${tip}>${st.small.toLocaleString()}</td>`;
};

// Yarn amounts: 12.3 below 100, whole numbers above.
const amount = v => (v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString());

// Fill a <tbody> with one row per thread. `order` compares [thread index, cells] pairs.
// `yarn`: { meters(stitches), gPerM } for the meters and grams columns; `stitches`: thread → { big, small };
// `gros`: show 10-point and 20-point columns instead of one stitch column.
export function renderLegend(tbody, counts, total, highlight, order, onPick, yarn, stitches, gros) {
  tbody.replaceChildren();
  const rows = [...counts].sort(order);
  for (const [t, n] of rows) {
    const d = THREADS[t];
    const tr = document.createElement('tr');
    if (highlight === t) tr.classList.add('active');
    if (n === 0) tr.classList.add('unused');
    tr.innerHTML = `
      <td><span class="swatch" style="background:${css(d.rgb)}"></span></td>
      <td class="code">${d.code}</td>
      <td>${d.name}</td>
      ${stitchCells(n, stitches.get(t), gros)}
      <td class="num">${((n / total) * 100).toFixed(1)}%</td>
      <td class="num">${amount(yarn.meters(stitches.get(t)))}</td>
      <td class="num">${amount(yarn.meters(stitches.get(t)) * yarn.gPerM)}</td>`;
    tr.addEventListener('click', () => onPick(highlight === t ? null : t));
    tbody.appendChild(tr);
  }
}
