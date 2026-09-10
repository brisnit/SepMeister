/**
 * Coverage-mask resampling for film output.
 *
 * Films are output at device resolution -- 600 or 1200 DPI -- so halftone dots
 * land on a fine enough grid to be round rather than blocky. The artwork's own
 * effective resolution is usually lower than that, so the coverage mask is
 * resampled up before screening.
 *
 * This does not invent detail. It interpolates a continuous-tone coverage
 * field so the *dot geometry* is rendered at device resolution; the tonal
 * information is still exactly what the artwork carried. The distinction
 * matters and the UI reports the two resolutions separately.
 */

import type { Mask } from "@/lib/engine/morphology";

/**
 * Bilinear resample to an explicit pixel size.
 *
 * Bilinear rather than nearest because a hard-edged upscale would quantize the
 * antialiased boundaries the separation engine works hard to preserve, and
 * those edges are exactly where halftone dots need smooth tone.
 */
export function resampleMask(mask: Mask, targetWidth: number, targetHeight: number): Mask {
  const { width: sw, height: sh, data } = mask;
  if (targetWidth === sw && targetHeight === sh) {
    return { width: sw, height: sh, data: new Uint8ClampedArray(data) };
  }
  if (targetWidth <= 0 || targetHeight <= 0) {
    return { width: sw, height: sh, data: new Uint8ClampedArray(data) };
  }

  const out = new Uint8ClampedArray(targetWidth * targetHeight);
  // Map destination pixel centers back into source space.
  const xRatio = sw / targetWidth;
  const yRatio = sh / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const sy = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const y0c = Math.min(sh - 1, Math.max(0, y0));
    const y1c = Math.min(sh - 1, Math.max(0, y0 + 1));

    for (let x = 0; x < targetWidth; x++) {
      const sx = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x0c = Math.min(sw - 1, Math.max(0, x0));
      const x1c = Math.min(sw - 1, Math.max(0, x0 + 1));

      const p00 = data[y0c * sw + x0c];
      const p10 = data[y0c * sw + x1c];
      const p01 = data[y1c * sw + x0c];
      const p11 = data[y1c * sw + x1c];

      const top = p00 + (p10 - p00) * fx;
      const bottom = p01 + (p11 - p01) * fx;
      out[y * targetWidth + x] = Math.round(top + (bottom - top) * fy);
    }
  }

  return { width: targetWidth, height: targetHeight, data: out };
}

/**
 * Ceiling on a single film's raster, in pixels.
 *
 * Sized so ordinary shop output is never silently downgraded: a 12 x 15in
 * print at 600 DPI is 64.8 megapixels and an 11 x 17 is 67, both of which must
 * render at full resolution. The cap exists only to stop a large print at 1200
 * DPI from trying to allocate hundreds of megabytes in a browser tab, and when
 * it bites the caller is told so rather than quietly getting less than it
 * asked for.
 */
export const MAX_FILM_PIXELS = 120_000_000;

export interface FilmRasterPlan {
  width: number;
  height: number;
  /** Resolution actually achieved, which may be below the request if capped. */
  dpi: number;
  capped: boolean;
}

export function planFilmRaster(
  widthIn: number,
  heightIn: number,
  requestedDpi: number,
  sourceWidth: number,
  sourceHeight: number,
): FilmRasterPlan {
  const ideal = Math.max(1, Math.round(widthIn * requestedDpi));
  const idealH = Math.max(1, Math.round(heightIn * requestedDpi));

  // Never downsample below the artwork's own detail; that would throw away
  // information the separation actually contains.
  const width = Math.max(ideal, sourceWidth);
  const height = Math.max(idealH, sourceHeight);

  if (width * height <= MAX_FILM_PIXELS) {
    return { width, height, dpi: widthIn > 0 ? width / widthIn : requestedDpi, capped: false };
  }

  const scale = Math.sqrt(MAX_FILM_PIXELS / (width * height));
  const cw = Math.max(sourceWidth, Math.floor(width * scale));
  const ch = Math.max(sourceHeight, Math.floor(height * scale));
  return { width: cw, height: ch, dpi: widthIn > 0 ? cw / widthIn : requestedDpi, capped: true };
}
