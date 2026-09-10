/**
 * Similarity metrics between the original artwork and the digital
 * reconstruction of the separations.
 *
 * Reported to the artist as "Digital separation similarity". It measures how
 * faithfully the chosen inks reproduce the artwork *as pixels*; it is not a
 * prediction of how the physical print will look.
 */

import { rgbToLab, deltaE2000 } from "@/lib/color/space";

/** Mean and 95th-percentile CIEDE2000 error between two RGBA buffers. */
export function meanDeltaE(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  n: number,
  step = 1,
): { mean: number; p95: number } {
  const samples: number[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const p = i * 4;
    const d = deltaE2000(
      rgbToLab(a[p], a[p + 1], a[p + 2]),
      rgbToLab(b[p], b[p + 1], b[p + 2]),
    );
    sum += d;
    count++;
    samples.push(d);
  }
  if (count === 0) return { mean: 0, p95: 0 };
  samples.sort((x, y) => x - y);
  return { mean: sum / count, p95: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] };
}

function toGray(a: Uint8ClampedArray, n: number): Float64Array {
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    g[i] = 0.299 * a[p] + 0.587 * a[p + 1] + 0.114 * a[p + 2];
  }
  return g;
}

/**
 * Structural similarity over 8x8 windows on the luminance channel.
 * Catches structural damage -- lost linework, blocked-up detail -- that a
 * mean color error can average away.
 */
export function ssim(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const n = width * height;
  const ga = toGray(a, n);
  const gb = toGray(b, n);
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const win = 8;

  let total = 0;
  let windows = 0;

  for (let by = 0; by + win <= height; by += win) {
    for (let bx = 0; bx + win <= width; bx += win) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = 0; y < win; y++) {
        const row = (by + y) * width + bx;
        for (let x = 0; x < win; x++) {
          const va = ga[row + x];
          const vb = gb[row + x];
          sa += va; sb += vb;
          saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const m = win * win;
      const ma = sa / m;
      const mb = sb / m;
      const va = saa / m - ma * ma;
      const vb = sbb / m - mb * mb;
      const cab = sab / m - ma * mb;
      const s = ((2 * ma * mb + C1) * (2 * cab + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      total += s;
      windows++;
    }
  }
  return windows > 0 ? total / windows : 1;
}

/**
 * Blends color error and structural similarity into a single 0..100 figure.
 *
 * The dE term saturates at 12, roughly the point past which a color is read
 * as simply "wrong" rather than "slightly off", so further error should not
 * keep dragging the score toward zero once that threshold is crossed.
 */
export function similarityPercent(meanDE: number, ssimValue: number): number {
  const colorScore = Math.max(0, 1 - meanDE / 12);
  const structScore = Math.max(0, Math.min(1, ssimValue));
  return Math.round((colorScore * 0.6 + structScore * 0.4) * 100);
}
