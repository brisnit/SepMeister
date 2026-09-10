"use client";

import { useRef, useState } from "react";
import type { ProductionSize, SeparationPlan } from "@/lib/types";
import { formatSize } from "@/lib/production/size";
import { CanvasView } from "./CanvasView";
import { Button, Pill } from "./primitives";
import { ScreenSummary } from "./ScreenSummary";

type ReviewLayout = "split" | "side" | "difference";

/**
 * Customer and peer review.
 *
 * Deliberately stripped of production controls: this is the surface for
 * showing a customer what they are approving, or handing to another separator
 * for a second opinion. Anything that could be nudged by accident during that
 * conversation does not belong here.
 */
export function ReviewMode({
  originalRgba, compositeRgba, width, height, similarity, plan, garmentColor, size,
  jobName, customer, sepScore, verdict, warnings, onClose,
}: {
  originalRgba: Uint8ClampedArray | null;
  compositeRgba: Uint8ClampedArray | null;
  width: number;
  height: number;
  similarity: number | null;
  plan: SeparationPlan;
  garmentColor: string;
  size: ProductionSize;
  jobName: string;
  customer: string;
  sepScore: number;
  verdict: string;
  warnings: string[];
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<ReviewLayout>("split");
  const [showScreens, setShowScreens] = useState(false);
  const screenCount = plan.inks.length;
  const [split, setSplit] = useState(50);
  const frameRef = useRef<HTMLDivElement>(null);

  const difference = layout === "difference" ? buildDifference(originalRgba, compositeRgba, width, height) : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950">
      <header className="flex shrink-0 items-center gap-4 border-b border-ink-800 px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold tracking-tight text-white">
            {jobName || "Untitled job"}
          </h2>
          {customer ? <p className="truncate text-[12px] text-ink-300">{customer}</p> : null}
        </div>

        <div className="ml-4 flex gap-1" role="group" aria-label="Comparison layout">
          {([["split", "Split"], ["side", "Side by side"], ["difference", "Difference"]] as [ReviewLayout, string][]).map(
            ([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={layout === v}
                onClick={() => setLayout(v)}
                className={`h-7 rounded border px-2.5 text-[12px] font-medium transition-colors ${
                  layout === v
                    ? "border-accent bg-accent text-white"
                    : "border-ink-700 text-ink-200 hover:bg-ink-800"
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>

        <dl className="ml-auto flex shrink-0 items-center gap-5">
          {([
            ["Screens", String(screenCount)],
            ["Recommended", String(plan.recommendedScreens)],
            ["Limit", plan.maxScreens ? String(plan.maxScreens) : "None"],
            ["Garment", garmentColor.toUpperCase()],
            ["Size", formatSize(size)],
            ...(similarity !== null ? ([["Similarity", `${similarity}%`]] as [string, string][]) : []),
            ["Sep Score", String(sepScore)],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] uppercase tracking-[0.06em] text-ink-400">{k}</dt>
              <dd className="tnum text-[13px] font-semibold text-white">{v}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-ink-400">Warnings</dt>
            <dd className="mt-0.5">
              {warnings.length === 0 ? <Pill tone="good">None</Pill> : <Pill tone="warn">{warnings.length}</Pill>}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => setShowScreens((v) => !v)}
          className={`h-7 shrink-0 rounded border px-2.5 text-[12px] font-medium transition-colors ${
            showScreens ? "border-accent bg-accent text-white" : "border-ink-700 text-ink-200 hover:bg-ink-800"
          }`}
        >
          Screens
        </button>

        <Button variant="ghost" size="sm" onClick={onClose} className="!text-ink-200 hover:!bg-ink-800 hover:!text-white">
          Close
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
      {showScreens ? (
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900">
          <div className="[&_h2]:text-ink-400 [&_section]:border-ink-800 [&_.text-ink-900]:!text-white [&_.text-ink-400]:!text-ink-400">
            <ScreenSummary plan={plan} />
          </div>
          {warnings.length > 0 ? (
            <div className="border-t border-ink-800 px-3 py-3">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                Production warnings
              </h3>
              <ul className="space-y-1">
                {warnings.map((w) => (
                  <li key={w} className="text-[11px] leading-snug text-ink-300">{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      ) : null}

      <div ref={frameRef} className="flex min-h-0 flex-1 items-center justify-center p-6">
        {layout === "side" ? (
          <div className="grid h-full w-full grid-cols-2 gap-4">
            <Pane label="Original">
              <CanvasView rgba={originalRgba} width={width} height={height} alt="Original artwork" checkered />
            </Pane>
            <Pane label="Separated preview">
              <CanvasView rgba={compositeRgba} width={width} height={height} alt="Separated preview" />
            </Pane>
          </div>
        ) : layout === "difference" ? (
          <Pane label="Difference — brighter means further from the original">
            <CanvasView rgba={difference} width={width} height={height} alt="Difference map" />
          </Pane>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
              <div className="relative inline-block max-h-full">
                <CanvasView rgba={compositeRgba} width={width} height={height} alt="Separated preview" />
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                >
                  <CanvasView rgba={originalRgba} width={width} height={height} alt="Original artwork" checkered />
                </div>
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                  style={{ left: `${split}%` }}
                />
              </div>
            </div>
            <div className="flex w-full max-w-xl items-center gap-3">
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-400">Original</span>
              <input
                type="range" min={0} max={100} step={0.5} value={split}
                onChange={(e) => setSplit(parseFloat(e.target.value))}
                aria-label="Comparison split position"
                className="flex-1"
              />
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-400">Separated</span>
            </div>
          </div>
        )}
      </div>

      </div>

      <footer className="shrink-0 border-t border-ink-800 px-5 py-2.5">
        <p className="text-[11px] text-ink-400">
          Digital separation preview — how faithfully the chosen inks reproduce the artwork as pixels.
          It is not a simulation of ink on fabric.
        </p>
      </footer>
    </div>
  );
}

function Pane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="flex min-h-0 flex-col items-center gap-2">
      <div className="flex min-h-0 flex-1 items-center justify-center">{children}</div>
      <figcaption className="text-[11px] uppercase tracking-[0.08em] text-ink-400">{label}</figcaption>
    </figure>
  );
}

/**
 * Per-pixel absolute difference, amplified so small errors are visible.
 * Amplification is stated in the caption so nobody reads a bright pixel as a
 * catastrophic error.
 */
function buildDifference(
  a: Uint8ClampedArray | null,
  b: Uint8ClampedArray | null,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  if (!a || !b) return null;
  const n = width * height;
  if (a.length < n * 4 || b.length < n * 4) return null;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const d = (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2])) / 3;
    const v = Math.min(255, Math.round(d * 3));
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return out;
}
