import { THREAD_LAB, labDist2, nearestThreadLab } from './dmc.js';

// Choose at most `maxColors` threads from weighted candidates (`weights`: one number per thread index (THREADS), e.g. how
// many gradient entries map to that thread). Repeatedly merges the pair with the lowest
// (smaller weight × color distance), so near-identical and rarely used threads go first; then every candidate
// is reassigned to the nearest surviving thread.
// `protect` (optional thread index, the inside-the-set thread) is never merged with other threads and
// never used for candidates that weren't already that thread, which keeps the set boundary crisp.
// Returns { threads: surviving thread indices, remap: Uint16Array (candidate thread index → chosen thread) }.
export function pickThreads(weights, maxColors, protect = -1) {
  const n = THREAD_LAB.length;
  const cnt = Float64Array.from(weights);

  const used = [];
  for (let i = 0; i < n; i++) if (cnt[i] > 0 || i === protect) used.push(i);

  let active = used.slice();
  while (active.length > maxColors) {
    let best = Infinity, drop = -1, keep = -1;
    for (let a = 0; a < active.length; a++) {
      for (let b = a + 1; b < active.length; b++) {
        const ia = active[a], ib = active[b];
        if (ia === protect || ib === protect) continue;
        const cost = Math.min(cnt[ia], cnt[ib]) * Math.sqrt(labDist2(THREAD_LAB[ia], THREAD_LAB[ib]));
        if (cost < best) {
          best = cost;
          [drop, keep] = cnt[ia] < cnt[ib] ? [ia, ib] : [ib, ia];
        }
      }
    }
    if (drop < 0) break; // only the protected thread is left to merge
    cnt[keep] += cnt[drop];
    active = active.filter(i => i !== drop);
  }

  const remap = new Uint16Array(n);
  const others = active.filter(i => i !== protect);
  for (const i of used) {
    remap[i] = i === protect ? i : nearestThreadLab(THREAD_LAB[i], others.length ? others : active);
  }
  return { threads: active, remap };
}
