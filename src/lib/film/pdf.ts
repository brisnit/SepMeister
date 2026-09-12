/**
 * PDF film, proof and production sheet generation.
 *
 * Films are built as: a white artboard, the separation embedded as a
 * monochrome raster at an exact rectangle, and vector registration marks and
 * type drawn on top. Marks are vector so they stay crisp at any RIP
 * resolution; the separation is raster because that is what it is.
 *
 * The artwork rectangle is derived from the shared FilmLayout, never
 * recomputed, so every film in a job places artwork identically.
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { encodePng } from "./png";
import { maskToFilmGray } from "./render";
import { formatFilmTitle, describeSize, PT_PER_IN, type FilmLabel, type FilmLayout } from "./layout";
import type { HalftoneParams } from "@/lib/engine/halftone";
import type { Mask } from "@/lib/engine/morphology";

/**
 * Fixed document dates. pdf-lib stamps the current time by default, which
 * would make two exports of an unchanged separation differ byte-for-byte and
 * defeat the determinism guarantee the engine works hard to provide.
 */
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

function stampDates(doc: PDFDocument): void {
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
}

/**
 * Characters the standard PDF fonts genuinely cannot encode, mapped to safe
 * equivalents.
 *
 * pdf-lib's built-in fonts use WinAnsi, which throws rather than substituting
 * on an unknown glyph -- so an un-sanitized separation note containing the
 * Greek delta from "merged at dE 4.2" would fail the whole export.
 *
 * The list is deliberately short. WinAnsi covers all of Latin-1 plus a set of
 * typographic extras, so bullets, dashes, curly quotes, degree signs and the
 * multiplication sign all pass through untouched; degrading them would make
 * shop paperwork worse for no reason.
 */
const TEXT_SUBSTITUTIONS: [RegExp, string][] = [
  [/\u0394/g, "d"],   // Δ  -> ΔE becomes dE, the conventional ASCII form
  [/\u2248/g, "~"],   // ≈
  [/\u2264/g, "<="],  // ≤
  [/\u2265/g, ">="],  // ≥
  [/\u00b1/g, "+/-"], // ± is in Latin-1, but reads poorly in small type
];

/**
 * Code points outside Latin-1 that WinAnsi does encode. Verified against the
 * embedder rather than assumed.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * Makes a string safe for the standard PDF fonts.
 *
 * Applies the substitutions, then replaces anything still outside the
 * encodable repertoire. Losing an exotic glyph is acceptable; failing the
 * export is not.
 */
export function pdfSafe(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return Array.from(out)
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp >= 0x20 && cp <= 0x7e) return ch;
      if (cp >= 0xa0 && cp <= 0xff) return ch;
      if (WINANSI_EXTRAS.has(cp)) return ch;
      return "?";
    })
    .join("");
}

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

function drawRegistrationMarks(page: PDFPage, layout: FilmLayout): void {
  const stroke = layout.markStroke;
  for (const m of layout.registration) {
    page.drawCircle({
      x: m.cx, y: m.cy, size: m.radius,
      borderColor: BLACK, borderWidth: stroke,
    });
    // Cross arms run through the centre so the intersection stays an exact
    // point to align to, and extend past the ring so the target reads at a
    // glance as well as under a loupe.
    page.drawLine({ start: { x: m.cx - m.armLength, y: m.cy }, end: { x: m.cx + m.armLength, y: m.cy }, thickness: stroke, color: BLACK });
    page.drawLine({ start: { x: m.cx, y: m.cy - m.armLength }, end: { x: m.cx, y: m.cy + m.armLength }, thickness: stroke, color: BLACK });
  }
  // Trim and centre marks stay finer than the targets; they are for cutting
  // and squaring, not for registering, and a heavy line hides the exact edge.
  const fine = Math.min(stroke, 0.6);
  for (const c of layout.centerMarks) {
    page.drawLine({ start: { x: c.x1, y: c.y1 }, end: { x: c.x2, y: c.y2 }, thickness: fine, color: BLACK });
  }
  for (const c of layout.cropMarks) {
    page.drawLine({ start: { x: c.x1, y: c.y1 }, end: { x: c.x2, y: c.y2 }, thickness: fine, color: BLACK });
  }
}

/**
 * Text measurement, abstracted so the pre-export QA can measure exactly what
 * the renderer will draw rather than approximating it. Both callers supply a
 * pdf-lib font, so the numbers are identical.
 */
export interface TextMeasurer {
  width(text: string, size: number, bold: boolean): number;
}

/**
 * Builds a measurer backed by the standard fonts, for callers that need to
 * measure label text without rendering a document (the pre-export QA).
 */
export async function createLabelMeasurer(): Promise<TextMeasurer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return measurerFromFonts(font, bold);
}

export function measurerFromFonts(font: PDFFont, bold: PDFFont): TextMeasurer {
  return {
    width(text, size, isBold) {
      return (isBold ? bold : font).widthOfTextAtSize(pdfSafe(text), size);
    },
  };
}

/**
 * The film's production specs, laid out as positioned lines.
 *
 * Moved from the bottom band to the top right on shop feedback: that is where
 * a separator's eye lands when a film comes off the printer, and it keeps the
 * information beside the target they hang the screen from rather than at the
 * far end of the sheet.
 */
export interface SpecBlock {
  /** Right edge the lines are aligned to. */
  rightX: number;
  /** Left edge the lines must not cross. */
  leftBound: number;
  lines: { text: string; y: number; size: number; bold: boolean; width: number }[];
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** Shrinks then truncates a string until it fits, preserving the start. */
function fitText(text: string, measure: TextMeasurer, size: number, bold: boolean, maxWidth: number): string {
  if (measure.width(text, size, bold) <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1) {
    cut--;
    const candidate = `${text.slice(0, cut).trimEnd()}...`;
    if (measure.width(candidate, size, bold) <= maxWidth) return candidate;
  }
  return "";
}

/**
 * Builds the top-right specification block.
 *
 * Bounded by the registration targets actually present in the top band rather
 * than by an assumed layout: a spec line printed across a target destroys it,
 * and because ink names differ in length it would destroy that target on some
 * films of a job but not others -- leaving the set disagreeing on exactly the
 * marks used to align them.
 */
export function computeSpecBlock(
  layout: FilmLayout,
  label: FilmLabel,
  measure: TextMeasurer,
): SpecBlock | null {
  const bandBottom = layout.artYPt + layout.artHeightPt;
  const bandTop = layout.boardHeightPt;
  const bandHeight = bandTop - bandBottom;
  if (bandHeight < 18) return null;

  const inBand = layout.registration.filter((m) => m.cy > bandBottom);
  // Generous clearance: text that merely *touches* a target still makes the
  // operator second-guess whether the mark is clean.
  const clearance = (m: { radius: number; armLength: number }) => Math.max(m.radius, m.armLength) + 14;

  // Right edge: inside the sheet, clear of any target near the right corner.
  let rightX = layout.boardWidthPt - layout.marginPt * 0.22;
  for (const m of inBand) {
    if (m.cx > layout.boardWidthPt * 0.75) {
      rightX = Math.min(rightX, m.cx - clearance(m));
    }
  }

  // Left bound: stop before the nearest target to the left of the block.
  let leftBound = layout.marginPt * 0.22;
  for (const m of inBand) {
    const right = m.cx + clearance(m);
    if (m.cx < rightX && right > leftBound) leftBound = right;
  }

  const available = rightX - leftBound;
  if (available < 60) return null;

  const titleSize = Math.max(5.5, Math.min(8.5, bandHeight * 0.155));
  const bodySize = titleSize * 0.9;
  const leading = bodySize * 1.32;

  /**
   * Rows carry a drop order separate from their display order.
   *
   * The band is a single margin tall, so on a small artboard something has to
   * go. What must survive is which screen this is and how to burn it -- a film
   * with no mesh or line count on it sends the operator back to the paperwork,
   * which is the handoff this block exists to remove. The job name and
   * customer are identification, and identification is what gets dropped.
   */
  const rows: { text: string; bold: boolean; size: number; drop: number }[] = [
    { text: `SEPWIZ  ${label.jobName.toUpperCase()}`, bold: true, size: titleSize, drop: 3 },
    ...(label.customer ? [{ text: label.customer, bold: false, size: bodySize, drop: 4 }] : []),
    {
      text: `${String(label.index).padStart(2, "0")} / ${String(label.total).padStart(2, "0")}   ${label.inkName.toUpperCase()}`,
      bold: true, size: titleSize, drop: 0,
    },
    {
      text: `${label.mesh} MESH   ${label.halftone ? label.halftone.toUpperCase() : "SOLID"}`,
      bold: false, size: bodySize, drop: 1,
    },
    { text: `${label.sizeText.toUpperCase()}   ${label.scalePercent}%`, bold: false, size: bodySize, drop: 2 },
  ];

  const stepOf = (r: { size: number }) => Math.max(r.size * 1.32, leading);
  const stackHeight = (list: typeof rows) => list.reduce((h, r) => h + stepOf(r), 0);

  let visible = rows;
  while (visible.length > 1 && stackHeight(visible) > bandHeight - 6) {
    // Remove whichever remaining row is least essential, keeping display order.
    const worst = visible.reduce((a, b) => (b.drop > a.drop ? b : a));
    visible = visible.filter((r) => r !== worst);
  }
  if (stackHeight(visible) > bandHeight - 4) return null;

  const totalHeight = stackHeight(visible);
  let cursor = bandTop - (bandHeight - totalHeight) / 2;

  const lines: SpecBlock["lines"] = [];
  for (const row of visible) {
    const text = fitText(row.text, measure, row.size, row.bold, available);
    if (!text) continue;
    const step = stepOf(row);
    cursor -= step;
    lines.push({ text, y: cursor + step * 0.22, size: row.size, bold: row.bold, width: measure.width(text, row.size, row.bold) });
  }

  if (lines.length === 0) return null;

  const widest = Math.max(...lines.map((l) => l.width));
  const bounds = {
    x0: rightX - widest,
    y0: lines[lines.length - 1].y,
    x1: rightX,
    y1: lines[0].y + lines[0].size,
  };

  return { rightX, leftBound, lines, bounds };
}

function drawSpecBlock(page: PDFPage, layout: FilmLayout, label: FilmLabel, font: PDFFont, bold: PDFFont): void {
  const block = computeSpecBlock(layout, label, measurerFromFonts(font, bold));
  if (!block) return;
  for (const line of block.lines) {
    page.drawText(pdfSafe(line.text), {
      // Right-aligned so the block squares up against the sheet edge.
      x: block.rightX - line.width,
      y: line.y,
      size: line.size,
      font: line.bold ? bold : font,
      color: BLACK,
    });
  }
}

export interface FilmPdfInput {
  mask: Mask;
  layout: FilmLayout;
  label: FilmLabel;
  halftone: HalftoneParams | null;
  /** Resolution at which the separation raster is embedded. */
  embedDpi: number;
}

/**
 * Renders one film to a single-page PDF.
 *
 * The embedded raster is placed at the exact artwork rectangle from the
 * layout, so its physical size is fixed by the page geometry rather than by
 * the pixel count -- the raster cannot accidentally scale the artwork.
 */
export async function buildFilmPdf(input: FilmPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.label.jobName} — ${formatFilmTitle(input.label)}`);
  doc.setProducer("SepWiz");
  doc.setCreator("SepWiz");
  stampDates(doc);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { layout } = input;
  const page = doc.addPage([layout.boardWidthPt, layout.boardHeightPt]);

  // Explicit white ground: a transparent PDF background prints unpredictably.
  page.drawRectangle({ x: 0, y: 0, width: layout.boardWidthPt, height: layout.boardHeightPt, color: WHITE });

  const gray = maskToFilmGray(input.mask, {
    halftone: input.halftone,
    dpi: input.embedDpi,
    negative: false,
  });
  const png = encodePng(gray, input.mask.width, input.mask.height, "gray", { dpi: input.embedDpi });
  const image = await doc.embedPng(png);

  page.drawImage(image, {
    x: layout.artXPt,
    y: layout.artYPt,
    width: layout.artWidthPt,
    height: layout.artHeightPt,
  });

  drawRegistrationMarks(page, layout);
  drawSpecBlock(page, layout, input.label, font, bold);

  return doc.save();
}

export interface ProofInput {
  compositeRgba: Uint8ClampedArray;
  width: number;
  height: number;
  layout: FilmLayout;
  jobName: string;
  customer: string;
  garmentColor: string;
  similarityPercent: number;
}

/** Full-color composite proof, for the artist and the customer to sign off. */
export async function buildProofPdf(input: ProofInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.jobName} — Composite Proof`);
  doc.setProducer("SepWiz");
  stampDates(doc);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { layout } = input;
  const page = doc.addPage([layout.boardWidthPt, layout.boardHeightPt]);

  page.drawRectangle({ x: 0, y: 0, width: layout.boardWidthPt, height: layout.boardHeightPt, color: WHITE });

  // Composite already includes the garment as its ground.
  const rgbBytes = new Uint8Array(input.width * input.height * 3);
  for (let i = 0, n = input.width * input.height; i < n; i++) {
    rgbBytes[i * 3] = input.compositeRgba[i * 4];
    rgbBytes[i * 3 + 1] = input.compositeRgba[i * 4 + 1];
    rgbBytes[i * 3 + 2] = input.compositeRgba[i * 4 + 2];
  }
  const png = encodePng(rgbBytes, input.width, input.height, "rgb", { dpi: layout.dpi });
  const image = await doc.embedPng(png);

  page.drawImage(image, {
    x: layout.artXPt, y: layout.artYPt,
    width: layout.artWidthPt, height: layout.artHeightPt,
  });

  const titleSize = Math.min(11, layout.marginPt * 0.22);
  let y = layout.artYPt - titleSize - 4;
  if (y < layout.marginPt * 0.18) y = layout.marginPt * 0.18;
  const proofTitle = input.customer
    ? `COMPOSITE PROOF — ${input.jobName} — ${input.customer}`
    : `COMPOSITE PROOF — ${input.jobName}`;
  page.drawText(pdfSafe(proofTitle), { x: layout.marginPt / 2, y, size: titleSize, font: bold, color: BLACK });

  const metaSize = titleSize * 0.72;
  const metaY = y - metaSize - 3;
  if (metaY > 2) {
    page.drawText(pdfSafe(`Garment: ${input.garmentColor}    ${describeSize(layout)}    Digital separation similarity: ${input.similarityPercent}%    Not a press proof`), { x: layout.marginPt / 2, y: metaY, size: metaSize, font, color: BLACK },
    );
  }

  return doc.save();
}

export interface ProductionSheetInk {
  index: number;
  name: string;
  color: string;
  type: string;
  mesh: number;
  coveragePercent: number;
  /** "45 LPI · 22.5° · round", or "Solid". */
  halftone: string;
  note?: string;
}

export interface ProductionSheetInput {
  jobName: string;
  customer: string;
  notes: string;
  createdAt: string;
  sizeText: string;
  filmSizeText: string;
  pixelWidth: number;
  pixelHeight: number;
  /** Artwork's effective resolution at production size. */
  artworkDpi: number;
  /** Resolution the films were rasterized at. */
  filmDpi: number;
  garmentColor: string;
  method: string;
  inkType: string;
  inks: ProductionSheetInk[];
  halftoneSummary: string;
  underbaseChoke: string;
  screenCount: number;
  qaScore: number;
  qaVerdict: string;
  similarityPercent: number;
  explanation: string;
  warnings: string[];
  thumbnailRgb: { data: Uint8Array; width: number; height: number } | null;
}

/** Shop-floor summary: what to burn, in what order, on what mesh. */
export async function buildProductionSheetPdf(input: ProductionSheetInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.jobName} — Production Sheet`);
  doc.setProducer("SepWiz");
  stampDates(doc);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // US Letter portrait.
  const W = 8.5 * PT_PER_IN;
  const H = 11 * PT_PER_IN;
  const page = doc.addPage([W, H]);
  const M = 0.6 * PT_PER_IN;

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });

  let y = H - M;

  page.drawText(pdfSafe("PRODUCTION SHEET"), { x: M, y: y - 16, size: 16, font: bold, color: BLACK });
  page.drawText(pdfSafe("SepWiz"), { x: W - M - 34, y: y - 16, size: 9, font, color: rgb(0.45, 0.45, 0.5) });
  y -= 22;

  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: BLACK });
  y -= 18;

  page.drawText(pdfSafe(input.jobName), { x: M, y: y - 12, size: 13, font: bold, color: BLACK });
  y -= 14;
  if (input.customer) {
    page.drawText(pdfSafe(input.customer), { x: M, y: y - 10, size: 9.5, font, color: rgb(0.35, 0.35, 0.42) });
    y -= 14;
  }
  y -= 6;

  const rowSize = 8.5;
  const line = (l: string, v: string) => {
    page.drawText(pdfSafe(l), { x: M, y, size: rowSize, font, color: rgb(0.4, 0.4, 0.46) });
    page.drawText(pdfSafe(v), { x: M + 96, y, size: rowSize, font: bold, color: BLACK });
    y -= 13;
  };

  line("Print size", `${input.sizeText} at 100% scale`);
  line("Film sheet", input.filmSizeText);
  line("Artwork detail", `${input.pixelWidth} x ${input.pixelHeight} px = ${input.artworkDpi} DPI at size`);
  line("Film output", `${input.filmDpi} DPI`);
  line("Garment color", input.garmentColor);
  line("Method", humanizeMethod(input.method));
  line("Ink type", humanizeInkType(input.inkType));
  line("Screen count", String(input.screenCount));
  line("Underbase choke", input.underbaseChoke);
  line("Halftone", input.halftoneSummary);
  line("Sep Score", `${input.qaScore} / 100 — ${input.qaVerdict}`);
  line("Separation similarity", `${input.similarityPercent}% (digital, not a press prediction)`);
  line("Generated", input.createdAt);

  y -= 8;

  // Thumbnail, right-aligned alongside the metadata block.
  if (input.thumbnailRgb) {
    const png = encodePng(input.thumbnailRgb.data, input.thumbnailRgb.width, input.thumbnailRgb.height, "rgb");
    const img = await doc.embedPng(png);
    const maxW = 1.9 * PT_PER_IN;
    const scale = maxW / input.thumbnailRgb.width;
    const drawH = input.thumbnailRgb.height * scale;
    page.drawImage(img, { x: W - M - maxW, y: H - M - 40 - drawH, width: maxW, height: drawH });
  }

  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.8) });
  y -= 16;

  page.drawText(pdfSafe("PRINT ORDER"), { x: M, y, size: 10, font: bold, color: BLACK });
  y -= 15;

  // Column headers.
  const cols = [M, M + 24, M + 132, M + 196, M + 232, M + 278, M + 392];
  const headers = ["#", "INK", "TYPE", "MESH", "COVER", "HALFTONE", "SWATCH"];
  headers.forEach((hh, i) => {
    page.drawText(pdfSafe(hh), { x: cols[i], y, size: 7, font: bold, color: rgb(0.45, 0.45, 0.5) });
  });
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.8) });
  y -= 12;

  for (const ink of input.inks) {
    page.drawText(pdfSafe(String(ink.index).padStart(2, "0")), { x: cols[0], y, size: 9, font: bold, color: BLACK });
    // Fitted to its own column so it cannot run into MESH or COVER.
    page.drawText(fitToColumn(ink.name, font, 9, cols[2] - cols[1] - 6), {
      x: cols[1], y, size: 9, font, color: BLACK,
    });
    page.drawText(pdfSafe(humanizeInkRole(ink.type)), { x: cols[2], y, size: 8, font, color: rgb(0.35, 0.35, 0.42) });
    page.drawText(pdfSafe(String(ink.mesh)), { x: cols[3], y, size: 9, font, color: BLACK });
    page.drawText(pdfSafe(`${ink.coveragePercent.toFixed(1)}%`), { x: cols[4], y, size: 9, font, color: BLACK });
    page.drawText(fitToColumn(ink.halftone, font, 8, cols[6] - cols[5] - 6), {
      x: cols[5], y, size: 8, font, color: rgb(0.2, 0.2, 0.28),
    });

    const c = hexToPdfRgb(ink.color);
    page.drawRectangle({
      x: cols[6], y: y - 1.5, width: 20, height: 9,
      color: rgb(c[0], c[1], c[2]), borderColor: rgb(0.6, 0.6, 0.65), borderWidth: 0.4,
    });
    page.drawText(pdfSafe(ink.color.toUpperCase()), { x: cols[6] + 24, y, size: 7, font, color: rgb(0.35, 0.35, 0.42) });

    y -= 13;
    if (ink.note) {
      page.drawText(fitToColumn(ink.note, font, 7, W - M - cols[1]), {
        x: cols[1], y, size: 7, font, color: rgb(0.5, 0.5, 0.56),
      });
      y -= 11;
    }
    if (y < M + 120) break;
  }

  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.8) });
  y -= 15;

  if (input.notes.trim()) {
    page.drawText(pdfSafe("JOB NOTES"), { x: M, y, size: 10, font: bold, color: BLACK });
    y -= 14;
    y = drawWrapped(page, input.notes.trim(), M, y, W - M * 2, 8, font, rgb(0.25, 0.25, 0.3));
    y -= 8;
  }

  page.drawText(pdfSafe("SEPARATION NOTES"), { x: M, y, size: 10, font: bold, color: BLACK });
  y -= 14;
  y = drawWrapped(page, input.explanation, M, y, W - M * 2, 8, font, rgb(0.25, 0.25, 0.3));

  if (input.warnings.length > 0) {
    y -= 8;
    page.drawText(pdfSafe("WARNINGS"), { x: M, y, size: 10, font: bold, color: BLACK });
    y -= 14;
    for (const w of input.warnings) {
      y = drawWrapped(page, `•  ${w}`, M, y, W - M * 2, 8, font, rgb(0.25, 0.25, 0.3));
      if (y < M + 40) break;
    }
  }

  page.drawText(
    pdfSafe("Film output is device-independent. Actual exposure, dot gain and registration depend on your printer, RIP and press."),
    { x: M, y: M - 6, size: 7, font, color: rgb(0.5, 0.5, 0.56) },
  );

  return doc.save();
}

/**
 * Truncates text to fit a column width, appending an ellipsis.
 *
 * A production sheet is read at the burn table, and a long custom ink name
 * spilling across the MESH and COVER columns makes those numbers unreadable —
 * which are the two an operator actually needs. Losing the tail of a name is
 * the lesser harm, and the full name is on the film itself and in the manifest.
 */
export function fitToColumn(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = pdfSafe(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let cut = safe.length;
  while (cut > 1) {
    cut--;
    const candidate = `${safe.slice(0, cut).trimEnd()}...`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) return candidate;
  }
  return safe.slice(0, 1);
}

/** Alias documenting the production sheet's use of the column fitter. */
export const fitProductionSheetName = fitToColumn;

/** Greedy word wrap. Returns the y position after the last drawn line. */
function drawWrapped(
  page: PDFPage, text: string, x: number, y: number, maxWidth: number,
  size: number, font: PDFFont, color: ReturnType<typeof rgb>,
): number {
  const words = text.split(/\s+/);
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(pdfSafe(candidate), size) > maxWidth && line) {
      page.drawText(pdfSafe(line), { x, y: cursorY, size, font, color });
      cursorY -= size * 1.5;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    page.drawText(pdfSafe(line), { x, y: cursorY, size, font, color });
    cursorY -= size * 1.5;
  }
  return cursorY;
}

const METHOD_LABELS: Record<string, string> = {
  ai: "AI Recommend",
  spot: "Spot Color",
  simulated: "Simulated Process",
  index: "Index",
};

const INK_TYPE_LABELS: Record<string, string> = {
  plastisol: "Plastisol",
  waterbased: "Water-based",
  unknown: "Unknown",
};

export function humanizeMethod(m: string): string {
  return METHOD_LABELS[m] ?? m;
}

const INK_ROLE_LABELS: Record<string, string> = {
  underbase: "Underbase",
  spot: "Spot",
  black: "Black",
  highlight: "Highlight",
};

export function humanizeInkRole(r: string): string {
  return INK_ROLE_LABELS[r] ?? r;
}

export function humanizeInkType(t: string): string {
  return INK_TYPE_LABELS[t] ?? t;
}

function hexToPdfRgb(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
