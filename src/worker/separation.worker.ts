/**
 * Separation worker.
 *
 * All decoding, analysis, mask generation and export rendering happens here so
 * the main thread stays responsive. Artwork of any realistic size will block a
 * thread for hundreds of milliseconds to several seconds; doing that on the UI
 * thread would freeze scrolling, the progress display and every control.
 */

import { runSeparation, applyInkSettings } from "@/lib/engine/pipeline";
import { decodeInBrowser } from "@/lib/engine/browserDecode";
import { downscaleToWorking, resolveDpi, UploadError } from "@/lib/engine/decode";
import { compositeLayers } from "@/lib/engine/composite";
import { buildExportBundle } from "@/lib/film/bundle";
import { runFilmQa } from "@/lib/film/filmQa";
import { createLabelMeasurer } from "@/lib/film/pdf";
import { buildLayout } from "@/lib/film/layout";
import { planFilmRaster } from "@/lib/film/resample";
import { effectiveDpi, filmSize } from "@/lib/production/size";
import { maskToFilmGray } from "@/lib/film/render";
import { halftoneMask } from "@/lib/engine/halftone";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { AnalyzeResult } from "@/lib/engine/analyze";
import type { ImageAnalysis } from "@/lib/types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Narrows a typed array's backing store to ArrayBuffer for transfer.
 * Every buffer created in this worker is a plain ArrayBuffer; the cast only
 * discharges the SharedArrayBuffer branch of ArrayBufferLike.
 */
function buf(view: { buffer: ArrayBufferLike }): ArrayBuffer {
  return view.buffer as ArrayBuffer;
}

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

/** Drops the histogram and edge buffers, which the UI never reads. */
function stripAnalysis(a: AnalyzeResult): ImageAnalysis {
  const { bins: _bins, edges: _edges, luma: _luma, ...report } = a;
  return report;
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    switch (req.type) {
      case "decode": {
        const decoded = await decodeInBrowser(new Uint8Array(req.bytes), req.fileName);
        const scaled = downscaleToWorking(decoded.pixels, decoded.width, decoded.height);
        const working = scaled ?? decoded;
        const { dpi, assumed } = resolveDpi(decoded.dpi);
        post(
          {
            type: "decoded",
            requestId: req.requestId,
            width: working.width,
            height: working.height,
            pixels: buf(working.pixels),
            originalWidth: decoded.width,
            originalHeight: decoded.height,
            fileType: decoded.fileType,
            dpi,
            dpiAssumed: assumed,
            downscaled: !!scaled,
          },
          [buf(working.pixels)],
        );
        break;
      }

      case "separate": {
        const pixels = new Uint8ClampedArray(req.pixels);
        const out = runSeparation({
          pixels,
          width: req.width,
          height: req.height,
          dpi: req.dpi,
          settings: req.settings,
          underbase: req.underbase,
          highlightWhite: req.highlightWhite,
          removeBackground: req.removeBackground,
          halftoneDefaults: req.halftoneDefaults,
          onProgress: (e) => post({ type: "progress", requestId: req.requestId, stage: e.stage, message: e.message }),
        });

        // Masks are transferred rather than copied; the worker keeps its own
        // reference to the source pixels for subsequent edits.
        const masks = out.plan.inks.map((ink) => buf(ink.mask));
        post(
          {
            type: "separated",
            requestId: req.requestId,
            plan: {
              ...out.plan,
              inks: out.plan.inks.map((ink) => ({ ...ink, mask: undefined as never })),
            },
            masks,
            // Strip the heavy intermediate buffers; the UI needs only the report.
            analysis: stripAnalysis(out.analysis),
            qa: out.qa,
            similarity: out.similarity,
            composite: buf(out.compositeRgba),
          },
          [...masks, buf(out.compositeRgba)],
        );
        break;
      }

      case "composite": {
        const layers = req.layers.map((l) => ({
          mask: { width: req.width, height: req.height, data: new Uint8ClampedArray(l.mask) },
          color: l.color,
          visible: l.visible,
          role: l.role,
          opacity: l.opacity,
        }));
        const rgba = compositeLayers(layers, req.width, req.height, req.garmentColor, req.garmentAlpha);
        post({ type: "composited", requestId: req.requestId, rgba: buf(rgba) }, [buf(rgba)]);
        break;
      }

      case "adjustInk": {
        const adjusted = applyInkSettings(
          new Uint8ClampedArray(req.baseMask), req.width, req.height, req.settings, req.dpi,
        );
        post({ type: "inkAdjusted", requestId: req.requestId, inkId: req.inkId, mask: buf(adjusted) }, [buf(adjusted)]);
        break;
      }

      case "filmPreview": {
        const mask = { width: req.width, height: req.height, data: new Uint8ClampedArray(req.mask) };
        const gray = maskToFilmGray(mask, { halftone: req.halftone, dpi: req.dpi });
        // Expand to RGBA for direct canvas painting.
        const rgba = new Uint8ClampedArray(gray.length * 4);
        for (let i = 0; i < gray.length; i++) {
          const v = gray[i];
          rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
        }
        post({ type: "filmPreviewed", requestId: req.requestId, rgba: buf(rgba) }, [buf(rgba)]);
        break;
      }

      case "halftonePreview": {
        const mask = { width: req.width, height: req.height, data: new Uint8ClampedArray(req.mask) };
        const screened = halftoneMask(mask, req.params);
        post({ type: "halftonePreviewed", requestId: req.requestId, mask: buf(screened.data) }, [buf(screened.data)]);
        break;
      }

      case "export": {
        const plan = {
          ...req.plan,
          inks: req.plan.inks.map((ink, i) => ({ ...ink, mask: new Uint8ClampedArray(req.masks[i]) })),
        };
        const bundle = await buildExportBundle({
          metadata: req.metadata,
          plan,
          settings: req.settings,
          productionSize: req.productionSize,
          halftone: req.halftone,
          exportSettings: req.exportSettings,
          qa: req.qa,
          similarityPercent: req.similarityPercent,
          width: req.width,
          height: req.height,
          compositeRgba: new Uint8ClampedArray(req.composite),
          thumbnail: req.thumbnail
            ? { data: new Uint8Array(req.thumbnail.data), width: req.thumbnail.width, height: req.thumbnail.height }
            : null,
          originalThumbnail: req.originalThumbnail
            ? { data: new Uint8Array(req.originalThumbnail.data), width: req.originalThumbnail.width, height: req.originalThumbnail.height }
            : null,
          testPackage: req.testPackage,
          onProgress: (done, total, label) =>
            post({ type: "progress", requestId: req.requestId, stage: "export", message: label, done, total }),
        });
        post(
          {
            type: "exported", requestId: req.requestId, zip: buf(bundle.zip),
            fileName: bundle.fileName, films: bundle.films, qaReport: bundle.qaReport,
          },
          [buf(bundle.zip)],
        );
        break;
      }

      case "filmQa": {
        // Mirrors the geometry the export path will use, so the report the
        // artist reviews is the report that applies to the actual films.
        const plan = {
          ...req.plan,
          inks: req.plan.inks.map((ink, i) => ({ ...ink, mask: new Uint8ClampedArray(req.masks[i]) })),
        };
        const artDpi = effectiveDpi(req.width, req.productionSize);
        const layout = buildLayout({
          pixelWidth: req.width,
          pixelHeight: req.height,
          dpi: artDpi,
          marginIn: req.exportSettings.marginIn,
          includeRegistration: req.exportSettings.includeRegistration,
          includeCenterMarks: req.exportSettings.includeCenterMarks,
          includeCropMarks: req.exportSettings.includeCropMarks,
        });
        const raster = planFilmRaster(
          req.productionSize.widthIn, req.productionSize.heightIn,
          req.exportSettings.filmDpi, req.width, req.height,
        );
        const measure = await createLabelMeasurer();
        const report = runFilmQa({
          plan,
          layout,
          films: plan.inks.map((ink) => ({ name: ink.name, rasterWidth: raster.width, rasterHeight: raster.height })),
          expectedScreens: plan.inks.length,
          productionSize: req.productionSize,
          exportSettings: req.exportSettings,
          rasterDpi: raster.dpi,
          rasterCapped: raster.capped,
          artworkPixelWidth: req.width,
          artworkPixelHeight: req.height,
        }, measure);
        post({
          type: "filmQaReport", requestId: req.requestId, report,
          filmSizeIn: filmSize(req.productionSize, req.exportSettings.marginIn),
          rasterDpi: raster.dpi,
        });
        break;
      }
    }
  } catch (err) {
    const message =
      err instanceof UploadError ? err.message :
      err instanceof Error ? err.message : "Something went wrong while processing this artwork.";
    post({ type: "error", requestId: req.requestId, message, recoverable: err instanceof UploadError });
  }
};

export {};
