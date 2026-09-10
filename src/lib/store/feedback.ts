/**
 * Test-print feedback.
 *
 * The whole reason this exists: connecting artwork and settings to what
 * actually came off the press, including whatever the operator changed first.
 * That change delta is the most informative signal available for improving the
 * engine, and it is invisible unless someone writes it down.
 */

import type { FeedbackRecord } from "@/lib/types";
import { readJson, writeJson, STORAGE_KEYS } from "./storage";

export function loadFeedback(): FeedbackRecord[] {
  const raw = readJson<FeedbackRecord[]>(STORAGE_KEYS.feedback, []);
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string") : [];
}

export function saveFeedback(records: FeedbackRecord[]): boolean {
  return writeJson(STORAGE_KEYS.feedback, records);
}

export function addFeedback(records: FeedbackRecord[], record: FeedbackRecord): FeedbackRecord[] {
  // One record per job; a re-submission replaces the earlier answer.
  const without = records.filter((r) => r.jobId !== record.jobId);
  return [...without, record];
}

export function feedbackForJob(records: FeedbackRecord[], jobId: string): FeedbackRecord | null {
  return records.find((r) => r.jobId === jobId) ?? null;
}

/** Serializes all collected feedback for export. */
export function feedbackExportJson(records: FeedbackRecord[]): string {
  return JSON.stringify(
    {
      schema: "sepwiz.shop-test/1",
      exportedAt: new Date().toISOString(),
      source: "SepWiz local shop-test feedback",
      count: records.length,
      records,
    },
    null,
    2,
  );
}

/** Escapes one CSV cell, quoting only when the content requires it. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: [string, (r: FeedbackRecord) => unknown][] = [
  ["recorded_at", (r) => r.recordedAt],
  ["job_name", (r) => r.jobName],
  ["job_id", (r) => r.jobId],
  ["screens", (r) => r.snapshot.screens],
  ["garment", (r) => r.snapshot.garmentColor],
  ["width_in", (r) => r.snapshot.widthIn.toFixed(2)],
  ["height_in", (r) => r.snapshot.heightIn.toFixed(2)],
  ["effective_dpi", (r) => r.snapshot.effectiveDpi],
  ["sep_score", (r) => r.snapshot.sepScore],
  ["similarity", (r) => r.snapshot.similarity],
  ["would_burn", (r) => r.shopTest?.wouldBurn ?? ""],
  ["registration", (r) => r.shopTest?.registration ?? ""],
  ["underbase", (r) => r.shopTest?.underbase ?? ""],
  ["separations", (r) => r.shopTest?.separations ?? ""],
  ["halftones", (r) => r.shopTest?.halftones ?? ""],
  ["print_order", (r) => r.shopTest?.printOrder ?? ""],
  ["time_saved", (r) => r.shopTest?.timeSaved ?? ""],
  ["normal_time_minutes", (r) => r.shopTest?.normalTimeMinutes ?? ""],
  ["normal_time_note", (r) => r.shopTest?.normalTimeNote ?? ""],
  ["would_pay", (r) => r.shopTest?.wouldPay ?? ""],
  ["modified_before_printing", (r) => (r.changedAnything === null ? "" : r.changedAnything ? "yes" : "no")],
  ["what_changed", (r) => r.whatChanged],
  ["notes", (r) => r.notes],
  ["inks", (r) => r.snapshot.inks.map((i) => i.name).join(" | ")],
  ["mesh", (r) => r.snapshot.inks.map((i) => i.mesh).join(" | ")],
  ["lpi", (r) => r.snapshot.inks.map((i) => i.lpi ?? "solid").join(" | ")],
  ["angles", (r) => r.snapshot.inks.map((i) => i.angle ?? "").join(" | ")],
];

/**
 * Flattens feedback into a spreadsheet.
 *
 * One row per test so results across a shop visit can be sorted and compared
 * without writing any code -- which is what actually happens to this data the
 * morning after.
 */
export function feedbackExportCsv(records: FeedbackRecord[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = records.map((r) => CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(","));
  return [header, ...rows].join("\n");
}
