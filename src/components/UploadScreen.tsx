"use client";

import { useCallback, useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, UploadError, validateFile } from "@/lib/engine/decode";
import { Button, Pill } from "./primitives";

export interface UploadedInfo {
  fileName: string;
  fileType: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  dpi: number;
  dpiAssumed: boolean;
  downscaled: boolean;
  hasAlpha: boolean;
  detectedBackground: string | null;
  uniqueColors: number;
  uniqueColorsExact: boolean;
  thumbnailUrl: string;
}

export function UploadScreen({
  onFile, onDemo, busy, busyLabel, error, info,
}: {
  onFile: (file: File) => void;
  onDemo: () => void;
  busy: boolean;
  busyLabel: string;
  error: string | null;
  info: UploadedInfo | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setLocalError(null);
      try {
        validateFile({ name: file.name, size: file.size, type: file.type });
      } catch (err) {
        setLocalError(err instanceof UploadError ? err.message : "That file could not be read.");
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  const shown = localError ?? error;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <header className="mb-10">
        <div className="mb-8 flex items-center gap-2">
          <SepMark />
          <span className="text-[13px] font-bold tracking-tight text-ink-900">Sep AI</span>
        </div>
        <h1 className="text-[34px] font-bold leading-[1.1] tracking-tight text-ink-950">
          Separate artwork for screen printing
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-500">
          Drop a PNG, JPG, or TIFF and Sep AI will build a press-ready separation.
        </p>
      </header>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={`relative rounded-lg border-2 border-dashed bg-surface px-6 py-14 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-ink-200"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => accept(e.target.files?.[0])}
        />

        {busy ? (
          <div className="mx-auto max-w-xs">
            <div className="progress-sweep relative mx-auto h-0.5 w-full overflow-hidden bg-ink-100" />
            <p className="mt-4 text-[13px] font-medium text-ink-600">{busyLabel}</p>
          </div>
        ) : (
          <>
            <p className="text-[17px] font-semibold text-ink-900">Drop artwork here</p>
            <p className="my-3 text-[12px] uppercase tracking-[0.08em] text-ink-400">or</p>
            <Button variant="primary" onClick={() => inputRef.current?.click()}>Choose File</Button>
            <p className="mt-6 text-[12px] text-ink-400">
              PNG · JPG · TIFF · WebP — up to {MAX_FILE_BYTES / 1024 / 1024}MB
            </p>
          </>
        )}
      </div>

      {shown ? (
        <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
          {shown}
        </p>
      ) : null}

      {info ? <ArtworkSummary info={info} /> : null}

      <div className="mt-8 flex items-center gap-3 border-t border-ink-100 pt-6">
        <Button onClick={onDemo} disabled={busy}>Use demo artwork</Button>
        <p className="text-[12px] leading-snug text-ink-400">
          A generated nautical badge with linework, flat spots, and gradients — for testing the full pipeline.
        </p>
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-ink-400">
        Artwork is decoded and separated entirely in your browser. Nothing is uploaded to a server.
      </p>
    </main>
  );
}

function ArtworkSummary({ info }: { info: UploadedInfo }) {
  const rows: [string, string][] = [
    ["Dimensions", `${info.originalWidth} × ${info.originalHeight} px`],
    ["Resolution", `${info.dpi} DPI${info.dpiAssumed ? " (assumed)" : ""}`],
    ["File type", info.fileType],
    ["Transparency", info.hasAlpha ? "Yes" : "No"],
    ["Background", info.detectedBackground ?? (info.hasAlpha ? "Transparent" : "None detected")],
    ["Colors", `${info.uniqueColorsExact ? "" : ">"}${info.uniqueColors.toLocaleString()}`],
  ];
  return (
    <section className="mt-6 flex gap-5 rounded border border-ink-100 bg-surface p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={info.thumbnailUrl}
        alt={`Thumbnail of ${info.fileName}`}
        className="checkerboard h-24 w-24 shrink-0 rounded border border-ink-100 object-contain"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-2.5 flex items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-ink-900">{info.fileName}</p>
          {info.downscaled ? (
            <Pill tone="accent">Working at {info.width}×{info.height}</Pill>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-ink-50 py-0.5">
              <dt className="text-[12px] text-ink-400">{k}</dt>
              <dd className="tnum text-[12px] font-medium text-ink-800">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function SepMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="1" width="11" height="11" rx="1.5" fill="none" stroke="#5d5fef" strokeWidth="1.6" />
      <rect x="6" y="6" width="11" height="11" rx="1.5" fill="none" stroke="#16162e" strokeWidth="1.6" />
    </svg>
  );
}
