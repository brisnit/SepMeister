/**
 * Worker message protocol.
 *
 * Every payload that carries pixel data uses ArrayBuffer so it can be
 * transferred rather than structurally cloned. Copying multi-megabyte masks on
 * every interaction is the difference between a responsive workspace and a
 * stuttering one.
 */

import type {
  DotShape, ExportSettings, FilmQAReport, HalftoneSettings, ImageAnalysis, InkSeparation,
  JobMetadata, ProductionSettings, ProductionSize, QAResult, SeparationPlan,
} from "@/lib/types";
import type { HalftoneParams } from "@/lib/engine/halftone";
import type { UnderbaseOptions } from "@/lib/engine/underbase";

/** Plan as it crosses the worker boundary: masks travel separately. */
export type TransferPlan = Omit<SeparationPlan, "inks"> & {
  inks: Omit<InkSeparation, "mask">[];
};

export type TransferAnalysis = Omit<ImageAnalysis, never>;

export type WorkerRequest =
  | { type: "decode"; requestId: number; bytes: ArrayBuffer; fileName: string }
  | {
      type: "separate";
      requestId: number;
      pixels: ArrayBuffer;
      width: number;
      height: number;
      dpi: number;
      settings: ProductionSettings;
      underbase?: Partial<UnderbaseOptions>;
      highlightWhite?: boolean;
      removeBackground?: boolean;
      halftoneDefaults?: HalftoneSettings;
    }
  | {
      type: "composite";
      requestId: number;
      width: number;
      height: number;
      garmentColor: string;
      garmentAlpha: number;
      layers: { mask: ArrayBuffer; color: string; visible: boolean; role?: "substrate" | "ink"; opacity?: number }[];
    }
  | {
      type: "adjustInk";
      requestId: number;
      inkId: string;
      baseMask: ArrayBuffer;
      width: number;
      height: number;
      dpi: number;
      settings: { threshold: number; gain: number; choke: number; spread: number };
    }
  | {
      type: "filmPreview";
      requestId: number;
      mask: ArrayBuffer;
      width: number;
      height: number;
      dpi: number;
      halftone: HalftoneParams | null;
    }
  | {
      type: "halftonePreview";
      requestId: number;
      mask: ArrayBuffer;
      width: number;
      height: number;
      params: HalftoneParams;
    }
  | {
      type: "export";
      requestId: number;
      metadata: JobMetadata;
      plan: TransferPlan;
      masks: ArrayBuffer[];
      settings: ProductionSettings;
      productionSize: ProductionSize;
      halftone: HalftoneSettings;
      exportSettings: ExportSettings;
      qa: QAResult;
      similarityPercent: number;
      width: number;
      height: number;
      composite: ArrayBuffer;
      thumbnail: { data: ArrayBuffer; width: number; height: number } | null;
      originalThumbnail: { data: ArrayBuffer; width: number; height: number } | null;
      testPackage?: boolean;
    }
  | {
      /** Runs the pre-export checks without producing an archive. */
      type: "filmQa";
      requestId: number;
      plan: TransferPlan;
      masks: ArrayBuffer[];
      productionSize: ProductionSize;
      exportSettings: ExportSettings;
      width: number;
      height: number;
    };

export type WorkerResponse =
  | {
      type: "decoded";
      requestId: number;
      width: number;
      height: number;
      pixels: ArrayBuffer;
      originalWidth: number;
      originalHeight: number;
      fileType: string;
      dpi: number;
      dpiAssumed: boolean;
      downscaled: boolean;
    }
  | {
      type: "separated";
      requestId: number;
      plan: TransferPlan;
      masks: ArrayBuffer[];
      analysis: TransferAnalysis;
      qa: QAResult;
      similarity: { deltaE: number; ssim: number; percent: number };
      composite: ArrayBuffer;
    }
  | { type: "composited"; requestId: number; rgba: ArrayBuffer }
  | { type: "inkAdjusted"; requestId: number; inkId: string; mask: ArrayBuffer }
  | { type: "filmPreviewed"; requestId: number; rgba: ArrayBuffer }
  | { type: "halftonePreviewed"; requestId: number; mask: ArrayBuffer }
  | {
      type: "exported";
      requestId: number;
      zip: ArrayBuffer;
      fileName: string;
      films: { name: string; pdfBytes: number; pngBytes: number; rasterWidth: number; rasterHeight: number }[];
      qaReport: FilmQAReport;
    }
  | { type: "filmQaReport"; requestId: number; report: FilmQAReport; filmSizeIn: { widthIn: number; heightIn: number }; rasterDpi: number }
  | { type: "progress"; requestId: number; stage: string; message: string; done?: number; total?: number }
  | { type: "error"; requestId: number; message: string; recoverable: boolean };

export type { DotShape, HalftoneParams };
