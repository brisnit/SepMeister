import { describe, it, expect } from "vitest";
import {
  buildEmeraldTestJob, EMERALD_PLATE_NAMES, EMERALD_PLATE_COUNT,
  EMERALD_TEST_WIDTH, EMERALD_TEST_HEIGHT, EMERALD_TEST_LPI, TONE_STEPS,
} from "@/lib/emerald/testJob";
import { drawText, textWidth, GLYPH_HEIGHT } from "@/lib/emerald/font";
import { garmentIsDark } from "@/lib/engine/analyze";
import {
  buildExpectations, expectationsText, checklistText, checklistSections,
  screeningModeLabel, screeningModeSlug, readingTheTargetText, wrap,
} from "@/lib/emerald/expectations";
import { buildLayout } from "@/lib/film/layout";
import { effectiveDpi } from "@/lib/production/size";
import type { ScreeningMode } from "@/lib/types";

const JOB = buildEmeraldTestJob();
const W = JOB.width;
const H = JOB.height;

function inkAt(name: string) {
  const ink = JOB.plan.inks.find((i) => i.name === name);
  expect(ink, `expected a "${name}" plate`).toBeDefined();
  return ink!;
}

function at(mask: Uint8ClampedArray, x: number, y: number): number {
  return mask[y * W + x];
}

/** The bounding box of everything inked on a plate. */
function bounds(mask: Uint8ClampedArray) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

describe("bitmap font", () => {
  it("draws glyphs at the requested scale", () => {
    const w = 60;
    const h = 20;
    const buf = new Uint8ClampedArray(w * h);
    drawText(buf, w, h, "1", 0, 0, 2);
    let inked = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] > 0) inked++;
    expect(inked).toBeGreaterThan(0);
    // Nothing may be drawn below the glyph box.
    for (let y = GLYPH_HEIGHT * 2; y < h; y++) {
      for (let x = 0; x < w; x++) expect(buf[y * w + x]).toBe(0);
    }
  });

  it("writes only full coverage, never partial", () => {
    // A grey edge pixel in a control target is indistinguishable from a RIP
    // artifact, so the font must not antialias.
    const buf = new Uint8ClampedArray(200 * 20);
    drawText(buf, 200, 20, "EMERALD 50%", 2, 2, 2);
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i] === 0 || buf[i] === 255).toBe(true);
    }
  });

  it("reports a width that matches what it draws", () => {
    const scale = 3;
    const text = "WHITE UNDERBASE";
    const w = 600;
    const buf = new Uint8ClampedArray(w * 30);
    drawText(buf, w, 30, text, 0, 0, scale);
    let maxX = -1;
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < w; x++) if (buf[y * w + x] > 0 && x > maxX) maxX = x;
    }
    expect(maxX).toBeLessThan(textWidth(text, scale));
  });

  it("clips rather than throwing when text runs past the edge", () => {
    const buf = new Uint8ClampedArray(20 * 10);
    expect(() => drawText(buf, 20, 10, "OVERFLOWING", 15, 5, 4)).not.toThrow();
  });

  it("renders an unknown character as blank rather than failing", () => {
    const buf = new Uint8ClampedArray(60 * 12);
    drawText(buf, 60, 12, "☃", 0, 0, 1);
    expect(buf.every((v) => v === 0)).toBe(true);
  });
});

describe("EMERALD SPOT TEST control target", () => {
  it("produces exactly the six documented plates, in order", () => {
    expect(JOB.plan.inks).toHaveLength(EMERALD_PLATE_COUNT);
    expect(JOB.plan.inks.map((i) => i.name)).toEqual(EMERALD_PLATE_NAMES);
    expect(JOB.plan.inks.map((i) => i.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("names the six plates the spec calls for", () => {
    expect(EMERALD_PLATE_NAMES).toEqual([
      "WHITE UNDERBASE", "RED", "BLUE", "YELLOW", "GREEN", "BLACK",
    ]);
  });

  it("is byte-for-byte deterministic", () => {
    // The entire value of a control target is that it is the same everywhere.
    const a = buildEmeraldTestJob();
    const b = buildEmeraldTestJob();
    for (let i = 0; i < a.plan.inks.length; i++) {
      expect(Buffer.from(a.plan.inks[i].mask)).toEqual(Buffer.from(b.plan.inks[i].mask));
    }
    expect(a.plan.explanation).toBe(b.plan.explanation);
    expect(a.productionSize).toEqual(b.productionSize);
  });

  it("gives every plate a distinct screen angle", () => {
    const angles = JOB.plan.inks.map((i) => i.halftone.angle);
    expect(new Set(angles).size).toBe(angles.length);
    for (const ink of JOB.plan.inks) {
      expect(ink.halftone.enabled).toBe(true);
      expect(ink.halftone.lpi).toBe(EMERALD_TEST_LPI);
    }
  });

  it("carries the four tint patches at their exact values on every plate", () => {
    // Tint inversion is a headline failure mode, so the ramp must be exact and
    // must run downward left to right.
    for (const ink of JOB.plan.inks) {
      const band = JOB.plan.inks.indexOf(ink);
      const y = 108 + band * 190 + 44 + 30;
      const found = TONE_STEPS.map((_, k) => at(ink.mask, 132 + k * 100 + 40, y));
      expect(found, `${ink.name} tint ramp`).toEqual(TONE_STEPS.map((s) => s.value));
      for (let k = 1; k < found.length; k++) expect(found[k]).toBeLessThan(found[k - 1]);
    }
  });

  it("gives each plate a band no other colour paints", () => {
    // "A missing plate leaves an empty band" only holds if the bands really are
    // exclusive. The base is excluded here because it deliberately prints under
    // three of them; that relationship is asserted separately below.
    JOB.plan.inks.forEach((ink, i) => {
      const y = 108 + i * 190 + 44 + 30;
      const x = 1000; // inside the solid bar, right of every other feature
      expect(at(ink.mask, x, y), `${ink.name} owns its own band`).toBe(255);
      JOB.plan.inks.forEach((other, j) => {
        if (i === j || other.type === "underbase") return;
        expect(at(other.mask, x, y), `${other.name} must not paint ${ink.name}'s band`).toBe(0);
      });
    });
  });

  it("puts the base only under the plates that asked for it", () => {
    const base = inkAt("WHITE UNDERBASE");
    for (const name of ["RED", "BLUE", "YELLOW"]) {
      const i = JOB.plan.inks.findIndex((k) => k.name === name);
      const y = 108 + i * 190 + 44 + 30;
      expect(at(base.mask, 1000, y), `base under ${name}`).toBe(255);
    }
    // Green and black knock the base out, which is what a shop actually does
    // and is what makes "isolated from the base" testable at all.
    for (const name of ["GREEN", "BLACK"]) {
      const i = JOB.plan.inks.findIndex((k) => k.name === name);
      const y = 108 + i * 190 + 44 + 30;
      expect(at(base.mask, 1000, y), `no base under ${name}`).toBe(0);
    }
  });

  it("declares the same underbase relationships it actually draws", () => {
    expect(inkAt("RED").underbase).toBe("full");
    expect(inkAt("BLUE").underbase).toBe("full");
    expect(inkAt("YELLOW").underbase).toBe("full");
    expect(inkAt("GREEN").underbase).toBe("none");
    expect(inkAt("BLACK").underbase).toBe("none");
    expect(inkAt("WHITE UNDERBASE").underbase).toBe("none");
  });

  it("overlaps all six plates at the centre of the rosette", () => {
    // The rosette is the overprint test: if a viewer or a RIP collapses the
    // plates, this is where it shows.
    for (const ink of JOB.plan.inks) {
      expect(at(ink.mask, 600, 1372), `${ink.name} at rosette centre`).toBe(255);
    }
  });

  it("gives each rosette petal to exactly one plate", () => {
    // Away from the centre each petal must be unique, so a merged plate is
    // visible as a petal appearing twice.
    const petals = JOB.plan.inks.filter((i) => i.type !== "underbase");
    petals.forEach((ink, i) => {
      const angle = (i / petals.length) * Math.PI * 2 - Math.PI / 2;
      // Just inside the petal's far edge, well clear of the shared centre.
      const x = Math.round(600 + Math.cos(angle) * (70 + 70));
      const y = Math.round(1372 + Math.sin(angle) * (70 + 70));
      expect(at(ink.mask, x, y), `${ink.name} owns its petal`).toBe(255);
      for (const other of petals) {
        if (other === ink) continue;
        expect(at(other.mask, x, y), `${other.name} must not reach ${ink.name}'s petal`).toBe(0);
      }
    });
  });

  it("covers the whole rosette with the base", () => {
    const base = inkAt("WHITE UNDERBASE").mask;
    for (const [x, y] of [[600, 1372], [600, 1230], [460, 1372], [740, 1372]] as [number, number][]) {
      expect(at(base, x, y)).toBe(255);
    }
  });

  it("keeps every plate inside the artboard", () => {
    for (const ink of JOB.plan.inks) {
      const b = bounds(ink.mask);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThan(EMERALD_TEST_WIDTH);
      expect(b.y1).toBeLessThan(EMERALD_TEST_HEIGHT);
    }
  });

  it("puts the title on black alone", () => {
    // A caption belongs on one plate; on all six it prints six times. Counted
    // over the title band rather than sampled at a point, since any single
    // pixel may land in the gap between two glyphs.
    const titleInk = (mask: Uint8ClampedArray) => {
      let n = 0;
      for (let y = 20; y < 70; y++) for (let x = 200; x < 1000; x++) if (mask[y * W + x] > 0) n++;
      return n;
    };
    expect(titleInk(inkAt("BLACK").mask)).toBeGreaterThan(200);
    for (const ink of JOB.plan.inks) {
      if (ink.name === "BLACK") continue;
      expect(titleInk(ink.mask), `${ink.name} must not carry the title`).toBe(0);
    }
  });

  it("uses a garment every plate is legible against, and still dark enough for a base", () => {
    // A near-black garment hides the BLACK band, which breaks the target's most
    // important property.
    expect(garmentIsDark(JOB.plan.garmentColor)).toBe(true);
    expect(JOB.plan.garmentIsDark).toBe(true);
    const [r] = [parseInt(JOB.plan.garmentColor.slice(1, 3), 16)];
    expect(r).toBeGreaterThan(0x40);
  });

  it("reports coverage and density that match the masks", () => {
    for (const ink of JOB.plan.inks) {
      let inked = 0;
      let sum = 0;
      for (let i = 0; i < ink.mask.length; i++) {
        if (ink.mask[i] > 0) {
          inked++;
          sum += ink.mask[i];
        }
      }
      expect(ink.coverage).toBeCloseTo(inked / ink.mask.length, 9);
      expect(ink.meanDensity).toBeCloseTo(sum / inked / 255, 9);
      expect(ink.coverage).toBeGreaterThan(0);
    }
  });

  it("uses an ordinary shop film size at a whole DPI", () => {
    expect(JOB.productionSize.widthIn).toBe(12);
    expect(JOB.productionSize.heightIn).toBe(15);
    expect(effectiveDpi(JOB.width, JOB.productionSize)).toBe(100);
  });

  it("says in the plan that it is a control target, not a separation", () => {
    expect(JOB.plan.explanation).toMatch(/control target/i);
    expect(JOB.plan.explanation).toMatch(/not a separation/i);
    expect(JOB.plan.merges).toEqual([]);
  });
});

describe("plate expectations", () => {
  const layout = buildLayout({
    pixelWidth: W, pixelHeight: H, dpi: 100, marginIn: 0.75,
    includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
  });

  function build(mode: ScreeningMode) {
    return buildExpectations({
      jobName: "EMERALD SPOT TEST",
      plan: JOB.plan,
      layout,
      screeningMode: mode,
      filmDpi: 600,
      artworkWidthIn: 12,
      artworkHeightIn: 15,
    });
  }

  it("lists every plate in print order", () => {
    const e = build("sepwiz-screened");
    expect(e.plateCount).toBe(EMERALD_PLATE_COUNT);
    expect(e.plates.map((p) => p.name)).toEqual(EMERALD_PLATE_NAMES);
    expect(e.plates.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reports the angles for the screened export and none for continuous tone", () => {
    const screened = build("sepwiz-screened");
    expect(screened.plates[1].screening).toContain("15°");
    expect(screened.screeningSummary).toContain("45 LPI");

    const continuous = build("continuous-tone");
    // Continuous tone must not claim an angle SepWiz did not apply.
    for (const p of continuous.plates) {
      expect(p.screening).toMatch(/continuous tone/i);
      expect(p.screening).not.toMatch(/°/);
    }
    expect(continuous.screeningSummary).toMatch(/RIP to screen/i);
  });

  it("states 100% scale and the real board size", () => {
    const e = build("sepwiz-screened");
    expect(e.scalePercent).toBe(100);
    expect(e.boardWidthIn).toBeCloseTo(13.5, 6);
    expect(e.boardHeightIn).toBeCloseTo(16.5, 6);
    expect(e.artworkWidthIn).toBe(12);
    expect(e.polarity).toBe("positive");
  });

  it("reads registration off the layout rather than restating the request", () => {
    const e = build("sepwiz-screened");
    expect(e.registrationCount).toBe(layout.registration.length);
    expect(e.registrationLayout).toBe("t-shape");
  });

  it("renders a report naming every plate", () => {
    const text = expectationsText(build("sepwiz-screened"));
    for (const name of EMERALD_PLATE_NAMES) expect(text).toContain(name);
    expect(text).toContain("6 spot plates");
    expect(text).toContain("100%");
    expect(text).toContain("positive");
  });

  it("distinguishes the two modes in the report", () => {
    expect(expectationsText(build("sepwiz-screened"))).toContain("SepWiz Screened");
    expect(expectationsText(build("continuous-tone"))).toContain("Continuous Tone Spot");
    expect(screeningModeSlug("sepwiz-screened")).toBe("screened");
    expect(screeningModeSlug("continuous-tone")).toBe("continuous-tone");
    expect(screeningModeLabel("continuous-tone")).toBe("Continuous Tone Spot");
  });
});

describe("compatibility checklist", () => {
  it("covers every section the validation calls for", () => {
    const titles = checklistSections().map((s) => s.title);
    expect(titles).toEqual([
      "Import", "Dimensions", "Registration", "Tonal output", "Plate behaviour", "Film output",
    ]);
  });

  it("keeps every item key unique, so a result can be recorded against one", () => {
    const keys = checklistSections().flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(28);
  });

  it("asks which side did the screening rather than assuming", () => {
    const item = checklistSections()
      .flatMap((s) => s.items)
      .find((i) => i.key === "screening-owner");
    expect(item).toBeDefined();
    expect(item!.note).toMatch(/rescreened/i);
    expect(item!.note).toMatch(/record which/i);
  });

  it("renders a checklist with a box for every item", () => {
    const layout = buildLayout({
      pixelWidth: W, pixelHeight: H, dpi: 100, marginIn: 0.75,
      includeRegistration: true, includeCenterMarks: true, includeCropMarks: true,
    });
    const e = buildExpectations({
      jobName: "T", plan: JOB.plan, layout, screeningMode: "sepwiz-screened",
      filmDpi: 600, artworkWidthIn: 12, artworkHeightIn: 15,
    });
    const text = checklistText(e);
    const boxes = (text.match(/\[ \]/g) ?? []).length;
    const items = checklistSections().reduce((n, s) => n + s.items.length, 0);
    expect(boxes).toBe(items);
    expect(text).toContain("ACCURIP EMERALD VALIDATION");
  });

  it("warns about the two things that look like bugs but are not", () => {
    const text = readingTheTargetText();
    // Both of these will otherwise be reported as export defects.
    expect(text).toMatch(/WHITE UNDERBASE band is invisible/);
    expect(text).toMatch(/Viewers ignore overprint/);
    expect(text).toMatch(/tint inverted/i);
  });

  it("wraps text without losing or splitting words", () => {
    const words = "the quick brown fox jumps over the lazy dog".split(" ");
    const lines = wrap(words.join(" "), 12);
    expect(lines.join(" ").split(" ")).toEqual(words);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(12);
  });
});
