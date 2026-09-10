import { describe, it, expect } from "vitest";
import { halftoneMask, checkMeshSafety, halftoneQuality, defaultAngleFor, DEFAULT_ANGLES } from "@/lib/engine/halftone";
import { createMask, type Mask } from "@/lib/engine/morphology";

function solidMask(w: number, h: number, value: number): Mask {
  const m = createMask(w, h);
  m.data.fill(value);
  return m;
}

/** Fraction of the mask that is on. */
function onRatio(m: Mask): number {
  let on = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i] > 127) on++;
  return on / m.data.length;
}

describe("AM halftone screening", () => {
  const params = { lpi: 30, angle: 22.5, shape: "round" as const, dpi: 300 };

  it("outputs only pure black or pure white", () => {
    const m = solidMask(120, 120, 128);
    const out = halftoneMask(m, params);
    for (let i = 0; i < out.data.length; i++) {
      expect(out.data[i] === 0 || out.data[i] === 255).toBe(true);
    }
  });

  it("keeps solids solid and clears empty areas", () => {
    expect(onRatio(halftoneMask(solidMask(80, 80, 255), params))).toBe(1);
    expect(onRatio(halftoneMask(solidMask(80, 80, 0), params))).toBe(0);
  });

  it("produces dot area proportional to input tone", () => {
    // A screened 50% tone should cover roughly half the area.
    for (const [tone, expected] of [[64, 0.25], [128, 0.5], [191, 0.75]] as const) {
      const ratio = onRatio(halftoneMask(solidMask(200, 200, tone), params));
      expect(Math.abs(ratio - expected)).toBeLessThan(0.08);
    }
  });

  it("is monotonic across the tonal range", () => {
    let previous = -1;
    for (const tone of [0, 32, 64, 96, 128, 160, 192, 224, 255]) {
      const ratio = onRatio(halftoneMask(solidMask(150, 150, tone), params));
      expect(ratio).toBeGreaterThanOrEqual(previous);
      previous = ratio;
    }
  });

  it("is deterministic", () => {
    const m = solidMask(100, 100, 140);
    const a = halftoneMask(m, params);
    const b = halftoneMask(m, params);
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data));
  });

  it("changes the pattern with angle but not the coverage", () => {
    const m = solidMask(200, 200, 128);
    const a = halftoneMask(m, { ...params, angle: 15 });
    const b = halftoneMask(m, { ...params, angle: 75 });
    expect(Buffer.from(a.data)).not.toEqual(Buffer.from(b.data));
    expect(Math.abs(onRatio(a) - onRatio(b))).toBeLessThan(0.06);
  });

  it("supports every dot shape with comparable coverage", () => {
    const m = solidMask(200, 200, 128);
    const ratios = (["round", "ellipse", "square"] as const).map((shape) =>
      onRatio(halftoneMask(m, { ...params, shape })),
    );
    for (const r of ratios) expect(Math.abs(r - 0.5)).toBeLessThan(0.1);
    // Shapes must actually differ in pattern.
    const round = halftoneMask(m, { ...params, shape: "round" });
    const square = halftoneMask(m, { ...params, shape: "square" });
    expect(Buffer.from(round.data)).not.toEqual(Buffer.from(square.data));
  });

  it("makes dots larger at lower line counts", () => {
    const m = solidMask(300, 300, 128);
    const coarse = halftoneMask(m, { ...params, lpi: 20 });
    const fine = halftoneMask(m, { ...params, lpi: 60 });
    // Both hold ~50% area, but the coarse screen uses fewer, bigger dots.
    expect(Math.abs(onRatio(coarse) - onRatio(fine))).toBeLessThan(0.12);
    expect(Buffer.from(coarse.data)).not.toEqual(Buffer.from(fine.data));
  });
});

describe("mesh safety", () => {
  it("accepts a line count the mesh can hold", () => {
    const s = checkMeshSafety(45, 230);
    expect(s.safe).toBe(true);
    expect(s.message).toBeNull();
    expect(s.maxRecommendedLpi).toBe(57);
  });

  it("warns when the line count outruns the mesh", () => {
    const s = checkMeshSafety(65, 110);
    expect(s.safe).toBe(false);
    expect(s.message).toContain("110 mesh");
    expect(s.message).toContain("65 LPI");
    expect(s.maxRecommendedLpi).toBe(27);
  });

  it("escalates the wording when badly out of range", () => {
    expect(checkMeshSafety(80, 110).message).toContain("very difficult");
    expect(checkMeshSafety(25, 110).safe).toBe(true);
  });
});

describe("halftone quality", () => {
  it("reports too few tonal steps at low output resolution", () => {
    const q = halftoneQuality(55, 300);
    expect(q.adequate).toBe(false);
    expect(q.cellPx).toBeCloseTo(300 / 55, 4);
  });

  it("is adequate at high output resolution", () => {
    const q = halftoneQuality(55, 1200);
    expect(q.adequate).toBe(true);
    expect(q.greyLevels).toBeGreaterThan(100);
  });
});

describe("screen angles", () => {
  it("keeps consecutive screens well separated to avoid moire", () => {
    for (let i = 0; i < 3; i++) {
      const a = defaultAngleFor(i);
      const b = defaultAngleFor(i + 1);
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(30);
    }
  });

  it("cycles deterministically past the table length", () => {
    expect(defaultAngleFor(0)).toBe(defaultAngleFor(DEFAULT_ANGLES.length));
  });
});

describe("angle presets", () => {
  it("offers named sets without claiming any is universal", async () => {
    const { ANGLE_PRESETS } = await import("@/lib/engine/halftone");
    expect(ANGLE_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of ANGLE_PRESETS) {
      expect(p.angles.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(20);
      for (const a of p.angles) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(360);
      }
    }
  });

  it("cycles angles across more screens than the set holds", async () => {
    const { ANGLE_PRESETS, angleFromPreset } = await import("@/lib/engine/halftone");
    const p = ANGLE_PRESETS[0];
    expect(angleFromPreset(p, 0)).toBe(p.angles[0]);
    expect(angleFromPreset(p, p.angles.length)).toBe(p.angles[0]);
    expect(angleFromPreset(p, p.angles.length + 2)).toBe(p.angles[2 % p.angles.length]);
  });

  it("separates the spot set's first screens well", async () => {
    const { ANGLE_PRESETS, minimumAngleSeparation } = await import("@/lib/engine/halftone");
    const spot = ANGLE_PRESETS.find((p) => p.id === "spot-45")!;
    expect(minimumAngleSeparation(spot.angles.slice(0, 3))).toBeGreaterThanOrEqual(30);
  });

  it("accounts for the 90-degree symmetry of a halftone grid", async () => {
    const { minimumAngleSeparation } = await import("@/lib/engine/halftone");
    // 5 and 95 degrees produce the same grid, so they conflict completely.
    expect(minimumAngleSeparation([5, 95])).toBeCloseTo(0, 6);
    expect(minimumAngleSeparation([0, 45])).toBeCloseTo(45, 6);
    expect(minimumAngleSeparation([0, 89])).toBeCloseTo(1, 6);
  });

  it("reports conflicts only between enabled screens", async () => {
    const { findAngleConflicts } = await import("@/lib/engine/halftone");
    const screens = [
      { id: "a", label: "Cream", angle: 22.5, enabled: true },
      { id: "b", label: "Navy", angle: 25, enabled: true },
      { id: "c", label: "Base", angle: 22.5, enabled: false },
    ];
    const conflicts = findAngleConflicts(screens);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].a).toBe("Cream");
    expect(conflicts[0].b).toBe("Navy");
    expect(conflicts[0].separation).toBeCloseTo(2.5, 6);
  });

  it("finds no conflict in a well-spread set", async () => {
    const { findAngleConflicts } = await import("@/lib/engine/halftone");
    const screens = [22.5, 52.5, 82.5].map((angle, i) => ({
      id: String(i), label: `Ink ${i}`, angle, enabled: true,
    }));
    expect(findAngleConflicts(screens)).toHaveLength(0);
  });
});

describe("mesh recommendations", () => {
  it("gives an actionable recommendation for the brief's example", async () => {
    const { checkMeshSafety } = await import("@/lib/engine/halftone");
    // 110 mesh at 65 LPI is the case the brief calls out.
    const s = checkMeshSafety(65, 110);
    expect(s.safe).toBe(false);
    expect(s.severity).toBe("high");
    expect(s.message).toContain("110 mesh");
    expect(s.recommendation).toContain("LPI");
    // Practical ceiling for 110 mesh is ~27 LPI, so the range lands in the 20s-30s.
    expect(s.recommendedLpiRange[0]).toBeLessThanOrEqual(s.recommendedLpiRange[1]);
    expect(s.recommendedLpiRange[1]).toBeLessThanOrEqual(s.maxRecommendedLpi);
    expect(s.recommendedMesh).toBe(305);
  });

  it("suggests the finest common mesh that holds a line count", async () => {
    const { meshForLpi } = await import("@/lib/engine/halftone");
    expect(meshForLpi(25)).toBe(110);
    expect(meshForLpi(45)).toBe(180);
    expect(meshForLpi(55)).toBe(230);
    expect(meshForLpi(80)).toBeNull();
  });

  it("stays quiet when the combination is fine", async () => {
    const { checkMeshSafety } = await import("@/lib/engine/halftone");
    const s = checkMeshSafety(45, 230);
    expect(s.safe).toBe(true);
    expect(s.severity).toBe("ok");
    expect(s.message).toBeNull();
    expect(s.recommendation).toBeNull();
  });

  it("keeps the recommended range below the ceiling for margin", async () => {
    const { checkMeshSafety } = await import("@/lib/engine/halftone");
    for (const mesh of [110, 156, 180, 200, 230, 305]) {
      const s = checkMeshSafety(999, mesh);
      expect(s.recommendedLpiRange[1]).toBeLessThanOrEqual(s.maxRecommendedLpi);
      expect(s.recommendedLpiRange[0]).toBeGreaterThan(0);
    }
  });
});
