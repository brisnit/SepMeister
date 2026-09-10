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
      exportedAt: new Date().toISOString(),
      source: "Sep AI local feedback",
      count: records.length,
      records,
    },
    null,
    2,
  );
}
