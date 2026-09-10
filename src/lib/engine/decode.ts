/**
 * Artwork decoding and upload validation.
 *
 * Runs entirely in the browser -- artwork is never uploaded to a server, which
 * removes an entire class of privacy and retention concerns for customer-owned
 * designs, and means there are no temporary files to clean up.
 */

import { decodePng } from "@/lib/film/png";

export const MAX_FILE_BYTES = 40 * 1024 * 1024;
/** Above this, work is downscaled for interactive preview. */
export const MAX_WORKING_PIXELS = 4_000_000;

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/tiff", "image/webp"];
export const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"];

export interface DecodedArtwork {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  dpi: number | null;
  fileType: string;
  /** Set when the artwork was downscaled for interactive work. */
  scaledFrom?: { width: number; height: number };
}

export class UploadError extends Error {}

export function validateFile(file: { name: string; size: number; type: string }): void {
  if (file.size === 0) throw new UploadError("That file is empty.");
  if (file.size > MAX_FILE_BYTES) {
    throw new UploadError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
    );
  }
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  const typeOk = ACCEPTED_TYPES.includes(file.type.toLowerCase());
  const extOk = ACCEPTED_EXTENSIONS.includes(ext);
  if (!typeOk && !extOk) {
    throw new UploadError(`${ext || file.type || "That file"} isn't supported. Use PNG, JPG, TIFF or WebP.`);
  }
}

/** Sniffs the real format from magic bytes rather than trusting the extension. */
export function sniffFormat(bytes: Uint8Array): "png" | "jpeg" | "tiff" | "webp" | "unknown" {
  if (bytes.length < 12) return "unknown";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00)) return "tiff";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return "unknown";
}

/** Reads JPEG JFIF/EXIF density so physical size is known where declared. */
function jpegDpi(bytes: Uint8Array): number | null {
  // JFIF APP0: density units at offset 7 within the segment payload.
  for (let i = 2; i + 4 < bytes.length && i < 65536; ) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe0 && i + 4 + 12 < bytes.length) {
      const p = i + 4;
      const isJfif = bytes[p] === 0x4a && bytes[p + 1] === 0x46 && bytes[p + 2] === 0x49 && bytes[p + 3] === 0x46;
      if (isJfif) {
        const units = bytes[p + 7];
        const xd = (bytes[p + 8] << 8) | bytes[p + 9];
        if (xd > 0) {
          if (units === 1) return xd;            // dots per inch
          if (units === 2) return Math.round(xd * 2.54); // dots per cm
        }
      }
    }
    if (marker === 0xda) break; // start of scan
    i += 2 + len;
  }
  return null;
}

/**
 * Decodes a file into straight-alpha RGBA.
 *
 * PNG and TIFF are decoded in pure JS so the result is identical in the
 * worker and in Node tests. JPEG and WebP go through the platform decoder,
 * which is the only way to read them without shipping a full codec.
 */
export async function decodeArtwork(
  bytes: Uint8Array,
  fileName: string,
  deps: { decodeTiff: (b: Uint8Array) => DecodedArtwork | null; decodeBitmap: (b: Uint8Array, mime: string) => Promise<DecodedArtwork> },
): Promise<DecodedArtwork> {
  const format = sniffFormat(bytes);

  if (format === "unknown") {
    throw new UploadError(
      `${fileName} doesn't look like a PNG, JPG, TIFF or WebP file. It may be corrupt or renamed.`,
    );
  }

  if (format === "png") {
    const d = decodePng(bytes);
    return { width: d.width, height: d.height, pixels: d.pixels, dpi: d.dpi, fileType: "PNG" };
  }

  if (format === "tiff") {
    const d = deps.decodeTiff(bytes);
    if (!d) throw new UploadError("That TIFF uses a compression or layout Sep AI can't read. Try exporting as PNG.");
    return d;
  }

  const mime = format === "jpeg" ? "image/jpeg" : "image/webp";
  const d = await deps.decodeBitmap(bytes, mime);
  return { ...d, dpi: format === "jpeg" ? jpegDpi(bytes) : null, fileType: format.toUpperCase() };
}

/**
 * Box-downsamples to a working size.
 *
 * Separation quality does not improve past a few megapixels -- ink families
 * are large regions -- but processing time and memory scale linearly, so
 * oversized uploads are reduced for interactive work. Export re-runs at the
 * chosen output resolution.
 */
export function downscaleToWorking(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  maxPixels = MAX_WORKING_PIXELS,
): DecodedArtwork | null {
  const total = width * height;
  if (total <= maxPixels) return null;

  const scale = Math.sqrt(maxPixels / total);
  // Floor rather than round: rounding both axes up can push the result back
  // over the ceiling this function exists to enforce.
  const nw = Math.max(1, Math.floor(width * scale));
  const nh = Math.max(1, Math.floor(height * scale));
  const out = new Uint8ClampedArray(nw * nh * 4);

  const xRatio = width / nw;
  const yRatio = height / nh;

  for (let y = 0; y < nh; y++) {
    const sy0 = Math.floor(y * yRatio);
    const sy1 = Math.min(height, Math.max(sy0 + 1, Math.floor((y + 1) * yRatio)));
    for (let x = 0; x < nw; x++) {
      const sx0 = Math.floor(x * xRatio);
      const sx1 = Math.min(width, Math.max(sx0 + 1, Math.floor((x + 1) * xRatio)));

      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const p = (sy * width + sx) * 4;
          const av = pixels[p + 3] / 255;
          // Average in premultiplied space so transparent pixels do not
          // drag color toward black.
          r += pixels[p] * av;
          g += pixels[p + 1] * av;
          b += pixels[p + 2] * av;
          a += av;
          count++;
        }
      }
      const d = (y * nw + x) * 4;
      if (a > 0) {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(b / a);
      }
      out[d + 3] = Math.round((a / Math.max(1, count)) * 255);
    }
  }

  return { width: nw, height: nh, pixels: out, dpi: null, fileType: "", scaledFrom: { width, height } };
}

/**
 * Estimates working DPI.
 *
 * Falls back to 300 when the file declares nothing, which is the standard
 * assumption for screen-print artwork and is surfaced to the artist so they
 * can correct it rather than silently producing a wrongly-sized film.
 */
export function resolveDpi(declared: number | null): { dpi: number; assumed: boolean } {
  if (declared && declared >= 72 && declared <= 2400) return { dpi: declared, assumed: false };
  return { dpi: 300, assumed: true };
}
