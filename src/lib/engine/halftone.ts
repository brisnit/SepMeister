/**
 * Deterministic AM (amplitude-modulated) halftone screening.
 *
 * Converts continuous-tone coverage masks into hard dots that a screen can
 * actually hold. Nothing here is generative or stochastic -- for a given
 * mask, LPI, angle and shape the dot pattern is fixed, which is what makes
 * re-exported films reprintable.
 *
 * Structured as its own module with a `ScreenFunction` seam so FM/stochastic
 * screening and index separations can be added without touching callers.
 */

import type { Mask } from "./morphology";
import type { DotShape } from "@/lib/types";

export interface HalftoneParams {
  /** Lines per inch of the halftone screen. */
  lpi: number;
  /** Screen angle in degrees. */
  angle: number;
  shape: DotShape;
  /** Output raster resolution. Determines how finely each dot is drawn. */
  dpi: number;
}

/**
 * Returns, for a point inside a halftone cell, the coverage level at which
 * that point turns on. Both inputs are in cell-local coordinates, -0.5..0.5.
 *
 * This is the extension seam: a different dot shape or an FM screen is a
 * different function of the same signature.
 */
export type ScreenFunction = (u: number, v: number) => number;

const SQRT2 = Math.SQRT2;

/** Round dot: threshold rises with radius from the cell center. */
const roundDot: ScreenFunction = (u, v) => {
  const r = Math.sqrt(u * u + v * v) / (SQRT2 / 2);
  return Math.min(1, r * r);
};

/**
 * Elliptical dot: elongated, so highlights and shadows join along one axis
 * before the other. Preferred for skin tones and smooth ramps because it
 * avoids the abrupt midtone jump where round dots all touch at once.
 */
const ellipseDot: ScreenFunction = (u, v) => {
  const a = u * 1.35;
  const b = v * 0.75;
  const r = Math.sqrt(a * a + b * b) / (SQRT2 / 2);
  return Math.min(1, r * r);
};

/** Square dot: threshold from Chebyshev distance, giving square growth. */
const squareDot: ScreenFunction = (u, v) => {
  const d = Math.max(Math.abs(u), Math.abs(v)) / 0.5;
  return Math.min(1, d * d);
};

const SPOT_FUNCTIONS: Record<DotShape, ScreenFunction> = {
  round: roundDot,
  ellipse: ellipseDot,
  square: squareDot,
};

/** Resolution of the normalized threshold matrix. 64x64 = 4096 tonal steps. */
const LUT_SIZE = 64;

/**
 * Normalized threshold matrices, built once per dot shape and cached.
 *
 * A raw spot function is monotonic but NOT area-proportional: thresholding a
 * round dot's r^2 falloff at 0.5 covers ~64% of the cell, not 50%, so every
 * midtone in the artwork would print far too dark.
 *
 * The fix is the construction real RIPs use. Evaluate the spot function across
 * the cell, rank the results, and replace each value with its normalized rank.
 * The nth-darkest position then turns on at exactly coverage n/N, making dot
 * area equal requested tone for any spot function -- including shapes added
 * later, which get correct tonality for free.
 */
const lutCache = new Map<DotShape, Float32Array>();

function thresholdMatrix(shape: DotShape): Float32Array {
  const cached = lutCache.get(shape);
  if (cached) return cached;

  const spot = SPOT_FUNCTIONS[shape] ?? roundDot;
  const n = LUT_SIZE * LUT_SIZE;
  const raw = new Float64Array(n);

  for (let j = 0; j < LUT_SIZE; j++) {
    for (let i = 0; i < LUT_SIZE; i++) {
      const u = (i + 0.5) / LUT_SIZE - 0.5;
      const v = (j + 0.5) / LUT_SIZE - 0.5;
      raw[j * LUT_SIZE + i] = spot(u, v);
    }
  }

  // Rank by spot value. Ties broken by index so the result is deterministic.
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => raw[a] - raw[b] || a - b);

  const lut = new Float32Array(n);
  for (let rank = 0; rank < n; rank++) {
    // Midpoint of the rank's band, so tone 0 stays off and 1 stays fully on.
    lut[order[rank]] = (rank + 0.5) / n;
  }

  lutCache.set(shape, lut);
  return lut;
}

/**
 * Screens a continuous-tone mask into a bilevel halftone.
 *
 * The mask is assumed to be at `params.dpi`. Cell size in pixels is
 * dpi/lpi -- at 300 DPI and 55 LPI that is ~5.5 pixels per cell, which is
 * marginal; `halftoneQuality` reports when the ratio is too low to hold tone,
 * and films should be output at 600+ DPI for real work.
 */
export function halftoneMask(mask: Mask, params: HalftoneParams): Mask {
  const { width: w, height: h, data } = mask;
  const out = new Uint8ClampedArray(w * h);
  const lut = thresholdMatrix(params.shape);

  const cellPx = params.dpi / params.lpi;
  if (!isFinite(cellPx) || cellPx <= 1) {
    // Screen is finer than the raster; nothing meaningful to do but threshold.
    for (let i = 0; i < data.length; i++) out[i] = data[i] >= 128 ? 255 : 0;
    return { width: w, height: h, data: out };
  }

  const rad = (params.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const inv = 1 / cellPx;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cov = data[i];
      // Full-on and full-off short circuit, and keeps solids truly solid.
      if (cov <= 0) { out[i] = 0; continue; }
      if (cov >= 255) { out[i] = 255; continue; }

      // Rotate into screen space, then find position within the cell.
      const rx = (x * cos + y * sin) * inv;
      const ry = (-x * sin + y * cos) * inv;
      const fu = rx - Math.floor(rx);
      const fv = ry - Math.floor(ry);

      const iu = Math.min(LUT_SIZE - 1, (fu * LUT_SIZE) | 0);
      const iv = Math.min(LUT_SIZE - 1, (fv * LUT_SIZE) | 0);

      out[i] = cov / 255 >= lut[iv * LUT_SIZE + iu] ? 255 : 0;
    }
  }

  return { width: w, height: h, data: out };
}

/**
 * A named set of screen angles.
 *
 * There is no single correct set. Different shops, presses and RIPs settle on
 * different conventions, and what matters is that screens that overlap
 * significantly are separated enough to avoid moire. These are offered as
 * starting points; every angle is overridable per screen.
 */
export interface AnglePreset {
  id: string;
  label: string;
  description: string;
  angles: number[];
}

export const ANGLE_PRESETS: AnglePreset[] = [
  {
    id: "spot-45",
    label: "Spot (45° family)",
    description:
      "Common for spot-color work: screens sit 30° apart around 45°, which keeps overlapping inks from beating against each other.",
    angles: [22.5, 52.5, 82.5, 37.5, 67.5, 7.5],
  },
  {
    id: "process",
    label: "Process-style",
    description:
      "Borrowed from four-color process: the heaviest ink takes 45°, the lightest takes 0°, and the rest spread 30° apart.",
    angles: [45, 75, 15, 0, 30, 60],
  },
  {
    id: "single",
    label: "All 22.5°",
    description:
      "Every screen on one angle. Simple to burn and register, but only safe when inks do not overlap — otherwise expect moire.",
    angles: [22.5],
  },
];

/** Individual angles offered as quick picks alongside direct entry. */
export const ANGLE_QUICK_PICKS = [7.5, 15, 22.5, 30, 37.5, 45, 52.5, 60, 67.5, 75, 82.5];

/** LPI values offered as presets, alongside a custom entry. */
export const LPI_PRESETS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 75];

export const DEFAULT_ANGLE_PRESET = ANGLE_PRESETS[0];

/**
 * Angle for the nth screen from a preset, cycling if there are more screens
 * than angles. Callers may override any individual screen.
 */
export function angleFromPreset(preset: AnglePreset, index: number): number {
  return preset.angles[index % preset.angles.length];
}

export function defaultAngleFor(index: number): number {
  return angleFromPreset(DEFAULT_ANGLE_PRESET, index);
}

/** Backwards-compatible view of the default preset's angles. */
export const DEFAULT_ANGLES = DEFAULT_ANGLE_PRESET.angles;

/**
 * Smallest separation between any two angles in a set, accounting for the
 * 90-degree rotational symmetry of a halftone grid: a screen at 5° and one at
 * 95° produce the same pattern, so they conflict just as badly as 5° and 5°.
 */
export function minimumAngleSeparation(angles: number[]): number {
  if (angles.length < 2) return 90;
  let min = 90;
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      const raw = Math.abs(angles[i] - angles[j]) % 90;
      const sep = Math.min(raw, 90 - raw);
      if (sep < min) min = sep;
    }
  }
  return min;
}

export interface AngleConflict {
  /** Ink ids or names that share too small a separation. */
  a: string;
  b: string;
  separation: number;
}

/**
 * Finds screens whose angles sit close enough to risk moire where they
 * overlap. Reported, never enforced -- overlapping is what matters, and only
 * the artist knows whether two given screens actually touch.
 */
export function findAngleConflicts(
  screens: { id: string; label: string; angle: number; enabled: boolean }[],
  minSeparation = 15,
): AngleConflict[] {
  const out: AngleConflict[] = [];
  const active = screens.filter((s) => s.enabled);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const raw = Math.abs(active[i].angle - active[j].angle) % 90;
      const sep = Math.min(raw, 90 - raw);
      if (sep < minSeparation) {
        out.push({ a: active[i].label, b: active[j].label, separation: sep });
      }
    }
  }
  return out;
}

export interface MeshSafety {
  safe: boolean;
  /** Practical ceiling for this mesh, from the mesh:LPI ratio guideline. */
  maxRecommendedLpi: number;
  /** Comfortable range to aim for, not a hard limit. */
  recommendedLpiRange: [number, number];
  /** Finest mesh that would comfortably hold the requested line count. */
  recommendedMesh: number | null;
  severity: "ok" | "caution" | "high";
  message: string | null;
  /** Short actionable summary, e.g. for an "apply recommendation" control. */
  recommendation: string | null;
}

/** Mesh counts a shop is likely to actually have on the rack. */
export const COMMON_MESH_COUNTS = [110, 156, 180, 200, 230, 305];

/** Finest mesh from the common set that comfortably holds this line count. */
export function meshForLpi(lpi: number): number | null {
  const needed = lpi * 4;
  for (const mesh of COMMON_MESH_COUNTS) {
    if (mesh >= needed) return mesh;
  }
  return null;
}

/**
 * Mesh-vs-LPI safety check.
 *
 * The working guideline is that mesh count should be roughly four times the
 * line count, so each halftone dot spans enough mesh openings to be supported.
 * Below about 3.5x the dots start falling through or bridging.
 */
export function checkMeshSafety(lpi: number, mesh: number): MeshSafety {
  const maxRecommendedLpi = Math.floor(mesh / 4);
  // Aim a little below the ceiling; sitting exactly on it leaves no margin
  // for emulsion thickness, exposure variation or dot gain. Rounded DOWN to a
  // multiple of five, never up -- a recommendation that exceeds the ceiling it
  // is derived from would be worse than useless.
  const high = Math.max(5, Math.floor(maxRecommendedLpi / 5) * 5);
  const low = Math.max(5, Math.floor((maxRecommendedLpi * 0.75) / 5) * 5);
  const recommendedLpiRange: [number, number] = [Math.min(low, high), high];
  const recommendedMesh = meshForLpi(lpi);

  if (lpi <= maxRecommendedLpi) {
    return {
      safe: true, maxRecommendedLpi, recommendedLpiRange, recommendedMesh,
      severity: "ok", message: null, recommendation: null,
    };
  }

  const ratio = mesh / lpi;
  const severity: MeshSafety["severity"] = ratio < 3 ? "high" : "caution";
  const verdict = severity === "high" ? "will be very difficult" : "may be difficult";

  const options = [`reduce to approximately ${recommendedLpiRange[0]}-${recommendedLpiRange[1]} LPI`];
  if (recommendedMesh && recommendedMesh !== mesh) options.push(`increase mesh to ${recommendedMesh} or finer`);

  return {
    safe: false,
    maxRecommendedLpi,
    recommendedLpiRange,
    recommendedMesh,
    severity,
    message: `${lpi} LPI ${verdict} to reproduce reliably on ${mesh} mesh.`,
    recommendation: options.join(", or "),
  };
}

/**
 * Whether the output raster is fine enough to render the requested screen.
 * Each halftone cell needs enough pixels to represent a useful number of
 * tonal steps; below ~8 pixels per cell the achievable grey levels collapse.
 */
export function halftoneQuality(lpi: number, dpi: number): { cellPx: number; greyLevels: number; adequate: boolean } {
  const cellPx = dpi / lpi;
  const greyLevels = Math.max(2, Math.floor(cellPx * cellPx));
  return { cellPx, greyLevels, adequate: cellPx >= 8 };
}
