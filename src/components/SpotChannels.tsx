"use client";

import type { InkSeparation, SeparationPlan, UnderbaseRelationship } from "@/lib/types";
import { Button, Pill } from "./primitives";

export type ChannelRender = "ink" | "mask" | "film";

/**
 * The plate list, the way a separator thinks about a job.
 *
 * Borrows the mental model of channels without borrowing anyone's interface:
 * a named list of physical inks, each of which can be shown, hidden, soloed
 * and inspected. The render mode is deliberately explicit rather than implied,
 * because mask and film are inverses of each other and mistaking one for the
 * other means burning a screen backwards.
 */
export function SpotChannels({
  plan, render, soloId, selectedId, onRender, onSolo, onSelect, onToggle,
  onUnderbaseRelationship, onReorder, underbaseBusy,
}: {
  plan: SeparationPlan;
  render: ChannelRender;
  soloId: string | null;
  selectedId: string | null;
  onRender: (r: ChannelRender) => void;
  onSolo: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onUnderbaseRelationship: (id: string, rel: UnderbaseRelationship) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
  underbaseBusy: boolean;
}) {
  const inks = [...plan.inks].sort((a, b) => a.order - b.order);
  const hasBase = inks.some((i) => i.type === "underbase");

  return (
    <section className="border-b border-ink-100">
      <div className="flex items-center justify-between gap-2 border-b border-ink-50 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Spot Channels</h2>
        <span className="tnum text-[11px] text-ink-400">{inks.length} plates</span>
      </div>

      <div className="border-b border-ink-50 px-3 py-2">
        <div className="flex gap-1" role="group" aria-label="Channel rendering">
          {([
            ["ink", "Ink"],
            ["mask", "Mask"],
            ["film", "Film"],
          ] as [ChannelRender, string][]).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={render === v}
              onClick={() => onRender(v)}
              className={`ctl h-7 flex-1 rounded px-2 text-[11px] font-medium ${render === v ? "ctl-active" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
          {render === "ink"
            ? "The ink as it prints on the garment."
            : render === "mask"
              ? "Mask: white is 100% ink, black is none."
              : "Film positive: black blocks exposure, clear passes it — the inverse of the mask."}
        </p>
      </div>

      <ul>
        {inks.map((ink, i) => {
          const soloed = soloId === ink.id;
          const dimmed = soloId !== null && !soloed;
          return (
            <li
              key={ink.id}
              className={`border-b border-ink-50 ${selectedId === ink.id ? "bg-accent-soft" : ""} ${dimmed ? "opacity-45" : ""}`}
            >
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <button
                  type="button"
                  aria-label={`${ink.visible ? "Hide" : "Show"} ${ink.name}`}
                  aria-pressed={ink.visible}
                  onClick={() => onToggle(ink.id)}
                  className={`shrink-0 rounded px-1 py-0.5 text-[11px] ${ink.visible ? "text-ink-700" : "text-ink-300"}`}
                  title={ink.visible ? "Hide plate" : "Show plate"}
                >
                  {ink.visible ? "◉" : "○"}
                </button>

                <button
                  type="button"
                  onClick={() => onSelect(selectedId === ink.id ? null : ink.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={`Inspect ${ink.name}`}
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded-sm border border-ink-200"
                    style={{ background: ink.displayColor }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="tnum text-[10px] font-bold text-ink-400">{String(i + 1).padStart(2, "0")}</span>
                      <span className="truncate text-[12px] font-semibold uppercase tracking-wide text-ink-900">
                        {ink.name}
                      </span>
                      <span className="tnum ml-auto shrink-0 text-[10px] text-ink-400">
                        {(ink.coverage * 100).toFixed(0)}%
                      </span>
                    </span>
                    <span className="tnum block truncate text-[10px] text-ink-400">
                      {ink.mesh} mesh ·{" "}
                      {ink.halftone.enabled ? `${ink.halftone.lpi} LPI · ${ink.halftone.angle}°` : "solid"}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  aria-pressed={soloed}
                  onClick={() => onSolo(soloed ? null : ink.id)}
                  title={soloed ? "Show all plates" : "Solo this plate"}
                  className={`ctl shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${soloed ? "ctl-active" : ""}`}
                >
                  S
                </button>

                <span className="flex shrink-0 flex-col">
                  <button
                    type="button" onClick={() => onReorder(ink.id, -1)} disabled={i === 0}
                    title="Print earlier"
                    className="px-1 text-[9px] leading-none text-ink-400 hover:text-ink-800 disabled:opacity-25"
                  >▲</button>
                  <button
                    type="button" onClick={() => onReorder(ink.id, 1)} disabled={i === inks.length - 1}
                    title="Print later"
                    className="px-1 text-[9px] leading-none text-ink-400 hover:text-ink-800 disabled:opacity-25"
                  >▼</button>
                </span>
              </div>

              {hasBase && ink.type !== "underbase" ? (
                <div className="flex items-center gap-1.5 px-3 pb-1.5 pl-9">
                  <span className="text-[10px] uppercase tracking-[0.06em] text-ink-400">Base</span>
                  {([
                    ["full", "Full"],
                    ["reduced", "Reduced"],
                    ["none", "None"],
                  ] as [UnderbaseRelationship, string][]).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={ink.underbase === v}
                      disabled={underbaseBusy}
                      onClick={() => onUnderbaseRelationship(ink.id, v)}
                      className={`ctl h-5 rounded px-1.5 text-[10px] font-medium disabled:opacity-50 ${
                        ink.underbase === v ? "ctl-active" : ""
                      }`}
                      title={`${label} underbase beneath ${ink.name}`}
                    >
                      {label}
                    </button>
                  ))}
                  {ink.underbase === "none" ? (
                    <span className="ml-auto"><Pill>No white</Pill></span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Underbase-wide controls, separate because the base is not just another ink. */
export function UnderbaseActions({
  base, busy, onRemove, onRegenerate,
}: {
  base: InkSeparation | null;
  busy: boolean;
  onRemove: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Underbase</span>
      {base ? (
        <span className="tnum text-[11px] text-ink-400">{(base.coverage * 100).toFixed(1)}%</span>
      ) : (
        <span className="text-[11px] text-ink-400">None</span>
      )}
      <span className="ml-auto flex gap-1.5">
        <Button size="sm" onClick={onRegenerate} disabled={busy}>
          {base ? "Regenerate" : "Generate"}
        </Button>
        {base ? (
          <Button size="sm" variant="danger" onClick={onRemove} disabled={busy}>Remove</Button>
        ) : null}
      </span>
    </div>
  );
}
