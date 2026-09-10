/**
 * Soft-membership separation masks.
 *
 * The naive approach -- select pixels whose color equals an ink -- destroys
 * antialiased artwork: every edge pixel is a blend that matches no ink, so
 * edges either vanish or fragment into speckle.
 *
 * Instead each pixel is assigned a *distribution* over inks derived from
 * perceptual distance, using inverse-distance weighting over the K nearest
 * inks. That choice matters. A Gaussian falloff assigns weight by absolute
 * distance, so two inks that merely sit close together in LAB -- cream and
 * white, say, ~15 units apart -- bleed into each other everywhere, laying a
 * low-density haze of white over every cream pixel. Inverse-distance weighting
 * is scale-free: a pixel sitting exactly on an ink gets that ink at full
 * coverage no matter how crowded the palette is, and a pixel halfway between
 * two inks splits 50/50.
 *
 * The weighting is also *exact* for the case that dominates real artwork. An
 * antialiased edge pixel is a linear blend of two inks; with K=2 and power 1
 * the recovered weights are exactly the blend fractions, so the edge
 * reconstructs at the correct tone with no halo and no phantom third ink.
 */

import { rgbToLab, labDistSq, type Lab } from "@/lib/color/space";
import { blur, createMask, type Mask } from "./morphology";

export interface MembershipOptions {
  /**
   * How many inks may share a single pixel. 2 keeps edges exact and screens
   * clean (spot color); 3+ lets inks build tone together (simulated process).
   */
  maxInksPerPixel?: number;
  /**
   * Sharpness of the falloff. 1 is linear in LAB distance -- exact for
   * antialiased blends. Higher values bias toward the nearest ink, producing
   * harder, more index-like separations.
   */
  power?: number;
  /** Inks whose weight falls below this fraction of the winner are dropped. */
  cutoff?: number;
  /** Pixels with alpha under this are treated as no-ink. */
  alphaFloor?: number;
  /** Post-blur radius, smooths membership noise without softening real edges. */
  smoothRadius?: number;
}

/** Distance below which a pixel is treated as sitting exactly on an ink. */
const EXACT_MATCH_EPSILON = 1e-6;

/**
 * Builds one coverage mask per center.
 *
 * Returns one mask per center, in order. Knockout centers -- the garment, a
 * removed background -- are passed in as ordinary centers so they compete for
 * pixels and correctly win the ones that belong to them. Their masks are
 * returned rather than discarded, because the caller needs to know which area
 * was knocked out in order to score the separation fairly.
 */
export function buildMembershipMasks(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  centers: Lab[],
  opts: MembershipOptions = {},
): Mask[] {
  const n = width * height;
  const k = centers.length;
  const maxInks = Math.max(1, Math.min(opts.maxInksPerPixel ?? 2, k));
  const power = opts.power ?? 1;
  const cutoff = opts.cutoff ?? 0.02;
  const alphaFloor = opts.alphaFloor ?? 8;
  const smoothRadius = opts.smoothRadius ?? 0;
  const masks: Mask[] = [];
  for (let i = 0; i < k; i++) masks.push(createMask(width, height));

  // Scratch buffers for the per-pixel top-K selection, allocated once.
  const bestIdx = new Int32Array(maxInks);
  const bestDist = new Float64Array(maxInks);
  const weight = new Float64Array(maxInks);

  // Cache LAB per distinct RGB, since illustrations repeat colors heavily.
  const labCache = new Map<number, Lab>();

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = pixels[p + 3];
    if (a < alphaFloor) continue;

    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    const key = (r << 16) | (g << 8) | b;
    let lab = labCache.get(key);
    if (lab === undefined) {
      lab = rgbToLab(r, g, b);
      // Bound cache growth on photographic artwork.
      if (labCache.size < 1 << 17) labCache.set(key, lab);
    }

    // Partial insertion sort to find the K nearest centers. K is small
    // (2-3), so this beats sorting all centers per pixel.
    bestDist.fill(Infinity);
    bestIdx.fill(-1);
    for (let c = 0; c < k; c++) {
      const d2 = labDistSq(lab, centers[c]);
      if (d2 >= bestDist[maxInks - 1]) continue;
      let slot = maxInks - 1;
      while (slot > 0 && bestDist[slot - 1] > d2) {
        bestDist[slot] = bestDist[slot - 1];
        bestIdx[slot] = bestIdx[slot - 1];
        slot--;
      }
      bestDist[slot] = d2;
      bestIdx[slot] = c;
    }

    const alphaScale = (a / 255) * 255;

    // A pixel sitting on an ink belongs entirely to that ink. Without this
    // short circuit the reciprocal below divides by zero, and flat interiors
    // are exactly this case.
    if (bestDist[0] <= EXACT_MATCH_EPSILON) {
      const idx = bestIdx[0];
      if (idx >= 0) masks[idx].data[i] = Math.round(alphaScale);
      continue;
    }

    let sum = 0;
    let maxW = 0;
    for (let s = 0; s < maxInks; s++) {
      if (bestIdx[s] < 0 || !isFinite(bestDist[s])) { weight[s] = 0; continue; }
      // bestDist holds squared distances; sqrt gives true LAB distance so
      // power 1 is linear in the perceptual blend.
      const d = Math.sqrt(bestDist[s]);
      const w = 1 / Math.pow(d, power);
      weight[s] = w;
      sum += w;
      if (w > maxW) maxW = w;
    }
    if (sum <= 0) continue;

    // Suppress negligible contributors, then renormalize so total coverage
    // across the screens stays at exactly the pixel's opacity.
    const floor = maxW * cutoff;
    let kept = 0;
    for (let s = 0; s < maxInks; s++) {
      if (weight[s] < floor) weight[s] = 0;
      kept += weight[s];
    }
    if (kept <= 0) continue;

    for (let s = 0; s < maxInks; s++) {
      const w = weight[s];
      if (w === 0) continue;
      masks[bestIdx[s]].data[i] = Math.round((w / kept) * alphaScale);
    }
  }

  if (smoothRadius > 0) return masks.map((m) => blur(m, smoothRadius, 1));
  return masks;
}

/**
 * Removes isolated specks below a minimum area.
 *
 * Membership competition along a busy antialiased boundary can leave a few
 * stray pixels on a screen that has no business being there. On film these
 * become pinholes and dust-sized dots that either will not expose or will
 * print as flecks, and they inflate every shape-count heuristic downstream.
 */
export function despeckle(mask: Mask, minArea: number, threshold = 96): Mask {
  if (minArea <= 1) return { width: mask.width, height: mask.height, data: new Uint8ClampedArray(mask.data) };
  const { width: w, height: h, data } = mask;
  const out = new Uint8ClampedArray(data);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const region = new Int32Array(w * h);

  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start] < threshold) continue;
    let sp = 0;
    let rp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      region[rp++] = p;
      const px = p % w;
      const py = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (seen[np] || data[np] < threshold) continue;
          seen[np] = 1;
          stack[sp++] = np;
        }
      }
    }
    if (rp < minArea) {
      for (let i = 0; i < rp; i++) out[region[i]] = 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Fraction of the artboard where any of the given masks lays ink. */
export function unionCoverage(masks: Mask[]): number {
  if (masks.length === 0) return 0;
  const n = masks[0].data.length;
  let inked = 0;
  for (let i = 0; i < n; i++) {
    for (const m of masks) {
      if (m.data[i] > 0) { inked++; break; }
    }
  }
  return inked / (n || 1);
}
