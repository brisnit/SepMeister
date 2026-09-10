"use client";

import type { InkSeparation } from "@/lib/types";
import { suggestPrintOrder } from "@/lib/engine/printOrder";
import { Button } from "./primitives";

/**
 * Recommended print order.
 *
 * Offered, never imposed. Shops sequence differently depending on press, ink,
 * flash position and habit, and once the artist reorders, their order is what
 * films and paperwork use.
 */
export function PrintOrderPanel({
  inks, onApply,
}: {
  inks: InkSeparation[];
  onApply: (order: string[]) => void;
}) {
  const suggestion = suggestPrintOrder(inks);
  const byId = new Map(inks.map((i) => [i.id, i]));

  return (
    <section className="border-b border-ink-100 px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Recommended Print Order
        </h2>
        {suggestion.matchesCurrent ? (
          <span className="text-[10px] font-medium text-good">In use</span>
        ) : (
          <Button size="sm" onClick={() => onApply(suggestion.order)}>Apply</Button>
        )}
      </div>

      <ol className="space-y-0.5">
        {suggestion.order.map((id, i) => {
          const ink = byId.get(id);
          if (!ink) return null;
          const currentPosition = ink.order + 1;
          const moved = currentPosition !== i + 1;
          return (
            <li key={id} className="flex items-center gap-1.5">
              <span className="tnum w-4 text-[10px] font-semibold text-ink-400">{i + 1}</span>
              <span
                className="h-3 w-3 shrink-0 rounded-sm border border-ink-200"
                style={{ background: ink.displayColor }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-700">{ink.name}</span>
              {moved ? (
                <span className="tnum shrink-0 text-[10px] text-ink-400" title="Current position">
                  now {currentPosition}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-[11px] leading-snug text-ink-400">{suggestion.reasoning}</p>
    </section>
  );
}
