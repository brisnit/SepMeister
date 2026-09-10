/**
 * Film positive rendering.
 *
 * A film positive is opaque black where ink prints and clear everywhere else.
 * The ink's color is metadata only -- it never appears on the film -- so every
 * renderer here emits monochrome artwork regardless of the separation's
 * assigned color.
 */

import { encodePng } from "./png";
import { halftoneMask, type HalftoneParams } from "@/lib/engine/halftone";
import type { Mask } from "@/lib/engine/morphology";

export interface FilmRasterOptions {
  /** Screen the mask into dots before rendering. */
  halftone: HalftoneParams | null;
  /** Resolution stamped into the PNG so it opens at true physical size. */
  dpi: number;
  /**
   * Emit the film inverted (white artwork on black). Some RIPs and imagesetters
   * expect a negative; almost all shop workflows want the positive.
   */
  negative?: boolean;
}

/**
 * Converts a coverage mask into film pixels.
 *
 * Coverage 255 (full ink) becomes 0 (black on film); coverage 0 becomes 255
 * (clear). Continuous-tone coverage is preserved as grey unless halftoned,
 * which lets the artist see tonality on screen before committing to a screen
 * ruling.
 */
export function maskToFilmGray(mask: Mask, opts: FilmRasterOptions): Uint8Array {
  const screened = opts.halftone ? halftoneMask(mask, opts.halftone) : mask;
  const out = new Uint8Array(screened.data.length);
  if (opts.negative) {
    for (let i = 0; i < out.length; i++) out[i] = screened.data[i];
  } else {
    for (let i = 0; i < out.length; i++) out[i] = 255 - screened.data[i];
  }
  return out;
}

/** Film as a standalone grayscale PNG at the artwork's pixel dimensions. */
export function renderFilmPng(mask: Mask, opts: FilmRasterOptions): Uint8Array {
  const gray = maskToFilmGray(mask, opts);
  return encodePng(gray, mask.width, mask.height, "gray", { dpi: opts.dpi });
}

/**
 * Verifies a rendered film really is monochrome -- only pure black and pure
 * white, no residual ink color and no antialiased greys that a RIP would have
 * to threshold unpredictably. Used by the export tests.
 */
export function isMonochrome(gray: Uint8Array): boolean {
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] !== 0 && gray[i] !== 255) return false;
  }
  return true;
}

/** Fraction of the film that is black (i.e. carries ink). */
export function filmInkArea(gray: Uint8Array): number {
  let black = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] < 128) black++;
  return black / (gray.length || 1);
}
