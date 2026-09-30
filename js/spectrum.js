import { THREADS } from './dmc.js';

// Thread spectrum: the gradient laid out left → right (outer area → set's edge for single-pass mappings), the
// threads it becomes, and the controls to change them. This is the thread selector:
//   top band:    the gradient (LUT) as the depth mapping sees it
//   yarn band:   the nearest yarn color (of the selected yarn set) at each gradient position, i.e. what a sample
//                point there would pick
//   thread band: the thread each gradient position becomes (one segment per thread run)
//   lines:       sample points; click (or drag) anywhere to move the sample of the segment under the pointer there
//   edges:       between segments; drag one to move gradient positions (and so stitches) to the neighbour
//   bottom:      how many stitches land on each gradient position, in the thread's color
const ROW = 16, GAP = 2, TICK = 6;
const Y_YARN = ROW + GAP, Y_THREAD = 2 * (ROW + GAP), BANDS_END = Y_THREAD + ROW, USAGE_TOP = BANDS_END + TICK + 4;
const JITTER = 4;   // px of movement before a press counts as a drag (click jitter)
const GRAB_LINE = 6, GRAB_EDGE = 5;

const css = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

export class SpectrumView {
  constructor(canvas, info, { onSample, onBoundary }) {
    this.canvas = canvas;
    this.info = info;
    this.onSample = onSample;
    this.onBoundary = onBoundary;
    this.plan = null;
    this.usage = null;
    this.counts = null;
    this.total = 0;
    this.highlight = null;
    this.hover = null;  // { x, handle }
    this.press = null;  // { x0, handle, dragging }
    new ResizeObserver(() => this.draw()).observe(canvas);

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      const handle = this.handleAt(e.offsetX, e.offsetY);
      this.press = { x0: e.offsetX, handle, dragging: false };
      // Not on a handle: the segment under the pointer moves its sample point here (and follows a drag).
      if (!handle && this.plan) {
        this.press.handle = { type: 'sample', k: this.segmentAt(e.offsetX) };
        this.press.dragging = true;
        this.dragTo(this.press.handle, e.offsetX, false);
        this.setCursor();
        this.draw();
      }
    });
    canvas.addEventListener('pointermove', e => {
      const p = this.press;
      if (p?.handle && (p.dragging || Math.abs(e.offsetX - p.x0) >= JITTER)) {
        p.dragging = true;
        this.dragTo(p.handle, e.offsetX, false);
      }
      this.hover = { x: e.offsetX, handle: p ? p.handle : this.handleAt(e.offsetX, e.offsetY) };
      this.setCursor();
      this.draw();
    });
    const end = e => {
      const p = this.press;
      this.press = null;
      if (!p) return;
      if (p.dragging) this.dragTo(p.handle, e.offsetX, true);
      this.setCursor();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (!this.press) { this.hover = null; this.draw(); } });
  }

  // plan: { lut, size, segs: [{ start, end, sample, thread }], threadOfLut } · pattern (optional): { usage, counts, W, H }
  set(plan, pattern, highlight) {
    this.plan = plan;
    this.usage = pattern?.usage || null;
    this.counts = pattern?.counts || null;
    this.total = pattern ? pattern.W * pattern.H : 0;
    this.highlight = highlight;
    this.draw();
  }

  xOf(i) { return (i / this.plan.size) * this.canvas.clientWidth; }
  posAt(x) { return (x / this.canvas.clientWidth) * this.plan.size; }

  segmentAt(x) {
    const i = Math.min(this.plan.size - 1, Math.max(0, Math.floor(this.posAt(x))));
    return Math.max(0, this.plan.segs.findIndex(s => i >= s.start && i < s.end));
  }

  threadAt(x) {
    if (!this.plan) return null;
    const i = Math.min(this.plan.size - 1, Math.max(0, Math.floor(this.posAt(x))));
    return this.plan.threadOfLut[i];
  }

  // What a press at (x, y) would grab. Sample lines win in the gradient band and marker row, edges in the
  // thread band and the stitch bars (where you can see the stitches you're moving).
  handleAt(x, y) {
    if (!this.plan) return null;
    const { segs } = this.plan;
    let line = null, edge = null, dl = GRAB_LINE, de = GRAB_EDGE;
    segs.forEach((s, k) => {
      const d1 = Math.abs(this.xOf(s.sample + 0.5) - x);
      if (d1 <= dl) { dl = d1; line = { type: 'sample', k }; }
      if (k > 0) {
        const d2 = Math.abs(this.xOf(s.start) - x);
        if (d2 <= de) { de = d2; edge = { type: 'edge', k }; }
      }
    });
    const inThreads = y >= Y_THREAD - GAP / 2 && y < BANDS_END;
    const inUsage = y >= BANDS_END + TICK;
    return inThreads || inUsage ? edge || (inUsage ? null : line) : line || edge;
  }

  dragTo(h, x, done) {
    const { segs } = this.plan;
    if (h.type === 'sample') {
      const s = segs[h.k];
      this.onSample(h.k, Math.min(s.end - 1, Math.max(s.start, Math.floor(this.posAt(x)))), done);
    } else {
      // The edge stays between the two sample points, so each segment keeps at least one entry.
      const lo = segs[h.k - 1].sample + 1, hi = segs[h.k].sample;
      this.onBoundary(h.k, Math.min(hi, Math.max(lo, Math.round(this.posAt(x)))), done);
    }
  }

  setCursor() {
    const h = this.press?.handle || this.hover?.handle;
    this.canvas.style.cursor = !h ? 'crosshair' : h.type === 'edge' ? 'ew-resize' : this.press?.dragging ? 'grabbing' : 'grab';
  }

  stitchesIn(a, b) {
    let n = 0;
    for (let i = a; i < b; i++) n += this.usage[i];
    return n;
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.plan) return;
    const { lut, size, threadOfLut, segs } = this.plan;
    const style = getComputedStyle(c);
    const accent = style.getPropertyValue('--accent').trim() || '#b0305a';
    const xOf = i => this.xOf(i);
    const hl = this.highlight;
    const active = this.press?.handle || this.hover?.handle;
    const isActive = (type, k) => active && active.type === type && active.k === k;

    // Gradient band, then one block per segment in its thread's color.
    for (let i = 0; i < size; i++) {
      ctx.fillStyle = `rgb(${lut[i * 3]},${lut[i * 3 + 1]},${lut[i * 3 + 2]})`;
      ctx.fillRect(xOf(i), 0, xOf(i + 1) - xOf(i) + 0.5, ROW);
    }
    // Nearest yarn color at each position (runs of equal yarns).
    const near = this.plan.nearestOfLut;
    for (let i = 0; i < size; ) {
      let j = i;
      while (j < size && near[j] === near[i]) j++;
      ctx.fillStyle = css(THREADS[near[i]].rgb);
      ctx.fillRect(xOf(i), Y_YARN, xOf(j) - xOf(i) + 0.5, ROW);
      i = j;
    }
    for (const s of segs) {
      ctx.fillStyle = css(THREADS[s.thread].rgb);
      ctx.fillRect(xOf(s.start), Y_THREAD, xOf(s.end) - xOf(s.start), ROW);
      if (hl != null && s.thread !== hl) {
        ctx.fillStyle = 'rgba(128,128,128,0.65)';
        ctx.fillRect(xOf(s.start), Y_THREAD, xOf(s.end) - xOf(s.start), ROW);
      }
    }

    // Stitches per gradient position, one bar per pixel column in the thread's color (on a faint backdrop so pale
    // threads stay visible). Averaged per gradient entry (columns hold 3 or 4 entries each, which would otherwise
    // flicker) and scaled to the 98th percentile so a single spike doesn't flatten the rest.
    ctx.fillStyle = 'rgba(128,128,128,0.14)';
    ctx.fillRect(0, USAGE_TOP, w, h - USAGE_TOP);
    if (this.usage) {
      // Each column averages the entries it covers (at least one, for panels wider than the gradient's 1024 entries).
      const cols = new Float64Array(Math.ceil(w));
      for (let x = 0; x < cols.length; x++) {
        const a = Math.min(size - 1, Math.floor((x / w) * size));
        const b = Math.max(a + 1, Math.min(size, Math.floor(((x + 1) / w) * size)));
        cols[x] = this.stitchesIn(a, b) / (b - a);
      }
      const sorted = Float64Array.from(cols).sort();
      const top = sorted[Math.floor(0.98 * (sorted.length - 1))] || sorted[sorted.length - 1] || 1;
      const hBar = h - USAGE_TOP;
      for (let x = 0; x < cols.length; x++) {
        if (!cols[x]) continue;
        const bh = Math.max(1, Math.min(1, cols[x] / top) * hBar);
        const t = threadOfLut[Math.min(size - 1, Math.floor(((x + 0.5) / w) * size))];
        ctx.fillStyle = hl != null && t !== hl ? 'rgba(128,128,128,0.5)' : css(THREADS[t].rgb);
        ctx.fillRect(x, h - bh, 1, bh);
      }
    }

    // Segment edges: through the thread band and the stitch bars (drag handles).
    for (let k = 1; k < segs.length; k++) {
      const x = Math.round(xOf(segs[k].start)) + 0.5;
      const on = isActive('edge', k);
      ctx.strokeStyle = on ? accent : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, Y_THREAD); ctx.lineTo(x, BANDS_END); ctx.stroke();
      ctx.setLineDash(on ? [] : [2, 2]);
      ctx.beginPath(); ctx.moveTo(x, USAGE_TOP); ctx.lineTo(x, h); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Sample points: a line through both bands and a marker in the thread's color.
    segs.forEach((s, k) => {
      const x = Math.round(xOf(s.sample + 0.5)) + 0.5;
      const on = hl === s.thread || isActive('sample', k);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = on ? 4 : 3;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, BANDS_END + TICK); ctx.stroke();
      ctx.strokeStyle = on ? accent : '#fff';
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, BANDS_END); ctx.stroke();
      ctx.fillStyle = css(THREADS[s.thread].rgb);
      ctx.beginPath();
      ctx.moveTo(x - 4, BANDS_END + TICK); ctx.lineTo(x + 4, BANDS_END + TICK); ctx.lineTo(x, BANDS_END);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
    });

    // Cursor line (when not on a handle).
    if (this.hover && !active) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(this.hover.x) + 0.5, 0); ctx.lineTo(Math.round(this.hover.x) + 0.5, h); ctx.stroke();
    }
    this.info.textContent = this.readout(active);
  }

  readout(active) {
    const { segs, size } = this.plan;
    const name = t => `${THREADS[t].code} ${THREADS[t].name}`;
    const pct = (a, b) => (this.usage && this.total ? ` · ${((this.stitchesIn(a, b) / this.total) * 100).toFixed(1)}%` : '');
    if (active?.type === 'edge') {
      const a = segs[active.k - 1], b = segs[active.k];
      return `${name(a.thread)}${pct(a.start, a.end)}  |  ${name(b.thread)}${pct(b.start, b.end)} of stitches`;
    }
    if (active?.type === 'sample') {
      const s = segs[active.k];
      return `${THREADS[s.thread].brand} ${name(s.thread)} · sampled at ${((s.sample / size) * 100).toFixed(1)}% of the gradient${pct(s.start, s.end)} of stitches`;
    }
    if (this.hover) {
      const i = Math.min(size - 1, Math.max(0, Math.floor(this.posAt(this.hover.x))));
      const s = segs.find(sg => i >= sg.start && i < sg.end);
      const here = this.plan.nearestOfLut[i];
      const click = here === s.thread ? '' : ` · click → ${name(here)}`;
      return `${THREADS[s.thread].brand} ${name(s.thread)}${click} · ${Math.round(((s.end - s.start) / size) * 100)}% of the gradient${pct(s.start, s.end)} of stitches`;
    }
    return 'Click or drag to move a sample point · drag an edge to move stitches';
  }
}
