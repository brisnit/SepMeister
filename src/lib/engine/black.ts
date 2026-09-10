/**
 * Black separation handling.
 *
 * Two distinct questions, often conflated:
 *   1. Does the artwork's black content need its own screen at all?
 *   2. If the garment is black, can the garment simply *be* the black?
 *
 * Answering (2) "yes" is frequently the single biggest ink and cost saving
 * available on a dark-garment job, but only when the artwork's black is a
 * genuine match for the garment and is not carrying fine detail that would
 * lose its crispness by being defined purely by the surrounding inks.
 */

import { hexToLab, deltaE2000, type Lab } from "@/lib/color/space";
import { componentStats, type Mask } from "./morphology";

export interface GarmentBlackAssessment {
  /** Whether the garment can serve as the black without a black screen. */
  canUseGarment: boolean;
  /** Perceptual distance between the artwork black and the garment. */
  deltaE: number;
  reason: string;
}

/**
 * Decides whether a dark cluster can be knocked out to the garment.
 *
 * Requires both a close perceptual match and that the black is acting as a
 * *field* rather than as thin linework. Thin black linework knocked out to the
 * garment depends entirely on the abutting colors registering perfectly; any
 * drift shows as a ragged outline, so we keep a real screen for it.
 */
export function assessGarmentAsBlack(
  blackCenter: Lab,
  garmentHex: string,
  blackMask: Mask,
  isLineArt: boolean,
): GarmentBlackAssessment {
  const garmentLab = hexToLab(garmentHex);
  const dE = deltaE2000(blackCenter, garmentLab);

  if (dE > 12) {
    return {
      canUseGarment: false,
      deltaE: dE,
      reason: `Artwork black differs from the garment by ΔE ${dE.toFixed(1)} — printing it keeps the intended tone.`,
    };
  }

  const stats = componentStats(blackMask, 128);
  // A high count of small components relative to total area indicates
  // linework and small type rather than solid fields.
  const fragility = stats.totalArea > 0 ? stats.smallAreas / Math.max(1, stats.count) : 0;

  if (isLineArt && fragility > 0.3) {
    return {
      canUseGarment: false,
      deltaE: dE,
      reason: "Black is carrying fine linework — knocking it out to the garment would depend on perfect registration.",
    };
  }

  return {
    canUseGarment: true,
    deltaE: dE,
    reason: `Artwork black matches the garment within ΔE ${dE.toFixed(1)} — the garment can supply it, saving a screen.`,
  };
}

/**
 * Reinforces a black screen so outlines and type stay crisp.
 * Coverage above `solidFloor` is driven to full so linework does not print as
 * a halftone, which is where thin black detail usually breaks down.
 */
export function solidifyBlack(mask: Mask, solidFloor = 170): Mask {
  const out = new Uint8ClampedArray(mask.data.length);
  for (let i = 0; i < out.length; i++) {
    const v = mask.data[i];
    out[i] = v >= solidFloor ? 255 : v;
  }
  return { width: mask.width, height: mask.height, data: out };
}
