import { describe, it, expect, beforeAll } from "vitest";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { buildEmeraldTestJob, EMERALD_PLATE_NAMES } from "@/lib/emerald/testJob";
import { buildEmeraldPackage, spotFileName, type EmeraldPackageResult } from "@/lib/emerald/package";
import { inspectPdf, summarizeInspection } from "@/lib/emerald/inspector";
import { buildSpotPdf } from "@/lib/spot/spotPdf";
import { toSpotColors } from "@/lib/spot/spotColor";
import { buildLayout } from "@/lib/film/layout";
import { buildFilmPdf, buildProofPdf } from "@/lib/film/pdf";
import { planFilmRaster } from "@/lib/film/resample";
import { effectiveDpi } from "@/lib/production/size";
import type { ExportSettings } from "@/lib/types";

const JOB = buildEmeraldTestJob();

// 300 rather than 600 DPI: a 64-megapixel raster per plate makes the suite slow
// without testing anything the smaller raster does not.
const EXPORT: ExportSettings = {
  filmDpi: 300, includeRegistration: true, includeCropMarks: true,
  includeCenterMarks: true, marginIn: 0.75,
};

const ART_DPI = effectiveDpi(JOB.width, JOB.productionSize);

function layoutFor() {
  return buildLayout({
    pixelWidth: JOB.width, pixelHeight: JOB.height, dpi: ART_DPI,
    marginIn: EXPORT.marginIn, includeRegistration: true,
    includeCenterMarks: true, includeCropMarks: true,
  });
}

async function spotPdfFor(applyHalftones: boolean) {
  const layout = layoutFor();
  const raster = planFilmRaster(12, 15, EXPORT.filmDpi, JOB.width, JOB.height);
  return buildSpotPdf({
    spots: toSpotColors(JOB.plan.inks),
    layout,
    jobName: "EMERALD SPOT TEST",
    customer: "",
    width: JOB.width,
    height: JOB.height,
    rasterWidth: raster.width,
    rasterHeight: raster.height,
    rasterDpi: raster.dpi,
    applyHalftones,
    includeMarks: true,
  });
}

let pkg: EmeraldPackageResult;
let files: Record<string, Uint8Array>;

beforeAll(async () => {
  pkg = await buildEmeraldPackage({
    jobName: "EMERALD SPOT TEST",
    customer: "",
    plan: JOB.plan,
    width: JOB.width,
    height: JOB.height,
    productionSize: JOB.productionSize,
    exportSettings: EXPORT,
    isControlTarget: true,
  });
  files = unzipSync(pkg.zip);
}, 180_000);

describe("PDF plate inspector", () => {
  it("finds every Separation, its alternate space and its tint transform", async () => {
    const res = await spotPdfFor(true);
    const r = await inspectPdf(res.bytes);
    expect(r.spotPlateCount).toBe(6);
    expect(r.plateNames).toEqual(EMERALD_PLATE_NAMES);
    for (const s of r.separations) {
      expect(s.alternateSpace).toBe("DeviceCMYK");
      expect(s.tintTransformType).toBe(2);
      expect(s.hasSoftMask).toBe(true);
    }
  });

  it("reports overprint state and soft masks", async () => {
    const res = await spotPdfFor(false);
    const r = await inspectPdf(res.bytes);
    expect(r.overprintFill).toBe(true);
    expect(r.overprintStroke).toBe(true);
    expect(r.overprintMode).toBe(1);
    expect(r.softMaskCount).toBeGreaterThanOrEqual(6);
  });

  it("measures the page rather than trusting the request", async () => {
    const res = await spotPdfFor(false);
    const r = await inspectPdf(res.bytes);
    expect(r.pageCount).toBe(1);
    expect(r.widthIn).toBeCloseTo(13.5, 4);
    expect(r.heightIn).toBeCloseTo(16.5, 4);
    expect(r.widthPt).toBeCloseTo(972, 3);
  });

  it("reports no stray process colour in a spot PDF", async () => {
    const res = await spotPdfFor(true);
    const r = await inspectPdf(res.bytes);
    // Registration marks are DeviceGray vector art, not images, so nothing
    // should show up here at all.
    expect(r.deviceSpacesUsed).toEqual([]);
  });

  it("passes when the document matches what was claimed", async () => {
    const res = await spotPdfFor(true);
    const r = await inspectPdf(res.bytes, {
      expectedPlateNames: EMERALD_PLATE_NAMES,
      expectedPageCount: 1,
      expectedWidthIn: 13.5,
      expectedHeightIn: 16.5,
    });
    expect(r.failures, summarizeInspection(r)).toBe(0);
    expect(r.ok).toBe(true);
  });

  // The inspector's whole value is that it says no. An instrument that only
  // ever passes is not measuring anything.
  it("FAILS an ordinary film positive, which is not a spot PDF", async () => {
    const layout = layoutFor();
    const ink = JOB.plan.inks[1];
    const film = await buildFilmPdf({
      mask: { data: ink.mask, width: JOB.width, height: JOB.height },
      layout,
      halftone: null,
      embedDpi: ART_DPI,
      label: {
        jobName: "x", customer: "", index: 1, total: 6, inkName: ink.name,
        inkColor: ink.displayColor, mesh: ink.mesh, sizeText: "12 x 15 in",
        scalePercent: 100, halftone: null,
      },
    });
    const r = await inspectPdf(film, { expectedPlateNames: EMERALD_PLATE_NAMES });
    expect(r.ok).toBe(false);
    expect(r.spotPlateCount).toBe(0);
    const sep = r.checks.find((c) => c.key === "separations")!;
    expect(sep.status).toBe("fail");
    expect(sep.detail).toMatch(/not a spot-separated PDF/i);
  });

  it("FAILS an RGB composite proof labelled as a spot PDF", async () => {
    const layout = layoutFor();
    const rgba = new Uint8ClampedArray(JOB.width * JOB.height * 4).fill(200);
    const proof = await buildProofPdf({
      compositeRgba: rgba, width: JOB.width, height: JOB.height, layout,
      jobName: "x", customer: "", garmentColor: "#808080", similarityPercent: 100,
    });
    const r = await inspectPdf(proof, { expectedPlateNames: EMERALD_PLATE_NAMES });
    expect(r.ok).toBe(false);
    expect(r.spotPlateCount).toBe(0);
    expect(r.deviceSpacesUsed.some((s) => s.includes("RGB"))).toBe(true);
  });

  it("catches a missing plate rather than reporting a smaller success", async () => {
    const layout = layoutFor();
    const raster = planFilmRaster(12, 15, EXPORT.filmDpi, JOB.width, JOB.height);
    const short = await buildSpotPdf({
      spots: toSpotColors(JOB.plan.inks.slice(0, 4)),
      layout, jobName: "x", customer: "",
      width: JOB.width, height: JOB.height,
      rasterWidth: raster.width, rasterHeight: raster.height, rasterDpi: raster.dpi,
      applyHalftones: false, includeMarks: true,
    });
    const r = await inspectPdf(short.bytes, { expectedPlateNames: EMERALD_PLATE_NAMES });
    const names = r.checks.find((c) => c.key === "plate-names")!;
    expect(names.status).toBe("fail");
    expect(names.detail).toMatch(/missing: GREEN, BLACK/);
    expect(r.ok).toBe(false);
  });

  it("catches a page that is not the size it should be", async () => {
    const res = await spotPdfFor(false);
    const r = await inspectPdf(res.bytes, { expectedWidthIn: 8.5, expectedHeightIn: 11 });
    expect(r.checks.find((c) => c.key === "dimensions")!.status).toBe("fail");
  });

  it("catches the wrong page count", async () => {
    const res = await spotPdfFor(false);
    const r = await inspectPdf(res.bytes, { expectedPageCount: 6 });
    expect(r.checks.find((c) => c.key === "pages")!.status).toBe("fail");
  });
});

describe("Emerald validation package", () => {
  it("contains both screening modes under names that state which is which", () => {
    expect(Object.keys(files)).toContain("sepwiz-emerald-test-screened.pdf");
    expect(Object.keys(files)).toContain("sepwiz-emerald-test-continuous-tone.pdf");
    expect(spotFileName("sepwiz-screened")).toBe("sepwiz-emerald-test-screened.pdf");
    expect(spotFileName("continuous-tone")).toBe("sepwiz-emerald-test-continuous-tone.pdf");
  });

  it("carries a film positive for every plate, a proof, a sheet and a checklist", () => {
    const names = Object.keys(files);
    for (const slug of [
      "films/01-white-underbase.pdf", "films/02-red.pdf", "films/03-blue.pdf",
      "films/04-yellow.pdf", "films/05-green.pdf", "films/06-black.pdf",
    ]) {
      expect(names, `missing ${slug}`).toContain(slug);
    }
    expect(names).toContain("composite-proof.pdf");
    expect(names).toContain("production-sheet.pdf");
    expect(names).toContain("EMERALD-VALIDATION-CHECKLIST.pdf");
    expect(names).toContain("emerald-manifest.json");
    expect(names).toContain("README.txt");
  });

  it("passes preflight on both exports", () => {
    expect(pkg.preflightOk).toBe(true);
    for (const m of pkg.modes) {
      expect(m.inspection.ok, `${m.mode}: ${summarizeInspection(m.inspection)}`).toBe(true);
      expect(m.plateNames).toEqual(EMERALD_PLATE_NAMES);
    }
  });

  it("writes six named spot plates into each exported PDF", async () => {
    for (const mode of ["screened", "continuous-tone"] as const) {
      const bytes = files[`sepwiz-emerald-test-${mode}.pdf`];
      const r = await inspectPdf(bytes);
      expect(r.spotPlateCount, mode).toBe(6);
      expect(r.plateNames, mode).toEqual(EMERALD_PLATE_NAMES);
    }
  });

  it("gives both exports identical page geometry", async () => {
    // The two files must be comparable: if they differ in size, a difference
    // observed in Emerald could be geometry rather than screening.
    const a = await inspectPdf(files["sepwiz-emerald-test-screened.pdf"]);
    const b = await inspectPdf(files["sepwiz-emerald-test-continuous-tone.pdf"]);
    expect(a.widthPt).toBeCloseTo(b.widthPt, 6);
    expect(a.heightPt).toBeCloseTo(b.heightPt, 6);
    expect(a.widthIn).toBeCloseTo(13.5, 4);
    expect(a.heightIn).toBeCloseTo(16.5, 4);
  });

  it("actually screens one export and leaves the other continuous", () => {
    // The screened plates are rasterized to the film grid and carry hard dots,
    // so they are dramatically larger. If the two files were the same size,
    // one of the modes would be a lie.
    const screened = files["sepwiz-emerald-test-screened.pdf"].length;
    const continuous = files["sepwiz-emerald-test-continuous-tone.pdf"].length;
    expect(screened).toBeGreaterThan(continuous * 2);
  });

  it("carries only 0 and 255 in the screened plates, and midtones in the other", async () => {
    // Structural proof of who did the halftoning, read out of the image data
    // rather than inferred from the file size.
    const raster = planFilmRaster(12, 15, EXPORT.filmDpi, JOB.width, JOB.height);
    const layout = layoutFor();
    const common = {
      spots: toSpotColors(JOB.plan.inks), layout, jobName: "x", customer: "",
      width: JOB.width, height: JOB.height,
      rasterWidth: raster.width, rasterHeight: raster.height, rasterDpi: raster.dpi,
      includeMarks: false,
    };
    // Compare the same plate's sample values in both modes.
    const screened = await buildSpotPdf({ ...common, applyHalftones: true });
    const continuous = await buildSpotPdf({ ...common, applyHalftones: false });
    expect(await hasMidtones(continuous.bytes)).toBe(true);
    expect(await hasMidtones(screened.bytes)).toBe(false);
  });

  it("keeps every film positive on the same board as the spot plates", async () => {
    const spot = await inspectPdf(files["sepwiz-emerald-test-screened.pdf"]);
    for (const name of Object.keys(files).filter((f) => f.startsWith("films/"))) {
      const doc = await PDFDocument.load(files[name]);
      const page = doc.getPages()[0];
      expect(page.getWidth(), name).toBeCloseTo(spot.widthPt, 4);
      expect(page.getHeight(), name).toBeCloseTo(spot.heightPt, 4);
    }
  });

  it("states the screening distinction explicitly in the manifest", () => {
    const manifest = JSON.parse(new TextDecoder().decode(files["emerald-manifest.json"]));
    expect(manifest.schema).toBe("sepwiz.emerald-validation/1");
    expect(manifest.job.scalePercent).toBe(100);
    expect(manifest.job.isControlTarget).toBe(true);

    expect(manifest.screeningModes).toHaveLength(2);
    const screened = manifest.screeningModes.find((m: { mode: string }) => m.mode === "sepwiz-screened");
    const continuous = manifest.screeningModes.find((m: { mode: string }) => m.mode === "continuous-tone");
    expect(screened.halftonesAppliedBySepWiz).toBe(true);
    expect(continuous.halftonesAppliedBySepWiz).toBe(false);
    expect(screened.file).toBe("sepwiz-emerald-test-screened.pdf");
    expect(continuous.file).toBe("sepwiz-emerald-test-continuous-tone.pdf");
    expect(continuous.meaning).toMatch(/RIP/);
  });

  it("records registration geometry a RIP must reproduce on every plate", () => {
    const manifest = JSON.parse(new TextDecoder().decode(files["emerald-manifest.json"]));
    expect(manifest.registration.layout).toBe("t-shape");
    expect(manifest.registration.colorSpace).toBe("DeviceGray");
    expect(manifest.registration.targetsPt).toHaveLength(manifest.registration.count);
    expect(manifest.registration.count).toBe(4);
  });

  it("records the preflight it ran, not just a verdict", () => {
    const manifest = JSON.parse(new TextDecoder().decode(files["emerald-manifest.json"]));
    for (const m of manifest.screeningModes) {
      expect(m.preflight.ok).toBe(true);
      expect(m.preflight.spotPlateCount).toBe(6);
      expect(m.preflight.plateNames).toEqual(EMERALD_PLATE_NAMES);
      expect(m.preflight.overprint).toEqual({ fill: true, stroke: true, mode: 1 });
      expect(m.preflight.checks.length).toBeGreaterThanOrEqual(9);
      expect(m.preflight.nonSpotImageSpaces).toEqual([]);
    }
  });

  it("refuses to claim more than it can support", () => {
    const manifest = JSON.parse(new TextDecoder().decode(files["emerald-manifest.json"]));
    const notValidated = (manifest.notValidated as string[]).join(" ");
    expect(notValidated).toMatch(/Emerald has not seen these files/i);
    expect(notValidated).toMatch(/ink density/i);
    expect(notValidated).toMatch(/No printer communication/i);

    const readme = new TextDecoder().decode(files["README.txt"]);
    expect(readme).toMatch(/does not replace a RIP/i);
    expect(readme).toMatch(/is a hypothesis/i);
    // The README must not promise the thing the test exists to find out.
    expect(readme).not.toMatch(/replaces Illustrator/i);
  });

  it("names the plates in the expected-plates report for both modes", () => {
    for (const mode of ["screened", "continuous-tone"] as const) {
      const text = new TextDecoder().decode(files[`expected-plates-${mode}.txt`]);
      for (const name of EMERALD_PLATE_NAMES) expect(text, mode).toContain(name);
      expect(text, mode).toContain("6 spot plates");
      expect(text, mode).toContain("PREFLIGHT");
    }
    // The screened report states angles; the continuous one must not.
    expect(new TextDecoder().decode(files["expected-plates-screened.txt"])).toContain("45 LPI");
    expect(new TextDecoder().decode(files["expected-plates-continuous-tone.txt"]))
      .toMatch(/Continuous tone/i);
  });

  it("produces a printable checklist of at least three pages", async () => {
    const doc = await PDFDocument.load(files["EMERALD-VALIDATION-CHECKLIST.pdf"]);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(612, 3);
      expect(page.getHeight()).toBeCloseTo(792, 3);
    }
  });

  it("names the archive after the job", () => {
    expect(pkg.fileName).toBe("emerald-spot-test-emerald-validation.zip");
  });
});

/**
 * True when any plate image carries a value that is neither empty nor full.
 *
 * Reads the actual image samples out of the PDF, which is the only way to tell
 * a screened plate from a continuous-tone one: both are single-component
 * images in a Separation space and look identical structurally.
 */
async function hasMidtones(bytes: Uint8Array): Promise<boolean> {
  const { PDFName, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (String(dict.get(PDFName.of("Subtype")) ?? "") !== "/Image") continue;
    // Skip soft masks: they mirror the plate, so counting them would double up.
    if (!dict.has(PDFName.of("SMask"))) continue;
    const data = decodePDFRawStream(obj).decode();
    for (let i = 0; i < data.length; i += 997) {
      if (data[i] !== 0 && data[i] !== 255) return true;
    }
  }
  return false;
}
