"use client";

import type { InkSeparation, SeparationPlan } from "@/lib/types";
import { Pill } from "./primitives";

/**
 * The whole screen list at a glance.
 *
 * Separate from the editable stack because they answer different questions.
 * The stack is for changing one screen; this is for checking the job — which
 * is what an operator does at the burn table, and what a shop owner wants to
 * see when you turn the laptop round. It stays scannable from four screens to
 * eighteen by switching to two columns rather than growing a longer list.
 */
export function ScreenSummary({
  plan, onSelect, selectedId,
}: {
  plan: SeparationPlan;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  const inks = [...plan.inks].sort((a, b) => a.order - b.order);
  // Past a dozen screens a single column runs off the panel; two keeps the
  // whole job in view without changing the layout for ordinary jobs.
  const twoColumn = inks.length >= 10;

  return (
    <section className="border-b border-ink-100 px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          {inks.length} Screen{inks.length === 1 ? "" : "s"}
        </h2>
        <span className="tnum text-[11px] text-ink-400">
          {plan.recommendedScreens} recommended
          {plan.maxScreens ? ` · limit ${plan.maxScreens}` : " · no limit"}
        </span>
      </div>

      <ol className={twoColumn ? "grid grid-cols-2 gap-x-3 gap-y-0.5" : "space-y-0.5"}>
        {inks.map((ink, i) => (
          <ScreenRow
            key={ink.id}
            ink={ink}
            index={i + 1}
            compact={twoColumn}
            selected={selectedId === ink.id}
            onSelect={onSelect}
          />
        ))}
      </ol>
    </section>
  );
}

function ScreenRow({
  ink, index, compact, selected, onSelect,
}: {
  ink: InkSeparation;
  index: number;
  compact: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const halftone = ink.halftone.enabled
    ? `${ink.halftone.lpi} LPI · ${ink.halftone.angle}°`
    : "Solid";

  const body = (
    <>
      <span className="tnum w-4 shrink-0 text-[10px] font-bold text-ink-400">
        {String(index).padStart(2, "0")}
      </span>
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-sm border border-ink-200"
        style={{ background: ink.displayColor }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-900" title={ink.name}>
            {ink.name}
          </span>
          <span className="tnum shrink-0 text-[10px] text-ink-400">
            {(ink.coverage * 100).toFixed(0)}%
          </span>
        </span>
        <span className="tnum block truncate text-[10px] text-ink-400">
          {ink.mesh} · {halftone}
        </span>
      </span>
    </>
  );

  const className = `flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left ${
    selected ? "bg-accent-soft" : onSelect ? "hover:bg-ink-50" : ""
  }`;

  return (
    <li className={compact ? "min-w-0" : ""}>
      {onSelect ? (
        <button type="button" onClick={() => onSelect(ink.id)} className={className} title={`Isolate ${ink.name}`}>
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

/** Job-level facts, for the review surface and the demo flow. */
export function JobFacts({
  plan, similarity, sepScore, verdict, warningCount, garmentColor, dark = false,
}: {
  plan: SeparationPlan;
  similarity: number | null;
  sepScore: number;
  verdict: string;
  warningCount: number;
  garmentColor: string;
  dark?: boolean;
}) {
  const facts: [string, string][] = [
    ["Screens", String(plan.inks.length)],
    ["Recommended", String(plan.recommendedScreens)],
    ["Limit", plan.maxScreens ? String(plan.maxScreens) : "None"],
    ["Garment", garmentColor.toUpperCase()],
    ...(similarity !== null ? ([["Similarity", `${similarity}%`]] as [string, string][]) : []),
    ["Sep Score", `${sepScore}`],
  ];

  const labelClass = dark ? "text-ink-400" : "text-ink-400";
  const valueClass = dark ? "text-white" : "text-ink-900";

  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt className={`text-[10px] uppercase tracking-[0.06em] ${labelClass}`}>{k}</dt>
          <dd className={`tnum text-[13px] font-semibold ${valueClass}`}>{v}</dd>
        </div>
      ))}
      <div>
        <dt className={`text-[10px] uppercase tracking-[0.06em] ${labelClass}`}>Verdict</dt>
        <dd className="mt-0.5">
          <Pill tone={sepScore >= 88 ? "good" : sepScore >= 72 ? "warn" : "bad"}>{verdict}</Pill>
        </dd>
      </div>
      <div>
        <dt className={`text-[10px] uppercase tracking-[0.06em] ${labelClass}`}>Warnings</dt>
        <dd className="mt-0.5">
          {warningCount === 0 ? (
            <Pill tone="good">None</Pill>
          ) : (
            <Pill tone="warn">{warningCount}</Pill>
          )}
        </dd>
      </div>
    </dl>
  );
}
