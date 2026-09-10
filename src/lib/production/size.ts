/**
 * Physical production size and the resolution consequences of it.
 *
 * The single most consequential number in screen-print prepress is the
 * artwork's *effective* resolution at the size it will actually print. A
 * 1200px file is a crisp 4in print and a soft 14in one, and nothing in the
 * file itself says which the artist intended. Everything here exists to make
 * that explicit rather than letting a film silently come out at 90 DPI.
 */

import type { ProductionSize, SizeUnit } from "@/lib/types";

export const CM_PER_IN = 2.54;

/** Resolution we treat as fully press-ready for line work and halftones. */
export const TARGET_DPI = 300;
/** Below this, detail visibly softens on film. */
export const CAUTION_DPI = 200;
/** Below this the film will look obviously soft or pixelated. */
export const MINIMUM_DPI = 150;

export function toInches(value: number, units: SizeUnit): number {
  return units === "cm" ? value / CM_PER_IN : value;
}

export function fromInches(inches: number, units: SizeUnit): number {
  return units === "cm" ? inches * CM_PER_IN : inches;
}

export function formatSize(size: ProductionSize, decimals = 2): string {
  const w = fromInches(size.widthIn, size.units);
  const h = fromInches(size.heightIn, size.units);
  return `${w.toFixed(decimals)} × ${h.toFixed(decimals)} ${size.units}`;
}

/**
 * Default production size for freshly-loaded artwork.
 *
 * Uses the file's declared resolution when it has one, since that is the
 * artist's stated intent. Otherwise assumes 300 DPI, which yields a sensible
 * size for artwork actually prepared for print, and is surfaced in the UI as
 * an assumption rather than a fact.
 */
export function defaultProductionSize(
  pixelWidth: number,
  pixelHeight: number,
  declaredDpi: number | null,
): ProductionSize {
  const dpi = declaredDpi && declaredDpi >= 72 && declaredDpi <= 2400 ? declaredDpi : TARGET_DPI;
  return {
    widthIn: pixelWidth / dpi,
    heightIn: pixelHeight / dpi,
    units: "in",
    lockAspect: true,
  };
}

/** Resolution the artwork actually resolves to at its production size. */
export function effectiveDpi(pixelWidth: number, size: ProductionSize): number {
  if (size.widthIn <= 0) return 0;
  return pixelWidth / size.widthIn;
}

export type ResolutionLevel = "good" | "caution" | "low";

export interface ResolutionAssessment {
  dpi: number;
  level: ResolutionLevel;
  /** Width in inches at which this artwork would hit TARGET_DPI. */
  targetWidthIn: number;
  message: string | null;
  recommendation: string | null;
}

/**
 * Grades the artwork's resolution at the chosen size and says what size would
 * reach 300 DPI. Never rescales anything -- the artist decides.
 */
export function assessResolution(
  pixelWidth: number,
  size: ProductionSize,
  units: SizeUnit = size.units,
): ResolutionAssessment {
  const dpi = effectiveDpi(pixelWidth, size);
  const targetWidthIn = pixelWidth / TARGET_DPI;
  const shownWidth = fromInches(size.widthIn, units);
  const shownTarget = fromInches(targetWidthIn, units);
  const unitLabel = units === "cm" ? "cm" : "inches";

  if (dpi >= TARGET_DPI) {
    return { dpi, level: "good", targetWidthIn, message: null, recommendation: null };
  }

  const level: ResolutionLevel = dpi >= CAUTION_DPI ? "caution" : "low";
  const verb = level === "caution" ? "is below the 300 DPI target" : "is low";

  return {
    dpi,
    level,
    targetWidthIn,
    message:
      `At ${shownWidth.toFixed(2)} ${unitLabel} wide this artwork outputs at approximately ` +
      `${Math.round(dpi)} DPI, which ${verb}.`,
    recommendation:
      `For ${TARGET_DPI} DPI, print at about ${shownTarget.toFixed(2)} ${unitLabel} wide, ` +
      `or supply artwork at ${Math.round(pixelWidth * (TARGET_DPI / Math.max(1, dpi)))}px wide.`,
  };
}

/**
 * Applies a new width or height, preserving aspect ratio when locked.
 * Values arrive in the size's display units and are stored as inches.
 */
export function resizeProduction(
  size: ProductionSize,
  axis: "width" | "height",
  value: number,
  pixelWidth: number,
  pixelHeight: number,
): ProductionSize {
  const inches = Math.max(0.1, toInches(value, size.units));
  if (!size.lockAspect) {
    return axis === "width" ? { ...size, widthIn: inches } : { ...size, heightIn: inches };
  }
  // Lock to the artwork's own pixel aspect, not the current inch values,
  // so repeated edits cannot drift the proportions.
  const aspect = pixelHeight / Math.max(1, pixelWidth);
  return axis === "width"
    ? { ...size, widthIn: inches, heightIn: inches * aspect }
    : { ...size, heightIn: inches, widthIn: inches / Math.max(0.0001, aspect) };
}

/** Switches display units without changing the physical size. */
export function convertUnits(size: ProductionSize, units: SizeUnit): ProductionSize {
  return { ...size, units };
}

/** Overall film sheet size, artwork plus the registration margin. */
export function filmSize(size: ProductionSize, marginIn: number): { widthIn: number; heightIn: number } {
  return { widthIn: size.widthIn + marginIn * 2, heightIn: size.heightIn + marginIn * 2 };
}

/** Common transparency sheet sizes, for a "will it fit" check. */
export const FILM_SHEET_SIZES = [
  { label: "8.5 × 11 in", widthIn: 8.5, heightIn: 11 },
  { label: "11 × 17 in", widthIn: 11, heightIn: 17 },
  { label: "13 × 19 in", widthIn: 13, heightIn: 19 },
  { label: "17 × 22 in", widthIn: 17, heightIn: 22 },
];

/** Smallest common sheet the film fits on, in either orientation. */
export function smallestSheetFor(widthIn: number, heightIn: number): string | null {
  for (const sheet of FILM_SHEET_SIZES) {
    const fits =
      (widthIn <= sheet.widthIn && heightIn <= sheet.heightIn) ||
      (widthIn <= sheet.heightIn && heightIn <= sheet.widthIn);
    if (fits) return sheet.label;
  }
  return null;
}
