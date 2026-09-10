import { describe, it, expect } from "vitest";
import {
  planUpscale, upscaleRgba, applyUpscale, MAX_UPSCALED_PIXELS, TARGET_WORKING_DPI,
} from "@/lib/engine/upscale";
import { runSeparation } from "@/lib/engine/pipeline";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import { resolveChokePixels } from "@/lib/engine/underbase";
import type { ProductionSettings } from "@/lib/types";

const SETTINGS: ProductionSettings = {
  jobName: "t", garmentColor: "#111111", maxScreens: 6,
  method: "ai", meshCount: "auto", inkType: "plastisol", useGarmentAsBlack: true,
};

describe("upscale planning", () => {
  it("does nothing when the artwork already resolves at target", () => {
    // 3600px across 12in is exactly 300 DPI.
    const p = planUpscale(3600, 3600, 12);
    expect(p.needed).toBe(false);
    expect(p.factor).toBe(1);
  });

  it("does nothing when the artwork exceeds target", () => {
    expect(planUpscale(7200, 7200, 12).needed).toBe(false);
  });

  it("plans the raster needed to reach 300 DPI", () => {
    // 1200px across 12in is 100 DPI; tripling gets to 300.
    const p = planUpscale(1200, 1200, 12);
    expect(p.needed).toBe(true);
    expect(p.targetWidth).toBe(3600);
    expect(p.targetHeight).toBe(3600);
    expect(p.resultingDpi).toBeCloseTo(TARGET_WORKING_DPI, 6);
    expect(p.capped).toBe(false);
  });

  it("preserves aspect ratio", () => {
    const p = planUpscale(1000, 1500, 10);
    expect(p.targetWidth / p.targetHeight).toBeCloseTo(1000 / 1500, 3);
  });

  it("skips a negligible upscale rather than softening for nothing", () => {
    // 3300px across 12in is 275 DPI — a 1.09x resample buys nothing.
    expect(planUpscale(3300, 3300, 12).needed).toBe(false);
  });

  it("caps an unreasonable raster and says it did", () => {
    // A large print from a tiny file would demand an enormous raster.
    const p = planUpscale(400, 400, 40);
    expect(p.capped).toBe(true);
    expect(p.targetWidth * p.targetHeight).toBeLessThanOrEqual(MAX_UPSCALED_PIXELS);
    expect(p.resultingDpi).toBeLessThan(TARGET_WORKING_DPI);
    // Never smaller than the original.
    expect(p.targetWidth).toBeGreaterThanOrEqual(400);
  });

  it("handles a degenerate print size without dividing by zero", () => {
    const p = planUpscale(1000, 1000, 0);
    expect(p.needed).toBe(false);
    expect(Number.isFinite(p.resultingDpi)).toBe(true);
  });
});

describe("bicubic resampling", () => {
  it("returns an independent copy at the same size", () => {
    const px = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    const out = upscaleRgba(px, 4, 4, 4, 4);
    expect(out).not.toBe(px);
    expect(Buffer.from(out)).toEqual(Buffer.from(px));
  });

  it("preserves a flat field exactly", () => {
    const w = 8;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) {
      px[i * 4] = 200; px[i * 4 + 1] = 40; px[i * 4 + 2] = 50; px[i * 4 + 3] = 255;
    }
    const out = upscaleRgba(px, w, w, 24, 24);
    for (let i = 0; i < 24 * 24; i++) {
      expect(out[i * 4]).toBe(200);
      expect(out[i * 4 + 1]).toBe(40);
      expect(out[i * 4 + 3]).toBe(255);
    }
  });

  it("keeps solid regions solid away from edges", () => {
    const w = 16;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const left = x < w / 2;
        px[p] = left ? 255 : 0;
        px[p + 1] = left ? 255 : 0;
        px[p + 2] = left ? 255 : 0;
        px[p + 3] = 255;
      }
    }
    const out = upscaleRgba(px, w, w, 64, 64);
    const at = (x: number, y: number) => out[(y * 64 + x) * 4];
    expect(at(4, 32)).toBe(255);
    expect(at(60, 32)).toBe(0);
  });

  it("does not drag colour out of transparent areas", () => {
    // Opaque red beside fully transparent green. Interpolating straight alpha
    // would fringe the red edge with green.
    const w = 8;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (x < w / 2) { px[p] = 200; px[p + 1] = 30; px[p + 2] = 40; px[p + 3] = 255; }
        else { px[p] = 0; px[p + 1] = 255; px[p + 2] = 0; px[p + 3] = 0; }
      }
    }
    const out = upscaleRgba(px, w, w, 32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const p = (y * 32 + x) * 4;
        // Wherever there is meaningful opacity, green must not have leaked in.
        if (out[p + 3] > 200) expect(out[p + 1]).toBeLessThan(90);
      }
    }
  });

  it("keeps channel values in range despite bicubic overshoot", () => {
    const art = generateDemoArtwork(64, 64);
    const out = upscaleRgba(art.pixels, 64, 64, 192, 192);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(255);
    }
  });

  it("is deterministic", () => {
    const art = generateDemoArtwork(48, 48);
    const a = upscaleRgba(art.pixels, 48, 48, 144, 144);
    const b = upscaleRgba(art.pixels, 48, 48, 144, 144);
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });

  it("holds edge contrast better than a linear resample would", () => {
    // A hard edge upscaled 4x: the transition should stay narrow.
    const w = 16;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const v = x < w / 2 ? 255 : 0;
        px[p] = v; px[p + 1] = v; px[p + 2] = v; px[p + 3] = 255;
      }
    }
    const out = upscaleRgba(px, w, w, 64, 64);
    // Count pixels in the mid range across the seam row.
    let transition = 0;
    for (let x = 0; x < 64; x++) {
      const v = out[(32 * 64 + x) * 4];
      if (v > 40 && v < 215) transition++;
    }
    // A 4x upscale of a step edge should blur across only a few pixels.
    expect(transition).toBeLessThanOrEqual(6);
  });
});

describe("applyUpscale", () => {
  it("passes artwork through untouched when no upscale is needed", () => {
    const art = generateDemoArtwork(64, 64);
    const plan = planUpscale(64, 64, 0.2); // already 320 DPI
    const out = applyUpscale(art.pixels, 64, 64, plan);
    expect(out.width).toBe(64);
    expect(Buffer.from(out.pixels)).toEqual(Buffer.from(art.pixels));
  });

  it("resamples to the planned size", () => {
    const art = generateDemoArtwork(64, 64);
    const plan = planUpscale(64, 64, 1); // 64 DPI -> 300
    const out = applyUpscale(art.pixels, 64, 64, plan);
    expect(out.width).toBe(plan.targetWidth);
    expect(out.pixels.length).toBe(plan.targetWidth * plan.targetHeight * 4);
  });
});

describe("what upscaling actually fixes", () => {
  /**
   * The concrete justification. Choke is specified in physical units and
   * converted against the working resolution, so on low-resolution artwork it
   * rounds away to nothing and the control silently does nothing at all.
   */
  it("choke rounds to zero at low working resolution", () => {
    expect(Math.round(resolveChokePixels(1, 143))).toBe(0);
    expect(Math.round(resolveChokePixels(1, 100))).toBe(0);
    // At 300 DPI the same request is a real pixel.
    expect(Math.round(resolveChokePixels(1, 300))).toBe(1);
  });

  it("underbase choke has no effect on low-resolution artwork", () => {
    // 400px separated as a 4in print is 100 DPI.
    const art = generateDemoArtwork(400, 400);
    const noChoke = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 100,
      settings: SETTINGS, underbase: { chokePx: 0 },
    });
    const withChoke = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 100,
      settings: SETTINGS, underbase: { chokePx: 1 },
    });
    const a = noChoke.plan.inks.find((i) => i.type === "underbase")!;
    const b = withChoke.plan.inks.find((i) => i.type === "underbase")!;
    // Identical: the choke request was rounded away entirely.
    expect(b.coverage).toBeCloseTo(a.coverage, 6);
  });

  it("choke works once the artwork is separated at 300 DPI", () => {
    const art = generateDemoArtwork(400, 400);
    const plan = planUpscale(400, 400, 4); // 100 DPI -> 300 DPI
    expect(plan.needed).toBe(true);
    const up = applyUpscale(art.pixels, 400, 400, plan);

    const noChoke = runSeparation({
      pixels: up.pixels, width: up.width, height: up.height, dpi: plan.resultingDpi,
      settings: SETTINGS, underbase: { chokePx: 0 },
    });
    const withChoke = runSeparation({
      pixels: up.pixels, width: up.width, height: up.height, dpi: plan.resultingDpi,
      settings: SETTINGS, underbase: { chokePx: 1 },
    });
    const a = noChoke.plan.inks.find((i) => i.type === "underbase")!;
    const b = withChoke.plan.inks.find((i) => i.type === "underbase")!;
    // Now the choke actually pulls the base in.
    expect(b.coverage).toBeLessThan(a.coverage);
  });

  it("does not damage the separation", () => {
    // Upscaling must not make the reconstruction worse; it is a resample of
    // the same artwork, not a different design.
    const art = generateDemoArtwork(400, 400);
    const direct = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 100, settings: SETTINGS,
    });
    const plan = planUpscale(400, 400, 4);
    const up = applyUpscale(art.pixels, 400, 400, plan);
    const scaled = runSeparation({
      pixels: up.pixels, width: up.width, height: up.height, dpi: plan.resultingDpi, settings: SETTINGS,
    });
    // Fidelity must not regress...
    expect(scaled.similarity.percent).toBeGreaterThanOrEqual(direct.similarity.percent - 2);
    // ...though the screen count legitimately may differ: at finer resolution
    // a colour family that sat under the significance threshold can clear it.
    // What must hold is that the artist's limit is still respected.
    expect(scaled.plan.inks.length).toBeLessThanOrEqual(SETTINGS.maxScreens!);
    expect(scaled.plan.inks.length).toBeGreaterThanOrEqual(direct.plan.inks.length);
  });

  it("keeps the separation deterministic", () => {
    const art = generateDemoArtwork(200, 200);
    const plan = planUpscale(200, 200, 2);
    const a = applyUpscale(art.pixels, 200, 200, plan);
    const b = applyUpscale(art.pixels, 200, 200, plan);
    const ra = runSeparation({ pixels: a.pixels, width: a.width, height: a.height, dpi: plan.resultingDpi, settings: SETTINGS });
    const rb = runSeparation({ pixels: b.pixels, width: b.width, height: b.height, dpi: plan.resultingDpi, settings: SETTINGS });
    for (let i = 0; i < ra.plan.inks.length; i++) {
      expect(Buffer.from(ra.plan.inks[i].mask)).toEqual(Buffer.from(rb.plan.inks[i].mask));
    }
  });
});
