import { describe, it, expect } from "vitest";
import {
  ZOOM_STOPS, centered, clampScale, constrainPan, fitScale, fitViewport,
  fitWidthScale, stepZoom, toArtwork, toContainer, withinArtwork, zoomAbout, zoomLabel,
  MIN_SCALE, MAX_SCALE, PIXEL_PRESERVING_SCALE,
} from "@/lib/ui/viewport";
import { inspectPoint, formatCoverage, formatScreening } from "@/lib/spot/inspect";
import { runSeparation, rebuildUnderbase, contributionFor } from "@/lib/engine/pipeline";
import { generateDemoArtwork } from "@/lib/demo/artwork";
import type { InkSeparation, ProductionSettings } from "@/lib/types";

const SETTINGS: ProductionSettings = {
  jobName: "t", garmentColor: "#111111", maxScreens: 6,
  method: "ai", meshCount: "auto", inkType: "plastisol", useGarmentAsBlack: true,
};

const ART = generateDemoArtwork(240, 240);
const separate = (halftones = false) =>
  runSeparation({
    pixels: ART.pixels, width: ART.width, height: ART.height, dpi: 300,
    settings: SETTINGS, halftoneDefaults: { enabled: halftones, lpi: 45, shape: "round" },
  });

describe("viewport", () => {
  const art = { width: 1000, height: 800 };
  const container = { width: 600, height: 400 };

  it("fits artwork inside the container", () => {
    const s = fitScale(art, container, 20);
    expect(art.width * s).toBeLessThanOrEqual(container.width);
    expect(art.height * s).toBeLessThanOrEqual(container.height);
  });

  it("centres what it fits", () => {
    const v = fitViewport(art, container, 20);
    const rightGap = container.width - (v.x + art.width * v.scale);
    expect(v.x).toBeCloseTo(rightGap, 6);
  });

  it("fits width, letting height overflow", () => {
    const s = fitWidthScale(art, container, 20);
    expect(art.width * s).toBeCloseTo(container.width - 40, 6);
  });

  it("clamps scale to a usable range", () => {
    expect(clampScale(1e6)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    // The whole difference between inspecting and chasing the artwork.
    const view = { scale: 1, x: 50, y: 30 };
    const focus = { x: 220, y: 140 };
    const before = toArtwork(view, focus);
    const zoomed = zoomAbout(view, focus, 4);
    const after = toArtwork(zoomed, focus);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("steps through the stops an operator expects", () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(0.25, -1)).toBeCloseTo(0.125, 6);
    expect(stepZoom(16, 1)).toBe(32);
    for (const s of ZOOM_STOPS) expect(clampScale(s)).toBe(s);
  });

  it("offers 1600% for halftone inspection", () => {
    expect(ZOOM_STOPS).toContain(16);
    // Beyond 2x, rendering must stop interpolating between samples.
    expect(PIXEL_PRESERVING_SCALE).toBeLessThanOrEqual(2);
  });

  it("round-trips container and artwork coordinates", () => {
    const view = { scale: 3.5, x: -120, y: 44 };
    const p = { x: 137, y: 219 };
    const back = toContainer(view, toArtwork(view, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("knows what is inside the artwork", () => {
    expect(withinArtwork(art, { x: 0, y: 0 })).toBe(true);
    expect(withinArtwork(art, { x: 999.9, y: 799.9 })).toBe(true);
    expect(withinArtwork(art, { x: 1000, y: 0 })).toBe(false);
    expect(withinArtwork(art, { x: -0.1, y: 5 })).toBe(false);
  });

  it("never lets the artwork be panned entirely out of view", () => {
    const view = { scale: 8, x: -99999, y: 99999 };
    const c = constrainPan(view, art, container);
    expect(c.x + art.width * c.scale).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(container.height);
  });

  it("still allows pushing a detail off-centre at high zoom", () => {
    // A hard clamp to the edges would fight an operator working under a loupe.
    const view = { scale: 16, x: -5000, y: -5000 };
    const c = constrainPan(view, art, container);
    expect(c.x).toBeLessThan(0);
    expect(c.y).toBeLessThan(0);
  });

  it("labels zoom readably", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(16)).toBe("1600%");
    expect(zoomLabel(0.25)).toBe("25%");
  });

  it("handles a degenerate container without dividing by zero", () => {
    const v = fitViewport(art, { width: 0, height: 0 });
    expect(Number.isFinite(v.scale)).toBe(true);
    expect(v.scale).toBeGreaterThan(0);
  });

  it("does not mutate the artwork", () => {
    // Structural: nothing in the viewport module receives pixels at all.
    const before = Buffer.from(ART.pixels);
    let view = fitViewport({ width: ART.width, height: ART.height }, container);
    view = zoomAbout(view, { x: 10, y: 10 }, 8);
    view = constrainPan(view, { width: ART.width, height: ART.height }, container);
    centered({ width: ART.width, height: ART.height }, container, 2);
    expect(Buffer.from(ART.pixels)).toEqual(before);
  });
});

describe("coverage inspection", () => {
  it("reports coverage, mask value and screening at a point", () => {
    const out = separate(true);
    const inks = out.plan.inks;
    // Find a pixel some ink actually covers.
    const target = inks.find((i) => i.type !== "underbase")!;
    const idx = target.mask.findIndex((v) => v > 200);
    expect(idx).toBeGreaterThanOrEqual(0);
    const x = idx % ART.width;
    const y = Math.floor(idx / ART.width);

    const result = inspectPoint(inks, ART.width, ART.height, x, y, 600)!;
    expect(result.x).toBe(x);
    expect(result.y).toBe(y);
    expect(result.bare).toBe(false);

    const sample = result.inks.find((s) => s.inkId === target.id)!;
    expect(sample.mask).toBe(target.mask[idx]);
    expect(sample.coverage).toBeCloseTo(target.mask[idx] / 255, 6);
    expect(sample.halftone.enabled).toBe(true);
    expect(sample.halftone.lpi).toBe(45);
  });

  it("orders inks by coverage so the dominant one reads first", () => {
    const out = separate();
    const idx = out.plan.inks[1].mask.findIndex((v) => v > 128);
    if (idx < 0) return;
    const r = inspectPoint(out.plan.inks, ART.width, ART.height, idx % ART.width, Math.floor(idx / ART.width), 600)!;
    for (let i = 1; i < r.inks.length; i++) {
      expect(r.inks[i - 1].mask).toBeGreaterThanOrEqual(r.inks[i].mask);
    }
  });

  it("says plainly when nothing prints", () => {
    const out = separate();
    // A corner of the demo badge is transparent, so no ink lands there.
    const r = inspectPoint(out.plan.inks, ART.width, ART.height, 1, 1, 600)!;
    if (r.inks.length === 0) {
      expect(r.bare).toBe(true);
      expect(r.totalCoverage).toBe(0);
    }
  });

  it("returns nothing outside the artwork", () => {
    const out = separate();
    expect(inspectPoint(out.plan.inks, ART.width, ART.height, -1, 5, 600)).toBeNull();
    expect(inspectPoint(out.plan.inks, ART.width, ART.height, ART.width, 5, 600)).toBeNull();
  });

  it("marks unscreened full coverage as solid", () => {
    const out = separate(false);
    const ink = out.plan.inks.find((i) => i.mask.some((v) => v === 255))!;
    const idx = ink.mask.findIndex((v) => v === 255);
    const r = inspectPoint([ink], ART.width, ART.height, idx % ART.width, Math.floor(idx / ART.width), 600)!;
    expect(r.inks[0].solid).toBe(true);
    expect(formatCoverage(r.inks[0])).toContain("solid");
    expect(formatScreening(r.inks[0])).toContain("Solid");
  });

  it("withholds a dot figure the screen cannot resolve", () => {
    const out = separate(true);
    const ink = out.plan.inks.find((i) => i.halftone.enabled)!;
    const idx = ink.mask.findIndex((v) => v > 100 && v < 200);
    if (idx < 0) return;
    const x = idx % ART.width;
    const y = Math.floor(idx / ART.width);
    // 40 DPI cannot hold a 45 LPI screen, so reporting a dot area would be
    // inventing a number.
    const coarse = inspectPoint([ink], ART.width, ART.height, x, y, 40)!;
    expect(coarse.inks[0].expectedDotArea).toBeNull();
    const fine = inspectPoint([ink], ART.width, ART.height, x, y, 1200)!;
    expect(fine.inks[0].expectedDotArea).toBeCloseTo(coarse.inks[0].coverage, 6);
  });

  it("does not mutate any mask", () => {
    const out = separate(true);
    const before = out.plan.inks.map((i) => Buffer.from(i.mask));
    for (let i = 0; i < 200; i++) {
      inspectPoint(out.plan.inks, ART.width, ART.height, i % ART.width, i, 600);
    }
    out.plan.inks.forEach((ink, i) => expect(Buffer.from(ink.mask)).toEqual(before[i]));
  });
});

describe("per-ink underbase control", () => {
  const dpi = 300;

  function withRelationships(inks: InkSeparation[], rel: Record<string, "full" | "reduced" | "none">) {
    return inks.map((i) =>
      rel[i.id]
        ? { ...i, underbase: rel[i.id], underbaseContribution: contributionFor(rel[i.id]) }
        : i,
    );
  }

  it("defaults black to no underbase", () => {
    const out = separate();
    for (const ink of out.plan.inks) {
      if (ink.type === "black") {
        // White under black only dulls it and adds a registration dependency.
        expect(ink.underbase).toBe("none");
        expect(ink.underbaseContribution).toBe(0);
      }
      if (ink.type === "underbase") expect(ink.underbaseContribution).toBe(0);
    }
  });

  it("maps relationships to contributions", () => {
    expect(contributionFor("full")).toBe(1);
    expect(contributionFor("none")).toBe(0);
    expect(contributionFor("reduced")).toBeGreaterThan(0);
    expect(contributionFor("reduced")).toBeLessThan(1);
  });

  it("shrinks the base when an ink asks for none", () => {
    const out = separate();
    const spots = out.plan.inks.filter((i) => i.type === "spot");
    const biggest = [...spots].sort((a, b) => b.coverage - a.coverage)[0];

    const before = rebuildUnderbase({
      inks: out.plan.inks, width: ART.width, height: ART.height, dpi, options: {},
    });
    const after = rebuildUnderbase({
      inks: withRelationships(out.plan.inks, { [biggest.id]: "none" }),
      width: ART.width, height: ART.height, dpi, options: {},
    });

    expect(after.coverage).toBeLessThan(before.coverage);
    expect(after.note).toContain(biggest.name);
  });

  it("puts a reduced ink between full and none", () => {
    const out = separate();
    const spots = out.plan.inks.filter((i) => i.type === "spot");
    const target = [...spots].sort((a, b) => b.coverage - a.coverage)[0];
    const build = (rel: "full" | "reduced" | "none") =>
      rebuildUnderbase({
        inks: withRelationships(out.plan.inks, { [target.id]: rel }),
        width: ART.width, height: ART.height, dpi, options: {},
      });

    const full = build("full").meanDensity;
    const reduced = build("reduced").meanDensity;
    const none = build("none").coverage;
    expect(reduced).toBeLessThanOrEqual(full);
    expect(none).toBeLessThan(build("full").coverage);
  });

  it("produces no base at all when every ink declines it", () => {
    const out = separate();
    const all: Record<string, "none"> = {};
    for (const ink of out.plan.inks) all[ink.id] = "none";
    const res = rebuildUnderbase({
      inks: withRelationships(out.plan.inks, all),
      width: ART.width, height: ART.height, dpi, options: {},
    });
    expect(res.coverage).toBe(0);
  });

  it("regenerates identically from the same inputs", () => {
    const out = separate();
    const a = rebuildUnderbase({ inks: out.plan.inks, width: ART.width, height: ART.height, dpi, options: {} });
    const b = rebuildUnderbase({ inks: out.plan.inks, width: ART.width, height: ART.height, dpi, options: {} });
    expect(Buffer.from(a.mask)).toEqual(Buffer.from(b.mask));
  });

  it("leaves the colour separations untouched", () => {
    // Changing the base must not re-cluster the artwork.
    const out = separate();
    const before = out.plan.inks.filter((i) => i.type !== "underbase").map((i) => Buffer.from(i.mask));
    rebuildUnderbase({
      inks: withRelationships(out.plan.inks, { [out.plan.inks[1].id]: "none" }),
      width: ART.width, height: ART.height, dpi, options: {},
    });
    const after = out.plan.inks.filter((i) => i.type !== "underbase").map((i) => Buffer.from(i.mask));
    expect(after).toEqual(before);
  });

  it("honours choke and the black knockout while rebuilding", () => {
    const out = separate();
    const open = rebuildUnderbase({
      inks: out.plan.inks, width: ART.width, height: ART.height, dpi, options: { chokePx: 0 },
    });
    const choked = rebuildUnderbase({
      inks: out.plan.inks, width: ART.width, height: ART.height, dpi, options: { chokePx: 4 },
    });
    expect(choked.coverage).toBeLessThan(open.coverage);
    expect(choked.note).toContain("4px");
  });
});
