"use client";

import type { ProductionSize } from "@/lib/types";
import { planUpscale, TARGET_WORKING_DPI } from "@/lib/engine/upscale";
import { effectiveDpi } from "@/lib/production/size";
import { Button, Pill } from "./primitives";

/**
 * Offers to resample low-resolution artwork up to the working resolution.
 *
 * Worded carefully. Upscaling cannot recover detail that is not in the file,
 * and a tool that implies otherwise will get blamed for a soft print that was
 * always going to be soft. What it genuinely fixes is stated instead: choke
 * and spread are physical measurements converted against the working
 * resolution, and below about 200 DPI a 1px choke rounds away to nothing, so
 * the control silently does nothing at all.
 */
export function UpscaleCard({
  pixelWidth, pixelHeight, size, applied, appliedFrom, busy, onUpscale, onRevert,
}: {
  pixelWidth: number;
  pixelHeight: number;
  size: ProductionSize;
  /** True once this artwork has been resampled. */
  applied: boolean;
  /** Original pixel width, shown after an upscale. */
  appliedFrom: number | null;
  busy: boolean;
  onUpscale: () => void;
  onRevert: () => void;
}) {
  const dpi = effectiveDpi(pixelWidth, size);
  const plan = planUpscale(pixelWidth, pixelHeight, size.widthIn);

  if (applied) {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Pill tone="good">Upscaled</Pill>
          <span className="tnum text-[12px] font-semibold text-emerald-900">
            {appliedFrom ? `${appliedFrom} → ` : ""}{pixelWidth}px · {Math.round(dpi)} DPI
          </span>
          <button
            type="button"
            onClick={onRevert}
            disabled={busy}
            className="ml-auto text-[11px] font-medium text-emerald-800 underline hover:text-emerald-900 disabled:opacity-50"
          >
            Use original
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-emerald-900/80">
          Separating at {Math.round(dpi)} DPI. Edges land on a finer grid and choke/spread work at proper
          precision. This did not add detail that was not in the file.
        </p>
      </div>
    );
  }

  if (!plan.needed) {
    if (dpi >= TARGET_WORKING_DPI) return null;
    return null;
  }

  return (
    <div className="rounded border border-accent-border bg-accent-soft px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-ink-900">
          Separate at {TARGET_WORKING_DPI} DPI?
        </span>
        <span className="tnum ml-auto text-[11px] text-ink-500">
          {pixelWidth} → {plan.targetWidth}px
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-ink-600">
        This artwork is <strong className="tnum">{Math.round(dpi)} DPI</strong> at {size.widthIn.toFixed(2)}in.
        At that resolution a 1px choke rounds to zero, so trapping controls do nothing. Resampling to{" "}
        {Math.round(plan.resultingDpi)} DPI gives them room to work and puts ink edges on a finer grid.
      </p>
      <p className="mt-1 text-[11px] leading-snug text-ink-400">
        It cannot add detail the file does not contain — a soft original stays soft.
        {plan.capped ? ` Capped at ${Math.round(plan.resultingDpi)} DPI to keep memory workable.` : ""}
      </p>
      <div className="mt-2">
        <Button size="sm" variant="primary" onClick={onUpscale} disabled={busy}>
          {busy ? "Resampling…" : `Upscale to ${Math.round(plan.resultingDpi)} DPI`}
        </Button>
      </div>
    </div>
  );
}
