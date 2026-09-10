"use client";

import type { QAResult } from "@/lib/types";
import { InfoTip, ScoreDial } from "./primitives";

export function SepScorePanel({ qa, similarity }: { qa: QAResult; similarity: number | null }) {
  return (
    <section className="border-b border-ink-100 px-3 py-3">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Sep Score</h2>
        <InfoTip text="A heuristic pre-press read built from common screen-print failure modes. It is not a model trained on production outcomes — treat it as a checklist that points you at what to inspect, not a guarantee." />
      </div>

      <ScoreDial score={qa.score} verdict={qa.verdict} />

      <dl className="mt-3.5 space-y-1.5">
        {qa.subscores.map((s) => (
          <div key={s.key}>
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-[12px] text-ink-600">
                {s.label}
                <InfoTip text={s.tooltip} />
              </dt>
              <dd className="tnum text-[12px] font-semibold text-ink-900">{s.score}</dd>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className={`h-full rounded-full ${
                  s.score >= 85 ? "bg-good" : s.score >= 65 ? "bg-warn" : "bg-bad"
                }`}
                style={{ width: `${Math.max(2, s.score)}%` }}
              />
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{s.detail}</p>
          </div>
        ))}
      </dl>

      {similarity !== null ? (
        <div className="mt-3 flex items-baseline justify-between border-t border-ink-50 pt-2.5">
          <span className="flex items-center gap-1.5 text-[12px] text-ink-600">
            Digital separation similarity
            <InfoTip text="How closely the composited separations reproduce the original artwork as pixels — mean CIEDE2000 color error blended with structural similarity. It does not predict how the physical print will look." />
          </span>
          <span className="tnum text-[13px] font-bold text-ink-900">{similarity}%</span>
        </div>
      ) : null}

      {qa.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-ink-50 pt-2.5">
          {qa.warnings.map((w) => (
            <li key={w} className="flex gap-1.5 text-[11px] leading-snug text-ink-500">
              <span aria-hidden className="text-warn">▲</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
