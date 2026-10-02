import { PRESETS, PRESET_GROUPS, DEFAULT_INTERIOR, makeMapper, hexToRgb } from './palettes.js';
import { sampleDepthStats, selectionGrid } from './mandelbrot.js';
import { STYLES, generatePalette } from './generate.js';
import { nearestThread, nearestThreadLab, rgbToLab, labDist2, THREADS, THREAD_LAB, yarnOf } from './dmc.js';
import { pickThreads } from './quantize.js';
import { SpectrumView } from './spectrum.js';
import { stampLabel, coordinateLabel } from './label.js';
import { Selector } from './selector.js';
import { GUIDES, ORIENTED } from './guides.js';
import { PatternView, renderLegend, largestFreeRect } from './stitch.js';
import { FieldPool } from './pool.js';
import { buildSave, readSave } from './savefile.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'mandel-stitch-v2';
const MAX_STITCHES = 40e6; // ~160 MB of depth data; beyond this the browser tab may run out of memory

const DEFAULTS = {
  view: null, // fitted to the canvas on first render
  sel: { cx: -0.745, cy: 0.12, w: 0.12 },
  preset: 'Classic',
  saved: [],            // user-saved palettes: [{ name, stops }]
  genStyle: 'surprise',
  genCycle: false,
  stops: [...PRESETS.Classic],
  mapping: 'cyclic',
  fitRange: true,       // linear/log: stretch the gradient over the selection's depth range
  edgeWidth: 0,         // edge mapping: −2 (narrow edge bands) … 0 (balanced) … 2 (wide edge bands)
  saveName: '',         // name given to the last save (or of the loaded file); suggested next time
  // Label stitched into the pattern's lower edge (default text: the coordinates and zoom). Threads: 'auto' or a code.
  label: { on: true, text: '', font: 7, pos: 'br', size: 1, fg: 'auto', bg: 'auto', bgMode: 'outline' },
  threadEdit: false,    // hand-edited thread plan from the spectrum view: { key, segs: [{ end, sample, dmc }] }
  detailBalance: 0.5,   // spectrum mapping: 0 colors shared by area (balanced) … 1 by log-depth range (log)
  bunch: 0,             // non-cyclic: −1 bunch bands toward the outside … 0 even … 1 toward the set's edge
  period: 30,
  offset: 0,
  bands: 0,
  interior: DEFAULT_INTERIOR,
  maxIter: 400,
  density: 7.8,         // stitches per cm (petit point on the 3.9/cm Penelope canvas)
  stitchW: 936,         // 120 cm
  stitchH: 702,         // 90 cm
  maxColors: 12,
  yarn: 'dmc',          // thread catalog the pattern uses: 'dmc' (stranded cotton), 'pirkka', 'rauma' or 'novita' (wool)
  // Yarn amount estimate, per yarn: meters and grams per ball, strands per stitch, extra % for tails.
  // Pirkka (ohut, fingering weight): tex 125 × 2, 100 g = 400 m. DMC starts with the same numbers; edit to taste.
  // Rauma Finull: 50 g = 175 m.
  yarnSpec: {
    dmc: { m: 400, g: 100, strands: 1, strandsBig: 2, extra: 15 },
    pirkka: { m: 400, g: 100, strands: 0.5, strandsBig: 2, extra: 15 },
    rauma: { m: 175, g: 50, strands: 1, strandsBig: 2, extra: 15 },
    novita: { m: 200, g: 100, strands: 1, strandsBig: 1, extra: 15 },
  },
  selVisible: true,     // explorer: false = selection hidden (deselected) until a new one is drawn
  stitchEnabled: true,  // off = skip pattern computation while exploring
  stitchLook: 'stitch', // zoomed-in look: 'stitch' or 'pixels'
  legendSort: 'usage',  // thread list order: 'usage' or 'palette'
  colorsOpen: true,
  supersample: 1,
  grid: true,
  grosPoint: true,
  islandMax: 1,         // 10-point islands of at most this many big stitches are split into 20-point (0 = keep all)
  guide: 'none',        // framing guide over the selection and the stitch preview (see guides.js)
  guideOrient: 0,       // 0…3: flips for the golden spiral / triangles      // stitch view: same-thread 2 × 2 blocks (fixed grid) drawn as one big 10-point stitch
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...DEFAULTS, ...saved } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

const state = load();
// High sample counts (64 / 256 / 1024) are for final export; don't come back to a minutes-long render on reload
// (unless the reload is loading a save file that asked for it).
const keepSampling = (() => { try { return sessionStorage.getItem('mandel-stitch-keep-sampling') === '1'; } catch { return false; } })();
if (state.supersample >= 8 && !keepSampling) state.supersample = 1;

let saveTimer = 0;
let saveSuspended = false; // set while a loaded file is being applied, so a late autosave can't overwrite it
function save() {
  if (saveSuspended) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, 300);
}

const timers = {};
function debounce(name, fn, ms) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(fn, ms);
}

const fmt = n => n.toLocaleString();
const fmtTime = s => (s < 10 ? `${s.toFixed(1)} s` : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const pool = new FieldPool();

let mapperCache = null;
const mapper = () => (mapperCache ??= makeMapper(state, depthStats));

// Depth distribution of the selected area (coarse sample), used to fit linear/log/balanced gradients.
let depthStats = null;
function updateDepthStats() {
  depthStats = sampleDepthStats(state.sel, state.stitchW, state.stitchH, state.maxIter);
  if (state.mapping === 'cyclic') return;
  mapperCache = null;
  recolorExplorer();
}

// ---------- Explorer ----------

const explorer = $('explorer');
const exCtx = explorer.getContext('2d');
const overlay = $('overlay');
let snap = null, snapView = null; // last complete render and the view it was made for
let field = null;                 // its depth values
let pending = null;               // render in progress: { view, w, h, field, canvas }

function fitView() {
  return { cx: -0.6, cy: 0, scale: 3.4 / explorer.width };
}

function sizeExplorer() {
  const wrap = $('explorerWrap');
  const w = Math.max(100, Math.round(wrap.clientWidth));
  const h = Math.max(80, Math.round(wrap.clientHeight));
  if (explorer.width === w && explorer.height === h) return false;
  const old = explorer.width;
  explorer.width = overlay.width = w;
  explorer.height = overlay.height = h;
  if (!state.view) state.view = rememberBox(fitView());
  else if (state.view.boxW) {
    // Fit the remembered visible area into the new canvas size, keeping its center. The box only
    // changes when the user pans or zooms, so fullscreen → back returns exactly the same view.
    state.view.scale = Math.max(state.view.boxW / w, state.view.boxH / h);
  } else if (old) {
    state.view = rememberBox({ ...state.view, scale: state.view.scale * old / w });
  }
  return true;
}

// Record the complex-plane area the user is looking at (width × height at the current canvas size).
function rememberBox(view) {
  return { ...view, boxW: view.scale * explorer.width, boxH: view.scale * explorer.height };
}

function colorize(values, w, rows) {
  const { index, lut, inside } = mapper();
  const img = new ImageData(w, rows);
  const px = img.data;
  for (let i = 0, o = 0; i < values.length; i++, o += 4) {
    const t = index(values[i]);
    if (t < 0) {
      px[o] = inside[0]; px[o + 1] = inside[1]; px[o + 2] = inside[2];
    } else {
      const l = t * 3;
      px[o] = lut[l]; px[o + 1] = lut[l + 1]; px[o + 2] = lut[l + 2];
    }
    px[o + 3] = 255;
  }
  return img;
}

function computeExplorer() {
  const { width: w, height: h } = explorer;
  const view = { ...state.view };
  const job = { view, w, h, field: new Float32Array(w * h), canvas: document.createElement('canvas') };
  job.canvas.width = w;
  job.canvas.height = h;
  const jctx = job.canvas.getContext('2d');
  pending = job;
  const grid = {
    x0: view.cx - (w / 2) * view.scale,
    y0: view.cy + (h / 2) * view.scale,
    ux: view.scale, uy: 0,
    vx: 0, vy: -view.scale,
    cols: w,
    ss: 1,
    maxIter: state.maxIter,
  };
  pool.run('explorer', grid, h, Math.max(1, Math.floor(16384 / w)), (r0, r1, out) => {
    job.field.set(out, r0 * w);
    jctx.putImageData(colorize(out, w, r1 - r0), 0, r0);
    requestExplorerDraw();
  }).then(ok => {
    if (!ok) return;
    snap = job.canvas;
    snapView = view;
    field = job.field;
    pending = null;
    if (job.stale) recolorExplorer();
    requestExplorerDraw();
  });
}

function recolorExplorer() {
  if (pending) pending.stale = true;
  if (!field) return;
  snap.getContext('2d').putImageData(colorize(field, snap.width, snap.height), 0, 0);
  requestExplorerDraw();
}

let exFrame = 0;
function requestExplorerDraw() {
  if (exFrame) return;
  exFrame = requestAnimationFrame(() => { exFrame = 0; drawExplorer(); });
}

const sameView = (a, b) => a.cx === b.cx && a.cy === b.cy && a.scale === b.scale;

// Last complete render, transformed into the current view (instant pan/zoom preview),
// with rows of the in-progress render drawn on top as they arrive.
function drawExplorer() {
  const { width: w, height: h } = explorer;
  const v = state.view;
  exCtx.setTransform(1, 0, 0, 1, 0, 0);
  exCtx.fillStyle = state.interior;
  exCtx.fillRect(0, 0, w, h);
  if (snap) {
    const k = snapView.scale / v.scale;
    const tx = (snapView.cx - v.cx) / v.scale + w / 2 - (snap.width / 2) * k;
    const ty = (v.cy - snapView.cy) / v.scale + h / 2 - (snap.height / 2) * k;
    exCtx.setTransform(k, 0, 0, k, tx, ty);
    exCtx.imageSmoothingEnabled = k < 1;
    exCtx.drawImage(snap, 0, 0);
    exCtx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (pending && pending.w === w && pending.h === h && sameView(pending.view, v)) {
    exCtx.drawImage(pending.canvas, 0, 0);
  }
  selector.draw();
}

const selector = new Selector(overlay, {
  getView: () => state.view,
  setView(view, commit) {
    state.view = rememberBox(view);
    requestExplorerDraw();
    if (commit) debounce('explorer', computeExplorer, 80);
    save();
  },
  getSel: () => state.sel,
  setSel(sel, commit) {
    state.sel = sel;
    requestExplorerDraw();
    updateCoords();
    if (commit) {
      updateDepthStats();
      debounce('pattern', computePattern, 50);
    }
    save();
  },
  getDims: () => ({ W: state.stitchW, H: state.stitchH }),
  onSelectModeChange: on => $('selectMode').classList.toggle('on', on),
  isSelVisible: () => state.selVisible,
  getGuide: () => ({ kind: state.guide, orient: state.guideOrient }),
  setSelVisible(on) {
    state.selVisible = on;
    $('selToggle').textContent = on ? 'Hide selection' : 'Show selection';
    requestExplorerDraw();
    save();
  },
});

const toDeg = r => Math.round(((r || 0) * 180) / Math.PI * 10) / 10;

// "center … · width … · rotation … · zoom ×…" for a selection (explorer line and the stitch preview's bottom strip).
function coordsText({ cx, cy, w, rot }, W, H) {
  const h = w * H / W;
  const f = x => x.toPrecision(10);
  return `center ${f(cx)} ${cy < 0 ? '−' : '+'} ${f(Math.abs(cy))}i · width ${w.toExponential(3)} · height ${h.toExponential(3)} · ` +
    `rotation ${toDeg(rot)}° · zoom ×${(3.4 / w).toFixed(1)}`;
}

function updateCoords() {
  const { rot } = state.sel;
  $('coords').textContent = coordsText(state.sel, state.stitchW, state.stitchH);
  if (document.activeElement !== $('selRot')) $('selRot').value = toDeg(rot);
}

// ---------- Pattern ----------

let stitchField = null, stitchKey = '', stitchDims = null, stitchSel = null;
let pattern = null;

const patternView = new PatternView($('stitches'), {
  onHover(h) {
    $('hover').textContent = h ? `col ${h.i + 1}, row ${h.j + 1}: ${h.dmc.brand} ${h.dmc.code} ${h.dmc.name} ·` : '';
  },
  onZoom(z) {
    $('zoomInfo').textContent = z >= 1 ? `${z.toFixed(1)} px/stitch` : `1 px = ${(1 / z).toFixed(1)} stitches`;
  },
  // Fit keeps the pattern clear of floating panels (fullscreen): any visible panel positioned over the preview.
  getFreeRect() {
    const box = $('stitches').getBoundingClientRect();
    const obstacles = [];
    for (const el of new Set([...document.querySelectorAll('.float-bar')].map(b => b.parentElement))) {
      const pos = getComputedStyle(el).position;
      if ((pos !== 'absolute' && pos !== 'fixed') || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom) continue;
      obstacles.push({ x: r.left - box.left - 8, y: r.top - box.top - 8, w: r.width + 16, h: r.height + 16 });
    }
    if (!obstacles.length || !pattern) return null;
    return largestFreeRect({ x: 0, y: 0, w: box.width, h: box.height }, obstacles, pattern.W, pattern.H);
  },
});

// Floating panels moved, hid or appeared: refit the preview if it's still fitted.
function panelsChanged() {
  patternView.refit();
}

function setStatus(text, progress) {
  $('status').textContent = text;
  const bar = $('progress');
  bar.hidden = progress == null;
  if (progress != null) bar.value = progress;
}

function computePattern() {
  if (!state.stitchEnabled) return;
  const { stitchW: W, stitchH: H, supersample: ss, maxIter, sel } = state;
  if (W * H > MAX_STITCHES) {
    pool.cancel('pattern');
    setStatus(`${fmt(W * H)} stitches is too many (max ${fmt(MAX_STITCHES)})`);
    return;
  }
  const key = JSON.stringify([sel, W, H, ss, maxIter]);
  if (key === stitchKey) return buildPattern();

  const grid = { ...selectionGrid(sel, W, H, W, H, maxIter, ss), clean: ss >= 8 };
  const values = new Float32Array(W * H);
  const t0 = performance.now();
  let rowsDone = 0;
  setStatus(`Computing ${fmt(W * H)} stitches…`, 0);
  pool.run('pattern', grid, H, Math.max(1, Math.floor(65536 / (W * ss * ss))), (r0, r1, out) => {
    values.set(out, r0 * W);
    rowsDone += r1 - r0;
    $('progress').value = rowsDone / H;
    const elapsed = (performance.now() - t0) / 1000;
    if (elapsed > 2) {
      const left = elapsed * (H / rowsDone - 1);
      $('status').textContent = `Computing ${fmt(W * H)} stitches${ss >= 8 ? ` (${ss * ss} samples each)` : ''}… ` +
        `${Math.round((rowsDone / H) * 100)}% · ${fmtTime(elapsed)} elapsed · ~${fmtTime(left)} left`;
    }
  }).then(ok => {
    if (!ok) return;
    stitchField = values;
    stitchKey = key;
    stitchSel = sel; // the selection this field was computed from (for the stitched coordinate label)
    stitchDims = { W, H };
    buildPattern();
    setStatus(`${fmt(W * H)} stitches${ss >= 8 ? ` · ${ss * ss} samples each` : ''} · computed in ${fmtTime((performance.now() - t0) / 1000)}`);
  });
}

// ---------- Thread plan: which thread each gradient position becomes ----------
// The gradient (1024 LUT entries) is split into segments; each segment is one thread, whose color is sampled at
// one gradient position. Threads are picked from the gradient itself (every LUT entry counts once), so the choice
// depends only on the colors (stops, inside color, crisp edge, max threads), never on how the depth mapping spreads
// stitches over the gradient (detail balance, bunching, bands, period…): moving those sliders can't swap threads.
// The user can edit the plan in the spectrum view (drag a sample line = resample that thread, drag a segment edge =
// move gradient positions, and so stitches, between neighbours). Edits are stored in state.threadEdit with the
// gradient key they were made for; they apply only while that key matches (so ↶ Back brings them back too).
let planCache = null, planKey = '';
function gradientKey(crispEdge) {
  // Lowercase: save files normalize hex colors, and edits must still match after loading one.
  return JSON.stringify([state.stops.map(c => c.toLowerCase()), state.interior.toLowerCase(), state.mapping === 'cyclic', crispEdge, state.maxColors, state.yarn]);
}

// Automatic segments: nearest thread of the yarn per LUT entry, reduced to maxColors, as runs of equal threads. Runs shorter than
// 3 entries (transition specks) join the neighbour with the closer color, unless they're the thread's only run.
function autoSegments(size, dmcOfLut, insideDmc, hasInside, labOfLut) {
  const weights = new Float64Array(THREADS.length);
  for (let i = 0; i < size; i++) weights[dmcOfLut[i]]++;
  if (!hasInside) weights[insideDmc] += 1e-6; // still a candidate (the coarse sample can miss tiny inside spots)
  const { remap } = pickThreads(weights, state.maxColors, hasInside ? insideDmc : -1);
  let runs = [];
  for (let i = 0; i < size; ) {
    const t = remap[dmcOfLut[i]];
    let j = i;
    while (j < size && remap[dmcOfLut[j]] === t) j++;
    runs.push({ start: i, end: j, thread: t });
    i = j;
  }
  const longest = new Map();
  for (const r of runs) longest.set(r.thread, Math.max(longest.get(r.thread) || 0, r.end - r.start));
  const dE = (a, b) => labDist2(THREAD_LAB[a], THREAD_LAB[b]);
  for (let k = 0; k < runs.length && runs.length > 1; ) {
    const r = runs[k], len = r.end - r.start;
    if (len >= 3 || len >= longest.get(r.thread)) { k++; continue; }
    const prev = runs[k - 1], next = runs[k + 1];
    if (prev && (!next || dE(r.thread, prev.thread) <= dE(r.thread, next.thread))) prev.end = r.end;
    else next.start = r.start;
    runs.splice(k, 1);
  }
  runs = runs.reduce((out, r) => {
    const last = out[out.length - 1];
    if (last && last.thread === r.thread) last.end = r.end; else out.push({ ...r });
    return out;
  }, []);
  // Sample point: the entry in the segment closest to the thread's color.
  for (const r of runs) {
    let bestD = Infinity;
    for (let i = r.start; i < r.end; i++) {
      const d = labDist2(labOfLut(i), THREAD_LAB[r.thread]);
      if (d < bestD) { bestD = d; r.sample = i; }
    }
  }
  return runs;
}

// Stored edit → segments, or null if it doesn't fit (then the automatic plan is used).
// Thread codes are only unique within a yarn (DMC 310 Black vs Pirkka 310 Kuusi); the edit's key includes the yarn.
const codeMaps = {};
const threadByCode = yarn => (codeMaps[yarn] ??= new Map(yarnOf(yarn).ids.map(i => [THREADS[i].code, i])));
function decodeEdit(list, size) {
  if (!Array.isArray(list) || !list.length) return null;
  const segs = [];
  let start = 0;
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    const end = k === list.length - 1 ? size : Math.round(e.end * size);
    const thread = threadByCode(state.yarn).get(String(e.dmc));
    if (!(end > start) || end > size || thread === undefined) return null;
    const sample = Math.min(end - 1, Math.max(start, Math.floor(e.sample * size)));
    segs.push({ start, end, sample, thread, pick: e.pick === true });
    start = end;
  }
  return segs;
}

function threadPlan() {
  const { lut, size, inside, crispEdge } = mapper();
  // No inside points in the selection → don't reserve a thread for them.
  const hasInside = !depthStats || depthStats.insideShare > 0;
  const gKey = gradientKey(crispEdge);
  const edit = state.threadEdit && state.threadEdit.key === gKey ? state.threadEdit.segs : null;
  const key = JSON.stringify([gKey, hasInside, edit]);
  if (planCache && key === planKey) return planCache;
  const yarn = state.yarn;
  const insideDmc = nearestThread(...inside, yarn);
  // Crisp edge: outside stitches may never use the inside thread.
  const outsideThreads = crispEdge ? yarnOf(yarn).ids.filter(i => i !== insideDmc) : null;
  const labOfLut = i => rgbToLab(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
  const dmcOf = i => {
    const t = nearestThread(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2], yarn);
    return crispEdge && t === insideDmc ? nearestThreadLab(labOfLut(i), outsideThreads) : t;
  };
  // Nearest yarn per gradient position (also shown as the spectrum's yarn band).
  const nearestOfLut = new Uint16Array(size);
  for (let i = 0; i < size; i++) nearestOfLut[i] = dmcOf(i);
  const edited = edit ? decodeEdit(edit, size) : null;
  const segs = edited || autoSegments(size, nearestOfLut, insideDmc, hasInside, labOfLut);
  const threadOfLut = new Uint16Array(size);
  for (const sg of segs) threadOfLut.fill(sg.thread, sg.start, sg.end);
  const outside = [...new Set(segs.map(sg => sg.thread))];
  const threads = hasInside && !outside.includes(insideDmc) ? [insideDmc, ...outside] : outside;
  const insideThread = hasInside ? insideDmc : nearestThreadLab(THREAD_LAB[insideDmc], outside);
  planKey = key;
  return (planCache = { lut, size, gKey, segs, threads, insideThread, threadOfLut, nearestOfLut, dmcOf, edited: !!edited });
}

// Apply an edit from the spectrum view to (a copy of) the current segments and store it.
function editThreads(apply, done) {
  const plan = threadPlan();
  const segs = plan.segs.map(sg => ({ ...sg }));
  apply(segs, plan);
  state.threadEdit = {
    key: plan.gKey,
    // pick: the yarn was chosen from the list (not the nearest one to the sample point).
    segs: segs.map(sg => ({ end: sg.end / plan.size, sample: (sg.sample + 0.5) / plan.size, dmc: THREADS[sg.thread].code, ...(sg.pick ? { pick: true } : {}) })),
  };
  drawSpectrum();
  debounce('pattern', computePattern, done ? 0 : 40);
  if (done) save();
}

// ---------- Choosing a band's yarn by hand ----------
// One chip per band (thread segment of the gradient). Clicking one opens a list of the yarn set, nearest first to
// the gradient color at the band's sample point; choosing a yarn stores it as a thread edit (like dragging).
// The list opens inside the panel (not as a popup), so it also works when the panel floats in fullscreen.
let pickerBand = -1;
const rgbCss = ([r, g, b]) => `rgb(${r},${g},${b})`;

function renderBandChips(plan) {
  const box = $('bandChips');
  box.replaceChildren();
  if (pickerBand >= plan.segs.length) { pickerBand = -1; $('bandPicker').hidden = true; }
  plan.segs.forEach((sg, k) => {
    const d = THREADS[sg.thread];
    const manual = !!sg.pick;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'band-chip' + (k === pickerBand ? ' on' : '') + (manual ? ' manual' : '');
    b.innerHTML = `<i style="background:${rgbCss(d.rgb)}"></i>${d.code}`;
    b.title = `Band ${k + 1}: ${d.code} ${d.name}${manual ? ' (chosen by hand)' : ''}. Click to choose the yarn.`;
    b.addEventListener('click', () => openBandPicker(pickerBand === k ? -1 : k));
    box.appendChild(b);
  });
  if (pickerBand >= 0) renderBandPicker(plan);
}

function openBandPicker(k) {
  pickerBand = k;
  $('bandPicker').hidden = k < 0;
  $('bandSearch').value = '';
  drawSpectrum(); // chips and the list
  if (k >= 0 && !matchMedia('(pointer: coarse)').matches) $('bandSearch').focus();
}

function renderBandPicker(plan = threadPlan()) {
  const sg = plan.segs[pickerBand];
  if (!sg) return;
  const { lut, size } = plan;
  const i = sg.sample, lab = rgbToLab(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
  const nearest = plan.dmcOf(i);
  const { crispEdge } = mapper();
  const q = $('bandSearch').value.trim().toLowerCase();
  const cur = THREADS[sg.thread];
  $('bandPickerTitle').innerHTML = `Band ${pickerBand + 1} · sampled at ${((i / size) * 100).toFixed(0)}% <i class="swatch" style="background:rgb(${lut[i * 3]},${lut[i * 3 + 1]},${lut[i * 3 + 2]})"></i> · now <b>${cur.code} ${cur.name}</b>`;
  const rows = yarnOf(state.yarn).ids
    .filter(t => !(crispEdge && t === plan.insideThread)) // crisp edge: the inside thread stays the inside's own
    .filter(t => !q || `${THREADS[t].code} ${THREADS[t].name}`.toLowerCase().includes(q))
    .map(t => [t, Math.sqrt(labDist2(lab, THREAD_LAB[t]))])
    .sort((a, b) => a[1] - b[1]);
  const list = $('bandPickerList');
  list.replaceChildren(...rows.map(([t, dE]) => {
    const d = THREADS[t];
    const b = document.createElement('button');
    b.type = 'button';
    if (t === sg.thread) b.className = 'on';
    b.title = `${d.code} ${d.name} · ΔE ${dE.toFixed(1)} from the gradient color here${t === nearest ? ' (the automatic choice)' : ''}`;
    b.innerHTML = `<i style="background:${rgbCss(d.rgb)}"></i><span><b>${d.code}</b> ${d.name}</span><em>${t === nearest ? 'auto' : dE.toFixed(0)}</em>`;
    b.addEventListener('click', () => {
      const k = pickerBand;
      editThreads(segs => { segs[k].thread = t; segs[k].pick = true; }, true);
    });
    return b;
  }));
}

function resetThreads() {
  state.threadEdit = false;
  drawSpectrum();
  debounce('pattern', computePattern, 0);
  save();
}

// ---------- Label in stitches ----------

const LABEL_DEFAULT = { on: true, text: '', font: 7, pos: 'br', size: 1, fg: 'auto', bg: 'auto', bgMode: 'outline' };
const labelOpts = () => (state.label = { ...LABEL_DEFAULT, ...state.label });
const lightness = t => THREAD_LAB[t][0];

// Resolve a label thread setting ('auto' or a code) to one of the pattern's threads, so the label adds no new yarn.
function labelThread(setting, threads, lightest) {
  const t = setting !== 'auto' ? threadByCode(state.yarn).get(setting) : undefined;
  if (t !== undefined && threads.includes(t)) return t;
  return threads.reduce((a, b) => ((lightness(b) > lightness(a)) === lightest ? b : a));
}

function stampPatternLabel(indices, W, H, threads) {
  const o = labelOpts();
  const info = $('labelInfo');
  if (!o.on || !threads.length) { info.textContent = o.on ? '' : 'Off'; return; }
  const text = o.text.trim() || coordinateLabel(stitchSel || state.sel);
  const fg = labelThread(o.fg, threads, true), bg = labelThread(o.bg, threads, false);
  const r = stampLabel(indices, W, H, { text, font: o.font, pos: o.pos, size: o.size, fg, bg, bgMode: o.bgMode });
  if (!r) { info.textContent = 'No text to stitch'; return; }
  const name = t => `${THREADS[t].code} ${THREADS[t].name}`;
  info.textContent = `“${text}” · ${r.w} × ${r.h} stitches at column ${r.x + 1}, row ${r.y + 1} · ${name(fg)}` +
    (o.bgMode === 'none' ? '' : ` on ${name(bg)}`) +
    (r.size < o.size ? ` · shrunk to ${r.size}× to fit` : '') + (r.clipped ? ' · too long, clipped at the edge' : '');
}

// Thread choices for the label: the pattern's threads (so no extra yarn), lightest first.
let labelThreadsKey = '';
function fillLabelThreads(threads) {
  const key = state.yarn + threads.join(',');
  if (key === labelThreadsKey) return;
  labelThreadsKey = key;
  const o = labelOpts();
  const sorted = [...threads].sort((a, b) => lightness(b) - lightness(a));
  for (const [id, auto, value] of [['labelFg', 'Auto (lightest thread)', o.fg], ['labelBg', 'Auto (darkest thread)', o.bg]]) {
    const sel = $(id);
    sel.replaceChildren(new Option(auto, 'auto'), ...sorted.map(t => new Option(`${THREADS[t].code} ${THREADS[t].name}`, THREADS[t].code)));
    sel.value = [...sel.options].some(op => op.value === value) ? value : 'auto';
  }
}

function initLabel() {
  const o = labelOpts();
  $('labelOn').checked = o.on;
  $('labelText').value = o.text;
  $('labelPos').value = o.pos;
  $('labelSize').value = String(o.size);
  $('labelFont').value = String(o.font);
  $('labelBgMode').value = o.bgMode;
  const changed = () => { debounce('pattern', computePattern, 0); save(); };
  const bind = (id, key, ev, conv = v => v) => $(id).addEventListener(ev, e => {
    labelOpts()[key] = e.target.type === 'checkbox' ? e.target.checked : conv(e.target.value);
    changed();
  });
  bind('labelOn', 'on', 'change');
  bind('labelPos', 'pos', 'change');
  bind('labelSize', 'size', 'change', Number);
  bind('labelFont', 'font', 'change', Number);
  bind('labelFg', 'fg', 'change');
  bind('labelBg', 'bg', 'change');
  bind('labelBgMode', 'bgMode', 'change');
  $('labelText').addEventListener('input', e => {
    labelOpts().text = e.target.value.slice(0, 120);
    debounce('pattern', computePattern, 200);
    save();
  });
}

// 10-point blocks on the fixed 2 × 2 grid (from the top-left): t[block] = thread if all 4 cells share it, else -1.
// Islands, i.e. groups of same-thread big stitches connected by an edge or a corner (8-neighbours), of at most
// `islandMax` stitches go back to 20-point: isolated big stitches are fiddly to stitch between small ones.
function tenPointBlocks(indices, W, H, islandMax) {
  const BW = W >> 1, BH = H >> 1, n = BW * BH;
  const t = new Int32Array(n).fill(-1);
  for (let by = 0; by < BH; by++) {
    for (let bx = 0; bx < BW; bx++) {
      const c = by * 2 * W + bx * 2, v = indices[c];
      if (indices[c + 1] === v && indices[c + W] === v && indices[c + W + 1] === v) t[by * BW + bx] = v;
    }
  }
  let split = 0, splitBlocks = 0;
  if (islandMax > 0) {
    const seen = new Uint8Array(n), stack = new Int32Array(n), comp = [];
    for (let b0 = 0; b0 < n; b0++) {
      if (seen[b0] || t[b0] < 0) continue;
      const v = t[b0];
      comp.length = 0;
      let sp = 0;
      stack[sp++] = b0;
      seen[b0] = 1;
      while (sp) {
        const b = stack[--sp];
        comp.push(b);
        const bx = b % BW, by = (b / BW) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const y = by + dy;
          if (y < 0 || y >= BH) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const x = bx + dx;
            if (x < 0 || x >= BW) continue;
            const nb = y * BW + x;
            if (!seen[nb] && t[nb] === v) { seen[nb] = 1; stack[sp++] = nb; }
          }
        }
      }
      if (comp.length <= islandMax) {
        for (const b of comp) t[b] = -1;
        split++;
        splitBlocks += comp.length;
      }
    }
  }
  return { BW, BH, t, split, splitBlocks };
}

// Depth → gradient position → thread (from the thread plan).
// Only this part reruns when colors change; the depth field is reused.
function buildPattern() {
  if (!stitchField || !state.stitchEnabled) return;
  const { W, H } = stitchDims;
  const { index, size } = mapper();
  const { threads, threadOfLut, insideThread } = threadPlan();

  const indices = new Uint16Array(W * H);
  const usage = new Float64Array(size); // stitches per gradient position (for the spectrum view)
  for (let k = 0; k < indices.length; k++) {
    const i = index(stitchField[k]);
    if (i >= 0) usage[i]++;
    indices[k] = i < 0 ? insideThread : threadOfLut[i];
  }
  stampPatternLabel(indices, W, H, threads);
  const cnt = new Float64Array(THREADS.length);
  for (let k = 0; k < indices.length; k++) cnt[indices[k]]++;
  // 10-point: same-thread 2 × 2 blocks of the fixed grid become big stitches (see tenPointBlocks); the cells of the
  // other blocks (and of the incomplete blocks at an odd right or bottom edge) are small 20-point stitches.
  const big = new Float64Array(THREADS.length);
  const blocks = state.grosPoint ? tenPointBlocks(indices, W, H, state.islandMax) : null;
  if (blocks) for (const t of blocks.t) if (t >= 0) big[t]++;
  $('islandInfo').textContent = blocks
    ? (blocks.split ? `Split ${blocks.split.toLocaleString()} island${blocks.split === 1 ? '' : 's'} (${blocks.splitBlocks.toLocaleString()} big stitches) into 20-point` : 'No islands split')
    : '';
  // Every chosen thread is listed, also those the mapping doesn't reach (0 stitches, flagged in the list).
  const counts = new Map();
  const onGradient = new Set(threadOfLut);
  for (const t of threads) if (onGradient.has(t) || cnt[t] > 0) counts.set(t, cnt[t]);
  // Palette position of each final thread: where its longest run of gradient (LUT) entries starts.
  // Runs are robust for cyclic gradients, where one thread can appear at both ends. The inside thread goes first.
  const bestRun = new Map(); // thread → [length, start]
  for (let i = 0; i < size; ) {
    const t = threadOfLut[i];
    let j = i;
    while (j < size && threadOfLut[j] === t) j++;
    const prev = bestRun.get(t);
    if (!prev || j - i > prev[0]) bestRun.set(t, [j - i, i]);
    i = j;
  }
  const palettePos = new Map();
  for (const t of counts.keys()) {
    palettePos.set(t, t === insideThread || !bestRun.has(t) ? -1 : bestRun.get(t)[1]);
  }
  // Per thread: cells (area), big (10-point) and small (20-point) stitches.
  const stitches = new Map([...counts.keys()].map(t => [t, { big: big[t], small: cnt[t] - 4 * big[t] }]));
  pattern = { W, H, indices, counts, stitches, palettePos, usage, blocks };
  patternView.setPattern(pattern);
  renderThreads();
}

const spectrumView = new SpectrumView($('spectrum'), $('spectrumInfo'), {
  // Click or drag a sample point: that segment's thread becomes the one nearest to the gradient color there.
  onSample(k, pos, done) {
    editThreads((segs, plan) => {
      const sg = segs[k];
      sg.sample = Math.min(sg.end - 1, Math.max(sg.start, pos));
      sg.thread = plan.dmcOf(sg.sample);
      sg.pick = false; // moving the sample point goes back to the nearest yarn
    }, done);
  },
  // Right-click a segment: choose its yarn from the list.
  onPickThread(k) { openBandPicker(k); },
  // Drag the edge between segments k−1 and k: gradient positions (and their stitches) change thread.
  onBoundary(k, pos, done) {
    editThreads(segs => { segs[k - 1].end = segs[k].start = Math.min(segs[k].sample, Math.max(segs[k - 1].sample + 1, pos)); }, done);
  },
});
function drawSpectrum() {
  const plan = threadPlan();
  fillLabelThreads(plan.threads);
  renderBandChips(plan);
  spectrumView.set(plan, state.stitchEnabled ? pattern : null, pattern ? patternView.highlight : null);
  $('threadsAuto').disabled = !plan.edited;
  $('threadsAuto').textContent = plan.edited ? '↺ Auto threads (edited)' : 'Auto threads';
}

function renderThreads() {
  drawSpectrum();
  const order = state.legendSort === 'palette'
    ? (a, b) => pattern.palettePos.get(a[0]) - pattern.palettePos.get(b[0])
    : (a, b) => b[1] - a[1];
  const yarn = yarnUse();
  const gros = state.grosPoint;
  $('legendBigHead').textContent = gros ? '10-pt' : 'Stitches';
  $('legendSmallHead').hidden = !gros;
  renderLegend($('legend'), pattern.counts, pattern.W * pattern.H, patternView.highlight, order, t => {
    patternView.setHighlight(t);
    renderThreads();
  }, yarn, pattern.stitches, gros);
  // Totals; balls are bought per color, so round up each thread separately.
  let meters = 0, balls = 0, big = 0, small = 0;
  for (const st of pattern.stitches.values()) {
    const m = yarn.meters(st);
    meters += m;
    big += st.big;
    small += st.small;
    if (m > 0) balls += Math.ceil(m / yarn.mPerBall);
  }
  const fmtN = n => Math.round(n).toLocaleString();
  $('yarnTotal').textContent = (gros ? `${fmtN(big + small)} stitches: ${fmtN(big)} 10-point + ${fmtN(small)} 20-point · ` : '') +
    `Yarn ≈ ${fmtN(meters)} m · ${fmtN(meters * yarn.gPerM)} g · ` +
    `${balls} ball${balls === 1 ? '' : 's'} (${yarnOf(state.yarn).label}, whole balls per color)`;
  const unused = [...pattern.counts.values()].filter(n => n === 0).length;
  $('threadCount').innerHTML = `(${pattern.counts.size} colors${unused ? ` · <span class="alert">${unused} unused</span>` : ''})`;
}

function showYarn() {
  $('legendCodeHead').textContent = yarnOf(state.yarn).label;
  $('yarnAmountName').textContent = yarnOf(state.yarn).label;
  const sp = yarnSpec();
  $('yarnMeters').value = sp.m;
  $('yarnGrams').value = sp.g;
  $('yarnStrands').value = sp.strands;
  $('yarnStrandsBig').value = sp.strandsBig;
  $('yarnExtra').value = sp.extra;
  $('yarnStrandsBigRow').style.display = state.grosPoint ? '' : 'none';
  const y = yarnUse();
  const cm = v => (v * 100).toFixed(2);
  $('yarnPerStitch').textContent = `Off the ball at ${state.density} stitches/cm: ≈ ${cm(y.mSmall)} cm per 20-point stitch` +
    ` (× ${sp.strands} strand)` + (state.grosPoint ? `, ≈ ${cm(y.mBig)} cm per 10-point stitch (2× as long, × ${sp.strandsBig} strands)` : '') +
    ` · diagonal √2·s on the front + s on the back, + ${sp.extra}%`;
}

// Yarn settings of the current yarn (filled in from the defaults for anything missing).
// strands = small (20-point) stitches, strandsBig = big (10-point) stitches; fractions allowed (0.5 = one ply of a
// 2-ply strand, so 1 m off the ball makes 2 m of stitching yarn). Pirkka: half a strand small, doubled big.
const YARN_SPEC_DEFAULTS = {
  dmc: { m: 400, g: 100, strands: 1, strandsBig: 2 },
  pirkka: { m: 400, g: 100, strands: 0.5, strandsBig: 2 },
  rauma: { m: 175, g: 50, strands: 1, strandsBig: 2 },
  // Aran weight (about as thick as Pirkka paksu): one strand even for 10-point stitches.
  novita: { m: 200, g: 100, strands: 1, strandsBig: 1 },
};
const yarnKey = () => (YARN_SPEC_DEFAULTS[state.yarn] ? state.yarn : 'dmc');
function yarnSpec() {
  const key = yarnKey();
  const saved = { ...state.yarnSpec?.[key] };
  // Settings from before the 10-point split: the Pirkka plan is now half a strand for the small stitches.
  if (key === 'pirkka' && saved.strandsBig === undefined) delete saved.strands;
  state.yarnSpec = { ...state.yarnSpec };
  return (state.yarnSpec[key] = { extra: 15, ...YARN_SPEC_DEFAULTS[key], ...saved });
}

// Yarn off the ball per stitch. A half stitch is the front diagonal (√2·s) plus the back step (s), s = stitch size;
// a 10-point stitch covers 2 × 2 cells, so it is twice as long. Times the strands, plus the extra for tails.
function yarnUse() {
  const sp = yarnSpec();
  const s = 0.01 / state.density, f = (Math.SQRT2 + 1) * (1 + sp.extra / 100);
  const mSmall = s * f * sp.strands, mBig = 2 * s * f * sp.strandsBig;
  return { mSmall, mBig, gPerM: sp.g / sp.m, mPerBall: sp.m, meters: st => st.small * mSmall + st.big * mBig };
}

// ---------- Controls ----------

function paletteChanged() {
  mapperCache = null;
  recolorExplorer();
  drawSpectrum();
  debounce('pattern', computePattern, 250);
  save();
}

function renderStops() {
  const box = $('stops');
  box.replaceChildren();
  state.stops.forEach((hex, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'stop';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = hex;
    input.addEventListener('focus', pushHistory, { once: true });
    input.addEventListener('input', () => {
      state.stops[i] = input.value;
      markCustom();
      paletteChanged();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove stop';
    del.addEventListener('click', () => {
      if (state.stops.length <= 1) return;
      pushHistory();
      state.stops.splice(i, 1);
      markCustom();
      renderStops();
      paletteChanged();
    });
    wrap.append(input, del);
    box.appendChild(wrap);
  });
  $('paletteName').textContent = state.preset || 'Custom';
}

function markCustom() {
  if (!state.preset) return;
  state.preset = '';
  $('paletteName').textContent = 'Custom';
  renderGallery();
}

// ---------- Palette library, random generator, history ----------

const paletteHistory = [];

function pushHistory() {
  paletteHistory.push({ stops: [...state.stops], preset: state.preset, period: state.period, offset: state.offset });
  if (paletteHistory.length > 100) paletteHistory.shift();
  $('paletteBack').disabled = $('paletteBack2').disabled = false;
}

function applyPalette({ stops, preset, period, offset }) {
  state.stops = [...stops];
  state.preset = preset;
  if (period != null) state.period = period;
  if (offset != null) state.offset = offset;
  showPeriod();
  $('offset').value = $('offsetOut').textContent = state.offset;
  renderStops();
  renderGallery();
  paletteChanged();
}

const gradientCss = stops =>
  stops.length === 1 ? stops[0] : `linear-gradient(90deg, ${[...stops, stops[0]].join(', ')})`;

function renderGallery() {
  const box = $('gallery');
  box.replaceChildren();
  const groups = [];
  if (state.saved.length) groups.push(['Saved', state.saved.map(p => [p.name, p.stops, true])]);
  for (const [group, list] of Object.entries(PRESET_GROUPS)) {
    groups.push([group, Object.entries(list).map(([name, stops]) => [name, stops, false])]);
  }
  for (const [group, items] of groups) {
    const h = document.createElement('h4');
    h.textContent = group;
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    for (const [name, stops, saved] of items) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile' + (state.preset === name ? ' active' : '');
      tile.title = name;
      tile.innerHTML = `<span class="bar" style="background:${gradientCss(stops)}"></span><span class="name"></span>`;
      tile.querySelector('.name').textContent = name;
      tile.addEventListener('click', () => {
        pushHistory();
        applyPalette({ stops, preset: name });
      });
      if (saved) {
        const del = document.createElement('span');
        del.className = 'del';
        del.textContent = '×';
        del.title = 'Remove from saved';
        del.addEventListener('click', e => {
          e.stopPropagation();
          state.saved = state.saved.filter(p => p.name !== name);
          renderGallery();
          save();
        });
        tile.appendChild(del);
      }
      tiles.appendChild(tile);
    }
    box.append(h, tiles);
  }
  $('presetCount').textContent = `(${Object.keys(PRESETS).length + state.saved.length})`;
}

let randomCount = 0;
function randomize() {
  const { style, stops } = generatePalette($('genStyle').value);
  pushHistory();
  const cyclic = $('genCycle').checked && state.mapping === 'cyclic';
  applyPalette({
    stops,
    preset: `${STYLES[style].label.replace(/ \(.*\)$/, '')} #${++randomCount}`,
    period: cyclic ? Math.round(Math.exp(Math.log(4) + Math.random() * (Math.log(400) - Math.log(4)))) : null,
    offset: cyclic ? Math.round(Math.random() * 100) / 100 : null,
  });
}

function initPalette() {
  const styleSel = $('genStyle');
  for (const [key, { label }] of Object.entries(STYLES)) styleSel.add(new Option(label, key));
  styleSel.value = state.genStyle;
  styleSel.addEventListener('change', () => { state.genStyle = styleSel.value; save(); });
  $('genCycle').checked = state.genCycle;
  $('genCycle').addEventListener('change', e => { state.genCycle = e.target.checked; save(); });
  $('generate').addEventListener('click', randomize);
  $('generate2').addEventListener('click', randomize);
  $('paletteBack2').addEventListener('click', () => $('paletteBack').click());
  document.addEventListener('keydown', e => {
    if (e.key !== 'g' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return;
    randomize();
  });

  $('paletteBack').disabled = $('paletteBack2').disabled = true;
  $('paletteBack').addEventListener('click', () => {
    const prev = paletteHistory.pop();
    if (prev) applyPalette(prev);
    $('paletteBack').disabled = $('paletteBack2').disabled = !paletteHistory.length;
  });
  $('savePalette').addEventListener('click', () => {
    let name = state.preset || 'Custom';
    const taken = new Set([...state.saved.map(p => p.name), ...Object.keys(PRESETS)]);
    for (let n = 2; taken.has(name); n++) name = `${state.preset || 'Custom'} (${n})`;
    state.saved.unshift({ name, stops: [...state.stops] });
    state.preset = name;
    renderStops();
    renderGallery();
    save();
  });

  $('addStop').addEventListener('click', () => {
    pushHistory();
    const last = hexToRgb(state.stops[state.stops.length - 1]);
    state.stops.push('#' + last.map(c => (255 - c).toString(16).padStart(2, '0')).join(''));
    markCustom();
    renderStops();
    paletteChanged();
  });
  $('reverseStops').addEventListener('click', () => {
    pushHistory();
    state.stops.reverse();
    markCustom();
    renderStops();
    paletteChanged();
  });
  renderStops();
  renderGallery();
}

// Number inputs commit on 'change' (Enter / blur) so typing "4680" doesn't compute 4, 46, 468…
// Range sliders update live on 'input'.
function bindNumber(id, key, { min, max, int = true, onChange }) {
  const el = $(id);
  const out = $(id + 'Out');
  el.value = state[key];
  if (out) out.textContent = state[key];
  el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    let v = int ? parseInt(el.value, 10) : parseFloat(el.value);
    if (!Number.isFinite(v)) { el.value = state[key]; return; }
    v = Math.min(max, Math.max(min, v));
    el.value = state[key] = v;
    if (out) out.textContent = v;
    onChange();
    save();
  });
}

// Iterations per cycle: logarithmic slider (1 – 1,000,000) paired with an exact number box.
const PERIOD_MIN = 1, PERIOD_MAX = 1000000;
const periodToSlider = p => Math.round((1000 * Math.log(p / PERIOD_MIN)) / Math.log(PERIOD_MAX / PERIOD_MIN));
const sliderToPeriod = v => {
  const p = PERIOD_MIN * Math.pow(PERIOD_MAX / PERIOD_MIN, v / 1000);
  return p < 20 ? Math.round(p * 10) / 10 : Math.round(p); // finer steps at the low end
};

function showPeriod() {
  $('period').value = periodToSlider(state.period);
  $('periodNum').value = state.period;
}

function initPeriod() {
  showPeriod();
  $('period').addEventListener('input', () => {
    state.period = sliderToPeriod(+$('period').value);
    $('periodNum').value = state.period;
    paletteChanged();
  });
  $('periodNum').addEventListener('change', () => {
    const v = parseFloat($('periodNum').value);
    if (Number.isFinite(v)) state.period = Math.min(PERIOD_MAX, Math.max(PERIOD_MIN, v));
    showPeriod();
    paletteChanged();
  });
}

// Max iterations ("calculation depth"): explorer header box + stitch panel log slider/box, all in sync.
const ITER_MIN = 20, ITER_MAX = 1000000;
const iterToSlider = v => Math.round((1000 * Math.log(v / ITER_MIN)) / Math.log(ITER_MAX / ITER_MIN));
// Round slider values to ~2 significant digits (5, 10, 50, 100… steps) so they read cleanly.
const sliderToIter = x => {
  const v = ITER_MIN * Math.pow(ITER_MAX / ITER_MIN, x / 1000);
  const step = Math.pow(10, Math.floor(Math.log10(v)) - 1) * (v < 200 ? 0.5 : 1);
  return Math.min(ITER_MAX, Math.max(ITER_MIN, Math.round(v / step) * step));
};

function showDepth(v = state.maxIter) {
  $('maxIter').value = v;
  $('depthNum').value = v;
  $('depthSlider').value = iterToSlider(v);
}

function setMaxIter(v) {
  v = Math.round(Math.min(ITER_MAX, Math.max(ITER_MIN, v)));
  showDepth(v);
  if (v === state.maxIter) return;
  state.maxIter = v;
  mapperCache = null;
  updateDepthStats();
  computeExplorer();
  debounce('pattern', computePattern, 100);
  save();
}

function initDepth() {
  showDepth();
  const fromBox = el => () => {
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) setMaxIter(v); else showDepth();
  };
  $('maxIter').addEventListener('change', fromBox($('maxIter')));
  $('depthNum').addEventListener('change', fromBox($('depthNum')));
  // Dragging only previews the number; releasing the slider recomputes.
  $('depthSlider').addEventListener('input', () => {
    const v = sliderToIter(+$('depthSlider').value);
    $('depthNum').value = $('maxIter').value = v;
  });
  $('depthSlider').addEventListener('change', () => setMaxIter(sliderToIter(+$('depthSlider').value)));
}

function updateMappingVisibility() {
  for (const el of document.querySelectorAll('.cyclic-only')) {
    el.style.display = state.mapping === 'cyclic' ? '' : 'none';
  }
  const cyclic = state.mapping === 'cyclic';
  const fittable = state.mapping === 'linear' || state.mapping === 'log';
  $('fitRangeRow').style.display = fittable ? '' : 'none';
  $('edgeWidthRow').style.display = state.mapping === 'edge' ? '' : 'none';
  $('detailBalanceRow').style.display = state.mapping === 'spectrum' ? '' : 'none';
  $('bunchRow').style.display = cyclic ? 'none' : '';
  $('periodRow').style.display = cyclic || (fittable && !state.fitRange) ? '' : 'none';
  $('periodLabel').textContent = cyclic ? 'Iterations per cycle' : 'Gradient length (iterations)';
}

// ---------- Size: stitches per cm × cm ↔ stitches ----------

const clampStitches = v => Math.min(20000, Math.max(5, Math.round(v)));
const round1 = v => Math.round(v * 10) / 10;

function showSize() {
  const { stitchW: W, stitchH: H, density } = state;
  $('stitchW').value = W;
  $('stitchH').value = H;
  $('cmW').value = round1(W / density);
  $('cmH').value = round1(H / density);
  $('density').value = density;
  const total = W * H;
  $('sizeInfo').textContent =
    `${fmt(W)} × ${fmt(H)} = ${fmt(total)} stitches · ${round1(W / density)} × ${round1(H / density)} cm` +
    (total > MAX_STITCHES ? ` · too many to compute (max ${fmt(MAX_STITCHES)})` : '');
}

function setStitches(W, H) {
  state.stitchW = clampStitches(W);
  state.stitchH = clampStitches(H);
  showSize();
  requestExplorerDraw();
  updateCoords();
  updateDepthStats();
  debounce('pattern', computePattern, 100);
  save();
}

function initSize() {
  const num = id => parseFloat($(id).value);
  $('stitchW').addEventListener('change', () => setStitches(num('stitchW') || state.stitchW, state.stitchH));
  $('stitchH').addEventListener('change', () => setStitches(state.stitchW, num('stitchH') || state.stitchH));
  $('cmW').addEventListener('change', () => setStitches((num('cmW') || 1) * state.density, state.stitchH));
  $('cmH').addEventListener('change', () => setStitches(state.stitchW, (num('cmH') || 1) * state.density));
  $('density').addEventListener('change', () => {
    const d = Math.min(100, Math.max(1, num('density') || state.density));
    const cmW = state.stitchW / state.density, cmH = state.stitchH / state.density;
    state.density = d;
    showYarn(); // yarn per stitch depends on the stitch size
    setStitches(cmW * d, cmH * d);
  });
  showSize();
}

function download(canvas, name) {
  canvas.toBlob(blob => {
    if (!blob) return setStatus('Export failed: image too large for this browser');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

function initControls() {
  initPalette();
  initSize();

  $('mapping').value = state.mapping;
  $('mapping').addEventListener('change', e => {
    state.mapping = e.target.value;
    updateMappingVisibility();
    paletteChanged();
  });
  $('fitRange').checked = state.fitRange;
  $('fitRange').addEventListener('change', e => {
    state.fitRange = e.target.checked;
    updateMappingVisibility();
    paletteChanged();
  });
  updateMappingVisibility();

  initPeriod();
  const showEdgeWidth = () => {
    $('edgeWidth').value = Math.round(state.edgeWidth * 100);
    const g = Math.pow(4, -state.edgeWidth);
    $('edgeWidthOut').textContent = state.edgeWidth === 0 ? 'balanced' : (state.edgeWidth > 0 ? 'wider ' : 'narrower ') + `(γ ${g < 1 ? g.toFixed(3) : g.toFixed(1)})`;
  };
  const showBunch = () => {
    $('bunch').value = Math.round(state.bunch * 100);
    const pct = Math.round(Math.abs(state.bunch) * 100);
    $('bunchOut').textContent = state.bunch === 0 ? 'even' : `${pct}% toward ${state.bunch > 0 ? 'edge' : 'outside'}`;
  };
  // Slider with a snap-to-center dead zone and double-click reset.
  const bindCentered = (id, key, scale, show) => {
    show();
    $(id).addEventListener('input', () => {
      let v = +$(id).value / 100;
      if (Math.abs(v) < 0.04 * scale) v = 0;
      state[key] = v;
      show();
      paletteChanged();
    });
    $(id).addEventListener('dblclick', () => { state[key] = 0; show(); paletteChanged(); });
  };
  bindCentered('edgeWidth', 'edgeWidth', 2, showEdgeWidth);
  bindCentered('bunch', 'bunch', 1, showBunch);
  const showDetail = () => {
    $('detailBalance').value = Math.round(state.detailBalance * 100);
    const d = state.detailBalance;
    $('detailBalanceOut').textContent = d === 0 ? 'by area (balanced)' : d === 1 ? 'by depth (log)' : `${Math.round(d * 100)}% toward depth`;
  };
  showDetail();
  $('detailBalance').addEventListener('input', () => {
    state.detailBalance = +$('detailBalance').value / 100;
    showDetail();
    paletteChanged();
  });
  $('detailBalance').addEventListener('dblclick', () => { state.detailBalance = 0.5; showDetail(); paletteChanged(); });
  bindNumber('offset', 'offset', { min: 0, max: 1, int: false, onChange: paletteChanged });
  bindNumber('bands', 'bands', { min: 0, max: 64, onChange: paletteChanged });
  initDepth();
  bindNumber('maxColors', 'maxColors', { min: 2, max: 80, onChange: () => debounce('pattern', computePattern, 50) });

  $('threadsAuto').addEventListener('click', resetThreads);
  $('bandSearch').addEventListener('input', () => renderBandPicker());
  $('bandPickerClose').addEventListener('click', () => openBandPicker(-1));
  $('bandSearch').addEventListener('keydown', e => { if (e.key === 'Escape') openBandPicker(-1); });
  initLabel();
  $('yarn').value = yarnKey();
  showYarn();
  const bindYarn = (id, key, min, max, int) => $(id).addEventListener('change', () => {
    let v = parseFloat($(id).value);
    const sp = yarnSpec();
    if (Number.isFinite(v)) sp[key] = Math.min(max, Math.max(min, int ? Math.round(v) : v));
    showYarn();
    if (pattern) renderThreads();
    save();
  });
  bindYarn('yarnMeters', 'm', 1, 100000);
  bindYarn('yarnGrams', 'g', 1, 10000);
  bindYarn('yarnStrands', 'strands', 0.25, 12);
  bindYarn('yarnStrandsBig', 'strandsBig', 0.25, 12);
  bindYarn('yarnExtra', 'extra', 0, 200);
  $('yarn').addEventListener('change', e => {
    state.yarn = e.target.value;
    showYarn();
    drawSpectrum();
    debounce('pattern', computePattern, 0);
    save();
  });
  $('interior').value = state.interior;
  $('interior').addEventListener('input', e => { state.interior = e.target.value; paletteChanged(); });

  $('supersample').value = state.supersample;
  $('supersample').addEventListener('change', e => {
    state.supersample = +e.target.value;
    debounce('pattern', computePattern, 0);
    save();
  });

  $('grid').checked = state.grid;
  patternView.setGrid(state.grid);
  $('grid').addEventListener('change', e => { state.grid = e.target.checked; patternView.setGrid(state.grid); save(); });
  $('grosPoint').checked = state.grosPoint;
  patternView.setGros(state.grosPoint);
  $('grosPoint').addEventListener('change', e => {
    state.grosPoint = e.target.checked;
    patternView.setGros(state.grosPoint);
    showYarn();
    debounce('pattern', computePattern, 0); // recount 10-point / 20-point stitches
    save();
  });
  $('islandMax').value = state.islandMax;
  $('islandMax').addEventListener('change', () => {
    const v = parseInt($('islandMax').value, 10);
    state.islandMax = Number.isFinite(v) ? Math.min(1000, Math.max(0, v)) : state.islandMax;
    $('islandMax').value = state.islandMax;
    debounce('pattern', computePattern, 0);
    save();
  });
  $('fitPreview').addEventListener('click', () => patternView.fit());
  $('stitchZoom').addEventListener('click', () => patternView.zoomCenter(16));

  $('zoomSel').addEventListener('click', () => {
    const { cx, cy, w, rot = 0 } = state.sel;
    const h = w * state.stitchH / state.stitchW;
    // Bounding box of the rotated rectangle.
    const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    const bw = w * c + h * sn, bh = w * sn + h * c;
    const scale = Math.max(bw / explorer.width, (bh + 60 * (bw / explorer.width)) / explorer.height) / 0.8;
    selector.api.setView({ cx, cy, scale }, true);
  });
  $('resetView').addEventListener('click', () => selector.api.setView(fitView(), true));
  $('selectMode').addEventListener('click', () => selector.setSelectMode(!selector.selectMode));
  const setRot = deg => {
    const r = (((deg + 180) % 360 + 360) % 360 - 180) * Math.PI / 180;
    selector.api.setSel({ ...state.sel, rot: r }, true);
  };
  $('selRot').addEventListener('change', () => {
    const v = parseFloat($('selRot').value);
    if (Number.isFinite(v)) setRot(v); else updateCoords();
  });
  $('selRot').addEventListener('dblclick', () => setRot(0));
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (selector.selectMode) selector.setSelectMode(false);
      else if (state.selVisible) selector.api.setSelVisible(false);
    } else if (e.key === 'h' || e.key === 'H') {
      // H toggles the selection; works in fullscreen, where the browser keeps Esc for itself.
      selector.api.setSelVisible(!state.selVisible);
    }
  });
  $('selToggle').addEventListener('click', () => selector.api.setSelVisible(!state.selVisible));
  selector.api.setSelVisible(state.selVisible);

  $('exportFull').addEventListener('click', () => {
    if (!pattern) return;
    try {
      download(patternView.fullCanvas(), `mandelbrot-${pattern.W}x${pattern.H}-1px-per-stitch.png`);
    } catch {
      setStatus('Export failed: image too large for this browser');
    }
  });
  $('exportView').addEventListener('click', () => download($('stitches'), 'mandelbrot-stitch-view.png'));
}

// ---------- Framing guides ----------

const GUIDE_KEYS = GUIDES.map(([k]) => k);
function applyGuide() {
  if (!GUIDE_KEYS.includes(state.guide)) state.guide = 'none';
  for (const sel of document.querySelectorAll('.guide-select')) sel.value = state.guide;
  for (const b of document.querySelectorAll('.guide-orient')) b.hidden = !ORIENTED.has(state.guide);
  patternView.setGuide(state.guide, state.guideOrient);
  requestExplorerDraw();
  save();
}

function initGuides() {
  for (const sel of document.querySelectorAll('.guide-select')) {
    for (const [key, label] of GUIDES) sel.add(new Option(label, key));
    sel.addEventListener('change', () => { state.guide = sel.value; applyGuide(); });
  }
  for (const b of document.querySelectorAll('.guide-orient')) {
    b.addEventListener('click', () => { state.guideOrient = (state.guideOrient + 1) % 4; applyGuide(); });
  }
  // F cycles the guides, Shift+F turns the spiral / triangles (works in fullscreen too).
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.shiftKey) state.guideOrient = (state.guideOrient + 1) % 4;
    else state.guide = GUIDE_KEYS[(GUIDE_KEYS.indexOf(state.guide) + 1) % GUIDE_KEYS.length];
    applyGuide();
  });
  applyGuide();
}

// ---------- Stitch preview on/off ----------

function initStitchEnabled() {
  const box = $('stitchEnabled');
  const apply = () => {
    $('stitchOff').hidden = state.stitchEnabled;
    if (state.stitchEnabled) {
      computePattern();
    } else {
      clearTimeout(timers.pattern);
      pool.cancel('pattern');
      setStatus('Off');
    }
  };
  box.checked = state.stitchEnabled;
  box.addEventListener('change', () => {
    state.stitchEnabled = box.checked;
    apply();
    save();
  });
  $('stitchOff').hidden = state.stitchEnabled;
  if (!state.stitchEnabled) setStatus('Off');
}

// ---------- Stitch look + color panel toggles ----------

function initLegendSort() {
  const buttons = document.querySelectorAll('#legendSort [data-sort]');
  const apply = () => {
    for (const b of buttons) b.classList.toggle('on', b.dataset.sort === state.legendSort);
    if (pattern) renderThreads();
  };
  for (const b of buttons) b.addEventListener('click', () => { state.legendSort = b.dataset.sort; apply(); save(); });
  apply();
}

function initLookToggle() {
  const buttons = document.querySelectorAll('.seg [data-look]');
  const apply = () => {
    for (const b of buttons) b.classList.toggle('on', b.dataset.look === state.stitchLook);
    patternView.setLook(state.stitchLook);
  };
  for (const b of buttons) {
    b.addEventListener('click', () => { state.stitchLook = b.dataset.look; apply(); save(); });
  }
  apply();
}

function setColorsOpen(open) {
  state.colorsOpen = open;
  $('app').classList.toggle('colors-closed', !open);
  $('colorPanel').classList.toggle('closed', !open);
  for (const b of document.querySelectorAll('.colors-btn')) b.classList.toggle('on', open);
  requestAnimationFrame(panelsChanged);
  save();
}

// ---------- Fullscreen with floating controls ----------

function initFullscreen() {
  const current = () => document.fullscreenElement || document.webkitFullscreenElement;
  const colorPanel = $('colorPanel');
  const home = { parent: colorPanel.parentElement, next: colorPanel.nextElementSibling };
  const spectrumPanel = $('spectrumPanel');
  const spectrumHome = { parent: spectrumPanel.parentElement, next: spectrumPanel.nextElementSibling };

  for (const btn of document.querySelectorAll('.fs-btn')) {
    const stage = $(btn.dataset.stage);
    btn.addEventListener('click', () => {
      if (current() === stage) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage);
    });
  }
  for (const btn of document.querySelectorAll('.colors-btn')) {
    btn.addEventListener('click', () => setColorsOpen(!state.colorsOpen));
  }

  const floating = [...document.querySelectorAll('.float-bar')].map(bar => bar.parentElement);
  const onChange = () => {
    const fs = current();
    for (const btn of document.querySelectorAll('.fs-btn')) {
      btn.textContent = fs && fs.id === btn.dataset.stage ? '✕ Exit fullscreen' : '⛶ Fullscreen';
    }
    // The color panel follows the fullscreen view so it can be used in either one.
    if (fs) fs.appendChild(colorPanel);
    else home.parent.insertBefore(colorPanel, home.next);
    // The thread spectrum floats in either fullscreen view too (it lives in the stitch card otherwise).
    if (fs && !fs.contains(spectrumHome.parent)) fs.appendChild(spectrumPanel);
    else spectrumHome.parent.insertBefore(spectrumPanel, spectrumHome.next);
    // Floating panels start at their default spot, expanded, each time.
    for (const el of floating) {
      el.classList.remove('collapsed');
      el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.width = el.dataset.width = '';
      el.querySelector('.float-hide').textContent = 'Hide';
    }
    requestAnimationFrame(panelsChanged);
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);

  for (const el of floating) {
    const hide = el.querySelector('.float-hide');
    hide.addEventListener('click', () => {
      const collapsed = el.classList.toggle('collapsed');
      hide.textContent = collapsed ? 'Show' : 'Hide';
      // A width fixed by dragging would keep the collapsed bar wide; park it until the panel opens again.
      if (collapsed) { el.dataset.width = el.style.width; el.style.width = ''; } else el.style.width = el.dataset.width || '';
      panelsChanged();
    });
    // Drag the floating panel by its grip.
    const grip = el.querySelector('.grip');
    grip.addEventListener('pointerdown', e => {
      grip.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
      if (!el.classList.contains('collapsed')) el.style.width = el.offsetWidth + 'px'; // panels sized by left + right would otherwise shrink when right goes
      el.style.right = el.style.bottom = 'auto';
      const move = ev => {
        const maxL = window.innerWidth - 60, maxT = window.innerHeight - 30;
        el.style.left = Math.min(maxL, Math.max(0, start.left + ev.clientX - start.x)) + 'px';
        el.style.top = Math.min(maxT, Math.max(0, start.top + ev.clientY - start.y)) + 'px';
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        panelsChanged();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }
}

// ---------- Save / load settings (JSON files on disk) ----------

function fileMessage(text, isError = false) {
  const el = $('fileMsg');
  el.textContent = text;
  el.style.color = isError ? 'var(--accent)' : '';
  clearTimeout(fileMessage.t);
  fileMessage.t = setTimeout(() => { el.textContent = ''; }, 12000);
}

// File name part from the user's name: keep letters (also ä, ö…), digits, spaces and - _ . ( ); drop characters
// that file systems reject.
const fileSafe = name => name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 80);
const saveStamp = () => {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};
const saveFileName = (name, kind = saveKind) =>
  `${fileSafe(name)}${kind === 'chart' ? ' - stitch chart' : ''} - ${state.stitchW}x${state.stitchH} - ${saveStamp()}.json`;

// 💾 Save / Cmd+S and 🧵 Final export: ask for a name first (required), then download.
let saveKind = 'save'; // 'save' = settings file, 'chart' = final stitch-by-stitch export
function openSaveDialog(kind = 'save') {
  const dlg = $('saveDialog');
  if (dlg.open) return;
  if (kind === 'chart' && !pattern) return fileMessage('No stitch pattern yet: turn on the stitch preview and let it compute first', true);
  saveKind = kind;
  $('saveDialogTitle').textContent = kind === 'chart' ? '🧵 Final export: stitch chart' : '💾 Save settings';
  $('saveDialogNote').textContent = kind === 'chart'
    ? `Every stitch of the ${pattern.W} × ${pattern.H} pattern, the 10-point blocks, the thread list, and the settings (load this file to continue editing).`
    : '';
  $('saveConfirm').textContent = kind === 'chart' ? 'Export' : 'Save';
  const input = $('saveNameInput');
  input.value = '';
  $('saveNameList').replaceChildren(...(state.saveName ? [new Option(state.saveName)] : []));
  updateSavePreview();
  dlg.showModal();
  input.focus();
}

function updateSavePreview() {
  const name = fileSafe($('saveNameInput').value);
  $('saveConfirm').disabled = !name;
  $('saveFilePreview').textContent = name ? saveFileName(name) : 'A name is required.';
}

// ---------- Final export: stitch chart ----------
// Everything needed to stitch the piece, stitch by stitch, plus the settings to get back to editing:
//   threads: one entry per thread, with a one-character symbol, the yarn, code, name, preview color and amounts;
//   rows: H strings of W symbols (row 0 = top, column 0 = left), the thread of every cell;
//   tenPointRows: the fixed 2 × 2 block grid from the top-left, BH strings of BW characters: a symbol = one big
//     10-point stitch over that block, '.' = the block's 4 cells are 20-point stitches (as in rows);
//   settings: the save file (📂 Load accepts the chart and restores it).
const CHART_FORMAT = 'mandelbrot-stitch-chart';
// Symbols in order of use: letters and digits first, then punctuation; never '.' (the "20-point block" marker).
const CHART_SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@^~<>()[]{}!|:;/-_,';
function exportChart(name) {
  if (!pattern) return;
  state.saveName = name.trim().slice(0, 80);
  save();
  const { W, H, indices, counts, stitches, blocks } = pattern;
  const yarn = yarnUse();
  const order = [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t); // most used first
  const symbol = new Map(order.map((t, k) => [t, CHART_SYMBOLS[k] ?? '?']));
  const hex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  const threads = order.map(t => {
    const st = stitches.get(t), m = yarn.meters(st);
    return {
      symbol: symbol.get(t), yarn: THREADS[t].brand, code: THREADS[t].code, name: THREADS[t].name, color: hex(THREADS[t].rgb),
      cells: counts.get(t), stitches10pt: st.big, stitches20pt: st.small,
      meters: Math.round(m * 10) / 10, grams: Math.round(m * yarn.gPerM * 10) / 10,
    };
  });
  const rows = [];
  for (let j = 0; j < H; j++) {
    let row = '';
    for (let i = 0; i < W; i++) row += symbol.get(indices[j * W + i]);
    rows.push(row);
  }
  const tenPointRows = [];
  if (blocks) {
    for (let by = 0; by < blocks.BH; by++) {
      let row = '';
      for (let bx = 0; bx < blocks.BW; bx++) { const t = blocks.t[by * blocks.BW + bx]; row += t < 0 ? '.' : symbol.get(t); }
      tenPointRows.push(row);
    }
  }
  let big = 0, small = 0, meters = 0;
  for (const st of stitches.values()) { big += st.big; small += st.small; meters += yarn.meters(st); }
  const data = {
    format: CHART_FORMAT,
    version: 1,
    name: state.saveName,
    exportedAt: new Date().toISOString(),
    app: 'Mandelbrot Cross-Stitch visualizer',
    howToRead: 'rows[r][c] is the thread symbol of the stitch in row r (0 = top) and column c (0 = left); look it up in threads. ' +
      (blocks
        ? 'tenPointRows[br][bc] covers rows 2br..2br+1 and columns 2bc..2bc+1: a symbol means one big 10-point stitch over those 4 cells, ' +
          "'.' means the 4 cells are separate 20-point stitches. "
        : 'Every cell is one stitch (10-point blocks off). ') +
      'Half stitches /, lower left to upper right. Load this file in the app to continue editing.',
    size: {
      widthStitches: W, heightStitches: H, stitchesPerCm: state.density,
      widthCm: Math.round((W / state.density) * 10) / 10, heightCm: Math.round((H / state.density) * 10) / 10,
    },
    yarn: yarnOf(state.yarn).long,
    tenPoint: blocks ? { enabled: true, islandMax: state.islandMax, blockColumns: blocks.BW, blockRows: blocks.BH } : { enabled: false },
    totals: {
      threads: threads.length, cells: W * H, stitches10pt: big, stitches20pt: small,
      meters: Math.round(meters), grams: Math.round(meters * yarn.gPerM),
    },
    threads,
    rows,
    tenPointRows,
    settings: buildSave(state, { app: 'Mandelbrot Cross-Stitch visualizer' }),
  };
  // Indented, so every matrix row is on its own line (readable in a text editor).
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = saveFileName(name, 'chart');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  fileMessage(`Exported ${a.download} (${(W * H).toLocaleString()} cells, ${threads.length} threads)`);
}

function saveSettings(name) {
  state.saveName = name.trim().slice(0, 80);
  save();
  const threads = pattern
    ? [...pattern.counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
      const st = pattern.stitches.get(t);
      return {
        yarn: THREADS[t].brand, code: THREADS[t].code, name: THREADS[t].name, cells: n,
        stitches10pt: st.big, stitches20pt: st.small, meters: Math.round(yarnUse().meters(st) * 10) / 10,
      };
    })
    : undefined;
  const data = buildSave(state, {
    app: 'Mandelbrot Cross-Stitch visualizer',
    ...(threads ? { threads } : {}),
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = saveFileName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  fileMessage(`Saved ${a.download}`);
}

async function loadSettingsFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return fileMessage(`Couldn't read ${file.name}: not valid JSON`, true);
  }
  let result;
  try {
    // A stitch chart (final export) carries the settings it was made with.
    result = readSave(data.format === CHART_FORMAT && data.settings ? data.settings : data, state);
  } catch (e) {
    return fileMessage(`Couldn't load ${file.name}: ${e.message}`, true);
  }
  // Apply by persisting the merged state and reloading, so every control is rebuilt consistently.
  const named = data.name && result.state.saveName ? `“${result.state.saveName}” ` : '';
  const msg = [`Loaded ${named}(${file.name}, ${result.applied.length} settings)`];
  if (result.skipped.length) msg.push(`skipped ${result.skipped.length} invalid: ${result.skipped.join(', ')}`);
  msg.push(...result.notes);
  saveSuspended = true;
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state));
    sessionStorage.setItem('mandel-stitch-keep-sampling', '1');
    sessionStorage.setItem('mandel-stitch-file-msg', msg.join(' · '));
  } catch {
    saveSuspended = false;
    return fileMessage("Couldn't apply the file: browser storage is blocked", true);
  }
  location.reload();
}

function initSaveLoad() {
  $('saveSettings').addEventListener('click', openSaveDialog);
  $('saveNameInput').addEventListener('input', updateSavePreview);
  $('saveCancel').addEventListener('click', () => $('saveDialog').close());
  $('saveForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('saveNameInput').value;
    if (!fileSafe(name)) return; // a name is required
    $('saveDialog').close();
    if (saveKind === 'chart') exportChart(name); else saveSettings(name);
  });
  for (const id of ['finalExport', 'finalExport2']) $(id).addEventListener('click', () => openSaveDialog('chart'));
  $('loadSettings').addEventListener('click', () => $('loadFile').click());
  $('loadFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) loadSettingsFile(f);
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      openSaveDialog();
    }
  });
  // Drag a saved file onto the page to load it.
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; document.body.classList.add('drop-target'); } });
  document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('drop-target'); } });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('drop-target');
    const f = e.dataTransfer.files[0];
    if (f) loadSettingsFile(f);
  });
  // Message from a load that just reloaded the page.
  try {
    const msg = sessionStorage.getItem('mandel-stitch-file-msg');
    if (msg) fileMessage(msg);
    sessionStorage.removeItem('mandel-stitch-file-msg');
    sessionStorage.removeItem('mandel-stitch-keep-sampling');
  } catch {}
}

// ---------- Boot ----------

updateDepthStats();
initControls();
initSaveLoad();
initStitchEnabled();
initLookToggle();
initLegendSort();
initGuides();
initFullscreen();
setColorsOpen(state.colorsOpen);
drawSpectrum();
sizeExplorer();
computeExplorer();
updateCoords();
computePattern();

new ResizeObserver(() => {
  if (sizeExplorer()) {
    requestExplorerDraw();
    debounce('explorer', computeExplorer, 150);
  }
}).observe($('explorerWrap'));
