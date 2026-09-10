"use client";

import { useState } from "react";
import type { DotShape, InkHalftone } from "@/lib/types";
import {
  ANGLE_PRESETS, ANGLE_QUICK_PICKS, LPI_PRESETS, checkMeshSafety, halftoneQuality,
} from "@/lib/engine/halftone";
import { Button, SegmentedControl } from "./primitives";

/**
 * Per-separation halftone controls.
 *
 * Screening is a per-screen decision: a base is usually printed solid, a
 * detail black often runs finer than the colors, and every screen needs its
 * own angle. Recommendations are shown with their reasoning and can always be
 * overridden — a separator with a reason to run 65 LPI on 110 mesh is allowed
 * to do exactly that.
 */
export function HalftoneControls({
  halftone, mesh, filmDpi, onChange, onMesh,
}: {
  halftone: InkHalftone;
  mesh: number;
  filmDpi: number;
  onChange: (next: InkHalftone) => void;
  onMesh: (mesh: number) => void;
}) {
  const [customLpi, setCustomLpi] = useState(false);
  const [customAngle, setCustomAngle] = useState(false);

  const safety = checkMeshSafety(halftone.lpi, mesh);
  const quality = halftoneQuality(halftone.lpi, filmDpi);
  const isPresetLpi = LPI_PRESETS.includes(halftone.lpi);
  const isPresetAngle = ANGLE_QUICK_PICKS.includes(halftone.angle);

  const applyRecommendation = () => {
    // Prefer keeping the artist's line count and raising mesh when that is
    // possible on a common mesh; otherwise pull the line count into range.
    if (safety.recommendedMesh && safety.recommendedMesh !== mesh) {
      onMesh(safety.recommendedMesh);
    } else {
      const target = safety.recommendedLpiRange[1];
      onChange({ ...halftone, lpi: target });
    }
  };

  return (
    <div className="space-y-3 border-t border-ink-50 pt-3">
      <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink-800">
        <input
          type="checkbox"
          checked={halftone.enabled}
          onChange={(e) => onChange({ ...halftone, enabled: e.target.checked })}
          className="h-3.5 w-3.5 accent-[#5d5fef]"
        />
        Halftone this screen
        {!halftone.enabled ? <span className="ml-auto text-[11px] font-normal text-ink-400">Prints solid</span> : null}
      </label>

      {halftone.enabled ? (
        <>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-medium text-ink-600">LPI</span>
              <button
                type="button"
                onClick={() => setCustomLpi((v) => !v)}
                className="text-[11px] text-accent hover:underline"
              >
                {customLpi || !isPresetLpi ? "Presets" : "Custom"}
              </button>
            </div>
            {customLpi || !isPresetLpi ? (
              <input
                type="number"
                min={10}
                max={200}
                step={1}
                value={halftone.lpi}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) onChange({ ...halftone, lpi: Math.max(10, Math.min(200, v)) });
                }}
                className="ctl h-7 w-full rounded px-2 text-[12px] tnum outline-none focus:border-accent"
                aria-label="Lines per inch"
              />
            ) : (
              <SegmentedControl
                ariaLabel="Lines per inch"
                options={LPI_PRESETS.map((v) => ({ value: v, label: String(v) }))}
                value={halftone.lpi}
                onChange={(v) => onChange({ ...halftone, lpi: v })}
              />
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-medium text-ink-600">Angle</span>
              <button
                type="button"
                onClick={() => setCustomAngle((v) => !v)}
                className="text-[11px] text-accent hover:underline"
              >
                {customAngle || !isPresetAngle ? "Quick picks" : "Type a value"}
              </button>
            </div>
            {customAngle || !isPresetAngle ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={359.9}
                  step={0.5}
                  value={halftone.angle}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) onChange({ ...halftone, angle: ((v % 360) + 360) % 360 });
                  }}
                  className="ctl h-7 w-full rounded px-2 text-[12px] tnum outline-none focus:border-accent"
                  aria-label="Screen angle in degrees"
                />
                <span className="text-[12px] text-ink-400">°</span>
              </div>
            ) : (
              <SegmentedControl
                ariaLabel="Screen angle"
                options={ANGLE_QUICK_PICKS.map((v) => ({ value: v, label: `${v}°` }))}
                value={halftone.angle}
                onChange={(v) => onChange({ ...halftone, angle: v })}
              />
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-ink-600">Dot shape</span>
            <SegmentedControl
              ariaLabel="Dot shape"
              options={[
                { value: "round" as DotShape, label: "Round" },
                { value: "ellipse" as DotShape, label: "Ellipse" },
                { value: "square" as DotShape, label: "Square" },
              ]}
              value={halftone.shape}
              onChange={(v) => onChange({ ...halftone, shape: v })}
            />
          </div>

          {!safety.safe && safety.message ? (
            <div
              className={`rounded border px-2 py-2 text-[11px] leading-snug ${
                safety.severity === "high"
                  ? "border-red-200 bg-red-50 text-red-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <p className="font-semibold">
                {safety.severity === "high" ? "High detail risk" : "Detail risk"}
              </p>
              <p className="mt-0.5">{safety.message}</p>
              {safety.recommendation ? (
                <p className="mt-1">Recommended: {safety.recommendation}.</p>
              ) : null}
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="sm" onClick={applyRecommendation}>Apply recommendation</Button>
                <span className="text-[10px] opacity-80">Heuristic — you can keep your setting.</span>
              </div>
            </div>
          ) : null}

          {safety.safe && !quality.adequate ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900">
              At {filmDpi} DPI film output each dot spans {quality.cellPx.toFixed(1)}px
              (~{quality.greyLevels} tonal steps). Export at a higher film resolution for smoother tone.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Applies a whole angle preset across the job's screens. */
export function AnglePresetPicker({
  onApply, screenCount,
}: {
  onApply: (angles: number[], presetLabel: string) => void;
  screenCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium text-accent hover:underline"
      >
        {open ? "Hide angle sets" : "Apply an angle set to all screens"}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1.5">
          {ANGLE_PRESETS.map((p) => (
            <li key={p.id} className="rounded border border-ink-100 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-ink-900">{p.label}</span>
                <Button size="sm" onClick={() => { onApply(p.angles, p.label); setOpen(false); }}>Apply</Button>
              </div>
              <p className="mt-1 tnum text-[11px] text-ink-500">
                {p.angles.slice(0, Math.max(1, screenCount)).map((a) => `${a}°`).join(" · ")}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-ink-400">{p.description}</p>
            </li>
          ))}
          <li className="px-1 pt-0.5 text-[10px] leading-snug text-ink-400">
            No set is universally correct. These are conventions; override any screen individually.
          </li>
        </ul>
      ) : null}
    </div>
  );
}
