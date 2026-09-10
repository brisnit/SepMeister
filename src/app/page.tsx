"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExportSettings, FeedbackOutcome, FeedbackRecord, FilmQAReport, HalftoneSettings,
  ImageAnalysis, InkSeparation, JobMetadata, PressPreset, ProductionSettings,
  ProductionSize, QAResult, SeparationPlan,
} from "@/lib/types";
import { EngineClient, EngineError } from "@/lib/client/engineClient";
import { deterministicProvider, type OperationResult, type SeparationOperation } from "@/lib/ai/operations";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import { encodePng } from "@/lib/film/png";
import { collectProductionWarnings } from "@/lib/film/bundle";
import { applyPrintOrder } from "@/lib/engine/printOrder";
import { defaultProductionSize, effectiveDpi } from "@/lib/production/size";
import {
  BUILT_IN_PRESETS, applyPresetToSettings, duplicatePreset, halftoneFromPreset,
  loadPresets, meshForRole, presetFromCurrent, savePresets,
} from "@/lib/store/presets";
import { clearSession, loadSession, persistInk, reapplyInkState, saveSession, type PersistedSession } from "@/lib/store/session";
import { loadAccount, recordSeparation, saveAccount, defaultAccount } from "@/lib/store/account";
import { addFeedback, feedbackExportJson, feedbackForJob, loadFeedback, saveFeedback } from "@/lib/store/feedback";
import { isStorageAvailable, makeId } from "@/lib/store/storage";
import { UploadScreen, type UploadedInfo } from "@/components/UploadScreen";
import { SetupScreen } from "@/components/SetupScreen";
import { Workspace, type ViewMode } from "@/components/Workspace";
import { OutputCheck } from "@/components/OutputCheck";
import { ReviewMode } from "@/components/ReviewMode";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import type { UnderbaseView } from "@/components/UnderbasePanel";

type Stage = "upload" | "setup" | "workspace";

const DEFAULT_SETTINGS: ProductionSettings = {
  jobName: "untitled-job",
  garmentColor: "#111111",
  maxScreens: 6,
  method: "ai",
  meshCount: "auto",
  inkType: "unknown",
  useGarmentAsBlack: true,
};

const DEFAULT_HALFTONE: HalftoneSettings = { enabled: false, lpi: 45, shape: "round" };

const DEFAULT_EXPORT: ExportSettings = {
  filmDpi: 600, includeRegistration: true, includeCropMarks: true, includeCenterMarks: true, marginIn: 0.75,
};

function newMetadata(): JobMetadata {
  return { id: makeId("job"), jobName: "", customer: "", notes: "", createdAt: new Date().toISOString() };
}

/** Working artwork kept outside React state — these buffers are large. */
interface Source {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export default function Page() {
  const [stage, setStage] = useState<Stage>("upload");
  const [metadata, setMetadata] = useState<JobMetadata>(newMetadata);
  const [settings, setSettings] = useState<ProductionSettings>(DEFAULT_SETTINGS);
  const [halftone, setHalftone] = useState<HalftoneSettings>(DEFAULT_HALFTONE);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT);
  const [productionSize, setProductionSize] = useState<ProductionSize>({
    widthIn: 12, heightIn: 12, units: "in", lockAspect: true,
  });
  const [info, setInfo] = useState<UploadedInfo | null>(null);
  const [plan, setPlan] = useState<SeparationPlan | null>(null);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [qa, setQa] = useState<QAResult | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [compositeRgba, setCompositeRgba] = useState<Uint8ClampedArray | null>(null);
  const [originalRgba, setOriginalRgba] = useState<Uint8ClampedArray | null>(null);
  const [view, setView] = useState<ViewMode>("composite");
  const [underbaseView, setUnderbaseView] = useState<UnderbaseView>("off");
  const [selectedInk, setSelectedInk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportLabel, setExportLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commandResult, setCommandResult] = useState<(OperationResult & { input: string }) | null>(null);

  const [underbaseChoke, setUnderbaseChoke] = useState(1);
  const [underbaseStrength, setUnderbaseStrength] = useState(1);
  const [removeUnderBlack, setRemoveUnderBlack] = useState(true);
  const [highlightWhite, setHighlightWhite] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(true);

  const [presets, setPresets] = useState<PressPreset[]>(BUILT_IN_PRESETS);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [account, setAccount] = useState(defaultAccount);
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);

  const [showOutputCheck, setShowOutputCheck] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [qaReport, setQaReport] = useState<FilmQAReport | null>(null);
  const [rasterDpi, setRasterDpi] = useState<number | null>(null);

  const clientRef = useRef<EngineClient | null>(null);
  const sourceRef = useRef<Source | null>(null);
  /** Untouched masks from the last separation, for re-applying ink edits. */
  const baseMasksRef = useRef<Map<string, Uint8ClampedArray>>(new Map());
  /** Ink state restored from a previous session, applied after the next separation. */
  const pendingInkStateRef = useRef<PersistedSession["inks"] | null>(null);

  const client = () => {
    if (!clientRef.current) clientRef.current = new EngineClient();
    return clientRef.current;
  };

  useEffect(() => () => clientRef.current?.terminate(), []);

  // ---- Load local state on mount --------------------------------------
  useEffect(() => {
    const available = isStorageAvailable();
    setStorageAvailable(available);
    if (!available) return;

    setPresets(loadPresets());
    setAccount(loadAccount());
    setFeedback(loadFeedback());

    const saved = loadSession();
    if (!saved) return;

    setMetadata(saved.metadata);
    setSettings(saved.settings);
    setProductionSize(saved.productionSize);
    setHalftone(saved.halftone);
    setExportSettings(saved.exportSettings);
    setUnderbaseChoke(saved.underbase.choke);
    setUnderbaseStrength(saved.underbase.strength);
    setRemoveUnderBlack(saved.underbase.removeUnderBlack);
    setHighlightWhite(saved.underbase.highlightWhite);
    setRemoveBackground(saved.removeBackground);
    setActivePresetId(saved.presetId);
    pendingInkStateRef.current = saved.inks;

    if (saved.artworkFileName) {
      setNotice(
        `Restored your setup for “${saved.metadata.jobName || saved.artworkFileName}”. ` +
        `Artwork is not stored in the browser — drop ${saved.artworkFileName} again to continue.`,
      );
    }
  }, []);

  // ---- Persist session on change --------------------------------------
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!storageAvailable) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    // Debounced: slider drags would otherwise write on every frame.
    persistTimer.current = setTimeout(() => {
      const session: PersistedSession = {
        version: 1,
        savedAt: new Date().toISOString(),
        metadata,
        settings,
        productionSize,
        halftone,
        exportSettings,
        underbase: { choke: underbaseChoke, strength: underbaseStrength, removeUnderBlack, highlightWhite },
        removeBackground,
        inks: plan ? plan.inks.map(persistInk) : [],
        printOrder: plan ? [...plan.inks].sort((a, b) => a.order - b.order).map((i) => i.id) : [],
        artworkFileName: info?.fileName ?? null,
        artworkPixelWidth: sourceRef.current?.width ?? null,
        artworkPixelHeight: sourceRef.current?.height ?? null,
        presetId: activePresetId,
      };
      saveSession(session);
    }, 400);
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
  }, [
    storageAvailable, metadata, settings, productionSize, halftone, exportSettings,
    underbaseChoke, underbaseStrength, removeUnderBlack, highlightWhite, removeBackground,
    plan, info, activePresetId,
  ]);

  const fail = useCallback((err: unknown) => {
    const message =
      err instanceof EngineError || err instanceof Error
        ? err.message
        : "Something went wrong while processing this artwork.";
    setError(message);
    setBusy(false);
    setExportBusy(false);
  }, []);

  const makeThumbnail = useCallback((pixels: Uint8ClampedArray, w: number, h: number, max = 320) => {
    const scale = Math.min(1, max / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const out = new Uint8Array(tw * th * 4);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(w - 1, Math.floor(x / scale));
        const sy = Math.min(h - 1, Math.floor(y / scale));
        const s = (sy * w + sx) * 4;
        const d = (y * tw + x) * 4;
        out[d] = pixels[s]; out[d + 1] = pixels[s + 1]; out[d + 2] = pixels[s + 2]; out[d + 3] = pixels[s + 3];
      }
    }
    const png = encodePng(out, tw, th, "rgba");
    const blob = new Blob([png.slice().buffer as ArrayBuffer], { type: "image/png" });
    return { url: URL.createObjectURL(blob), width: tw, height: th };
  }, []);

  /** RGB thumbnail (no alpha) for PDF embedding. */
  const makeRgbThumb = useCallback((pixels: Uint8ClampedArray, w: number, h: number, max = 400) => {
    const scale = Math.min(1, max / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const rgb = new Uint8Array(tw * th * 3);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(w - 1, Math.floor(x / scale));
        const sy = Math.min(h - 1, Math.floor(y / scale));
        const s = (sy * w + sx) * 4;
        const d = (y * tw + x) * 3;
        const a = pixels[s + 3] / 255;
        // Composite onto white so transparency does not read as black.
        rgb[d] = Math.round(pixels[s] * a + 255 * (1 - a));
        rgb[d + 1] = Math.round(pixels[s + 1] * a + 255 * (1 - a));
        rgb[d + 2] = Math.round(pixels[s + 2] * a + 255 * (1 - a));
      }
    }
    return { data: rgb.buffer as ArrayBuffer, width: tw, height: th };
  }, []);

  const ingest = useCallback(
    async (pixels: Uint8ClampedArray, width: number, height: number, meta: {
      fileName: string; fileType: string; originalWidth: number; originalHeight: number;
      dpi: number; dpiAssumed: boolean; downscaled: boolean;
    }) => {
      sourceRef.current = { pixels, width, height };
      setOriginalRgba(pixels);

      const { analyzeArtwork } = await import("@/lib/engine/analyze");
      const quick = analyzeArtwork(pixels, width, height);
      const thumb = makeThumbnail(pixels, width, height);

      setInfo({
        fileName: meta.fileName,
        fileType: meta.fileType,
        width, height,
        originalWidth: meta.originalWidth,
        originalHeight: meta.originalHeight,
        dpi: meta.dpi,
        dpiAssumed: meta.dpiAssumed,
        downscaled: meta.downscaled,
        hasAlpha: quick.hasAlpha,
        detectedBackground: quick.detectedBackground,
        uniqueColors: quick.uniqueColors,
        uniqueColorsExact: quick.uniqueColorsExact,
        thumbnailUrl: thumb.url,
      });

      // Keep a restored job name; otherwise seed one from the file.
      setMetadata((m) =>
        m.jobName
          ? m
          : { ...m, jobName: meta.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "Untitled job" },
      );
      setProductionSize((s) =>
        // A restored session's size is the artist's decision; keep it.
        pendingInkStateRef.current ? s : defaultProductionSize(width, height, meta.dpiAssumed ? null : meta.dpi),
      );
      setBusy(false);
      setStage("setup");
    },
    [makeThumbnail],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      setBusyLabel("Decoding artwork");
      try {
        const bytes = await file.arrayBuffer();
        const res = await client().decode(bytes, file.name);
        await ingest(new Uint8ClampedArray(res.pixels), res.width, res.height, {
          fileName: file.name,
          fileType: res.fileType,
          originalWidth: res.originalWidth,
          originalHeight: res.originalHeight,
          dpi: res.dpi,
          dpiAssumed: res.dpiAssumed,
          downscaled: res.downscaled,
        });
      } catch (err) {
        fail(err);
      }
    },
    [ingest, fail],
  );

  const handleDemo = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    setBusyLabel("Generating demo artwork");
    await new Promise((r) => setTimeout(r, 0));
    try {
      const art = generateDemoArtwork(1000, 1000);
      await ingest(art.pixels, art.width, art.height, {
        fileName: "sep-ai-demo-badge.png",
        fileType: "PNG (generated)",
        originalWidth: art.width,
        originalHeight: art.height,
        dpi: 300,
        dpiAssumed: false,
        downscaled: false,
      });
    } catch (err) {
      fail(err);
    }
  }, [ingest, fail]);

  const runSeparation = useCallback(
    async (
      overrides?: Partial<ProductionSettings>,
      ubOverrides?: { choke?: number; strength?: number; removeUnderBlack?: boolean; highlightWhite?: boolean },
      halftoneOverride?: HalftoneSettings,
    ) => {
      const source = sourceRef.current;
      if (!source) return;
      const effective = { ...settings, ...overrides };
      const ht = halftoneOverride ?? halftone;
      setError(null);
      setBusy(true);
      setBusyLabel("Analyzing artwork");
      try {
        const res = await client().separate(
          {
            pixels: source.pixels.slice().buffer as ArrayBuffer,
            width: source.width,
            height: source.height,
            dpi: effectiveDpi(source.width, productionSize),
            settings: effective,
            underbase: {
              chokePx: ubOverrides?.choke ?? underbaseChoke,
              strength: ubOverrides?.strength ?? underbaseStrength,
              removeUnderBlack: ubOverrides?.removeUnderBlack ?? removeUnderBlack,
            },
            highlightWhite: ubOverrides?.highlightWhite ?? highlightWhite,
            removeBackground,
            halftoneDefaults: ht,
          },
          (message) => setBusyLabel(message),
        );

        let inks: InkSeparation[] = res.plan.inks.map((ink, i) => ({
          ...ink,
          mask: new Uint8ClampedArray(res.masks[i]),
        }));

        // Re-apply per-ink edits from a restored session, once.
        const pending = pendingInkStateRef.current;
        if (pending && pending.length > 0) {
          const { inks: restored, matched } = reapplyInkState(inks, pending);
          inks = restored;
          if (matched > 0) {
            const order = pending.slice().sort((a, b) => a.order - b.order).map((p) => p.id);
            inks = applyPrintOrder(inks, order);
            setNotice(`Restored ${matched} separation setting${matched === 1 ? "" : "s"} from your saved session.`);
          }
          pendingInkStateRef.current = null;
        }

        baseMasksRef.current = new Map(inks.map((ink) => [ink.id, new Uint8ClampedArray(ink.mask)]));

        setPlan({ ...res.plan, inks, printOrder: inks.map((i) => i.id) });
        setAnalysis(res.analysis);
        setQa(res.qa);
        setSimilarity(res.similarity.percent);
        setCompositeRgba(new Uint8ClampedArray(res.composite));
        setSettings(effective);
        setHalftone(ht);
        setSelectedInk(null);
        setUnderbaseView("off");
        setView("composite");
        setStage("workspace");
        setBusy(false);
        setQaReport(null);

        setAccount((a) => {
          const next = recordSeparation(a);
          saveAccount(next);
          return next;
        });
      } catch (err) {
        fail(err);
      }
    },
    [
      settings, halftone, productionSize, underbaseChoke, underbaseStrength,
      removeUnderBlack, highlightWhite, removeBackground, fail,
    ],
  );

  const recomposite = useCallback(
    async (inks: InkSeparation[], garment: string) => {
      const source = sourceRef.current;
      if (!source) return;
      try {
        const res = await client().composite({
          width: source.width,
          height: source.height,
          garmentColor: garment,
          garmentAlpha: 1,
          layers: inks.map((ink) => ({
            mask: ink.mask.slice().buffer as ArrayBuffer,
            color: ink.displayColor,
            visible: ink.visible,
            role: ink.type === "underbase" ? ("substrate" as const) : ("ink" as const),
          })),
        });
        setCompositeRgba(new Uint8ClampedArray(res.rgba));
      } catch (err) {
        fail(err);
      }
    },
    [fail],
  );

  const updatePlan = useCallback(
    (next: SeparationPlan, recompose = true) => {
      setPlan(next);
      setQaReport(null);
      if (recompose) void recomposite(next.inks, next.garmentColor);
    },
    [recomposite],
  );

  const onToggleInk = useCallback((id: string) => {
    setPlan((p) => {
      if (!p) return p;
      const next = { ...p, inks: p.inks.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)) };
      void recomposite(next.inks, next.garmentColor);
      return next;
    });
  }, [recomposite]);

  const onUpdateInk = useCallback(
    async (id: string, patch: Partial<InkSeparation>) => {
      const source = sourceRef.current;
      const current = plan;
      if (!source || !current) return;
      setQaReport(null);

      if (patch.settings) {
        const baseMask = baseMasksRef.current.get(id);
        if (baseMask) {
          try {
            const res = await client().adjustInk({
              inkId: id,
              baseMask: baseMask.slice().buffer as ArrayBuffer,
              width: source.width,
              height: source.height,
              dpi: effectiveDpi(source.width, productionSize),
              settings: patch.settings,
            });
            const { maskStats } = await import("@/lib/engine/morphology");
            const mask = new Uint8ClampedArray(res.mask);
            const stats = maskStats({ width: source.width, height: source.height, data: mask });
            updatePlan({
              ...current,
              inks: current.inks.map((i) =>
                i.id === id ? { ...i, ...patch, mask, coverage: stats.coverage, meanDensity: stats.meanDensity } : i,
              ),
            });
            return;
          } catch (err) {
            fail(err);
            return;
          }
        }
      }

      updatePlan(
        { ...current, inks: current.inks.map((i) => (i.id === id ? { ...i, ...patch } : i)) },
        patch.displayColor !== undefined,
      );
    },
    [plan, productionSize, updatePlan, fail],
  );

  const onRemoveInk = useCallback((id: string) => {
    setPlan((p) => {
      if (!p || p.inks.length <= 1) return p;
      const inks = p.inks.filter((i) => i.id !== id).map((i, idx) => ({ ...i, order: idx }));
      const next = { ...p, inks, printOrder: inks.map((i) => i.id) };
      void recomposite(inks, next.garmentColor);
      return next;
    });
    setSelectedInk((s) => (s === id ? null : s));
    setQaReport(null);
  }, [recomposite]);

  const onMergeInk = useCallback((sourceId: string, targetId: string) => {
    setPlan((p) => {
      if (!p) return p;
      const src = p.inks.find((i) => i.id === sourceId);
      const tgt = p.inks.find((i) => i.id === targetId);
      if (!src || !tgt) return p;
      const merged = new Uint8ClampedArray(tgt.mask);
      for (let i = 0; i < merged.length; i++) {
        if (src.mask[i] > merged[i]) merged[i] = src.mask[i];
      }
      baseMasksRef.current.set(targetId, new Uint8ClampedArray(merged));
      baseMasksRef.current.delete(sourceId);

      let inked = 0;
      let sum = 0;
      for (let i = 0; i < merged.length; i++) if (merged[i] > 0) { inked++; sum += merged[i]; }

      const inks = p.inks
        .filter((i) => i.id !== sourceId)
        .map((i) =>
          i.id === targetId
            ? {
                ...i,
                mask: merged,
                coverage: inked / merged.length,
                meanDensity: inked > 0 ? sum / inked / 255 : 0,
                note: `Merged with ${src.name}.`,
              }
            : i,
        )
        .map((i, idx) => ({ ...i, order: idx }));

      const next = {
        ...p,
        inks,
        printOrder: inks.map((i) => i.id),
        merges: [
          ...p.merges,
          { keptInk: tgt.displayColor, mergedInk: src.displayColor, deltaE: 0, reason: "Merged manually by the artist." },
        ],
      };
      void recomposite(inks, next.garmentColor);
      return next;
    });
    setSelectedInk(null);
    setQaReport(null);
  }, [recomposite]);

  const onReorderInk = useCallback((id: string, direction: -1 | 1) => {
    setPlan((p) => {
      if (!p) return p;
      const ordered = [...p.inks].sort((a, b) => a.order - b.order);
      const idx = ordered.findIndex((i) => i.id === id);
      const swap = idx + direction;
      if (idx < 0 || swap < 0 || swap >= ordered.length) return p;
      [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
      const renumbered = ordered.map((i, o) => ({ ...i, order: o }));
      const next = { ...p, inks: renumbered, printOrder: renumbered.map((i) => i.id) };
      void recomposite(renumbered, next.garmentColor);
      return next;
    });
    setQaReport(null);
  }, [recomposite]);

  const onApplyPrintOrder = useCallback((order: string[]) => {
    setPlan((p) => {
      if (!p) return p;
      const inks = applyPrintOrder(p.inks, order);
      const next = { ...p, inks, printOrder: order };
      void recomposite(inks, next.garmentColor);
      return next;
    });
    setQaReport(null);
  }, [recomposite]);

  /** Spreads an angle set across the screens, keeping each screen's other settings. */
  const onApplyAngles = useCallback((angles: number[], label: string) => {
    setPlan((p) => {
      if (!p) return p;
      const ordered = [...p.inks].sort((a, b) => a.order - b.order);
      const byId = new Map(
        ordered.map((ink, i) => [ink.id, angles[i % angles.length]] as const),
      );
      return {
        ...p,
        inks: p.inks.map((ink) => ({
          ...ink,
          halftone: { ...ink.halftone, angle: byId.get(ink.id) ?? ink.halftone.angle },
        })),
      };
    });
    setQaReport(null);
    setNotice(`Applied the “${label}” angle set. Every screen can still be overridden individually.`);
  }, []);

  // ---- Presets ---------------------------------------------------------
  const onApplyPreset = useCallback((preset: PressPreset) => {
    const nextSettings = applyPresetToSettings(preset, settings);
    const nextHalftone = halftoneFromPreset(preset);
    setActivePresetId(preset.id);
    setUnderbaseChoke(preset.underbaseChoke);

    if (plan) {
      // Applying mesh and screening to the existing separation avoids a full
      // re-run when only the press configuration changed.
      setPlan((p) => {
        if (!p) return p;
        const ordered = [...p.inks].sort((a, b) => a.order - b.order);
        const angleFor = new Map(ordered.map((ink, i) => [ink.id, ink.halftone.angle] as const));
        return {
          ...p,
          inks: p.inks.map((ink) => ({
            ...ink,
            mesh: meshForRole(preset, ink.type),
            halftone: {
              // The base stays solid unless the artist explicitly screens it.
              enabled: preset.halftonesEnabled && ink.type !== "underbase",
              lpi: preset.defaultLpi,
              shape: preset.defaultDotShape,
              angle: angleFor.get(ink.id) ?? ink.halftone.angle,
            },
            settings: ink.type === "underbase"
              ? { ...ink.settings, choke: preset.underbaseChoke }
              : ink.settings,
          })),
        };
      });
      setHalftone(nextHalftone);
      setSettings(nextSettings);
      setQaReport(null);
      const changesSeparation =
        nextSettings.garmentColor !== settings.garmentColor ||
        nextSettings.maxScreens !== settings.maxScreens ||
        nextSettings.useGarmentAsBlack !== settings.useGarmentAsBlack;
      setNotice(
        changesSeparation
          ? `Applied “${preset.name}”. Garment or screen limit changed — rebuild the separation to apply it.`
          : `Applied “${preset.name}” to mesh and screening.`,
      );
    } else {
      setSettings(nextSettings);
      setHalftone(nextHalftone);
    }
  }, [settings, plan]);

  const persistPresets = useCallback((next: PressPreset[]) => {
    setPresets(next);
    savePresets(next);
  }, []);

  const onSavePreset = useCallback((name: string) => {
    const base = plan?.inks.find((i) => i.type === "underbase");
    const spot = plan?.inks.find((i) => i.type === "spot");
    const black = plan?.inks.find((i) => i.type === "black");
    const highlight = plan?.inks.find((i) => i.type === "highlight");
    const preset = presetFromCurrent(name, settings, halftone, {
      defaultMesh: spot?.mesh ?? 156,
      underbaseMesh: base?.mesh ?? 110,
      highlightMesh: highlight?.mesh ?? 230,
      detailMesh: black?.mesh ?? 230,
    }, underbaseChoke);
    persistPresets([...presets, preset]);
    setActivePresetId(preset.id);
    setNotice(`Saved preset “${preset.name}”.`);
  }, [plan, settings, halftone, underbaseChoke, presets, persistPresets]);

  const onDuplicatePreset = useCallback((preset: PressPreset) => {
    const copy = duplicatePreset(preset);
    persistPresets([...presets, copy]);
  }, [presets, persistPresets]);

  const onRenamePreset = useCallback((id: string, name: string) => {
    persistPresets(presets.map((p) => (p.id === id ? { ...p, name } : p)));
  }, [presets, persistPresets]);

  const onDeletePreset = useCallback((id: string) => {
    persistPresets(presets.filter((p) => p.id !== id));
    setActivePresetId((a) => (a === id ? null : a));
  }, [presets, persistPresets]);

  // ---- Operations ------------------------------------------------------
  const applyOperations = useCallback(
    async (ops: SeparationOperation[]) => {
      const settingsPatch: Partial<ProductionSettings> = {};
      const ubPatch: { choke?: number; strength?: number; removeUnderBlack?: boolean; highlightWhite?: boolean } = {};
      let halftonePatch: HalftoneSettings | null = null;
      let needsReseparation = false;

      for (const op of ops) {
        switch (op.action) {
          case "reduce_screen_count":
          case "increase_screen_count":
            settingsPatch.maxScreens = op.target;
            needsReseparation = true;
            break;
          case "set_garment_color":
            settingsPatch.garmentColor = op.color;
            needsReseparation = true;
            break;
          case "use_garment_as_black":
            settingsPatch.useGarmentAsBlack = op.enabled;
            needsReseparation = true;
            break;
          case "set_method":
            settingsPatch.method = op.method;
            needsReseparation = true;
            break;
          case "set_underbase_choke":
            setUnderbaseChoke(op.pixels);
            ubPatch.choke = op.pixels;
            needsReseparation = true;
            break;
          case "set_underbase_strength":
            setUnderbaseStrength(op.strength);
            ubPatch.strength = op.strength;
            needsReseparation = true;
            break;
          case "set_highlight_white":
            setHighlightWhite(op.enabled);
            ubPatch.highlightWhite = op.enabled;
            needsReseparation = true;
            break;
          case "remove_ink":
            onRemoveInk(op.inkId);
            break;
          case "merge_ink":
            onMergeInk(op.sourceInkId, op.targetInkId);
            break;
          case "rename_ink":
            void onUpdateInk(op.inkId, { name: op.name });
            break;
          case "set_ink_color":
            void onUpdateInk(op.inkId, { displayColor: op.color });
            break;
          case "set_ink_gain": {
            const ink = plan?.inks.find((i) => i.id === op.inkId);
            if (ink) void onUpdateInk(op.inkId, { settings: { ...ink.settings, gain: op.gain } });
            break;
          }
          case "set_ink_threshold": {
            const ink = plan?.inks.find((i) => i.id === op.inkId);
            if (ink) void onUpdateInk(op.inkId, { settings: { ...ink.settings, threshold: op.threshold } });
            break;
          }
          case "set_ink_choke": {
            const ink = plan?.inks.find((i) => i.id === op.inkId);
            if (ink) void onUpdateInk(op.inkId, { settings: { ...ink.settings, choke: op.pixels } });
            break;
          }
          case "set_ink_spread": {
            const ink = plan?.inks.find((i) => i.id === op.inkId);
            if (ink) void onUpdateInk(op.inkId, { settings: { ...ink.settings, spread: op.pixels } });
            break;
          }
          case "set_ink_mesh":
            void onUpdateInk(op.inkId, { mesh: op.mesh });
            break;
          case "set_ink_visible":
            onToggleInk(op.inkId);
            break;
          case "set_halftone": {
            const next: HalftoneSettings = {
              enabled: op.enabled,
              lpi: op.lpi ?? halftone.lpi,
              shape: op.shape ?? halftone.shape,
            };
            halftonePatch = next;
            setHalftone(next);
            // Apply to every screen, leaving the base solid.
            setPlan((p) =>
              p ? {
                ...p,
                inks: p.inks.map((ink) => ({
                  ...ink,
                  halftone: {
                    ...ink.halftone,
                    enabled: next.enabled && ink.type !== "underbase",
                    lpi: next.lpi,
                    shape: next.shape,
                  },
                })),
              } : p,
            );
            setQaReport(null);
            break;
          }
          case "set_mesh_safety_target": {
            setPlan((p) =>
              p ? {
                ...p,
                inks: p.inks.map((i) => {
                  const mesh = Math.min(i.mesh, op.mesh);
                  return {
                    ...i,
                    mesh,
                    halftone: { ...i.halftone, lpi: Math.min(i.halftone.lpi, Math.floor(mesh / 4)) },
                  };
                }),
              } : p,
            );
            setQaReport(null);
            break;
          }
          case "set_print_order":
            onApplyPrintOrder(op.inkIds);
            break;
        }
      }

      if (needsReseparation) {
        await runSeparation(settingsPatch, ubPatch, halftonePatch ?? undefined);
      }
    },
    [plan, halftone, runSeparation, onRemoveInk, onMergeInk, onUpdateInk, onToggleInk, onApplyPrintOrder],
  );

  const onCommand = useCallback(
    async (input: string) => {
      if (!plan) return;
      const result = await deterministicProvider.interpret(input, {
        inks: plan.inks.map((i) => ({ id: i.id, name: i.name, type: i.type })),
        currentScreenCount: plan.inks.length,
        maxScreens: plan.maxScreens,
        garmentColor: plan.garmentColor,
        underbaseChoke,
        meshCounts: plan.inks.map((i) => i.mesh),
      });
      setCommandResult({ ...result, input });
      if (result.understood) await applyOperations(result.operations);
    },
    [plan, underbaseChoke, applyOperations],
  );

  // ---- Output ----------------------------------------------------------
  const productionWarnings = useMemo(() => {
    if (!plan || !qa) return [];
    const source = sourceRef.current;
    // Passing the pixel count enables overlap-aware moire detection, so a
    // large job flags only the screens that genuinely beat against each other.
    return collectProductionWarnings(plan, qa, source ? source.width * source.height : undefined);
  }, [plan, qa]);

  const openOutputCheck = useCallback(async () => {
    if (!plan) return;
    const source = sourceRef.current;
    if (!source) return;
    setShowOutputCheck(true);
    setQaReport(null);
    try {
      const res = await client().filmQa({
        plan: { ...plan, inks: plan.inks.map(({ mask: _m, ...rest }) => rest) },
        masks: plan.inks.map((i) => i.mask.slice().buffer as ArrayBuffer),
        productionSize,
        exportSettings,
        width: source.width,
        height: source.height,
      });
      setQaReport(res.report);
      setRasterDpi(res.rasterDpi);
    } catch (err) {
      fail(err);
    }
  }, [plan, productionSize, exportSettings, fail]);

  const runExport = useCallback(async (testPackage: boolean) => {
    const source = sourceRef.current;
    if (!plan || !qa || !source || !compositeRgba) return;
    setExportBusy(true);
    setExportLabel(testPackage ? "Building test package" : "Preparing films");
    try {
      const res = await client().export(
        {
          metadata,
          plan: { ...plan, inks: plan.inks.map(({ mask: _mask, ...rest }) => rest) },
          masks: plan.inks.map((i) => i.mask.slice().buffer as ArrayBuffer),
          settings,
          productionSize,
          halftone,
          exportSettings,
          qa,
          similarityPercent: similarity ?? 0,
          width: source.width,
          height: source.height,
          composite: compositeRgba.slice().buffer as ArrayBuffer,
          thumbnail: makeRgbThumb(compositeRgba, source.width, source.height),
          originalThumbnail: testPackage ? makeRgbThumb(source.pixels, source.width, source.height, 900) : null,
          testPackage,
        },
        (message) => setExportLabel(message),
      );

      setQaReport(res.qaReport);
      const blob = new Blob([res.zip], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setExportBusy(false);
      setExportLabel("");
    } catch (err) {
      fail(err);
    }
  }, [plan, qa, compositeRgba, metadata, settings, productionSize, halftone, exportSettings, similarity, makeRgbThumb, fail]);

  // ---- Feedback --------------------------------------------------------
  const onSubmitFeedback = useCallback((data: {
    outcome: FeedbackOutcome;
    answers: Record<string, boolean | null>;
    whatChanged: string;
    notes: string;
  }) => {
    const source = sourceRef.current;
    if (!plan || !qa || !source) return;
    const inks = [...plan.inks].sort((a, b) => a.order - b.order);
    const record: FeedbackRecord = {
      id: makeId("fb"),
      jobId: metadata.id,
      jobName: metadata.jobName || "Untitled job",
      recordedAt: new Date().toISOString(),
      outcome: data.outcome,
      filmsRegistered: data.answers.filmsRegistered ?? null,
      underbasePrinted: data.answers.underbasePrinted ?? null,
      detailHeld: data.answers.detailHeld ?? null,
      colorsClose: data.answers.colorsClose ?? null,
      changedAnything: data.answers.changedAnything ?? null,
      whatChanged: data.whatChanged,
      notes: data.notes,
      snapshot: {
        screens: inks.length,
        garmentColor: plan.garmentColor,
        widthIn: productionSize.widthIn,
        heightIn: productionSize.heightIn,
        effectiveDpi: Math.round(effectiveDpi(source.width, productionSize)),
        sepScore: qa.score,
        similarity: similarity ?? 0,
        inks: inks.map((i) => ({
          name: i.name,
          mesh: i.mesh,
          lpi: i.halftone.enabled ? i.halftone.lpi : null,
          angle: i.halftone.enabled ? i.halftone.angle : null,
          shape: i.halftone.enabled ? i.halftone.shape : null,
        })),
      },
    };
    const next = addFeedback(feedback, record);
    setFeedback(next);
    saveFeedback(next);
  }, [plan, qa, metadata, productionSize, similarity, feedback]);

  const onExportFeedback = useCallback(() => {
    const json = feedbackExportJson(feedback);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sep-ai-feedback-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, [feedback]);

  const reset = useCallback(() => {
    setStage("upload");
    setPlan(null);
    setInfo(null);
    setError(null);
    setNotice(null);
    setCompositeRgba(null);
    setOriginalRgba(null);
    setQaReport(null);
    setMetadata(newMetadata());
    sourceRef.current = null;
    baseMasksRef.current.clear();
    pendingInkStateRef.current = null;
    clearSession();
  }, []);

  const onUnderbase = useCallback((patch: {
    choke?: number; strength?: number; removeUnderBlack?: boolean; highlightWhite?: boolean;
  }) => {
    if (patch.choke !== undefined) setUnderbaseChoke(patch.choke);
    if (patch.strength !== undefined) setUnderbaseStrength(patch.strength);
    if (patch.removeUnderBlack !== undefined) setRemoveUnderBlack(patch.removeUnderBlack);
    if (patch.highlightWhite !== undefined) setHighlightWhite(patch.highlightWhite);
  }, []);

  const source = sourceRef.current;
  const banner = error ?? notice;

  const Banner = banner ? (
    <div
      role={error ? "alert" : "status"}
      className={`fixed inset-x-0 top-0 z-[60] px-4 py-2 text-center text-[13px] font-medium text-white ${
        error ? "bg-red-600" : "bg-ink-800"
      }`}
    >
      {banner}
      <button
        onClick={() => { setError(null); setNotice(null); }}
        className="ml-3 underline"
      >
        Dismiss
      </button>
    </div>
  ) : null;

  if (stage === "upload" || !info) {
    return (
      <>
        {Banner}
        <UploadScreen
          onFile={handleFile}
          onDemo={handleDemo}
          busy={busy}
          busyLabel={busyLabel}
          error={error}
          info={info}
        />
      </>
    );
  }

  if (stage === "setup" || !plan || !analysis || !qa || !source) {
    return (
      <>
        {Banner}
        <SetupScreen
          info={info}
          settings={settings}
          metadata={metadata}
          productionSize={productionSize}
          presets={presets}
          activePresetId={activePresetId}
          marginIn={exportSettings.marginIn}
          onChange={setSettings}
          onMetadata={setMetadata}
          onProductionSize={setProductionSize}
          onApplyPreset={onApplyPreset}
          onSeparate={() => void runSeparation()}
          busy={busy}
          busyLabel={busyLabel}
          onBack={reset}
          removeBackground={removeBackground}
          onRemoveBackground={setRemoveBackground}
        />
      </>
    );
  }

  return (
    <>
      {Banner}
      <Workspace
        metadata={metadata}
        plan={plan}
        analysis={analysis}
        qa={qa}
        similarity={similarity}
        settings={settings}
        productionSize={productionSize}
        exportSettings={exportSettings}
        presets={presets}
        activePresetId={activePresetId}
        storageAvailable={storageAvailable}
        separationsCompleted={account.separationsCompleted}
        view={view}
        underbaseView={underbaseView}
        selectedInk={selectedInk}
        originalRgba={originalRgba}
        compositeRgba={compositeRgba}
        width={source.width}
        height={source.height}
        busy={busy}
        busyLabel={busyLabel}
        exportBusy={exportBusy}
        exportLabel={exportLabel}
        commandResult={commandResult}
        underbaseChoke={underbaseChoke}
        underbaseStrength={underbaseStrength}
        removeUnderBlack={removeUnderBlack}
        highlightWhite={highlightWhite}
        productionWarnings={productionWarnings}
        onMetadata={setMetadata}
        onView={setView}
        onUnderbaseView={setUnderbaseView}
        onSelectInk={setSelectedInk}
        onToggleInk={onToggleInk}
        onUpdateInk={onUpdateInk}
        onRemoveInk={onRemoveInk}
        onMergeInk={onMergeInk}
        onReorderInk={onReorderInk}
        onApplyPrintOrder={onApplyPrintOrder}
        onApplyAngles={onApplyAngles}
        onExportSettings={(e) => { setExportSettings(e); setQaReport(null); }}
        onProductionSize={(s) => { setProductionSize(s); setQaReport(null); }}
        onOpenOutputCheck={() => void openOutputCheck()}
        onOpenReview={() => setShowReview(true)}
        onOpenFeedback={() => setShowFeedback(true)}
        onCommand={onCommand}
        onBack={reset}
        onUnderbase={onUnderbase}
        onReseparate={() => void runSeparation()}
        onApplyPreset={onApplyPreset}
        onSavePreset={onSavePreset}
        onDuplicatePreset={onDuplicatePreset}
        onRenamePreset={onRenamePreset}
        onDeletePreset={onDeletePreset}
      />

      {showOutputCheck ? (
        <OutputCheck
          metadata={metadata}
          plan={plan}
          size={productionSize}
          exportSettings={exportSettings}
          qaReport={qaReport}
          warnings={productionWarnings}
          pixelWidth={source.width}
          rasterDpi={rasterDpi}
          busy={exportBusy}
          busyLabel={exportLabel}
          onExport={() => void runExport(false)}
          onTestPackage={() => void runExport(true)}
          onClose={() => setShowOutputCheck(false)}
        />
      ) : null}

      {showReview ? (
        <ReviewMode
          originalRgba={originalRgba}
          compositeRgba={compositeRgba}
          width={source.width}
          height={source.height}
          similarity={similarity}
          screenCount={plan.inks.length}
          garmentColor={plan.garmentColor}
          size={productionSize}
          jobName={metadata.jobName}
          customer={metadata.customer}
          onClose={() => setShowReview(false)}
        />
      ) : null}

      {showFeedback ? (
        <FeedbackPanel
          existing={feedbackForJob(feedback, metadata.id)}
          recordCount={feedback.length}
          onSubmit={onSubmitFeedback}
          onExport={onExportFeedback}
          onClose={() => setShowFeedback(false)}
        />
      ) : null}
    </>
  );
}
