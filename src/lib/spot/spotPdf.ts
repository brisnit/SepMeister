/**
 * Spot-separated PDF output.
 *
 * This is a genuinely different document from the film positives. A film is
 * black artwork on white, one sheet per screen, ready to print to
 * transparency. This is one page carrying every ink as a real PDF
 * `/Separation` colour space, so a RIP sees named plates and images them
 * itself — which is the piece a separator currently goes through Illustrator
 * to get.
 *
 * Two things are easy to get wrong and are worth stating:
 *
 *  - Tint is *ink coverage*, not film density. A film inverts (ink prints
 *    black on clear film); a spot plate does not. Mask 255 means full ink,
 *    which is tint 1.0. Inverting here would hand the RIP a negative.
 *
 *  - The plates must overprint. Painted normally, each image would knock out
 *    the one beneath it and the last plate would be all a RIP saw in the
 *    shared areas. Overprint keeps every separation independent, which is the
 *    entire point of the format.
 *
 * pdf-lib has no high-level Separation support, so the colour spaces, tint
 * transforms and image XObjects are assembled from raw PDF objects.
 */

import {
  PDFDocument, PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, PDFRef,
  StandardFonts, decodePDFRawStream, rgb,
} from "pdf-lib";
import { zlibSync } from "fflate";
import type { FilmLayout } from "@/lib/film/layout";
import { halftoneMask } from "@/lib/engine/halftone";
import { resampleMask } from "@/lib/film/resample";
import { pdfSafe } from "@/lib/film/pdf";
import type { SpotColor } from "./spotColor";

const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

export interface SpotPdfInput {
  spots: SpotColor[];
  layout: FilmLayout;
  jobName: string;
  customer: string;
  /** Native mask dimensions. */
  width: number;
  height: number;
  /** Raster resolution for screened plates. */
  rasterWidth: number;
  rasterHeight: number;
  rasterDpi: number;
  /** Screen each plate rather than emitting continuous tone. */
  applyHalftones: boolean;
  /** Draw registration and trim marks onto every plate. */
  includeMarks: boolean;
}

/**
 * Builds the tint transform for one colourant.
 *
 * A type 2 (exponential interpolation) function mapping tint 0..1 onto the
 * ink's CMYK approximation: 0 gives no ink, 1 gives the full colour. This is
 * only consulted when something flattens the separation for preview; a RIP
 * images the named plate directly and never evaluates it.
 */
function buildTintTransform(doc: PDFDocument, spot: SpotColor): PDFRef {
  const { c, m, y, k } = spot.alternateCmyk;
  const fn = doc.context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    Range: [0, 1, 0, 1, 0, 1, 0, 1],
    C0: [0, 0, 0, 0],
    C1: [
      Number(c.toFixed(4)),
      Number(m.toFixed(4)),
      Number(y.toFixed(4)),
      Number(k.toFixed(4)),
    ],
    N: 1,
  });
  return doc.context.register(fn);
}

/** `[/Separation /NAME /DeviceCMYK <fn>]`. */
function buildSeparationColorSpace(doc: PDFDocument, spot: SpotColor): PDFRef {
  const cs = PDFArray.withContext(doc.context);
  cs.push(PDFName.of("Separation"));
  cs.push(PDFName.of(spot.name));
  cs.push(PDFName.of("DeviceCMYK"));
  cs.push(buildTintTransform(doc, spot));
  return doc.context.register(cs);
}

/**
 * A soft mask making zero-coverage areas transparent.
 *
 * Necessary, not cosmetic. In a Separation space a tint of 0 paints *white*
 * rather than nothing, so without this each plate would lay an opaque white
 * rectangle over the plates beneath it and only the last one would survive.
 * Overprint fixes that for a separation-aware RIP, but every ordinary viewer
 * ignores overprint — and a separator who opens the file and sees a single
 * plate will reasonably conclude the export is broken.
 *
 * Alpha is the coverage itself, so screened plates (binary by construction)
 * preview exactly. Continuous-tone midtones preview slightly light, because
 * tint and alpha both scale; the plate data a RIP reads is unaffected.
 */
function buildPlateSoftMask(
  doc: PDFDocument,
  samples: Uint8Array,
  width: number,
  height: number,
): PDFRef {
  const compressed = zlibSync(samples, { level: 6 });
  const dict = doc.context.obj({
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 8,
    Filter: "FlateDecode",
    Length: compressed.length,
  }) as PDFDict;
  return doc.context.register(PDFRawStream.of(dict, compressed));
}

/**
 * One plate as a single-component image in its Separation space.
 *
 * Sample values are the tint directly: the coverage mask needs no
 * transformation, which is what makes this format a faithful carrier of the
 * separation rather than a rendering of it.
 */
function buildPlateImage(
  doc: PDFDocument,
  spot: SpotColor,
  samples: Uint8Array,
  width: number,
  height: number,
  colorSpaceRef: PDFRef,
): PDFRef {
  // zlib-wrapped, not raw deflate: PDF's FlateDecode is defined as zlib, and
  // a raw stream is undecodable by every conforming reader.
  const compressed = zlibSync(samples, { level: 6 });
  const dict = doc.context.obj({
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    ColorSpace: colorSpaceRef,
    BitsPerComponent: 8,
    Filter: "FlateDecode",
    Length: compressed.length,
  }) as PDFDict;
  dict.set(PDFName.of("SMask"), buildPlateSoftMask(doc, samples, width, height));
  const stream = PDFRawStream.of(dict, compressed);
  return doc.context.register(stream);
}

/**
 * Graphics state that turns overprint on.
 *
 * Without this every plate knocks out the plates below it wherever they share
 * area, and a RIP would receive a document whose separations silently erase
 * each other. OPM 1 selects the zero-means-leave-alone interpretation, which
 * is what makes a tint of 0 transparent to the plates underneath.
 */
function buildOverprintState(doc: PDFDocument): PDFRef {
  return doc.context.register(
    doc.context.obj({ Type: "ExtGState", OP: true, op: true, OPM: 1, BM: "Normal" }),
  );
}

/** Plate samples: coverage as tint, optionally screened first. */
function plateSamples(spot: SpotColor, input: SpotPdfInput): { data: Uint8Array; width: number; height: number } {
  const native = { width: input.width, height: input.height, data: spot.mask };
  const screened = input.applyHalftones && spot.halftoneEnabled;

  if (!screened) {
    return { data: new Uint8Array(native.data), width: native.width, height: native.height };
  }

  const scaled = resampleMask(native, input.rasterWidth, input.rasterHeight);
  const dots = halftoneMask(scaled, {
    lpi: spot.lpi, angle: spot.angle, shape: spot.dotShape as "round" | "ellipse" | "square",
    dpi: input.rasterDpi,
  });
  return { data: new Uint8Array(dots.data), width: dots.width, height: dots.height };
}

export interface SpotPdfResult {
  bytes: Uint8Array;
  /** Plate names in the order they were written, for verification. */
  plateNames: string[];
}

export async function buildSpotPdf(input: SpotPdfInput): Promise<SpotPdfResult> {
  const { layout, spots } = input;

  const doc = await PDFDocument.create();
  doc.setTitle(`${input.jobName} — spot separations`);
  doc.setProducer("SepWiz");
  doc.setCreator("SepWiz");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const page = doc.addPage([layout.boardWidthPt, layout.boardHeightPt]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const gsRef = buildOverprintState(doc);
  const xobjects: [string, PDFRef][] = [];
  const plateNames: string[] = [];

  spots.forEach((spot, i) => {
    const colorSpaceRef = buildSeparationColorSpace(doc, spot);
    const { data, width, height } = plateSamples(spot, input);
    const imageRef = buildPlateImage(doc, spot, data, width, height, colorSpaceRef);
    xobjects.push([`Plate${i}`, imageRef]);
    plateNames.push(spot.name);
  });

  // Register resources by hand: these images are not pdf-lib PDFImage objects.
  const resources = page.node.Resources() ?? page.node.context.obj({});
  const xobjDict = doc.context.obj({}) as PDFDict;
  for (const [name, ref] of xobjects) xobjDict.set(PDFName.of(name), ref);
  resources.set(PDFName.of("XObject"), xobjDict);

  const gsDict = doc.context.obj({}) as PDFDict;
  gsDict.set(PDFName.of("GSOverprint"), gsRef);
  resources.set(PDFName.of("ExtGState"), gsDict);
  page.node.set(PDFName.of("Resources"), resources);

  // Draw the plates. Each is placed at the shared artwork rectangle, so the
  // separations register exactly as the films do.
  //
  // Written as a content stream directly rather than through pdf-lib's
  // drawing API, which has no way to express an XObject in a Separation space.
  // Added before any pdf-lib drawing so the marks land on top of the plates.
  const ops: string[] = ["q", "/GSOverprint gs"];
  for (const [name] of xobjects) {
    ops.push("q");
    ops.push(
      `${layout.artWidthPt.toFixed(4)} 0 0 ${layout.artHeightPt.toFixed(4)} ` +
      `${layout.artXPt.toFixed(4)} ${layout.artYPt.toFixed(4)} cm`,
    );
    ops.push(`/${name} Do`);
    ops.push("Q");
  }
  ops.push("Q");

  const body = new TextEncoder().encode(ops.join("\n"));
  const contentDict = doc.context.obj({ Length: body.length }) as PDFDict;
  page.node.addContentStream(doc.context.register(PDFRawStream.of(contentDict, body)));

  if (input.includeMarks) {
    drawMarks(page, layout);
    drawPlateLegend(page, layout, input, font, bold);
  }

  const bytes = await doc.save();
  return { bytes, plateNames };
}

/**
 * Registration and trim marks, drawn in all-plates black.
 *
 * Marks have to appear on every separation or the plates cannot be aligned,
 * so they are painted in DeviceGray outside the Separation spaces — a RIP
 * carries DeviceGray artwork onto every plate it images.
 */
function drawMarks(page: ReturnType<PDFDocument["addPage"]>, layout: FilmLayout): void {
  const stroke = layout.markStroke;
  for (const m of layout.registration) {
    page.drawCircle({ x: m.cx, y: m.cy, size: m.radius, borderColor: rgb(0, 0, 0), borderWidth: stroke });
    page.drawLine({
      start: { x: m.cx - m.armLength, y: m.cy }, end: { x: m.cx + m.armLength, y: m.cy },
      thickness: stroke, color: rgb(0, 0, 0),
    });
    page.drawLine({
      start: { x: m.cx, y: m.cy - m.armLength }, end: { x: m.cx, y: m.cy + m.armLength },
      thickness: stroke, color: rgb(0, 0, 0),
    });
  }
  const fine = Math.min(stroke, 0.6);
  for (const c of [...layout.centerMarks, ...layout.cropMarks]) {
    page.drawLine({ start: { x: c.x1, y: c.y1 }, end: { x: c.x2, y: c.y2 }, thickness: fine, color: rgb(0, 0, 0) });
  }
}

/** Names every plate in the document, so a loose print is still readable. */
function drawPlateLegend(
  page: ReturnType<PDFDocument["addPage"]>,
  layout: FilmLayout,
  input: SpotPdfInput,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
): void {
  const size = Math.max(5, Math.min(7.5, layout.marginPt * 0.14));
  const x = layout.marginPt * 0.22;
  let y = layout.marginPt * 0.22 + size * (input.spots.length + 1) * 1.25;
  if (y > layout.artYPt - 4) y = Math.max(size, layout.artYPt - 4);

  page.drawText(pdfSafe(`${input.jobName}${input.customer ? ` — ${input.customer}` : ""}`), {
    x, y, size, font: bold, color: rgb(0, 0, 0),
  });

  input.spots.forEach((spot, i) => {
    const ly = y - size * 1.25 * (i + 1);
    if (ly < 2) return;
    const detail = spot.halftoneEnabled && input.applyHalftones
      ? `${spot.mesh} mesh · ${spot.lpi} LPI · ${spot.angle}°`
      : `${spot.mesh} mesh · solid`;
    page.drawText(pdfSafe(`${String(i + 1).padStart(2, "0")}  ${spot.name}   ${detail}`), {
      x, y: ly, size: size * 0.92, font, color: rgb(0, 0, 0),
    });
  });
}

/**
 * Reads back the Separation colourant names actually present in a PDF.
 *
 * Exists for verification rather than convenience: a document that merely
 * looks separated is worthless, and the only way to know is to inspect the
 * structure. Used by the tests, and safe to point at any PDF.
 */
export function extractSeparationNames(pdfBytes: Uint8Array): string[] {
  // Scan the raw bytes for `/Separation /NAME` pairs, including compressed
  // object streams once inflated below.
  const found = new Set<string>();
  const scan = (text: string) => {
    const re = /\/Separation\s*\/([^\s/[\]<>()]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) found.add(decodePdfName(m[1]));
  };

  scan(latin1(pdfBytes));

  // Object streams hold most indirect objects in a modern PDF.
  const objStreams = findFlateStreams(pdfBytes);
  for (const s of objStreams) {
    try {
      scan(latin1(inflate(s)));
    } catch {
      /* not an inflatable stream; nothing to read */
    }
  }

  return [...found];
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** `#20`-style escapes are legal inside PDF name objects. */
function decodePdfName(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function inflate(bytes: Uint8Array): Uint8Array {
  // fflate's unzlibSync handles the zlib wrapper PDFs use for FlateDecode.
  // Imported lazily to keep this helper usable from tests without bundling.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unzlibSync } = require("fflate") as typeof import("fflate");
  return unzlibSync(bytes);
}

/** Locates FlateDecode stream payloads for structural inspection. */
function findFlateStreams(bytes: Uint8Array): Uint8Array[] {
  const text = latin1(bytes);
  const out: Uint8Array[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    out.push(bytes.subarray(start, end));
  }
  return out;
}

export { decodePDFRawStream, PDFNumber };
