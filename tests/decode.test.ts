import { describe, it, expect } from "vitest";
import {
  validateFile, sniffFormat, decodeArtwork, downscaleToWorking, resolveDpi,
  UploadError, MAX_FILE_BYTES,
} from "@/lib/engine/decode";
import { encodePng } from "@/lib/film/png";
import { generateFlatLogo } from "@/lib/demo/artwork";

const noDeps = {
  decodeTiff: () => null,
  decodeBitmap: async () => { throw new Error("bitmap decoding unavailable in tests"); },
};

describe("upload validation", () => {
  it("accepts supported formats", () => {
    expect(() => validateFile({ name: "art.png", size: 1000, type: "image/png" })).not.toThrow();
    expect(() => validateFile({ name: "art.TIF", size: 1000, type: "" })).not.toThrow();
    expect(() => validateFile({ name: "art.jpeg", size: 1000, type: "image/jpeg" })).not.toThrow();
  });

  it("rejects unsupported formats with a clear message", () => {
    expect(() => validateFile({ name: "art.psd", size: 1000, type: "image/vnd.adobe.photoshop" }))
      .toThrow(UploadError);
    try {
      validateFile({ name: "art.psd", size: 1000, type: "" });
    } catch (e) {
      expect((e as Error).message).toMatch(/PNG, JPG, TIFF or WebP/);
    }
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateFile({ name: "a.png", size: 0, type: "image/png" })).toThrow(/empty/i);
    expect(() => validateFile({ name: "a.png", size: MAX_FILE_BYTES + 1, type: "image/png" }))
      .toThrow(/limit/i);
  });
});

describe("format sniffing", () => {
  it("identifies formats from magic bytes, not the extension", () => {
    const png = encodePng(new Uint8Array(16), 4, 4, "gray");
    expect(sniffFormat(png)).toBe("png");
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpeg");
    expect(sniffFormat(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("tiff");
    expect(sniffFormat(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("tiff");
    expect(sniffFormat(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("webp");
    expect(sniffFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe("unknown");
  });

  it("rejects a file renamed to a supported extension", async () => {
    const bogus = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    await expect(decodeArtwork(bogus, "trojan.png", noDeps)).rejects.toThrow(/corrupt or renamed/);
  });
});

describe("PNG decode path", () => {
  it("decodes a real PNG to RGBA", async () => {
    const art = generateFlatLogo(32, 32);
    const png = encodePng(new Uint8Array(art.pixels.buffer.slice(0)), 32, 32, "rgba");
    const out = await decodeArtwork(png, "logo.png", noDeps);
    expect(out.width).toBe(32);
    expect(out.height).toBe(32);
    expect(out.fileType).toBe("PNG");
    expect(Buffer.from(out.pixels)).toEqual(Buffer.from(art.pixels));
  });

  it("reports a helpful message for unreadable TIFF", async () => {
    const tiff = new Uint8Array(64);
    tiff.set([0x49, 0x49, 0x2a, 0x00], 0);
    await expect(decodeArtwork(tiff, "art.tif", noDeps)).rejects.toThrow(/exporting as PNG/);
  });
});

describe("working resolution", () => {
  it("leaves small artwork untouched", () => {
    expect(downscaleToWorking(new Uint8ClampedArray(100 * 100 * 4), 100, 100)).toBeNull();
  });

  it("downscales oversized artwork below the working ceiling", () => {
    const w = 4000;
    const h = 3000;
    const px = new Uint8ClampedArray(w * h * 4);
    px.fill(200);
    const out = downscaleToWorking(px, w, h, 1_000_000);
    expect(out).not.toBeNull();
    expect(out!.width * out!.height).toBeLessThanOrEqual(1_000_000);
    // Aspect ratio must be preserved or the film would be distorted.
    expect(out!.width / out!.height).toBeCloseTo(w / h, 2);
    expect(out!.scaledFrom).toEqual({ width: w, height: h });
  });

  it("preserves color through downscaling", () => {
    const w = 200, h = 200;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = 200; px[i * 4 + 1] = 30; px[i * 4 + 2] = 40; px[i * 4 + 3] = 255;
    }
    const out = downscaleToWorking(px, w, h, 2500)!;
    for (let i = 0; i < out.width * out.height; i++) {
      expect(out.pixels[i * 4]).toBe(200);
      expect(out.pixels[i * 4 + 1]).toBe(30);
      expect(out.pixels[i * 4 + 3]).toBe(255);
    }
  });

  it("does not drag transparent pixels toward black", () => {
    // Half opaque red, half fully transparent. Averaging in straight alpha
    // would pull the color toward whatever the transparent pixels hold.
    const w = 40, h = 40;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const opaque = (i % w) < w / 2;
      px[i * 4] = 200; px[i * 4 + 1] = 30; px[i * 4 + 2] = 40;
      px[i * 4 + 3] = opaque ? 255 : 0;
    }
    const out = downscaleToWorking(px, w, h, 100)!;
    for (let i = 0; i < out.width * out.height; i++) {
      if (out.pixels[i * 4 + 3] > 0) {
        expect(out.pixels[i * 4]).toBeGreaterThan(150);
      }
    }
  });
});

describe("resolution resolution", () => {
  it("uses a declared resolution when plausible", () => {
    expect(resolveDpi(300)).toEqual({ dpi: 300, assumed: false });
    expect(resolveDpi(600)).toEqual({ dpi: 600, assumed: false });
  });

  it("falls back to 300 DPI and says so", () => {
    expect(resolveDpi(null)).toEqual({ dpi: 300, assumed: true });
    expect(resolveDpi(1)).toEqual({ dpi: 300, assumed: true });
    expect(resolveDpi(99999)).toEqual({ dpi: 300, assumed: true });
  });
});
