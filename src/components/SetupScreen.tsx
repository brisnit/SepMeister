"use client";

import { useState } from "react";
import type { JobMetadata, PressPreset, ProductionSettings, ProductionSize, SeparationMethod } from "@/lib/types";
import { Button, Field, SegmentedControl, Pill } from "./primitives";
import { SepMark, type UploadedInfo } from "./UploadScreen";
import { ProductionSizeControl } from "./ProductionSizeControl";
import { UpscaleCard } from "./UpscaleCard";

const GARMENT_PRESETS = [
  { name: "Black", hex: "#111111" },
  { name: "White", hex: "#f5f5f5" },
  { name: "Navy", hex: "#1b2a4a" },
  { name: "Red", hex: "#a01c24" },
  { name: "Gray", hex: "#8a8f96" },
];

/**
 * Every screen count from one to eighteen, plus no limit.
 *
 * Deliberately a full range rather than a curated set of "sensible" values.
 * A one-colour print is an ordinary job, and so is a fourteen-colour one on an
 * automatic; picking which counts deserve a button would just put a shop's
 * real job one click further away.
 */
const SCREEN_OPTIONS: { value: number; label: string }[] = [
  ...Array.from({ length: 18 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
  { value: 0, label: "No Limit" },
];

const MESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Auto" },
  { value: 110, label: "110" },
  { value: 156, label: "156" },
  { value: 180, label: "180" },
  { value: 200, label: "200" },
  { value: 230, label: "230" },
  { value: 305, label: "305" },
];

const METHODS: { value: SeparationMethod; label: string; blurb: string; experimental?: boolean }[] = [
  { value: "ai", label: "AI Recommend", blurb: "Picks ink softness and screen count from the artwork's own character." },
  { value: "spot", label: "Spot Color", blurb: "Crisp two-ink edges. Best for logos, linework and flat illustration." },
  { value: "simulated", label: "Simulated Process", blurb: "Lets three inks blend per pixel for smoother tonal artwork.", experimental: true },
  { value: "index", label: "Index", blurb: "Near-hard assignment with no blending. Pair with halftones.", experimental: true },
];

export function SetupScreen({
  info, settings, metadata, productionSize, presets, activePresetId, marginIn,
  onChange, onMetadata, onProductionSize, onApplyPreset,
  onSeparate, busy, busyLabel, onBack, removeBackground, onRemoveBackground,
  upscaleApplied, upscaledFrom, onUpscale, onRevertUpscale,
}: {
  info: UploadedInfo;
  settings: ProductionSettings;
  metadata: JobMetadata;
  productionSize: ProductionSize;
  presets: PressPreset[];
  activePresetId: string | null;
  marginIn: number;
  onChange: (next: ProductionSettings) => void;
  onMetadata: (next: JobMetadata) => void;
  onProductionSize: (next: ProductionSize) => void;
  onApplyPreset: (preset: PressPreset) => void;
  onSeparate: () => void;
  busy: boolean;
  busyLabel: string;
  onBack: () => void;
  removeBackground: boolean;
  onRemoveBackground: (v: boolean) => void;
  upscaleApplied: boolean;
  upscaledFrom: number | null;
  onUpscale: () => void;
  onRevertUpscale: () => void;
}) {
  const [customGarment, setCustomGarment] = useState(settings.garmentColor);
  const set = <K extends keyof ProductionSettings>(key: K, value: ProductionSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const isPreset = GARMENT_PRESETS.some((p) => p.hex.toLowerCase() === settings.garmentColor.toLowerCase());
  const method = METHODS.find((m) => m.value === settings.method);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between border-b border-ink-100 pb-5">
        <div className="flex items-center gap-2">
          <SepMark />
          <span className="text-[13px] font-bold tracking-tight text-ink-900">SepWiz</span>
          <span className="ml-2 text-[13px] text-ink-300">/</span>
          <span className="ml-2 text-[13px] font-medium text-ink-500">Production setup</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>← Change artwork</Button>
      </header>

      <div className="grid grid-cols-[260px_1fr] gap-10">
        <aside>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={info.thumbnailUrl}
            alt="Artwork thumbnail"
            className="checkerboard mb-3 w-full rounded border border-ink-100 object-contain"
          />
          <p className="truncate text-[13px] font-semibold text-ink-900">{info.fileName}</p>
          <dl className="mt-2 space-y-1">
            {([
              ["Size", `${info.originalWidth} × ${info.originalHeight}`],
              ["Resolution", `${info.dpi} DPI${info.dpiAssumed ? "*" : ""}`],
              ["Colors", `${info.uniqueColorsExact ? "" : ">"}${info.uniqueColors.toLocaleString()}`],
              ["Alpha", info.hasAlpha ? "Yes" : "No"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-ink-50 py-0.5">
                <dt className="text-[12px] text-ink-400">{k}</dt>
                <dd className="tnum text-[12px] font-medium text-ink-800">{v}</dd>
              </div>
            ))}
          </dl>
          {info.dpiAssumed ? (
            <p className="mt-2 text-[11px] leading-snug text-ink-400">
              * This file declares no resolution. 300 DPI is assumed, which sets the physical film size.
            </p>
          ) : null}
        </aside>

        <div className="space-y-7">
          {presets.length > 0 ? (
            <Field label="Press Preset" hint="Loads garment, mesh and screening">
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={activePresetId === p.id}
                    onClick={() => onApplyPreset(p)}
                    className={`ctl flex h-8 items-center gap-2 rounded px-2 text-[13px] font-medium ${
                      activePresetId === p.id ? "ctl-active" : ""
                    }`}
                  >
                    <span className="h-4 w-4 rounded-sm border border-ink-200" style={{ background: p.garmentColor }} />
                    {p.name}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] leading-snug text-ink-400">
                Examples describing common shop setups, not industry standards. Everything stays editable.
              </p>
            </Field>
          ) : null}

          <Field label="Print Size" hint="Sets the physical film size">
            <ProductionSizeControl
              size={productionSize}
              pixelWidth={info.width}
              pixelHeight={info.height}
              marginIn={marginIn}
              onChange={onProductionSize}
            />
            <div className="mt-2.5">
              <UpscaleCard
                pixelWidth={info.width}
                pixelHeight={info.height}
                size={productionSize}
                applied={upscaleApplied}
                appliedFrom={upscaledFrom}
                busy={busy}
                onUpscale={onUpscale}
                onRevert={onRevertUpscale}
              />
            </div>
          </Field>

          <Field label="Garment Color" hint={settings.garmentColor.toUpperCase()}>
            <div className="flex flex-wrap items-center gap-1.5">
              {GARMENT_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  onClick={() => set("garmentColor", p.hex)}
                  aria-pressed={settings.garmentColor.toLowerCase() === p.hex.toLowerCase()}
                  className={`ctl flex h-8 items-center gap-2 rounded px-2 text-[13px] font-medium ${
                    settings.garmentColor.toLowerCase() === p.hex.toLowerCase() ? "ctl-active" : ""
                  }`}
                >
                  <span className="h-4 w-4 rounded-sm border border-ink-200" style={{ background: p.hex }} />
                  {p.name}
                </button>
              ))}
              <label
                className={`ctl flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] font-medium ${
                  !isPreset ? "ctl-active" : ""
                }`}
              >
                <span className="h-4 w-4 rounded-sm border border-ink-200" style={{ background: customGarment }} />
                Custom
                <input
                  type="color"
                  className="sr-only"
                  value={customGarment}
                  onChange={(e) => { setCustomGarment(e.target.value); set("garmentColor", e.target.value); }}
                />
              </label>
            </div>
          </Field>

          <Field
            label="Maximum Screens"
            hint={settings.maxScreens === null ? "Unlimited" : `${settings.maxScreens} screens`}
          >
            <SegmentedControl
              ariaLabel="Maximum screens"
              options={SCREEN_OPTIONS}
              value={settings.maxScreens ?? 0}
              onChange={(v) => set("maxScreens", v === 0 ? null : v)}
            />
          </Field>

          <Field label="Separation Method">
            <div className="flex flex-wrap gap-1">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={settings.method === m.value}
                  onClick={() => set("method", m.value)}
                  className={`ctl flex h-8 items-center gap-1.5 rounded px-2.5 text-[13px] font-medium ${
                    settings.method === m.value ? "ctl-active" : ""
                  }`}
                >
                  {m.label}
                  {m.experimental ? <Pill tone="warn">Beta</Pill> : null}
                </button>
              ))}
            </div>
            {method ? <p className="mt-2 text-[12px] leading-snug text-ink-400">{method.blurb}</p> : null}
          </Field>

          <div className="grid grid-cols-2 gap-7">
            <Field label="Mesh Count" hint={settings.meshCount === "auto" ? "Per screen" : `${settings.meshCount}`}>
              <SegmentedControl
                ariaLabel="Mesh count"
                options={MESH_OPTIONS}
                value={settings.meshCount === "auto" ? 0 : settings.meshCount}
                onChange={(v) => set("meshCount", v === 0 ? "auto" : v)}
              />
            </Field>

            <Field label="Ink Type">
              <SegmentedControl
                ariaLabel="Ink type"
                options={[
                  { value: "plastisol", label: "Plastisol" },
                  { value: "waterbased", label: "Water-based" },
                  { value: "unknown", label: "Unknown" },
                ]}
                value={settings.inkType}
                onChange={(v) => set("inkType", v)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-7">
            <Field label="Job Name">
              <input
                value={metadata.jobName}
                onChange={(e) => onMetadata({ ...metadata, jobName: e.target.value })}
                className="ctl h-9 w-full rounded px-3 text-[13px] outline-none focus:border-accent"
                placeholder="Sailor Tee"
              />
            </Field>
            <Field label="Customer">
              <input
                value={metadata.customer}
                onChange={(e) => onMetadata({ ...metadata, customer: e.target.value })}
                className="ctl h-9 w-full rounded px-3 text-[13px] outline-none focus:border-accent"
                placeholder="Nick's Screen Printing"
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded border border-ink-100 bg-surface p-3">
            <input
              type="checkbox"
              checked={settings.useGarmentAsBlack}
              onChange={(e) => set("useGarmentAsBlack", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#5d5fef]"
            />
            <span>
              <span className="block text-[13px] font-semibold text-ink-900">Use garment as black</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">
                Where the artwork&rsquo;s black matches the garment, knock it out instead of printing it. Saves a
                screen and a lot of ink. SepWiz keeps a black screen anyway if the black carries fine linework.
              </span>
            </span>
          </label>

          {info.detectedBackground ? (
            <label className="flex cursor-pointer items-start gap-2.5 rounded border border-ink-100 bg-surface p-3">
              <input
                type="checkbox"
                checked={removeBackground}
                onChange={(e) => onRemoveBackground(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#5d5fef]"
              />
              <span>
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
                  Remove background
                  <span
                    className="h-4 w-4 rounded-sm border border-ink-200"
                    style={{ background: info.detectedBackground }}
                  />
                  <span className="font-mono text-[11px] font-normal text-ink-400">
                    {info.detectedBackground.toUpperCase()}
                  </span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">
                  This artwork has a solid background and no transparency. Leave this on unless you actually
                  want it printed &mdash; on a dark garment it would become a full-coverage underbase.
                </span>
              </span>
            </label>
          ) : null}

          <div className="border-t border-ink-100 pt-6">
            {busy ? (
              <div className="max-w-sm">
                <div className="progress-sweep relative h-0.5 w-full overflow-hidden bg-ink-100" />
                <p className="mt-3 text-[13px] font-medium text-ink-600">{busyLabel}</p>
              </div>
            ) : (
              <Button variant="primary" size="lg" onClick={onSeparate} className="w-full sm:w-auto">
                SEPARATE ARTWORK
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
