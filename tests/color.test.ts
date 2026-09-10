import { describe, it, expect } from "vitest";
import { rgbToLab, labToRgb, deltaE2000, relativeLuminance, hexToRgb, rgbToHex } from "@/lib/color/space";

describe("LAB conversion", () => {
  it("places reference colors correctly", () => {
    const white = rgbToLab(255, 255, 255);
    expect(white.L).toBeCloseTo(100, 2);
    expect(white.a).toBeCloseTo(0, 2);
    expect(white.b).toBeCloseTo(0, 2);

    expect(rgbToLab(0, 0, 0).L).toBeCloseTo(0, 4);

    const red = rgbToLab(255, 0, 0);
    expect(red.L).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);

    const blue = rgbToLab(0, 0, 255);
    expect(blue.L).toBeCloseTo(32.3, 1);
    expect(blue.b).toBeCloseTo(-107.86, 1);
  });

  it("round-trips RGB exactly", () => {
    for (const [r, g, b] of [[12, 34, 56], [200, 180, 140], [255, 0, 128], [7, 7, 7], [0, 255, 0]]) {
      expect(labToRgb(rgbToLab(r, g, b))).toEqual([r, g, b]);
    }
  });

  it("parses and formats hex", () => {
    expect(hexToRgb("#1a2a58")).toEqual([26, 42, 88]);
    expect(hexToRgb("#abc")).toEqual([170, 187, 204]);
    expect(rgbToHex(26, 42, 88)).toBe("#1a2a58");
  });

  it("orders luminance as expected", () => {
    expect(relativeLuminance(0, 0, 0)).toBeLessThan(relativeLuminance(128, 128, 128));
    expect(relativeLuminance(128, 128, 128)).toBeLessThan(relativeLuminance(255, 255, 255));
  });
});

describe("CIEDE2000", () => {
  // Sharma, Wu & Dalal (2005) verification data. These pairs specifically
  // exercise the hue-rotation and blue-region corrections that a naive
  // implementation gets wrong.
  const CASES: [number, number, number, number, number, number, number][] = [
    [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
    [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
    [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
    [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
    [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
    [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
    [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
    [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
    [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
    [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
    [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  ];

  it("matches the Sharma reference vectors", () => {
    for (const [L1, a1, b1, L2, a2, b2, expected] of CASES) {
      expect(deltaE2000({ L: L1, a: a1, b: b1 }, { L: L2, a: a2, b: b2 })).toBeCloseTo(expected, 3);
    }
  });

  it("is symmetric and zero for identical colors", () => {
    const x = rgbToLab(120, 45, 200);
    const y = rgbToLab(40, 180, 90);
    expect(deltaE2000(x, x)).toBeCloseTo(0, 6);
    expect(deltaE2000(x, y)).toBeCloseTo(deltaE2000(y, x), 6);
  });
});
