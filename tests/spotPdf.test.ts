import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { runSeparation } from "@/lib/engine/pipeline";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import { buildLayout } from "@/lib/film/layout";
import { buildSpotPdf, extractSeparationNames } from "@/lib/spot/spotPdf";
import { toSpotColors, plateName, uniquePlateNames, rgbToCmyk, extractPantone } from "@/lib/spot/spotColor";
import type { ProductionSettings } from "@/lib/types";

const SETTINGS: ProductionSettings = {
  jobName: "t", garmentColor: "#111111", maxScreens: 6,
  method: "ai", meshCount: "auto", inkType: "plastisol", useGarmentAsBlack: true,
};

const ART = generateDemoArtwork(300, 300);

function separate(halftones = false) {
  return runSeparation({
    pixels: ART.pixels, width: ART.width, height: ART.height, dpi: 150,
    settings: SETTINGS,
    halftoneDefaults: { enabled: halftones, lpi: 45, shape: "round" },
  });
}

function layoutFor() {
  return buildLayout({
    pixelWidth: ART.width, pixelHeight: ART.height, dpi: 150, marginIn: 0.75,
    includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
  });
}

async function makeSpotPdf(halftones = false) {
  const out = separate(halftones);
  const spots = toSpotColors(out.plan.inks);
  const layout = layoutFor();
  const res = await buildSpotPdf({
    spots,
    layout,
    jobName: "Sailor Tee",
    customer: "Nick's Screen Printing",
    width: ART.width,
    height: ART.height,
    rasterWidth: ART.width * 2,
    rasterHeight: ART.height * 2,
    rasterDpi: 300,
    applyHalftones: halftones,
    includeMarks: true,
  });
  return { out, spots, layout, res };
}

describe("spot colour model", () => {
  it("normalizes plate names for a PDF colourant", () => {
    expect(plateName("Light Blue")).toBe("LIGHT BLUE");
    expect(plateName("  navy  ")).toBe("NAVY");
    expect(plateName("PANTONE 186 C")).toBe("PANTONE 186 C");
    // Characters that would need escaping in a PDF name are removed.
    expect(plateName("Red#1(spot)")).toBe("RED 1 SPOT");
    expect(plateName("")).toBe("SPOT");
  });

  it("keeps every plate name distinct", () => {
    // Two plates sharing a name would merge in the RIP.
    const names = uniquePlateNames(["Navy", "Navy", "navy"]);
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toBe("NAVY");
  });

  it("converts to CMYK for the alternate space", () => {
    expect(rgbToCmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    const red = rgbToCmyk(255, 0, 0);
    expect(red.k).toBeCloseTo(0, 6);
    expect(red.c).toBeCloseTo(0, 6);
    expect(red.m).toBeCloseTo(1, 6);
    expect(red.y).toBeCloseTo(1, 6);
    const white = rgbToCmyk(255, 255, 255);
    expect(white).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });

  it("extracts a Pantone reference only when the artist typed one", () => {
    expect(extractPantone("PANTONE 186 C")).toBe("PANTONE 186 C");
    expect(extractPantone("PMS 286")).toBe("PANTONE 286");
    // Never inferred from colour — that would put an unverified number on a
    // press ticket.
    expect(extractPantone("Navy")).toBeNull();
    expect(extractPantone("Light Blue")).toBeNull();
  });

  it("carries production metadata onto every spot", () => {
    const out = separate(true);
    const spots = toSpotColors(out.plan.inks);
    expect(spots.length).toBe(out.plan.inks.length);
    spots.forEach((s, i) => {
      expect(s.printOrder).toBe(i);
      expect(s.mesh).toBeGreaterThan(0);
      expect(s.mask.length).toBe(ART.width * ART.height);
      expect(["full", "reduced", "none"]).toContain(s.underbaseRelationship);
      expect(s.alternateCmyk).toBeDefined();
    });
  });

  it("orders spots by print order", () => {
    const out = separate();
    const spots = toSpotColors(out.plan.inks);
    const base = spots.find((s) => s.role === "underbase");
    if (base) expect(base.printOrder).toBe(0);
  });
});

describe("spot PDF structure", () => {
  it("emits a real Separation colour space per plate", async () => {
    const { res, spots } = await makeSpotPdf();
    const names = extractSeparationNames(res.bytes);
    // The whole milestone: named separations must genuinely exist in the file.
    for (const spot of spots) {
      expect(names, `missing plate ${spot.name}`).toContain(spot.name);
    }
  });

  it("has exactly one plate per separation", async () => {
    const { res, spots } = await makeSpotPdf();
    expect(res.plateNames).toHaveLength(spots.length);
    expect(new Set(res.plateNames).size).toBe(spots.length);
  });

  it("names plates the way the press ticket does", async () => {
    const { res } = await makeSpotPdf();
    expect(res.plateNames.every((n) => n === n.toUpperCase())).toBe(true);
  });

  it("is a loadable PDF at the right physical size", async () => {
    const { res, layout } = await makeSpotPdf();
    expect(new TextDecoder().decode(res.bytes.subarray(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(res.bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(layout.boardWidthPt, 4);
    expect(height).toBeCloseTo(layout.boardHeightPt, 4);
  });

  /**
   * Walks the object graph rather than the raw bytes, so this fails if the
   * separations are only *mentioned* somewhere instead of being the colour
   * space an image actually draws in.
   */
  async function inspectPlates(bytes: Uint8Array) {
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const resources = page.node.Resources()!;
    const xobjects = page.node.context.lookup(resources.get(PDFName.of("XObject"))) as PDFDict;
    expect(xobjects, "no XObject resources").toBeDefined();

    const plates: { name: string; alternate: string; bits: number; width: number; height: number }[] = [];
    for (const [, ref] of xobjects.entries()) {
      const stream = page.node.context.lookup(ref) as PDFRawStream;
      const dict = stream.dict;
      if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
      const cs = page.node.context.lookup(dict.get(PDFName.of("ColorSpace"))) as PDFArray;
      expect(cs, "image has no colour space array").toBeDefined();
      expect(cs.get(0).toString()).toBe("/Separation");
      plates.push({
        name: cs.get(1).toString().replace(/^\//, "").replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
        alternate: cs.get(2).toString(),
        bits: Number(dict.get(PDFName.of("BitsPerComponent"))?.toString()),
        width: Number(dict.get(PDFName.of("Width"))?.toString()),
        height: Number(dict.get(PDFName.of("Height"))?.toString()),
      });
    }
    return plates;
  }

  it("draws each plate as a one-component image in its own Separation space", async () => {
    const { res, spots } = await makeSpotPdf();
    const plates = await inspectPlates(res.bytes);

    expect(plates).toHaveLength(spots.length);
    for (const plate of plates) {
      expect(plate.alternate).toBe("/DeviceCMYK");
      expect(plate.bits).toBe(8);
      expect(plate.width).toBeGreaterThan(0);
    }
    expect(plates.map((p) => p.name).sort()).toEqual(spots.map((s) => s.name).sort());
  });

  it("gives every Separation a tint transform", async () => {
    const { res } = await makeSpotPdf();
    const doc = await PDFDocument.load(res.bytes);
    const page = doc.getPage(0);
    const xobjects = page.node.context.lookup(
      page.node.Resources()!.get(PDFName.of("XObject")),
    ) as PDFDict;

    let checked = 0;
    for (const [, ref] of xobjects.entries()) {
      const stream = page.node.context.lookup(ref) as PDFRawStream;
      const cs = page.node.context.lookup(stream.dict.get(PDFName.of("ColorSpace"))) as PDFArray;
      const fn = page.node.context.lookup(cs.get(3)) as PDFDict;
      expect(fn, "separation has no tint transform").toBeDefined();
      expect(fn.get(PDFName.of("FunctionType"))?.toString()).toBe("2");
      // Tint 0 must mean no ink, or plates would fill their whole rectangle.
      const c0 = page.node.context.lookup(fn.get(PDFName.of("C0"))) as PDFArray;
      for (let i = 0; i < c0.size(); i++) expect(Number(c0.get(i).toString())).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("turns on overprint so plates do not knock each other out", async () => {
    const { res } = await makeSpotPdf();
    const doc = await PDFDocument.load(res.bytes);
    const page = doc.getPage(0);
    const gs = page.node.context.lookup(
      page.node.Resources()!.get(PDFName.of("ExtGState")),
    ) as PDFDict;
    expect(gs, "no ExtGState").toBeDefined();

    const entries = [...gs.entries()];
    expect(entries.length).toBeGreaterThan(0);
    const state = page.node.context.lookup(entries[0][1]) as PDFDict;
    expect(state.get(PDFName.of("OP"))?.toString()).toBe("true");
    expect(state.get(PDFName.of("op"))?.toString()).toBe("true");
  });

  it("actually draws every plate in the content stream", async () => {
    const { res, spots } = await makeSpotPdf();
    const doc = await PDFDocument.load(res.bytes);
    const page = doc.getPage(0);
    const contents = page.node.context.lookup(page.node.get(PDFName.of("Contents")));
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((r) => page.node.context.lookup(r))
      : [contents];
    const text = streams
      .map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode()))
      .join("\n");

    // A document that declares plates but never paints them is not separated.
    for (let i = 0; i < spots.length; i++) {
      expect(text, `plate ${i} never drawn`).toContain(`/Plate${i} Do`);
    }
    expect(text).toContain("/GSOverprint gs");
  });

  it("carries coverage as tint, not inverted film density", async () => {
    // Mask 255 is full ink and must reach the plate as tint 255. Inverting
    // here would hand the RIP a negative of every separation.
    const out = separate();
    const spots = toSpotColors(out.plan.inks);
    const solid = spots.find((s) => s.mask.some((v) => v === 255));
    expect(solid, "expected at least one fully covered pixel").toBeDefined();

    const res = await buildSpotPdf({
      spots: [solid!], layout: layoutFor(), jobName: "j", customer: "",
      width: ART.width, height: ART.height,
      rasterWidth: ART.width, rasterHeight: ART.height, rasterDpi: 150,
      applyHalftones: false, includeMarks: false,
    });

    const doc = await PDFDocument.load(res.bytes);
    const page = doc.getPage(0);
    const xobjects = page.node.context.lookup(
      page.node.Resources()!.get(PDFName.of("XObject")),
    ) as PDFDict;
    const ref = [...xobjects.entries()][0][1];
    const stream = page.node.context.lookup(ref) as PDFRawStream;
    const samples = decodePDFRawStream(stream).decode();

    let maxSample = 0;
    for (let i = 0; i < samples.length; i++) if (samples[i] > maxSample) maxSample = samples[i];
    expect(maxSample).toBe(255);

    // And the zero-coverage areas must be zero tint, not 255.
    const zeroIndex = solid!.mask.findIndex((v) => v === 0);
    if (zeroIndex >= 0) expect(samples[zeroIndex]).toBe(0);
  });

  it("screens plates when halftones are on", async () => {
    const { res } = await makeSpotPdf(true);
    const doc = await PDFDocument.load(res.bytes);
    const page = doc.getPage(0);
    const xobjects = page.node.context.lookup(
      page.node.Resources()!.get(PDFName.of("XObject")),
    ) as PDFDict;

    let sawBinary = false;
    for (const [, ref] of xobjects.entries()) {
      const stream = page.node.context.lookup(ref) as PDFRawStream;
      const samples = decodePDFRawStream(stream).decode();
      const values = new Set<number>();
      for (let i = 0; i < samples.length; i += 97) values.add(samples[i]);
      // A screened plate is binary; a solid one legitimately is not.
      if ([...values].every((v) => v === 0 || v === 255) && values.size > 1) sawBinary = true;
    }
    expect(sawBinary).toBe(true);
  });

  it("is deterministic", async () => {
    const a = await makeSpotPdf();
    const b = await makeSpotPdf();
    expect(Buffer.from(a.res.bytes)).toEqual(Buffer.from(b.res.bytes));
  });

  it("survives long and awkward ink names", async () => {
    const out = separate();
    const spots = toSpotColors(out.plan.inks);
    spots[0] = { ...spots[0], name: plateName("Extremely Long Custom Pantone 186 C Ink Name") };
    const res = await buildSpotPdf({
      spots, layout: layoutFor(), jobName: "j", customer: "",
      width: ART.width, height: ART.height,
      rasterWidth: ART.width, rasterHeight: ART.height, rasterDpi: 150,
      applyHalftones: false, includeMarks: true,
    });
    const names = extractSeparationNames(res.bytes);
    expect(names).toContain(spots[0].name);
  });
});
