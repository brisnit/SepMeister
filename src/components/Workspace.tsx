"use client";

import { useMemo } from "react";
import type {
  ExportSettings, ImageAnalysis, InkSeparation, JobMetadata, PressPreset,
  ProductionSettings, ProductionSize, QAResult, SeparationPlan,
} from "@/lib/types";
import type { OperationResult } from "@/lib/ai/operations";
import { effectiveDpi } from "@/lib/production/size";
import { CanvasView, maskToFilmRgba, maskToInkRgba, buildUnderbaseOverlay } from "./CanvasView";
import { SeparationStack } from "./SeparationStack";
import { ScreenSummary } from "./ScreenSummary";
import { SepScorePanel } from "./SepScorePanel";
import { CommandBar } from "./CommandBar";
import { ExportPanel, ExportAction } from "./ExportPanel";
import { PresetPanel } from "./PresetPanel";
import { PrintOrderPanel } from "./PrintOrderPanel";
import { UnderbasePanel, type UnderbaseView } from "./UnderbasePanel";
import { AnglePresetPicker } from "./HalftoneControls";
import { JobBar } from "./JobBar";
import { DemoRail, type DemoStep } from "./DemoRail";
import { Button, Pill } from "./primitives";

export type ViewMode = "original" | "composite" | "garment" | "films";

export interface WorkspaceProps {
  metadata: JobMetadata;
  plan: SeparationPlan;
  analysis: ImageAnalysis;
  qa: QAResult;
  similarity: number | null;
  settings: ProductionSettings;
  productionSize: ProductionSize;
  exportSettings: ExportSettings;
  presets: PressPreset[];
  activePresetId: string | null;
  storageAvailable: boolean;
  separationsCompleted: number;
  demoMode: boolean;
  demoStep: DemoStep;
  sepScore: number;
  view: ViewMode;
  underbaseView: UnderbaseView;
  selectedInk: string | null;
  originalRgba: Uint8ClampedArray | null;
  compositeRgba: Uint8ClampedArray | null;
  width: number;
  height: number;
  busy: boolean;
  busyLabel: string;
  exportBusy: boolean;
  exportLabel: string;
  commandResult: (OperationResult & { input: string }) | null;
  underbaseChoke: number;
  underbaseStrength: number;
  removeUnderBlack: boolean;
  highlightWhite: boolean;
  productionWarnings: string[];
  onMetadata: (next: JobMetadata) => void;
  onDemoMode: (on: boolean) => void;
  onDemoStep: (s: DemoStep) => void;
  onView: (v: ViewMode) => void;
  onUnderbaseView: (v: UnderbaseView) => void;
  onSelectInk: (id: string | null) => void;
  onToggleInk: (id: string) => void;
  onUpdateInk: (id: string, patch: Partial<InkSeparation>) => void;
  onRemoveInk: (id: string) => void;
  onMergeInk: (sourceId: string, targetId: string) => void;
  onReorderInk: (id: string, direction: -1 | 1) => void;
  onApplyPrintOrder: (order: string[]) => void;
  onApplyAngles: (angles: number[], label: string) => void;
  onExportSettings: (e: ExportSettings) => void;
  onProductionSize: (s: ProductionSize) => void;
  onOpenOutputCheck: () => void;
  onOpenReview: () => void;
  onOpenFeedback: () => void;
  onCommand: (input: string) => void;
  onBack: () => void;
  onUnderbase: (patch: { choke?: number; strength?: number; removeUnderBlack?: boolean; highlightWhite?: boolean }) => void;
  onReseparate: () => void;
  onApplyPreset: (preset: PressPreset) => void;
  onSavePreset: (name: string) => void;
  onDuplicatePreset: (preset: PressPreset) => void;
  onRenamePreset: (id: string, name: string) => void;
  onDeletePreset: (id: string) => void;
}

export function Workspace(props: WorkspaceProps) {
  const {
    metadata, plan, analysis, qa, similarity, settings, productionSize, exportSettings,
    view, underbaseView, selectedInk, originalRgba, compositeRgba, width, height,
    busy, busyLabel, exportBusy, exportLabel, commandResult, productionWarnings,
  } = props;

  const selected = selectedInk ? plan.inks.find((i) => i.id === selectedInk) ?? null : null;
  const base = plan.inks.find((i) => i.type === "underbase") ?? null;
  const artDpi = effectiveDpi(width, productionSize);

  // Canvas contents for the center pane, derived from the current mode.
  const canvas = useMemo(() => {
    // The underbase preview takes precedence: it is a diagnostic view the
    // artist explicitly switched into.
    if (base && underbaseView !== "off") {
      const mask = base.mask;
      if (underbaseView === "film") {
        return { rgba: maskToFilmRgba(mask), checkered: false, label: "Underbase — film positive" };
      }
      if (underbaseView === "overlay" && originalRgba) {
        return {
          rgba: buildUnderbaseOverlay(originalRgba, mask, width, height),
          checkered: true,
          label: "Underbase overlay on original artwork",
        };
      }
      return {
        rgba: maskToInkRgba(mask, "#ffffff", plan.garmentColor),
        checkered: false,
        label: "Underbase — white ink on garment",
      };
    }

    if (view === "original") {
      return { rgba: originalRgba, checkered: true, label: "Original artwork" };
    }
    if (view === "films") {
      if (selected) return { rgba: maskToFilmRgba(selected.mask), checkered: false, label: `${selected.name} film positive` };
      return { rgba: null, checkered: false, label: "Film positives" };
    }
    if (selected) {
      const ground = view === "garment" ? plan.garmentColor : "#ffffff";
      return {
        rgba: maskToInkRgba(selected.mask, selected.displayColor, ground),
        checkered: false,
        label: `${selected.name} separation`,
      };
    }
    return { rgba: compositeRgba, checkered: false, label: "Separated composite" };
  }, [view, underbaseView, base, selected, originalRgba, compositeRgba, plan.garmentColor, width, height]);

  return (
    <div className="flex h-screen flex-col bg-surface-sunken">
      <JobBar
        metadata={metadata}
        size={productionSize}
        garmentColor={plan.garmentColor}
        screenCount={plan.inks.length}
        effectiveDpi={artDpi}
        onChange={props.onMetadata}
      >
        {!props.demoMode ? (
          <Button size="sm" onClick={() => props.onDemoMode(true)}>Shop test</Button>
        ) : null}
        <Button size="sm" onClick={props.onOpenReview}>Review</Button>
        <Button size="sm" onClick={props.onOpenFeedback}>Test feedback</Button>
        <Button variant="ghost" size="sm" onClick={props.onBack}>New separation</Button>
      </JobBar>

      {props.demoMode ? (
        <DemoRail
          step={props.demoStep}
          plan={plan}
          similarity={similarity}
          sepScore={props.sepScore}
          warningCount={productionWarnings.length}
          onStep={props.onDemoStep}
          onExit={() => props.onDemoMode(false)}
          onOpenQa={props.onOpenOutputCheck}
          onOpenReview={props.onOpenReview}
        />
      ) : null}

      <div className="flex shrink-0 items-center gap-4 border-b border-ink-100 bg-surface px-4 py-2">
        <div className="flex gap-1" role="group" aria-label="View mode">
          {([
            ["original", "Original"],
            ["composite", "Composite"],
            ["garment", "Garment Preview"],
            ["films", "Films"],
          ] as [ViewMode, string][]).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v && underbaseView === "off"}
              onClick={() => { props.onUnderbaseView("off"); props.onView(v); }}
              className={`ctl h-7 rounded px-2.5 text-[12px] font-medium ${
                view === v && underbaseView === "off" ? "ctl-active" : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {underbaseView !== "off" ? (
          <span className="flex items-center gap-2">
            <Pill tone="accent">Underbase view</Pill>
            <button
              type="button"
              onClick={() => props.onUnderbaseView("off")}
              className="text-[11px] text-accent hover:underline"
            >
              Back to {view}
            </button>
          </span>
        ) : null}

        <span className="tnum ml-auto text-[11px] text-ink-400">
          {width}×{height} px · {Math.round(artDpi)} DPI at size · {props.separationsCompleted} separation
          {props.separationsCompleted === 1 ? "" : "s"} this browser
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[276px_1fr_312px]">
        {/* LEFT — source, reasoning, underbase, presets */}
        <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-ink-100 bg-surface">
          <section className="border-b border-ink-100 px-3 py-3">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Original</h2>
            <div className="checkerboard flex h-32 items-center justify-center overflow-hidden rounded border border-ink-100">
              <CanvasView rgba={originalRgba} width={width} height={height} alt="Original artwork" />
            </div>
            <dl className="mt-2.5 space-y-0.5">
              {([
                ["Artwork", analysis.artworkType.replace("-", " ")],
                ["Recommended", `${plan.recommendedScreens} screens`],
                ["Limit", plan.maxScreens ? `${plan.maxScreens} screens` : "None"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-ink-50 py-0.5">
                  <dt className="text-[11px] text-ink-400">{k}</dt>
                  <dd className="text-[11px] font-medium capitalize text-ink-800">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="border-b border-ink-100 px-3 py-3">
            <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Color reduction
            </h2>
            <p className="text-[11px] leading-relaxed text-ink-600">{plan.explanation}</p>
            {plan.knockouts.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-ink-400">Knocked out</span>
                {plan.knockouts.map((k) => (
                  <span
                    key={k.hex}
                    title={`${k.hex} — ${(k.coverage * 100).toFixed(1)}% of artwork, printed by the garment`}
                    className="h-4 w-4 rounded-sm border border-ink-200"
                    style={{ background: k.hex }}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <UnderbasePanel
            base={base}
            choke={props.underbaseChoke}
            strength={props.underbaseStrength}
            removeUnderBlack={props.removeUnderBlack}
            highlightWhite={props.highlightWhite}
            view={underbaseView}
            dpi={artDpi}
            busy={busy}
            onChange={props.onUnderbase}
            onView={props.onUnderbaseView}
            onRebuild={props.onReseparate}
            onUpdateInk={(patch) => base && props.onUpdateInk(base.id, patch)}
          />

          <PrintOrderPanel inks={plan.inks} onApply={props.onApplyPrintOrder} />

          <PresetPanel
            presets={props.presets}
            activeId={props.activePresetId}
            storageAvailable={props.storageAvailable}
            onApply={props.onApplyPreset}
            onSaveCurrent={props.onSavePreset}
            onDuplicate={props.onDuplicatePreset}
            onRename={props.onRenamePreset}
            onDelete={props.onDeletePreset}
          />

          <section className="px-3 py-3">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Analysis</h2>
            <ul className="space-y-1">
              {analysis.notes.map((n) => (
                <li key={n} className="text-[11px] leading-snug text-ink-500">{n}</li>
              ))}
            </ul>
          </section>
        </aside>

        {/* CENTER — the artwork */}
        <main className="relative flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
            {view === "films" && !selected && underbaseView === "off" ? (
              <FilmContactSheet inks={plan.inks} width={width} height={height} onSelect={props.onSelectInk} />
            ) : (
              <CanvasView
                rgba={canvas.rgba}
                width={width}
                height={height}
                checkered={canvas.checkered}
                alt={canvas.label}
                className="shadow-sm"
              />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-ink-100 bg-surface px-4 py-2">
            <span className="text-[12px] font-medium text-ink-700">{canvas.label}</span>
            {selected ? (
              <Button size="sm" variant="ghost" onClick={() => props.onSelectInk(null)}>Show all</Button>
            ) : null}
            {view === "films" && underbaseView === "off" ? <Pill>Black artwork = ink coverage</Pill> : null}
            {busy ? (
              <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-500">
                <span className="h-1 w-16 overflow-hidden bg-ink-100">
                  <span className="progress-sweep relative block h-full w-full" />
                </span>
                {busyLabel}
              </span>
            ) : null}
          </div>
        </main>

        {/* RIGHT — separations, QA, commands, output */}
        <aside className="flex min-h-0 flex-col border-l border-ink-100 bg-surface">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ScreenSummary plan={plan} onSelect={props.onSelectInk} selectedId={selectedInk} />
            <SeparationStack
              inks={plan.inks}
              selectedId={selectedInk}
              dpi={artDpi}
              filmDpi={exportSettings.filmDpi}
              onSelect={props.onSelectInk}
              onToggle={props.onToggleInk}
              onUpdate={props.onUpdateInk}
              onRemove={props.onRemoveInk}
              onMerge={props.onMergeInk}
              onReorder={props.onReorderInk}
            />
            <div className="border-b border-ink-100 px-3 py-2.5">
              <AnglePresetPicker onApply={props.onApplyAngles} screenCount={plan.inks.length} />
            </div>
            <SepScorePanel qa={qa} similarity={similarity} />
            <CommandBar onRun={props.onCommand} busy={busy} lastResult={commandResult} />
            <ExportPanel
              exportSettings={exportSettings}
              productionSize={productionSize}
              pixelWidth={width}
              pixelHeight={height}
              onExportSettings={props.onExportSettings}
              onProductionSize={props.onProductionSize}
            />
          </div>
          {/* Pinned: the primary action stays visible however far the panel scrolls. */}
          <ExportAction
            onReview={props.onOpenOutputCheck}
            busy={exportBusy}
            busyLabel={exportLabel}
            warningCount={productionWarnings.length}
          />
        </aside>
      </div>
    </div>
  );
}

/** All films at once, so registration and content can be compared at a glance. */
function FilmContactSheet({
  inks, width, height, onSelect,
}: {
  inks: InkSeparation[];
  width: number;
  height: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid w-full max-w-4xl grid-cols-3 gap-3">
      {inks.map((ink, i) => (
        <button
          key={ink.id}
          type="button"
          onClick={() => onSelect(ink.id)}
          className="group rounded border border-ink-200 bg-white p-2 text-left transition-shadow hover:shadow-md"
        >
          <div className="flex aspect-square items-center justify-center overflow-hidden">
            <CanvasView
              rgba={maskToFilmRgba(ink.mask)}
              width={width}
              height={height}
              alt={`${ink.name} film positive`}
            />
          </div>
          <div className="mt-1.5 border-t border-ink-50 pt-1.5">
            <div className="flex items-center gap-1.5">
              <span className="tnum text-[10px] font-bold text-ink-400">{String(i + 1).padStart(2, "0")}</span>
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-900">{ink.name}</span>
            </div>
            <p className="tnum mt-0.5 truncate text-[10px] text-ink-400">
              {ink.mesh} mesh · {ink.halftone.enabled ? `${ink.halftone.lpi} LPI · ${ink.halftone.angle}°` : "solid"}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
