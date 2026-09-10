/**
 * Composite reconstruction: re-print the separations digitally, in order, on
 * the chosen garment, so the artist can judge the separation against the
 * original.
 *
 * The ink model matters. A mask value is *area coverage*, not opacity: where
 * two spot screens each carry 50% at a pixel, the press lays interleaved
 * halftone dots side by side, not one ink on top of the other. Compositing
 * those sequentially with source-over would give the later screen undue weight
 * and destroy every blended edge and gradient in the artwork.
 *
 * So inks that share the surface are mixed by area, and only the underbase --
 * which really is printed underneath and covered by what follows -- is
 * composited as a substrate layer.
 *
 * This is still a digital model. It does not simulate opacity curves, mesh
 * gain, dot gain, ink modification or flash behaviour, and the UI labels it a
 * separation preview rather than a print prediction.
 */

import { hexToRgb } from "@/lib/color/space";
import type { Mask } from "./morphology";

export interface CompositeLayer {
  mask: Mask;
  color: string;
  visible: boolean;
  /**
   * "substrate" layers print underneath and are covered by the inks above
   * them (the white underbase). "ink" layers share the surface and mix by
   * area. Defaults to "ink".
   */
  role?: "substrate" | "ink";
  /** Scales the layer's effective coverage. 1 = as separated. */
  opacity?: number;
}

/**
 * Renders layers over a garment color into an RGBA buffer.
 * `garmentAlpha` of 0 renders the garment as transparent, which is how the
 * "separated artwork only" view is produced.
 */
export function compositeLayers(
  layers: CompositeLayer[],
  width: number,
  height: number,
  garmentHex: string,
  garmentAlpha = 1,
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const [gr, gg, gb] = hexToRgb(garmentHex);

  const visible = layers.filter((l) => l.visible);
  const substrates = visible.filter((l) => l.role === "substrate");
  const inks = visible.filter((l) => l.role !== "substrate");

  // Substrate pass: source-over, because these genuinely stack.
  const subR = new Float32Array(n);
  const subG = new Float32Array(n);
  const subB = new Float32Array(n);
  const subA = new Float32Array(n);

  if (garmentAlpha > 0) {
    subR.fill(gr);
    subG.fill(gg);
    subB.fill(gb);
    subA.fill(garmentAlpha);
  }

  for (const layer of substrates) {
    const [lr, lg, lb] = hexToRgb(layer.color);
    const op = layer.opacity ?? 1;
    const data = layer.mask.data;
    for (let i = 0; i < n; i++) {
      const cov = data[i];
      if (cov === 0) continue;
      const a = (cov / 255) * op;
      const inv = 1 - a;
      subR[i] = lr * a + subR[i] * inv;
      subG[i] = lg * a + subG[i] * inv;
      subB[i] = lb * a + subB[i] * inv;
      subA[i] = a + subA[i] * inv;
    }
  }

  // Ink pass: area-weighted mixing over the substrate. Because the engine
  // normalizes membership so coverage sums to at most full, this reproduces
  // an antialiased or gradient blend exactly.
  const inkColors = inks.map((l) => hexToRgb(l.color));

  for (let i = 0; i < n; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let covered = 0;

    for (let k = 0; k < inks.length; k++) {
      const cov = inks[k].mask.data[i];
      if (cov === 0) continue;
      const w = (cov / 255) * (inks[k].opacity ?? 1);
      const [ir, ig, ib] = inkColors[k];
      r += ir * w;
      g += ig * w;
      b += ib * w;
      covered += w;
    }

    // Total coverage can exceed 1 after per-ink gain edits; renormalize so the
    // result stays a valid mixture rather than blowing out toward white.
    if (covered > 1) {
      r /= covered;
      g /= covered;
      b /= covered;
      covered = 1;
    }

    const bare = 1 - covered;
    const p = i * 4;
    out[p] = Math.round(r + subR[i] * bare);
    out[p + 1] = Math.round(g + subG[i] * bare);
    out[p + 2] = Math.round(b + subB[i] * bare);
    // Anything the inks cover is opaque; elsewhere the substrate's alpha shows.
    out[p + 3] = Math.round(Math.min(1, covered + subA[i] * bare) * 255);
  }

  return out;
}

/**
 * Flattens artwork onto the garment so the comparison against the composite is
 * like-for-like.
 *
 * Two kinds of region resolve to the garment rather than to artwork color:
 * transparent pixels, and pixels the plan deliberately knocked out (a matching
 * garment color, or a removed background). Both are areas the artist asked to
 * be bare. Scoring the composite against the raw artwork there would report a
 * huge color error for doing exactly the right thing -- a white-background JPEG
 * separated for a black shirt would score in the twenties.
 */
export function flattenOnGarment(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  garmentHex: string,
  knockoutCoverage?: Uint8ClampedArray,
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const [gr, gg, gb] = hexToRgb(garmentHex);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let a = pixels[p + 3] / 255;
    if (knockoutCoverage) a *= 1 - knockoutCoverage[i] / 255;
    const inv = 1 - a;
    out[p] = Math.round(pixels[p] * a + gr * inv);
    out[p + 1] = Math.round(pixels[p + 1] * a + gg * inv);
    out[p + 2] = Math.round(pixels[p + 2] * a + gb * inv);
    out[p + 3] = 255;
  }
  return out;
}
