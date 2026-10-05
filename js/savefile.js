// Save files: the selection, view, size, color and render settings as a downloadable JSON file.
//
// Forward/backward compatible by design:
//   - Every setting is listed once in FIELDS (file path ↔ state key + how to validate it).
//     To add a setting, add one line; old files simply don't have it and keep the current value.
//   - Reading is field by field: missing, unknown or invalid values are skipped (the current value
//     is kept) and numbers are clamped into range, so a partial or newer file still loads what it can.
//   - `version` is informational: a newer file loads with a note; unknown sections are ignored.
//   - Informational sections (`threads`, `savedAt`, `app`) are written for humans and never read.

export const SAVE_FORMAT = 'mandelbrot-cross-stitch';
export const SAVE_VERSION = 1;

const num = (min = -Infinity, max = Infinity) => v => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const int = (min, max) => v => {
  const n = num(min, max)(v);
  return n === undefined ? undefined : Math.round(n);
};
const bool = () => v => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined);
const oneOf = (...allowed) => v => (allowed.includes(v) ? v : allowed.includes(String(v)) ? String(v) : allowed.includes(Number(v)) ? Number(v) : undefined);
const str = (maxLen = 200) => v => (typeof v === 'string' ? v.slice(0, maxLen) : undefined);
// Hand-edited thread plan: false (automatic) or { key, segs: [{ end 0…1, sample 0…1, dmc: thread code of the save's yarn }] }.
const threadEdit = () => v => {
  if (v === false || v === null) return false;
  if (!v || typeof v !== 'object' || typeof v.key !== 'string' || !Array.isArray(v.segs) || !v.segs.length || v.segs.length > 1024) return undefined;
  const segs = v.segs.map(s => ({
    end: num(0, 1)(s?.end), sample: num(0, 1)(s?.sample), dmc: s?.dmc == null ? undefined : String(s.dmc),
    ...(s?.pick === true ? { pick: true } : {}),
  }));
  return segs.every(s => s.end !== undefined && s.sample !== undefined && s.dmc) ? { key: v.key, segs } : undefined;
};
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const expandHex = h => (h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h).toLowerCase();
const color = () => v => (typeof v === 'string' && HEX.test(v.trim()) ? expandHex(v.trim()) : undefined);
const colors = () => v => {
  if (!Array.isArray(v)) return undefined;
  const ok = v.map(c => color()(c)).filter(Boolean).slice(0, 32);
  return ok.length ? ok : undefined;
};

// [path in the file, key in app state (dot = nested), validator]
const FIELDS = [
  ['name', 'saveName', str(80)],

  ['selection.centerRe', 'sel.cx', num()],
  ['selection.centerIm', 'sel.cy', num()],
  ['selection.width', 'sel.w', num(1e-300, 100)],
  ['selection.rotation', 'sel.rot', num(-Math.PI, Math.PI)],
  ['selection.visible', 'selVisible', bool()],

  ['view.centerRe', 'view.cx', num()],
  ['view.centerIm', 'view.cy', num()],
  ['view.scale', 'view.scale', num(1e-300, 10)],
  ['view.boxWidth', 'view.boxW', num(1e-300, 100)],
  ['view.boxHeight', 'view.boxH', num(1e-300, 100)],

  ['size.stitchesPerCm', 'density', num(1, 100)],
  ['size.widthStitches', 'stitchW', int(5, 20000)],
  ['size.heightStitches', 'stitchH', int(5, 20000)],

  ['colors.palette', 'preset', str()],
  ['colors.stops', 'stops', colors()],
  ['colors.mapping', 'mapping', oneOf('cyclic', 'linear', 'log', 'balanced', 'edge', 'spectrum')],
  ['colors.iterationsPerCycle', 'period', num(1, 1e6)],
  ['colors.phase', 'offset', num(0, 1)],
  ['colors.bands', 'bands', int(0, 64)],
  ['colors.insideColor', 'interior', color()],
  ['colors.fitToSelection', 'fitRange', bool()],
  ['colors.edgeBandWidth', 'edgeWidth', num(-2, 2)],
  ['colors.bandBunching', 'bunch', num(-1, 1)],
  ['colors.detailBalance', 'detailBalance', num(0, 1)],

  ['render.maxIterations', 'maxIter', int(20, 1e6)],
  ['render.yarn', 'yarn', oneOf('dmc', 'pirkka', 'rauma', 'novita', 'store', 'final')],
  ['label.enabled', 'label.on', bool()],
  ['label.text', 'label.text', str(120)],
  ['label.position', 'label.pos', oneOf('bl', 'bc', 'br')],
  ['label.size', 'label.size', int(1, 3)],
  ['label.fontHeight', 'label.font', oneOf(7, 5, 3)],
  ['label.textThread', 'label.fg', str(20)],
  ['label.background', 'label.bgMode', oneOf('none', 'outline', 'band')],
  ['label.backgroundThread', 'label.bg', str(20)],
  ...['dmc', 'pirkka', 'rauma', 'novita', 'store', 'final'].flatMap(y => [
    [`render.yarnAmount.${y}.metersPerBall`, `yarnSpec.${y}.m`, num(1, 100000)],
    [`render.yarnAmount.${y}.gramsPerBall`, `yarnSpec.${y}.g`, num(1, 10000)],
    [`render.yarnAmount.${y}.strandsPerStitch`, `yarnSpec.${y}.strands`, num(0.25, 12)],
    [`render.yarnAmount.${y}.strandsPer10PointStitch`, `yarnSpec.${y}.strandsBig`, num(0.25, 12)],
    [`render.yarnAmount.${y}.extraPercent`, `yarnSpec.${y}.extra`, num(0, 200)],
  ]),
  ['render.maxThreadColors', 'maxColors', int(2, 80)],
  ['render.threadEdits', 'threadEdit', threadEdit()],
  ['render.samplesPerStitchSide', 'supersample', oneOf(1, 2, 3, 8, 16, 32)],
  ['render.stitchLook', 'stitchLook', oneOf('stitch', 'pixels')],
  ['render.grid', 'grid', bool()],
  ['render.tenPointBlocks', 'grosPoint', bool()],
  ['render.tenPointIslandMax', 'islandMax', int(0, 1000)],
  ['framing.guide', 'guide', str(20)],
  ['framing.orientation', 'guideOrient', int(0, 3)],
  ['render.stitchPreviewEnabled', 'stitchEnabled', bool()],
  ['render.threadSort', 'legendSort', oneOf('usage', 'palette')],
];

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

// Build the save file from app state. `extras` adds informational sections (e.g. threads).
export function buildSave(state, extras = {}) {
  const out = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: new Date().toISOString() };
  for (const [path, key] of FIELDS) {
    const v = getPath(state, key);
    if (v !== undefined && v !== null) setPath(out, path, Array.isArray(v) ? [...v] : v);
  }
  return { ...out, ...extras };
}

// Read a save file (parsed JSON) onto a copy of `current` state.
// Returns { state, applied, skipped, notes }. Throws only if it isn't a settings object at all.
export function readSave(data, current) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a settings file');
  const next = JSON.parse(JSON.stringify(current)); // state is plain JSON
  const applied = [], skipped = [], notes = [];

  // Also accept the app's internal (localStorage) shape, e.g. hand-copied state.
  const legacy = data.format === undefined && (data.sel || data.stops || data.mapping);
  if (data.format !== undefined && data.format !== SAVE_FORMAT) notes.push(`unexpected format "${data.format}", reading what fits`);
  if (typeof data.version === 'number' && data.version > SAVE_VERSION) {
    notes.push(`saved by a newer version (v${data.version}); settings this version doesn't know were ignored`);
  }

  for (const [path, key, validate] of FIELDS) {
    const raw = legacy ? getPath(data, key) : getPath(data, path);
    if (raw === undefined) continue;
    const v = validate(raw);
    if (v === undefined) { skipped.push(path); continue; }
    setPath(next, key, v);
    applied.push(path);
  }
  if (!applied.length) throw new Error('no usable settings found');
  return { state: next, applied, skipped, notes };
}
