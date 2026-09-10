"use client";

import { useState } from "react";
import { SUGGESTED_COMMANDS, type OperationResult } from "@/lib/ai/operations";
import { Button, Pill } from "./primitives";

/**
 * Natural-language command bar.
 *
 * Everything here runs against the local deterministic parser. It is labelled
 * as such rather than implying a hosted model, and it converts language into
 * structured operations that the engine executes -- it never edits pixels.
 */
export function CommandBar({
  onRun, busy, lastResult,
}: {
  onRun: (input: string) => void;
  busy: boolean;
  lastResult: (OperationResult & { input: string }) | null;
}) {
  const [value, setValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    onRun(text);
    setValue("");
    setShowSuggestions(false);
  };

  return (
    <section className="border-t border-ink-100 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Ask Sep AI</h2>
        <Pill>Local · deterministic</Pill>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(value); }}
        className="flex gap-1.5"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          placeholder="Reduce this to 5 screens…"
          disabled={busy}
          className="ctl h-8 min-w-0 flex-1 rounded px-2.5 text-[12px] outline-none focus:border-accent disabled:opacity-60"
        />
        <Button type="submit" size="sm" variant="primary" disabled={busy || !value.trim()}>Run</Button>
      </form>

      {showSuggestions && !value ? (
        <ul className="mt-2 space-y-1">
          {SUGGESTED_COMMANDS.map((c) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => submit(c)}
                disabled={busy}
                className="w-full rounded px-1.5 py-1 text-left text-[11px] text-ink-500 hover:bg-ink-50 hover:text-ink-900 disabled:opacity-50"
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {lastResult ? (
        <div
          className={`mt-2.5 rounded border px-2.5 py-2 text-[11px] leading-relaxed ${
            lastResult.understood
              ? "border-accent-border bg-accent-soft text-ink-700"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <p className="mb-0.5 font-semibold text-ink-900">&ldquo;{lastResult.input}&rdquo;</p>
          <p>{lastResult.explanation}</p>
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-snug text-ink-400">
        Commands become structured operations the deterministic engine executes. Sep AI never edits pixels directly.
      </p>
    </section>
  );
}
