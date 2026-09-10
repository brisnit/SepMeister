"use client";

import { useState } from "react";
import type {
  BurnVerdict, FeedbackRecord, OrderVerdict, QualityVerdict,
  RegistrationVerdict, TimeSaved, UnderbaseVerdict, WouldPay,
} from "@/lib/types";
import { Button, Pill } from "./primitives";

export interface ShopTestAnswers {
  wouldBurn: BurnVerdict | null;
  registration: RegistrationVerdict | null;
  underbase: UnderbaseVerdict | null;
  separations: QualityVerdict | null;
  halftones: QualityVerdict | null;
  printOrder: OrderVerdict | null;
  timeSaved: TimeSaved | null;
  normalTimeMinutes: number | null;
  normalTimeNote: string;
  wouldPay: WouldPay | null;
  modifiedBeforePrinting: boolean | null;
  whatChanged: string;
  notes: string;
}

export function emptyAnswers(): ShopTestAnswers {
  return {
    wouldBurn: null, registration: null, underbase: null, separations: null,
    halftones: null, printOrder: null, timeSaved: null, normalTimeMinutes: null,
    normalTimeNote: "", wouldPay: null, modifiedBeforePrinting: null,
    whatChanged: "", notes: "",
  };
}

export function answersFromRecord(r: FeedbackRecord | null): ShopTestAnswers {
  if (!r) return emptyAnswers();
  const st = r.shopTest;
  return {
    wouldBurn: st?.wouldBurn ?? null,
    registration: st?.registration ?? null,
    underbase: st?.underbase ?? null,
    separations: st?.separations ?? null,
    halftones: st?.halftones ?? null,
    printOrder: st?.printOrder ?? null,
    timeSaved: st?.timeSaved ?? null,
    normalTimeMinutes: st?.normalTimeMinutes ?? null,
    normalTimeNote: st?.normalTimeNote ?? "",
    wouldPay: st?.wouldPay ?? null,
    modifiedBeforePrinting: r.changedAnything ?? null,
    whatChanged: r.whatChanged ?? "",
    notes: r.notes ?? "",
  };
}

/** True once anything has been entered, so a reset can warn before discarding. */
export function hasAnswers(a: ShopTestAnswers): boolean {
  return (
    a.wouldBurn !== null || a.registration !== null || a.underbase !== null ||
    a.separations !== null || a.halftones !== null || a.printOrder !== null ||
    a.timeSaved !== null || a.wouldPay !== null || a.modifiedBeforePrinting !== null ||
    a.normalTimeMinutes !== null || a.normalTimeNote.trim() !== "" ||
    a.whatChanged.trim() !== "" || a.notes.trim() !== ""
  );
}

/**
 * Shop-test feedback.
 *
 * The question that matters most is first and asked plainly: would you burn
 * these screens? Everything else is diagnosis. The free-text change field is
 * the single most valuable thing here — whatever a working separator adjusts
 * before committing film is exactly where the engine's judgement diverged
 * from a professional's, and it is invisible unless someone writes it down.
 *
 * Nothing is required, nothing is uploaded, and no personal information is
 * collected unless somebody types it into a notes box.
 */
export function ShopTestPanel({
  answers, jobName, screens, sepScore, similarity, onChange, onSave, onExport, onClose, saved, recordCount,
}: {
  answers: ShopTestAnswers;
  jobName: string;
  screens: number;
  sepScore: number;
  similarity: number | null;
  onChange: (next: ShopTestAnswers) => void;
  onSave: () => void;
  onExport: (format: "json" | "csv") => void;
  onClose: () => void;
  saved: boolean;
  recordCount: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const set = <K extends keyof ShopTestAnswers>(key: K, value: ShopTestAnswers[K]) =>
    onChange({ ...answers, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-6">
      <div className="w-full max-w-xl rounded-lg border border-ink-200 bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold tracking-tight text-ink-900">Test print feedback</h2>
            <p className="tnum mt-0.5 truncate text-[11px] text-ink-400">
              {jobName || "Untitled job"} · {screens} screens · Sep Score {sepScore}
              {similarity !== null ? ` · ${similarity}% match` : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <Choice
            legend="Would you burn these screens?"
            emphasis
            value={answers.wouldBurn}
            options={[
              ["yes", "Yes"],
              ["with-changes", "With changes"],
              ["no", "No"],
            ] as [BurnVerdict, string][]}
            onChange={(v) => set("wouldBurn", v)}
          />

          <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 border-t border-ink-50 pt-3.5">
            <Choice
              legend="Film registration"
              value={answers.registration}
              options={[["good", "Good"], ["needs-adjustment", "Needs adjustment"]] as [RegistrationVerdict, string][]}
              onChange={(v) => set("registration", v)}
            />
            <Choice
              legend="Colour separations"
              value={answers.separations}
              options={[["good", "Good"], ["needs-edits", "Needs edits"]] as [QualityVerdict, string][]}
              onChange={(v) => set("separations", v)}
            />
            <Choice
              legend="Underbase"
              value={answers.underbase}
              options={[
                ["good", "Good"], ["too-heavy", "Too heavy"],
                ["too-light", "Too light"], ["wrong-coverage", "Wrong coverage"],
              ] as [UnderbaseVerdict, string][]}
              onChange={(v) => set("underbase", v)}
            />
            <Choice
              legend="Halftones"
              value={answers.halftones}
              options={[["good", "Good"], ["needs-edits", "Needs edits"]] as [QualityVerdict, string][]}
              onChange={(v) => set("halftones", v)}
            />
            <Choice
              legend="Print order"
              value={answers.printOrder}
              options={[["good", "Good"], ["would-change", "Would change"]] as [OrderVerdict, string][]}
              onChange={(v) => set("printOrder", v)}
            />
            <Choice
              legend="Modified before printing?"
              value={answers.modifiedBeforePrinting}
              options={[[true, "Yes"], [false, "No"]] as [boolean, string][]}
              onChange={(v) => set("modifiedBeforePrinting", v)}
            />
          </div>

          <label className="block border-t border-ink-50 pt-3.5">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              What did you change?
            </span>
            <textarea
              value={answers.whatChanged}
              onChange={(e) => set("whatChanged", e.target.value)}
              rows={2}
              placeholder="Opened the choke to 2px, dropped the cream to 35 LPI…"
              className="ctl w-full rounded px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[10px] text-ink-400">
              The most useful field here — it is where our judgement differed from yours.
            </span>
          </label>

          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            {showAll ? "Hide" : "Show"} time and value questions
          </button>

          {showAll ? (
            <div className="space-y-3.5 border-t border-ink-50 pt-3.5">
              <Choice
                legend="Would this save you time?"
                value={answers.timeSaved}
                options={[["a-lot", "A lot"], ["some", "Some"], ["no", "No"]] as [TimeSaved, string][]}
                onChange={(v) => set("timeSaved", v)}
              />

              <div>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  How long would this normally take you?
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={answers.normalTimeMinutes ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
                      set("normalTimeMinutes", v !== null && Number.isFinite(v) ? v : null);
                    }}
                    placeholder="45"
                    className="ctl h-8 w-24 rounded px-2 text-[13px] tnum outline-none focus:border-accent"
                  />
                  <span className="text-[12px] text-ink-500">minutes</span>
                  <input
                    value={answers.normalTimeNote}
                    onChange={(e) => set("normalTimeNote", e.target.value)}
                    placeholder="or describe it"
                    className="ctl h-8 min-w-0 flex-1 rounded px-2 text-[13px] outline-none focus:border-accent"
                  />
                </div>
              </div>

              <Choice
                legend="Would you pay for a tool like this?"
                value={answers.wouldPay}
                options={[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]] as [WouldPay, string][]}
                onChange={(v) => set("wouldPay", v)}
              />
            </div>
          ) : null}

          <label className="block border-t border-ink-50 pt-3.5">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Notes
            </span>
            <textarea
              value={answers.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              placeholder="Mesh, press, ink, anything else worth remembering."
              className="ctl w-full rounded px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
          </label>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-4">
          <Button variant="primary" onClick={onSave} disabled={!hasAnswers(answers)}>
            Save feedback
          </Button>
          <Button onClick={() => onExport("json")} disabled={recordCount === 0}>Export JSON</Button>
          <Button onClick={() => onExport("csv")} disabled={recordCount === 0}>Export CSV</Button>
          {saved ? <span className="text-[12px] font-medium text-good">Saved</span> : null}
          {recordCount > 0 ? <Pill>{recordCount} recorded</Pill> : null}
          <span className="w-full text-[10px] leading-snug text-ink-400">
            Stored in this browser only. Nothing is uploaded, and no personal information is collected
            beyond what you type here.
          </span>
        </footer>
      </div>
    </div>
  );
}

function Choice<T extends string | boolean>({
  legend, value, options, onChange, emphasis = false,
}: {
  legend: string;
  value: T | null;
  options: [T, string][];
  onChange: (v: T | null) => void;
  emphasis?: boolean;
}) {
  return (
    <fieldset>
      <legend
        className={`mb-1.5 block ${
          emphasis
            ? "text-[13px] font-bold text-ink-900"
            : "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"
        }`}
      >
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            // Clicking the selected option clears it, so a mis-tap is undoable.
            onClick={() => onChange(value === v ? null : v)}
            className={`ctl rounded font-medium ${
              emphasis ? "h-9 px-3.5 text-[13px]" : "h-7 px-2.5 text-[12px]"
            } ${value === v ? "ctl-active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
