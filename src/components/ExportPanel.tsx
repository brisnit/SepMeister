"use client";

import type { ExportSettings, ProductionSize } from "@/lib/types";
import { Button, Field, SegmentedControl, Slider } from "./primitives";
import { ProductionSizeControl } from "./ProductionSizeControl";

const DPI_OPTIONS = [300, 600, 1200].map((v) => ({ value: v, label: String(v) }));

/**
 * Output geometry: how big the print is and how finely the film is rasterized.
 *
 * The two resolutions are shown separately because they mean different things.
 * The artwork's effective DPI is how much detail actually exists; the film DPI
 * is how finely the halftone dots are drawn. Raising the second never creates
 * detail the first does not have, and conflating them is how people end up
 * believing a 90 DPI file became a 1200 DPI film.
 */
export function ExportPanel({
  exportSettings, productionSize, pixelWidth, pixelHeight, onExportSettings, onProductionSize,
}: {
  exportSettings: ExportSettings;
  productionSize: ProductionSize;
  pixelWidth: number;
  pixelHeight: number;
  onExportSettings: (next: ExportSettings) => void;
  onProductionSize: (next: ProductionSize) => void;
}) {
  return (
    <section className="border-t border-ink-100 px-3 py-3">
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Print size &amp; output
      </h2>

      <ProductionSizeControl
        size={productionSize}
        pixelWidth={pixelWidth}
        pixelHeight={pixelHeight}
        marginIn={exportSettings.marginIn}
        onChange={onProductionSize}
      />

      <div className="mt-4 space-y-3.5 border-t border-ink-50 pt-3.5">
        <Field label="Film Resolution" hint={`${exportSettings.filmDpi} DPI`}>
          <SegmentedControl
            ariaLabel="Film raster resolution"
            options={DPI_OPTIONS}
            value={exportSettings.filmDpi}
            onChange={(v) => onExportSettings({ ...exportSettings, filmDpi: v })}
          />
          <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
            How finely halftone dots are drawn on film. Higher is smoother; it does not add artwork detail.
          </p>
        </Field>

        <Slider
          label="Registration margin" value={exportSettings.marginIn} min={0.4} max={1.5} step={0.05}
          onChange={(v) => onExportSettings({ ...exportSettings, marginIn: v })}
          format={(v) => `${v.toFixed(2)} in`}
          hint="Registration marks live in this band, clear of the artwork."
        />

        <div className="space-y-1.5">
          {([
            ["includeRegistration", "Registration targets"],
            ["includeCenterMarks", "Center marks"],
            ["includeCropMarks", "Crop marks"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-700">
              <input
                type="checkbox"
                checked={exportSettings[key]}
                onChange={(e) => onExportSettings({ ...exportSettings, [key]: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#5d5fef]"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The primary export action, kept separate from the settings above it so the
 * workspace can pin it to the bottom of the column. On a dense prepress screen
 * the main action must never be something you have to scroll to find.
 */
export function ExportAction({
  onReview, onSpotPdf, busy, spotBusy, busyLabel, warningCount,
}: {
  onReview: () => void;
  onSpotPdf: () => void;
  busy: boolean;
  spotBusy: boolean;
  busyLabel: string;
  warningCount: number;
}) {
  return (
    <div className="border-t border-ink-100 bg-surface px-3 py-3">
      {busy ? (
        <div>
          <div className="progress-sweep relative h-0.5 w-full overflow-hidden bg-ink-100" />
          <p className="mt-2 text-[12px] font-medium text-ink-600">{busyLabel}</p>
        </div>
      ) : (
        <>
          <Button variant="primary" size="lg" onClick={onReview} className="w-full">
            REVIEW &amp; DOWNLOAD FILMS
          </Button>
          <Button size="md" onClick={onSpotPdf} disabled={spotBusy} className="mt-1.5 w-full">
            {spotBusy ? "Building spot PDF…" : "DOWNLOAD SPOT PDF"}
          </Button>
        </>
      )}
      <p className="mt-2 text-[10px] leading-snug text-ink-400">
        {warningCount > 0
          ? `${warningCount} production warning${warningCount === 1 ? "" : "s"} to review before output. `
          : "Output check runs film QA before anything downloads. "}
        <span className="block pt-1">
          <strong className="text-ink-500">Films</strong> are black-on-white positives, one per screen, for
          printing to transparency. <strong className="text-ink-500">Spot PDF</strong> is one page of named
          separation plates, for a RIP.
        </span>
      </p>
    </div>
  );
}
