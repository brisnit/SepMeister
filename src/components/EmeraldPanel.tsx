"use client";

import { useState } from "react";
import type {
  AccuRipSetup, EmeraldFilmOutcome, EmeraldScreeningObserved, EmeraldTriState,
  EmeraldValidationResult, ScreeningMode,
} from "@/lib/types";
import { Button, Pill } from "./primitives";
import { hasEmeraldAnswers, emeraldVerdict } from "@/lib/store/emerald";

/**
 * Screening-mode selector.
 *
 * Presented as a genuine question rather than a setting with a default we
 * prefer. Neither answer is known to be right: screening here gives exact
 * control over dot and angle, screening in the RIP lets it use the dot it was
 * calibrated for on that printer and that film. Which one a shop wants is a
 * fact about their RIP, and the copy says so instead of nudging.
 */
export function ScreeningModeControl({
  value, onChange, disabled = false,
}: {
  value: ScreeningMode;
  onChange: (m: ScreeningMode) => void;
  disabled?: boolean;
}) {
  const options: [ScreeningMode, string, string][] = [
    [
      "sepwiz-screened",
      "SepWiz Screened",
      "SepWiz generates the final halftone structure. The RIP should pass the dots through unchanged.",
    ],
    [
      "continuous-tone",
      "Continuous Tone Spot",
      "SepWiz exports continuous-tone spot coverage and the RIP applies its own screening.",
    ],
  ];

  return (
    <fieldset>
      <legend className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Screening mode
      </legend>
      <div className="space-y-1.5">
        {options.map(([mode, label, detail]) => (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
            className={`ctl w-full rounded px-2.5 py-2 text-left ${value === mode ? "ctl-active" : ""}`}
          >
            <span className="block text-[12px] font-semibold">{label}</span>
            <span className="mt-0.5 block text-[10px] leading-snug opacity-70">{detail}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
        We do not know which one your RIP should be doing. Both are exported in the Emerald
        validation package so you can test them.
      </p>
    </fieldset>
  );
}

export interface EmeraldPanelProps {
  jobName: string;
  expectedPlates: number;
  result: EmeraldValidationResult;
  onChange: (next: EmeraldValidationResult) => void;
  onSave: () => void;
  onExport: (format: "json" | "csv") => void;
  onBuildPackage: () => void;
  onLoadControlTarget: () => void;
  onClose: () => void;
  saved: boolean;
  recordCount: number;
  building: boolean;
  buildLabel: string;
  /** Set once a package has been built this session, for the operator's benefit. */
  lastPackage: string | null;
}

export function EmeraldPanel(props: EmeraldPanelProps) {
  const { result, onChange } = props;
  const [showSetup, setShowSetup] = useState(false);
  const set = <K extends keyof EmeraldValidationResult>(key: K, value: EmeraldValidationResult[K]) =>
    onChange({ ...result, [key]: value });
  const setSetup = <K extends keyof AccuRipSetup>(key: K, value: AccuRipSetup[K]) =>
    onChange({ ...result, setup: { ...result.setup, [key]: value } });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-6">
      <div className="w-full max-w-xl rounded-lg border border-ink-200 bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold tracking-tight text-ink-900">Test in AccuRIP Emerald</h2>
            <p className="tnum mt-0.5 truncate text-[11px] text-ink-400">
              {props.jobName || "Untitled job"} · {props.expectedPlates} expected spot plates
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={props.onClose}>Close</Button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <section>
            <h3 className="text-[12px] font-bold text-ink-900">1 — Build the validation package</h3>
            <p className="mt-1 text-[11px] leading-snug text-ink-500">
              Both screening modes, the film positives, a production sheet, a preflight report and a
              printable checklist. Open the two spot PDFs in Emerald exactly as you would an
              Illustrator file.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={props.onBuildPackage} disabled={props.building}>
                {props.building ? props.buildLabel || "Building…" : "Build Emerald package"}
              </Button>
              <Button onClick={props.onLoadControlTarget} disabled={props.building}>
                Load EMERALD SPOT TEST
              </Button>
            </div>
            {props.lastPackage ? (
              <p className="mt-1.5 text-[10px] text-good">{props.lastPackage}</p>
            ) : null}
            <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
              EMERALD SPOT TEST is a built-in control target — six plates with known geometry and no
              customer artwork. Use it when you want the answer to be about the RIP rather than about
              the separation.
            </p>
          </section>

          <section className="border-t border-ink-50 pt-3.5">
            <h3 className="text-[12px] font-bold text-ink-900">2 — Record what Emerald did</h3>
            <p className="mt-1 text-[11px] leading-snug text-ink-500">
              Which export are you reporting on? The two can behave differently, and that difference
              is the result we are after.
            </p>
            <div className="mt-2">
              <Choice
                legend="Export tested"
                value={result.screeningMode}
                options={[
                  ["sepwiz-screened", "SepWiz Screened"],
                  ["continuous-tone", "Continuous Tone"],
                ] as [ScreeningMode, string][]}
                onChange={(v) => v && set("screeningMode", v)}
                clearable={false}
              />
            </div>
          </section>

          <Choice
            legend="File opened"
            emphasis
            value={result.fileOpened}
            options={[[true, "Yes"], [false, "No"]] as [boolean, string][]}
            onChange={(v) => set("fileOpened", v)}
          />

          <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Spot plates detected
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={64}
                  inputMode="numeric"
                  value={result.spotPlatesDetected ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") return set("spotPlatesDetected", null);
                    const n = Number.parseInt(raw, 10);
                    set("spotPlatesDetected", Number.isFinite(n) ? n : null);
                  }}
                  className="ctl tnum h-7 w-20 rounded px-2 text-[12px] outline-none focus:border-accent"
                />
                <span className="tnum text-[11px] text-ink-400">of {result.expectedSpotPlates} expected</span>
              </div>
            </label>

            <Choice
              legend="Plate names preserved"
              value={result.plateNamesPreserved}
              options={[["yes", "Yes"], ["no", "No"], ["partial", "Partial"]] as [EmeraldTriState, string][]}
              onChange={(v) => set("plateNamesPreserved", v)}
            />

            <Choice
              legend="Scale preserved (100%)"
              value={result.scalePreserved}
              options={[[true, "Yes"], [false, "No"]] as [boolean, string][]}
              onChange={(v) => set("scalePreserved", v)}
            />

            <Choice
              legend="Registration preserved"
              value={result.registrationPreserved}
              options={[[true, "Yes"], [false, "No"]] as [boolean, string][]}
              onChange={(v) => set("registrationPreserved", v)}
            />
          </div>

          {/* The single most important answer on the form. */}
          <div className="rounded border border-ink-100 bg-ink-25 px-3 py-2.5">
            <Choice
              legend="Screening behaviour"
              emphasis
              value={result.screeningBehavior}
              options={[
                ["sepwiz-preserved", "SepWiz screening preserved"],
                ["rip-rescreened", "Emerald rescreened"],
                ["unknown", "Unknown"],
              ] as [EmeraldScreeningObserved, string][]}
              onChange={(v) => set("screeningBehavior", v)}
            />
            <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
              Compare the dot on the film against the angles on the checklist. This decides who owns
              halftoning in the workflow, and nothing else on this form matters as much.
            </p>
          </div>

          <Choice
            legend="Film output"
            value={result.filmOutput}
            options={[
              ["correct", "Correct"],
              ["usable-with-changes", "Usable with changes"],
              ["failed", "Failed"],
            ] as [EmeraldFilmOutcome, string][]}
            onChange={(v) => set("filmOutput", v)}
          />

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Unexpected plates
            </span>
            <input
              type="text"
              value={result.unexpectedPlates}
              placeholder="Cyan, Magenta, Yellow, Black — or blank if none"
              onChange={(e) => set("unexpectedPlates", e.target.value)}
              className="ctl h-7 w-full rounded px-2 text-[12px] outline-none focus:border-accent"
            />
          </label>

          <button
            type="button"
            onClick={() => setShowSetup((v) => !v)}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            {showSetup ? "Hide" : "Record"} the AccuRIP setup ({Object.values(result.setup).filter((v) => v.trim()).length}/11 filled)
          </button>

          {showSetup ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-ink-50 pt-3.5">
              <p className="col-span-2 text-[10px] leading-snug text-ink-400">
                Nothing here is prefilled or guessed. These become the reference if direct output is
                ever attempted, and a guessed printer model would later read as a validated one.
              </p>
              <SetupField label="AccuRIP version" value={result.setup.accuRipVersion} onChange={(v) => setSetup("accuRipVersion", v)} />
              <SetupField label="Printer manufacturer" value={result.setup.printerManufacturer} onChange={(v) => setSetup("printerManufacturer", v)} />
              <SetupField label="Printer model" value={result.setup.printerModel} onChange={(v) => setSetup("printerModel", v)} />
              <SetupField label="Output resolution" value={result.setup.outputResolution} onChange={(v) => setSetup("outputResolution", v)} placeholder="1440 x 720" />
              <SetupField label="Film / media type" value={result.setup.mediaType} onChange={(v) => setSetup("mediaType", v)} />
              <SetupField label="Ink channel configuration" value={result.setup.inkChannelConfiguration} onChange={(v) => setSetup("inkChannelConfiguration", v)} placeholder="All channels black" />
              <SetupField label="Density settings" value={result.setup.densitySettings} onChange={(v) => setSetup("densitySettings", v)} />
              <SetupField label="Black ink strategy" value={result.setup.blackInkStrategy} onChange={(v) => setSetup("blackInkStrategy", v)} />
              <SetupField label="Page size" value={result.setup.pageSize} onChange={(v) => setSetup("pageSize", v)} placeholder="13 x 19 in" />
              <SetupField label="Halftone settings" value={result.setup.halftoneSettings} onChange={(v) => setSetup("halftoneSettings", v)} />
              <SetupField label="Custom Emerald presets" value={result.setup.customPresets} onChange={(v) => setSetup("customPresets", v)} span />
            </div>
          ) : null}

          <label className="block border-t border-ink-50 pt-3.5">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Notes
            </span>
            <textarea
              value={result.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="What Emerald showed in the plate list, anything it warned about, how the film compared to the Illustrator path…"
              className="ctl w-full rounded px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
          </label>

          {hasEmeraldAnswers(result) ? (
            <p className="rounded bg-ink-25 px-2.5 py-2 text-[11px] text-ink-600">
              <strong className="text-ink-900">Result:</strong> {emeraldVerdict(result)}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-4">
          <Button variant="primary" onClick={props.onSave} disabled={!hasEmeraldAnswers(result)}>
            Save result
          </Button>
          <Button onClick={() => props.onExport("json")} disabled={props.recordCount === 0}>Export JSON</Button>
          <Button onClick={() => props.onExport("csv")} disabled={props.recordCount === 0}>Export CSV</Button>
          {props.saved ? <span className="text-[12px] font-medium text-good">Saved</span> : null}
          {props.recordCount > 0 ? <Pill>{props.recordCount} recorded</Pill> : null}
          <span className="w-full text-[10px] leading-snug text-ink-400">
            Stored in this browser only. Nothing is uploaded, and no personal information is collected
            beyond what you type here.
          </span>
        </footer>
      </div>
    </div>
  );
}

function SetupField({
  label, value, onChange, placeholder, span = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  span?: boolean;
}) {
  return (
    <label className={`block ${span ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="ctl h-7 w-full rounded px-2 text-[12px] outline-none focus:border-accent"
      />
    </label>
  );
}

function Choice<T extends string | boolean>({
  legend, value, options, onChange, emphasis = false, clearable = true,
}: {
  legend: string;
  value: T | null;
  options: [T, string][];
  onChange: (v: T | null) => void;
  emphasis?: boolean;
  clearable?: boolean;
}) {
  return (
    <fieldset>
      <legend
        className={`mb-1.5 block ${
          emphasis
            ? "text-[13px] font-bold text-ink-900"
            : "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"
        }`}
      >
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            // Clicking the selected option clears it, so a mis-tap is undoable.
            onClick={() => onChange(clearable && value === v ? null : v)}
            className={`ctl rounded font-medium ${
              emphasis ? "h-9 px-3.5 text-[13px]" : "h-7 px-2.5 text-[12px]"
            } ${value === v ? "ctl-active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
