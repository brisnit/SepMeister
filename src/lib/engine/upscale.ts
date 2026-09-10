/**
 * Artwork upscaling to a target working resolution.
 *
 * This does NOT create detail. Interpolating a 143 DPI file up to 300 DPI
 * recovers nothing that was not in the original, and the UI says so plainly
 * rather than implying an enhancement.
 *
 * What it does buy is real, and one of it is a correctness fix:
 *
 *  1. Choke, spread and despeckle are specified in physical units and
 *     converted to pixels against the working resolution. At 143 DPI a 1px
 *     choke resolves to 0.48px, which rounds to zero -- the control silently
 *     does nothing. Separating at 300 DPI gives those operations the
 *     granularity they need to act at all.
 *
 *  2. Membership is evaluated per pixel, so ink boundaries land on a finer
 *     grid. Edges that would step in coarse jags follow the artwork's own
 *     contour instead, which is what actually exposes on film.
 *
 * Catmull-Rom is used rather than bilinear because it holds edge contrast.
 * Bilinear softens exactly the boundaries a separation depends on.
 */

import type { RasterImage } from "@/lib/demo/artwork";

/**
 * Ceiling on the upscaled working raster.
 *
 * Separation runs over every pixel several times, and the masks are held one
 * byte per pixel per screen. At 16 screens a 24-megapixel raster is already
 * ~400MB of masks alone, which is the point where a browser tab becomes
 * unreliable rather than merely slow.
 */
export const MAX_UPSCALED_PIXELS = 24_000_000;

/** Resolution the upscale targets, and the threshold below which it is offered. */
export const TARGET_WORKING_DPI = 300;

export interface UpscalePlan {
  /** Whether upscaling would do anything useful. */
  needed: boolean;
  targetWidth: number;
  targetHeight: number;
  /** Resolution actually reachable, which may be below the target if capped. */
  resultingDpi: number;
  capped: boolean;
  factor: number;
}

/**
 * Works out the raster needed to hit the target resolution at the print size.
 *
 * Returns `needed: false` when the artwork is already at or above target, so
 * callers never resample for no reason -- doing so would only soften it.
 */
export function planUpscale(
  pixelWidth: number,
  pixelHeight: number,
  widthIn: number,
  targetDpi = TARGET_WORKING_DPI,
): UpscalePlan {
  const currentDpi = widthIn > 0 ? pixelWidth / widthIn : 0;
  if (currentDpi <= 0 || currentDpi >= targetDpi) {
    return {
      needed: false, targetWidth: pixelWidth, targetHeight: pixelHeight,
      resultingDpi: currentDpi, capped: false, factor: 1,
    };
  }

  let factor = targetDpi / currentDpi;
  let w = Math.round(pixelWidth * factor);
  let h = Math.round(pixelHeight * factor);
  let capped = false;

  if (w * h > MAX_UPSCALED_PIXELS) {
    capped = true;
    const scale = Math.sqrt(MAX_UPSCALED_PIXELS / (w * h));
    w = Math.max(pixelWidth, Math.floor(w * scale));
    h = Math.max(pixelHeight, Math.floor(h * scale));
    factor = w / pixelWidth;
  }

  // A tiny upscale is not worth the memory or the softening.
  if (factor < 1.15) {
    return {
      needed: false, targetWidth: pixelWidth, targetHeight: pixelHeight,
      resultingDpi: currentDpi, capped: false, factor: 1,
    };
  }

  return {
    needed: true,
    targetWidth: w,
    targetHeight: h,
    resultingDpi: widthIn > 0 ? w / widthIn : targetDpi,
    capped,
    factor,
  };
}

/** Catmull-Rom basis. Sums to 1 across the four taps, so flat fields stay flat. */
function catmullRom(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ];
}

function clampIndex(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * Bicubic (Catmull-Rom) resample of straight-alpha RGBA.
 *
 * Colour is interpolated in premultiplied space and un-premultiplied
 * afterwards. Interpolating straight alpha would pull the colour of
 * transparent pixels into their opaque neighbours, fringing every edge of a
 * knocked-out design with whatever happened to sit in the transparent area.
 */
export function upscaleRgba(
  pixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8ClampedArray {
  if (dstWidth === srcWidth && dstHeight === srcHeight) {
    return new Uint8ClampedArray(pixels);
  }

  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  const maxX = srcWidth - 1;
  const maxY = srcHeight - 1;

  // Premultiplied source, computed once.
  const pr = new Float32Array(srcWidth * srcHeight);
  const pg = new Float32Array(srcWidth * srcHeight);
  const pb = new Float32Array(srcWidth * srcHeight);
  const pa = new Float32Array(srcWidth * srcHeight);
  for (let i = 0, n = srcWidth * srcHeight; i < n; i++) {
    const p = i * 4;
    const a = pixels[p + 3] / 255;
    pr[i] = pixels[p] * a;
    pg[i] = pixels[p + 1] * a;
    pb[i] = pixels[p + 2] * a;
    pa[i] = a;
  }

  for (let dy = 0; dy < dstHeight; dy++) {
    // Map destination pixel centres back into source space.
    const sy = (dy + 0.5) * yRatio - 0.5;
    const y0 = Math.floor(sy);
    const wy = catmullRom(sy - y0);

    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = (dx + 0.5) * xRatio - 0.5;
      const x0 = Math.floor(sx);
      const wx = catmullRom(sx - x0);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let j = 0; j < 4; j++) {
        const yy = clampIndex(y0 - 1 + j, maxY);
        const row = yy * srcWidth;
        const cy = wy[j];
        if (cy === 0) continue;
        for (let i = 0; i < 4; i++) {
          const xx = clampIndex(x0 - 1 + i, maxX);
          const w = cy * wx[i];
          if (w === 0) continue;
          const s = row + xx;
          r += pr[s] * w;
          g += pg[s] * w;
          b += pb[s] * w;
          a += pa[s] * w;
        }
      }

      const d = (dy * dstWidth + dx) * 4;
      // Catmull-Rom overshoots at high-contrast edges; clamping is what keeps
      // that ringing from becoming out-of-range colour.
      const alpha = a < 0 ? 0 : a > 1 ? 1 : a;
      if (alpha > 0) {
        out[d] = Math.round(r / alpha);
        out[d + 1] = Math.round(g / alpha);
        out[d + 2] = Math.round(b / alpha);
      }
      out[d + 3] = Math.round(alpha * 255);
    }
  }

  return out;
}

/** Applies a plan, returning the artwork unchanged when no upscale is needed. */
export function applyUpscale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  plan: UpscalePlan,
): RasterImage {
  if (!plan.needed) return { width, height, pixels: new Uint8ClampedArray(pixels) };
  return {
    width: plan.targetWidth,
    height: plan.targetHeight,
    pixels: upscaleRgba(pixels, width, height, plan.targetWidth, plan.targetHeight),
  };
}
