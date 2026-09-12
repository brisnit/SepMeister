/**
 * The AccuRIP Emerald validation package.
 *
 * One archive containing everything needed to answer a single question: does
 * what SepWiz produced survive the RIP? It carries both screening modes side
 * by side, because which of them a shop should use is exactly the thing we do
 * not know and cannot reason our way to.
 *
 * The package is built so that SepWiz's own interpretation of the job and the
 * RIP's interpretation can be laid next to each other:
 *
 *   the two spot PDFs      what we hand the RIP
 *   the film positives     what we would print without a RIP, for comparison
 *   expected-plates        what we say is in those files
 *   preflight              what is verifiably in those files, read back
 *   the checklist          what the operator observes actually happened
 *
 * The distinction between the two spot PDFs is stated in the file names, the
 * manifest, the README and on the printed sheet. Confusing them would make the
 * whole exercise unreadable, since the answer to "who screened this?" is the
 * one result the test exists to produce.
 */

import { zipSync, type Zippable } from "fflate";
import { buildSpotPdf } from "@/lib/spot/spotPdf";
import { toSpotColors } from "@/lib/spot/spotColor";
import { buildFilmPdf, buildProductionSheetPdf, buildProofPdf, type ProductionSheetInk } from "@/lib/film/pdf";
import { buildLayout, describeSize, type FilmLayout } from "@/lib/film/layout";
import { planFilmRaster, resampleMask } from "@/lib/film/resample";
import { halftoneParamsFor, describeHalftones } from "@/lib/film/bundle";
import { effectiveDpi } from "@/lib/production/size";
import { slugify } from "@/lib/engine/naming";
import { compositeLayers } from "@/lib/engine/composite";
import { inspectPdf, summarizeInspection, type PdfInspection } from "./inspector";
import { buildEmeraldChecklistPdf } from "./checklistPdf";
import {
  buildExpectations, expectationsText, checklistText, readingTheTargetText,
  screeningModeLabel, screeningModeDescription, screeningModeSlug,
} from "./expectations";
import type {
  EmeraldExpectations, ExportSettings, ProductionSize, ScreeningMode, SeparationPlan,
} from "@/lib/types";

/** See `bundle.ts` — ZIP stores naive local timestamps, validated 1980-2099. */
const ZIP_TIMESTAMP = new Date(2000, 0, 1, 0, 0, 0);

const MODES: ScreeningMode[] = ["sepwiz-screened", "continuous-tone"];

export interface EmeraldPackageInput {
  jobName: string;
  customer: string;
  plan: SeparationPlan;
  width: number;
  height: number;
  productionSize: ProductionSize;
  exportSettings: ExportSettings;
  /** Marks this as the built-in control target rather than customer artwork. */
  isControlTarget: boolean;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface EmeraldModeResult {
  mode: ScreeningMode;
  fileName: string;
  bytes: number;
  plateNames: string[];
  inspection: PdfInspection;
}

export interface EmeraldPackageResult {
  zip: Uint8Array;
  fileName: string;
  layout: FilmLayout;
  expectations: EmeraldExpectations;
  modes: EmeraldModeResult[];
  /** True only when both exports passed preflight. */
  preflightOk: boolean;
}

/** Stable file names, referenced by the manifest and the printed sheet. */
export function spotFileName(mode: ScreeningMode): string {
  return `sepwiz-emerald-test-${screeningModeSlug(mode)}.pdf`;
}

export async function buildEmeraldPackage(input: EmeraldPackageInput): Promise<EmeraldPackageResult> {
  const report = input.onProgress ?? (() => {});
  const { plan, productionSize, exportSettings } = input;
  const inks = [...plan.inks].sort((a, b) => a.order - b.order);
  const artDpi = effectiveDpi(input.width, productionSize);

  // One layout for everything in the package, which is what makes the spot
  // plates and the film positives directly comparable.
  const layout = buildLayout({
    pixelWidth: input.width,
    pixelHeight: input.height,
    dpi: artDpi,
    marginIn: exportSettings.marginIn,
    includeRegistration: exportSettings.includeRegistration,
    includeCenterMarks: exportSettings.includeCenterMarks,
    includeCropMarks: exportSettings.includeCropMarks,
  });

  const raster = planFilmRaster(
    productionSize.widthIn, productionSize.heightIn,
    exportSettings.filmDpi, input.width, input.height,
  );

  const files: Zippable = {};
  const total = MODES.length + inks.length + 4;
  let done = 0;

  // The two spot PDFs, each inspected immediately after it is written.
  const modes: EmeraldModeResult[] = [];
  const expectationsByMode = new Map<ScreeningMode, EmeraldExpectations>();

  for (const mode of MODES) {
    report(done, total, `Building ${screeningModeLabel(mode)} spot PDF`);
    const res = await buildSpotPdf({
      spots: toSpotColors(inks),
      layout,
      jobName: input.jobName,
      customer: input.customer,
      width: input.width,
      height: input.height,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
      rasterDpi: raster.dpi,
      applyHalftones: mode === "sepwiz-screened",
      includeMarks: true,
    });

    const expectations = buildExpectations({
      jobName: input.jobName,
      plan,
      layout,
      screeningMode: mode,
      filmDpi: raster.dpi,
      artworkWidthIn: productionSize.widthIn,
      artworkHeightIn: productionSize.heightIn,
    });
    expectationsByMode.set(mode, expectations);

    // Checked against what we claimed, not against nothing. An inspection with
    // no expectation can only confirm a file is a PDF.
    const inspection = await inspectPdf(res.bytes, {
      expectedPlateNames: expectations.plates.map((p) => p.name),
      expectedPageCount: 1,
      expectedWidthIn: expectations.boardWidthIn,
      expectedHeightIn: expectations.boardHeightIn,
    });

    const fileName = spotFileName(mode);
    files[fileName] = res.bytes;
    modes.push({ mode, fileName, bytes: res.bytes.length, plateNames: res.plateNames, inspection });
    done++;
  }

  // Film positives, for comparison against whatever the RIP images.
  for (let i = 0; i < inks.length; i++) {
    const ink = inks[i];
    report(done, total, `Rendering ${ink.name} film`);
    const index = i + 1;
    const slug = `${String(index).padStart(2, "0")}-${slugify(ink.name)}`;
    const native = { width: input.width, height: input.height, data: ink.mask };
    const ht = halftoneParamsFor(ink, raster.dpi);
    const mask = ht ? resampleMask(native, raster.width, raster.height) : native;

    files[`films/${slug}.pdf`] = await buildFilmPdf({
      mask, layout, halftone: ht, embedDpi: raster.dpi,
      label: {
        jobName: input.jobName,
        customer: input.customer,
        index,
        total: inks.length,
        inkName: ink.name,
        inkColor: ink.displayColor,
        mesh: ink.mesh,
        sizeText: describeSize(layout),
        scalePercent: 100,
        halftone: ht ? `${ht.lpi} LPI / ${ht.angle}° / ${ht.shape}` : null,
      },
    });
    done++;
  }

  // A composite proof on the garment. Worth including specifically because the
  // spot PDF previews the white plate as nothing on a white page — this is
  // where an operator can actually see the underbase.
  report(done, total, "Building composite proof");
  const composite = compositeLayers(
    inks.map((ink) => ({
      mask: { data: ink.mask, width: input.width, height: input.height },
      color: ink.displayColor,
      visible: true,
      role: ink.type === "underbase" ? ("substrate" as const) : ("ink" as const),
    })),
    input.width, input.height, plan.garmentColor,
  );
  files["composite-proof.pdf"] = await buildProofPdf({
    compositeRgba: composite,
    width: input.width,
    height: input.height,
    layout,
    jobName: input.jobName,
    customer: input.customer,
    garmentColor: plan.garmentColor,
    similarityPercent: 100,
  });
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

  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  files["production-sheet.pdf"] = await buildProductionSheetPdf({
    jobName: input.jobName,
    customer: input.customer,
    notes: input.isControlTarget
      ? "EMERALD SPOT TEST — constructed control target, not a separation."
      : "",
    createdAt,
    sizeText: describeSize(layout),
    filmSizeText: `${(layout.boardWidthPt / 72).toFixed(2)} × ${(layout.boardHeightPt / 72).toFixed(2)} in`,
    pixelWidth: input.width,
    pixelHeight: input.height,
    artworkDpi: Math.round(artDpi),
    filmDpi: Math.round(raster.dpi),
    garmentColor: plan.garmentColor,
    method: "spot",
    inkType: "plastisol",
    inks: sheetInks,
    halftoneSummary: describeHalftones(inks),
    underbaseChoke: "n/a — control target" ,
    screenCount: inks.length,
    qaScore: 100,
    qaVerdict: "Control target",
    similarityPercent: 100,
    explanation: plan.explanation,
    warnings: [],
    thumbnailRgb: null,
  });
  done++;

  // The printed sheet describes the screened export, since that is the one
  // whose screening claims need checking. The continuous-tone expectations are
  // in the manifest alongside it.
  report(done, total, "Building validation checklist");
  const screenedMode = modes.find((m) => m.mode === "sepwiz-screened")!;
  const preflightOk = modes.every((m) => m.inspection.ok);

  files["EMERALD-VALIDATION-CHECKLIST.pdf"] = await buildEmeraldChecklistPdf({
    expectations: expectationsByMode.get("sepwiz-screened")!,
    verifiedPlateNames: screenedMode.inspection.plateNames,
    preflightSummaries: modes.map(
      (m) => `${screeningModeLabel(m.mode)}: ${summarizeInspection(m.inspection)}`,
    ),
    preflightOk,
    fileNames: modes.map((m) => m.fileName),
  });
  done++;

  // Text copies, so the content is greppable and diffable without a PDF reader.
  const enc = new TextEncoder();
  for (const m of modes) {
    const e = expectationsByMode.get(m.mode)!;
    files[`expected-plates-${screeningModeSlug(m.mode)}.txt`] = enc.encode(
      `${expectationsText(e)}\n\nPREFLIGHT\n\n${inspectionText(m.inspection)}\n`,
    );
  }
  files["EMERALD-VALIDATION-CHECKLIST.txt"] = enc.encode(
    `${checklistText(expectationsByMode.get("sepwiz-screened")!)}\n\n\n${readingTheTargetText()}\n`,
  );

  files["emerald-manifest.json"] = enc.encode(JSON.stringify(
    buildEmeraldManifest({ input, layout, artDpi, raster, modes, expectationsByMode, createdAt }),
    null, 2,
  ));

  files["README.txt"] = enc.encode(readmeText(input, modes, preflightOk));

  const zip = zipSync(files, { level: 6, mtime: ZIP_TIMESTAMP });
  const stem = slugify(input.jobName || "emerald-test");

  return {
    zip,
    fileName: `${stem}-emerald-validation.zip`,
    layout,
    expectations: expectationsByMode.get("sepwiz-screened")!,
    modes,
    preflightOk,
  };
}

/** The preflight, as text. */
export function inspectionText(r: PdfInspection): string {
  const lines = [summarizeInspection(r), ""];
  for (const c of r.checks) {
    lines.push(`  ${c.status.toUpperCase().padEnd(4)}  ${c.label}: ${c.detail}`);
  }
  return lines.join("\n");
}

interface ManifestInput {
  input: EmeraldPackageInput;
  layout: FilmLayout;
  artDpi: number;
  raster: { width: number; height: number; dpi: number; capped: boolean };
  modes: EmeraldModeResult[];
  expectationsByMode: Map<ScreeningMode, EmeraldExpectations>;
  createdAt: string;
}

function buildEmeraldManifest(m: ManifestInput) {
  const { input, layout, raster } = m;
  return {
    schema: "sepwiz.emerald-validation/1",
    createdAt: m.createdAt,
    purpose:
      "Validate that SepWiz spot PDFs survive AccuRIP Emerald. Not a claim that they do; " +
      "the claim is only supportable once the checklist has been filled in against a real RIP.",
    job: {
      name: input.jobName,
      customer: input.customer,
      isControlTarget: input.isControlTarget,
      garmentColor: input.plan.garmentColor,
      artworkPixels: { width: input.width, height: input.height },
      artworkDpi: Math.round(m.artDpi),
      productionSize: input.productionSize,
      boardSizeIn: {
        width: Number((layout.boardWidthPt / 72).toFixed(4)),
        height: Number((layout.boardHeightPt / 72).toFixed(4)),
      },
      scalePercent: 100,
    },
    registration: {
      layout: layout.registrationLayout,
      strokePt: Number(layout.markStroke.toFixed(4)),
      count: layout.registration.length,
      // Positions are what a RIP must carry identically onto every plate, so
      // they are recorded rather than described.
      targetsPt: layout.registration.map((r) => ({
        cx: Number(r.cx.toFixed(4)), cy: Number(r.cy.toFixed(4)), radius: Number(r.radius.toFixed(4)),
      })),
      colorSpace: "DeviceGray",
    },
    filmRaster: { width: raster.width, height: raster.height, dpi: raster.dpi, capped: raster.capped },
    // The distinction the whole package turns on, stated per file.
    screeningModes: m.modes.map((mode) => ({
      mode: mode.mode,
      label: screeningModeLabel(mode.mode),
      meaning: screeningModeDescription(mode.mode),
      file: mode.fileName,
      bytes: mode.bytes,
      halftonesAppliedBySepWiz: mode.mode === "sepwiz-screened",
      expectedPlates: m.expectationsByMode.get(mode.mode)!.plates,
      preflight: {
        ok: mode.inspection.ok,
        summary: summarizeInspection(mode.inspection),
        pageCount: mode.inspection.pageCount,
        pageSizeIn: {
          width: Number(mode.inspection.widthIn.toFixed(4)),
          height: Number(mode.inspection.heightIn.toFixed(4)),
        },
        spotPlateCount: mode.inspection.spotPlateCount,
        plateNames: mode.inspection.plateNames,
        separations: mode.inspection.separations,
        overprint: {
          fill: mode.inspection.overprintFill,
          stroke: mode.inspection.overprintStroke,
          mode: mode.inspection.overprintMode,
        },
        softMaskCount: mode.inspection.softMaskCount,
        nonSpotImageSpaces: mode.inspection.deviceSpacesUsed,
        checks: mode.inspection.checks,
      },
    })),
    plates: input.plan.inks
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((ink, i) => ({
        index: i + 1,
        name: ink.name.toUpperCase(),
        role: ink.type,
        mesh: ink.mesh,
        coveragePercent: Number((ink.coverage * 100).toFixed(3)),
        halftone: ink.halftone,
        underbaseRelationship: ink.underbase,
      })),
    notValidated: [
      "Emerald has not seen these files. Every 'expected' value in this manifest is what " +
      "SepWiz wrote, verified against the PDF specification only.",
      "Ink density and all-black output are not modelled by SepWiz at all.",
      "No printer communication of any kind is implemented.",
    ],
  };
}

function readmeText(
  input: EmeraldPackageInput,
  modes: EmeraldModeResult[],
  preflightOk: boolean,
): string {
  const lines: string[] = [];
  lines.push("SEPWIZ — ACCURIP EMERALD VALIDATION PACKAGE");
  lines.push("");
  lines.push(`Job: ${input.jobName}`);
  if (input.isControlTarget) {
    lines.push("This is the built-in EMERALD SPOT TEST control target. It contains no");
    lines.push("customer artwork and can be shared freely.");
  }
  lines.push("");
  lines.push("WHAT THIS IS FOR");
  lines.push("");
  lines.push("  Answering one question: does a SepWiz spot PDF survive AccuRIP Emerald?");
  lines.push("  Open the two spot PDFs in Emerald exactly as you would an Illustrator");
  lines.push("  file, and fill in EMERALD-VALIDATION-CHECKLIST.pdf as you go.");
  lines.push("");
  lines.push("THE TWO SPOT PDFs — THIS IS THE IMPORTANT PART");
  lines.push("");
  for (const m of modes) {
    lines.push(`  ${m.fileName}`);
    lines.push(`      ${screeningModeLabel(m.mode)}`);
    lines.push(`      ${screeningModeDescription(m.mode)}`);
    lines.push("");
  }
  lines.push("  Print both. The question they answer is who should be doing the");
  lines.push("  halftoning — SepWiz or Emerald. We do not know, and neither answer is");
  lines.push("  assumed to be the right one.");
  lines.push("");
  lines.push("CONTENTS");
  lines.push("");
  lines.push("  sepwiz-emerald-test-*.pdf          the two spot PDFs");
  lines.push("  films/                             film positives, one per screen");
  lines.push("  composite-proof.pdf                the job on the garment colour");
  lines.push("  production-sheet.pdf               shop summary");
  lines.push("  EMERALD-VALIDATION-CHECKLIST.pdf   print this and fill it in");
  lines.push("  expected-plates-*.txt              what should be in each spot PDF");
  lines.push("  emerald-manifest.json              machine-readable record");
  lines.push("");
  lines.push("SEPWIZ PREFLIGHT");
  lines.push("");
  for (const m of modes) {
    lines.push(`  ${screeningModeLabel(m.mode)}`);
    for (const line of inspectionText(m.inspection).split("\n")) lines.push(`  ${line}`);
    lines.push("");
  }
  lines.push(preflightOk
    ? "  Both files are structurally correct spot PDFs. That is a statement about"
    : "  AT LEAST ONE FILE FAILED PREFLIGHT. Do not draw conclusions about Emerald");
  lines.push(preflightOk
    ? "  the PDF specification, not about Emerald."
    : "  from a file that is already wrong.");
  lines.push("");
  lines.push("WHAT IS NOT CLAIMED");
  lines.push("");
  lines.push("  SepWiz does not replace a RIP. It does not model ink density or");
  lines.push("  all-black output, does not rasterize to a printer's native raster, and");
  lines.push("  does not communicate with printers. Emerald is doing all of that.");
  lines.push("");
  lines.push("  Until this checklist comes back filled in, 'Illustrator can be bypassed'");
  lines.push("  is a hypothesis.");
  return lines.join("\n");
}
