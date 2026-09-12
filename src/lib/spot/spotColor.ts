/**
 * The named-ink model.
 *
 * A separation is not "a PNG that happens to look red". Downstream — a RIP, an
 * imagesetter, a press ticket — it is a *named physical ink* with a plate of
 * its own, and everything from the plate name in a PDF to what the operator
 * pulls off the shelf depends on that identity surviving. This is the shape
 * that carries it.
 */

import { hexToRgb, rgbToLab, labToRgb, rgbToHex } from "@/lib/color/space";
import type { InkSeparation, UnderbaseRelationship } from "@/lib/types";

/** CMYK in 0..1, the alternate space a Separation falls back to. */
export interface Cmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface SpotColor {
  id: string;
  /** Plate name. This is what appears in the PDF and on the press ticket. */
  name: string;
  /** Screen preview colour. */
  displayColor: string;
  /** Free-text book reference, e.g. "PANTONE 186 C". Never inferred. */
  pantoneReference: string | null;
  alternateRgb: [number, number, number];
  alternateCmyk: Cmyk;
  printOrder: number;
  mesh: number;
  halftoneEnabled: boolean;
  lpi: number;
  angle: number;
  dotShape: string;
  underbaseRelationship: UnderbaseRelationship;
  underbaseContribution: number;
  /** Coverage, 0 = no ink, 255 = full. */
  mask: Uint8ClampedArray;
  /** Role, so a base or a highlight can be told from a spot downstream. */
  role: InkSeparation["type"];
}

/**
 * Converts RGB to CMYK for the Separation alternate space.
 *
 * Deliberately the naive conversion rather than a profiled one. The alternate
 * space only drives on-screen preview and composite proofing; the RIP images
 * the named plate, not this. A profiled transform here would imply a colour
 * accuracy the rest of the pipeline does not claim.
 */
export function rgbToCmyk(r: number, g: number, b: number): Cmyk {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  const d = 1 - k;
  return {
    c: (1 - rn - k) / d,
    m: (1 - gn - k) / d,
    y: (1 - bn - k) / d,
    k,
  };
}

/**
 * Plate name, normalized for a PDF colourant name.
 *
 * Uppercased because that is how separations are conventionally listed on a
 * press ticket, and stripped of characters that would need escaping in a PDF
 * name object. Uniqueness is the caller's responsibility -- two plates sharing
 * a name would merge in the RIP.
 */
export function plateName(name: string): string {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 .+\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "SPOT";
}

/** Ensures every plate name in a job is distinct. */
export function uniquePlateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const base = plateName(raw);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} ${n + 1}`;
  });
}

/** Builds the spot document for a job, in print order. */
export function toSpotColors(inks: InkSeparation[]): SpotColor[] {
  const ordered = [...inks].sort((a, b) => a.order - b.order);
  const names = uniquePlateNames(ordered.map((i) => i.name));

  return ordered.map((ink, i) => {
    const [r, g, b] = hexToRgb(ink.displayColor);
    return {
      id: ink.id,
      name: names[i],
      displayColor: ink.displayColor,
      pantoneReference: extractPantone(ink.name),
      alternateRgb: [r, g, b],
      alternateCmyk: rgbToCmyk(r, g, b),
      printOrder: i,
      mesh: ink.mesh,
      halftoneEnabled: ink.halftone.enabled,
      lpi: ink.halftone.lpi,
      angle: ink.halftone.angle,
      dotShape: ink.halftone.shape,
      underbaseRelationship: ink.underbase,
      underbaseContribution: ink.underbaseContribution,
      mask: ink.mask,
      role: ink.type,
    };
  });
}

/**
 * Recognises a Pantone reference the artist typed into the ink name.
 *
 * Only ever *extracted*, never guessed. Mapping an arbitrary RGB value onto a
 * Pantone number would be a fabrication -- the books are measured under
 * controlled light on specified stock, and inventing a match would put a
 * number on a press ticket that nobody verified.
 */
export function extractPantone(name: string): string | null {
  const m = name.match(/\b(?:PANTONE|PMS)\s*([0-9]{1,4}\s*[A-Z]{0,2})\b/i);
  if (!m) return null;
  return `PANTONE ${m[1].toUpperCase().replace(/\s+/g, " ").trim()}`;
}

/** Ink coverage at a point, 0..1, for the inspector. */
export function coverageAt(mask: Uint8ClampedArray, index: number): number {
  if (index < 0 || index >= mask.length) return 0;
  return mask[index] / 255;
}

/**
 * A perceptually neutral label for a spot colour, used where a name is absent.
 * Round-trips through LAB so the swatch shown matches the plate's own colour.
 */
export function normalizeDisplayColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const [nr, ng, nb] = labToRgb(rgbToLab(r, g, b));
  return rgbToHex(nr, ng, nb);
}
