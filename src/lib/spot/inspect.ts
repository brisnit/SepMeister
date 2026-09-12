/**
 * Point inspection of a separation.
 *
 * Answers the question a separator actually asks at the screen: how much ink
 * is going down *here*, and what will the dot be after screening?
 *
 * The wording is deliberate throughout. A mask value is **ink coverage** — the
 * fraction of the area the screen will lay ink over. It is not opacity: how
 * opaque that ink ends up is a property of the ink, the mesh, the deposit and
 * the garment, none of which this models. Calling it opacity would invite a
 * separator to trust a number nothing here computed.
 */

import type { InkSeparation } from "@/lib/types";
import { halftoneQuality } from "@/lib/engine/halftone";

export interface InkSample {
  inkId: string;
  name: string;
  displayColor: string;
  /** Raw mask sample, 0..255. */
  mask: number;
  /** Ink coverage before screening, 0..1. */
  coverage: number;
  /** True when this point prints as a solid, not a dot. */
  solid: boolean;
  halftone: { enabled: boolean; lpi: number; angle: number; shape: string };
  /**
   * Dot area this coverage becomes after screening, 0..1.
   *
   * Equal to coverage: the screening matrices are area-normalised, so a
   * requested tone becomes that dot area. Reported separately because that
   * equality is a property of the screening implementation, not a given —
   * an un-normalised spot function would not hold it.
   */
  expectedDotArea: number | null;
}

export interface InspectionResult {
  /** Artwork pixel under the cursor. */
  x: number;
  y: number;
  /** Every visible ink at this point, heaviest coverage first. */
  inks: InkSample[];
  /** Total coverage across all inks, which can exceed 1 where inks stack. */
  totalCoverage: number;
  /** True when no ink prints here — the garment shows through. */
  bare: boolean;
}

function sampleInk(ink: InkSeparation, index: number, filmDpi: number): InkSample {
  const mask = ink.mask[index] ?? 0;
  const coverage = mask / 255;
  const screened = ink.halftone.enabled;

  // A screen cannot hold a dot finer than its cell; below that the reported
  // dot area would be a fiction, so it is withheld rather than guessed.
  const resolvable = screened && halftoneQuality(ink.halftone.lpi, filmDpi).cellPx >= 2;

  return {
    inkId: ink.id,
    name: ink.name,
    displayColor: ink.displayColor,
    mask,
    coverage,
    solid: !screened && coverage >= 0.999,
    halftone: {
      enabled: screened,
      lpi: ink.halftone.lpi,
      angle: ink.halftone.angle,
      shape: ink.halftone.shape,
    },
    expectedDotArea: resolvable ? coverage : null,
  };
}

/**
 * Samples every ink at one artwork pixel.
 *
 * `inks` should already be filtered to what the operator can see, so the
 * readout matches the canvas rather than reporting a hidden screen.
 */
export function inspectPoint(
  inks: InkSeparation[],
  width: number,
  height: number,
  x: number,
  y: number,
  filmDpi: number,
): InspectionResult | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return null;

  const index = py * width + px;
  const samples = inks
    .map((ink) => sampleInk(ink, index, filmDpi))
    .filter((s) => s.mask > 0)
    .sort((a, b) => b.mask - a.mask);

  const totalCoverage = samples.reduce((sum, s) => sum + s.coverage, 0);

  return { x: px, y: py, inks: samples, totalCoverage, bare: samples.length === 0 };
}

/** "73%", or "100% SOLID" where the screen prints solid. */
export function formatCoverage(sample: InkSample): string {
  const pct = Math.round(sample.coverage * 100);
  if (sample.solid) return `${pct}% solid`;
  return `${pct}%`;
}

/** "45 LPI · 22.5° · round", or a plain statement that it prints solid. */
export function formatScreening(sample: InkSample): string {
  if (!sample.halftone.enabled) return "Solid — no halftone";
  return `${sample.halftone.lpi} LPI · ${sample.halftone.angle}° · ${sample.halftone.shape}`;
}
