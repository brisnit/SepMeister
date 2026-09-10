"use client";

import type { ProductionSize, SizeUnit } from "@/lib/types";
import {
  assessResolution, convertUnits, filmSize, fromInches, resizeProduction, smallestSheetFor,
} from "@/lib/production/size";
import { Button } from "./primitives";

/**
 * Physical print size, and the resolution consequences of it.
 *
 * The most consequential control in the app: the same file is a crisp 4in
 * print and a soft 14in one, and nothing in the file says which was intended.
 * Resolution is recomputed live rather than checked at export, so the artist
 * sees the cost of a size change while making it.
 */
export function ProductionSizeControl({
  size, pixelWidth, pixelHeight, marginIn, onChange, compact = false,
}: {
  size: ProductionSize;
  pixelWidth: number;
  pixelHeight: number;
  marginIn: number;
  onChange: (next: ProductionSize) => void;
  compact?: boolean;
}) {
  const assessment = assessResolution(pixelWidth, size);
  const sheet = filmSize(size, marginIn);
  const fits = smallestSheetFor(sheet.widthIn, sheet.heightIn);

  const shownW = fromInches(size.widthIn, size.units);
  const shownH = fromInches(size.heightIn, size.units);
  const step = size.units === "cm" ? 0.1 : 0.05;

  const tone =
    assessment.level === "good" ? "text-good"
    : assessment.level === "caution" ? "text-warn"
    : "text-bad";

  return (
    <div className="space-y-2.5">
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-ink-500">Width</span>
          <input
            type="number"
            min={0.1}
            step={step}
            value={Number(shownW.toFixed(3))}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) onChange(resizeProduction(size, "width", v, pixelWidth, pixelHeight));
            }}
            className="ctl h-8 w-full rounded px-2 text-[13px] tnum outline-none focus:border-accent"
          />
        </label>

        <button
          type="button"
          onClick={() => onChange({ ...size, lockAspect: !size.lockAspect })}
          aria-pressed={size.lockAspect}
          title={size.lockAspect ? "Aspect ratio locked" : "Aspect ratio unlocked — artwork can be stretched"}
          className={`ctl mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded ${
            size.lockAspect ? "ctl-active" : ""
          }`}
        >
          <span aria-hidden className="text-[13px]">{size.lockAspect ? "🔒" : "🔓"}</span>
        </button>

        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-ink-500">Height</span>
          <input
            type="number"
            min={0.1}
            step={step}
            value={Number(shownH.toFixed(3))}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) onChange(resizeProduction(size, "height", v, pixelWidth, pixelHeight));
            }}
            className="ctl h-8 w-full rounded px-2 text-[13px] tnum outline-none focus:border-accent"
          />
        </label>

        <div className="mb-0.5 flex shrink-0 gap-1">
          {(["in", "cm"] as SizeUnit[]).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={size.units === u}
              onClick={() => onChange(convertUnits(size, u))}
              className={`ctl h-8 rounded px-2 text-[12px] font-medium ${size.units === u ? "ctl-active" : ""}`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 border-t border-ink-50 pt-2">
        <span className="text-[12px] text-ink-500">Effective resolution</span>
        <span className={`tnum text-[13px] font-bold ${tone}`}>{Math.round(assessment.dpi)} DPI</span>
      </div>

      {assessment.message ? (
        <div
          className={`rounded border px-2 py-2 text-[11px] leading-snug ${
            assessment.level === "low"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <p className="font-semibold">{assessment.level === "low" ? "Low resolution" : "Below 300 DPI"}</p>
          <p className="mt-0.5">{assessment.message}</p>
          {assessment.recommendation ? <p className="mt-1">{assessment.recommendation}</p> : null}
          <div className="mt-1.5">
            <Button
              size="sm"
              onClick={() =>
                onChange(resizeProduction(size, "width", fromInches(assessment.targetWidthIn, size.units), pixelWidth, pixelHeight))
              }
            >
              Resize to {fromInches(assessment.targetWidthIn, size.units).toFixed(2)} {size.units}
            </Button>
          </div>
        </div>
      ) : null}

      {!compact ? (
        <dl className="space-y-0.5 border-t border-ink-50 pt-2">
          <Row label="Film sheet" value={`${sheet.widthIn.toFixed(2)} × ${sheet.heightIn.toFixed(2)} in`} />
          <Row label="Fits sheet" value={fits ?? "Larger than 17 × 22 in"} />
          <Row label="Scale" value="100% — films are not scaled" />
        </dl>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[11px] text-ink-400">{label}</dt>
      <dd className="tnum text-[11px] font-medium text-ink-700">{value}</dd>
    </div>
  );
}
