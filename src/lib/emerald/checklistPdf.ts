/**
 * The validation sheet — expected plates, then the checklist, as a PDF.
 *
 * Printable on purpose. This gets carried to the RIP workstation and filled in
 * with a pen while the operator watches Emerald import the file; a form that
 * only exists in a browser tab on a different machine does not get filled in
 * at all. Boxes are drawn large enough to tick by hand.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfSafe } from "@/lib/film/pdf";
import type { EmeraldExpectations } from "@/lib/types";
import {
  checklistSections, screeningModeLabel, screeningModeDescription, readingTheTargetText, wrap,
} from "./expectations";

const PAGE_W = 612; // US Letter, the paper a shop has in the printer
const PAGE_H = 792;
const MARGIN = 48;
const INK = rgb(0.08, 0.08, 0.09);
const MUTED = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.78, 0.78, 0.8);
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

interface Cursor {
  page: PDFPage;
  y: number;
}

export interface ChecklistPdfInput {
  expectations: EmeraldExpectations;
  /** Names the inspector actually found, so the sheet shows verified values. */
  verifiedPlateNames: string[];
  /** Preflight verdict per screening mode, stated plainly rather than implied. */
  preflightSummaries: string[];
  preflightOk: boolean;
  /** The two files the package contains, by name. */
  fileNames: string[];
}

export async function buildEmeraldChecklistPdf(input: ChecklistPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`AccuRIP Emerald validation — ${input.expectations.jobName}`);
  doc.setProducer("SepWiz");
  doc.setCreator("SepWiz");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const c: Cursor = { page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN };

  const newPage = () => {
    c.page = doc.addPage([PAGE_W, PAGE_H]);
    c.y = PAGE_H - MARGIN;
  };
  const need = (h: number) => {
    if (c.y - h < MARGIN) newPage();
  };
  const text = (s: string, size: number, f: PDFFont, color = INK, indent = 0) => {
    need(size + 4);
    c.page.drawText(pdfSafe(s), { x: MARGIN + indent, y: c.y - size, size, font: f, color });
    c.y -= size + 4;
  };
  const gap = (h: number) => {
    c.y -= h;
  };
  const rule = () => {
    need(8);
    c.page.drawLine({
      start: { x: MARGIN, y: c.y - 4 }, end: { x: PAGE_W - MARGIN, y: c.y - 4 },
      thickness: 0.6, color: RULE,
    });
    c.y -= 10;
  };

  const e = input.expectations;

  text("ACCURIP EMERALD VALIDATION", 17, bold);
  text(`${e.jobName} — ${screeningModeLabel(e.screeningMode)}`, 10, font, MUTED);
  gap(2);
  for (const line of wrap(screeningModeDescription(e.screeningMode), 92)) {
    text(line, 8.5, font, MUTED);
  }
  rule();

  // Preflight. Stated before the checklist because a file that fails our own
  // structural check should not be carried to the RIP at all.
  text("SEPWIZ PREFLIGHT", 11, bold);
  const verdictColor = input.preflightOk ? INK : rgb(0.72, 0.11, 0.11);
  for (const summary of input.preflightSummaries) {
    // Wrapped rather than laid out on one line: two mode summaries joined end
    // to end overrun the page, and a verdict that runs off the paper is worse
    // than no verdict at all.
    wrap(summary, 84).forEach((line, i) => text(line, 9, font, verdictColor, i === 0 ? 0 : 10));
  }
  for (const line of wrap(
    "This is a structural check of the PDF against the specification. It says nothing about " +
    "whether Emerald will accept the file — that is what the rest of this sheet is for.", 96,
  )) text(line, 8, font, MUTED);
  gap(4);

  text("FILES IN THIS PACKAGE", 11, bold);
  for (const f of input.fileNames) text(`· ${f}`, 8.5, font, MUTED);
  rule();

  // Expected plates.
  text("EXPECTED PLATES", 11, bold);
  gap(2);
  need(14);
  c.page.drawText("#", { x: MARGIN, y: c.y - 8, size: 8, font: bold, color: MUTED });
  c.page.drawText("PLATE NAME", { x: MARGIN + 20, y: c.y - 8, size: 8, font: bold, color: MUTED });
  c.page.drawText("MESH", { x: MARGIN + 176, y: c.y - 8, size: 8, font: bold, color: MUTED });
  c.page.drawText("SCREENING", { x: MARGIN + 216, y: c.y - 8, size: 8, font: bold, color: MUTED });
  c.page.drawText("COVER", { x: PAGE_W - MARGIN - 34, y: c.y - 8, size: 8, font: bold, color: MUTED });
  c.y -= 14;

  for (const p of e.plates) {
    need(13);
    const y = c.y - 8;
    c.page.drawText(String(p.index).padStart(2, "0"), { x: MARGIN, y, size: 8.5, font, color: MUTED });
    c.page.drawText(pdfSafe(p.name), { x: MARGIN + 20, y, size: 8.5, font: bold, color: INK });
    c.page.drawText(String(p.mesh), { x: MARGIN + 176, y, size: 8.5, font, color: INK });
    c.page.drawText(pdfSafe(p.screening), { x: MARGIN + 216, y, size: 8.5, font, color: INK });
    c.page.drawText(`${p.coveragePercent.toFixed(1)}%`, {
      x: PAGE_W - MARGIN - 34, y, size: 8.5, font, color: MUTED,
    });
    c.y -= 13;
  }

  gap(6);
  const facts: [string, string][] = [
    ["Expected count", `${e.plateCount} spot plates`],
    ["Verified in the exported PDF", input.verifiedPlateNames.join(", ") || "none"],
    ["Expected document scale", `${e.scalePercent}%`],
    ["Expected artwork size", `${e.artworkWidthIn.toFixed(2)} × ${e.artworkHeightIn.toFixed(2)} in`],
    ["Expected page size", `${e.boardWidthIn.toFixed(2)} × ${e.boardHeightIn.toFixed(2)} in`],
    ["Expected registration", `identical on all plates — ${e.registrationCount} ${e.registrationLayout} targets`],
    ["Expected film polarity", e.polarity],
    ["Expected screening", e.screeningSummary],
    ["Film raster resolution", `${Math.round(e.filmDpi)} DPI`],
  ];
  for (const [k, v] of facts) {
    const lines = wrap(v, 62);
    need(11 * lines.length);
    c.page.drawText(pdfSafe(k), { x: MARGIN, y: c.y - 8, size: 8.5, font, color: MUTED });
    lines.forEach((line, i) => {
      c.page.drawText(pdfSafe(line), {
        x: MARGIN + 176, y: c.y - 8 - i * 10, size: 8.5, font: i === 0 ? bold : font, color: INK,
      });
    });
    c.y -= 11 + (lines.length - 1) * 10;
  }

  // Checklist.
  newPage();
  text("WHEN OPENING THE SPOT PDF IN EMERALD", 13, bold);
  text("Tick what you observe. An unticked box is data, not a failure to finish.", 8.5, font, MUTED);
  gap(4);

  for (const section of checklistSections()) {
    need(30);
    rule();
    text(section.title.toUpperCase(), 10, bold);
    gap(1);
    for (const item of section.items) {
      need(15);
      const boxY = c.y - 9.5;
      c.page.drawRectangle({
        x: MARGIN, y: boxY, width: 9, height: 9,
        borderColor: rgb(0.35, 0.35, 0.38), borderWidth: 0.8,
      });
      c.page.drawText(pdfSafe(item.text), {
        x: MARGIN + 16, y: boxY + 1.5, size: 9, font, color: INK,
      });
      c.y -= 14;
      if (item.note) {
        for (const line of wrap(item.note, 88)) {
          need(10);
          c.page.drawText(pdfSafe(line), { x: MARGIN + 16, y: c.y - 7, size: 7.5, font, color: MUTED });
          c.y -= 9;
        }
        c.y -= 2;
      }
    }
  }

  // How to read the target, then the notes space beneath it. Ordered this way
  // so the checklist page is not followed by a page holding only ruled lines —
  // an operator flipping to a near-empty sheet assumes the print failed.
  newPage();
  for (const line of readingTheTargetText().split("\n")) {
    if (line === "") {
      gap(5);
      continue;
    }
    const isHeading = line === line.toUpperCase() && /[A-Z]/.test(line) && !line.startsWith(" ");
    text(line, isHeading ? 12 : 8.5, isHeading ? bold : font, isHeading ? INK : MUTED);
  }

  // Free-text space, because the most useful thing an operator writes is never
  // one of the boxes. Drawn to fill whatever is left rather than a fixed count,
  // so it never pushes a page of its own.
  gap(8);
  rule();
  text("NOTES", 10, bold);
  while (c.y - 16 >= MARGIN) {
    c.page.drawLine({
      start: { x: MARGIN, y: c.y - 10 }, end: { x: PAGE_W - MARGIN, y: c.y - 10 },
      thickness: 0.5, color: RULE,
    });
    c.y -= 16;
  }

  return doc.save();
}
