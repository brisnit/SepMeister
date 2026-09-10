"use client";

import { useState } from "react";
import type { FeedbackOutcome, FeedbackRecord } from "@/lib/types";
import { Button } from "./primitives";

const OUTCOMES: { value: FeedbackOutcome; label: string; tone: string }[] = [
  { value: "excellent", label: "Excellent", tone: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  { value: "good", label: "Good", tone: "border-emerald-200 bg-emerald-50/60 text-emerald-800" },
  { value: "needs-adjustment", label: "Needs adjustment", tone: "border-amber-300 bg-amber-50 text-amber-900" },
  { value: "failed", label: "Failed", tone: "border-red-300 bg-red-50 text-red-900" },
];

const QUESTIONS: { key: keyof FeedbackRecord; label: string }[] = [
  { key: "filmsRegistered", label: "Did the films register correctly?" },
  { key: "underbasePrinted", label: "Did the underbase print correctly?" },
  { key: "detailHeld", label: "Did tonal detail hold?" },
  { key: "colorsClose", label: "Were colors close to expectation?" },
  { key: "changedAnything", label: "Did you change anything before printing?" },
];

/**
 * Test-print feedback.
 *
 * The operator's changes are the most valuable field here: whatever a working
 * separator adjusts before burning screens is precisely where the engine's
 * judgement diverged from a professional's, and that is invisible unless
 * someone writes it down while it is fresh.
 */
export function FeedbackPanel({
  existing, onSubmit, onExport, onClose, recordCount,
}: {
  existing: FeedbackRecord | null;
  onSubmit: (data: {
    outcome: FeedbackOutcome;
    answers: Record<string, boolean | null>;
    whatChanged: string;
    notes: string;
  }) => void;
  onExport: () => void;
  onClose: () => void;
  recordCount: number;
}) {
  const [outcome, setOutcome] = useState<FeedbackOutcome | null>(existing?.outcome ?? null);
  const [answers, setAnswers] = useState<Record<string, boolean | null>>(() => {
    const seed: Record<string, boolean | null> = {};
    for (const q of QUESTIONS) {
      seed[q.key as string] = existing ? ((existing[q.key] as boolean | null) ?? null) : null;
    }
    return seed;
  });
  const [whatChanged, setWhatChanged] = useState(existing?.whatChanged ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saved, setSaved] = useState(false);

  const submit = () => {
    if (!outcome) return;
    onSubmit({ outcome, answers, whatChanged, notes });
    setSaved(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-6">
      <div className="w-full max-w-lg rounded-lg border border-ink-200 bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-ink-900">Test print feedback</h2>
            <p className="mt-0.5 text-[11px] text-ink-400">
              Recorded in this browser. Nothing is uploaded.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <fieldset>
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Overall result
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={outcome === o.value}
                  onClick={() => { setOutcome(o.value); setSaved(false); }}
                  className={`h-8 rounded border px-3 text-[12px] font-semibold transition-colors ${
                    outcome === o.value ? o.tone : "border-ink-200 bg-surface text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            {QUESTIONS.map((q) => (
              <div key={q.key as string} className="flex items-center justify-between gap-3 border-b border-ink-50 py-1.5">
                <span className="text-[12px] text-ink-700">{q.label}</span>
                <div className="flex shrink-0 gap-1">
                  {([["Yes", true], ["No", false]] as [string, boolean][]).map(([label, val]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={answers[q.key as string] === val}
                      onClick={() => {
                        setAnswers((a) => ({ ...a, [q.key as string]: a[q.key as string] === val ? null : val }));
                        setSaved(false);
                      }}
                      className={`ctl h-7 w-11 rounded text-[12px] font-medium ${
                        answers[q.key as string] === val ? "ctl-active" : ""
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              What did you change?
            </span>
            <textarea
              value={whatChanged}
              onChange={(e) => { setWhatChanged(e.target.value); setSaved(false); }}
              rows={3}
              placeholder="Opened the choke to 2px, dropped the cream to 35 LPI…"
              className="ctl w-full rounded px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
              rows={3}
              placeholder="Mesh, press, ink, anything else worth remembering."
              className="ctl w-full rounded px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
          </label>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-4">
          <Button variant="primary" onClick={submit} disabled={!outcome}>
            {existing ? "Update feedback" : "Save feedback"}
          </Button>
          <Button onClick={onExport} disabled={recordCount === 0}>
            Export feedback JSON{recordCount > 0 ? ` (${recordCount})` : ""}
          </Button>
          {saved ? <span className="text-[12px] font-medium text-good">Saved</span> : null}
          {!outcome ? <span className="text-[11px] text-ink-400">Pick an overall result to save.</span> : null}
        </footer>
      </div>
    </div>
  );
}
