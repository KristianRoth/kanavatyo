// Random palette generators. Each style returns an array of hex gradient stops.
import { DMC, DMC_LAB } from './dmc.js';
import { rgbToHex } from './palettes.js';

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (n, f) => Array.from({ length: n }, (_, i) => f(n === 1 ? 0 : i / (n - 1), i));
const GOLDEN = 137.508;

function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const out = [];
  for (const v of lin) {
    if (v < -0.001 || v > 1.001) return null;
    const c = Math.min(1, Math.max(0, v));
    out.push(Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  }
  return out;
}

// Perceptual color (OKLCH: lightness 0–1, chroma ~0–0.37, hue degrees) → hex.
// Chroma is reduced until the color fits in sRGB.
export function oklch(L, C, h) {
  L = Math.min(1, Math.max(0, L));
  const rad = (h * Math.PI) / 180;
  for (let c = Math.max(0, C); c > 0; c -= 0.005) {
    const rgb = oklabToRgb(L, c * Math.cos(rad), c * Math.sin(rad));
    if (rgb) return rgbToHex(rgb);
  }
  return rgbToHex(oklabToRgb(L, 0, 0));
}

// ---- Real DMC threads ----

const dmcInfo = DMC.map((d, i) => {
  const [L, a, b] = DMC_LAB[i];
  return { i, L, chroma: Math.hypot(a, b), hue: (Math.atan2(b, a) * 180) / Math.PI };
});
const hueDist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const dmcHex = list => list.sort((a, b) => a.L - b.L).map(t => rgbToHex(DMC[t.i].rgb));

// n threads spread over lightness, drawn from `pool`.
function spreadByLightness(pool, n) {
  const sorted = [...pool].sort((a, b) => a.L - b.L);
  if (sorted.length <= n) return sorted;
  return ramp(n, t => {
    const center = t * (sorted.length - 1);
    const jitter = (sorted.length / n) * 0.4;
    return sorted[Math.round(Math.min(sorted.length - 1, Math.max(0, center + rand(-jitter, jitter))))];
  }).filter((v, i, arr) => arr.indexOf(v) === i);
}

// ---- Styles ----

export const STYLES = {
  surprise: { label: 'Surprise me (any style)' },
  random: {
    label: 'Totally random',
    make: () => ramp(randInt(3, 7), () => oklch(rand(0.15, 0.95), rand(0, 0.25), rand(0, 360))),
  },
  analogous: {
    label: 'Analogous (neighbor hues)',
    make() {
      const h = rand(0, 360), span = rand(30, 90);
      return ramp(randInt(4, 6), t => oklch(lerp(0.15, 0.95, t), rand(0.08, 0.2), h + span * (t - 0.5)));
    },
  },
  monochrome: {
    label: 'Monochrome (one hue)',
    make() {
      const h = rand(0, 360), c = rand(0.06, 0.2);
      return ramp(5, t => oklch(lerp(0.12, 0.96, t), c * (1 - Math.abs(t - 0.5)) + 0.01, h));
    },
  },
  complementary: {
    label: 'Complementary (opposites)',
    make() {
      const h = rand(0, 360);
      return [
        oklch(0.18, 0.08, h),
        oklch(0.55, rand(0.14, 0.22), h),
        oklch(0.95, 0.02, h + 90),
        oklch(0.62, rand(0.14, 0.22), h + 180),
        oklch(0.25, 0.08, h + 180),
      ];
    },
  },
  triadic: {
    label: 'Triadic (three hues)',
    make() {
      const h = rand(0, 360);
      const Ls = [0.2, 0.6, 0.88, 0.45, 0.75, 0.3];
      return ramp(6, (t, i) => oklch(Ls[i], rand(0.1, 0.2), h + 120 * (i % 3)));
    },
  },
  rainbow: {
    label: 'Rainbow sweep',
    make() {
      const h = rand(0, 360), span = rand(180, 360) * pick([1, -1]), L = rand(0.6, 0.8);
      return ramp(6, t => oklch(L, rand(0.14, 0.2), h + span * t));
    },
  },
  sunset: {
    label: 'Sunset sweep (dark → bright)',
    make() {
      const h = rand(260, 320), end = rand(420, 450);
      return ramp(randInt(4, 6), t => oklch(lerp(0.18, 0.92, t), lerp(0.12, 0.18, t), lerp(h, end, t)));
    },
  },
  neon: {
    label: 'Neon on black',
    make() {
      const h = rand(0, 360), n = randInt(2, 3), dh = 360 / n + rand(-20, 20);
      return Array.from({ length: n }, (_, i) => [
        oklch(rand(0.08, 0.16), rand(0.02, 0.06), h + dh * i),
        oklch(rand(0.75, 0.9), 0.3, h + dh * i),
      ]).flat();
    },
  },
  highContrast: {
    label: 'High contrast bands',
    make() {
      const h = rand(0, 360), h2 = h + rand(90, 180);
      return [oklch(0.1, 0.05, h), oklch(0.95, 0.04, h), oklch(0.15, 0.08, h2), oklch(0.85, 0.15, h2)];
    },
  },
  jewel: {
    label: 'Jewel tones',
    make() {
      const h = rand(0, 360);
      return ramp(5, (t, i) => oklch(rand(0.3, 0.6), rand(0.15, 0.25), h + GOLDEN * i));
    },
  },
  pastel: {
    label: 'Pastel',
    make() {
      const h = rand(0, 360), step = rand(40, 90);
      return ramp(randInt(4, 6), (t, i) => oklch(rand(0.82, 0.93), rand(0.04, 0.1), h + step * i));
    },
  },
  earth: {
    label: 'Earthy',
    make() {
      return ramp(randInt(4, 6), t => oklch(lerp(0.2, 0.9, t), rand(0.03, 0.12), rand(30, 110)));
    },
  },
  warm: {
    label: 'Warm',
    make() {
      const h = rand(-30, 40);
      return ramp(5, t => oklch(lerp(0.15, 0.93, t), rand(0.1, 0.2), h + t * rand(20, 60)));
    },
  },
  cool: {
    label: 'Cool',
    make() {
      const h = rand(170, 250);
      return ramp(5, t => oklch(lerp(0.15, 0.95, t), rand(0.06, 0.17), h + t * rand(-40, 40)));
    },
  },
  vintage: {
    label: 'Vintage / muted',
    make() {
      const h = rand(20, 80);
      return ramp(5, (t, i) => oklch(lerp(0.3, 0.92, t), rand(0.02, 0.07), i === 2 ? h + 180 : h + rand(-15, 15)));
    },
  },
  duotone: {
    label: 'Duotone',
    make() {
      const h = rand(0, 360), h2 = h + rand(120, 220);
      return [oklch(0.2, 0.1, h), oklch(0.95, 0.03, h), oklch(0.6, 0.2, h2)];
    },
  },
  dmcRandom: {
    label: 'Real DMC threads (random)',
    make: () => dmcHex(Array.from({ length: randInt(4, 7) }, () => pick(dmcInfo))),
  },
  dmcHarmony: {
    label: 'Real DMC threads (one color family)',
    make() {
      const seed = pick(dmcInfo.filter(t => t.chroma > 20));
      const family = dmcInfo.filter(t => t.chroma > 8 && hueDist(t.hue, seed.hue) < 25);
      const neutrals = dmcInfo.filter(t => t.chroma < 6);
      const picked = spreadByLightness(family, randInt(4, 6));
      if (Math.random() < 0.5) picked.push(pick(neutrals));
      return dmcHex(picked);
    },
  },
  dmcContrast: {
    label: 'Real DMC threads (two families)',
    make() {
      const a = pick(dmcInfo.filter(t => t.chroma > 25));
      const famA = dmcInfo.filter(t => t.chroma > 8 && hueDist(t.hue, a.hue) < 25);
      const famB = dmcInfo.filter(t => t.chroma > 8 && hueDist(t.hue, a.hue + 180) < 30);
      return [...dmcHex(spreadByLightness(famA, 3)), ...dmcHex(spreadByLightness(famB.length ? famB : dmcInfo, 3)).reverse()];
    },
  },
};

// Returns { style, stops }.
export function generatePalette(style) {
  if (style === 'surprise' || !STYLES[style]?.make) {
    style = pick(Object.keys(STYLES).filter(k => STYLES[k].make));
  }
  return { style, stops: STYLES[style].make() };
}
