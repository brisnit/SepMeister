/**
 * The expected-plates report and the Emerald compatibility checklist.
 *
 * These are the reference an operator holds next to the RIP. The report states
 * what SepWiz believes it wrote; the checklist is the set of questions whose
 * answers turn that belief into a fact. Keeping them in one module means the
 * two can never describe different jobs.
 *
 * Every number here is read back from the artifacts actually produced — the
 * layout, the plan, the inspection — never restated from the settings that
 * were requested. A report that repeats the request would agree with itself
 * even when the export was wrong, which is the one thing it must not do.
 */

import type {
  EmeraldExpectations, InkSeparation, PlateExpectation, ScreeningMode, SeparationPlan,
} from "@/lib/types";
import type { FilmLayout } from "@/lib/film/layout";

export function screeningModeLabel(mode: ScreeningMode): string {
  return mode === "sepwiz-screened" ? "SepWiz Screened" : "Continuous Tone Spot";
}

export function screeningModeDescription(mode: ScreeningMode): string {
  return mode === "sepwiz-screened"
    ? "SepWiz generates the final halftone structure. The RIP should pass the dots through unchanged."
    : "SepWiz exports continuous-tone spot coverage. The RIP is expected to apply its own screening.";
}

/** File-name stem for each mode, used across the package and the manifest. */
export function screeningModeSlug(mode: ScreeningMode): string {
  return mode === "sepwiz-screened" ? "screened" : "continuous-tone";
}

function screeningFor(ink: InkSeparation, mode: ScreeningMode): string {
  if (mode === "continuous-tone") return "Continuous tone — RIP screens";
  if (!ink.halftone.enabled) return "Solid — no halftone";
  return `${ink.halftone.lpi} LPI · ${ink.halftone.angle}° · ${ink.halftone.shape}`;
}

export interface ExpectationsInput {
  jobName: string;
  plan: SeparationPlan;
  layout: FilmLayout;
  screeningMode: ScreeningMode;
  filmDpi: number;
  /** Artwork's physical size, distinct from the board it is placed on. */
  artworkWidthIn: number;
  artworkHeightIn: number;
}

export function buildExpectations(input: ExpectationsInput): EmeraldExpectations {
  const inks = [...input.plan.inks].sort((a, b) => a.order - b.order);

  const plates: PlateExpectation[] = inks.map((ink, i) => ({
    index: i + 1,
    name: ink.name.toUpperCase(),
    role: ink.type,
    mesh: ink.mesh,
    screening: screeningFor(ink, input.screeningMode),
    coveragePercent: ink.coverage * 100,
  }));

  const screened = inks.filter((i) => i.halftone.enabled);
  const summary = input.screeningMode === "continuous-tone"
    ? "None applied by SepWiz — every plate carries continuous-tone coverage for the RIP to screen."
    : screened.length === 0
      ? "None — every plate is solid."
      : `${screened.length} of ${inks.length} plates screened at ` +
        `${[...new Set(screened.map((s) => s.halftone.lpi))].join("/")} LPI, ` +
        `angles ${screened.map((s) => `${s.halftone.angle}°`).join(", ")}`;

  return {
    jobName: input.jobName,
    screeningMode: input.screeningMode,
    plates,
    plateCount: plates.length,
    scalePercent: 100,
    artworkWidthIn: input.artworkWidthIn,
    artworkHeightIn: input.artworkHeightIn,
    boardWidthIn: input.layout.boardWidthPt / 72,
    boardHeightIn: input.layout.boardHeightPt / 72,
    registrationLayout: input.layout.registrationLayout,
    registrationCount: input.layout.registration.length,
    polarity: "positive",
    screeningSummary: summary,
    filmDpi: input.filmDpi,
  };
}

/** The report, as plain text for the package README and the manifest. */
export function expectationsText(e: EmeraldExpectations): string {
  const lines: string[] = [];
  lines.push("EXPECTED PLATES");
  lines.push("");
  lines.push(`Job:              ${e.jobName}`);
  lines.push(`Screening mode:   ${screeningModeLabel(e.screeningMode)}`);
  lines.push("");
  lines.push("Expected in Emerald:");
  for (const p of e.plates) {
    lines.push(`  ${String(p.index).padStart(2, "0")}  ${p.name.padEnd(18)} ${p.screening}`);
  }
  lines.push("");
  lines.push(`Expected count:         ${e.plateCount} spot plates`);
  lines.push(`Expected document scale: ${e.scalePercent}%`);
  lines.push(`Expected artwork size:   ${e.artworkWidthIn.toFixed(2)} × ${e.artworkHeightIn.toFixed(2)} in`);
  lines.push(`Expected page size:      ${e.boardWidthIn.toFixed(2)} × ${e.boardHeightIn.toFixed(2)} in`);
  lines.push(`Expected registration:   identical across all plates — ` +
    `${e.registrationCount} ${e.registrationLayout} targets, drawn in DeviceGray`);
  lines.push(`Expected film polarity:  ${e.polarity}`);
  lines.push(`Expected screening:      ${e.screeningSummary}`);
  lines.push(`Film raster resolution:  ${Math.round(e.filmDpi)} DPI`);
  return lines.join("\n");
}

export interface ChecklistItem {
  /** Stable key, so a result can be recorded against a specific question. */
  key: string;
  text: string;
  /** Set where the honest answer is "record which of these happened". */
  note?: string;
}

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

/**
 * The validation checklist.
 *
 * Written as questions with observable answers rather than as assertions. An
 * item a separator cannot check by looking at the RIP or the film is not on
 * this list.
 */
export function checklistSections(): ChecklistSection[] {
  return [
    {
      title: "Import",
      items: [
        { key: "opens", text: "File opens without error" },
        { key: "recognises-spots", text: "Emerald recognises separate spot plates" },
        { key: "plate-count", text: "Correct number of plates appears" },
        { key: "names", text: "Plate names are preserved" },
        { key: "no-cmyk", text: "No unexpected CMYK plates appear" },
        { key: "no-flatten", text: "No composite-only flattening occurs" },
      ],
    },
    {
      title: "Dimensions",
      items: [
        { key: "art-size", text: "Artwork size matches SepWiz" },
        { key: "media-size", text: "Film / media size matches expectation" },
        { key: "scale", text: "Output remains 100% scale" },
        { key: "no-fit", text: "No fit-to-page scaling applied" },
      ],
    },
    {
      title: "Registration",
      items: [
        { key: "reg-all-plates", text: "Registration marks appear on every plate" },
        { key: "reg-identical", text: "Registration positions are identical" },
        { key: "reg-layout", text: "T-shaped registration layout is preserved" },
        { key: "reg-centres", text: "Bold hash marks retain precise centre points" },
      ],
    },
    {
      title: "Tonal output",
      items: [
        { key: "tone-100", text: "100% regions output solid" },
        { key: "tone-75", text: "75% tone appears correct" },
        { key: "tone-50", text: "50% tone appears correct" },
        { key: "tone-25", text: "25% tone appears correct" },
        {
          key: "screening-owner",
          text: "Halftone angles match SepWiz settings (Emerald preserved our screening)",
          note: "OR: Emerald rescreened the tonal data. Record which behaviour occurred — " +
            "this is the single most important answer on the sheet.",
        },
      ],
    },
    {
      title: "Plate behaviour",
      items: [
        { key: "base-own-plate", text: "Underbase appears as its own plate" },
        { key: "no-missing", text: "No colours are missing" },
        { key: "no-merge", text: "No spot plates merge unexpectedly" },
        { key: "black-own-plate", text: "Black remains its own plate where intended" },
        { key: "names-match", text: "Spot names match SepWiz" },
      ],
    },
    {
      title: "Film output",
      items: [
        { key: "opacity", text: "Film positives are sufficiently opaque" },
        { key: "density", text: "Printer uses expected black / density behaviour" },
        { key: "no-clipping", text: "No clipping" },
        { key: "no-margin-shift", text: "No unwanted margins or scaling" },
        { key: "reg-prints", text: "Registration prints correctly" },
      ],
    },
  ];
}

/**
 * What the control target is for, in the operator's terms.
 *
 * Included in the package because a test sheet whose features are unexplained
 * gets read as decoration, and the reader then cannot tell a fault from a
 * design choice. The viewer caveats are here rather than buried: both are
 * expected behaviour that looks exactly like a bug.
 */
export function readingTheTargetText(): string {
  return [
    "READING THE CONTROL TARGET",
    "",
    "Six labelled bands, one per plate. Each carries the same battery:",
    "  plate name, plate number, a 100/75/50/25% tint ramp, 1-4px rules,",
    "  shrinking detail squares, and a large solid bar.",
    "",
    "Below them, an overlap rosette: five colour petals over a white base disc.",
    "Every petal covers the centre, so the middle is six plates deep.",
    "",
    "What a failure looks like:",
    "  a plate missing        an entire labelled band is blank",
    "  names collapsed        two bands carry the same name",
    "  scale changed          bands no longer line up between plates",
    "  tint inverted          the ramp runs 25 -> 100% instead of 100 -> 25%",
    "  spot semantics lost    the composite is one colour instead of six",
    "  plates merged          a petal appears on more than one plate",
    "",
    "Two things that look wrong but are not:",
    "",
    "  The WHITE UNDERBASE band is invisible when the PDF is previewed on a",
    "  white page. White ink has no CMYK equivalent, so a viewer paints it as",
    "  nothing. The plate is present — check the plate list, not the preview.",
    "",
    "  In the rosette, an ordinary PDF viewer shows the topmost plate winning",
    "  wherever two plates are both solid. Viewers ignore overprint; a",
    "  separation-aware RIP images each plate on its own and does not. Judge",
    "  overprint from the separated output, never from a preview.",
  ].join("\n");
}

/** The checklist as plain text, for the package and for printing. */
export function checklistText(e: EmeraldExpectations): string {
  const lines: string[] = [];
  lines.push("ACCURIP EMERALD VALIDATION");
  lines.push("");
  lines.push(`Job:            ${e.jobName}`);
  lines.push(`Screening mode: ${screeningModeLabel(e.screeningMode)}`);
  lines.push(`                ${screeningModeDescription(e.screeningMode)}`);
  lines.push("");
  lines.push("When opening the SepWiz Spot PDF in Emerald, check:");
  lines.push("");
  for (const section of checklistSections()) {
    lines.push(section.title.toUpperCase());
    for (const item of section.items) {
      lines.push(`  [ ] ${item.text}`);
      if (item.note) {
        for (const w of wrap(item.note, 68)) lines.push(`      ${w}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Simple greedy wrap, so notes stay readable in a fixed-width file. */
export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length === 0) line = w;
    else if (line.length + 1 + w.length <= width) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}
