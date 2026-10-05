// Stitching view: opens a stitch chart (the designer's 🧵 Final export), renders it as stitches with the same
// renderer as the designer, and helps while stitching: highlight one item, chart symbols, row / column numbers,
// a crosshair, progress marking (brush, unmark, flood, undo) remembered in the browser, and visualizations.
//
// Items: in this view every thread + stitch type is its own item ("kind" = thread · 2 + 1 for 10-point), because
// switching between 10-point and 20-point means rethreading the needle just like switching colors. The thread list,
// highlighting, filters, flood, "next undone" and the visualizations all work per kind.
import { PatternView } from './stitch.js';
import { THREADS, nearestThread } from './dmc.js';

const $ = id => document.getElementById(id);
const CHART_FORMAT = 'mandelbrot-stitch-chart';
const PROGRESS_FORMAT = 'mandelbrot-stitch-progress';
// Phones and tablets: touch layout (see work.css) and a smaller stitch-image budget (memory).
const PHONE = matchMedia('(max-width: 900px), (pointer: coarse)').matches;
// The user counts the canvas as 10-point: its holes are every 2 stitches (the big holes between the double threads).
// The grid lines and the rulers count these holes.
const HOLE = 2;
const PREFS_KEY = 'mandel-stitch-work-prefs';

// ---------- Storage: the last chart and the progress of each chart live in IndexedDB (too big for localStorage) ----------

const store = (() => {
  let opening = null;
  const open = () => (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('mandel-stitch-work', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    get: key => run('readonly', s => s.get(key)).catch(() => undefined),
    set: (key, value) => run('readwrite', s => s.put(value, key)).catch(() => {}),
  };
})();

const prefs = (() => {
  const defaults = {
    tool: 'pan', symbols: true, grid: true, texture: true, cross: true, done: true, look: 'stitch',
    brush: 0,              // index into BRUSHES
    filterColor: 'hl',     // 'all' | 'hl' (only the highlighted thread + stitch type, when one is highlighted)
    filterStyle: 'both',   // 'both' | '10' | '20'
    floodConn: 4,          // 4 = flood across edges, 8 = also across corners
    visual: 'none',        // stitch visualization (VISUALS)
  };
  let p;
  try { p = { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; } catch { p = { ...defaults }; }
  if (p.onlyHl === false) p.filterColor = 'all'; // older preference
  delete p.onlyHl;
  return p;
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

function message(text, isError = false) {
  const el = $('msg');
  el.textContent = text;
  el.style.color = isError ? 'var(--accent)' : '';
  clearTimeout(message.t);
  message.t = setTimeout(() => { el.textContent = ''; }, 10000);
}

// ---------- The chart ----------

// chart: { id, name, W, H, indices (THREADS index per cell), counts, blocks, threads: [{ t, symbol, … }], byT, done,
//          kinds: [{ key, t, big, th, cells, stitches, meters }], doneBy (kind → done cells), geometry }
let chart = null;
let hlKind = null;     // highlighted item (kind), or null
let hoverCell = null;  // { i, j } under the pointer (crosshair, readout)
let findMark = null;   // { i, j } found by "Next undone"
let findFrom = 0;

const hexToRgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

async function openChartText(text, remember) {
  let c;
  try {
    c = JSON.parse(text);
  } catch {
    return message('Not a valid JSON file', true);
  }
  if (!c || c.format !== CHART_FORMAT) return message('Not a stitch chart: use 🧵 Final export in the designer', true);
  const W = c.size?.widthStitches, H = c.size?.heightStitches;
  if (!Array.isArray(c.rows) || c.rows.length !== H || c.rows.some(r => r.length !== W)) return message('The chart is damaged (rows do not match its size)', true);

  // Chart threads → the app's thread table (by yarn + code), so the renderer draws the same colors.
  const byKey = new Map(THREADS.map((d, i) => [`${d.brand}|${d.code}`, i]));
  const symT = new Map();
  const threads = c.threads.map(th => {
    let t = byKey.get(`${th.yarn}|${th.code}`);
    if (t === undefined) t = nearestThread(...hexToRgb(th.color), 'dmc');
    symT.set(th.symbol, t);
    return { ...th, t, rgb: THREADS[t].rgb };
  });
  const indices = new Uint16Array(W * H);
  const counts = new Map(threads.map(th => [th.t, 0]));
  for (let j = 0; j < H; j++) {
    const row = c.rows[j];
    for (let i = 0; i < W; i++) {
      const t = symT.get(row[i]);
      if (t === undefined) return message(`The chart is damaged (unknown symbol "${row[i]}" in row ${j + 1})`, true);
      indices[j * W + i] = t;
      counts.set(t, counts.get(t) + 1);
    }
  }
  let blocks = null;
  if (c.tenPointRows?.length) {
    const BW = W >> 1, BH = H >> 1;
    const t = new Int32Array(BW * BH).fill(-1);
    for (let by = 0; by < BH; by++) {
      const row = c.tenPointRows[by] || '';
      for (let bx = 0; bx < BW; bx++) if (row[bx] && row[bx] !== '.') t[by * BW + bx] = symT.get(row[bx]) ?? -1;
    }
    blocks = { BW, BH, t };
  }
  const id = `${c.name}|${W}x${H}|${c.exportedAt}`;
  const saved = await store.get(`progress:${id}`);
  const done = saved instanceof Uint8Array && saved.length === W * H ? saved : new Uint8Array(W * H);

  chart = { id, name: c.name || 'Untitled', W, H, indices, counts, blocks, threads, byT: new Map(threads.map(th => [th.t, th])), done, raw: c };
  // Items: each thread's 10-point and 20-point stitches separately (only those it has).
  const { kind } = stitchGeometry();
  const cellsBy = new Map(), doneBy = new Map();
  for (let k = 0; k < W * H; k++) {
    cellsBy.set(kind[k], (cellsBy.get(kind[k]) || 0) + 1);
    if (done[k]) doneBy.set(kind[k], (doneBy.get(kind[k]) || 0) + 1);
  }
  chart.kinds = [];
  for (const th of threads) {
    for (const big of [true, false]) {
      const key = th.t * 2 + (big ? 1 : 0), cells = cellsBy.get(key) || 0;
      if (!cells) continue;
      chart.kinds.push({ key, t: th.t, big, th, cells, stitches: big ? cells / 4 : cells, meters: kindMeters(th, big) });
      if (!doneBy.has(key)) doneBy.set(key, 0);
    }
  }
  chart.doneBy = doneBy;
  hlKind = null;
  undoStack.length = 0;
  findMark = null;
  findFrom = 0;
  buildDoneLayer();
  buildVisualLayer();
  view.setGros(!!blocks);
  view.highlight = null; // (setHighlight would rebuild the previous pattern's tiles)
  view.highlightStyle = null;
  view.setPattern({ W, H, indices, counts, blocks });
  view.fit();
  $('dropHint').hidden = true;
  const cm = v => Math.round(v * 10) / 10;
  $('chartInfo').textContent = $('chartInfo2').textContent =
    `${chart.name} · ${W} × ${H} stitches · ${cm(c.size.widthCm)} × ${cm(c.size.heightCm)} cm · ${c.yarn}`;
  navigator.storage?.persist?.().catch(() => {}); // ask the browser to keep the chart and progress
  document.title = `${chart.name} · Stitching view`;
  renderThreads();
  if (remember) {
    await store.set('chart', text);
    message(`Opened ${chart.name}`);
  }
}

// A thread's yarn split between its 10-point and 20-point stitches, using the strands from the chart's settings
// (length per stitch: 10-point = 2 × 20-point; the stitch size and tail allowance cancel out of the split).
function kindMeters(th, big) {
  if (th.meters == null) return null;
  const s = chart.raw.settings?.render, ya = s?.yarnAmount?.[s?.yarn] || {};
  const strands = ya.strandsPerStitch ?? 1, strandsBig = ya.strandsPer10PointStitch ?? 2;
  const wBig = (th.stitches10pt || 0) * 2 * strandsBig, wSmall = (th.stitches20pt || 0) * strands;
  const total = wBig + wSmall;
  return total ? (th.meters * (big ? wBig : wSmall)) / total : 0;
}

const kindOf = k => chart.geometry.kind[k];
const kindName = kd => `${chart.byT.get(kd >> 1).code} ${chart.byT.get(kd >> 1).name} · ${kd & 1 ? '10' : '20'}-point`;

// Highlight an item (thread + stitch type), or nothing.
function setHighlightKind(kd) {
  hlKind = kd;
  view.setHighlight(kd == null ? null : kd >> 1, kd == null ? null : kd & 1 ? 'big' : 'small');
  findFrom = 0;
  buildVisualLayer();
  renderThreads();
}

// ---------- Progress: done cells ----------

// Finished stitches are faded by a 1-px-per-stitch overlay drawn over the view.
let doneLayer = null, doneImg = null;
const DONE_RGBA = [248, 245, 238, 175];
function buildDoneLayer() {
  const { W, H, done } = chart;
  doneLayer = document.createElement('canvas');
  doneLayer.width = W;
  doneLayer.height = H;
  doneImg = new ImageData(W, H);
  for (let k = 0; k < done.length; k++) if (done[k]) paintDonePixel(k, 1);
  doneLayer.getContext('2d').putImageData(doneImg, 0, 0);
}
function paintDonePixel(k, on) {
  const o = k * 4, d = doneImg.data;
  if (on) { d[o] = DONE_RGBA[0]; d[o + 1] = DONE_RGBA[1]; d[o + 2] = DONE_RGBA[2]; d[o + 3] = DONE_RGBA[3]; } else d[o + 3] = 0;
}

let saveTimer = 0;
function saveProgress() {
  clearTimeout(saveTimer);
  const { id, done } = chart;
  saveTimer = setTimeout(() => store.set(`progress:${id}`, done), 600);
}

// Set cells to done (1) / not done (0). Returns the cells that changed.
function setCells(cells, value) {
  const { done, doneBy } = chart;
  const changed = [];
  for (const k of cells) {
    if (done[k] === value) continue;
    done[k] = value;
    doneBy.set(kindOf(k), doneBy.get(kindOf(k)) + (value ? 1 : -1));
    paintDonePixel(k, value);
    changed.push(k);
  }
  if (changed.length) {
    doneLayer.getContext('2d').putImageData(doneImg, 0, 0);
    findMark = null;
    view.requestDraw();
    saveProgress();
  }
  return changed;
}

const undoStack = []; // [{ cells: Int32Array, value }] — value = what the action set
function pushUndo(cells, value) {
  if (!cells.length) return;
  undoStack.push({ cells: Int32Array.from(cells), value });
  if (undoStack.length > 100) undoStack.shift();
}
function undo() {
  const last = undoStack.pop();
  if (!last || !chart) return;
  setCells(last.cells, last.value ? 0 : 1);
  renderThreads();
}

// ---- Marking filters and brush ----
const BRUSHES = [1, 3, 5, 9, 15, 25, 41, 61]; // square brush sizes in stitches

// Is cell k part of a 10-point stitch?
function isBig(k) {
  const { W, blocks } = chart;
  if (!blocks) return false;
  const bx = (k % W) >> 1, by = ((k / W) | 0) >> 1;
  return bx < blocks.BW && by < blocks.BH && blocks.t[by * blocks.BW + bx] >= 0;
}

// Does cell k pass the item (thread + stitch type) and stitch type filters?
function passes(k) {
  if (prefs.filterColor === 'hl' && hlKind != null && kindOf(k) !== hlKind) return false;
  if (prefs.filterStyle === 'both') return true;
  return isBig(k) === (prefs.filterStyle === '10');
}

// Cells to mark for cell k: a 10-point stitch is always marked as a whole (its 2 × 2 block).
function addStitch(out, k) {
  if (!passes(k)) return;
  if (isBig(k)) {
    const { W } = chart;
    const c = (((k / W) | 0) & ~1) * W + ((k % W) & ~1);
    out.add(c); out.add(c + 1); out.add(c + W); out.add(c + W + 1);
  } else out.add(k);
}

// Square brush centred on (i, j).
function brushRange(i, j) {
  const s = BRUSHES[prefs.brush] ?? 1, a = Math.floor((s - 1) / 2);
  return { x0: Math.max(0, i - a), y0: Math.max(0, j - a), x1: Math.min(chart.W, i - a + s), y1: Math.min(chart.H, j - a + s) };
}
function brushCells(i, j, out = new Set()) {
  const { x0, y0, x1, y1 } = brushRange(i, j);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) addStitch(out, y * chart.W + x);
  return out;
}

// Flood: the connected patch of the same item (thread + stitch type) as cell (i, j), across edges (and corners when
// floodConn = 8); of that patch, the stitches passing the filters.
function floodCells(i, j) {
  const { W, H } = chart;
  const { kind } = chart.geometry;
  const start = j * W + i, t = kind[start];
  if (prefs.filterColor === 'hl' && hlKind != null && t !== hlKind) return new Set();
  const corners = +prefs.floodConn === 8;
  const seen = new Uint8Array(W * H);
  const out = new Set(), stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const k = stack.pop();
    addStitch(out, k);
    const x = k % W, y = (k / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!corners && dx && dy)) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const n = ny * W + nx;
        if (!seen[n] && kind[n] === t) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  return out;
}

// Marking strokes (paint / erase drags, area clicks).
let spaceDown = false;
let stroke = null; // { value, changed: [], last: {i, j} }
const paint = {
  // Mark / Unmark paint while dragging. Flood acts on a tap (see onTap), so dragging with it moves the view and a
  // two-finger pinch never floods by accident.
  active: e => chart && !spaceDown && e.button === 0 && (prefs.tool === 'paint' || prefs.tool === 'erase'),
  stroke(phase, cell) {
    if (phase === 'cancel') {
      // A second finger arrived: undo this stroke (the view turns it into a pinch zoom).
      if (stroke) setCells(stroke.changed, stroke.value ? 0 : 1);
      stroke = null;
      renderThreads();
      return;
    }
    if (phase === 'down') {
      if (!cell) return;
      stroke = { value: prefs.tool === 'paint' ? 1 : 0, changed: [], last: cell };
      for (const k of setCells(brushCells(cell.i, cell.j), stroke.value)) stroke.changed.push(k);
    } else if (phase === 'move' && stroke && cell) {
      // Every cell on the line from the last one, so fast drags leave no gaps.
      // The brush at every cell on the line from the last one, so fast drags leave no gaps.
      const { last } = stroke;
      const n = Math.max(Math.abs(cell.i - last.i), Math.abs(cell.j - last.j));
      const cells = new Set();
      for (let s = 1; s <= n; s++) {
        brushCells(Math.round(last.i + ((cell.i - last.i) * s) / n), Math.round(last.j + ((cell.j - last.j) * s) / n), cells);
      }
      for (const k of setCells(cells, stroke.value)) stroke.changed.push(k);
      stroke.last = cell;
    } else if (phase === 'up' && stroke) {
      pushUndo(stroke.changed, stroke.value);
      stroke = null;
      renderThreads();
    }
  },
};

// Flood from a tapped / clicked stitch; flooding from a finished stitch unmarks the patch.
function floodAt(cell) {
  const k = cell.j * chart.W + cell.i;
  const value = chart.done[k] ? 0 : 1;
  pushUndo(setCells(floodCells(cell.i, cell.j), value), value);
  renderThreads();
}

// ---------- Progress files: backup and moving progress between devices ----------
// done (0/1 per cell) is stored as alternating run lengths, starting with a run of 0s, in base 36.
function encodeRuns(done) {
  const runs = [];
  let cur = 0, n = 0;
  for (let k = 0; k < done.length; k++) {
    if (done[k] === cur) n++;
    else { runs.push(n.toString(36)); cur = done[k]; n = 1; }
  }
  runs.push(n.toString(36));
  return runs.join(',');
}
function decodeRuns(text, length) {
  const out = new Uint8Array(length);
  let k = 0, cur = 0;
  for (const part of text.split(',')) {
    const n = parseInt(part, 36);
    if (!Number.isFinite(n) || n < 0 || k + n > length) return null;
    if (cur) out.fill(1, k, k + n);
    k += n;
    cur ^= 1;
  }
  return k === length ? out : null;
}

function saveProgressFile() {
  if (!chart) return message('Open a chart first', true);
  const { W, H, done } = chart;
  let cells = 0;
  for (let k = 0; k < done.length; k++) cells += done[k];
  const data = { format: PROGRESS_FORMAT, version: 1, chartId: chart.id, name: chart.name, W, H, savedAt: new Date().toISOString(), doneCells: cells, done: encodeRuns(done) };
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `${chart.name.replace(/[\\/:*?"<>|]+/g, '-')} - progress - ${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  message(`Saved ${a.download}`);
}

async function loadProgressFile(file) {
  if (!chart) return message('Open the chart first, then load its progress', true);
  let p;
  try { p = JSON.parse(await file.text()); } catch { return message('Not a valid progress file', true); }
  if (p?.format !== PROGRESS_FORMAT) return message('Not a progress file (use ⬇ Save progress)', true);
  if (p.W !== chart.W || p.H !== chart.H) return message(`This progress is for a ${p.W} × ${p.H} chart; the open chart is ${chart.W} × ${chart.H}`, true);
  if (p.chartId !== chart.id && !confirm(`This progress was saved for "${p.name}" (another export). Apply it to "${chart.name}" anyway? The grid is the same size.`)) return;
  const done = decodeRuns(String(p.done || ''), chart.W * chart.H);
  if (!done) return message('The progress file is damaged', true);
  const on = [], off = [];
  for (let k = 0; k < done.length; k++) (done[k] ? on : off).push(k);
  setCells(on, 1);
  setCells(off, 0);
  undoStack.length = 0;
  renderThreads();
  message(`Loaded progress from ${p.savedAt?.slice(0, 16).replace('T', ' ') || 'the file'} (${on.length.toLocaleString()} cells done)`);
}

// ---------- Visualizations: color each stitch by a property ----------
// Each visualization computes (once per chart, cached) a value per cell and maps it to a color; the result is a
// 1-px-per-cell overlay drawn over the stitches. When an item is highlighted only its stitches are colored.
// A "stitch" is one 20-point cell, or one 10-point block (2 × 2 cells, one color for the whole block);
// "the same stitch" means the same thread and the same stitch type.

const GAP_NONE = 32767; // nothing of the same kind within GAP_RADIUS
const GAP_RADIUS = 40;

// Cell → the stitch it belongs to (top-left cell of its 10-point block, or itself) and its kind (thread · type).
function stitchGeometry() {
  if (chart.geometry) return chart.geometry;
  const { W, H, indices } = chart;
  const kind = new Int32Array(W * H), owner = new Int32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const big = isBig(k);
    kind[k] = indices[k] * 2 + (big ? 1 : 0);
    owner[k] = big ? (((k / W) | 0) & ~1) * W + ((k % W) & ~1) : k;
  }
  return (chart.geometry = { kind, owner });
}

// Distance from each stitch to the nearest other stitch of the same kind: the gap between their squares in stitches
// (0 = touching by an edge or a corner). Found by searching square rings outward from the stitch.
function nearestGaps() {
  if (chart.gaps) return chart.gaps;
  const { W, H } = chart;
  const { kind, owner } = stitchGeometry();
  const gaps = new Int16Array(W * H).fill(-1);
  for (let k = 0; k < W * H; k++) {
    if (owner[k] !== k) continue; // a 10-point block is handled from its top-left cell
    const x0 = k % W, y0 = (k / W) | 0, s = kind[k] & 1 ? 2 : 1, x1 = x0 + s - 1, y1 = y0 + s - 1, kd = kind[k];
    let gap = GAP_NONE;
    const hit = c => kind[c] === kd && owner[c] !== k;
    ring: for (let r = 1; r <= GAP_RADIUS; r++) {
      const ya = y0 - r, yb = y1 + r, xa = x0 - r, xb = x1 + r;
      for (let x = Math.max(0, xa); x <= Math.min(W - 1, xb); x++) {
        if (ya >= 0 && hit(ya * W + x)) { gap = r - 1; break ring; }
        if (yb < H && hit(yb * W + x)) { gap = r - 1; break ring; }
      }
      for (let y = Math.max(0, ya + 1); y <= Math.min(H - 1, yb - 1); y++) {
        if (xa >= 0 && hit(y * W + xa)) { gap = r - 1; break ring; }
        if (xb < W && hit(y * W + xb)) { gap = r - 1; break ring; }
      }
    }
    gaps[k] = gap;
    if (s === 2) gaps[k + 1] = gaps[k + W] = gaps[k + W + 1] = gap;
  }
  return (chart.gaps = gaps);
}

// Heat colors: touching = dull gray, then yellow → orange → red at 20+ stitches, deep red = none within 40.
const HEAT = [[245, 213, 71], [242, 140, 40], [224, 32, 27]];
function gapColor(g) {
  if (g === 0) return [128, 128, 124];
  if (g >= GAP_NONE) return [128, 10, 50];
  const t = Math.min(1, Math.log(g) / Math.log(20)) * (HEAT.length - 1), a = Math.floor(Math.min(t, HEAT.length - 2)), f = t - a;
  return HEAT[a].map((c, n) => Math.round(c + (HEAT[a + 1][n] - c) * f));
}

const VISUALS = {
  none: { label: 'Thread colors' },
  distance: {
    label: 'Distance to the nearest same stitch',
    color: k => gapColor(nearestGaps()[k]),
    legend: [[0, 'touching'], [1, '1'], [2, '2'], [4, '3–4'], [7, '5–9'], [14, '10–19'], [20, '20+ stitches'], [GAP_NONE, 'none within 40']]
      .map(([g, label]) => [gapColor(g), label]),
    describe: k => {
      const g = nearestGaps()[k];
      return g === 0 ? 'touches a same stitch' : g >= GAP_NONE ? `no same stitch within ${GAP_RADIUS}` : `nearest same stitch ${g} stitch${g > 1 ? 'es' : ''} away`;
    },
  },
};

let visualLayer = null;
function buildVisualLayer() {
  const vis = VISUALS[prefs.visual];
  visualLayer = null;
  if (!chart || !vis?.color) return;
  const { W, H } = chart;
  const img = new ImageData(W, H), d = img.data;
  for (let k = 0; k < W * H; k++) {
    if (hlKind != null && kindOf(k) !== hlKind) continue; // transparent: the view's highlight fading shows through
    const [r, g, b] = vis.color(k);
    d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
  }
  visualLayer = document.createElement('canvas');
  visualLayer.width = W;
  visualLayer.height = H;
  visualLayer.getContext('2d').putImageData(img, 0, 0);
}

function showVisualLegend() {
  const vis = VISUALS[prefs.visual];
  $('visualLegend').innerHTML = vis?.legend
    ? vis.legend.map(([[r, g, b], label]) => `<span><i style="background:rgb(${r},${g},${b})"></i>${label}</span>`).join('')
    : '';
}

function setVisual(key) {
  prefs.visual = VISUALS[key] ? key : 'none';
  $('visual').value = prefs.visual;
  savePrefs();
  const t0 = performance.now();
  buildVisualLayer();
  showVisualLegend();
  if (visualLayer) message(`${VISUALS[prefs.visual].label}: ${Math.round(performance.now() - t0)} ms`);
  view.requestDraw();
}

// ---------- Overlays: finished stitches, symbols, rulers, crosshair ----------

function afterDraw(ctx, v) {
  if (!chart) return;
  const { W, indices, blocks, byT } = chart;
  const { ox, oy, z, i0, j0, i1, j1 } = v;
  const X = i => (i - ox) * z, Y = j => (j - oy) * z;
  if (visualLayer) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.88; // a hint of the stitch texture shows through
    ctx.drawImage(visualLayer, X(0), Y(0), chart.W * z, chart.H * z);
    ctx.restore();
  }
  if (prefs.done && doneLayer) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(doneLayer, X(0), Y(0), chart.W * z, chart.H * z);
    ctx.restore();
  }
  if (prefs.cross && hoverCell) {
    ctx.fillStyle = 'rgba(255, 59, 107, 0.16)';
    ctx.fillRect(X(i0), Y(hoverCell.j), (i1 - i0) * z, z);
    ctx.fillRect(X(hoverCell.i), Y(j0), z, (j1 - j0) * z);
    ctx.strokeStyle = 'rgba(255, 59, 107, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(hoverCell.i), Y(hoverCell.j), z, z);
  }
  if (prefs.symbols && z >= 12) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const small = `700 ${Math.round(z * 0.6)}px ui-monospace, Menlo, monospace`;
    const big = `700 ${Math.round(z * 1.1)}px ui-monospace, Menlo, monospace`;
    const ink = t => (luminance(byT.get(t).rgb) > 0.55 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)');
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const t = indices[j * W + i];
        if (hlKind != null && kindOf(j * W + i) !== hlKind) continue;
        if (blocks) {
          const bx = i >> 1, by = j >> 1;
          if (bx < blocks.BW && by < blocks.BH && blocks.t[by * blocks.BW + bx] >= 0) {
            // One symbol per 10-point stitch, centred on its block (drawn from the block's top-left cell).
            if ((i & 1) || (j & 1)) continue;
            ctx.font = big;
            ctx.fillStyle = ink(t);
            ctx.fillText(byT.get(t).symbol, X(i + 1), Y(j + 1));
            continue;
          }
        }
        ctx.font = small;
        ctx.fillStyle = ink(t);
        ctx.fillText(byT.get(t).symbol, X(i + 0.5), Y(j + 0.5));
      }
    }
    ctx.restore();
  }
  if (hoverCell && (prefs.tool === 'paint' || prefs.tool === 'erase') && !spaceDown) {
    // Brush outline.
    const { x0, y0, x1, y1 } = brushRange(hoverCell.i, hoverCell.j);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = prefs.tool === 'paint' ? 'rgba(40,200,120,0.95)' : 'rgba(255,120,60,0.95)';
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(X(x0), Y(y0), (x1 - x0) * z, (y1 - y0) * z);
    ctx.restore();
  }
  if (prefs.grid) drawRulers(ctx, v);
  if (findMark) {
    const cx = X(findMark.i + 0.5), cy = Y(findMark.j + 0.5);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ff3b6b';
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(10, z * 1.2), 0, Math.PI * 2); ctx.stroke();
  }
}

// Row and column numbers along the top and left edges, on the grid lines: the line after h (10-point) holes runs along
// the thread through the middle of 10-point stitch h (see PatternView.drawCanvasLines), labelled h. Every 5 / 10 / 50 /
// 100 holes.
function drawRulers(ctx, v) {
  const { ox, oy, z, i0, j0, i1, j1, W, H } = v;
  const step = [5, 10, 50, 100].find(s => z * HOLE * s >= 26);
  if (!step) return;
  const at = h => HOLE * h - HOLE / 2; // stitch coordinate of the line after h holes
  const cw = view.cssW, ch = view.cssH;
  ctx.save();
  ctx.fillStyle = 'rgba(20, 18, 14, 0.72)';
  ctx.fillRect(0, 0, cw, 16);
  ctx.fillRect(0, 16, 30, ch - 16);
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#f3efe6';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // The pointer's 10-point column / row (red, at the middle of its 10-point stitch); regular numbers make room for it.
  const hc = hoverCell ? Math.floor(hoverCell.i / HOLE) + 1 : 0, hr = hoverCell ? Math.floor(hoverCell.j / HOLE) + 1 : 0;
  const hx = hoverCell ? (at(hc) - ox) * z : -1e9, hy = hoverCell ? (at(hr) - oy) * z : -1e9;
  for (let h = Math.max(step, Math.ceil(i0 / HOLE / step) * step); at(h) <= Math.min(i1, W); h += step) {
    const x = (at(h) - ox) * z;
    if (x > 34 && Math.abs(x - hx) > 22) ctx.fillText(String(h), x, 8);
  }
  ctx.textAlign = 'right';
  for (let h = Math.max(step, Math.ceil(j0 / HOLE / step) * step); at(h) <= Math.min(j1, H); h += step) {
    const y = (at(h) - oy) * z;
    if (y > 22 && Math.abs(y - hy) > 11) ctx.fillText(String(h), 27, y);
  }
  if (hoverCell) {
    ctx.fillStyle = '#ff3b6b';
    ctx.textAlign = 'center';
    ctx.fillText(String(hc), hx, 8);
    ctx.textAlign = 'right';
    ctx.fillText(String(hr), 27, hy);
  }
  ctx.restore();
}

// ---------- View ----------

const view = new PatternView($('stitches'), {
  onHover(h) {
    if (!h && PHONE) return; // touch: keep the last tapped stitch
    hoverCell = h ? { i: h.i, j: h.j } : null;
    showReadout();
    view.requestDraw(); // crosshair, ruler numbers, brush outline (cheap: the stitch image is cached)
  },
  onTap(cell) {
    if (!chart || !cell) return;
    hoverCell = cell;
    showReadout();
    if (prefs.tool === 'fill') floodAt(cell);
    view.requestDraw();
  },
  budget: PHONE ? 6e6 : undefined,
  canvasGrid: HOLE, canvasTexture: prefs.texture, // grid lines along the canvas threads, as the user drew them (every 5 / 10 holes of the 10-point canvas)
  miniSize: PHONE ? 96 : undefined,
  onZoom(z) {
    $('zoomInfo').textContent = z >= 1 ? `${z.toFixed(1)} px/stitch` : `1 px = ${(1 / z).toFixed(1)} stitches`;
  },
  afterDraw,
  paint,
});

function showReadout() {
  const text = chart && hoverCell ? describeCell(hoverCell.i, hoverCell.j) : '';
  $('hover').textContent = text;
  if (text) $('mInfo').textContent = text;
}

function describeCell(i, j) {
  const { W, indices, blocks, byT, done } = chart;
  const k = j * W + i, th = byT.get(indices[k]);
  let kind = '20-point stitch';
  if (blocks) {
    const bx = i >> 1, by = j >> 1;
    if (bx < blocks.BW && by < blocks.BH && blocks.t[by * blocks.BW + bx] >= 0) {
      kind = `10-point stitch (rows ${2 * by + 1}–${2 * by + 2}, columns ${2 * bx + 1}–${2 * bx + 2})`;
    }
  }
  const vis = VISUALS[prefs.visual];
  const extra = vis?.describe ? ` · ${vis.describe(k)}` : '';
  const pos10 = `10-pt row ${Math.floor(j / HOLE) + 1}, column ${Math.floor(i / HOLE) + 1}`;
  return `${pos10} (row ${j + 1}, column ${i + 1}) · ${th.symbol} ${th.code} ${th.name} · ${kind}${extra}${done[k] ? ' · ✔ done' : ''}`;
}

// ---------- Thread list ----------

// Thread list grouped by thread: a header row per thread (both stitch types together), then its items. Progress is
// counted in stitches (a 10-point stitch = 4 cells counts once), like the stitching itself.
function renderThreads() {
  const tbody = $('threads');
  tbody.replaceChildren();
  if (!chart) return;
  const fmt = n => Math.round(n).toLocaleString();
  const bar = (done, total) => {
    const pct = total ? (done / total) * 100 : 100, complete = total > 0 && done >= total;
    const label = complete ? '✔ 100%' : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
    return `<span class="done-bar${complete ? ' complete' : ''}"><span class="bar"><span style="width:${pct.toFixed(1)}%"></span></span>${label}</span>`;
  };
  const badge = (th, big) => {
    const [r, g, b] = th.rgb, ink = luminance(th.rgb) > 0.55 ? '#000' : '#fff';
    return `<span class="sym${big ? ' big' : ''}" style="background:rgb(${r},${g},${b});color:${ink}">${th.symbol}</span>`;
  };
  let allDone = 0, allTotal = 0;
  for (const th of chart.threads) {
    const items = chart.kinds.filter(it => it.t === th.t);
    if (!items.length) continue;
    let tDone = 0, tTotal = 0, tMeters = 0;
    const rows = items.map(it => {
      const per = it.big ? 4 : 1, done = (chart.doneBy.get(it.key) || 0) / per;
      tDone += done; tTotal += it.stitches; tMeters += it.meters || 0;
      const tr = document.createElement('tr');
      tr.className = 'item-row' + (hlKind === it.key ? ' active' : '');
      tr.innerHTML = `
        <td>${badge(th, it.big)}</td>
        <td class="name">${it.big ? '10-point' : '20-point'}</td>
        <td class="num">${fmt(it.stitches)}</td>
        <td class="num">${it.meters != null ? fmt(it.meters) : ''}</td>
        <td>${bar(done, it.stitches)}</td>`;
      tr.addEventListener('click', () => {
        setHighlightKind(hlKind === it.key ? null : it.key);
        if (PHONE) setSheet(false);
      });
      return tr;
    });
    allDone += tDone; allTotal += tTotal;
    const head = document.createElement('tr');
    head.className = 'thread-row';
    head.innerHTML = `
      <td>${badge(th, false)}</td>
      <td class="name"><b>${th.code}</b> ${th.name}</td>
      <td class="num">${fmt(tTotal)}</td>
      <td class="num">${th.meters != null ? fmt(tMeters) : ''}</td>
      <td>${bar(tDone, tTotal)}</td>`;
    tbody.append(head, ...rows);
  }
  const pct = allTotal ? (allDone / allTotal) * 100 : 0;
  $('pctAll').textContent = $('mPct').textContent = `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  $('barAll').style.width = `${pct.toFixed(2)}%`;
  $('progressText').textContent = `${fmt(allDone)} of ${fmt(allTotal)} stitches done · ${fmt(allTotal - allDone)} to go`;
}

// Next unfinished stitch of the highlighted item (or of any), row by row from the last find.
function findNext() {
  if (!chart) return;
  const { indices, done, W } = chart;
  const hl = hlKind, n = indices.length;
  for (let s = 0; s < n; s++) {
    const k = (findFrom + s) % n;
    if (!done[k] && (hl == null || kindOf(k) === hl)) {
      const i = k % W, j = (k / W) | 0;
      findMark = { i, j };
      findFrom = k + 1;
      view.fitted = false;
      view.zoomTo(Math.max(view.z, 14), i + 0.5, j + 0.5);
      hoverCell = { i, j };
      showReadout();
      return;
    }
  }
  message(hl == null ? 'Everything is done! 🎉' : `${kindName(hl)} is done! 🎉`);
}

// ---------- Controls ----------

let setBrush = () => {};

function setSheet(open) {
  document.body.classList.toggle('sheet-open', open);
}

function setTool(tool) {
  prefs.tool = tool;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === tool);
  $('stitches').dataset.tool = tool;
  savePrefs();
}

function init() {
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  // Phone toolbar and sheet.
  $('mUndo').addEventListener('click', undo);
  $('mNext').addEventListener('click', findNext);
  $('mSheet').addEventListener('click', () => setSheet(!document.body.classList.contains('sheet-open')));
  $('sheetClose').addEventListener('click', () => setSheet(false));
  $('openChart2').addEventListener('click', () => $('chartFile').click());
  $('fsBtn2').addEventListener('click', () => $('fsBtn').click());
  // Progress files.
  $('saveProgress').addEventListener('click', saveProgressFile);
  $('loadProgress').addEventListener('click', () => $('progressFile').click());
  $('progressFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) loadProgressFile(f);
  });
  setTool(prefs.tool);
  const bindCheck = (id, key, after) => {
    $(id).checked = prefs[key];
    $(id).addEventListener('change', e => { prefs[key] = e.target.checked; savePrefs(); after?.(); view.requestDraw(); });
  };
  bindCheck('showSymbols', 'symbols');
  bindCheck('showGrid', 'grid', () => view.setGrid(prefs.grid));
  bindCheck('showCross', 'cross');
  bindCheck('showTexture', 'texture', () => view.setCanvasTexture(prefs.texture));
  bindCheck('showDone', 'done');
  const showBrush = () => {
    $('brush').value = prefs.brush;
    const s = BRUSHES[prefs.brush];
    $('brushOut').textContent = `${s} × ${s} stitch${s > 1 ? 'es' : ''}`;
  };
  showBrush();
  $('brush').addEventListener('input', () => { prefs.brush = +$('brush').value; showBrush(); savePrefs(); view.requestDraw(); });
  setBrush = delta => { prefs.brush = Math.min(BRUSHES.length - 1, Math.max(0, prefs.brush + delta)); showBrush(); savePrefs(); view.requestDraw(); };
  for (const [id, key] of [['filterColor', 'filterColor'], ['filterStyle', 'filterStyle'], ['floodConn', 'floodConn']]) {
    $(id).value = String(prefs[key]);
    $(id).addEventListener('change', e => { prefs[key] = key === 'floodConn' ? +e.target.value : e.target.value; savePrefs(); });
  }
  view.setGrid(prefs.grid);
  const looks = document.querySelectorAll('[data-look]');
  const applyLook = () => {
    for (const b of looks) b.classList.toggle('on', b.dataset.look === prefs.look);
    view.setLook(prefs.look);
  };
  for (const b of looks) b.addEventListener('click', () => { prefs.look = b.dataset.look; savePrefs(); applyLook(); });
  applyLook();

  for (const [key, { label }] of Object.entries(VISUALS)) $('visual').add(new Option(label, key));
  $('visual').value = prefs.visual;
  $('visual').addEventListener('change', e => setVisual(e.target.value));
  showVisualLegend();

  $('undo').addEventListener('click', undo);
  $('fit').addEventListener('click', () => view.fit());
  $('findNext').addEventListener('click', findNext);

  // Opening charts: button, or drop anywhere.
  $('openChart').addEventListener('click', () => $('chartFile').click());
  $('chartFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) openChartText(await f.text(), true);
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', async e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) openChartText(await f.text(), true);
  });

  // Fullscreen: the whole page (all controls stay available).
  const fsBtn = $('fsBtn');
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = $('fsBtn2').textContent = document.fullscreenElement ? '✕ Exit fullscreen' : '⛶ Fullscreen';
  });

  // Keyboard: 1–4 tools, Space held = move, Cmd/Ctrl+Z undo, N next undone, F fit, S symbols, Esc clears highlight.
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, select, textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { spaceDown = true; $('stitches').classList.add('panning'); e.preventDefault(); return; }
    const tools = { 1: 'pan', 2: 'paint', 3: 'erase', 4: 'fill' };
    if (tools[e.key]) setTool(tools[e.key]);
    else if (e.key === '[') setBrush(-1);
    else if (e.key === ']') setBrush(1);
    else if (e.key === 'n' || e.key === 'N') findNext();
    else if (e.key === 'f' || e.key === 'F') view.fit();
    else if (e.key === 's' || e.key === 'S') $('showSymbols').click();
    else if (e.key === 'Escape' && chart) setHighlightKind(null);
    else if (e.key === 'v' || e.key === 'V') {
      const keys = Object.keys(VISUALS);
      setVisual(keys[(keys.indexOf(prefs.visual) + 1) % keys.length]);
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === ' ') { spaceDown = false; $('stitches').classList.remove('panning'); }
  });

  // Reopen the last chart (and its progress).
  store.get('chart').then(text => { if (text) openChartText(text, false); });

  // Offline + "Add to Home screen": a network-first service worker (sw.js). Not on localhost, where serve.py's no-cache
  // behavior matters more (add ?sw=1 to test it there).
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && (!local || new URLSearchParams(location.search).has('sw'))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
