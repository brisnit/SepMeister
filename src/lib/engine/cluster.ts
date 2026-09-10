/**
 * Weighted k-means++ in LAB over a binned color histogram.
 *
 * Clustering runs on histogram bins rather than raw pixels for three reasons:
 * it is orders of magnitude faster on large artwork, it is exactly
 * deterministic regardless of image size, and weighting by pixel count means
 * a large flat field of navy outranks a few thousand antialiased edge pixels
 * that belong to no real ink.
 */

import { rgbToLab, labToRgb, labDistSq, deltaE2000, rgbToHex, type Lab } from "@/lib/color/space";

/** Deterministic PRNG (mulberry32). Seeded so identical input => identical output. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ColorBin {
  lab: Lab;
  r: number;
  g: number;
  b: number;
  weight: number; // pixel count
}

export interface ClusterResult {
  centers: Lab[];
  hexes: string[];
  weights: number[];
  /** Within-cluster sum of squares, for elbow analysis. */
  inertia: number;
}

/**
 * Builds a weighted LAB histogram.
 *
 * `alphaFloor` drops near-transparent pixels: they carry no ink decision and
 * their RGB is often meaningless. Edge pixels are down-weighted via
 * `edgeWeight` because antialiased blends are artifacts of rasterization, not
 * colors the artist chose -- counting them equally is what produces phantom
 * "muddy purple" screens in naive separators.
 */
export function buildHistogram(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: { bits?: number; alphaFloor?: number; edgeMask?: Uint8ClampedArray; edgeWeight?: number } = {},
): ColorBin[] {
  const bits = opts.bits ?? 5; // 32 levels/channel = 32768 cells
  const shift = 8 - bits;
  const size = 1 << bits;
  const alphaFloor = opts.alphaFloor ?? 8;
  const edgeMask = opts.edgeMask;
  const edgeWeight = opts.edgeWeight ?? 0.25;

  const counts = new Float64Array(size * size * size);
  const rs = new Float64Array(size * size * size);
  const gs = new Float64Array(size * size * size);
  const bs = new Float64Array(size * size * size);

  for (let i = 0, n = width * height; i < n; i++) {
    const p = i * 4;
    const a = pixels[p + 3];
    if (a < alphaFloor) continue;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    // Partial alpha contributes proportionally.
    let wgt = a / 255;
    if (edgeMask && edgeMask[i] > 40) {
      wgt *= edgeWeight;
    }
    if (wgt <= 0) continue;
    const key = ((r >> shift) * size + (g >> shift)) * size + (b >> shift);
    counts[key] += wgt;
    rs[key] += r * wgt;
    gs[key] += g * wgt;
    bs[key] += b * wgt;
  }

  const bins: ColorBin[] = [];
  for (let k = 0; k < counts.length; k++) {
    const c = counts[k];
    if (c <= 0) continue;
    // Use the mean color inside the cell, not the cell center -- keeps
    // saturated colors from being pulled toward grey by quantization.
    const r = rs[k] / c;
    const g = gs[k] / c;
    const b = bs[k] / c;
    bins.push({ lab: rgbToLab(r, g, b), r, g, b, weight: c });
  }
  // Stable order so k-means++ selection is reproducible.
  bins.sort((x, y) => (y.weight - x.weight) || (x.lab.L - y.lab.L) || (x.lab.a - y.lab.a) || (x.lab.b - y.lab.b));
  return bins;
}

/** k-means++ seeding, weighted by pixel count, with a deterministic RNG. */
function seedCenters(bins: ColorBin[], k: number, rng: () => number): Lab[] {
  const centers: Lab[] = [];
  const totalW = bins.reduce((s, b) => s + b.weight, 0);

  // First center: weighted random pick.
  let target = rng() * totalW;
  let idx = 0;
  for (let i = 0; i < bins.length; i++) {
    target -= bins[i].weight;
    if (target <= 0) { idx = i; break; }
  }
  centers.push({ ...bins[idx].lab });

  const d2 = new Float64Array(bins.length).fill(Infinity);

  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < bins.length; i++) {
      const d = labDistSq(bins[i].lab, last);
      if (d < d2[i]) d2[i] = d;
      sum += d2[i] * bins[i].weight;
    }
    if (sum <= 0) break; // all bins already coincide with a center
    let t = rng() * sum;
    let chosen = -1;
    for (let i = 0; i < bins.length; i++) {
      t -= d2[i] * bins[i].weight;
      if (t <= 0) { chosen = i; break; }
    }
    if (chosen < 0) chosen = bins.length - 1;
    centers.push({ ...bins[chosen].lab });
  }
  return centers;
}

export function kmeansLab(bins: ColorBin[], k: number, opts: { seed?: number; maxIter?: number } = {}): ClusterResult {
  const kk = Math.max(1, Math.min(k, bins.length));
  const rng = makeRng(opts.seed ?? 0x5eed);
  const maxIter = opts.maxIter ?? 60;

  let centers = seedCenters(bins, kk, rng);
  const assign = new Int32Array(bins.length).fill(-1);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    for (let i = 0; i < bins.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = labDistSq(bins[i].lab, centers[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }

    const sumL = new Float64Array(centers.length);
    const sumA = new Float64Array(centers.length);
    const sumB = new Float64Array(centers.length);
    const sumW = new Float64Array(centers.length);
    for (let i = 0; i < bins.length; i++) {
      const c = assign[i];
      const w = bins[i].weight;
      sumL[c] += bins[i].lab.L * w;
      sumA[c] += bins[i].lab.a * w;
      sumB[c] += bins[i].lab.b * w;
      sumW[c] += w;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sumW[c] > 0) {
        centers[c] = { L: sumL[c] / sumW[c], a: sumA[c] / sumW[c], b: sumB[c] / sumW[c] };
      }
    }
    if (!changed && iter > 0) break;
  }

  // Drop empty clusters, then report weights and inertia.
  const weights = new Float64Array(centers.length);
  let inertia = 0;
  for (let i = 0; i < bins.length; i++) {
    weights[assign[i]] += bins[i].weight;
    inertia += labDistSq(bins[i].lab, centers[assign[i]]) * bins[i].weight;
  }

  const keep: number[] = [];
  for (let c = 0; c < centers.length; c++) if (weights[c] > 0) keep.push(c);
  // Sort by weight desc for stable, meaningful ordering.
  keep.sort((a, b) => weights[b] - weights[a] || a - b);

  const outCenters = keep.map((c) => centers[c]);
  const outWeights = keep.map((c) => weights[c]);
  const hexes = outCenters.map((c) => {
    const [r, g, b] = labToRgb(c);
    return rgbToHex(r, g, b);
  });

  return { centers: outCenters, hexes, weights: outWeights, inertia };
}

/**
 * Estimates how many ink families the artwork naturally contains.
 *
 * Runs k-means across a range of k and looks for the point where adding
 * another screen stops meaningfully reducing perceptual error. Reported to the
 * artist as "Recommended Screens" and compared against their maximum.
 */
export function estimateNaturalClusters(
  bins: ColorBin[],
  minK: number,
  maxK: number,
  seed = 0x5eed,
): { recommended: number; curve: { k: number; inertia: number }[] } {
  const curve: { k: number; inertia: number }[] = [];
  const lo = Math.max(1, minK);
  const hi = Math.max(lo, Math.min(maxK, bins.length));
  for (let k = lo; k <= hi; k++) {
    curve.push({ k, inertia: kmeansLab(bins, k, { seed }).inertia });
  }
  if (curve.length <= 2) return { recommended: hi, curve };

  // Normalized elbow: pick the k with the greatest distance from the straight
  // line joining the first and last points of the inertia curve.
  const x0 = curve[0].k;
  const y0 = curve[0].inertia;
  const x1 = curve[curve.length - 1].k;
  const y1 = curve[curve.length - 1].inertia;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const denom = Math.hypot(dx, dy) || 1;

  let best = curve[0].k;
  let bestDist = -Infinity;
  for (const pt of curve) {
    const dist = Math.abs(dy * (pt.k - x0) - dx * (pt.inertia - y0)) / denom;
    if (dist > bestDist) { bestDist = dist; best = pt.k; }
  }
  return { recommended: best, curve };
}

/**
 * Counts the ink families the artwork actually contains, independent of any
 * screen budget.
 *
 * This has to be budget-independent to be worth showing. "Recommended 16,
 * limit 6" tells an artist something real; a recommendation derived from their
 * own limit would only ever tell them what they already set. So it clusters
 * generously and folds together whatever is perceptually the same ink,
 * regardless of how many stations the press has.
 */
export function countNaturalFamilies(
  bins: ColorBin[],
  opts: { maxK: number; mergeDeltaE: number; minSignificance: number; seed?: number },
): number {
  if (bins.length === 0) return 0;
  const k = Math.min(bins.length, opts.maxK);
  const initial = kmeansLab(bins, k, { seed: opts.seed ?? 0x5eed });
  const merged = mergeCloseClusters(initial.centers, initial.weights, opts.mergeDeltaE);

  const total = merged.weights.reduce((s, w) => s + w, 0) || 1;
  const significant = merged.weights.filter((w) => w / total >= opts.minSignificance).length;
  return Math.max(1, significant);
}

/**
 * Merges clusters that are perceptually indistinguishable, so a "6 screen"
 * request does not spend two screens on the same navy.
 */
export function mergeCloseClusters(
  centers: Lab[],
  weights: number[],
  thresholdDeltaE: number,
): { centers: Lab[]; weights: number[]; merges: [number, number, number][] } {
  const cs = centers.map((c) => ({ ...c }));
  const ws = weights.slice();
  const alive = cs.map(() => true);
  const merges: [number, number, number][] = [];

  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let bestD = thresholdDeltaE;
    for (let i = 0; i < cs.length; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < cs.length; j++) {
        if (!alive[j]) continue;
        const d = deltaE2000(cs[i], cs[j]);
        if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
      }
    }
    if (bestI < 0) break;
    // Keep the heavier cluster; fold the lighter one into it by weighted mean.
    const [keep, drop] = ws[bestI] >= ws[bestJ] ? [bestI, bestJ] : [bestJ, bestI];
    const tw = ws[keep] + ws[drop];
    cs[keep] = {
      L: (cs[keep].L * ws[keep] + cs[drop].L * ws[drop]) / tw,
      a: (cs[keep].a * ws[keep] + cs[drop].a * ws[drop]) / tw,
      b: (cs[keep].b * ws[keep] + cs[drop].b * ws[drop]) / tw,
    };
    ws[keep] = tw;
    alive[drop] = false;
    merges.push([keep, drop, bestD]);
  }

  const idx = cs.map((_, i) => i).filter((i) => alive[i]);
  idx.sort((a, b) => ws[b] - ws[a] || a - b);
  return { centers: idx.map((i) => cs[i]), weights: idx.map((i) => ws[i]), merges };
}
