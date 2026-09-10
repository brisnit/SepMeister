import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { runSeparation } from "@/lib/engine/pipeline";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import { buildLayout, PT_PER_IN } from "@/lib/film/layout";
import { buildExportBundle } from "@/lib/film/bundle";
import { maskToFilmGray, isMonochrome, filmInkArea, renderFilmPng } from "@/lib/film/render";
import { decodePng, encodePng } from "@/lib/film/png";
import type { ExportSettings, HalftoneSettings, JobMetadata, ProductionSettings, ProductionSize } from "@/lib/types";

const SETTINGS: ProductionSettings = {
  jobName: "sailor", garmentColor: "#111111", maxScreens: 6,
  method: "ai", meshCount: "auto", inkType: "plastisol", useGarmentAsBlack: true,
};
const EXPORT: ExportSettings = {
  filmDpi: 300, includeRegistration: true, includeCropMarks: true, includeCenterMarks: true, marginIn: 0.75,
};
const HALFTONE: HalftoneSettings = { enabled: false, lpi: 55, shape: "round" };
const METADATA: JobMetadata = {
  id: "job_test", jobName: "sailor-art", customer: "Test Shop", notes: "",
  createdAt: "2024-01-01T00:00:00.000Z",
};
// 500px at 300 DPI = 1.667in square.
const SIZE: ProductionSize = { widthIn: 500 / 300, heightIn: 500 / 300, units: "in", lockAspect: true };

const ART = generateDemoArtwork(500, 500);
const OUT = runSeparation({ pixels: ART.pixels, width: ART.width, height: ART.height, dpi: 300, settings: SETTINGS });

async function bundle(overrides: Partial<ExportSettings> = {}, ht: HalftoneSettings = HALFTONE) {
  return buildExportBundle({
    metadata: METADATA,
    plan: OUT.plan,
    settings: SETTINGS,
    productionSize: SIZE,
    halftone: ht,
    exportSettings: { ...EXPORT, ...overrides },
    qa: OUT.qa,
    similarityPercent: OUT.similarity.percent,
    width: ART.width,
    height: ART.height,
    compositeRgba: OUT.compositeRgba,
    thumbnail: null,
    originalThumbnail: null,
  });
}

describe("7. registration mark consistency", () => {
  it("gives every film the identical artboard and marks", () => {
    // The layout is computed once per job; this asserts the geometry it
    // produces is stable and shared, which is what makes films register.
    const opts = {
      pixelWidth: 500, pixelHeight: 500, dpi: 300, marginIn: 0.75,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    };
    const a = buildLayout(opts);
    const b = buildLayout(opts);
    expect(a).toEqual(b);
    expect(a.registration).toHaveLength(8);
    expect(a.centerMarks).toHaveLength(4);
    expect(a.cropMarks).toHaveLength(8);
  });

  it("keeps every registration mark outside the artwork bounds", () => {
    const l = buildLayout({
      pixelWidth: 500, pixelHeight: 500, dpi: 300, marginIn: 0.75,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    const x0 = l.artXPt;
    const y0 = l.artYPt;
    const x1 = l.artXPt + l.artWidthPt;
    const y1 = l.artYPt + l.artHeightPt;

    for (const m of l.registration) {
      const inside = m.cx > x0 && m.cx < x1 && m.cy > y0 && m.cy < y1;
      expect(inside).toBe(false);
      // The full cross, not just the center, must clear the artwork.
      const reach = Math.max(m.radius, m.armLength);
      const overlaps = m.cx + reach > x0 && m.cx - reach < x1 && m.cy + reach > y0 && m.cy - reach < y1;
      expect(overlaps).toBe(false);
    }
  });

  it("centers the artwork on the artboard", () => {
    const l = buildLayout({
      pixelWidth: 400, pixelHeight: 600, dpi: 300, marginIn: 0.5,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    expect(l.artXPt).toBeCloseTo((l.boardWidthPt - l.artWidthPt) / 2, 6);
    expect(l.artYPt).toBeCloseTo((l.boardHeightPt - l.artHeightPt) / 2, 6);
  });
});

describe("8. export dimensions", () => {
  it("sizes the artboard from physical inches, not pixels", () => {
    const l = buildLayout({
      pixelWidth: 900, pixelHeight: 600, dpi: 300, marginIn: 0.75,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    expect(l.artWidthPt).toBeCloseTo(3 * PT_PER_IN, 6);
    expect(l.artHeightPt).toBeCloseTo(2 * PT_PER_IN, 6);
    expect(l.boardWidthPt).toBeCloseTo((3 + 1.5) * PT_PER_IN, 6);
    expect(l.boardHeightPt).toBeCloseTo((2 + 1.5) * PT_PER_IN, 6);
  });

  it("holds physical size constant as raster resolution changes", () => {
    // Same artwork at 600 DPI has twice the pixels but the same inches.
    const a = buildLayout({
      pixelWidth: 900, pixelHeight: 600, dpi: 300, marginIn: 0.75,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    const b = buildLayout({
      pixelWidth: 1800, pixelHeight: 1200, dpi: 600, marginIn: 0.75,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    expect(b.artWidthPt).toBeCloseTo(a.artWidthPt, 6);
    expect(b.boardHeightPt).toBeCloseTo(a.boardHeightPt, 6);
  });

  it("produces one PDF and PNG per screen plus proof and sheet", async () => {
    const res = await bundle();
    const files = unzipSync(res.zip);
    const names = Object.keys(files);
    const screens = OUT.plan.inks.length;

    expect(names.filter((n) => n.endsWith(".pdf") && !n.includes("/"))).toHaveLength(screens + 2);
    expect(names.filter((n) => n.startsWith("png/"))).toHaveLength(screens);
    expect(names).toContain("composite-proof.pdf");
    expect(names).toContain("production-sheet.pdf");
    expect(names).toContain("job-manifest.json");
    expect(names).toContain("README.txt");
  });

  it("numbers films in print order", async () => {
    const res = await bundle();
    const names = Object.keys(unzipSync(res.zip))
      .filter((n) => n.endsWith(".pdf") && /^\d\d-/.test(n))
      .sort();
    const ordered = [...OUT.plan.inks].sort((a, b) => a.order - b.order);
    names.forEach((n, i) => {
      expect(n.startsWith(String(i + 1).padStart(2, "0"))).toBe(true);
    });
    expect(names).toHaveLength(ordered.length);
  });

  it("records the shared artboard in the plan JSON", async () => {
    const res = await bundle();
    const files = unzipSync(res.zip);
    const manifest = JSON.parse(new TextDecoder().decode(files["job-manifest.json"]));
    expect(manifest.film.registrationMarks).toBe(8);
    expect(manifest.film.artboardWidthPt).toBeCloseTo(res.layout.boardWidthPt, 6);
    expect(manifest.screens).toHaveLength(OUT.plan.inks.length);
  });

  it("emits valid PDF and PNG containers", async () => {
    const res = await bundle();
    const files = unzipSync(res.zip);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith(".pdf")) {
        expect(new TextDecoder().decode(data.subarray(0, 5))).toBe("%PDF-");
        expect(data.length).toBeGreaterThan(500);
      }
      if (name.endsWith(".png")) {
        const d = decodePng(data);
        expect(d.width).toBe(ART.width);
        expect(d.height).toBe(ART.height);
        expect(d.dpi).toBe(300);
      }
    }
  });
});

describe("9. films contain monochrome output", () => {
  it("renders halftoned films as pure black and white only", () => {
    for (const ink of OUT.plan.inks) {
      const gray = maskToFilmGray(
        { width: ART.width, height: ART.height, data: ink.mask },
        { halftone: { lpi: 45, angle: 22.5, shape: "round", dpi: 300 }, dpi: 300 },
      );
      expect(isMonochrome(gray)).toBe(true);
    }
  });

  it("inverts coverage so ink prints black on film", () => {
    const ink = OUT.plan.inks[0];
    const gray = maskToFilmGray(
      { width: ART.width, height: ART.height, data: ink.mask },
      { halftone: null, dpi: 300 },
    );
    for (let i = 0; i < gray.length; i++) {
      expect(gray[i]).toBe(255 - ink.mask[i]);
    }
    // Full coverage must be fully opaque black, no coverage fully clear.
    const solid = ink.mask.indexOf(255);
    if (solid >= 0) expect(gray[solid]).toBe(0);
  });

  it("carries no color into film output", () => {
    // Films are single-channel by construction; a colored ink still yields grey.
    const ink = OUT.plan.inks.find((i) => i.displayColor !== "#ffffff")!;
    const png = renderFilmPng(
      { width: ART.width, height: ART.height, data: ink.mask },
      { halftone: null, dpi: 300 },
    );
    const d = decodePng(png);
    for (let i = 0; i < 4000; i++) {
      const p = i * 4;
      expect(d.pixels[p]).toBe(d.pixels[p + 1]);
      expect(d.pixels[p + 1]).toBe(d.pixels[p + 2]);
    }
  });

  it("keeps ink area roughly proportional to coverage", () => {
    for (const ink of OUT.plan.inks) {
      const gray = maskToFilmGray(
        { width: ART.width, height: ART.height, data: ink.mask },
        { halftone: null, dpi: 300 },
      );
      const area = filmInkArea(gray);
      // filmInkArea thresholds at 50%, so it tracks solid coverage.
      expect(area).toBeLessThanOrEqual(ink.coverage + 0.02);
    }
  });
});

describe("export determinism", () => {
  it("produces byte-identical archives for identical input", async () => {
    const a = await bundle();
    const b = await bundle();
    const fa = unzipSync(a.zip);
    const fb = unzipSync(b.zip);
    for (const name of Object.keys(fa)) {
      // The production sheet embeds a generation timestamp by design.
      if (name === "production-sheet.pdf" || name === "job-manifest.json" || name === "README.txt") continue;
      expect(Buffer.from(fb[name])).toEqual(Buffer.from(fa[name]));
    }
  });
});

describe("PNG codec", () => {
  it("round-trips RGBA exactly", () => {
    const w = 61, h = 37;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = (i * 7) % 256;
      px[i * 4 + 1] = (i * 13) % 256;
      px[i * 4 + 2] = (i * 29) % 256;
      px[i * 4 + 3] = (i * 3) % 256;
    }
    const d = decodePng(encodePng(px, w, h, "rgba"));
    expect(d.width).toBe(w);
    expect(d.height).toBe(h);
    expect(Buffer.from(d.pixels)).toEqual(Buffer.from(px));
  });

  it("round-trips grayscale and preserves declared resolution", () => {
    const w = 40, h = 17;
    const px = new Uint8Array(w * h);
    for (let i = 0; i < px.length; i++) px[i] = (i * 11) % 256;
    const d = decodePng(encodePng(px, w, h, "gray", { dpi: 600 }));
    expect(d.dpi).toBe(600);
    for (let i = 0; i < px.length; i++) expect(d.pixels[i * 4]).toBe(px[i]);
  });

  it("encodes deterministically", () => {
    const px = new Uint8Array(32 * 32);
    for (let i = 0; i < px.length; i++) px[i] = (i * 5) % 256;
    expect(Buffer.from(encodePng(px, 32, 32, "gray"))).toEqual(Buffer.from(encodePng(px, 32, 32, "gray")));
  });

  it("rejects non-PNG data", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/not a png/i);
  });
});

describe("PDF text sanitization", () => {
  it("maps characters the standard fonts cannot encode", async () => {
    const { pdfSafe } = await import("@/lib/film/pdf");
    // The engine's own copy uses these; an unencodable one fails the export.
    expect(pdfSafe("merged at ΔE 4.2")).toBe("merged at dE 4.2");
    expect(pdfSafe("holds ≈ 0.006in")).toBe("holds ~ 0.006in");
    expect(pdfSafe("≤ 55 LPI")).toBe("<= 55 LPI");
  });

  it("preserves ordinary text and Latin-1 unchanged", () => {
    const plain = "01 - WHITE UNDERBASE | Mesh: 110 | 100%";
    expect(pdfSafeSync(plain)).toBe(plain);
  });

  it("leaves typography WinAnsi can encode alone", () => {
    // Degrading these would make shop paperwork worse for no reason.
    for (const s of ["• bullet", "en – dash", "em — dash", "“curly” ‘quotes’", "11 × 14", "45°", "café"]) {
      expect(pdfSafeSync(s)).toBe(s);
    }
  });

  it("keeps every substituted and passed-through character encodable", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sample = "• – — “ ” ‘ ’ × ° ± ≈ ≤ ≥ Δ … ™ € café 中文";
    // The whole point of pdfSafe: this must not throw.
    expect(() => font.widthOfTextAtSize(pdfSafeSync(sample), 10)).not.toThrow();
  });

  it("replaces anything still unencodable rather than throwing", () => {
    expect(pdfSafeSync("navy 中文")).toBe("navy ??");
  });
});

// Imported eagerly for the synchronous cases above.
import { pdfSafe as pdfSafeSync } from "@/lib/film/pdf";

describe("registration is identical across every film", () => {
  /**
   * Extracts a page's drawing operations with the per-film content removed.
   *
   * What legitimately differs between films is the separation raster (an
   * XObject `Do`) and the label (text between `BT`/`ET`). Everything else --
   * the artboard rectangle, the registration targets, the center and crop
   * marks -- must be byte-identical, because that is what makes the screens
   * line up on press.
   */
  async function contentStreamText(pdfBytes: Uint8Array): Promise<string> {
    const { PDFDocument, PDFName, PDFArray, decodePDFRawStream } = await import("pdf-lib");
    type RawStream = Parameters<typeof decodePDFRawStream>[0];
    const doc = await PDFDocument.load(pdfBytes);
    const page = doc.getPage(0);
    const context = page.node.context;

    // A page's Contents is either one stream or an array of them.
    const contents = context.lookup(page.node.get(PDFName.of("Contents")));
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => context.lookup(ref))
      : [contents];

    const parts = streams.map((s) =>
      new TextDecoder().decode(decodePDFRawStream(s as RawStream).decode()),
    );
    return parts.join("\n");
  }

  async function registrationOps(pdfBytes: Uint8Array): Promise<string> {
    const text = await contentStreamText(pdfBytes);

    const out: string[] = [];
    let inText = false;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t === "BT") { inText = true; continue; }
      if (t === "ET") { inText = false; continue; }
      if (inText) continue;
      if (/\bDo$/.test(t)) continue;          // the separation image
      if (/\/(Image|Font)\d*\s/.test(t)) continue;
      out.push(t);
    }

    // Stripping the text blocks leaves their empty graphics-state wrappers
    // behind, and films carry different numbers of label lines. An empty
    // q/Q pair draws nothing, so collapse them before comparing.
    let ops = out;
    for (;;) {
      const collapsed: string[] = [];
      for (const op of ops) {
        if (op === "Q" && collapsed[collapsed.length - 1] === "q") collapsed.pop();
        else collapsed.push(op);
      }
      if (collapsed.length === ops.length) break;
      ops = collapsed;
    }
    return ops.join("\n");
  }

  it("draws byte-identical marks and artboard on every film", async () => {
    const res = await bundle();
    const files = unzipSync(res.zip);
    const filmNames = Object.keys(files).filter((n) => /^\d\d-.*\.pdf$/.test(n)).sort();
    expect(filmNames.length).toBeGreaterThanOrEqual(3);

    const first = await registrationOps(files[filmNames[0]]);
    // The marks must actually be there -- an empty stream would pass trivially.
    expect(first.length).toBeGreaterThan(200);
    expect(first).toMatch(/^f$/m);   // filled artboard ground
    expect(first).toMatch(/^S$/m);   // stroked marks
    expect(first).toMatch(/ l$/m);   // cross arms
    expect(first).toMatch(/ c$/m);   // registration circles (beziers)

    for (const name of filmNames.slice(1)) {
      expect(await registrationOps(files[name]), `${name} must match ${filmNames[0]}`).toBe(first);
    }
  });

  it("gives every film the same page size", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const res = await bundle();
    const files = unzipSync(res.zip);
    const filmNames = Object.keys(files).filter((n) => /^\d\d-.*\.pdf$/.test(n)).sort();

    const sizes = await Promise.all(
      filmNames.map(async (n) => {
        const doc = await PDFDocument.load(files[n]);
        const { width, height } = doc.getPage(0).getSize();
        return `${width.toFixed(4)}x${height.toFixed(4)}`;
      }),
    );
    expect(new Set(sizes).size).toBe(1);
    // 500px at 300 DPI = 1.667in art, plus 0.75in margin each side.
    expect(sizes[0]).toBe(`${res.layout.boardWidthPt.toFixed(4)}x${res.layout.boardHeightPt.toFixed(4)}`);
  });

  it("places the artwork at the same rectangle on every film", async () => {
    const res = await bundle();
    const files = unzipSync(res.zip);
    const filmNames = Object.keys(files).filter((n) => /^\d\d-.*\.pdf$/.test(n)).sort();

    // The image placement matrix (cm operator) encodes scale and position.
    const matrices = await Promise.all(
      filmNames.map(async (n) => {
        const text = await contentStreamText(files[n]);
        const cm = text.match(/([\d.-]+ ){6}cm/g);
        return cm ? cm.join("|") : "none";
      }),
    );
    expect(new Set(matrices).size).toBe(1);
    expect(matrices[0]).not.toBe("none");
  });
});

describe("film label never overprints a registration mark", () => {
  /**
   * A label drawn across a registration target destroys it, and because ink
   * names differ in length it breaks that target on some films of a job but
   * not others — the films then disagree on exactly the marks used to line
   * them up. This is checked geometrically rather than by comparing drawing
   * operators, because the operators are identical; only the rendering
   * collides.
   */
  async function assertNoCollision(opts: {
    pixelWidth: number; pixelHeight: number; dpi: number; marginIn: number;
    inkName: string; jobName: string; index: number; total: number;
  }) {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const { buildLayout: mkLayout, describeSize: sizeOf } = await import("@/lib/film/layout");
    const { computeFilmLabelBox } = await import("@/lib/film/pdf");

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const layout = mkLayout({
      pixelWidth: opts.pixelWidth, pixelHeight: opts.pixelHeight, dpi: opts.dpi,
      marginIn: opts.marginIn,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });

    const { measurerFromFonts } = await import("@/lib/film/pdf");
    const box = computeFilmLabelBox(layout, {
      jobName: opts.jobName, index: opts.index, total: opts.total,
      inkName: opts.inkName, inkColor: "#000000", mesh: 156,
      sizeText: sizeOf(layout), scalePercent: 100, halftone: null,
    }, measurerFromFonts(font, bold));

    if (!box || !box.bounds) return; // no label drawn at all is safe
    expect(box.bounds.x1).toBeLessThanOrEqual(box.rightBound + 0.01);

    for (const m of layout.registration) {
      const reach = Math.max(m.radius, m.armLength);
      const overlaps =
        box.bounds.x1 > m.cx - reach &&
        box.bounds.x0 < m.cx + reach &&
        box.bounds.y1 > m.cy - reach &&
        box.bounds.y0 < m.cy + reach;
      expect(overlaps, `label "${box.title}" overlaps mark at (${m.cx.toFixed(1)}, ${m.cy.toFixed(1)})`).toBe(false);
    }
  }

  it("keeps clear on a small artboard with a long ink name", async () => {
    // 600px at 300 DPI = 2in artwork; the regression case.
    await assertNoCollision({
      pixelWidth: 600, pixelHeight: 600, dpi: 300, marginIn: 0.75,
      inkName: "White Underbase", jobName: "badge", index: 1, total: 5,
    });
  });

  it("keeps clear across a range of board sizes and ink names", async () => {
    const names = ["Black", "White Underbase", "Athletic Gold", "Extremely Long Custom Ink Name For Testing"];
    const sizes: [number, number][] = [[400, 400], [600, 600], [1200, 900], [3000, 3000]];
    const margins = [0.4, 0.75, 1.5];
    for (const [w, h] of sizes) {
      for (const name of names) {
        for (const marginIn of margins) {
          await assertNoCollision({
            pixelWidth: w, pixelHeight: h, dpi: 300, marginIn,
            inkName: name, jobName: "a-fairly-long-job-name", index: 12, total: 12,
          });
        }
      }
    }
  });

  it("truncates rather than dropping the screen number", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const { buildLayout: mkLayout } = await import("@/lib/film/layout");
    const { computeFilmLabelBox } = await import("@/lib/film/pdf");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const layout = mkLayout({
      pixelWidth: 600, pixelHeight: 600, dpi: 300, marginIn: 0.75,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    const { measurerFromFonts } = await import("@/lib/film/pdf");
    const box = computeFilmLabelBox(layout, {
      jobName: "j", index: 3, total: 9,
      inkName: "A Ridiculously Long Ink Name That Cannot Possibly Fit",
      inkColor: "#000", mesh: 230, sizeText: "2.00 x 2.00 in", scalePercent: 100, halftone: null,
    }, measurerFromFonts(font, bold));
    expect(box?.title).toMatch(/^03/);
  });
});
