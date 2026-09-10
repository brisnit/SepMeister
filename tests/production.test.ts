import { describe, it, expect } from "vitest";
import {
  assessResolution, convertUnits, defaultProductionSize, effectiveDpi, filmSize,
  formatSize, fromInches, resizeProduction, smallestSheetFor, toInches,
  CM_PER_IN, TARGET_DPI,
} from "@/lib/production/size";
import type { ProductionSize } from "@/lib/types";

const size = (w: number, h: number, units: "in" | "cm" = "in", lockAspect = true): ProductionSize => ({
  widthIn: w, heightIn: h, units, lockAspect,
});

describe("unit conversion", () => {
  it("converts both directions", () => {
    expect(toInches(2.54, "cm")).toBeCloseTo(1, 6);
    expect(toInches(5, "in")).toBe(5);
    expect(fromInches(1, "cm")).toBeCloseTo(CM_PER_IN, 6);
    expect(fromInches(5, "in")).toBe(5);
  });

  it("changes display units without changing physical size", () => {
    const a = size(12, 15);
    const b = convertUnits(a, "cm");
    expect(b.widthIn).toBe(a.widthIn);
    expect(b.heightIn).toBe(a.heightIn);
    expect(b.units).toBe("cm");
    expect(formatSize(b)).toBe("30.48 × 38.10 cm");
  });
});

describe("effective resolution", () => {
  it("is pixels divided by physical width", () => {
    expect(effectiveDpi(3600, size(12, 15))).toBe(300);
    expect(effectiveDpi(1200, size(12, 15))).toBe(100);
  });

  it("computes the example from the brief", () => {
    // 12in wide from a 3744px file should read ~312 DPI.
    expect(Math.round(effectiveDpi(3744, size(12, 15.4)))).toBe(312);
  });

  it("returns zero rather than infinity for a degenerate size", () => {
    expect(effectiveDpi(1000, size(0, 0))).toBe(0);
  });
});

describe("resolution assessment", () => {
  it("passes artwork at or above the target", () => {
    const a = assessResolution(3600, size(12, 12));
    expect(a.level).toBe("good");
    expect(a.message).toBeNull();
  });

  it("cautions between 200 and 300 DPI", () => {
    const a = assessResolution(2500, size(12, 12)); // ~208 DPI
    expect(a.level).toBe("caution");
    expect(a.message).toContain("208");
  });

  it("flags low resolution and gives a workable size", () => {
    // The brief's example: 2000px at 14in is ~143 DPI.
    const a = assessResolution(2000, size(14, 14));
    expect(a.level).toBe("low");
    expect(Math.round(a.dpi)).toBe(143);
    expect(a.message).toContain("143");
    // 2000px / 300 DPI = 6.67in.
    expect(a.targetWidthIn).toBeCloseTo(2000 / TARGET_DPI, 6);
    expect(a.recommendation).toContain("6.67");
  });

  it("reports in the artist's chosen units", () => {
    const a = assessResolution(2000, size(35.56, 35.56, "cm"));
    expect(a.message).toContain("cm");
  });
});

describe("resizing", () => {
  it("preserves the artwork's own aspect when locked", () => {
    const next = resizeProduction(size(10, 10), "width", 12, 1000, 1500);
    expect(next.widthIn).toBe(12);
    expect(next.heightIn).toBeCloseTo(18, 6);
  });

  it("drives width from height when locked", () => {
    const next = resizeProduction(size(10, 10), "height", 15, 1000, 1500);
    expect(next.heightIn).toBe(15);
    expect(next.widthIn).toBeCloseTo(10, 6);
  });

  it("does not drift across repeated edits", () => {
    // Deriving from the pixel aspect rather than the current inches means
    // round-tripping cannot accumulate error.
    let s = size(10, 15);
    for (let i = 0; i < 20; i++) {
      s = resizeProduction(s, "width", 12, 1000, 1500);
      s = resizeProduction(s, "height", 18, 1000, 1500);
    }
    expect(s.widthIn).toBeCloseTo(12, 6);
    expect(s.heightIn).toBeCloseTo(18, 6);
  });

  it("allows stretching when the lock is off", () => {
    const next = resizeProduction(size(10, 10, "in", false), "width", 20, 1000, 1000);
    expect(next.widthIn).toBe(20);
    expect(next.heightIn).toBe(10);
  });

  it("accepts values in the display units", () => {
    const next = resizeProduction(size(10, 10, "cm"), "width", 25.4, 1000, 1000);
    expect(next.widthIn).toBeCloseTo(10, 6);
  });

  it("refuses a degenerate size", () => {
    expect(resizeProduction(size(10, 10), "width", 0, 1000, 1000).widthIn).toBeGreaterThan(0);
  });
});

describe("default production size", () => {
  it("honours a declared resolution", () => {
    const s = defaultProductionSize(3600, 4500, 300);
    expect(s.widthIn).toBe(12);
    expect(s.heightIn).toBe(15);
  });

  it("assumes 300 DPI when the file declares nothing", () => {
    const s = defaultProductionSize(3000, 3000, null);
    expect(s.widthIn).toBe(10);
  });

  it("ignores an implausible declared resolution", () => {
    expect(defaultProductionSize(3000, 3000, 5).widthIn).toBe(10);
    expect(defaultProductionSize(3000, 3000, 100000).widthIn).toBe(10);
  });
});

describe("film sheet", () => {
  it("adds the margin on every side", () => {
    const f = filmSize(size(12, 15), 0.75);
    expect(f.widthIn).toBe(13.5);
    expect(f.heightIn).toBe(16.5);
  });

  it("finds the smallest sheet that fits, in either orientation", () => {
    expect(smallestSheetFor(8, 10)).toBe("8.5 × 11 in");
    expect(smallestSheetFor(10, 8)).toBe("8.5 × 11 in");
    expect(smallestSheetFor(12.5, 18)).toBe("13 × 19 in");
    // 13.5in exceeds the 13in dimension in both orientations, so it steps up.
    expect(smallestSheetFor(13.5, 16.5)).toBe("17 × 22 in");
    expect(smallestSheetFor(30, 40)).toBeNull();
  });
});
