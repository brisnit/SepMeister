"use client";

import type { InspectionResult } from "@/lib/spot/inspect";
import { formatCoverage, formatScreening } from "@/lib/spot/inspect";
import { Pill } from "./primitives";

/**
 * What is printing at one point.
 *
 * Reads "Ink coverage" rather than "opacity" everywhere, and that distinction
 * is load-bearing. Coverage is the area fraction the screen lays ink over,
 * which this genuinely knows. How opaque the result is depends on ink, mesh,
 * deposit and garment — none of which is modelled here, so claiming it would
 * be inviting a separator to trust a number nobody computed.
 */
export function CoverageReadout({
  result, empty,
}: {
  result: InspectionResult | null;
  empty?: string;
}) {
  if (!result) {
    return (
      <div className="flex h-full items-center px-3 py-2">
        <p className="text-[11px] text-ink-400">{empty ?? "Hover the artwork to inspect ink coverage."}</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Ink coverage</h3>
        <span className="tnum text-[11px] text-ink-400">{result.x}, {result.y}</span>
        {result.totalCoverage > 1.001 ? (
          <span className="ml-auto">
            <Pill tone="warn">{Math.round(result.totalCoverage * 100)}% total</Pill>
          </span>
        ) : null}
      </div>

      {result.bare ? (
        <p className="text-[12px] text-ink-500">
          No ink here — the garment shows through.
        </p>
      ) : (
        <ul className="space-y-1">
          {result.inks.map((ink) => (
            <li key={ink.inkId} className="flex items-start gap-2">
              <span
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border border-ink-200"
                style={{ background: ink.displayColor }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[12px] font-semibold uppercase tracking-wide text-ink-900">
                    {ink.name}
                  </span>
                  <span className="tnum ml-auto shrink-0 text-[13px] font-bold text-ink-900">
                    {formatCoverage(ink)}
                  </span>
                </span>
                <span className="tnum block text-[10px] text-ink-400">
                  Mask {ink.mask} / 255 · {formatScreening(ink)}
                  {ink.expectedDotArea !== null && ink.halftone.enabled
                    ? ` · dot ${Math.round(ink.expectedDotArea * 100)}%`
                    : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
        Coverage is the area the screen lays ink over, before screening. It is not a prediction of how
        opaque the printed ink will be.
      </p>
    </div>
  );
}
