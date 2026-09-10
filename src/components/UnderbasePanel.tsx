"use client";

import type { InkSeparation } from "@/lib/types";
import { Button, Slider } from "./primitives";

export type UnderbaseView = "off" | "white" | "film" | "overlay";

/**
 * The underbase gets its own controls because it is not just another ink.
 *
 * It is the foundation every colour above it sits on, it is the screen most
 * likely to be wrong, and its failure modes are specific: too much and white
 * halos around the design, too little and the garment shows through the
 * colours. The overlay view exists so a separator can check that judgement
 * against the original artwork directly, which is the first thing an
 * experienced printer will want to look at.
 */
export function UnderbasePanel({
  base, choke, strength, removeUnderBlack, highlightWhite, view, dpi, busy,
  onChange, onView, onRebuild, onUpdateInk,
}: {
  base: InkSeparation | null;
  choke: number;
  strength: number;
  removeUnderBlack: boolean;
  highlightWhite: boolean;
  view: UnderbaseView;
  dpi: number;
  busy: boolean;
  onChange: (patch: { choke?: number; strength?: number; removeUnderBlack?: boolean; highlightWhite?: boolean }) => void;
  onView: (v: UnderbaseView) => void;
  onRebuild: () => void;
  onUpdateInk: (patch: Partial<InkSeparation>) => void;
}) {
  if (!base) {
    return (
      <section className="border-b border-ink-100 px-3 py-3">
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Underbase</h2>
        <p className="text-[11px] leading-snug text-ink-400">
          No underbase — the garment is light enough for the inks to read directly.
        </p>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] text-ink-700">
          <input
            type="checkbox" checked={highlightWhite} className="mt-0.5 h-3.5 w-3.5 accent-[#5d5fef]"
            onChange={(e) => onChange({ highlightWhite: e.target.checked })}
          />
          <span>Dedicated highlight white <span className="text-ink-400">(uses a screen)</span></span>
        </label>
      </section>
    );
  }

  const views: [UnderbaseView, string][] = [
    ["off", "Hide"],
    ["white", "White ink"],
    ["film", "Film"],
    ["overlay", "Overlay"],
  ];

  return (
    <section className="border-b border-ink-100 px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Underbase</h2>
        <span className="tnum text-[11px] text-ink-400">{(base.coverage * 100).toFixed(1)}%</span>
      </div>

      <div className="mb-3 flex gap-1" role="group" aria-label="Underbase preview">
        {views.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onView(v)}
            className={`ctl h-7 flex-1 rounded px-1.5 text-[11px] font-medium ${view === v ? "ctl-active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "overlay" ? (
        <p className="mb-3 rounded border border-accent-border bg-accent-soft px-2 py-1.5 text-[11px] leading-snug text-ink-600">
          The base is drawn over the original artwork. Look for white creeping past the edges of the colours,
          and for gaps where a colour has no base under it.
        </p>
      ) : null}

      <div className="space-y-3">
        <Slider
          label="Choke" value={choke} min={0} max={4} step={0.5}
          onChange={(v) => onChange({ choke: v })}
          format={(v) => (v === 0 ? "none" : `${v}px`)}
          hint={`Pulls the base in ${(choke * (dpi / 300)).toFixed(1)}px at ${Math.round(dpi)} DPI, so it hides under the colours.`}
        />
        <Slider
          label="Strength" value={strength} min={0.4} max={1} step={0.05}
          onChange={(v) => onChange({ strength: v })}
          format={(v) => `${Math.round(v * 100)}%`}
          hint="Lower lays down less white for a softer hand, at the cost of opacity."
        />
        <Slider
          label="Threshold" value={base.settings.threshold} min={0} max={200} step={1}
          onChange={(v) => onUpdateInk({ settings: { ...base.settings, threshold: v } })}
          format={(v) => (v === 0 ? "off" : String(v))}
          hint="Drops the faintest base coverage, which is usually antialiasing fringe."
        />

        <label className="flex cursor-pointer items-start gap-2 text-[12px] text-ink-700">
          <input
            type="checkbox" checked={removeUnderBlack} className="mt-0.5 h-3.5 w-3.5 accent-[#5d5fef]"
            onChange={(e) => onChange({ removeUnderBlack: e.target.checked })}
          />
          <span>Remove base under black <span className="text-ink-400">— black covers unaided</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-[12px] text-ink-700">
          <input
            type="checkbox" checked={highlightWhite} className="mt-0.5 h-3.5 w-3.5 accent-[#5d5fef]"
            onChange={(e) => onChange({ highlightWhite: e.target.checked })}
          />
          <span>Dedicated highlight white <span className="text-ink-400">(uses a screen)</span></span>
        </label>

        <Button size="sm" onClick={onRebuild} disabled={busy} className="w-full">
          {busy ? "Rebuilding…" : "Rebuild separation"}
        </Button>
      </div>

      {base.note ? (
        <p className="mt-2 border-t border-ink-50 pt-2 text-[11px] leading-snug text-ink-400">{base.note}</p>
      ) : null}
    </section>
  );
}
