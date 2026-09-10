"use client";

import type { ExportSettings, FilmQAReport, InkSeparation, JobMetadata, ProductionSize, SeparationPlan } from "@/lib/types";
import { assessResolution, filmSize, formatSize, smallestSheetFor } from "@/lib/production/size";
import { Button, Pill } from "./primitives";
import { describeInkOutput } from "./SeparationStack";

/**
 * The last screen before film goes out.
 *
 * A printer is about to spend transparency, emulsion and press time on this.
 * Everything they would otherwise have to verify by opening the PDFs is
 * gathered here, and the QA section reports only checks that actually ran.
 */
export function OutputCheck({
  metadata, plan, size, exportSettings, qaReport, warnings, pixelWidth, rasterDpi,
  busy, busyLabel, onExport, onTestPackage, onClose,
}: {
  metadata: JobMetadata;
  plan: SeparationPlan;
  size: ProductionSize;
  exportSettings: ExportSettings;
  qaReport: FilmQAReport | null;
  warnings: string[];
  pixelWidth: number;
  rasterDpi: number | null;
  busy: boolean;
  busyLabel: string;
  onExport: () => void;
  onTestPackage: () => void;
  onClose: () => void;
}) {
  const inks = [...plan.inks].sort((a, b) => a.order - b.order);
  const sheet = filmSize(size, exportSettings.marginIn);
  const fits = smallestSheetFor(sheet.widthIn, sheet.heightIn);
  const resolution = assessResolution(pixelWidth, size);
  const blocking = qaReport?.failures ?? 0;

  const facts: [string, string][] = [
    ["Job", metadata.jobName || "Untitled job"],
    ...(metadata.customer ? ([["Customer", metadata.customer]] as [string, string][]) : []),
    ["Artwork", formatSize(size)],
    ["Screens", String(inks.length)],
    ["Film size", `${sheet.widthIn.toFixed(2)} × ${sheet.heightIn.toFixed(2)} in${fits ? ` (${fits})` : ""}`],
    ["Artwork detail", `${Math.round(resolution.dpi)} DPI at size`],
    ["Film output", rasterDpi ? `${Math.round(rasterDpi)} DPI` : `${exportSettings.filmDpi} DPI`],
    ["Registration", qaReport ? (blocking ? "Check failed" : "Verified") : "Checking…"],
    ["Output", "100% scale"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-6">
      <div className="w-full max-w-3xl rounded-lg border border-ink-200 bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-[15px] font-bold tracking-tight text-ink-900">Output check</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </header>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 px-5 py-4">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-ink-50 py-1">
              <dt className="text-[12px] text-ink-500">{k}</dt>
              <dd className="tnum truncate text-[12px] font-semibold text-ink-900">{v}</dd>
            </div>
          ))}
        </div>

        <section className="border-t border-ink-100 px-5 py-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Screens</h3>
          <ol className="space-y-0.5">
            {inks.map((ink, i) => (
              <li key={ink.id} className="flex items-center gap-2 border-b border-ink-50 py-1">
                <span className="tnum w-5 text-[11px] font-bold text-ink-400">{String(i + 1).padStart(2, "0")}</span>
                <span className="h-4 w-4 shrink-0 rounded-sm border border-ink-200" style={{ background: ink.displayColor }} />
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-ink-900">
                  {ink.name}
                </span>
                <span className="tnum shrink-0 text-[11px] text-ink-500">{describeInkOutput(ink)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-ink-100 px-5 py-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Film QA</h3>
          {qaReport ? (
            <ul className="space-y-1">
              {qaReport.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-0.5 shrink-0 text-[12px] font-bold ${
                      c.status === "pass" ? "text-good" : c.status === "warn" ? "text-warn" : "text-bad"
                    }`}
                  >
                    {c.status === "pass" ? "✓" : c.status === "warn" ? "▲" : "✕"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[12px] font-medium text-ink-800">{c.label}</span>
                    <span className="ml-1.5 text-[11px] text-ink-400">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-400">Running checks…</p>
          )}
        </section>

        {warnings.length > 0 ? (
          <section className="border-t border-ink-100 px-5 py-4">
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Production warnings
              <Pill tone="warn">{warnings.length}</Pill>
            </h3>
            <ul className="space-y-1">
              {warnings.map((w) => (
                <li key={w} className="flex gap-1.5 text-[11px] leading-snug text-ink-600">
                  <span aria-hidden className="text-warn">▲</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-ink-400">
              These are heuristics. Your press and workflow may handle any of them fine.
            </p>
          </section>
        ) : (
          <section className="border-t border-ink-100 px-5 py-3">
            <p className="text-[12px] text-good">No production warnings.</p>
          </section>
        )}

        <footer className="border-t border-ink-100 px-5 py-4">
          {blocking > 0 ? (
            <p className="mb-2.5 rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-900">
              {blocking} check{blocking === 1 ? "" : "s"} failed. Downloading is still allowed, but review the failures
              before committing film.
            </p>
          ) : null}
          {busy ? (
            <div>
              <div className="progress-sweep relative h-0.5 w-full overflow-hidden bg-ink-100" />
              <p className="mt-2 text-[12px] font-medium text-ink-600">{busyLabel}</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={onExport}>DOWNLOAD FILMS</Button>
              <Button size="lg" onClick={onTestPackage}>Download test package</Button>
            </div>
          )}
          <p className="mt-2.5 text-[11px] leading-snug text-ink-400">
            Print films at 100% — never &ldquo;fit to page&rdquo;. Exposure, dot gain and registration behaviour
            depend on your printer, RIP and press.
          </p>
        </footer>
      </div>
    </div>
  );
}
