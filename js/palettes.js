import { rgbToLab, labDist2 } from './dmc.js';

// Palette library: gradient stops mapped over the depth of the set, grouped for the gallery.
export const PRESET_GROUPS = {
  Classic: {
    Classic: ['#000764', '#206bcb', '#edffff', '#ffaa00', '#000200'],
    Electric: ['#000000', '#1a0066', '#5e00ff', '#00d4ff', '#ffffff'],
    'Midnight Gold': ['#0b0b2a', '#26215c', '#c9a227', '#fff3c4'],
    Galaxy: ['#03001c', '#301e67', '#5b8fb9', '#b6eada', '#ffffff'],
    Grayscale: ['#000000', '#ffffff'],
    'Inverted Gray': ['#ffffff', '#000000'],
    Ink: ['#0d0d0d', '#3a3a3a', '#f2efe6'],
  },
  'Fire & warm': {
    Fire: ['#1a0000', '#7a0a00', '#d62800', '#ff8c00', '#ffe066', '#fff8e0'],
    Lava: ['#0a0000', '#3d0000', '#9e1b00', '#ff4500', '#ffb000', '#fff4b0'],
    Ember: ['#140b06', '#4a1a0a', '#a3320b', '#e8751a', '#f7c873'],
    Sunset: ['#2d0b3a', '#7b1e5a', '#d9455f', '#f78e4a', '#fcd17a'],
    Desert: ['#3b1f0e', '#8c4a1f', '#d98b3a', '#f2c879', '#fdf0d5'],
    Autumn: ['#2b1a0a', '#7a2e0e', '#c1440e', '#e59b2b', '#f4d35e', '#4f6d2f'],
    Copper: ['#1c0f08', '#5a2d12', '#b0642a', '#e3a36b', '#f7dcc0'],
    Peach: ['#5b2333', '#b85c5c', '#f29e7a', '#fcd5b5', '#fff5e8'],
  },
  'Cool & water': {
    Ocean: ['#001219', '#005f73', '#0a9396', '#94d2bd', '#e9d8a6'],
    Ice: ['#0a1a33', '#274b8a', '#6a9fd8', '#c9e4f7', '#ffffff'],
    'Deep Sea': ['#000814', '#001d3d', '#003566', '#0077b6', '#48cae4', '#caf0f8'],
    Glacier: ['#0d1b2a', '#1b263b', '#415a77', '#778da9', '#e0e1dd'],
    Lagoon: ['#012a36', '#03506f', '#0a9396', '#5ae4c8', '#e0fbfc'],
    'Arctic Night': ['#020024', '#090979', '#00d4ff', '#e0f7ff'],
    'Teal Copper': ['#0b2027', '#40798c', '#70a9a1', '#cfd7c7', '#f6a95a'],
  },
  Nature: {
    Forest: ['#0b1f0e', '#1f5130', '#4f8a3c', '#b5c95a', '#f0e6b0'],
    Moss: ['#1b2412', '#3c4f1f', '#6b8e23', '#a9ba5a', '#e3e7af'],
    Meadow: ['#1f3a0f', '#4c7a2a', '#9bc53d', '#e5d352', '#f7f3c4', '#c95d63'],
    Lichen: ['#2f3e46', '#52796f', '#84a98c', '#cad2c5', '#f0efeb'],
    'Cherry Blossom': ['#3d1f2b', '#8e3b5f', '#e07a9e', '#f7c6d9', '#fff0f5'],
    'Lavender Field': ['#1e1433', '#4b3a7a', '#8e7cc3', '#c9b8e8', '#f3eefc'],
    'Coral Reef': ['#0b3954', '#087e8b', '#bfd7ea', '#ff5a5f', '#c81d25'],
    Tropical: ['#004e64', '#00a5cf', '#9fffcb', '#25a18e', '#ffd166', '#ef476f'],
  },
  Vivid: {
    Rainbow: ['#e6194b', '#f58231', '#ffe119', '#3cb44b', '#4363d8', '#911eb4'],
    Neon: ['#0a0014', '#ff00a0', '#0a0014', '#00f0ff', '#0a0014', '#faff00'],
    Synthwave: ['#0d0221', '#261447', '#ff3864', '#ff9e3d', '#2de2e6'],
    Candy: ['#ff6b9d', '#ffd93d', '#6bcb77', '#4d96ff', '#c56cf0'],
    Psychedelic: ['#ff0054', '#ff5400', '#ffbd00', '#00c49a', '#0096ff', '#9d4edd'],
    Acid: ['#000000', '#39ff14', '#000000', '#ff073a'],
    'Pop Art': ['#000000', '#ffde00', '#ff2a6d', '#05d9e8', '#ffffff'],
    Berry: ['#1b0826', '#5c1a5e', '#a8327a', '#e86f9a', '#fbd3e0'],
  },
  'Soft & pastel': {
    Pastel: ['#ffd6e0', '#ffefcf', '#d4f0c0', '#c6e2ff', '#e3d0ff'],
    'Cotton Candy': ['#ffb3c6', '#ffe5ec', '#bde0fe', '#a2d2ff', '#cdb4db'],
    'Mint Cream': ['#4a7c6b', '#95c8b8', '#b8e0d2', '#e8f6ef', '#f9f7f3'],
    Sorbet: ['#f7a399', '#fbc3bc', '#ffe3d3', '#c9e4ca', '#87bba2', '#55828b'],
    Nursery: ['#fdf0d5', '#f4c2c2', '#c1d3fe', '#abc4ff', '#e2eafc'],
  },
  'Earthy & vintage': {
    Sepia: ['#1a120b', '#3c2a21', '#8b6b4a', '#d5b895', '#f5ead7'],
    Terracotta: ['#2d1e17', '#7a3b2e', '#c46a4a', '#e8b18c', '#f4e3d0'],
    'Olive Grove': ['#1f2416', '#4a5530', '#848c4d', '#c7c291', '#efe9d1'],
    'Faded Denim': ['#1d2a3a', '#3e5c76', '#748cab', '#c0cfdb', '#f0ebd8'],
    'Antique Rose': ['#2b1b1f', '#6d3b47', '#b0787f', '#e0bfb8', '#f7ede2'],
    'Tea Stain': ['#3a2e1f', '#6b5a3e', '#a89060', '#d9c9a3', '#f3ecd9'],
  },
  'Jewel & dark': {
    Jewel: ['#0b0a1f', '#3a0ca3', '#7209b7', '#f72585', '#4cc9f0'],
    'Emerald City': ['#001b12', '#004d33', '#00875a', '#3ecf8e', '#d4ffe8'],
    Amethyst: ['#10002b', '#3c096c', '#7b2cbf', '#c77dff', '#f3e8ff'],
    'Sapphire Gold': ['#03045e', '#023e8a', '#0077b6', '#ffd60a', '#fff9db'],
    Ruby: ['#1a0005', '#5c0011', '#a4133c', '#ff4d6d', '#ffccd5'],
    Peacock: ['#001219', '#005f73', '#0a9396', '#ee9b00', '#ca6702', '#9b2226'],
  },
  Duotone: {
    'Blue Orange': ['#0d1b4c', '#f28c28'],
    'Pink Teal': ['#2a0a3a', '#ff4f9a', '#fff0f6', '#00a6a6'],
    'Black Gold': ['#000000', '#d4af37'],
    'Red White': ['#7a0010', '#ffffff'],
    'Navy Cream': ['#14213d', '#f5ebe0'],
    'Plum Lime': ['#2e0f3a', '#c6f432'],
  },
};

export const PRESETS = Object.assign({}, ...Object.values(PRESET_GROUPS));

export const DEFAULT_INTERIOR = '#000000';

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const LUT_SIZE = 1024;

// Gradient lookup table. Cyclic gradients blend the last stop back into the first.
function makeLUT(stops, cyclic) {
  const cols = stops.map(hexToRgb);
  const lut = new Uint8ClampedArray(LUT_SIZE * 3);
  const n = cols.length;
  for (let i = 0; i < LUT_SIZE; i++) {
    let r, g, b;
    if (n === 1) {
      [r, g, b] = cols[0];
    } else {
      const f = cyclic ? (i / LUT_SIZE) * n : (i / (LUT_SIZE - 1)) * (n - 1);
      const k = Math.min(Math.floor(f), cyclic ? n - 1 : n - 2);
      const t = f - k;
      const a = cols[k], c = cols[(k + 1) % n];
      r = a[0] + (c[0] - a[0]) * t;
      g = a[1] + (c[1] - a[1]) * t;
      b = a[2] + (c[2] - a[2]) * t;
    }
    lut[i * 3] = r; lut[i * 3 + 1] = g; lut[i * 3 + 2] = b;
  }
  return lut;
}

// Maps a depth value to an index into the gradient lookup table (-1 = inside the set).
//   mapping: 'cyclic'   repeat every `period` iterations, shifted by `offset`
//            'linear'   gradient spans the selection's depth range (fit) or 0..`period`
//            'log'      same, log-scaled (more room for the many shallow points)
//            'balanced' histogram-equalized: each color covers about the same area of the selection
//            'edge'     balanced up to max depth, and outside colors are kept clearly distinct from the
//                       inside color, so the set boundary stays crisp (also in threads, see crispEdge).
//                       `edgeWidth` (−2…2) reshapes it: wider or narrower bands near the edge (γ = 4^−edgeWidth).
//            'spectrum' one pass from the outer area to the set's edge (crisp edge like 'edge'). `detailBalance`
//                       (0…1) blends how colors are shared out: 0 = by area (= balanced), 1 = by log-depth
//                       range (= log), which gives the deep filaments next to the inside more colors.
//   bunch:   −1…1, non-cyclic modes: exponential bunching of the bands toward the high end (deep points
//            next to the set, >0) or the low end (outer area, <0). 0 = off.
//   stats:   { q } — 257 depth quantiles of the selected area (from sampleDepthStats), used by fit/balanced
//   bands:   0 = smooth, otherwise snap to that many discrete depth bands
// Returns { index(v), lut (RGB triplets), size, inside (RGB) }.
// Minimum CIELAB distance between any outside color and the inside color in 'edge' mode.
const EDGE_DE = 22;

// CIELAB (D65) → sRGB, clamped to the gamut. Inverse of dmc.js rgbToLab.
function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const finv = t => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * finv(fx), Y = finv(fy), Z = 1.08883 * finv(fz);
  const lin = [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
  return lin.map(v => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  });
}

// Push LUT colors away from the inside color by changing only their lightness (hue and chroma kept):
// lighter for a dark inside, darker for a light one. The target distance is a smooth soft-max,
// (d⁴ + E⁴)^¼: at least EDGE_DE, and ≈ d for far colors. It is continuous and monotone in the original
// distance, so the gradient keeps its order. (A hard cut-off here made colors just past the threshold
// darker than the pushed ones, which showed up as dark halo rings in the thread pattern.)
function separateFromInside(lut, inside) {
  const [Li, ai, bi] = rgbToLab(...inside);
  const up = Li < 50;
  const E4 = EDGE_DE ** 4;
  for (let i = 0; i < lut.length; i += 3) {
    const [L, a, b] = rgbToLab(lut[i], lut[i + 1], lut[i + 2]);
    const dab2 = (a - ai) ** 2 + (b - bi) ** 2;
    const d = Math.sqrt(dab2 + (L - Li) ** 2);
    const target = Math.pow(d ** 4 + E4, 0.25);
    if (target - d < 0.01) continue;
    const dL = Math.sqrt(Math.max(0, target * target - dab2));
    const newL = up ? Math.max(L, Li + dL) : Math.min(L, Li - dL);
    const [r, g, bb] = labToRgb(Math.min(100, Math.max(0, newL)), a, b);
    lut[i] = r; lut[i + 1] = g; lut[i + 2] = bb;
  }
}

export function makeMapper({ stops, mapping, period, offset, bands, interior, fitRange, maxIter, edgeWidth = 0, bunch = 0, detailBalance = 0.5 }, stats) {
  const cyclic = mapping === 'cyclic';
  const edge = mapping === 'edge';
  const spectrum = mapping === 'spectrum';
  const crisp = edge || spectrum;
  // Edge band width −1…1: >0 widens the bands near the set's edge (γ < 1), <0 narrows them.
  const edgeGamma = Math.pow(4, -edgeWidth);
  // Band bunching: f(t) = (e^{kt} − 1) / (e^k − 1). k > 0 packs bands toward t = 1, k < 0 toward t = 0.
  const k = 8 * bunch;
  const ek = Math.expm1(k);
  const bunchT = !cyclic && k !== 0 ? t => Math.expm1(k * t) / ek : null;
  const lut = makeLUT(stops, cyclic);
  if (crisp) separateFromInside(lut, hexToRgb(interior));
  let q = stats?.q;
  // Single pass: quantile segment k (1/256 of the area) gets a share Δu^s of the gradient, u = log depth.
  // s = 0 → equal shares (balanced), s = 1 → shares follow the log-depth span (log). In between is a
  // partial histogram equalization: the deep tail near the set keeps colors without the outside going flat.
  let logQ = null, T = null;
  if (spectrum && q) {
    logQ = Float64Array.from(q, v => Math.log(Math.max(v, 1e-9)));
    T = new Float64Array(257);
    for (let k = 0; k < 256; k++) T[k + 1] = T[k] + Math.pow(Math.max(0, logQ[k + 1] - logQ[k]), detailBalance);
    if (T[256] > 0) for (let k = 1; k <= 256; k++) T[k] /= T[256];
    else for (let k = 0; k <= 256; k++) T[k] = k / 256;
  }
  if (edge && q) {
    // Balanced, but the gradient runs all the way to max depth: the deepest points (the set's edge) get the last color.
    q = Float64Array.from(q);
    q[256] = Math.max(q[256], maxIter);
  }
  const fit = q && (mapping === 'balanced' || fitRange);
  const lo = fit ? q[5] : 0;            // ≈ 2nd percentile
  const hi = fit ? q[251] : period;     // ≈ 98th percentile
  const span = Math.max(1e-6, hi - lo);
  const logSpan = Math.log1p(span);
  const cdf = v => {
    // Position of v among the quantiles → 0..1 (binary search + linear interpolation).
    if (v <= q[0]) return 0;
    if (v >= q[256]) return 1;
    let a = 0, b = 256;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (q[m] <= v) a = m; else b = m;
    }
    const d = q[b] - q[a];
    return (a + (d > 0 ? (v - q[a]) / d : 0)) / 256;
  };
  const index = v => {
    if (v < 0) return -1;
    let t;
    if (cyclic) {
      t = v / period + offset;
      t -= Math.floor(t);
    } else if ((mapping === 'balanced' || edge) && q) {
      t = cdf(v);
      if (edge && edgeGamma !== 1) t = Math.pow(t, edgeGamma);
    } else if (T) {
      if (v <= q[0]) t = 0;
      else if (v >= q[256]) t = 1;
      else {
        let a = 0, b = 256;
        while (b - a > 1) {
          const m = (a + b) >> 1;
          if (q[m] <= v) a = m; else b = m;
        }
        const d = logQ[b] - logQ[a];
        t = T[a] + (d > 0 ? (T[b] - T[a]) * (Math.log(v) - logQ[a]) / d : 0);
      }
    } else if (mapping === 'log' || spectrum) {
      t = Math.min(1, Math.log1p(Math.max(0, v - lo)) / logSpan);
    } else {
      t = Math.min(1, Math.max(0, v - lo) / span);
    }
    if (bunchT) t = bunchT(t);
    if (bands > 0) {
      t = cyclic
        ? Math.floor(t * bands) / bands
        : Math.min(bands - 1, Math.floor(t * bands)) / Math.max(1, bands - 1);
    }
    return Math.min(LUT_SIZE - 1, (t * LUT_SIZE) | 0);
  };
  return { index, lut, size: LUT_SIZE, inside: hexToRgb(interior), crispEdge: crisp };
}
