/**
 * Export bundling: turns a finished job into a ZIP a shop can work from.
 *
 * Layout inside the archive:
 *   01-white-underbase.pdf ...   press-ready film positives
 *   png/01-white-underbase.png   same films as raster
 *   composite-proof.pdf          full-color proof
 *   production-sheet.pdf         shop summary
 *   job-manifest.json            machine-readable record of every decision
 *
 * A test package additionally carries the original artwork thumbnail, so a
 * physical press test can be documented from one archive.
 */

import { zipSync, type Zippable } from "fflate";
import { buildFilmPdf, buildProofPdf, buildProductionSheetPdf, type ProductionSheetInk } from "./pdf";
import { renderFilmPng } from "./render";
import { resampleMask, planFilmRaster } from "./resample";
import { buildLayout, describeSize, type FilmLayout } from "./layout";
import { slugify } from "@/lib/engine/naming";
import { checkMeshSafety, type HalftoneParams } from "@/lib/engine/halftone";
import { findMoireRisks } from "@/lib/engine/overlap";
import { effectiveDpi, filmSize, smallestSheetFor } from "@/lib/production/size";
import { runFilmQa, type FilmQaInput } from "./filmQa";
import { createLabelMeasurer } from "./pdf";
import type {
  ExportSettings, FilmQAReport, HalftoneSettings, InkSeparation, JobMetadata,
  ProductionSettings, ProductionSize, QAResult, SeparationPlan,
} from "@/lib/types";

/**
 * Fixed archive timestamp. Constructed in local time on purpose: ZIP stores
 * naive local timestamps and the encoder validates the local year against
 * 1980-2099, so a UTC-midnight date would fall out of range west of UTC.
 */
const ZIP_TIMESTAMP = new Date(2000, 0, 1, 0, 0, 0);

export interface BundleInput {
  metadata: JobMetadata;
  plan: SeparationPlan;
  settings: ProductionSettings;
  productionSize: ProductionSize;
  halftone: HalftoneSettings;
  exportSettings: ExportSettings;
  qa: QAResult;
  similarityPercent: number;
  width: number;
  height: number;
  compositeRgba: Uint8ClampedArray;
  /** Small RGB thumbnail of the composite, for the production sheet. */
  thumbnail: { data: Uint8Array; width: number; height: number } | null;
  /** Original artwork thumbnail, included in a test package. */
  originalThumbnail: { data: Uint8Array; width: number; height: number } | null;
  /** Adds the original artwork and a fuller manifest for documenting a press test. */
  testPackage?: boolean;
  /**
   * Records that the artwork was resampled before separating. Worth capturing
   * because it changes the resolution every downstream decision was made at,
   * which matters when comparing this manifest to a press result later.
   */
  sourceUpscale?: { from: number; to: number; resultingDpi: number } | null;
  /** Underbase controls as set by the artist; the mask alone cannot show these. */
  underbaseSettings?: { choke: number; strength: number; removeUnderBlack: boolean; highlightWhite: boolean } | null;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface BundleResult {
  zip: Uint8Array;
  fileName: string;
  layout: FilmLayout;
  qaReport: FilmQAReport;
  /** Per-film record, for verification and UI display. */
  films: { name: string; pdfBytes: number; pngBytes: number; rasterWidth: number; rasterHeight: number }[];
}

/** "Cream", "Cream and Navy", "Cream, Navy and 12 others". */
function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** One-line description of how the job's screens are screened. */
export function describeHalftones(inks: InkSeparation[]): string {
  const screened = inks.filter((i) => i.halftone.enabled);
  if (screened.length === 0) return "None — all screens solid";

  const lpis = [...new Set(screened.map((i) => i.halftone.lpi))];
  const shapes = [...new Set(screened.map((i) => i.halftone.shape))];
  const lpiText = lpis.length === 1 ? `${lpis[0]} LPI` : `${Math.min(...lpis)}-${Math.max(...lpis)} LPI`;
  const shapeText = shapes.length === 1 ? `${shapes[0]} dot` : "mixed dot shapes";
  const solid = inks.length - screened.length;

  return `${screened.length} of ${inks.length} screens at ${lpiText}, ${shapeText}` +
    (solid > 0 ? `; ${solid} solid` : "") + " (per-screen angles)";
}

/** Halftone parameters for one ink, or null when it prints solid. */
export function halftoneParamsFor(ink: InkSeparation, rasterDpi: number): HalftoneParams | null {
  if (!ink.halftone.enabled) return null;
  return { lpi: ink.halftone.lpi, angle: ink.halftone.angle, shape: ink.halftone.shape, dpi: rasterDpi };
}

/**
 * Production warnings derived from the plan, without rendering film.
 *
 * `pixelCount` enables overlap-aware moire detection. Without it the check
 * falls back to raw angle proximity, which on a large job flags every reused
 * angle whether or not those screens ever touch.
 */
export function collectProductionWarnings(
  plan: SeparationPlan,
  qa: QAResult,
  pixelCount?: number,
): string[] {
  const warnings: string[] = [...qa.warnings];

  // Grouped by the mesh/LPI combination that caused them.
  //
  // A 16-station job running one line count across the rack would otherwise
  // produce fourteen near-identical warnings, which reads as noise and buries
  // anything specific. One line per distinct combination stays scannable.
  const meshIssues = new Map<string, { names: string[]; message: string; recommendation: string | null }>();
  for (const ink of plan.inks) {
    if (!ink.halftone.enabled) continue;
    const safety = checkMeshSafety(ink.halftone.lpi, ink.mesh);
    if (safety.safe || !safety.message) continue;
    const key = `${ink.halftone.lpi}/${ink.mesh}`;
    const entry = meshIssues.get(key);
    if (entry) entry.names.push(ink.name);
    else meshIssues.set(key, { names: [ink.name], message: safety.message, recommendation: safety.recommendation });
  }

  for (const { names, message, recommendation } of meshIssues.values()) {
    warnings.push(
      `${listNames(names)}: ${message}${recommendation ? ` Consider: ${recommendation}.` : ""}`,
    );
  }

  if (pixelCount && pixelCount > 0) {
    const risks = findMoireRisks(
      plan.inks.map((i) => ({
        label: i.name, angle: i.halftone.angle, screened: i.halftone.enabled, mask: i.mask,
      })),
      pixelCount,
    );
    for (const r of risks) {
      warnings.push(
        `${r.a} and ${r.b} are ${r.separation.toFixed(1)}° apart and overlap over ` +
        `${(r.overlap * 100).toFixed(0)}% of the smaller screen — expect moire.`,
      );
    }
  }

  return warnings;
}

export async function buildExportBundle(input: BundleInput): Promise<BundleResult> {
  const { plan, exportSettings, productionSize, metadata } = input;
  const report = input.onProgress ?? (() => {});

  const artDpi = effectiveDpi(input.width, productionSize);

  // One layout for the entire job. Every film consumes this object, which is
  // what guarantees the separations register when stacked.
  const layout = buildLayout({
    pixelWidth: input.width,
    pixelHeight: input.height,
    dpi: artDpi,
    marginIn: exportSettings.marginIn,
    includeRegistration: exportSettings.includeRegistration,
    includeCenterMarks: exportSettings.includeCenterMarks,
    includeCropMarks: exportSettings.includeCropMarks,
  });

  // Films are rasterized at the requested output resolution so halftone dots
  // are rendered on a fine grid, independent of the artwork's own resolution.
  const raster = planFilmRaster(
    productionSize.widthIn,
    productionSize.heightIn,
    exportSettings.filmDpi,
    input.width,
    input.height,
  );

  const files: Zippable = {};
  const films: BundleResult["films"] = [];
  const sizeText = describeSize(layout);
  const inks = [...plan.inks].sort((a, b) => a.order - b.order);
  const total = inks.length + 4;
  let done = 0;

  const jobName = metadata.jobName.trim() || "untitled-job";

  for (let i = 0; i < inks.length; i++) {
    const ink = inks[i];
    const index = i + 1;
    const slug = `${String(index).padStart(2, "0")}-${slugify(ink.name)}`;
    report(done, total, `Rendering ${ink.name}`);

    const native = { width: input.width, height: input.height, data: ink.mask };
    const ht = halftoneParamsFor(ink, raster.dpi);

    // Only screened films are resampled. A solid film is the same shape at any
    // resolution, so upsampling one costs time and bytes and buys nothing --
    // and at 12in/600 DPI that is a 52-megapixel buffer per screen. The
    // artwork's physical placement comes from the shared layout either way, so
    // films of differing pixel dimensions still register exactly.
    const mask = ht ? resampleMask(native, raster.width, raster.height) : native;

    const label = {
      jobName,
      customer: metadata.customer,
      index,
      total: inks.length,
      inkName: ink.name,
      inkColor: ink.displayColor,
      mesh: ink.mesh,
      sizeText,
      scalePercent: 100,
      halftone: ht ? `${ht.lpi} LPI / ${ht.angle}° / ${ht.shape}` : null,
    };

    const pdf = await buildFilmPdf({ mask, layout, label, halftone: ht, embedDpi: raster.dpi });
    const png = renderFilmPng(mask, { halftone: ht, dpi: raster.dpi });

    files[`${slug}.pdf`] = pdf;
    files[`png/${slug}.png`] = png;
    films.push({
      name: ink.name, pdfBytes: pdf.length, pngBytes: png.length,
      rasterWidth: mask.width, rasterHeight: mask.height,
    });
    done++;
  }

  report(done, total, "Building composite proof");
  files["composite-proof.pdf"] = await buildProofPdf({
    compositeRgba: input.compositeRgba,
    width: input.width,
    height: input.height,
    layout,
    jobName,
    customer: metadata.customer,
    garmentColor: input.settings.garmentColor,
    similarityPercent: input.similarityPercent,
  });
  done++;

  report(done, total, "Running film checks");

  const qaInput: FilmQaInput = {
    plan,
    layout,
    films,
    expectedScreens: inks.length,
    productionSize,
    exportSettings,
    rasterDpi: raster.dpi,
    rasterCapped: raster.capped,
    artworkPixelWidth: input.width,
    artworkPixelHeight: input.height,
  };
  // Measured with the same fonts the film renderer uses, so the label
  // clearance check reflects exactly what will be drawn.
  const measure = await createLabelMeasurer();
  const qaReport = runFilmQa(qaInput, measure);
  done++;

  report(done, total, "Building production sheet");

  const sheetInks: ProductionSheetInk[] = inks.map((ink, i) => ({
    index: i + 1,
    name: ink.name,
    color: ink.displayColor,
    type: ink.type,
    mesh: ink.mesh,
    coveragePercent: ink.coverage * 100,
    halftone: ink.halftone.enabled
      ? `${ink.halftone.lpi} LPI · ${ink.halftone.angle}° · ${ink.halftone.shape}`
      : "Solid",
    note: ink.note,
  }));

  const warnings = collectProductionWarnings(plan, input.qa, input.width * input.height);
  const base = plan.inks.find((i) => i.type === "underbase");
  const sheet = filmSize(productionSize, exportSettings.marginIn);
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  files["production-sheet.pdf"] = await buildProductionSheetPdf({
    jobName,
    customer: metadata.customer,
    notes: metadata.notes,
    createdAt,
    sizeText,
    filmSizeText: `${sheet.widthIn.toFixed(2)} × ${sheet.heightIn.toFixed(2)} in`,
    pixelWidth: input.width,
    pixelHeight: input.height,
    artworkDpi: Math.round(artDpi),
    filmDpi: Math.round(raster.dpi),
    garmentColor: input.settings.garmentColor,
    method: input.settings.method,
    inkType: input.settings.inkType,
    inks: sheetInks,
    halftoneSummary: describeHalftones(inks),
    underbaseChoke: base ? `${base.settings.choke} px at ${Math.round(artDpi)} DPI` : "n/a",
    screenCount: inks.length,
    qaScore: input.qa.score,
    qaVerdict: input.qa.verdict,
    similarityPercent: input.similarityPercent,
    explanation: plan.explanation,
    warnings,
    thumbnailRgb: input.thumbnail,
  });
  done++;

  const manifest = buildManifest({ ...input, layout, artDpi, raster, warnings, qaReport, inks, createdAt });
  files["job-manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  if (input.testPackage && input.originalThumbnail) {
    const { encodePng } = await import("./png");
    files["original-artwork.png"] = encodePng(
      input.originalThumbnail.data,
      input.originalThumbnail.width,
      input.originalThumbnail.height,
      "rgb",
    );
  }

  files["README.txt"] = new TextEncoder().encode(
    [
      `${jobName}${metadata.customer ? ` — ${metadata.customer}` : ""}`,
      `Screen print separations generated by SepWiz on ${new Date().toISOString().slice(0, 10)}`,
      "",
      `Screens:          ${inks.length}`,
      `Artwork size:     ${productionSize.widthIn.toFixed(2)} x ${productionSize.heightIn.toFixed(2)} in`,
      `Film sheet size:  ${sheet.widthIn.toFixed(2)} x ${sheet.heightIn.toFixed(2)} in` +
        (smallestSheetFor(sheet.widthIn, sheet.heightIn) ? ` (fits ${smallestSheetFor(sheet.widthIn, sheet.heightIn)})` : ""),
      `Artwork detail:   ${Math.round(artDpi)} DPI at production size`,
      `Film output:      ${Math.round(raster.dpi)} DPI`,
      "",
      "PRINT ORDER",
      ...inks.map((ink, i) =>
        `  ${String(i + 1).padStart(2, "0")}  ${ink.name.padEnd(20)} ${String(ink.mesh).padStart(3)} mesh   ` +
        (ink.halftone.enabled ? `${ink.halftone.lpi} LPI @ ${ink.halftone.angle}°` : "solid"),
      ),
      "",
      "Every film shares an identical artboard, artwork position, scale and",
      "registration marks. Printed at 100% with no scaling or fit-to-page,",
      "they will register when stacked.",
      "",
      "Print films at 100%. Do not use 'fit to page' or 'scale to fit'.",
      "",
      warnings.length ? `${warnings.length} production warning(s) — see production-sheet.pdf` : "No production warnings.",
      "",
      "Actual exposure, dot gain, and registration behaviour depend on your",
      "printer, RIP, and press. Verify against your own workflow before",
      "burning production screens.",
    ].join("\n"),
  );

  const zip = zipSync(files, { level: 6, mtime: ZIP_TIMESTAMP });
  const suffix = input.testPackage ? "test-package" : "separations";

  return { zip, fileName: `${slugify(jobName)}-${suffix}.zip`, layout, qaReport, films };
}

/** Machine-readable record of the whole job. */
function buildManifest(a: {
  metadata: JobMetadata;
  plan: SeparationPlan;
  settings: ProductionSettings;
  productionSize: ProductionSize;
  halftone: HalftoneSettings;
  exportSettings: ExportSettings;
  qa: QAResult;
  similarityPercent: number;
  width: number;
  height: number;
  layout: FilmLayout;
  artDpi: number;
  raster: { width: number; height: number; dpi: number; capped: boolean };
  sourceUpscale?: { from: number; to: number; resultingDpi: number } | null;
  underbaseSettings?: { choke: number; strength: number; removeUnderBlack: boolean; highlightWhite: boolean } | null;
  warnings: string[];
  qaReport: FilmQAReport;
  inks: InkSeparation[];
  createdAt: string;
}) {
  const sheet = filmSize(a.productionSize, a.exportSettings.marginIn);
  return {
    schema: "sepwiz.job-manifest/2",
    generatedAt: new Date().toISOString(),
    job: {
      id: a.metadata.id,
      name: a.metadata.jobName,
      customer: a.metadata.customer,
      notes: a.metadata.notes,
      createdAt: a.metadata.createdAt,
      exportedAt: a.createdAt,
    },
    garment: {
      color: a.settings.garmentColor,
      isDark: a.plan.garmentIsDark,
      inkType: a.settings.inkType,
      useGarmentAsBlack: a.settings.useGarmentAsBlack,
    },
    artwork: {
      pixelWidth: a.width,
      pixelHeight: a.height,
      widthIn: a.productionSize.widthIn,
      heightIn: a.productionSize.heightIn,
      units: a.productionSize.units,
      effectiveDpi: Math.round(a.artDpi),
      upscaled: a.sourceUpscale
        ? {
            applied: true,
            fromPixelWidth: a.sourceUpscale.from,
            toPixelWidth: a.sourceUpscale.to,
            resultingDpi: Math.round(a.sourceUpscale.resultingDpi),
            note: "Resampled before separating. Interpolation does not add detail; it gives choke, spread and ink edges usable precision.",
          }
        : { applied: false },
    },
    film: {
      widthIn: sheet.widthIn,
      heightIn: sheet.heightIn,
      marginIn: a.exportSettings.marginIn,
      requestedDpi: a.exportSettings.filmDpi,
      renderedDpi: Math.round(a.raster.dpi),
      rasterWidth: a.raster.width,
      rasterHeight: a.raster.height,
      resolutionCapped: a.raster.capped,
      scalePercent: 100,
      artboardWidthPt: a.layout.boardWidthPt,
      artboardHeightPt: a.layout.boardHeightPt,
      registrationMarks: a.layout.registration.length,
      centerMarks: a.layout.centerMarks.length,
      cropMarks: a.layout.cropMarks.length,
    },
    screens: a.inks.map((ink, i) => ({
      index: i + 1,
      id: ink.id,
      name: ink.name,
      color: ink.displayColor,
      type: ink.type,
      mesh: ink.mesh,
      coverage: ink.coverage,
      meanDensity: ink.meanDensity,
      maskSettings: ink.settings,
      halftone: ink.halftone,
      note: ink.note ?? null,
    })),
    halftones: {
      jobDefaults: a.halftone,
      screensScreened: a.inks.filter((i) => i.halftone.enabled).length,
      screensSolid: a.inks.filter((i) => !i.halftone.enabled).length,
    },
    underbase: (() => {
      const base = a.plan.inks.find((i) => i.type === "underbase");
      if (!base) return { present: false, ...(a.underbaseSettings ?? {}) };
      return {
        present: true,
        coverage: base.coverage,
        meanDensity: base.meanDensity,
        choke: base.settings.choke,
        strength: a.underbaseSettings?.strength ?? null,
        removeUnderBlack: a.underbaseSettings?.removeUnderBlack ?? null,
        highlightWhite: a.underbaseSettings?.highlightWhite ?? null,
        mesh: base.mesh,
        halftone: base.halftone,
        note: base.note ?? null,
      };
    })(),
    separation: {
      method: a.settings.method,
      maxScreens: a.plan.maxScreens,
      recommendedScreens: a.plan.recommendedScreens,
      naturalColorFamilies: a.plan.naturalColorFamilies,
      explanation: a.plan.explanation,
      merges: a.plan.merges,
      knockouts: a.plan.knockouts,
      printOrder: a.inks.map((i) => i.id),
    },
    similarity: { percent: a.similarityPercent },
    sepScore: { score: a.qa.score, verdict: a.qa.verdict, subscores: a.qa.subscores },
    filmQa: a.qaReport,
    warnings: a.warnings,
  };
}
