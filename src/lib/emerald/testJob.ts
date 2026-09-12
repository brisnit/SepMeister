/**
 * EMERALD SPOT TEST — a deterministic control target for RIP validation.
 *
 * This is not artwork and it is not a separation. It is a *known answer*. The
 * plates are constructed directly rather than clustered from an image, because
 * the entire value of a control target is that what SepWiz intended is not in
 * question: if Emerald images something different, the difference is Emerald's.
 * Running artwork through the engine would leave two variables in an
 * experiment that can only afford one.
 *
 * It deliberately uses no customer artwork, so it can be shared, attached to a
 * support ticket, or printed by anyone without a licensing or privacy question.
 *
 * ## What each feature is for
 *
 * Every plate carries the same battery, in a band of its own:
 *
 *   plate name        a plate that images under the wrong name is caught by eye
 *   large numeral     plate order, readable across a room on a film
 *   100/75/50/25%     tint response, and the direction of the ramp
 *   thin lines        1-4px rules; the first to disappear tells you the limit
 *   fine detail       shrinking squares; where they fill in is the dot limit
 *   solid bar         a large unambiguous 100% region
 *
 * And the sheet as a whole is arranged so that failures are *visible* rather
 * than merely present:
 *
 *   a missing plate         an entire labelled band is gone
 *   names collapsing        two bands carry the same name
 *   a scale change          band geometry no longer lines up between plates
 *   tint inversion          the 100->25% ramp runs the wrong way
 *   lost spot semantics     the composite is one colour instead of six
 *   failed overprint        the rosette shows one petal instead of six overlaps
 *   mishandled transparency the 25% patch images as solid or as nothing
 */

import type {
  InkSeparation, InkType, SeparationPlan, ProductionSize, UnderbaseRelationship,
} from "@/lib/types";
import { garmentIsDark } from "@/lib/engine/analyze";
import { drawText, textWidth } from "./font";

export const EMERALD_TEST_WIDTH = 1200;
export const EMERALD_TEST_HEIGHT = 1500;

/** 12 x 15in at 100 DPI — an ordinary shop film size, not a contrived one. */
export const EMERALD_TEST_SIZE: ProductionSize = {
  widthIn: 12,
  heightIn: 15,
  units: "in",
  lockAspect: true,
};

/**
 * A mid grey, not the near-black a shop would normally test on.
 *
 * Chosen so every plate is legible against it. On a near-black garment the
 * BLACK band vanishes into the background, and "a missing plate leaves an
 * empty band" — the target's most important property — stops holding for
 * plate 6. This is still dark enough that `garmentIsDark` returns true, so the
 * underbase remains justified.
 */
export const EMERALD_TEST_GARMENT = "#6e6e6e";

/** The four tint patches, in the order they are drawn left to right. */
export const TONE_STEPS: { percent: number; value: number }[] = [
  { percent: 100, value: 255 },
  { percent: 75, value: 191 },
  { percent: 50, value: 128 },
  { percent: 25, value: 64 },
];

interface PlateSpec {
  id: string;
  name: string;
  displayColor: string;
  type: InkType;
  mesh: number;
  angle: number;
  underbase: UnderbaseRelationship;
}

/**
 * The six plates, fixed.
 *
 * Angles are explicit constants rather than assigned by the overlap solver:
 * a control target's expected values must be readable from the source, and an
 * angle that changes when the solver improves would silently invalidate a
 * comparison someone made last month.
 */
const PLATES: PlateSpec[] = [
  { id: "emerald-base", name: "WHITE UNDERBASE", displayColor: "#ffffff", type: "underbase", mesh: 110, angle: 22, underbase: "none" },
  { id: "emerald-red", name: "RED", displayColor: "#d0021b", type: "spot", mesh: 156, angle: 15, underbase: "full" },
  { id: "emerald-blue", name: "BLUE", displayColor: "#0b4fd0", type: "spot", mesh: 156, angle: 75, underbase: "full" },
  { id: "emerald-yellow", name: "YELLOW", displayColor: "#f5c400", type: "spot", mesh: 156, angle: 0, underbase: "full" },
  { id: "emerald-green", name: "GREEN", displayColor: "#0f8a3c", type: "spot", mesh: 196, angle: 45, underbase: "none" },
  { id: "emerald-black", name: "BLACK", displayColor: "#000000", type: "black", mesh: 230, angle: 68, underbase: "none" },
];

export const EMERALD_PLATE_NAMES = PLATES.map((p) => p.name);
export const EMERALD_PLATE_COUNT = PLATES.length;
export const EMERALD_TEST_LPI = 45;

/**
 * Which plates the underbase prints beneath.
 *
 * Not all of them, on purpose. If the base sat under everything then no colour
 * plate would have a region isolated from it, and "these two plates overlap"
 * would be untestable against "these two do not". Knocking the base out from
 * under green and black is also what a shop actually does.
 */
const BASED_PLATES = new Set(["emerald-red", "emerald-blue", "emerald-yellow"]);

// Band geometry. Shared by every plate so the bands line up across films.
const TITLE_Y = 26;
const TITLE_SCALE = 5;
const BAND_TOP = 108;
const BAND_HEIGHT = 190;
const NAME_SCALE = 3;
const NUMERAL_SCALE = 12;
const FEATURE_TOP = 44; // relative to band top
const FEATURE_HEIGHT = 76;

const ROSETTE_CX = 600;
const ROSETTE_CY = 1372;
const ROSETTE_ORBIT = 70;
const ROSETTE_PETAL = 86;
const ROSETTE_DISC = 172;

function fillRect(
  buf: Uint8ClampedArray, w: number, h: number,
  x0: number, y0: number, rw: number, rh: number, value: number,
): void {
  const xa = Math.max(0, x0);
  const ya = Math.max(0, y0);
  const xb = Math.min(w, x0 + rw);
  const yb = Math.min(h, y0 + rh);
  for (let y = ya; y < yb; y++) {
    const row = y * w;
    for (let x = xa; x < xb; x++) buf[row + x] = value;
  }
}

/**
 * A hard-edged disc.
 *
 * No antialiasing, for the same reason the font has none: a partial-coverage
 * edge pixel in a control target is indistinguishable from a RIP artifact.
 */
function fillCircle(
  buf: Uint8ClampedArray, w: number, h: number,
  cx: number, cy: number, r: number, value: number,
): void {
  const r2 = r * r;
  const ya = Math.max(0, Math.floor(cy - r));
  const yb = Math.min(h, Math.ceil(cy + r) + 1);
  for (let y = ya; y < yb; y++) {
    const dy = y - cy;
    const span = Math.sqrt(Math.max(0, r2 - dy * dy));
    const xa = Math.max(0, Math.floor(cx - span));
    const xb = Math.min(w, Math.ceil(cx + span) + 1);
    const row = y * w;
    for (let x = xa; x < xb; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) buf[row + x] = value;
    }
  }
}

/** The battery of test features for one plate, in its own horizontal band. */
function drawBand(
  buf: Uint8ClampedArray, w: number, h: number, index: number, plate: PlateSpec,
): void {
  const top = BAND_TOP + index * BAND_HEIGHT;
  const featureY = top + FEATURE_TOP;

  drawText(buf, w, h, plate.name, 30, top + 8, NAME_SCALE);
  drawText(buf, w, h, String(index + 1), 30, featureY, NUMERAL_SCALE);

  // Tint ramp, with each patch labelled by its own percentage so a film read
  // off the light table needs no key.
  let x = 132;
  for (const step of TONE_STEPS) {
    fillRect(buf, w, h, x, featureY, 88, FEATURE_HEIGHT, step.value);
    drawText(buf, w, h, `${step.percent}%`, x, featureY + FEATURE_HEIGHT + 6, 2);
    x += 100;
  }

  // Rules from 1 to 4 pixels. Which one survives is the resolution answer.
  let lineY = featureY;
  for (let px = 1; px <= 4; px++) {
    fillRect(buf, w, h, 540, lineY, 150, px, 255);
    lineY += 18;
  }

  // Shrinking squares on a fixed pitch; where they merge is the dot limit.
  let detailX = 720;
  for (const size of [10, 8, 6, 4, 3, 2, 1]) {
    fillRect(buf, w, h, detailX, featureY + 8, size, size, 255);
    fillRect(buf, w, h, detailX, featureY + 40, size, size, 255);
    detailX += size + 8;
  }

  fillRect(buf, w, h, 884, featureY, 286, FEATURE_HEIGHT, 255);
}

/** Coverage 0..1 and mean coverage over inked pixels. */
function measure(mask: Uint8ClampedArray): { coverage: number; meanDensity: number } {
  let inked = 0;
  let sum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) {
      inked++;
      sum += mask[i];
    }
  }
  return {
    coverage: mask.length === 0 ? 0 : inked / mask.length,
    meanDensity: inked === 0 ? 0 : sum / inked / 255,
  };
}

export interface EmeraldTestJob {
  plan: SeparationPlan;
  width: number;
  height: number;
  productionSize: ProductionSize;
}

/**
 * Builds the control target.
 *
 * Pure and deterministic: same bytes every call, on every machine.
 */
export function buildEmeraldTestJob(): EmeraldTestJob {
  const w = EMERALD_TEST_WIDTH;
  const h = EMERALD_TEST_HEIGHT;
  const n = w * h;

  const masks = PLATES.map(() => new Uint8ClampedArray(n));
  const baseMask = masks[0];

  // Title, on black only — it is a caption, not a registration feature, and
  // putting it on every plate would print it six times through the stack.
  const blackMask = masks[PLATES.findIndex((p) => p.id === "emerald-black")];
  const title = "SEPWIZ EMERALD SPOT TEST";
  drawText(blackMask, w, h, title, Math.round((w - textWidth(title, TITLE_SCALE)) / 2), TITLE_Y, TITLE_SCALE);

  PLATES.forEach((plate, i) => drawBand(masks[i], w, h, i, plate));

  // The base prints under the bands it is responsible for. Copied from those
  // plates' own geometry rather than redrawn, so the base can never disagree
  // with what it is supporting.
  PLATES.forEach((plate, i) => {
    if (!BASED_PLATES.has(plate.id)) return;
    const src = masks[i];
    for (let p = 0; p < n; p++) {
      if (src[p] > baseMask[p]) baseMask[p] = src[p];
    }
  });

  // The overlap rosette: five petals on a shared orbit, over a solid base
  // disc. Every petal contains the centre, so the middle of the rosette is
  // six plates deep and collapses visibly if overprint is not honoured.
  fillCircle(baseMask, w, h, ROSETTE_CX, ROSETTE_CY, ROSETTE_DISC, 255);
  const petals = PLATES.slice(1);
  petals.forEach((plate, i) => {
    const angle = (i / petals.length) * Math.PI * 2 - Math.PI / 2;
    fillCircle(
      masks[PLATES.indexOf(plate)], w, h,
      ROSETTE_CX + Math.cos(angle) * ROSETTE_ORBIT,
      ROSETTE_CY + Math.sin(angle) * ROSETTE_ORBIT,
      ROSETTE_PETAL, 255,
    );
  });

  const inks: InkSeparation[] = PLATES.map((plate, i) => {
    const mask = masks[i];
    const { coverage, meanDensity } = measure(mask);
    return {
      id: plate.id,
      name: plate.name,
      displayColor: plate.displayColor,
      type: plate.type,
      order: i,
      visible: true,
      coverage,
      meanDensity,
      mesh: plate.mesh,
      settings: { threshold: 0, gain: 1, choke: 0, spread: 0 },
      halftone: { enabled: true, lpi: EMERALD_TEST_LPI, angle: plate.angle, shape: "round" },
      underbase: plate.underbase,
      underbaseContribution: plate.underbase === "none" ? 0 : 1,
      mask,
      note: plate.type === "underbase"
        ? "Control target base — prints under red, blue and yellow only."
        : "Control target plate — constructed, not separated.",
    };
  });

  const plan: SeparationPlan = {
    garmentColor: EMERALD_TEST_GARMENT,
    // Asked rather than asserted, so the two can never drift apart.
    garmentIsDark: garmentIsDark(EMERALD_TEST_GARMENT),
    maxScreens: EMERALD_PLATE_COUNT,
    method: "spot",
    recommendedScreens: EMERALD_PLATE_COUNT,
    naturalColorFamilies: EMERALD_PLATE_COUNT,
    inks,
    printOrder: PLATES.map((p) => p.name),
    merges: [],
    knockouts: [],
    explanation:
      "EMERALD SPOT TEST — a constructed control target, not a separation. Six plates " +
      "carry identical test batteries in labelled bands, plus a six-deep overlap rosette. " +
      "Use it to compare what SepWiz intended against what the RIP imaged.",
  };

  return { plan, width: w, height: h, productionSize: EMERALD_TEST_SIZE };
}
