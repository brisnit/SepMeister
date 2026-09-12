import { describe, it, expect } from "vitest";
import { runSeparation } from "@/lib/engine/pipeline";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import { runFilmQa, type FilmQaInput } from "@/lib/film/filmQa";
import { createLabelMeasurer } from "@/lib/film/pdf";
import { buildLayout } from "@/lib/film/layout";
import { planFilmRaster, resampleMask } from "@/lib/film/resample";
import type { ExportSettings, ProductionSettings, ProductionSize } from "@/lib/types";

const SETTINGS: ProductionSettings = {
  jobName: "t", garmentColor: "#111111", maxScreens: 6,
  method: "ai", meshCount: "auto", inkType: "plastisol", useGarmentAsBlack: true,
};
const EXPORT: ExportSettings = {
  filmDpi: 600, includeRegistration: true, includeCropMarks: true, includeCenterMarks: true, marginIn: 0.75,
};

const ART = generateDemoArtwork(360, 360);
const SIZE: ProductionSize = { widthIn: 12, heightIn: 12, units: "in", lockAspect: true };

function separate(halftones: boolean) {
  return runSeparation({
    pixels: ART.pixels, width: ART.width, height: ART.height, dpi: 30,
    settings: SETTINGS,
    halftoneDefaults: { enabled: halftones, lpi: 45, shape: "round" },
  });
}

async function qa(overrides: Partial<FilmQaInput> = {}, halftones = false) {
  const out = overrides.plan ? null : separate(halftones);
  const plan = overrides.plan ?? out!.plan;
  const size = overrides.productionSize ?? SIZE;
  const exportSettings = overrides.exportSettings ?? EXPORT;
  const layout = overrides.layout ?? buildLayout({
    pixelWidth: ART.width, pixelHeight: ART.height,
    dpi: ART.width / size.widthIn,
    marginIn: exportSettings.marginIn,
    includeRegistration: exportSettings.includeRegistration,
    includeCenterMarks: exportSettings.includeCenterMarks,
    includeCropMarks: exportSettings.includeCropMarks,
  });
  const raster = planFilmRaster(size.widthIn, size.heightIn, exportSettings.filmDpi, ART.width, ART.height);
  const measure = await createLabelMeasurer();

  return runFilmQa({
    plan,
    layout,
    films: plan.inks.map((i) => ({ name: i.name, rasterWidth: ART.width, rasterHeight: ART.height })),
    expectedScreens: plan.inks.length,
    productionSize: size,
    exportSettings,
    rasterDpi: raster.dpi,
    rasterCapped: raster.capped,
    artworkPixelWidth: ART.width,
    artworkPixelHeight: ART.height,
    ...overrides,
  }, measure);
}

function find(report: Awaited<ReturnType<typeof qa>>, key: string) {
  const c = report.checks.find((x) => x.key === key);
  expect(c, `expected a "${key}" check`).toBeDefined();
  return c!;
}

describe("film QA", () => {
  it("passes a well-formed job", async () => {
    const report = await qa();
    expect(report.failures).toBe(0);
    expect(report.passed).toBeGreaterThanOrEqual(6);
    for (const c of report.checks) expect(c.detail.length).toBeGreaterThan(0);
  });

  it("reports every documented check", async () => {
    const report = await qa();
    const keys = report.checks.map((c) => c.key);
    for (const k of ["count", "bounds", "registration", "dimensions", "aspect", "labels", "monochrome", "halftone", "resolution"]) {
      expect(keys, `missing check: ${k}`).toContain(k);
    }
  });

  it("fails when a film is missing", async () => {
    const out = separate(false);
    const report = await qa({
      plan: out.plan,
      films: out.plan.inks.slice(1).map((i) => ({ name: i.name, rasterWidth: ART.width, rasterHeight: ART.height })),
      expectedScreens: out.plan.inks.length,
    });
    expect(find(report, "count").status).toBe("fail");
    expect(report.failures).toBeGreaterThan(0);
  });

  it("confirms the artboard matches the requested physical size", async () => {
    const report = await qa();
    const c = find(report, "dimensions");
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("12.00 × 12.00 in");
    expect(c.detail).toContain("100%");
  });

  it("fails when the artboard does not match the requested size", async () => {
    // A layout built for a different size than the one being claimed.
    const wrong = buildLayout({
      pixelWidth: ART.width, pixelHeight: ART.height, dpi: 300,
      marginIn: 0.75, includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    const report = await qa({ layout: wrong });
    expect(find(report, "dimensions").status).toBe("fail");
  });

  it("warns when the print size would stretch the artwork", async () => {
    const stretched: ProductionSize = { widthIn: 12, heightIn: 6, units: "in", lockAspect: false };
    const report = await qa({ productionSize: stretched });
    const c = find(report, "aspect");
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("stretched");
  });

  it("verifies registration marks are present and clear of the artwork", async () => {
    const report = await qa();
    const c = find(report, "registration");
    expect(c.status).toBe("pass");
    // T-shape: three across the top plus one at bottom centre.
    expect(c.detail).toContain("4 targets");
  });

  it("warns when registration marks are switched off", async () => {
    const noMarks: ExportSettings = { ...EXPORT, includeRegistration: false };
    const report = await qa({ exportSettings: noMarks });
    const c = find(report, "registration");
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("cannot be aligned");
  });

  it("accepts differing raster sizes when the physical placement matches", async () => {
    // Solid films are not resampled while screened ones are, so a correct job
    // legitimately mixes raster sizes.
    const out = separate(false);
    const report = await qa({
      plan: out.plan,
      films: out.plan.inks.map((i, idx) => ({
        name: i.name,
        rasterWidth: idx === 0 ? ART.width : ART.width * 2,
        rasterHeight: idx === 0 ? ART.height : ART.height * 2,
      })),
    });
    expect(find(report, "bounds").status).toBe("pass");
  });

  it("fails when films disagree on proportions", async () => {
    const out = separate(false);
    const report = await qa({
      plan: out.plan,
      films: out.plan.inks.map((i, idx) => ({
        name: i.name,
        rasterWidth: ART.width,
        rasterHeight: idx === 0 ? ART.height : Math.round(ART.height / 2),
      })),
    });
    expect(find(report, "bounds").status).toBe("fail");
  });

  it("actually screens the masks to verify monochrome output", async () => {
    const report = await qa({}, true);
    const c = find(report, "monochrome");
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("verified binary");
  });

  it("reports solid films as single-channel rather than claiming they are binary", async () => {
    const report = await qa({}, false);
    const c = find(report, "monochrome");
    expect(c.status).toBe("pass");
    // Continuous-tone films are legitimately grey; the wording must not
    // overclaim that they were verified as pure black and white.
    expect(c.detail).toContain("single-channel");
    expect(c.detail).not.toContain("verified binary");
  });

  it("summarises the halftone settings actually in use", async () => {
    const report = await qa({}, true);
    const c = find(report, "halftone");
    expect(c.status === "pass" || c.status === "warn").toBe(true);
    expect(c.detail).toContain("LPI");
  });

  it("says so plainly when nothing is screened", async () => {
    const report = await qa({}, false);
    expect(find(report, "halftone").detail).toContain("All screens solid");
  });

  it("fails on an invalid line count", async () => {
    const out = separate(true);
    const screened = out.plan.inks.find((i) => i.halftone.enabled)!;
    screened.halftone = { ...screened.halftone, lpi: 0 };
    const report = await qa({ plan: out.plan });
    expect(find(report, "halftone").status).toBe("fail");
  });

  it("warns when the film resolution cannot resolve the requested screen", async () => {
    const out = separate(true);
    for (const ink of out.plan.inks) {
      if (ink.halftone.enabled) ink.halftone = { ...ink.halftone, lpi: 65 };
    }
    // 100 DPI film cannot hold a 65 LPI screen.
    const report = await qa({ plan: out.plan, rasterDpi: 100 });
    const c = find(report, "halftone");
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("higher film resolution");
  });

  it("verifies labels are clear of the artwork and the marks", async () => {
    const report = await qa();
    const c = find(report, "labels");
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("clear of artwork");
  });

  it("counts passes, warnings and failures", async () => {
    const report = await qa();
    expect(report.passed + report.warnings + report.failures).toBe(report.checks.length);
  });

  it("is deterministic", async () => {
    const a = await qa();
    const b = await qa();
    expect(a.checks).toEqual(b.checks);
  });
});

describe("film raster planning", () => {
  it("rasterizes at the requested output resolution", () => {
    const plan = planFilmRaster(12, 15, 600, 1000, 1250);
    expect(plan.width).toBe(7200);
    expect(plan.height).toBe(9000);
    expect(plan.dpi).toBeCloseTo(600, 6);
    expect(plan.capped).toBe(false);
  });

  it("never drops below the artwork's own detail", () => {
    // A tiny print size must not throw away pixels the separation contains.
    const plan = planFilmRaster(1, 1, 300, 2000, 2000);
    expect(plan.width).toBeGreaterThanOrEqual(2000);
  });

  it("renders ordinary shop sizes at full resolution", () => {
    // 12 x 15in at 600 DPI is 64.8 megapixels — a common job that must not be
    // silently downgraded.
    for (const [w, h] of [[12, 15], [11, 17], [12, 12]] as [number, number][]) {
      const plan = planFilmRaster(w, h, 600, 1000, 1000);
      expect(plan.capped, `${w}x${h}in at 600 DPI should not cap`).toBe(false);
      expect(plan.dpi).toBeCloseTo(600, 6);
    }
  });

  it("caps absurd requests and says it did", () => {
    const plan = planFilmRaster(40, 40, 1200, 1000, 1000);
    expect(plan.capped).toBe(true);
    expect(plan.width * plan.height).toBeLessThanOrEqual(120_000_000);
    expect(plan.dpi).toBeLessThan(1200);
  });
});

describe("mask resampling", () => {
  it("returns an independent copy at the same size", () => {
    const src = { width: 4, height: 4, data: new Uint8ClampedArray(16).fill(128) };
    const out = resampleMask(src, 4, 4);
    expect(out.data).not.toBe(src.data);
    expect(Buffer.from(out.data)).toEqual(Buffer.from(src.data));
  });

  it("preserves a flat field exactly", () => {
    const src = { width: 8, height: 8, data: new Uint8ClampedArray(64).fill(200) };
    const out = resampleMask(src, 32, 32);
    expect(out.width).toBe(32);
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBe(200);
  });

  it("keeps solid and empty regions at their extremes", () => {
    const w = 16;
    const src = { width: w, height: w, data: new Uint8ClampedArray(w * w) };
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) src.data[y * w + x] = x < w / 2 ? 255 : 0;
    const out = resampleMask(src, 64, 64);
    // Interior of each half must stay at its extreme; only the seam blends.
    expect(out.data[32 * 64 + 4]).toBe(255);
    expect(out.data[32 * 64 + 60]).toBe(0);
  });

  it("is deterministic", () => {
    const src = { width: 10, height: 10, data: new Uint8ClampedArray(100) };
    for (let i = 0; i < 100; i++) src.data[i] = (i * 17) % 256;
    expect(Buffer.from(resampleMask(src, 37, 37).data)).toEqual(Buffer.from(resampleMask(src, 37, 37).data));
  });
});
