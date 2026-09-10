/**
 * Artwork analysis. Produces the facts the planner needs to choose a strategy,
 * and the facts the artist needs to sanity-check the upload.
 */

import { rgbToLab, rgbToHex, relativeLuminance, hexToRgb } from "@/lib/color/space";
import { sobelMagnitude } from "./morphology";
import { buildHistogram, type ColorBin } from "./cluster";
import type { ImageAnalysis } from "@/lib/types";

/** Ceiling on exact unique-color counting; above this we report "more than". */
const UNIQUE_CEILING = 200000;

export function countUniqueColors(
  pixels: Uint8ClampedArray,
  n: number,
): { count: number; exact: boolean } {
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (pixels[p + 3] < 8) continue;
    seen.add((pixels[p] << 16) | (pixels[p + 1] << 8) | pixels[p + 2]);
    if (seen.size > UNIQUE_CEILING) return { count: UNIQUE_CEILING, exact: false };
  }
  return { count: seen.size, exact: true };
}

/** Luminance channel (0..255) used for edge and tone analysis. */
export function luminanceChannel(pixels: Uint8ClampedArray, n: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    // Perceptual weighting on gamma-encoded values is adequate for edges.
    out[i] = Math.round(0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]);
  }
  return out;
}

/**
 * Detects a background color by sampling the border ring.
 *
 * Returns null when the border is transparent (already knocked out) or when
 * the border has no dominant color, which usually means the artwork bleeds to
 * the edge and there is nothing to knock out.
 */
export function detectBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { hex: string | null; transparentBorder: boolean } {
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.02));
  const counts = new Map<number, number>();
  let transparent = 0;
  let total = 0;

  const consider = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    total++;
    if (pixels[i + 3] < 16) { transparent++; return; }
    // Quantize to 4 bits/channel so antialiasing does not split the vote.
    const key = ((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (let y = 0; y < height; y++) {
    const edgeRow = y < ring || y >= height - ring;
    for (let x = 0; x < width; x++) {
      if (edgeRow || x < ring || x >= width - ring) consider(x, y);
    }
  }

  if (total === 0) return { hex: null, transparentBorder: false };
  if (transparent / total > 0.6) return { hex: null, transparentBorder: true };

  let bestKey = -1;
  let bestCount = 0;
  for (const [k, c] of counts) if (c > bestCount) { bestCount = c; bestKey = k; }
  // Require a real majority of the opaque border before calling it a background.
  const opaque = total - transparent;
  if (bestKey < 0 || bestCount / Math.max(1, opaque) < 0.5) {
    return { hex: null, transparentBorder: false };
  }
  const r = ((bestKey >> 8) & 0xf) * 17;
  const g = ((bestKey >> 4) & 0xf) * 17;
  const b = (bestKey & 0xf) * 17;
  return { hex: rgbToHex(r, g, b), transparentBorder: false };
}

export interface AnalyzeResult extends ImageAnalysis {
  bins: ColorBin[];
  edges: Uint8ClampedArray;
  luma: Uint8ClampedArray;
}

export function analyzeArtwork(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): AnalyzeResult {
  const n = width * height;
  const luma = luminanceChannel(pixels, n);
  const edges = sobelMagnitude(luma, width, height);

  let alphaSum = 0;
  let transparentCount = 0;
  let lumSum = 0;
  let satSum = 0;
  let darkCount = 0;
  let lightCount = 0;
  let opaqueCount = 0;
  let hasPartialAlpha = false;

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = pixels[p + 3];
    alphaSum += a;
    if (a < 8) { transparentCount++; continue; }
    if (a < 250) hasPartialAlpha = true;
    opaqueCount++;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    const lum = relativeLuminance(r, g, b);
    lumSum += lum;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
    if (lum < 0.06) darkCount++;
    if (lum > 0.75) lightCount++;
  }

  const opaque = Math.max(1, opaqueCount);

  // Edge complexity: share of opaque pixels sitting on a strong gradient.
  let strongEdge = 0;
  let softRamp = 0;
  for (let i = 0; i < n; i++) {
    if (pixels[i * 4 + 3] < 8) continue;
    const e = edges[i];
    if (e > 60) strongEdge++;
    else if (e > 6 && e <= 24) softRamp++; // shallow slope => tonal ramp
  }

  const edgeComplexity = strongEdge / opaque;
  const gradientRatio = softRamp / opaque;

  const unique = countUniqueColors(pixels, n);
  const bg = detectBackground(pixels, width, height);
  const bins = buildHistogram(pixels, width, height, { bits: 5, edgeMask: edges, edgeWeight: 0.25 });

  const totalBinWeight = bins.reduce((s, b) => s + b.weight, 0) || 1;
  const dominantColors = bins.slice(0, 12).map((b) => ({
    hex: rgbToHex(b.r, b.g, b.b),
    weight: b.weight / totalBinWeight,
  }));

  // Artwork character. Line art is dominated by a couple of flat colors with
  // hard edges; photographic work has many bins and broad tonal ramps.
  const binsAbove1pct = bins.filter((b) => b.weight / totalBinWeight > 0.01).length;
  let artworkType: ImageAnalysis["artworkType"];
  if (unique.count < 32 && edgeComplexity < 0.2) artworkType = "line-art";
  else if (binsAbove1pct > 18 || (gradientRatio > 0.35 && unique.count > 20000)) artworkType = "photographic";
  else artworkType = "illustration";

  const isLineArt =
    artworkType === "line-art" ||
    (binsAbove1pct <= 5 && edgeComplexity > 0.05 && gradientRatio < 0.2);

  const notes: string[] = [];
  if (bg.transparentBorder) notes.push("Transparent background detected — artwork is already knocked out.");
  else if (bg.hex) notes.push(`Solid background detected at ${bg.hex}.`);
  if (hasPartialAlpha) notes.push("Artwork contains soft/antialiased alpha edges.");
  if (gradientRatio > 0.25) notes.push("Significant tonal gradients present — halftones recommended.");
  if (unique.count > 5000) notes.push(`${unique.exact ? "" : "More than "}${unique.count.toLocaleString()} unique colors require perceptual reduction.`);
  if (edgeComplexity > 0.25) notes.push("High edge complexity — registration tolerance will be tight.");

  return {
    width,
    height,
    hasAlpha: hasPartialAlpha || transparentCount > 0,
    detectedBackground: bg.hex,
    uniqueColors: unique.count,
    uniqueColorsExact: unique.exact,
    meanLuminance: lumSum / opaque,
    meanSaturation: satSum / opaque,
    edgeComplexity,
    gradientRatio,
    artworkType,
    isLineArt,
    darkRegionRatio: darkCount / opaque,
    lightRegionRatio: lightCount / opaque,
    transparentRatio: transparentCount / n,
    dominantColors,
    notes,
    bins,
    edges,
    luma,
  };
}

/** True when a garment needs a white underbase for colored inks to read. */
export function garmentIsDark(garmentHex: string): boolean {
  const [r, g, b] = hexToRgb(garmentHex);
  return relativeLuminance(r, g, b) < 0.32;
}
