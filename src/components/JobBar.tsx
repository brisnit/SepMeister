"use client";

import { useState } from "react";
import type { JobMetadata, ProductionSize } from "@/lib/types";
import { formatSize } from "@/lib/production/size";
import { SepMark } from "./UploadScreen";

/**
 * Job paperwork strip.
 *
 * A separator works on named jobs for named customers, and that context has to
 * survive onto the films and the production sheet — a loose film positive with
 * no job name on it is a film nobody can identify at the burn table.
 */
export function JobBar({
  metadata, size, garmentColor, screenCount, effectiveDpi, onChange, children,
}: {
  metadata: JobMetadata;
  size: ProductionSize;
  garmentColor: string;
  screenCount: number;
  effectiveDpi: number;
  onChange: (next: JobMetadata) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  const facts: [string, string][] = [
    ["Garment", garmentColor.toUpperCase()],
    ["Size", formatSize(size)],
    ["Screens", String(screenCount)],
    ["Detail", `${Math.round(effectiveDpi)} DPI`],
    ["Date", new Date(metadata.createdAt).toLocaleDateString()],
  ];

  return (
    <header className="shrink-0 border-b border-ink-100 bg-surface">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2">
          <SepMark />
          <span className="text-[13px] font-bold tracking-tight text-ink-900">SepWiz</span>
        </div>
        <span className="text-ink-200">/</span>

        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="group flex min-w-0 items-baseline gap-2 rounded px-1.5 py-0.5 text-left hover:bg-ink-50"
          title="Edit job details"
        >
          <span className="truncate text-[14px] font-semibold text-ink-900">
            {metadata.jobName || "Untitled job"}
          </span>
          {metadata.customer ? (
            <span className="truncate text-[12px] text-ink-500">{metadata.customer}</span>
          ) : (
            <span className="text-[12px] text-ink-300 group-hover:text-ink-400">+ customer</span>
          )}
        </button>

        <dl className="ml-auto flex shrink-0 items-center gap-4">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.06em] text-ink-400">{k}</dt>
              <dd className="tnum text-[12px] font-semibold text-ink-800">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex shrink-0 items-center gap-2 border-l border-ink-100 pl-3">{children}</div>
      </div>

      {editing ? (
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-3 border-t border-ink-100 bg-surface-sunken px-4 py-3">
          <Field label="Job name" value={metadata.jobName} onChange={(v) => onChange({ ...metadata, jobName: v })} placeholder="Sailor Tee" />
          <Field label="Customer" value={metadata.customer} onChange={(v) => onChange({ ...metadata, customer: v })} placeholder="Nick's Screen Printing" />
          <Field label="Notes" value={metadata.notes} onChange={(v) => onChange({ ...metadata, notes: v })} placeholder="Print notes for the shop — appears on the production sheet" />
        </div>
      ) : null}
    </header>
  );
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="ctl h-8 w-full rounded px-2.5 text-[13px] outline-none focus:border-accent"
      />
    </label>
  );
}
