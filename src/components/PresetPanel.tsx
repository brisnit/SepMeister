"use client";

import { useState } from "react";
import type { PressPreset } from "@/lib/types";
import { Button, Pill } from "./primitives";

/**
 * Press presets.
 *
 * A shop's mesh rack and line-count habits are stable across jobs and specific
 * to their equipment. Re-entering them every time is exactly the friction that
 * makes a tool feel like a toy. Built-ins are examples, not standards.
 */
export function PresetPanel({
  presets, activeId, onApply, onSaveCurrent, onDuplicate, onRename, onDelete, storageAvailable,
}: {
  presets: PressPreset[];
  activeId: string | null;
  onApply: (preset: PressPreset) => void;
  onSaveCurrent: (name: string) => void;
  onDuplicate: (preset: PressPreset) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  storageAvailable: boolean;
}) {
  const [savingName, setSavingName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  return (
    <section className="border-b border-ink-100 px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Press Presets</h2>
        <button
          type="button"
          onClick={() => setShowSave((v) => !v)}
          className="text-[11px] font-medium text-accent hover:underline"
        >
          {showSave ? "Cancel" : "Save current"}
        </button>
      </div>

      {showSave ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!savingName.trim()) return;
            onSaveCurrent(savingName.trim());
            setSavingName("");
            setShowSave(false);
          }}
          className="mb-2.5 flex gap-1.5"
        >
          <input
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            placeholder="My 6-color manual"
            autoFocus
            className="ctl h-7 min-w-0 flex-1 rounded px-2 text-[12px] outline-none focus:border-accent"
          />
          <Button size="sm" variant="primary" type="submit" disabled={!savingName.trim()}>Save</Button>
        </form>
      ) : null}

      <ul className="space-y-1">
        {presets.map((p) => {
          const active = activeId === p.id;
          return (
            <li
              key={p.id}
              className={`rounded border px-2 py-1.5 ${active ? "border-accent bg-accent-soft" : "border-ink-100"}`}
            >
              {renamingId === p.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRename(p.id, renameValue.trim() || p.name);
                    setRenamingId(null);
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    className="ctl h-6 min-w-0 flex-1 rounded px-1.5 text-[12px] outline-none focus:border-accent"
                  />
                  <Button size="sm" variant="primary" type="submit">OK</Button>
                </form>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-sm border border-ink-200"
                      style={{ background: p.garmentColor }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-900">{p.name}</span>
                    {p.builtIn ? <Pill>Example</Pill> : null}
                  </div>
                  <p className="tnum mt-0.5 text-[11px] text-ink-400">
                    {p.maxScreens ?? "∞"} screens · {p.defaultMesh} mesh ·{" "}
                    {p.halftonesEnabled ? `${p.defaultLpi} LPI` : "solid"} · {p.underbaseMesh} base
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Button size="sm" variant={active ? "secondary" : "primary"} onClick={() => onApply(p)}>
                      {active ? "Re-apply" : "Apply"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDuplicate(p)}>Duplicate</Button>
                    {!p.builtIn ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                        >
                          Rename
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => onDelete(p.id)}>Delete</Button>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[10px] leading-snug text-ink-400">
        {storageAvailable
          ? "Saved in this browser. The examples describe common shop setups, not industry standards — adjust them to your press."
          : "This browser is blocking local storage, so presets will not be remembered between visits."}
      </p>
    </section>
  );
}
