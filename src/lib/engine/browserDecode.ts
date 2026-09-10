/**
 * Browser-side decoder bindings.
 *
 * Split from decode.ts so the pure logic there stays testable in Node without
 * pulling in DOM/worker globals.
 */

import UTIF from "utif";
import { decodeArtwork, UploadError, type DecodedArtwork } from "./decode";

/** TIFF via utif -- pure JS, so it works inside the worker. */
function decodeTiff(bytes: Uint8Array): DecodedArtwork | null {
  try {
    const ifds = UTIF.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    if (!ifds || ifds.length === 0) return null;
    const page = ifds[0];
    UTIF.decodeImage(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      page,
      ifds,
    );
    const rgba = UTIF.toRGBA8(page);
    const width = page.width;
    const height = page.height;
    if (!width || !height || !rgba || rgba.length < width * height * 4) return null;

    // TIFF resolution tags: 282 = XResolution, 296 = ResolutionUnit.
    let dpi: number | null = null;
    const xres = (page as unknown as Record<string, number[]>)["t282"];
    const unit = (page as unknown as Record<string, number[]>)["t296"];
    if (xres && xres.length > 0 && xres[0] > 0) {
      const u = unit && unit.length > 0 ? unit[0] : 2;
      dpi = u === 3 ? Math.round(xres[0] * 2.54) : Math.round(xres[0]);
    }

    return { width, height, pixels: new Uint8ClampedArray(rgba), dpi, fileType: "TIFF" };
  } catch {
    return null;
  }
}

/**
 * JPEG/WebP through the platform decoder.
 *
 * `createImageBitmap` + OffscreenCanvas is available in workers, which keeps
 * decoding off the main thread along with everything else.
 */
async function decodeBitmap(bytes: Uint8Array, mime: string): Promise<DecodedArtwork> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new UploadError("That image could not be decoded. It may be corrupt or use an unsupported variant.");
  }
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new UploadError("Could not create a drawing context to decode this image.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height);
  return { width, height, pixels: data.data, dpi: null, fileType: mime === "image/jpeg" ? "JPEG" : "WEBP" };
}

export function decodeInBrowser(bytes: Uint8Array, fileName: string): Promise<DecodedArtwork> {
  return decodeArtwork(bytes, fileName, { decodeTiff, decodeBitmap });
}
