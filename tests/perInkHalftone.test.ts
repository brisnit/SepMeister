import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { runSeparation } from "@/lib/engine/pipeline";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import { buildExportBundle, halftoneParamsFor, describeHalftones, collectProductionWarnings } from "@/lib/film/bundle";
import { maskToFilmGray, isMonochrome } from "@/lib/film/render";
import { suggestPrintOrder, applyPrintOrder } from "@/lib/engine/printOrder";
import type {
  ExportSettings, HalftoneSettings, JobMetadata, ProductionSettings, ProductionSize,
} from "@/lib/types";

const SETTINGS: ProductionSettings = {
  jobName: "t", garmentColor: "#111111", maxScreens: 6,
  method: "ai", meshCount: "auto", inkType: "plastisol", useGarmentAsBlack: true,
};
const METADATA: JobMetadata = {
  id: "job_1", jobName: "Sailor Tee", customer: "Nick's Screen Printing",
  notes: "Print notes", createdAt: "2024-01-01T00:00:00.000Z",
};
const SIZE: ProductionSize = { widthIn: 12, heightIn: 12, units: "in", lockAspect: true };
const EXPORT: ExportSettings = {
  filmDpi: 300, includeRegistration: true, includeCropMarks: true, includeCenterMarks: true, marginIn: 0.75,
};

function separate(halftone?: HalftoneSettings) {
  const art = generateDemoArtwork(360, 360);
  const out = runSeparation({
    pixels: art.pixels, width: art.width, height: art.height, dpi: 300,
    settings: SETTINGS, halftoneDefaults: halftone,
  });
  return { art, out };
}

describe("per-ink halftone defaults", () => {
  it("gives every separation its own halftone settings", () => {
    const { out } = separate({ enabled: true, lpi: 45, shape: "round" });
    for (const ink of out.plan.inks) {
      expect(ink.halftone).toBeDefined();
      expect(ink.halftone.lpi).toBe(45);
      expect(ink.halftone.shape).toBe("round");
      expect(typeof ink.halftone.angle).toBe("number");
    }
  });

  it("leaves the underbase solid even when halftones are on", () => {
    const { out } = separate({ enabled: true, lpi: 45, shape: "round" });
    const base = out.plan.inks.find((i) => i.type === "underbase");
    expect(base).toBeDefined();
    // A screened base prints thin and see-through; it should default to solid.
    expect(base!.halftone.enabled).toBe(false);
    for (const ink of out.plan.inks.filter((i) => i.type !== "underbase")) {
      expect(ink.halftone.enabled).toBe(true);
    }
  });

  it("gives each screen a distinct angle by default", () => {
    const { out } = separate({ enabled: true, lpi: 45, shape: "round" });
    const printed = out.plan.inks.filter((i) => i.halftone.enabled);
    const angles = printed.map((i) => i.halftone.angle);
    expect(new Set(angles).size).toBe(angles.length);
  });

  it("defaults to solid when no halftone settings are supplied", () => {
    const { out } = separate();
    for (const ink of out.plan.inks) expect(ink.halftone.enabled).toBe(false);
  });

  it("is deterministic", () => {
    const a = separate({ enabled: true, lpi: 55, shape: "ellipse" });
    const b = separate({ enabled: true, lpi: 55, shape: "ellipse" });
    expect(a.out.plan.inks.map((i) => i.halftone)).toEqual(b.out.plan.inks.map((i) => i.halftone));
  });
});

describe("halftone parameters reach the film", () => {
  it("derives film parameters from the ink, not a global", () => {
    const { out } = separate({ enabled: true, lpi: 45, shape: "round" });
    const ink = out.plan.inks.find((i) => i.type !== "underbase")!;
    const edited = { ...ink, halftone: { enabled: true, lpi: 65, angle: 37.5, shape: "square" as const } };
    const params = halftoneParamsFor(edited, 600);
    expect(params).toEqual({ lpi: 65, angle: 37.5, shape: "square", dpi: 600 });
  });

  it("returns null for a solid screen", () => {
    const { out } = separate();
    expect(halftoneParamsFor(out.plan.inks[0], 600)).toBeNull();
  });

  it("changes the rendered film when LPI changes", () => {
    const { art, out } = separate({ enabled: true, lpi: 30, shape: "round" });
    const ink = out.plan.inks.find((i) => i.type !== "underbase")!;
    const mask = { width: art.width, height: art.height, data: ink.mask };
    const coarse = maskToFilmGray(mask, { halftone: { lpi: 25, angle: 22.5, shape: "round", dpi: 300 }, dpi: 300 });
    const fine = maskToFilmGray(mask, { halftone: { lpi: 65, angle: 22.5, shape: "round", dpi: 300 }, dpi: 300 });
    expect(Buffer.from(coarse)).not.toEqual(Buffer.from(fine));
    expect(isMonochrome(coarse)).toBe(true);
    expect(isMonochrome(fine)).toBe(true);
  });

  it("changes the rendered film when the angle changes", () => {
    const { art, out } = separate({ enabled: true, lpi: 35, shape: "round" });
    const ink = out.plan.inks.find((i) => i.type !== "underbase")!;
    const mask = { width: art.width, height: art.height, data: ink.mask };
    const a = maskToFilmGray(mask, { halftone: { lpi: 35, angle: 15, shape: "round", dpi: 300 }, dpi: 300 });
    const b = maskToFilmGray(mask, { halftone: { lpi: 35, angle: 75, shape: "round", dpi: 300 }, dpi: 300 });
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
  });

  it("changes the rendered film when the dot shape changes", () => {
    const { art, out } = separate({ enabled: true, lpi: 35, shape: "round" });
    const ink = out.plan.inks.find((i) => i.type !== "underbase")!;
    const mask = { width: art.width, height: art.height, data: ink.mask };
    const round = maskToFilmGray(mask, { halftone: { lpi: 35, angle: 22.5, shape: "round", dpi: 300 }, dpi: 300 });
    const square = maskToFilmGray(mask, { halftone: { lpi: 35, angle: 22.5, shape: "square", dpi: 300 }, dpi: 300 });
    expect(Buffer.from(round)).not.toEqual(Buffer.from(square));
  });

  it("describes a mixed job honestly", () => {
    const { out } = separate({ enabled: true, lpi: 45, shape: "round" });
    const text = describeHalftones(out.plan.inks);
    expect(text).toContain("45 LPI");
    expect(text).toContain("solid");
  });
});

describe("export honours per-ink halftones", () => {
  async function exportWith(halftone: HalftoneSettings, mutate?: (inks: ReturnType<typeof separate>["out"]["plan"]["inks"]) => void) {
    const { art, out } = separate(halftone);
    if (mutate) mutate(out.plan.inks);
    return buildExportBundle({
      metadata: METADATA,
      plan: out.plan,
      settings: SETTINGS,
      productionSize: SIZE,
      halftone,
      exportSettings: EXPORT,
      qa: out.qa,
      similarityPercent: out.similarity.percent,
      width: art.width,
      height: art.height,
      compositeRgba: out.compositeRgba,
      thumbnail: null,
      originalThumbnail: null,
    });
  }

  it("writes per-screen halftone settings into the manifest", async () => {
    const res = await exportWith({ enabled: true, lpi: 45, shape: "round" }, (inks) => {
      const target = inks.find((i) => i.type !== "underbase")!;
      target.halftone = { enabled: true, lpi: 65, angle: 37.5, shape: "ellipse" };
    });
    const files = unzipSync(res.zip);
    const manifest = JSON.parse(new TextDecoder().decode(files["job-manifest.json"]));
    const edited = manifest.screens.find((s: { halftone: { lpi: number } }) => s.halftone.lpi === 65);
    expect(edited).toBeDefined();
    expect(edited.halftone.angle).toBe(37.5);
    expect(edited.halftone.shape).toBe("ellipse");
    // The base is still solid.
    const base = manifest.screens.find((s: { type: string }) => s.type === "underbase");
    expect(base.halftone.enabled).toBe(false);
  });

  it("produces different film bytes when a single screen's LPI changes", async () => {
    const a = await exportWith({ enabled: true, lpi: 45, shape: "round" });
    const b = await exportWith({ enabled: true, lpi: 45, shape: "round" }, (inks) => {
      const target = inks.find((i) => i.type !== "underbase")!;
      target.halftone = { ...target.halftone, lpi: 25 };
    });
    const fa = unzipSync(a.zip);
    const fb = unzipSync(b.zip);
    const names = Object.keys(fa).filter((n) => n.startsWith("png/"));
    const changed = names.filter((n) => Buffer.compare(Buffer.from(fa[n]), Buffer.from(fb[n])) !== 0);
    expect(changed.length).toBeGreaterThan(0);
  });

  it("carries the job name and customer into the manifest", async () => {
    const res = await exportWith({ enabled: false, lpi: 45, shape: "round" });
    const files = unzipSync(res.zip);
    const manifest = JSON.parse(new TextDecoder().decode(files["job-manifest.json"]));
    expect(manifest.job.name).toBe("Sailor Tee");
    expect(manifest.job.customer).toBe("Nick's Screen Printing");
    expect(manifest.job.notes).toBe("Print notes");
    expect(res.fileName).toContain("sailor-tee");
  });

  it("records the physical size and both resolutions", async () => {
    const res = await exportWith({ enabled: false, lpi: 45, shape: "round" });
    const files = unzipSync(res.zip);
    const manifest = JSON.parse(new TextDecoder().decode(files["job-manifest.json"]));
    expect(manifest.artwork.widthIn).toBe(12);
    // 360px across 12in is 30 DPI of real detail.
    expect(manifest.artwork.effectiveDpi).toBe(30);
    expect(manifest.film.requestedDpi).toBe(300);
    expect(manifest.film.scalePercent).toBe(100);
    expect(manifest.film.widthIn).toBeCloseTo(13.5, 6);
  });

  it("adds the original artwork only to a test package", async () => {
    const { art, out } = separate();
    const thumb = { data: new Uint8Array(art.width * art.height * 3), width: art.width, height: art.height };
    const base = {
      metadata: METADATA, plan: out.plan, settings: SETTINGS, productionSize: SIZE,
      halftone: { enabled: false, lpi: 45, shape: "round" as const }, exportSettings: EXPORT,
      qa: out.qa, similarityPercent: out.similarity.percent,
      width: art.width, height: art.height, compositeRgba: out.compositeRgba, thumbnail: null,
    };
    const plain = await buildExportBundle({ ...base, originalThumbnail: thumb });
    const test = await buildExportBundle({ ...base, originalThumbnail: thumb, testPackage: true });

    expect(Object.keys(unzipSync(plain.zip))).not.toContain("original-artwork.png");
    expect(Object.keys(unzipSync(test.zip))).toContain("original-artwork.png");
    expect(test.fileName).toContain("test-package");
  });
});

describe("production warnings", () => {
  it("flags a line count the mesh cannot hold", () => {
    const { out } = separate({ enabled: true, lpi: 45, shape: "round" });
    for (const ink of out.plan.inks) {
      ink.mesh = 110;
      if (ink.type !== "underbase") ink.halftone = { ...ink.halftone, enabled: true, lpi: 65 };
    }
    const warnings = collectProductionWarnings(out.plan, out.qa);
    expect(warnings.some((w) => w.includes("110 mesh"))).toBe(true);
  });

  it("flags screens whose angles are too close", () => {
    const { out } = separate({ enabled: true, lpi: 45, shape: "round" });
    for (const ink of out.plan.inks) {
      if (ink.type !== "underbase") ink.halftone = { ...ink.halftone, enabled: true, angle: 22.5 };
    }
    const warnings = collectProductionWarnings(out.plan, out.qa);
    expect(warnings.some((w) => w.includes("moire"))).toBe(true);
  });

  it("stays quiet on a sane configuration", () => {
    const { out } = separate({ enabled: true, lpi: 35, shape: "round" });
    for (const ink of out.plan.inks) ink.mesh = 305;
    const warnings = collectProductionWarnings(out.plan, { ...out.qa, warnings: [] });
    expect(warnings.filter((w) => w.includes("mesh") || w.includes("moire"))).toHaveLength(0);
  });
});

describe("print order", () => {
  it("puts the base first and black last", () => {
    const { out } = separate();
    const suggestion = suggestPrintOrder(out.plan.inks);
    const byId = new Map(out.plan.inks.map((i) => [i.id, i]));
    const types = suggestion.order.map((id) => byId.get(id)!.type);
    if (types.includes("underbase")) expect(types[0]).toBe("underbase");
    if (types.includes("black")) expect(types[types.length - 1]).toBe("black");
    expect(suggestion.reasoning.length).toBeGreaterThan(30);
  });

  it("matches the order the pipeline already produced", () => {
    const { out } = separate();
    // The pipeline seeds from the same heuristic, so they must agree.
    expect(suggestPrintOrder(out.plan.inks).matchesCurrent).toBe(true);
  });

  it("preserves a manual reorder", () => {
    const { out } = separate();
    const ids = [...out.plan.inks].sort((a, b) => a.order - b.order).map((i) => i.id);
    const shuffled = [ids[ids.length - 1], ...ids.slice(0, -1)];
    const reordered = applyPrintOrder(out.plan.inks, shuffled);
    expect(reordered.map((i) => i.id)).toEqual(shuffled);
    reordered.forEach((ink, i) => expect(ink.order).toBe(i));
    expect(suggestPrintOrder(reordered).matchesCurrent).toBe(false);
  });

  it("keeps inks the order does not mention", () => {
    const { out } = separate();
    const ids = [...out.plan.inks].sort((a, b) => a.order - b.order).map((i) => i.id);
    const partial = applyPrintOrder(out.plan.inks, [ids[2]]);
    expect(partial).toHaveLength(out.plan.inks.length);
    expect(partial[0].id).toBe(ids[2]);
  });

  it("exports films in the artist's order, not the suggestion", async () => {
    const { art, out } = separate();
    const ids = [...out.plan.inks].sort((a, b) => a.order - b.order).map((i) => i.id);
    const reversed = [...ids].reverse();
    const plan = { ...out.plan, inks: applyPrintOrder(out.plan.inks, reversed), printOrder: reversed };

    const res = await buildExportBundle({
      metadata: METADATA, plan, settings: SETTINGS, productionSize: SIZE,
      halftone: { enabled: false, lpi: 45, shape: "round" }, exportSettings: EXPORT,
      qa: out.qa, similarityPercent: out.similarity.percent,
      width: art.width, height: art.height, compositeRgba: out.compositeRgba,
      thumbnail: null, originalThumbnail: null,
    });
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(res.zip)["job-manifest.json"]));
    expect(manifest.separation.printOrder).toEqual(reversed);
    expect(manifest.screens.map((s: { id: string }) => s.id)).toEqual(reversed);
  });
});
