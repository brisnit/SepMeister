/**
 * AccuRIP Emerald validation results.
 *
 * These are observations, not settings. Everything here is something a person
 * watched happen at a RIP workstation, and the value of the record is entirely
 * in it being what was seen rather than what was expected — so nothing is
 * prefilled, nothing is inferred from the export, and an unanswered question
 * stays null rather than defaulting to the convenient answer.
 *
 * Kept separate from shop-test feedback because these answer a different
 * question. Shop feedback is "is this separation any good?"; this is "does the
 * file survive the RIP?", and a shop can answer either without the other.
 */

import type {
  AccuRipSetup, EmeraldValidationResult, ScreeningMode,
} from "@/lib/types";
import { emptyAccuRipSetup } from "@/lib/types";
import { readJson, writeJson, STORAGE_KEYS, makeId } from "./storage";

export function loadEmeraldResults(): EmeraldValidationResult[] {
  const raw = readJson<EmeraldValidationResult[]>(STORAGE_KEYS.emerald, []);
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string") : [];
}

export function saveEmeraldResults(records: EmeraldValidationResult[]): boolean {
  return writeJson(STORAGE_KEYS.emerald, records);
}

/**
 * One record per job and screening mode.
 *
 * Both modes get tested through the same RIP and they can behave differently —
 * that difference is the headline result — so a result keyed on job alone
 * would overwrite half the experiment.
 */
export function addEmeraldResult(
  records: EmeraldValidationResult[],
  record: EmeraldValidationResult,
): EmeraldValidationResult[] {
  const without = records.filter(
    (r) => !(r.jobName === record.jobName && r.screeningMode === record.screeningMode),
  );
  return [...without, record];
}

export function emptyEmeraldResult(
  jobName: string,
  screeningMode: ScreeningMode,
  expectedSpotPlates: number,
  setup: AccuRipSetup = emptyAccuRipSetup(),
): EmeraldValidationResult {
  return {
    id: makeId("emerald"),
    recordedAt: new Date().toISOString(),
    jobName,
    screeningMode,
    fileOpened: null,
    spotPlatesDetected: null,
    expectedSpotPlates,
    plateNamesPreserved: null,
    unexpectedPlates: "",
    scalePreserved: null,
    registrationPreserved: null,
    screeningBehavior: null,
    filmOutput: null,
    notes: "",
    setup,
  };
}

/** True once anything has been recorded, so an empty form is not saved. */
export function hasEmeraldAnswers(r: EmeraldValidationResult): boolean {
  return (
    r.fileOpened !== null ||
    r.spotPlatesDetected !== null ||
    r.plateNamesPreserved !== null ||
    r.scalePreserved !== null ||
    r.registrationPreserved !== null ||
    r.screeningBehavior !== null ||
    r.filmOutput !== null ||
    r.unexpectedPlates.trim() !== "" ||
    r.notes.trim() !== "" ||
    hasSetupAnswers(r.setup)
  );
}

export function hasSetupAnswers(s: AccuRipSetup): boolean {
  return Object.values(s).some((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * The one-line answer the whole exercise exists to produce.
 *
 * Deliberately refuses to guess: an untested mode reads as untested, not as
 * working. Someone skimming a list of results must not be able to mistake
 * "nobody has run this yet" for "this passed".
 */
export function emeraldVerdict(r: EmeraldValidationResult): string {
  if (r.fileOpened === false) return "Emerald could not open the file.";
  if (r.fileOpened === null) return "Not yet tested.";

  const parts: string[] = [];
  if (r.spotPlatesDetected !== null) {
    parts.push(
      r.spotPlatesDetected === r.expectedSpotPlates
        ? `${r.spotPlatesDetected} plates, as expected`
        : `${r.spotPlatesDetected} plates, expected ${r.expectedSpotPlates}`,
    );
  }
  if (r.plateNamesPreserved) parts.push(`names ${r.plateNamesPreserved}`);
  if (r.screeningBehavior === "sepwiz-preserved") parts.push("SepWiz screening preserved");
  if (r.screeningBehavior === "rip-rescreened") parts.push("Emerald rescreened");
  if (r.filmOutput) parts.push(`film ${r.filmOutput.replace(/-/g, " ")}`);
  return parts.length ? parts.join(" · ") : "Opened; nothing else recorded yet.";
}

/** Serializes results for export alongside shop-test data. */
export function emeraldExportJson(records: EmeraldValidationResult[]): string {
  return JSON.stringify(
    {
      schema: "sepwiz.emerald-result/1",
      exportedAt: new Date().toISOString(),
      source: "SepWiz local AccuRIP Emerald validation results",
      count: records.length,
      records,
    },
    null,
    2,
  );
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: [string, (r: EmeraldValidationResult) => unknown][] = [
  ["recorded_at", (r) => r.recordedAt],
  ["job_name", (r) => r.jobName],
  ["screening_mode", (r) => r.screeningMode],
  ["file_opened", (r) => (r.fileOpened === null ? "" : r.fileOpened ? "yes" : "no")],
  ["spot_plates_detected", (r) => r.spotPlatesDetected ?? ""],
  ["expected_spot_plates", (r) => r.expectedSpotPlates],
  ["plate_names_preserved", (r) => r.plateNamesPreserved ?? ""],
  ["unexpected_plates", (r) => r.unexpectedPlates],
  ["scale_preserved", (r) => (r.scalePreserved === null ? "" : r.scalePreserved ? "yes" : "no")],
  ["registration_preserved", (r) => (r.registrationPreserved === null ? "" : r.registrationPreserved ? "yes" : "no")],
  ["screening_behavior", (r) => r.screeningBehavior ?? ""],
  ["film_output", (r) => r.filmOutput ?? ""],
  ["notes", (r) => r.notes],
  ["accurip_version", (r) => r.setup.accuRipVersion],
  ["printer_manufacturer", (r) => r.setup.printerManufacturer],
  ["printer_model", (r) => r.setup.printerModel],
  ["output_resolution", (r) => r.setup.outputResolution],
  ["media_type", (r) => r.setup.mediaType],
  ["ink_channel_configuration", (r) => r.setup.inkChannelConfiguration],
  ["density_settings", (r) => r.setup.densitySettings],
  ["black_ink_strategy", (r) => r.setup.blackInkStrategy],
  ["page_size", (r) => r.setup.pageSize],
  ["halftone_settings", (r) => r.setup.halftoneSettings],
  ["custom_presets", (r) => r.setup.customPresets],
];

export function emeraldExportCsv(records: EmeraldValidationResult[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = records.map((r) => CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(","));
  return [header, ...rows].join("\n");
}

/**
 * The observed workflow, formatted for `docs/rip-replacement-research.md`.
 *
 * Generated rather than hand-written so the document records what was actually
 * observed. A hand-edited summary drifts from the data behind it, and this
 * particular document's only value is that it does not.
 */
export function validatedWorkflowMarkdown(records: EmeraldValidationResult[]): string {
  if (records.length === 0) {
    return "No Emerald validation has been recorded yet. Nothing below this line is known.";
  }
  const lines: string[] = [];
  lines.push("| Job | Mode | Opened | Plates | Names | Scale | Registration | Screening | Film |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  const yn = (v: boolean | null) => (v === null ? "—" : v ? "yes" : "no");
  for (const r of [...records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    lines.push(
      `| ${r.jobName} | ${r.screeningMode} | ${yn(r.fileOpened)} | ` +
      `${r.spotPlatesDetected ?? "—"}/${r.expectedSpotPlates} | ${r.plateNamesPreserved ?? "—"} | ` +
      `${yn(r.scalePreserved)} | ${yn(r.registrationPreserved)} | ` +
      `${r.screeningBehavior ?? "—"} | ${r.filmOutput ?? "—"} |`,
    );
  }
  return lines.join("\n");
}
