import { describe, it, expect } from "vitest";
import { runSeparation } from "@/lib/engine/pipeline";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import { collectProductionWarnings } from "@/lib/film/bundle";
import { computeOverlaps, findMoireRisks, assignAnglesByOverlap, SIGNIFICANT_OVERLAP } from "@/lib/engine/overlap";
import { parseCommand, type CommandContext } from "@/lib/ai/operations";
import { MAX_SCREENS, type ProductionSettings } from "@/lib/types";

function settings(over: Partial<ProductionSettings> = {}): ProductionSettings {
  return {
    jobName: "factory", garmentColor: "#111111", maxScreens: 16,
    method: "ai", meshCount: "auto", inkType: "plastisol", useGarmentAsBlack: true,
    ...over,
  };
}

/**
 * Artwork with many genuinely distinct colour families, so a high screen count
 * is a real request rather than the engine padding out a simple design.
 */
function manyColorArtwork(size = 320) {
  const px = new Uint8ClampedArray(size * size * 4);
  const palette: [number, number, number][] = [
    [240, 240, 240], [225, 200, 40], [230, 120, 30], [200, 40, 45],
    [150, 30, 90], [90, 40, 140], [40, 60, 160], [50, 130, 200],
    [40, 170, 170], [40, 150, 70], [120, 190, 60], [200, 190, 120],
    [140, 100, 60], [90, 70, 50], [110, 115, 120], [20, 20, 24],
  ];
  const cols = 4;
  const cell = size / cols;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = Math.min(palette.length - 1, Math.floor(y / cell) * cols + Math.floor(x / cell));
      const p = (y * size + x) * 4;
      px[p] = palette[idx][0];
      px[p + 1] = palette[idx][1];
      px[p + 2] = palette[idx][2];
      px[p + 3] = 255;
    }
  }
  return { pixels: px, width: size, height: size };
}

function separate(maxScreens: number | null, halftones = true) {
  const art = manyColorArtwork();
  return {
    art,
    out: runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 300,
      settings: settings({ maxScreens }),
      halftoneDefaults: { enabled: halftones, lpi: 45, shape: "round" },
    }),
  };
}

describe("high screen counts", () => {
  it("produces more screens when the press has more stations", () => {
    const six = separate(6).out;
    const sixteen = separate(16).out;
    expect(six.plan.inks.length).toBeLessThanOrEqual(6);
    expect(sixteen.plan.inks.length).toBeGreaterThan(six.plan.inks.length);
    expect(sixteen.plan.inks.length).toBeLessThanOrEqual(16);
  });

  it("honours a 16-screen limit exactly", () => {
    for (const max of [10, 12, 14, 16, 18]) {
      const out = separate(max).out;
      expect(out.plan.inks.length, `max ${max}`).toBeLessThanOrEqual(max);
    }
  });

  it("no longer caps an unlimited job at twelve", () => {
    const out = separate(null).out;
    expect(out.plan.maxScreens).toBeNull();
    // The old ceiling was 12; artwork with 16 families must be able to exceed it.
    expect(out.plan.inks.length).toBeGreaterThan(12);
    expect(out.plan.inks.length).toBeLessThanOrEqual(MAX_SCREENS);
  });

  it("recommends more than twelve screens when the artwork warrants it", () => {
    const out = separate(null).out;
    expect(out.plan.recommendedScreens).toBeGreaterThan(6);
    expect(out.plan.naturalColorFamilies).toBeGreaterThan(12);
  });

  it("reconstructs a many-colour design better with more screens", () => {
    expect(separate(16).out.similarity.percent)
      .toBeGreaterThan(separate(6).out.similarity.percent);
  });

  it("gives every screen a distinct name", () => {
    const out = separate(16).out;
    const names = out.plan.inks.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("stays deterministic at high counts", () => {
    const a = separate(16).out;
    const b = separate(16).out;
    expect(a.plan.inks.map((i) => i.name)).toEqual(b.plan.inks.map((i) => i.name));
    expect(a.plan.inks.map((i) => i.halftone.angle)).toEqual(b.plan.inks.map((i) => i.halftone.angle));
    for (let i = 0; i < a.plan.inks.length; i++) {
      expect(Buffer.from(a.plan.inks[i].mask)).toEqual(Buffer.from(b.plan.inks[i].mask));
    }
  });

  it("does not punish a large job for being large", () => {
    // A 16-station press running 16 screens is not inefficient.
    const out = separate(16).out;
    const efficiency = out.qa.subscores.find((s) => s.key === "efficiency")!;
    expect(efficiency.score).toBeGreaterThan(60);
  });

  it("still raises registration risk with screen count, but bounded", () => {
    const few = separate(4).out.qa.subscores.find((s) => s.key === "registration")!.score;
    const many = separate(16).out.qa.subscores.find((s) => s.key === "registration")!.score;
    // More screens genuinely is harder to register...
    expect(many).toBeLessThanOrEqual(few);
    // ...but the count penalty alone must not zero the score.
    expect(many).toBeGreaterThan(20);
    expect(separate(16).out.qa.subscores.find((s) => s.key === "registration")!.detail)
      .toMatch(/screens to align/);
  });
});

describe("low screen counts", () => {
  it("honours every count from one to eighteen", () => {
    for (let max = 1; max <= 18; max++) {
      const out = separate(max).out;
      expect(out.plan.inks.length, `max ${max} produced ${out.plan.inks.length}`).toBeLessThanOrEqual(max);
      expect(out.plan.inks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives exactly one screen when one is asked for", () => {
    const out = separate(1).out;
    expect(out.plan.inks).toHaveLength(1);
  });

  it("drops the underbase rather than exceeding a one-screen limit", () => {
    // A base plus an ink is two screens. On a one-colour job the ink prints
    // and the garment shows through everywhere else.
    const out = separate(1).out;
    expect(out.plan.garmentIsDark).toBe(true);
    expect(out.plan.inks.find((i) => i.type === "underbase")).toBeUndefined();
    expect(out.plan.explanation).not.toMatch(/underbase was added/i);
  });

  it("keeps the underbase as soon as there is room for it", () => {
    const out = separate(2).out;
    expect(out.plan.inks).toHaveLength(2);
    expect(out.plan.inks.find((i) => i.type === "underbase")).toBeDefined();
  });

  it("still reports what the artwork actually wanted", () => {
    const out = separate(1).out;
    // The recommendation is independent of the limit, so a one-screen job
    // still tells the artist the design has far more colour in it.
    expect(out.plan.recommendedScreens).toBeGreaterThan(1);
    expect(out.plan.explanation).toMatch(/color families/);
  });

  it("produces a usable single screen on a light garment too", () => {
    const art = manyColorArtwork();
    const out = runSeparation({
      pixels: art.pixels, width: art.width, height: art.height, dpi: 300,
      settings: settings({ maxScreens: 1, garmentColor: "#f5f5f5" }),
      halftoneDefaults: { enabled: false, lpi: 45, shape: "round" },
    });
    expect(out.plan.inks).toHaveLength(1);
    expect(out.plan.inks[0].coverage).toBeGreaterThan(0);
  });

  it("stays deterministic at one screen", () => {
    const a = separate(1).out;
    const b = separate(1).out;
    expect(a.plan.inks[0].name).toBe(b.plan.inks[0].name);
    expect(Buffer.from(a.plan.inks[0].mask)).toEqual(Buffer.from(b.plan.inks[0].mask));
  });
});

describe("angle assignment past the preset size", () => {
  it("reuses angles rather than inventing unusable ones", () => {
    // Only about six angles fit in 90 degrees at a usable spacing.
    const out = separate(16).out;
    const screened = out.plan.inks.filter((i) => i.halftone.enabled);
    expect(screened.length).toBeGreaterThan(6);
    const angles = new Set(screened.map((i) => i.halftone.angle));
    expect(angles.size).toBeLessThanOrEqual(6);
    for (const a of angles) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(90);
    }
  });

  it("spreads screens across the available angles", () => {
    const out = separate(16).out;
    const screened = out.plan.inks.filter((i) => i.halftone.enabled);
    const counts = new Map<number, number>();
    for (const i of screened) counts.set(i.halftone.angle, (counts.get(i.halftone.angle) ?? 0) + 1);
    // No angle should be badly over-subscribed while others sit unused.
    const max = Math.max(...counts.values());
    expect(max).toBeLessThanOrEqual(Math.ceil(screened.length / counts.size) + 1);
  });

  it("prefers to share an angle between screens that do not overlap", () => {
    // Two pairs: within a pair the masks overlap completely, across pairs not
    // at all. With two angles available, each pair must be split.
    const n = 100;
    const left = new Uint8ClampedArray(n);
    const right = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      left[i] = i < n / 2 ? 255 : 0;
      right[i] = i >= n / 2 ? 255 : 0;
    }
    const masks = [left, new Uint8ClampedArray(left), right, new Uint8ClampedArray(right)];
    const angles = assignAnglesByOverlap(masks, n, [22.5, 52.5]);
    // The two copies of `left` overlap fully, so they must differ.
    expect(angles[0]).not.toBe(angles[1]);
    expect(angles[2]).not.toBe(angles[3]);
  });

  it("keeps angles unique while they still fit", () => {
    const masks = [0, 1, 2].map(() => new Uint8ClampedArray(10).fill(255));
    const angles = assignAnglesByOverlap(masks, 10, [22.5, 52.5, 82.5]);
    expect(new Set(angles).size).toBe(3);
  });
});

describe("overlap measurement", () => {
  it("reports no overlap for disjoint screens", () => {
    const n = 200;
    const a = new Uint8ClampedArray(n);
    const b = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) { a[i] = i < 100 ? 255 : 0; b[i] = i >= 100 ? 255 : 0; }
    expect(computeOverlaps([a, b], n)).toHaveLength(0);
  });

  it("reports full overlap for identical screens", () => {
    const n = 200;
    const a = new Uint8ClampedArray(n).fill(255);
    const overlaps = computeOverlaps([a, new Uint8ClampedArray(a)], n);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].fraction).toBeCloseTo(1, 2);
  });

  it("measures against the smaller screen", () => {
    // A small ink sitting entirely inside a large one is fully overlapped.
    const n = 200;
    const big = new Uint8ClampedArray(n).fill(255);
    const small = new Uint8ClampedArray(n);
    for (let i = 0; i < 20; i++) small[i] = 255;
    const overlaps = computeOverlaps([big, small], n);
    expect(overlaps[0].fraction).toBeCloseTo(1, 2);
  });

  it("ignores faint edge fringe", () => {
    const n = 200;
    const a = new Uint8ClampedArray(n).fill(255);
    const fringe = new Uint8ClampedArray(n).fill(20);
    expect(computeOverlaps([a, fringe], n)).toHaveLength(0);
  });
});

describe("moire warnings at high screen counts", () => {
  const mask = (fill: number, n = 200) => new Uint8ClampedArray(n).fill(fill);

  it("warns when overlapping screens share an angle", () => {
    const risks = findMoireRisks([
      { label: "Red", angle: 22.5, screened: true, mask: mask(255) },
      { label: "Blue", angle: 22.5, screened: true, mask: mask(255) },
    ], 200);
    expect(risks).toHaveLength(1);
    expect(risks[0].separation).toBeCloseTo(0, 6);
    expect(risks[0].overlap).toBeGreaterThan(SIGNIFICANT_OVERLAP);
  });

  it("stays silent when screens sharing an angle never touch", () => {
    // This is the whole point at 16 screens: angle reuse is unavoidable, and
    // reuse between screens that do not overlap is harmless.
    const n = 200;
    const left = new Uint8ClampedArray(n);
    const right = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) { left[i] = i < 100 ? 255 : 0; right[i] = i >= 100 ? 255 : 0; }
    const risks = findMoireRisks([
      { label: "Red", angle: 22.5, screened: true, mask: left },
      { label: "Blue", angle: 22.5, screened: true, mask: right },
    ], n);
    expect(risks).toHaveLength(0);
  });

  it("ignores solid screens entirely", () => {
    const risks = findMoireRisks([
      { label: "Base", angle: 22.5, screened: false, mask: mask(255) },
      { label: "Red", angle: 22.5, screened: false, mask: mask(255) },
    ], 200);
    expect(risks).toHaveLength(0);
  });

  it("treats the halftone grid's 90-degree symmetry correctly", () => {
    const risks = findMoireRisks([
      { label: "A", angle: 5, screened: true, mask: mask(255) },
      { label: "B", angle: 95, screened: true, mask: mask(255) },
    ], 200);
    expect(risks).toHaveLength(1);
    expect(risks[0].separation).toBeCloseTo(0, 6);
  });

  it("accepts well-separated angles on overlapping screens", () => {
    const risks = findMoireRisks([
      { label: "A", angle: 22.5, screened: true, mask: mask(255) },
      { label: "B", angle: 52.5, screened: true, mask: mask(255) },
    ], 200);
    expect(risks).toHaveLength(0);
  });

  it("keeps a real 16-screen job's warnings to a workable number", () => {
    const { art, out } = separate(16);
    const warnings = collectProductionWarnings(out.plan, out.qa, art.width * art.height);
    const moire = warnings.filter((w) => w.includes("moire"));
    // Raw angle proximity on 16 screens over a 6-angle set would flag well
    // over a dozen pairs; overlap-aware detection must be far quieter.
    expect(moire.length).toBeLessThan(6);
  });

  it("groups identical mesh warnings instead of repeating them per screen", () => {
    const { art, out } = separate(16);
    // One line count across the whole rack: without grouping this is one
    // near-identical warning per screen, which buries anything specific.
    for (const ink of out.plan.inks) {
      if (ink.type === "underbase") continue;
      ink.mesh = 110;
      ink.halftone = { ...ink.halftone, enabled: true, lpi: 65 };
    }
    const warnings = collectProductionWarnings(out.plan, out.qa, art.width * art.height);
    const mesh = warnings.filter((w) => w.includes("110 mesh"));
    expect(mesh).toHaveLength(1);
    expect(mesh[0]).toMatch(/others/);
    expect(mesh[0]).toContain("Consider:");
  });

  it("keeps distinct mesh combinations as separate warnings", () => {
    const { art, out } = separate(16);
    const spots = out.plan.inks.filter((i) => i.type !== "underbase");
    spots.forEach((ink, i) => {
      ink.mesh = 110;
      ink.halftone = { ...ink.halftone, enabled: true, lpi: i < spots.length / 2 ? 65 : 55 };
    });
    const warnings = collectProductionWarnings(out.plan, out.qa, art.width * art.height);
    expect(warnings.filter((w) => w.includes("110 mesh")).length).toBe(2);
  });

  it("falls back to no moire check when overlap cannot be measured", () => {
    const out = separate(16).out;
    const warnings = collectProductionWarnings(out.plan, out.qa);
    expect(warnings.filter((w) => w.includes("moire"))).toHaveLength(0);
  });
});

describe("commands accept factory screen counts", () => {
  const ctx: CommandContext = {
    inks: [{ id: "ink-0", name: "Red", type: "spot" }],
    currentScreenCount: 6,
    maxScreens: 6,
    garmentColor: "#111111",
    underbaseChoke: 1,
    meshCounts: [156],
  };

  it("raises the limit to sixteen", () => {
    const r = parseCommand("allow 16 screens", ctx);
    expect(r.understood).toBe(true);
    expect(r.operations).toEqual([{ action: "increase_screen_count", target: 16 }]);
  });

  it("understands spelled-out counts past twelve", () => {
    expect(parseCommand("increase to sixteen screens", ctx).operations)
      .toEqual([{ action: "increase_screen_count", target: 16 }]);
  });

  it("reduces to a high count too", () => {
    expect(parseCommand("reduce this to 14 screens", ctx).operations)
      .toEqual([{ action: "reduce_screen_count", target: 14 }]);
  });

  it("still rejects a count no press could run", () => {
    const r = parseCommand("reduce this to 400 screens", ctx);
    expect(r.understood).toBe(false);
    expect(r.explanation).toContain(String(MAX_SCREENS));
  });
});
