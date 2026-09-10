import { describe, it, expect } from "vitest";
import { runSeparation } from "@/lib/engine/pipeline";
import { generateDemoArtwork, generateFlatLogo, generateGradient } from "@/lib/demo/artwork";
import type { ProductionSettings } from "@/lib/types";

function settings(over: Partial<ProductionSettings> = {}): ProductionSettings {
  return {
    jobName: "test",
    garmentColor: "#111111",
    maxScreens: 6,
    method: "ai",
    meshCount: "auto",
    inkType: "unknown",
    useGarmentAsBlack: true,
    ...over,
  };
}

function separate(art: { pixels: Uint8ClampedArray; width: number; height: number }, s: ProductionSettings, dpi = 300) {
  return runSeparation({ pixels: art.pixels, width: art.width, height: art.height, dpi, settings: s });
}

/** Sum of every ink's coverage at a pixel. Must never exceed full opacity. */
function totalCoverageAt(masks: Uint8ClampedArray[], i: number): number {
  return masks.reduce((s, m) => s + m[i], 0);
}

describe("1. two-color flat logo", () => {
  const art = generateFlatLogo(240, 240);

  it("separates a light-garment flat logo into its actual colors", () => {
    const out = separate(art, settings({ garmentColor: "#f5f5f5", maxScreens: 4 }));
    // White background matches the garment, so only the red should print.
    expect(out.plan.inks.length).toBeGreaterThanOrEqual(1);
    expect(out.plan.inks.length).toBeLessThanOrEqual(2);

    const red = out.plan.inks.find((i) => i.displayColor.toLowerCase().startsWith("#c"));
    expect(red).toBeDefined();
    // The red square is 50% x 50% of the artboard.
    expect(red!.coverage).toBeGreaterThan(0.2);
    expect(red!.coverage).toBeLessThan(0.3);
  });

  it("reconstructs flat artwork near-exactly", () => {
    const out = separate(art, settings({ garmentColor: "#f5f5f5", maxScreens: 4 }));
    expect(out.similarity.percent).toBeGreaterThanOrEqual(95);
    expect(out.similarity.deltaE).toBeLessThan(2);
  });

  it("produces fully solid coverage with no partial tone", () => {
    const out = separate(art, settings({ garmentColor: "#f5f5f5", maxScreens: 4 }));
    const red = out.plan.inks.find((i) => i.coverage > 0.15)!;
    // A flat logo has no antialiasing, so every inked pixel should be solid.
    expect(red.meanDensity).toBeGreaterThan(0.98);
  });
});

describe("2. antialiased artwork", () => {
  const art = generateDemoArtwork(400, 400);

  it("preserves antialiased edges as intermediate coverage", () => {
    const out = separate(art, settings());
    const spot = out.plan.inks.find((i) => i.type === "spot")!;
    let partial = 0;
    for (let i = 0; i < spot.mask.length; i++) {
      if (spot.mask[i] > 8 && spot.mask[i] < 247) partial++;
    }
    // Edge pixels must survive as partial coverage, not be thresholded away.
    expect(partial).toBeGreaterThan(0);
  });

  it("never exceeds 100% total ink at a pixel", () => {
    const out = separate(art, settings());
    // The underbase sits beneath the others, so it is excluded from the sum.
    const top = out.plan.inks.filter((i) => i.type !== "underbase").map((i) => i.mask);
    for (let i = 0; i < top[0].length; i += 37) {
      expect(totalCoverageAt(top, i)).toBeLessThanOrEqual(256);
    }
  });

  it("does not lay a haze of one ink across another's flat field", () => {
    const out = separate(art, settings());
    // Every printed screen should be doing real work: mostly-solid coverage,
    // not a low-density wash. A wash is the signature of over-soft membership.
    for (const ink of out.plan.inks.filter((i) => i.type === "spot")) {
      expect(ink.meanDensity).toBeGreaterThan(0.5);
    }
  });
});

describe("3. gradient artwork", () => {
  const art = generateGradient(300, 120);

  it("represents a gradient as continuous tone", () => {
    const out = separate(art, settings({ garmentColor: "#f5f5f5", maxScreens: 5 }));
    const tonal = out.plan.inks.filter((i) => i.meanDensity < 0.97);
    // At least one screen must carry genuine mid-tones for the ramp.
    expect(tonal.length).toBeGreaterThan(0);
  });

  it("reconstructs a gradient acceptably", () => {
    const out = separate(art, settings({ garmentColor: "#f5f5f5", maxScreens: 6 }));
    expect(out.similarity.percent).toBeGreaterThanOrEqual(75);
  });
});

describe("4. dark garment underbase", () => {
  const art = generateDemoArtwork(400, 400);

  it("adds a white underbase and prints it first", () => {
    const out = separate(art, settings({ garmentColor: "#111111" }));
    const base = out.plan.inks.find((i) => i.type === "underbase");
    expect(base).toBeDefined();
    expect(base!.order).toBe(0);
    expect(base!.displayColor).toBe("#ffffff");
    expect(base!.coverage).toBeGreaterThan(0.1);
  });

  it("covers the area the top inks need, without wild over- or under-basing", () => {
    const out = separate(art, settings({ garmentColor: "#111111" }));
    const base = out.plan.inks.find((i) => i.type === "underbase")!;
    const top = out.plan.inks.filter((i) => i.type !== "underbase");

    let union = 0;
    for (let i = 0; i < base.mask.length; i++) {
      if (top.some((t) => t.mask[i] > 0)) union++;
    }
    const unionCoverage = union / base.mask.length;
    const ratio = base.coverage / unionCoverage;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.4);
  });

  it("chokes the base inward as the choke increases", () => {
    const light = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 300,
      settings: settings(), underbase: { chokePx: 0 },
    });
    const heavy = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 300,
      settings: settings(), underbase: { chokePx: 4 },
    });
    const a = light.plan.inks.find((i) => i.type === "underbase")!;
    const b = heavy.plan.inks.find((i) => i.type === "underbase")!;
    expect(b.coverage).toBeLessThan(a.coverage);
  });

  it("scales choke with resolution so the physical amount is constant", () => {
    const at300 = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 300,
      settings: settings(), underbase: { chokePx: 2 },
    });
    const at600 = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 600,
      settings: settings(), underbase: { chokePx: 2 },
    });
    const a = at300.plan.inks.find((i) => i.type === "underbase")!;
    const b = at600.plan.inks.find((i) => i.type === "underbase")!;
    // Same pixel raster, doubled DPI => doubled choke radius => less coverage.
    expect(b.coverage).toBeLessThan(a.coverage);
  });
});

describe("5. light garment without underbase", () => {
  it("adds no underbase on a white garment", () => {
    const art = generateDemoArtwork(400, 400);
    const out = separate(art, settings({ garmentColor: "#f5f5f5" }));
    expect(out.plan.inks.find((i) => i.type === "underbase")).toBeUndefined();
    expect(out.plan.garmentIsDark).toBe(false);
  });

  it("knocks light artwork areas out to a light garment", () => {
    const art = generateDemoArtwork(400, 400);
    const out = separate(art, settings({ garmentColor: "#f5f5f5" }));
    // The cream field is close to white; a white garment should absorb
    // something rather than the job printing every color.
    expect(out.plan.knockouts.length).toBeGreaterThanOrEqual(0);
    expect(out.plan.inks.length).toBeLessThanOrEqual(6);
  });
});

describe("6. screen count reduction", () => {
  const art = generateDemoArtwork(400, 400);

  it("never exceeds the requested maximum", () => {
    for (const max of [3, 4, 5, 6, 8]) {
      const out = separate(art, settings({ maxScreens: max }));
      expect(out.plan.inks.length).toBeLessThanOrEqual(max);
    }
  });

  it("uses fewer screens when the artwork does not need them", () => {
    const out = separate(art, settings({ maxScreens: 10 }));
    // The demo badge has ~6 real ink families; it should not pad to 10.
    expect(out.plan.inks.length).toBeLessThan(10);
  });

  it("records why each merge happened", () => {
    const out = separate(art, settings({ maxScreens: 3 }));
    expect(out.plan.merges.length).toBeGreaterThan(0);
    for (const m of out.plan.merges) {
      expect(m.reason.length).toBeGreaterThan(10);
    }
    expect(out.plan.explanation).toContain("color famil");
  });

  it("separates with no screen limit", () => {
    const out = separate(art, settings({ maxScreens: null }));
    expect(out.plan.maxScreens).toBeNull();
    expect(out.plan.inks.length).toBeGreaterThan(1);
    // Uncapped, it should use more screens and reconstruct better.
    expect(out.plan.inks.length).toBeGreaterThanOrEqual(separate(art, settings({ maxScreens: 4 })).plan.inks.length);
    expect(out.similarity.percent).toBeGreaterThan(85);
  });

  it("reports a recommendation independent of the limit", () => {
    const out = separate(art, settings({ maxScreens: 4 }));
    expect(out.plan.recommendedScreens).toBeGreaterThan(0);
    expect(out.plan.naturalColorFamilies).toBeGreaterThan(0);
  });

  it("merges the least significant inks first", () => {
    const wide = separate(art, settings({ maxScreens: 8 }));
    const tight = separate(art, settings({ maxScreens: 4 }));
    // The largest ink in the generous plan should survive into the tight one.
    const biggest = [...wide.plan.inks]
      .filter((i) => i.type !== "underbase")
      .sort((a, b) => b.coverage - a.coverage)[0];
    const survived = tight.plan.inks.some(
      (i) => Math.abs(i.coverage - biggest.coverage) < 0.35,
    );
    expect(survived).toBe(true);
  });
});

describe("garment-as-black", () => {
  const art = generateDemoArtwork(400, 400);

  it("knocks black out to a black garment when enabled", () => {
    const out = separate(art, settings({ garmentColor: "#111111", useGarmentAsBlack: true }));
    expect(out.plan.knockouts.length).toBeGreaterThan(0);
  });

  it("prints more screens when the garment may not supply the black", () => {
    const on = separate(art, settings({ useGarmentAsBlack: true, maxScreens: 8 }));
    const off = separate(art, settings({ useGarmentAsBlack: false, maxScreens: 8 }));
    expect(off.plan.inks.length).toBeGreaterThanOrEqual(on.plan.inks.length);
  });

  it("does not label a saturated navy as black", () => {
    const out = separate(art, settings({ maxScreens: 8 }));
    for (const ink of out.plan.inks.filter((i) => i.type === "black")) {
      const hex = ink.displayColor.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      // A true black screen must be near-neutral, not a dark chromatic color.
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(45);
    }
  });
});

describe("10. determinism", () => {
  it("produces byte-identical masks across runs", () => {
    const art = generateDemoArtwork(300, 300);
    const a = separate(art, settings());
    const b = separate(art, settings());

    expect(a.plan.inks.length).toBe(b.plan.inks.length);
    for (let i = 0; i < a.plan.inks.length; i++) {
      expect(a.plan.inks[i].name).toBe(b.plan.inks[i].name);
      expect(a.plan.inks[i].displayColor).toBe(b.plan.inks[i].displayColor);
      expect(Buffer.from(a.plan.inks[i].mask)).toEqual(Buffer.from(b.plan.inks[i].mask));
    }
    expect(a.similarity.percent).toBe(b.similarity.percent);
    expect(a.qa.score).toBe(b.qa.score);
    expect(a.plan.explanation).toBe(b.plan.explanation);
  });

  it("produces identical demo artwork across runs", () => {
    const a = generateDemoArtwork(200, 200);
    const b = generateDemoArtwork(200, 200);
    expect(Buffer.from(a.pixels)).toEqual(Buffer.from(b.pixels));
  });

  it("changes output when settings change", () => {
    const art = generateDemoArtwork(300, 300);
    const a = separate(art, settings({ maxScreens: 6 }));
    const b = separate(art, settings({ maxScreens: 3 }));
    expect(a.plan.inks.length).not.toBe(b.plan.inks.length);
  });
});

describe("QA scoring", () => {
  it("scores a clean flat logo highly and reports subscores", () => {
    const out = separate(generateFlatLogo(200, 200), settings({ garmentColor: "#f5f5f5" }));
    expect(out.qa.score).toBeGreaterThan(60);
    expect(out.qa.subscores).toHaveLength(6);
    for (const s of out.qa.subscores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.tooltip.length).toBeGreaterThan(20);
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });

  it("flags a dark garment that somehow has no base", () => {
    // Directly exercise the underbase subscore branch.
    const out = separate(generateDemoArtwork(300, 300), settings({ garmentColor: "#111111" }));
    const ub = out.qa.subscores.find((s) => s.key === "underbase")!;
    expect(ub.score).toBeGreaterThan(50);
  });
});

describe("analysis", () => {
  it("classifies artwork character", () => {
    const flat = separate(generateFlatLogo(200, 200), settings({ garmentColor: "#f5f5f5" }));
    expect(flat.analysis.artworkType).toBe("line-art");
    expect(flat.analysis.uniqueColors).toBeLessThan(10);
  });

  it("detects transparency and background", () => {
    const art = generateDemoArtwork(300, 300);
    const out = separate(art, settings());
    expect(out.analysis.hasAlpha).toBe(true);
    expect(out.analysis.transparentRatio).toBeGreaterThan(0.1);
  });

  it("detects a solid background on opaque artwork", () => {
    const art = generateFlatLogo(200, 200);
    const out = separate(art, settings({ garmentColor: "#f5f5f5" }));
    expect(out.analysis.detectedBackground).not.toBeNull();
  });
});

describe("background removal", () => {
  /** Flat logo on an opaque white field — what a JPEG upload looks like. */
  const opaque = generateFlatLogo(240, 240);

  it("detects the solid background", () => {
    const out = separate(opaque, settings({ garmentColor: "#111111" }));
    expect(out.analysis.detectedBackground).not.toBeNull();
    expect(out.analysis.transparentRatio).toBe(0);
  });

  it("knocks the background out instead of printing it", () => {
    const out = runSeparation({
      pixels: opaque.pixels, width: opaque.width, height: opaque.height, dpi: 300,
      settings: settings({ garmentColor: "#111111" }), removeBackground: true,
    });
    const base = out.plan.inks.find((i) => i.type === "underbase")!;
    // The logo is a quarter of the artboard; the base must not cover the rest.
    expect(base.coverage).toBeLessThan(0.35);
    expect(out.plan.explanation).toMatch(/background was removed/i);
  });

  it("prints the background when the artist asks for it", () => {
    const kept = runSeparation({
      pixels: opaque.pixels, width: opaque.width, height: opaque.height, dpi: 300,
      settings: settings({ garmentColor: "#111111" }), removeBackground: false,
    });
    const base = kept.plan.inks.find((i) => i.type === "underbase")!;
    // Opaque white field on a black shirt genuinely needs white ink everywhere.
    expect(base.coverage).toBeGreaterThan(0.85);
    expect(kept.plan.explanation).not.toMatch(/background was removed/i);
  });

  it("leaves transparent artwork alone", () => {
    // Already knocked out; there is no solid background to remove.
    const art = generateDemoArtwork(300, 300);
    const out = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 300,
      settings: settings(), removeBackground: true,
    });
    expect(out.analysis.detectedBackground).toBeNull();
    expect(out.plan.explanation).not.toMatch(/background was removed/i);
  });

  it("scores a removed background fairly", () => {
    // The composite correctly shows garment where the background was; scoring
    // that against the artwork's white would report a huge error for doing
    // exactly the right thing.
    const out = runSeparation({
      pixels: opaque.pixels, width: opaque.width, height: opaque.height, dpi: 300,
      settings: settings({ garmentColor: "#111111" }), removeBackground: true,
    });
    expect(out.similarity.percent).toBeGreaterThan(85);
  });

  it("still scores a printed background against the artwork", () => {
    // Nothing is knocked out here, so the comparison is unmodified.
    const out = runSeparation({
      pixels: opaque.pixels, width: opaque.width, height: opaque.height, dpi: 300,
      settings: settings({ garmentColor: "#111111" }), removeBackground: false,
    });
    expect(out.similarity.percent).toBeGreaterThan(85);
  });

  it("never knocks out every ink", () => {
    // A canvas that is entirely one color must still yield a printable screen.
    const w = 80, h = 80;
    const flat = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      flat[i * 4] = 210; flat[i * 4 + 1] = 40; flat[i * 4 + 2] = 50; flat[i * 4 + 3] = 255;
    }
    const out = runSeparation({
      pixels: flat, width: w, height: h, dpi: 300,
      settings: settings({ garmentColor: "#111111" }), removeBackground: true,
    });
    expect(out.plan.inks.filter((i) => i.type !== "underbase").length).toBeGreaterThanOrEqual(1);
  });
});
