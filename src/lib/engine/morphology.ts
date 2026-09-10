/**
 * Grayscale morphology and filtering on single-channel coverage masks.
 *
 * Choke and spread in screen printing are physical: they pull ink in or push
 * it out by a real distance on the film. All radii here are in pixels and the
 * callers convert from a physical spec using the artwork DPI, so a 1px choke
 * request means the same physical amount at 300 and 600 DPI.
 */

export interface Mask {
  width: number;
  height: number;
  data: Uint8ClampedArray; // 0..255 coverage
}

export function createMask(width: number, height: number, fill = 0): Mask {
  const data = new Uint8ClampedArray(width * height);
  if (fill) data.fill(fill);
  return { width, height, data };
}

export function cloneMask(m: Mask): Mask {
  return { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) };
}

/**
 * Separable min/max filter over a square window.
 * Square structuring elements are separable, which keeps this O(n) per axis
 * instead of O(n*r); at 4000px films that difference is seconds vs minutes.
 */
function separableExtremum(m: Mask, radius: number, mode: "min" | "max"): Mask {
  if (radius <= 0) return cloneMask(m);
  const { width: w, height: h, data } = m;
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  const pick = mode === "min" ? Math.min : Math.max;
  const seed = mode === "min" ? 255 : 0;

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = seed;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let i = x0; i <= x1; i++) acc = pick(acc, data[row + i]);
      tmp[row + x] = acc;
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = seed;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let i = y0; i <= y1; i++) acc = pick(acc, tmp[i * w + x]);
      out[y * w + x] = acc;
    }
  }
  return { width: w, height: h, data: out };
}

/** Erosion — pulls coverage inward. This is a choke. */
export function erode(m: Mask, radius: number): Mask {
  return separableExtremum(m, Math.round(radius), "min");
}

/** Dilation — pushes coverage outward. This is a spread / trap. */
export function dilate(m: Mask, radius: number): Mask {
  return separableExtremum(m, Math.round(radius), "max");
}

/**
 * Separable box blur repeated 3x, which closely approximates a Gaussian.
 * Used for edge-aware smoothing of soft membership masks so antialiased
 * boundaries stay smooth instead of fragmenting into speckle.
 */
export function blur(m: Mask, radius: number, passes = 3): Mask {
  if (radius <= 0) return cloneMask(m);
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h } = m;
  let src = new Float32Array(m.data);
  let dst = new Float32Array(w * h);

  for (let p = 0; p < passes; p++) {
    // Horizontal running sum
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let i = 0; i <= r && i < w; i++) sum += src[row + i];
      let count = Math.min(r + 1, w);
      for (let x = 0; x < w; x++) {
        dst[row + x] = sum / count;
        const add = x + r + 1;
        const rem = x - r;
        if (add < w) { sum += src[row + add]; count++; }
        if (rem >= 0) { sum -= src[row + rem]; count--; }
      }
    }
    [src, dst] = [dst, src];
    // Vertical running sum
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = 0; i <= r && i < h; i++) sum += src[i * w + x];
      let count = Math.min(r + 1, h);
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / count;
        const add = y + r + 1;
        const rem = y - r;
        if (add < h) { sum += src[add * w + x]; count++; }
        if (rem >= 0) { sum -= src[rem * w + x]; count--; }
      }
    }
    [src, dst] = [dst, src];
  }

  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(src[i]);
  return { width: w, height: h, data: out };
}

/** a minus b, clamped at 0. Used to knock one ink out of another. */
export function subtractMask(a: Mask, b: Mask): Mask {
  const out = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < out.length; i++) {
    const v = a.data[i] - b.data[i];
    out[i] = v > 0 ? v : 0;
  }
  return { width: a.width, height: a.height, data: out };
}

/** Applies threshold floor and gain. Threshold rescales so tone is preserved. */
export function applyLevels(m: Mask, threshold: number, gain: number): Mask {
  const out = new Uint8ClampedArray(m.data.length);
  const t = Math.max(0, Math.min(254, threshold));
  const span = 255 - t;
  for (let i = 0; i < out.length; i++) {
    const v = m.data[i];
    if (v <= t) { out[i] = 0; continue; }
    out[i] = Math.min(255, Math.round(((v - t) / span) * 255 * gain));
  }
  return { width: m.width, height: m.height, data: out };
}

/** Fraction of pixels carrying any ink, and mean density over those pixels. */
export function maskStats(m: Mask): { coverage: number; meanDensity: number } {
  let inked = 0;
  let sum = 0;
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i];
    if (v > 0) { inked++; sum += v; }
  }
  const total = m.data.length || 1;
  return {
    coverage: inked / total,
    meanDensity: inked > 0 ? sum / inked / 255 : 0,
  };
}

/**
 * Sobel gradient magnitude over a grayscale field, normalized to 0..255.
 * Feeds edge complexity analysis and the registration-risk heuristic.
 */
export function sobelMagnitude(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1];
      const l = gray[i - 1], r = gray[i + 1];
      const bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1];
      const gx = -tl - 2 * l - bl + tr + 2 * r + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      out[i] = Math.min(255, Math.round(Math.hypot(gx, gy) / 4));
    }
  }
  return out;
}

/**
 * Counts connected components above a threshold and reports the smallest and
 * the distribution of areas. Used by the QA panel to flag tiny isolated marks
 * that will not hold on press.
 */
export function componentStats(
  m: Mask,
  threshold = 128,
): { count: number; smallAreas: number; totalArea: number } {
  const { width: w, height: h, data } = m;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  let smallAreas = 0;
  let totalArea = 0;
  // Components under this many pixels are considered fragile detail.
  const SMALL = 12;

  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start] < threshold) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
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
    count++;
    totalArea += area;
    if (area < SMALL) smallAreas++;
  }
  return { count, smallAreas, totalArea };
}
