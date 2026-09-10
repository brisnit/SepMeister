"use client";

import { useState } from "react";
import type { InkHalftone, InkSeparation } from "@/lib/types";
import { COMMON_MESH_COUNTS } from "@/lib/engine/halftone";
import { Button, Slider } from "./primitives";
import { HalftoneControls } from "./HalftoneControls";

const ROLE_LABEL: Record<string, string> = {
  underbase: "Base",
  spot: "Spot",
  black: "Black",
  highlight: "Highlight",
};

/** "230 mesh · 45 LPI · 52.5°" or "230 mesh · solid". */
export function describeInkOutput(ink: InkSeparation): string {
  const mesh = `${ink.mesh} mesh`;
  if (!ink.halftone.enabled) return `${mesh} · solid`;
  return `${mesh} · ${ink.halftone.lpi} LPI · ${ink.halftone.angle}°`;
}

export function SeparationStack({
  inks, selectedId, onSelect, onToggle, onUpdate, onRemove, onMerge, onReorder, dpi, filmDpi,
}: {
  inks: InkSeparation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: Partial<InkSeparation>) => void;
  onRemove: (id: string) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
  dpi: number;
  filmDpi: number;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-ink-100 bg-surface px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Separations</h2>
        <span className="tnum text-[11px] text-ink-400">{inks.length} screens</span>
      </div>

      <ul>
        {inks.map((ink, i) => {
          const selected = selectedId === ink.id;
          const menuOpen = openMenu === ink.id;
          return (
            <li key={ink.id} className={`border-b border-ink-50 ${selected ? "bg-accent-soft" : ""}`}>
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={ink.visible}
                  onChange={() => onToggle(ink.id)}
                  aria-label={`Toggle ${ink.name}`}
                  className="h-3.5 w-3.5 shrink-0 accent-[#5d5fef]"
                />
                <button
                  type="button"
                  onClick={() => onSelect(selected ? null : ink.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={selected ? "Show all separations" : `Isolate ${ink.name}`}
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded-sm border border-ink-200"
                    style={{ background: ink.displayColor }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="tnum text-[10px] font-semibold text-ink-400">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="truncate text-[13px] font-semibold uppercase tracking-wide text-ink-900">
                        {ink.name}
                      </span>
                      <span className="tnum ml-auto shrink-0 text-[11px] text-ink-500">
                        {(ink.coverage * 100).toFixed(1)}%
                      </span>
                    </span>
                    <span className="tnum mt-0.5 block truncate text-[11px] text-ink-400">
                      {describeInkOutput(ink)}
                      <span className="ml-1.5 text-ink-300">· {ROLE_LABEL[ink.type] ?? ink.type}</span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Options for ${ink.name}`}
                  aria-expanded={menuOpen}
                  onClick={() => setOpenMenu(menuOpen ? null : ink.id)}
                  className={`shrink-0 rounded px-1.5 py-1 hover:bg-ink-100 hover:text-ink-700 ${
                    menuOpen ? "bg-ink-100 text-ink-700" : "text-ink-400"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <circle cx="6" cy="2" r="1.2" fill="currentColor" />
                    <circle cx="6" cy="6" r="1.2" fill="currentColor" />
                    <circle cx="6" cy="10" r="1.2" fill="currentColor" />
                  </svg>
                </button>
              </div>

              {menuOpen ? (
                <InkEditor
                  ink={ink}
                  others={inks.filter((o) => o.id !== ink.id)}
                  dpi={dpi}
                  filmDpi={filmDpi}
                  isFirst={i === 0}
                  isLast={i === inks.length - 1}
                  onUpdate={(patch) => onUpdate(ink.id, patch)}
                  onRemove={() => { setOpenMenu(null); onRemove(ink.id); }}
                  onMerge={(targetId) => { setOpenMenu(null); onMerge(ink.id, targetId); }}
                  onReorder={(d) => onReorder(ink.id, d)}
                  onClose={() => setOpenMenu(null)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InkEditor({
  ink, others, dpi, filmDpi, isFirst, isLast, onUpdate, onRemove, onMerge, onReorder, onClose,
}: {
  ink: InkSeparation;
  others: InkSeparation[];
  dpi: number;
  filmDpi: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<InkSeparation>) => void;
  onRemove: () => void;
  onMerge: (targetId: string) => void;
  onReorder: (direction: -1 | 1) => void;
  onClose: () => void;
}) {
  const s = ink.settings;
  const patchSettings = (p: Partial<typeof s>) => onUpdate({ settings: { ...s, ...p } });
  const patchHalftone = (h: InkHalftone) => onUpdate({ halftone: h });
  const pxPerUnit = dpi / 300;

  return (
    <div className="space-y-3.5 border-t border-ink-100 bg-surface px-3 py-3">
      <div className="flex gap-2">
        <input
          value={ink.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          aria-label="Separation name"
          className="ctl h-7 min-w-0 flex-1 rounded px-2 text-[12px] outline-none focus:border-accent"
        />
        <label
          className="ctl flex h-7 w-9 shrink-0 cursor-pointer items-center justify-center rounded"
          title="Assigned ink color (film output stays black)"
        >
          <span className="h-4 w-4 rounded-sm border border-ink-200" style={{ background: ink.displayColor }} />
          <input
            type="color"
            className="sr-only"
            value={ink.displayColor}
            onChange={(e) => onUpdate({ displayColor: e.target.value })}
          />
        </label>
      </div>

      <div>
        <label htmlFor={`mesh-${ink.id}`} className="mb-1.5 block text-[12px] font-medium text-ink-600">Mesh</label>
        <select
          id={`mesh-${ink.id}`}
          value={ink.mesh}
          onChange={(e) => onUpdate({ mesh: parseInt(e.target.value, 10) })}
          className="ctl h-7 w-full rounded px-2 text-[12px] outline-none focus:border-accent"
        >
          {COMMON_MESH_COUNTS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <HalftoneControls
        halftone={ink.halftone}
        mesh={ink.mesh}
        filmDpi={filmDpi}
        onChange={patchHalftone}
        onMesh={(mesh) => onUpdate({ mesh })}
      />

      <div className="space-y-3 border-t border-ink-50 pt-3">
        <Slider
          label="Threshold" value={s.threshold} min={0} max={200} step={1}
          onChange={(v) => patchSettings({ threshold: v })}
          format={(v) => (v === 0 ? "off" : String(v))}
          hint="Drops coverage below this level, then rescales the rest so tone is preserved."
        />
        <Slider
          label="Coverage" value={s.gain} min={0.4} max={2} step={0.05}
          onChange={(v) => patchSettings({ gain: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Choke" value={s.choke} min={0} max={4} step={0.5}
          onChange={(v) => patchSettings({ choke: v })}
          format={(v) => (v === 0 ? "none" : `${v}px`)}
          hint={`Pulls ink in by ${(s.choke * pxPerUnit).toFixed(1)}px at ${Math.round(dpi)} DPI.`}
        />
        <Slider
          label="Spread" value={s.spread} min={0} max={4} step={0.5}
          onChange={(v) => patchSettings({ spread: v })}
          format={(v) => (v === 0 ? "none" : `${v}px`)}
          hint="Pushes ink out to trap against the neighbouring screen."
        />
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-ink-50 pt-3">
        <Button size="sm" onClick={() => onReorder(-1)} disabled={isFirst} title="Print earlier">↑</Button>
        <Button size="sm" onClick={() => onReorder(1)} disabled={isLast} title="Print later">↓</Button>
        {others.length > 0 ? (
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) onMerge(e.target.value); }}
            className="ctl h-7 rounded px-1.5 text-[12px] outline-none focus:border-accent"
            aria-label={`Merge ${ink.name} into another separation`}
          >
            <option value="">Merge into…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : null}
        <Button size="sm" variant="danger" onClick={onRemove}>Remove</Button>
        <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">Done</Button>
      </div>

      {ink.note ? (
        <p className="border-t border-ink-50 pt-2.5 text-[11px] leading-snug text-ink-400">{ink.note}</p>
      ) : null}
    </div>
  );
}
