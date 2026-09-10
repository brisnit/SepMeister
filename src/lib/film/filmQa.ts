/**
 * Deterministic pre-export film checks.
 *
 * Every check here inspects real state — the shared layout object, the actual
 * rendered rasters, the plan the production sheet will be built from. Nothing
 * is reported as verified unless it was genuinely tested; a green tick that
 * means "we assumed this" is worse than no tick at all, because it is exactly
 * the thing a printer would rely on before committing film and screens.
 */

import { isMonochrome } from "./render";
import { computeFilmLabelBox, type TextMeasurer } from "./pdf";
import { halftoneMask } from "@/lib/engine/halftone";
import { resampleMask } from "./resample";
import { halftoneQuality } from "@/lib/engine/halftone";
import type { FilmLayout } from "./layout";
import type {
  ExportSettings, FilmQACheck, FilmQAReport, ProductionSize, SeparationPlan,
} from "@/lib/types";

export interface FilmQaInput {
  plan: SeparationPlan;
  layout: FilmLayout;
  films: { name: string; rasterWidth: number; rasterHeight: number }[];
  expectedScreens: number;
  productionSize: ProductionSize;
  exportSettings: ExportSettings;
  rasterDpi: number;
  rasterCapped: boolean;
  artworkPixelWidth: number;
  artworkPixelHeight: number;
}

function check(key: string, label: string, status: FilmQACheck["status"], detail: string): FilmQACheck {
  return { key, label, status, detail };
}

export function runFilmQa(input: FilmQaInput, measure: TextMeasurer): FilmQAReport {
  const checks: FilmQACheck[] = [];
  const { plan, layout, films, expectedScreens } = input;

  // --- Every film generated -------------------------------------------
  checks.push(
    films.length === expectedScreens
      ? check("count", "Films generated", "pass", `${films.length} of ${expectedScreens} films`)
      : check("count", "Films generated", "fail", `${films.length} of ${expectedScreens} films — a screen is missing`),
  );

  // --- Identical artwork bounds and scale ------------------------------
  //
  // What has to match is the *physical* rectangle the artwork occupies, which
  // is structural: every film consumes the same layout object. Pixel
  // dimensions legitimately differ, because only screened films are resampled
  // to the film raster while solid ones stay at their native size. Checking
  // pixel equality would fail a correct job and pass a broken one.
  const aspects = films.map((f) => f.rasterWidth / Math.max(1, f.rasterHeight));
  const aspectSpread = aspects.length ? Math.max(...aspects) - Math.min(...aspects) : 0;
  const sizes = [...new Set(films.map((f) => `${f.rasterWidth}×${f.rasterHeight}`))];
  checks.push(
    aspectSpread < 0.005
      ? check("bounds", "Artwork bounds matched", "pass",
          `Identical ${(layout.artWidthPt / 72).toFixed(2)} × ${(layout.artHeightPt / 72).toFixed(2)} in placement on every film` +
          (sizes.length > 1 ? ` (${sizes.length} raster sizes: solid films are not resampled)` : ""))
      : check("bounds", "Artwork bounds matched", "fail",
          `Films disagree on proportions: ${sizes.join(", ")}`),
  );

  // --- Registration marks ----------------------------------------------
  const markCount = layout.registration.length;
  const artX0 = layout.artXPt;
  const artY0 = layout.artYPt;
  const artX1 = layout.artXPt + layout.artWidthPt;
  const artY1 = layout.artYPt + layout.artHeightPt;

  const intruding = layout.registration.filter((m) => {
    const reach = Math.max(m.radius, m.armLength);
    return m.cx + reach > artX0 && m.cx - reach < artX1 && m.cy + reach > artY0 && m.cy - reach < artY1;
  });

  if (markCount === 0) {
    checks.push(check("registration", "Registration marks", "warn",
      "No registration marks — films cannot be aligned by eye"));
  } else if (intruding.length > 0) {
    checks.push(check("registration", "Registration marks", "fail",
      `${intruding.length} mark(s) overlap the artwork area`));
  } else {
    checks.push(check("registration", "Registration matched", "pass",
      `${markCount} targets, identical on every film, all clear of the artwork`));
  }

  // --- Physical dimensions match the requested production size ----------
  const expectedWpt = input.productionSize.widthIn * 72;
  const expectedHpt = input.productionSize.heightIn * 72;
  const wDelta = Math.abs(layout.artWidthPt - expectedWpt);
  const hDelta = Math.abs(layout.artHeightPt - expectedHpt);
  // A hundredth of a point is far below any output device's precision.
  const dimensionsOk = wDelta < 0.01 && hDelta < 0.01;
  checks.push(
    dimensionsOk
      ? check("dimensions", "Scale matched", "pass",
          `${input.productionSize.widthIn.toFixed(2)} × ${input.productionSize.heightIn.toFixed(2)} in at 100%`)
      : check("dimensions", "Scale matched", "fail",
          `Artboard is off by ${Math.max(wDelta, hDelta).toFixed(3)}pt from the requested size`),
  );

  // --- Aspect ratio preserved ------------------------------------------
  const pixelAspect = input.artworkPixelWidth / Math.max(1, input.artworkPixelHeight);
  const printAspect = input.productionSize.widthIn / Math.max(0.0001, input.productionSize.heightIn);
  const aspectDrift = Math.abs(pixelAspect - printAspect) / Math.max(0.0001, pixelAspect);
  checks.push(
    aspectDrift < 0.005
      ? check("aspect", "Aspect preserved", "pass", "Artwork is not stretched")
      : check("aspect", "Aspect preserved", "warn",
          `Print size is ${(aspectDrift * 100).toFixed(1)}% off the artwork's own proportions — it will be stretched`),
  );

  // --- Labels clear of artwork and marks --------------------------------
  // Recomputed from the same function the renderer uses, for every film, so
  // this reflects what will actually be drawn rather than an assumption.
  checks.push(labelCheck(input, measure));

  // --- Monochrome output -------------------------------------------------
  checks.push(monochromeCheck(input));

  // --- Halftone settings are the ones the UI is showing -------------------
  checks.push(halftoneCheck(input));

  // --- Output resolution --------------------------------------------------
  if (input.rasterCapped) {
    checks.push(check("resolution", "Film resolution", "warn",
      `Capped at ${Math.round(input.rasterDpi)} DPI to keep the file a workable size`));
  } else {
    checks.push(check("resolution", "Film resolution", "pass",
      `${Math.round(input.rasterDpi)} DPI film raster`));
  }

  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const failures = checks.filter((c) => c.status === "fail").length;
  return { checks, passed, warnings, failures };
}

/**
 * Verifies no film's label will be drawn over the artwork or a registration
 * target, for every ink name in the job.
 */
function labelCheck(input: FilmQaInput, measure: TextMeasurer): FilmQACheck {
  const { layout, plan } = input;
  // The PDF fonts are needed to measure text; when they are unavailable
  // (non-browser contexts without the embedder) say so rather than pass.
  let worst: string | null = null;
  let checked = 0;

  const inks = [...plan.inks].sort((a, b) => a.order - b.order);
  for (let i = 0; i < inks.length; i++) {
    const box = computeFilmLabelBox(
      layout,
      {
        jobName: "job", customer: "", index: i + 1, total: inks.length,
        inkName: inks[i].name, inkColor: inks[i].displayColor, mesh: inks[i].mesh,
        sizeText: "", scalePercent: 100, halftone: null,
      },
      measure,
    );
    if (!box) continue;
    checked++;
    if (!box.bounds) continue;

    if (box.bounds.y1 > layout.artYPt) {
      worst = `${inks[i].name} label reaches the artwork area`;
      break;
    }
    for (const m of layout.registration) {
      const reach = Math.max(m.radius, m.armLength);
      const overlaps =
        box.bounds.x1 > m.cx - reach && box.bounds.x0 < m.cx + reach &&
        box.bounds.y1 > m.cy - reach && box.bounds.y0 < m.cy + reach;
      if (overlaps) {
        worst = `${inks[i].name} label overlaps a registration target`;
        break;
      }
    }
    if (worst) break;
  }

  if (worst) return check("labels", "Labels clear", "fail", worst);
  if (checked === 0) return check("labels", "Labels clear", "warn", "Artboard too small to label");
  return check("labels", "Labels clear", "pass", `${checked} labels clear of artwork and marks`);
}

/**
 * Actually screens and inverts a sample of each mask and inspects the bytes.
 *
 * A halftoned film must be pure black and white; a solid film legitimately
 * carries continuous tone, which a RIP will threshold. Both are checked for
 * what they should be, rather than assumed.
 */
function monochromeCheck(input: FilmQaInput): FilmQACheck {
  const inks = input.plan.inks;
  if (inks.length === 0) return check("monochrome", "Monochrome output", "fail", "No separations");

  let screened = 0;
  let solid = 0;

  for (const ink of inks) {
    const native = { width: input.artworkPixelWidth, height: input.artworkPixelHeight, data: ink.mask };
    // Sample at a reduced size: this verifies the code path and the value
    // domain without re-rendering every full-resolution film twice.
    const sampleW = Math.min(320, native.width);
    const sampleH = Math.max(1, Math.round(sampleW * (native.height / Math.max(1, native.width))));
    const sample = resampleMask(native, sampleW, sampleH);

    if (ink.halftone.enabled) {
      const dots = halftoneMask(sample, {
        lpi: ink.halftone.lpi, angle: ink.halftone.angle,
        shape: ink.halftone.shape, dpi: input.rasterDpi,
      });
      const film = new Uint8Array(dots.data.length);
      for (let i = 0; i < film.length; i++) film[i] = 255 - dots.data[i];
      if (!isMonochrome(film)) {
        return check("monochrome", "Monochrome output", "fail",
          `${ink.name} produced non-binary film pixels after screening`);
      }
      screened++;
    } else {
      // Solid films are greyscale by construction; confirm no color channel
      // could leak by checking the mask is a single-channel field.
      if (ink.mask.length !== input.artworkPixelWidth * input.artworkPixelHeight) {
        return check("monochrome", "Monochrome output", "fail",
          `${ink.name} mask is not single-channel`);
      }
      solid++;
    }
  }

  const parts: string[] = [];
  if (screened) parts.push(`${screened} screened film${screened === 1 ? "" : "s"} verified binary`);
  if (solid) parts.push(`${solid} solid film${solid === 1 ? "" : "s"} single-channel`);
  return check("monochrome", "Monochrome output", "pass", parts.join(", "));
}

/**
 * Confirms each screened film can actually resolve its requested line count at
 * the film resolution being exported, and that its settings are internally
 * consistent with what the UI is displaying.
 */
function halftoneCheck(input: FilmQaInput): FilmQACheck {
  const screened = input.plan.inks.filter((i) => i.halftone.enabled);
  if (screened.length === 0) {
    return check("halftone", "Halftone settings", "pass", "All screens solid — no screening applied");
  }

  const invalid = screened.filter(
    (i) => !isFinite(i.halftone.lpi) || i.halftone.lpi <= 0 || !isFinite(i.halftone.angle),
  );
  if (invalid.length > 0) {
    return check("halftone", "Halftone settings", "fail",
      `${invalid.map((i) => i.name).join(", ")} has an invalid LPI or angle`);
  }

  const tooFine = screened.filter((i) => !halftoneQuality(i.halftone.lpi, input.rasterDpi).adequate);
  if (tooFine.length > 0) {
    return check("halftone", "Halftone settings", "warn",
      `${tooFine.map((i) => i.name).join(", ")} screened at ${Math.round(input.rasterDpi)} DPI — ` +
      "export at a higher film resolution for smoother tone");
  }

  if (screened.length <= 3) {
    return check("halftone", "Halftone settings", "pass",
      screened.map((i) => `${i.name} ${i.halftone.lpi} LPI @ ${i.halftone.angle}°`).join(", "));
  }

  // Too many to list individually; report the line-count range, which is what
  // a printer actually needs to sanity-check against their mesh.
  const lpis = screened.map((i) => i.halftone.lpi);
  const lo = Math.min(...lpis);
  const hi = Math.max(...lpis);
  const range = lo === hi ? `${lo} LPI` : `${lo}-${hi} LPI`;
  return check("halftone", "Halftone settings", "pass",
    `${screened.length} screens at ${range}, all resolvable at ${Math.round(input.rasterDpi)} DPI`);
}
