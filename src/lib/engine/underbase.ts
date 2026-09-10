/**
 * Underbase generation.
 *
 * On a dark garment, colored plastisol is not opaque enough to read on its
 * own; it needs a white base printed first. But blindly whiting out every
 * inked pixel is wrong in two ways: it wastes ink under areas that are
 * deliberately garment-colored, and an unchoked base peeks out from behind
 * the top colors as a white halo the moment registration drifts.
 *
 * This module builds the base from actual ink coverage, chokes it by a
 * physical distance, and optionally pulls it out from under blacks that the
 * garment or black ink can carry unaided.
 */

import { erode, blur, subtractMask, createMask, type Mask } from "./morphology";

export interface UnderbaseOptions {
  /** Choke distance in pixels at the working resolution. */
  chokePx: number;
  /** Scales base density, 0..1. Below 1 gives a "thin" base. */
  strength: number;
  /**
   * When true, regions destined for black ink are removed from the base.
   * Black covers the garment without help, so basing under it wastes ink and
   * adds an unnecessary registration dependency.
   */
  removeUnderBlack: boolean;
  /** Coverage below this is not worth basing (isolated antialias fringe). */
  minCoverage: number;
  /** Softens the choked edge so the base does not alias against the top color. */
  featherPx: number;
}

export const DEFAULT_UNDERBASE: UnderbaseOptions = {
  chokePx: 1,
  strength: 1,
  removeUnderBlack: true,
  minCoverage: 24,
  featherPx: 0.5,
};

/**
 * Converts a choke expressed in pixels-at-preview into pixels at the working
 * resolution, so the physical choke is constant across artwork sizes.
 *
 * The reference is 300 DPI: a 1px choke at 300 DPI is ~0.0033in (~0.085mm),
 * which is a conventional starting choke for spot-color underbases.
 */
export function resolveChokePixels(requestedPx: number, workingDpi: number): number {
  const scale = workingDpi / 300;
  return Math.max(0, requestedPx * scale);
}

export interface BuildUnderbaseInput {
  width: number;
  height: number;
  /** Coverage masks for every ink that will print on top of the base. */
  topMasks: Mask[];
  /** Mask of area the black screen will cover, if one exists. */
  blackMask?: Mask | null;
  options: UnderbaseOptions;
}

export function buildUnderbase(input: BuildUnderbaseInput): Mask {
  const { width, height, topMasks, blackMask, options } = input;

  // 1. Everywhere any ink prints, the garment must be blocked.
  let base = createMask(width, height);
  for (const m of topMasks) {
    for (let i = 0; i < base.data.length; i++) {
      if (m.data[i] > base.data[i]) base.data[i] = m.data[i];
    }
  }

  // 2. Drop coverage too faint to be worth a base.
  if (options.minCoverage > 0) {
    for (let i = 0; i < base.data.length; i++) {
      if (base.data[i] < options.minCoverage) base.data[i] = 0;
    }
  }

  // 3. Remove deliberate black areas the top black ink can handle alone.
  if (options.removeUnderBlack && blackMask) {
    base = subtractMask(base, blackMask);
  }

  // 4. Choke: pull the base in so it hides behind the colors that sit on it.
  const choke = Math.round(options.chokePx);
  if (choke > 0) base = erode(base, choke);

  // 5. Feather the choked edge slightly to avoid a hard alias against the top ink.
  if (options.featherPx > 0) base = blur(base, options.featherPx, 1);

  // 6. Density.
  if (options.strength !== 1) {
    for (let i = 0; i < base.data.length; i++) {
      base.data[i] = Math.round(base.data[i] * options.strength);
    }
  }

  return base;
}
