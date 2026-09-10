"use client";

import type { SeparationPlan } from "@/lib/types";
import { Button, Pill } from "./primitives";

export type DemoStep =
  | "screens"
  | "underbase"
  | "halftones"
  | "order"
  | "qa"
  | "download";

export interface DemoStepDef {
  id: DemoStep;
  label: string;
  /** What to say while standing at the press. */
  blurb: string;
}

/**
 * The order a separation is actually reviewed in, before anyone commits film.
 *
 * Demo mode does not change engine behaviour or hide controls — it just walks
 * this sequence and keeps the next action obvious. Everything in the panels
 * stays exactly where it was, because the point of the demo is to show the
 * real tool, not a simplified copy of it.
 */
export const DEMO_STEPS: DemoStepDef[] = [
  {
    id: "screens",
    label: "Screens",
    blurb: "Which inks the artwork actually needs, and what each one costs in coverage.",
  },
  {
    id: "underbase",
    label: "Underbase",
    blurb: "Overlay the base on the original — look for white creeping past the colours.",
  },
  {
    id: "halftones",
    label: "Halftones",
    blurb: "Per-screen mesh, line count and angle. Unsafe combinations flag with a one-click fix.",
  },
  {
    id: "order",
    label: "Print order",
    blurb: "Base first, light to dark, detail black last. Reorder if your press wants otherwise.",
  },
  {
    id: "qa",
    label: "Film QA",
    blurb: "Nine checks run against the real films before anything downloads.",
  },
  {
    id: "download",
    label: "Download",
    blurb: "Registration-matched films, a proof, a production sheet and a job manifest.",
  },
];

/**
 * A step rail for walking a shop through a separation.
 *
 * Deliberately a rail rather than a wizard: it does not gate anything, so a
 * separator can jump straight to what they care about — which, in front of a
 * real printer, is usually the underbase.
 */
export function DemoRail({
  step, plan, similarity, sepScore, warningCount, onStep, onExit, onOpenQa, onOpenReview,
}: {
  step: DemoStep;
  plan: SeparationPlan;
  similarity: number | null;
  sepScore: number;
  warningCount: number;
  onStep: (s: DemoStep) => void;
  onExit: () => void;
  onOpenQa: () => void;
  onOpenReview: () => void;
}) {
  const index = DEMO_STEPS.findIndex((s) => s.id === step);
  const current = DEMO_STEPS[index] ?? DEMO_STEPS[0];
  const next = DEMO_STEPS[index + 1] ?? null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-ink-100 bg-accent-soft px-4 py-2">
      <Pill tone="accent">Shop test</Pill>

      <ol className="flex items-center gap-1">
        {DEMO_STEPS.map((s, i) => {
          const active = s.id === step;
          const done = i < index;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                onClick={() => onStep(s.id)}
                className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : done
                      ? "text-ink-600 hover:bg-white"
                      : "text-ink-500 hover:bg-white"
                }`}
              >
                <span className={`tnum text-[10px] font-bold ${active ? "text-white/70" : "text-ink-400"}`}>
                  {i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="min-w-0 flex-1 truncate text-[12px] text-ink-600">{current.blurb}</p>

      <div className="flex shrink-0 items-center gap-3">
        <dl className="flex items-center gap-3.5">
          {([
            ["Screens", String(plan.inks.length)],
            ...(similarity !== null ? ([["Match", `${similarity}%`]] as [string, string][]) : []),
            ["Score", String(sepScore)],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[9px] uppercase tracking-[0.06em] text-ink-400">{k}</dt>
              <dd className="tnum text-[12px] font-bold text-ink-900">{v}</dd>
            </div>
          ))}
          {warningCount > 0 ? <Pill tone="warn">{warningCount}</Pill> : <Pill tone="good">Clean</Pill>}
        </dl>

        <Button size="sm" onClick={onOpenReview}>Before / after</Button>

        {next ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (next.id === "qa" || next.id === "download") onOpenQa();
              else onStep(next.id);
            }}
          >
            {next.label} →
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onOpenQa}>Output check</Button>
        )}

        <button type="button" onClick={onExit} className="text-[11px] text-ink-500 underline hover:text-ink-900">
          Exit
        </button>
      </div>
    </div>
  );
}
