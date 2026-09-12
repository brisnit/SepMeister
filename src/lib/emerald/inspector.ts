/**
 * PDF plate inspector — a preflight, not a verdict.
 *
 * This reads a finished PDF back and reports what a RIP will actually find in
 * it. It exists because "the export looked right" is worth nothing: two of the
 * three serious bugs in the spot PDF work were invisible to the eye and only
 * showed up when something walked the object graph. A file that renders
 * beautifully in Preview and carries no `/Separation` colour space at all is a
 * perfectly ordinary failure mode.
 *
 * What it cannot do is tell you Emerald will accept the file. It checks the
 * document against the PDF specification and against what we intended to
 * write. Whether one particular RIP is happy is a question only that RIP can
 * answer, and nothing here should be read as a substitute for asking it.
 */

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFRawStream, PDFStream } from "pdf-lib";

export type CheckStatus = "pass" | "warn" | "fail";

export interface InspectionCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SeparationInfo {
  /** Colourant name, as a RIP will list it. */
  name: string;
  /** The space a viewer falls back to when flattening, e.g. DeviceCMYK. */
  alternateSpace: string;
  /** PDF function type of the tint transform, or null when absent. */
  tintTransformType: number | null;
  /** Whether an image in this space carries a soft mask. */
  hasSoftMask: boolean;
}

export interface PdfInspection {
  pageCount: number;
  /** Page size in points and inches, first page. */
  widthPt: number;
  heightPt: number;
  widthIn: number;
  heightIn: number;
  separations: SeparationInfo[];
  spotPlateCount: number;
  /** Names in document order. */
  plateNames: string[];
  overprintFill: boolean;
  overprintStroke: boolean;
  overprintMode: number | null;
  softMaskCount: number;
  /** Colour spaces used by image XObjects that are not Separations. */
  deviceSpacesUsed: string[];
  checks: InspectionCheck[];
  passed: number;
  warnings: number;
  failures: number;
  /** True when nothing failed. Warnings do not block. */
  ok: boolean;
}

export interface InspectExpectation {
  /** Plate names the document is supposed to carry, in order. */
  expectedPlateNames?: string[];
  expectedWidthIn?: number;
  expectedHeightIn?: number;
  /** A spot document should be one page; a film set is one page per screen. */
  expectedPageCount?: number;
}

function nameOf(obj: unknown): string {
  if (obj instanceof PDFName) return obj.asString().replace(/^\//, "");
  return String(obj ?? "");
}

/** `#20`-style escapes are legal inside PDF name objects. */
function decodePdfName(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Walks every indirect object rather than only the page tree.
 *
 * Colour spaces can be referenced from resources nested arbitrarily deep, and
 * a Separation that exists but is unreachable from a page is itself a finding.
 * Enumerating the whole object map is both simpler and harder to fool.
 */
function allObjects(doc: PDFDocument): [PDFRef, unknown][] {
  return doc.context.enumerateIndirectObjects() as [PDFRef, unknown][];
}

function resolve(doc: PDFDocument, obj: unknown): unknown {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

/** `[/Separation /NAME /Alt <fn>]`, if this array is one. */
function readSeparationArray(doc: PDFDocument, arr: PDFArray): { name: string; alt: string; fnType: number | null } | null {
  if (arr.size() < 3) return null;
  if (nameOf(arr.get(0)) !== "Separation") return null;

  const name = decodePdfName(nameOf(arr.get(1)));

  // The alternate may itself be an array (an ICCBased or Lab space).
  const altRaw = resolve(doc, arr.get(2));
  const alt = altRaw instanceof PDFArray ? nameOf(altRaw.get(0)) : nameOf(arr.get(2));

  let fnType: number | null = null;
  const fn = resolve(doc, arr.get(3));
  const fnDict = fn instanceof PDFStream ? fn.dict : fn instanceof PDFDict ? fn : null;
  if (fnDict) {
    const ft = fnDict.get(PDFName.of("FunctionType"));
    const n = Number(nameOf(ft));
    if (Number.isFinite(n)) fnType = n;
  }

  return { name, alt, fnType };
}

export async function inspectPdf(
  bytes: Uint8Array,
  expect: InspectExpectation = {},
): Promise<PdfInspection> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const first = pages[0];
  const widthPt = first?.getWidth() ?? 0;
  const heightPt = first?.getHeight() ?? 0;

  const separations: SeparationInfo[] = [];
  const seen = new Set<string>();
  const deviceSpaces = new Set<string>();
  let softMaskCount = 0;
  let overprintFill = false;
  let overprintStroke = false;
  let overprintMode: number | null = null;

  // Separation colour spaces, wherever they live.
  for (const [, obj] of allObjects(doc)) {
    if (!(obj instanceof PDFArray)) continue;
    const sep = readSeparationArray(doc, obj);
    if (!sep || seen.has(sep.name)) continue;
    seen.add(sep.name);
    separations.push({
      name: sep.name,
      alternateSpace: sep.alt,
      tintTransformType: sep.fnType,
      hasSoftMask: false,
    });
  }

  // Image XObjects: which space each is painted in, and whether it is masked.
  for (const [, obj] of allObjects(doc)) {
    const dict = obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    if (nameOf(dict.get(PDFName.of("Subtype"))) !== "Image") continue;

    if (dict.has(PDFName.of("SMask"))) softMaskCount++;

    const csRaw = resolve(doc, dict.get(PDFName.of("ColorSpace")));
    if (csRaw instanceof PDFArray) {
      const sep = readSeparationArray(doc, csRaw);
      if (sep) {
        const entry = separations.find((s) => s.name === sep.name);
        if (entry && dict.has(PDFName.of("SMask"))) entry.hasSoftMask = true;
        continue;
      }
      deviceSpaces.add(nameOf(csRaw.get(0)));
    } else {
      const n = nameOf(csRaw);
      // A soft mask is DeviceGray by definition; counting it as a stray
      // device space would report a fault in correct output.
      if (n && n !== "DeviceGray") deviceSpaces.add(n);
    }
  }

  // Overprint graphics state.
  for (const [, obj] of allObjects(doc)) {
    if (!(obj instanceof PDFDict)) continue;
    if (nameOf(obj.get(PDFName.of("Type"))) !== "ExtGState") continue;
    if (String(obj.get(PDFName.of("OP")) ?? "") === "true") overprintFill = true;
    if (String(obj.get(PDFName.of("op")) ?? "") === "true") overprintStroke = true;
    const opm = obj.get(PDFName.of("OPM"));
    if (opm !== undefined) {
      const n = Number(String(opm));
      if (Number.isFinite(n)) overprintMode = n;
    }
  }

  // Plate order follows the XObject naming the writer used (Plate0, Plate1…),
  // falling back to discovery order for a document we did not write.
  const plateNames = orderPlates(doc, separations.map((s) => s.name));

  const checks = buildChecks({
    pageCount: pages.length,
    widthPt, heightPt,
    separations, plateNames,
    overprintFill, overprintStroke, overprintMode,
    softMaskCount,
    deviceSpaces: [...deviceSpaces],
    expect,
  });

  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const failures = checks.filter((c) => c.status === "fail").length;

  return {
    pageCount: pages.length,
    widthPt, heightPt,
    widthIn: widthPt / 72,
    heightIn: heightPt / 72,
    separations,
    spotPlateCount: separations.length,
    plateNames,
    overprintFill, overprintStroke, overprintMode,
    softMaskCount,
    deviceSpacesUsed: [...deviceSpaces],
    checks, passed, warnings, failures,
    ok: failures === 0,
  };
}

/**
 * Orders plate names the way the document paints them.
 *
 * A RIP lists plates in the order it meets them, so a report that lists them
 * in some other order invites a false mismatch when the operator compares.
 */
function orderPlates(doc: PDFDocument, discovered: string[]): string[] {
  const page = doc.getPages()[0];
  if (!page) return discovered;
  const resources = page.node.Resources();
  const xobjRaw = resources ? resolve(doc, resources.get(PDFName.of("XObject"))) : null;
  if (!(xobjRaw instanceof PDFDict)) return discovered;

  const ordered: string[] = [];
  const entries = [...xobjRaw.entries()].sort(([a], [b]) =>
    a.asString().localeCompare(b.asString(), "en", { numeric: true }),
  );
  for (const [, ref] of entries) {
    const stream = resolve(doc, ref);
    const dict = stream instanceof PDFStream ? stream.dict : null;
    if (!dict) continue;
    const cs = resolve(doc, dict.get(PDFName.of("ColorSpace")));
    if (!(cs instanceof PDFArray)) continue;
    const sep = readSeparationArray(doc, cs);
    if (sep && !ordered.includes(sep.name)) ordered.push(sep.name);
  }

  // Anything reachable but not painted on page 1 still belongs in the report.
  for (const n of discovered) if (!ordered.includes(n)) ordered.push(n);
  return ordered;
}

interface CheckInput {
  pageCount: number;
  widthPt: number;
  heightPt: number;
  separations: SeparationInfo[];
  plateNames: string[];
  overprintFill: boolean;
  overprintStroke: boolean;
  overprintMode: number | null;
  softMaskCount: number;
  deviceSpaces: string[];
  expect: InspectExpectation;
}

function buildChecks(i: CheckInput): InspectionCheck[] {
  const c: InspectionCheck[] = [];
  const { expect: e } = i;

  c.push({
    key: "pages",
    label: "Page count",
    status: e.expectedPageCount === undefined || e.expectedPageCount === i.pageCount ? "pass" : "fail",
    detail: e.expectedPageCount === undefined
      ? `${i.pageCount} page${i.pageCount === 1 ? "" : "s"}`
      : `${i.pageCount} page${i.pageCount === 1 ? "" : "s"}, expected ${e.expectedPageCount}`,
  });

  const wIn = i.widthPt / 72;
  const hIn = i.heightPt / 72;
  const sizeText = `${wIn.toFixed(3)} × ${hIn.toFixed(3)} in (${i.widthPt.toFixed(2)} × ${i.heightPt.toFixed(2)} pt)`;
  if (e.expectedWidthIn !== undefined && e.expectedHeightIn !== undefined) {
    // A tenth of a point. Tighter than any press tolerance, and loose enough
    // to absorb the rounding in a points-to-inches round trip.
    const tol = 0.1 / 72;
    const okSize = Math.abs(wIn - e.expectedWidthIn) <= tol && Math.abs(hIn - e.expectedHeightIn) <= tol;
    c.push({
      key: "dimensions",
      label: "Page dimensions",
      status: okSize ? "pass" : "fail",
      detail: okSize
        ? sizeText
        : `${sizeText}, expected ${e.expectedWidthIn.toFixed(3)} × ${e.expectedHeightIn.toFixed(3)} in`,
    });
  } else {
    c.push({ key: "dimensions", label: "Page dimensions", status: "pass", detail: sizeText });
  }

  // The headline check. Zero Separations means this is not a spot document,
  // whatever it was named.
  c.push({
    key: "separations",
    label: "Spot separations present",
    status: i.separations.length > 0 ? "pass" : "fail",
    detail: i.separations.length > 0
      ? `${i.separations.length} /Separation colour space${i.separations.length === 1 ? "" : "s"}`
      : "No /Separation colour spaces. This is not a spot-separated PDF.",
  });

  if (e.expectedPlateNames) {
    const got = i.plateNames;
    const want = e.expectedPlateNames;
    const missing = want.filter((n) => !got.includes(n));
    const extra = got.filter((n) => !want.includes(n));
    const sameOrder = got.length === want.length && got.every((n, k) => n === want[k]);
    c.push({
      key: "plate-names",
      label: "Plate names",
      status: missing.length === 0 && extra.length === 0 ? (sameOrder ? "pass" : "warn") : "fail",
      detail: missing.length || extra.length
        ? `${got.length} of ${want.length}` +
          (missing.length ? ` · missing: ${missing.join(", ")}` : "") +
          (extra.length ? ` · unexpected: ${extra.join(", ")}` : "")
        : sameOrder
          ? got.join(", ")
          : `all present but in a different order: ${got.join(", ")}`,
    });
  } else {
    c.push({
      key: "plate-names",
      label: "Plate names",
      status: i.plateNames.length > 0 ? "pass" : "fail",
      detail: i.plateNames.join(", ") || "none",
    });
  }

  const noTint = i.separations.filter((s) => s.tintTransformType === null);
  c.push({
    key: "tint-transforms",
    label: "Tint transforms",
    status: i.separations.length === 0 ? "fail" : noTint.length === 0 ? "pass" : "fail",
    detail: i.separations.length === 0
      ? "no separations to transform"
      : noTint.length === 0
        ? `all ${i.separations.length} carry a tint transform (type ${[...new Set(i.separations.map((s) => s.tintTransformType))].join("/")})`
        : `missing on: ${noTint.map((s) => s.name).join(", ")}`,
  });

  const alts = [...new Set(i.separations.map((s) => s.alternateSpace))];
  c.push({
    key: "alternate-space",
    label: "Alternate colour space",
    status: i.separations.length === 0 ? "fail" : alts.every((a) => a === "DeviceCMYK") ? "pass" : "warn",
    detail: alts.length ? alts.join(", ") : "none",
  });

  c.push({
    key: "overprint",
    label: "Overprint",
    status: i.overprintFill && i.overprintStroke ? "pass" : "warn",
    detail: i.overprintFill || i.overprintStroke
      ? `OP ${i.overprintFill} · op ${i.overprintStroke}` +
        (i.overprintMode === null ? "" : ` · OPM ${i.overprintMode}`)
      : "No overprint state. Plates may knock each other out where they share area.",
  });

  c.push({
    key: "soft-masks",
    label: "Plate soft masks",
    status: i.separations.length === 0
      ? "fail"
      : i.softMaskCount >= i.separations.length ? "pass" : "warn",
    detail: `${i.softMaskCount} of ${i.separations.length} plate images carry an SMask` +
      (i.softMaskCount >= i.separations.length
        ? ""
        : ". Without one, a tint of 0 paints white and hides the plates beneath."),
  });

  // Not a fault by itself — the marks are deliberately DeviceGray so a RIP
  // carries them to every plate — but stray RGB in a prepress file is worth
  // surfacing, since it usually means something got flattened.
  const rgb = i.deviceSpaces.filter((s) => s.includes("RGB"));
  const cmyk = i.deviceSpaces.filter((s) => s.includes("CMYK"));
  c.push({
    key: "device-spaces",
    label: "Non-spot image data",
    status: rgb.length === 0 && cmyk.length === 0 ? "pass" : "warn",
    detail: rgb.length === 0 && cmyk.length === 0
      ? "None. Every image is in a Separation space."
      : `Images in ${[...rgb, ...cmyk].join(", ")}. A RIP may render these as process colour.`,
  });

  return c;
}

/** One-line summary for a log or a notice. */
export function summarizeInspection(r: PdfInspection): string {
  return `${r.ok ? "PASS" : "FAIL"} — ${r.spotPlateCount} spot plate${r.spotPlateCount === 1 ? "" : "s"}, ` +
    `${r.widthIn.toFixed(2)} × ${r.heightIn.toFixed(2)} in, ` +
    `${r.passed} passed / ${r.warnings} warned / ${r.failures} failed`;
}

export { PDFRawStream };
