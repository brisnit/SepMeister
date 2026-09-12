/**
 * The separation pipeline.
 *
 * Deterministic end to end: identical artwork plus identical settings must
 * produce byte-identical masks. Every stochastic step (k-means seeding) uses
 * a fixed seed, and every map iteration order is made explicit.
 *
 * No AI is involved in producing pixels. The AI layer, when configured, may
 * only adjust the *settings* fed into this function.
 */

import { rgbToLab, labToRgb, rgbToHex, hexToLab, deltaE2000, relativeLuminance, hexToRgb, type Lab } from "@/lib/color/space";
import { analyzeArtwork, garmentIsDark, type AnalyzeResult } from "./analyze";
import { kmeansLab, estimateNaturalClusters, mergeCloseClusters, countNaturalFamilies } from "./cluster";
import { buildMembershipMasks, despeckle, unionCoverage } from "./masks";
import { buildUnderbase, resolveChokePixels, DEFAULT_UNDERBASE, type UnderbaseOptions } from "./underbase";
import { assessGarmentAsBlack, solidifyBlack } from "./black";
import { applyLevels, erode, dilate, maskStats, type Mask } from "./morphology";
import { nameForColor, disambiguateNames } from "./naming";
import { DEFAULT_ANGLE_PRESET, angleFromPreset } from "./halftone";
import { suggestPrintOrder, applyPrintOrder } from "./printOrder";
import { assignAnglesByOverlap } from "./overlap";
import { compositeLayers, flattenOnGarment } from "./composite";
import { meanDeltaE, ssim, similarityPercent } from "./metrics";
import { scoreSeparation } from "./qa";
import {
  MAX_SCREENS,
  type UnderbaseRelationship,
  type HalftoneSettings, type InkHalftone, type InkSeparation, type MergeRecord,
  type ProductionSettings, type ProgressEvent, type SeparationPlan, type QAResult,
} from "@/lib/types";

/** Fixed seed. Changing this changes every output; treat it as a format version. */
export const ENGINE_SEED = 0x5e9a1;

/** Clusters closer than this in dE2000 are the same screen, always. */
const AUTO_MERGE_DE = 6;

/** A cluster within this dE of the garment is a candidate for knockout. */
const GARMENT_KNOCKOUT_DE = 10;

/** A cluster within this dE of a detected background is treated as background. */
const BACKGROUND_KNOCKOUT_DE = 12;

/** Clusters holding less than this share of the artwork are not worth a screen. */
const MIN_SIGNIFICANCE = 0.004;

export interface SeparationInput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  settings: ProductionSettings;
  /** Working DPI, used to make choke and detail thresholds physical. */
  dpi: number;
  underbase?: Partial<UnderbaseOptions>;
  /** Splits pure white onto its own screen instead of letting the base carry it. */
  highlightWhite?: boolean;
  /** Job-level halftone defaults, seeded onto each separation as it is created. */
  halftoneDefaults?: HalftoneSettings;
  /**
   * Knock a detected solid background out to the garment.
   *
   * Formats without alpha (JPEG especially) flatten a transparent background
   * to a solid color. Separated as-is on a dark garment that becomes a white
   * underbase covering the entire artboard -- technically faithful, almost
   * never what the artist wants. Defaults to on when a background is found.
   */
  removeBackground?: boolean;
  onProgress?: (e: ProgressEvent) => void;
}

export interface SeparationOutput {
  analysis: AnalyzeResult;
  plan: SeparationPlan;
  qa: QAResult;
  similarity: { deltaE: number; ssim: number; percent: number };
  compositeRgba: Uint8ClampedArray;
}

/**
 * How many inks may share a pixel, and how sharply coverage falls off.
 *
 * Spot color wants two inks per pixel: flat interiors stay solid and only
 * genuine antialiased boundaries split. Simulated process allows a third so
 * inks can build tone together. Index pushes toward a hard assignment.
 */
function membershipFor(
  analysis: AnalyzeResult,
  method: string,
): { maxInksPerPixel: number; power: number } {
  if (method === "spot") return { maxInksPerPixel: 2, power: 1 };
  if (method === "simulated") return { maxInksPerPixel: 3, power: 1 };
  if (method === "index") return { maxInksPerPixel: 2, power: 2.5 };
  // "ai" / auto: pick from the artwork itself.
  if (analysis.artworkType === "line-art") return { maxInksPerPixel: 2, power: 1.4 };
  if (analysis.artworkType === "photographic") return { maxInksPerPixel: 3, power: 1 };
  return { maxInksPerPixel: 2, power: 1 };
}

/**
 * Minimum surviving speck area, in pixels, scaled to the working resolution.
 * Anything under roughly 1/300in square is dust on film at any mesh.
 */
function despeckleArea(dpi: number): number {
  return Math.max(2, Math.round((dpi / 300) ** 2 * 4));
}

/**
 * Seeds a separation's halftone settings.
 *
 * An underbase is left unscreened by default: a base is normally printed as a
 * solid to lay down opaque white, and halftoning it produces a weak,
 * see-through base. Everything else takes the job default, with each screen on
 * its own angle so overlapping inks do not beat against each other.
 */
function halftoneFor(
  type: InkSeparation["type"],
  index: number,
  defaults: HalftoneSettings,
): InkHalftone {
  const solid = type === "underbase";
  return {
    enabled: defaults.enabled && !solid,
    lpi: defaults.lpi,
    angle: angleFromPreset(DEFAULT_ANGLE_PRESET, index),
    shape: defaults.shape,
  };
}

/**
 * Default underbase relationship for a newly separated ink.
 *
 * Black is the one clear case: it covers a dark garment unaided, and white
 * beneath it only dulls it and adds a registration dependency. Everything else
 * starts at full and is the separator's call from there.
 */
function defaultUnderbaseFor(type: InkSeparation["type"]): UnderbaseRelationship {
  if (type === "black") return "none";
  return "full";
}

/** Contribution implied by a relationship, before any manual override. */
export function contributionFor(relationship: UnderbaseRelationship): number {
  if (relationship === "none") return 0;
  if (relationship === "reduced") return 0.5;
  return 1;
}

/** Mesh recommendation from ink role and artwork detail. */
function meshFor(
  type: InkSeparation["type"],
  requested: ProductionSettings["meshCount"],
  analysis: AnalyzeResult,
): number {
  if (requested !== "auto") return requested;
  if (type === "underbase") return 110;   // heavy white deposit
  if (type === "highlight") return 156;
  if (type === "black" || analysis.edgeComplexity > 0.2) return 230;
  return analysis.gradientRatio > 0.25 ? 230 : 156;
}

export function runSeparation(input: SeparationInput): SeparationOutput {
  const { pixels, width, height, settings, dpi } = input;
  const report = input.onProgress ?? (() => {});
  const n = width * height;
  const halftoneDefaults: HalftoneSettings =
    input.halftoneDefaults ?? { enabled: false, lpi: 45, shape: "round" };

  report({ stage: "analyze", message: "Analyzing artwork" });
  const analysis = analyzeArtwork(pixels, width, height);

  report({ stage: "families", message: "Identifying ink families" });

  const isDark = garmentIsDark(settings.garmentColor);
  const garmentLab = hexToLab(settings.garmentColor);

  // How many screens may we spend? The underbase is reserved out of the
  // budget up front, because it is not optional on a dark garment.
  // "No limit" still needs a ceiling so clustering cannot run away, but it has
  // to sit above what a large automatic press can actually run.
  const hardMax = settings.maxScreens ?? MAX_SCREENS;

  // A one-screen job cannot also carry a base. Asking for one screen and
  // getting two back would break the limit the artist set, so on a
  // single-screen job the ink itself is what prints and the garment shows
  // through everywhere else -- which is what a one-colour print on a dark
  // shirt actually is.
  const canAffordBase = isDark && hardMax > 1;
  const reserveForBase = canAffordBase ? 1 : 0;
  const colorBudget = Math.max(1, hardMax - reserveForBase);

  // What the artwork itself contains, measured without reference to the
  // artist's screen budget so the two numbers can be compared meaningfully.
  const naturalFamilies = countNaturalFamilies(analysis.bins, {
    maxK: MAX_SCREENS + 4,
    mergeDeltaE: AUTO_MERGE_DE,
    minSignificance: MIN_SIGNIFICANCE,
    seed: ENGINE_SEED,
  });

  // Separately, the point of diminishing returns within the budget, which is
  // what governs how generously to over-cluster before merging.
  const natural = estimateNaturalClusters(
    analysis.bins, 2, Math.min(MAX_SCREENS, Math.max(3, colorBudget + 3)), ENGINE_SEED,
  );

  // Cluster generously, then reduce perceptually. Over-clustering first and
  // merging afterwards produces better ink choices than clustering directly
  // to the budget, because k-means at low k splits along the wrong axis.
  const overshoot = Math.min(analysis.bins.length, Math.max(colorBudget + 3, natural.recommended + 2));
  const initial = kmeansLab(analysis.bins, overshoot, { seed: ENGINE_SEED });

  const totalWeight = initial.weights.reduce((s, w) => s + w, 0) || 1;

  // Fold together clusters that are perceptually the same ink.
  const merged = mergeCloseClusters(initial.centers, initial.weights, AUTO_MERGE_DE);
  const merges: MergeRecord[] = [];

  let centers = merged.centers;
  let weights = merged.weights;

  const hexOf = (lab: Lab) => {
    const [r, g, b] = labToRgb(lab);
    return rgbToHex(r, g, b);
  };

  for (const [keep, drop, dE] of merged.merges) {
    merges.push({
      keptInk: hexOf(initial.centers[keep]),
      mergedInk: hexOf(initial.centers[drop]),
      deltaE: dE,
      reason: `Perceptually identical (ΔE ${dE.toFixed(1)}) — not worth a separate screen.`,
    });
  }

  // Drop insignificant clusters into their nearest surviving neighbour.
  {
    const keepIdx: number[] = [];
    for (let i = 0; i < centers.length; i++) {
      if (weights[i] / totalWeight >= MIN_SIGNIFICANCE || centers.length <= 2) keepIdx.push(i);
      else {
        merges.push({
          keptInk: "",
          mergedInk: hexOf(centers[i]),
          deltaE: 0,
          reason: `Covered under ${(MIN_SIGNIFICANCE * 100).toFixed(1)}% of the artwork — absorbed into the nearest ink.`,
        });
      }
    }
    if (keepIdx.length > 0 && keepIdx.length < centers.length) {
      centers = keepIdx.map((i) => centers[i]);
      weights = keepIdx.map((i) => weights[i]);
    }
  }

  // Identify garment knockouts: clusters the garment itself can supply.
  const knockoutIdx = new Set<number>();
  const knockouts: { hex: string; coverage: number }[] = [];

  if (settings.useGarmentAsBlack || !isDark) {
    for (let i = 0; i < centers.length; i++) {
      const dE = deltaE2000(centers[i], garmentLab);
      if (dE > GARMENT_KNOCKOUT_DE) continue;
      // Never knock out everything; keep at least one printed ink.
      if (knockoutIdx.size >= centers.length - 1) break;
      knockoutIdx.add(i);
      knockouts.push({ hex: hexOf(centers[i]), coverage: weights[i] / totalWeight });
    }
  }

  // Knock out a detected solid background. It competes as a center during
  // mask generation just like the garment, so its pixels lose to it and
  // receive no ink at all.
  const removeBackground = input.removeBackground ?? true;
  let backgroundKnockedOut: string | null = null;
  if (removeBackground && analysis.detectedBackground) {
    const bgLab = hexToLab(analysis.detectedBackground);
    let bestI = -1;
    let bestD = BACKGROUND_KNOCKOUT_DE;
    for (let i = 0; i < centers.length; i++) {
      if (knockoutIdx.has(i)) continue;
      const d = deltaE2000(centers[i], bgLab);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    // Never knock out everything; at least one ink must still print.
    if (bestI >= 0 && knockoutIdx.size < centers.length - 1) {
      knockoutIdx.add(bestI);
      backgroundKnockedOut = hexOf(centers[bestI]);
      knockouts.push({ hex: backgroundKnockedOut, coverage: weights[bestI] / totalWeight });
    }
  }

  // Reduce printed colors to the budget by merging the least valuable ink
  // into its nearest neighbour. "Least valuable" = closest perceptual
  // neighbour weighted by how little of the artwork it covers.
  const printableIdx = () => centers.map((_, i) => i).filter((i) => !knockoutIdx.has(i));

  while (printableIdx().length > colorBudget) {
    const idxs = printableIdx();
    let bestI = -1;
    let bestJ = -1;
    let bestCost = Infinity;

    for (const i of idxs) {
      for (const j of idxs) {
        if (i === j) continue;
        const dE = deltaE2000(centers[i], centers[j]);
        const share = weights[i] / totalWeight;
        // Cheap merges: perceptually close and covering little area.
        const cost = dE * (0.25 + share * 8);
        if (cost < bestCost) { bestCost = cost; bestI = i; bestJ = j; }
      }
    }
    if (bestI < 0) break;

    const dE = deltaE2000(centers[bestI], centers[bestJ]);
    merges.push({
      keptInk: hexOf(centers[bestJ]),
      mergedInk: hexOf(centers[bestI]),
      deltaE: dE,
      reason: `Merged to fit the ${hardMax}-screen limit (ΔE ${dE.toFixed(1)}, ${(weights[bestI] / totalWeight * 100).toFixed(1)}% coverage).`,
    });

    const tw = weights[bestI] + weights[bestJ];
    centers[bestJ] = {
      L: (centers[bestJ].L * weights[bestJ] + centers[bestI].L * weights[bestI]) / tw,
      a: (centers[bestJ].a * weights[bestJ] + centers[bestI].a * weights[bestI]) / tw,
      b: (centers[bestJ].b * weights[bestJ] + centers[bestI].b * weights[bestI]) / tw,
    };
    weights[bestJ] = tw;

    // Remove bestI, keeping knockout indices consistent.
    const survivors = centers.map((_, i) => i).filter((i) => i !== bestI);
    const remapKnock = new Set<number>();
    survivors.forEach((old, next) => { if (knockoutIdx.has(old)) remapKnock.add(next); });
    centers = survivors.map((i) => centers[i]);
    weights = survivors.map((i) => weights[i]);
    knockoutIdx.clear();
    for (const k of remapKnock) knockoutIdx.add(k);
  }

  report({ stage: "masks", message: "Building separation masks" });

  const membership = membershipFor(analysis, settings.method);

  // The garment participates as a competitor so that pixels matching the
  // garment lose to it and correctly receive no ink at all.
  const competitorCenters: Lab[] = [...centers];
  const garmentCompetitorIndex = competitorCenters.length;
  competitorCenters.push(garmentLab);

  const rawMasks = buildMembershipMasks(pixels, width, height, competitorCenters, {
    maxInksPerPixel: membership.maxInksPerPixel,
    power: membership.power,
    cutoff: 0.02,
    alphaFloor: 8,
    smoothRadius: analysis.artworkType === "photographic" ? 0.6 : 0,
  });

  // Strip membership specks before anything measures or bases off these masks.
  const minSpeck = despeckleArea(dpi);
  const allMasks = rawMasks.map((m) => despeckle(m, minSpeck));

  // Union of everything the garment supplies rather than ink: the garment
  // itself plus any knocked-out cluster. Kept so the similarity comparison
  // can treat those areas as deliberately bare rather than scoring the
  // composite against artwork the artist asked not to print.
  const knockoutCoverage = new Uint8ClampedArray(n);
  for (const idx of [...knockoutIdx, garmentCompetitorIndex]) {
    const m = allMasks[idx];
    if (!m) continue;
    for (let i = 0; i < n; i++) if (m.data[i] > knockoutCoverage[i]) knockoutCoverage[i] = m.data[i];
    // These print nothing; zero them so no downstream step treats them as ink.
    m.data.fill(0);
  }

  // Assemble printed inks from the surviving centers.
  interface Draft {
    center: Lab;
    hex: string;
    mask: Mask;
    type: InkSeparation["type"];
    note?: string;
  }

  const drafts: Draft[] = [];
  for (let i = 0; i < centers.length; i++) {
    if (knockoutIdx.has(i)) continue;
    drafts.push({ center: centers[i], hex: hexOf(centers[i]), mask: allMasks[i], type: "spot" });
  }

  // Classify a near-black draft as the black screen.
  //
  // Lightness alone is not enough: a saturated navy sits at L~20 and would be
  // mislabelled as black, then wrongly offered up for garment knockout. A true
  // black is dark *and* neutral, so chroma has to be part of the test.
  let blackDraft: Draft | null = null;
  {
    let bestI = -1;
    let bestL = Infinity;
    for (let i = 0; i < drafts.length; i++) {
      const c = drafts[i].center;
      const chroma = Math.hypot(c.a, c.b);
      if (c.L < 30 && chroma < 12 && c.L < bestL) { bestL = c.L; bestI = i; }
    }
    if (bestI >= 0) {
      drafts[bestI].type = "black";
      blackDraft = drafts[bestI];
    }
  }

  // Garment-as-black assessment: if the garment can supply it, drop the screen.
  let garmentBlackNote: string | null = null;
  if (blackDraft && isDark && settings.useGarmentAsBlack) {
    const assessment = assessGarmentAsBlack(blackDraft.center, settings.garmentColor, blackDraft.mask, analysis.isLineArt);
    garmentBlackNote = assessment.reason;
    if (assessment.canUseGarment) {
      knockouts.push({ hex: blackDraft.hex, coverage: maskStats(blackDraft.mask).coverage });
      const bd = blackDraft;
      const at = drafts.indexOf(bd);
      if (at >= 0) drafts.splice(at, 1);
      blackDraft = null;
    }
  } else if (blackDraft) {
    blackDraft.mask = solidifyBlack(blackDraft.mask);
    blackDraft.note = "Solidified to keep linework and type crisp.";
  }

  // A near-white draft on a dark garment is carried by the base unless the
  // artist asks for a dedicated highlight screen. The underbase is white ink;
  // giving white its own spot screen as well spends a screen printing white
  // on top of white.
  const highlightWhite = input.highlightWhite ?? false;
  let whiteDraftIndex = -1;
  for (let i = 0; i < drafts.length; i++) {
    const c = drafts[i].center;
    if (c.L > 88 && Math.hypot(c.a, c.b) < 10) { whiteDraftIndex = i; break; }
  }
  let whiteFoldedMask: Mask | null = null;
  if (isDark && whiteDraftIndex >= 0) {
    if (highlightWhite) {
      drafts[whiteDraftIndex].type = "highlight";
      drafts[whiteDraftIndex].note = "Dedicated highlight white printed over the base.";
    } else {
      // Hand the white area to the underbase at full density and free the screen.
      whiteFoldedMask = drafts[whiteDraftIndex].mask;
      drafts.splice(whiteDraftIndex, 1);
    }
  }

  report({ stage: "underbase", message: "Generating underbase" });

  const ubOpts: UnderbaseOptions = { ...DEFAULT_UNDERBASE, ...input.underbase };
  const scaledChoke = resolveChokePixels(ubOpts.chokePx, dpi);

  let underbaseMask: Mask | null = null;
  if (canAffordBase) {
    underbaseMask = buildUnderbase({
      width,
      height,
      sources: drafts.map((d) => ({
        mask: d.mask,
        contribution: contributionFor(defaultUnderbaseFor(d.type)),
      })),
      blackMask: blackDraft ? blackDraft.mask : null,
      options: { ...ubOpts, chokePx: scaledChoke, featherPx: resolveChokePixels(ubOpts.featherPx, dpi) },
    });
    // Areas that must read as pure white are printed by the base itself, at
    // full density and unchoked -- there is no ink above them to hide an edge.
    if (whiteFoldedMask) {
      for (let i = 0; i < underbaseMask.data.length; i++) {
        const v = whiteFoldedMask.data[i];
        if (v > underbaseMask.data[i]) underbaseMask.data[i] = v;
      }
    }
  }

  report({ stage: "check", message: "Checking separations" });

  // Names, with collisions resolved.
  const names = disambiguateNames(drafts.map((d) => ({ hex: d.hex, name: nameForColor(d.hex) })));

  const inks: InkSeparation[] = [];

  if (underbaseMask) {
    const stats = maskStats(underbaseMask);
    inks.push({
      id: "underbase",
      name: "White Underbase",
      displayColor: "#ffffff",
      type: "underbase",
      order: 0,
      visible: true,
      coverage: stats.coverage,
      meanDensity: stats.meanDensity,
      mesh: meshFor("underbase", settings.meshCount, analysis),
      settings: { threshold: 0, gain: 1, choke: ubOpts.chokePx, spread: 0 },
      halftone: halftoneFor("underbase", 0, halftoneDefaults),
      // The base does not sit on itself.
      underbase: "none",
      underbaseContribution: 0,
      mask: underbaseMask.data,
      note:
        `Choked ${ubOpts.chokePx}px` +
        (ubOpts.removeUnderBlack ? ", pulled out from under black" : "") +
        (whiteFoldedMask ? ", carrying the artwork's white at full density" : "") + ".",
    });
  }

  drafts.forEach((d, i) => {
    const stats = maskStats(d.mask);
    inks.push({
      id: `ink-${i}`,
      name: d.type === "black" ? "Black" : d.type === "highlight" ? "Highlight White" : names[i],
      displayColor: d.hex,
      type: d.type,
      order: 0,
      visible: true,
      coverage: stats.coverage,
      meanDensity: stats.meanDensity,
      mesh: meshFor(d.type, settings.meshCount, analysis),
      settings: { threshold: 0, gain: 1, choke: 0, spread: 0 },
      halftone: halftoneFor(d.type, i + 1, halftoneDefaults),
      underbase: defaultUnderbaseFor(d.type),
      underbaseContribution: contributionFor(defaultUnderbaseFor(d.type)),
      mask: d.mask.data,
      note: d.note,
    });
  });

  // Seeded with the same heuristic the workspace offers as "recommended
  // order", so the initial sequence and the suggestion can never disagree.
  const ordered = applyPrintOrder(inks, suggestPrintOrder(inks).order);

  // Past about six screens the angle set has to be reused. Choosing which
  // screens share an angle from measured overlap keeps the reuse on pairs that
  // never touch, which is what makes a 12- or 16-colour job workable at all.
  if (halftoneDefaults.enabled) {
    const screened = ordered.filter((ink) => ink.halftone.enabled);
    if (screened.length > DEFAULT_ANGLE_PRESET.angles.length) {
      const angles = assignAnglesByOverlap(
        screened.map((ink) => ink.mask),
        n,
        DEFAULT_ANGLE_PRESET.angles,
      );
      screened.forEach((ink, i) => { ink.halftone = { ...ink.halftone, angle: angles[i] }; });
    }
  }

  report({ stage: "preview", message: "Preparing preview" });

  const composite = compositeLayers(
    ordered.map((ink) => ({
      mask: { width, height, data: ink.mask },
      color: ink.displayColor,
      visible: ink.visible,
      role: ink.type === "underbase" ? ("substrate" as const) : ("ink" as const),
    })),
    width,
    height,
    settings.garmentColor,
    1,
  );

  // Compare against the artwork as the artist asked for it to be printed:
  // knocked-out areas resolve to the garment, exactly as transparency does.
  const original = flattenOnGarment(pixels, width, height, settings.garmentColor, knockoutCoverage);
  // Sample stride keeps dE2000 (expensive) tractable on large artwork.
  const step = Math.max(1, Math.floor(n / 120000));
  const de = meanDeltaE(original, composite, n, step);
  const ss = ssim(original, composite, width, height);
  const percent = similarityPercent(de.mean, ss);

  const explanation = buildExplanation({
    backgroundKnockedOut,
    naturalFamilies,
    printed: ordered.length,
    maxScreens: settings.maxScreens,
    merges,
    knockouts,
    isDark,
    hasUnderbase: !!underbaseMask,
    garmentBlackNote,
  });

  const plan: SeparationPlan = {
    garmentColor: settings.garmentColor,
    garmentIsDark: isDark,
    maxScreens: settings.maxScreens,
    method: settings.method,
    // Deliberately NOT capped at the limit: showing "recommended 17, limit 6"
    // is the whole reason both numbers exist.
    recommendedScreens: naturalFamilies + reserveForBase,
    naturalColorFamilies: naturalFamilies,
    inks: ordered,
    printOrder: ordered.map((i) => i.id),
    merges,
    knockouts,
    explanation,
  };

  const topInkUnion = unionCoverage(
    ordered.filter((i) => i.type !== "underbase").map((i) => ({ width, height, data: i.mask })),
  );
  const qa = scoreSeparation({ plan, analysis, width, height, dpi, similarity: percent, topInkUnion });

  return {
    analysis,
    plan,
    qa,
    similarity: { deltaE: de.mean, ssim: ss, percent },
    compositeRgba: composite,
  };
}

function buildExplanation(a: {
  backgroundKnockedOut: string | null;
  naturalFamilies: number;
  printed: number;
  maxScreens: number | null;
  merges: MergeRecord[];
  knockouts: { hex: string; coverage: number }[];
  isDark: boolean;
  hasUnderbase: boolean;
  garmentBlackNote: string | null;
}): string {
  const parts: string[] = [];
  parts.push(
    `Artwork contained ${a.naturalFamilies} significant color ${a.naturalFamilies === 1 ? "family" : "families"}.`,
  );

  const limitMerges = a.merges.filter((m) => m.reason.includes("screen limit")).length;
  const dupeMerges = a.merges.filter((m) => m.reason.includes("Perceptually identical")).length;

  if (dupeMerges > 0) {
    parts.push(`${dupeMerges} perceptually identical ${dupeMerges === 1 ? "group was" : "groups were"} combined.`);
  }
  if (limitMerges > 0 && a.maxScreens) {
    parts.push(`${limitMerges} further ${limitMerges === 1 ? "ink was" : "inks were"} merged to fit the ${a.maxScreens}-screen limit.`);
  }
  if (a.knockouts.length > 0) {
    const pct = a.knockouts.reduce((s, k) => s + k.coverage, 0) * 100;
    parts.push(`${a.knockouts.length} ${a.knockouts.length === 1 ? "area is" : "areas are"} knocked out to the garment (${pct.toFixed(0)}% of the artwork), costing no ink.`);
  }
  if (a.backgroundKnockedOut) {
    parts.push(`The solid ${a.backgroundKnockedOut} background was removed rather than printed.`);
  }
  if (a.hasUnderbase) {
    parts.push("A white underbase was added because the garment is dark.");
  }
  if (a.garmentBlackNote) parts.push(a.garmentBlackNote);

  parts.push(`Final plan: ${a.printed} ${a.printed === 1 ? "screen" : "screens"}.`);
  return parts.join(" ");
}

/**
 * Re-applies per-ink mask edits (threshold, gain, choke, spread) to a base
 * mask. Kept separate from the pipeline so UI edits are cheap and do not
 * require a full re-separation.
 */
export function applyInkSettings(
  base: Uint8ClampedArray,
  width: number,
  height: number,
  s: { threshold: number; gain: number; choke: number; spread: number },
  dpi: number,
): Uint8ClampedArray {
  let m: Mask = { width, height, data: new Uint8ClampedArray(base) };
  if (s.threshold > 0 || s.gain !== 1) m = applyLevels(m, s.threshold, s.gain);
  const choke = Math.round(resolveChokePixels(s.choke, dpi));
  const spread = Math.round(resolveChokePixels(s.spread, dpi));
  if (choke > 0) m = erode(m, choke);
  if (spread > 0) m = dilate(m, spread);
  return m.data;
}

/**
 * Rebuilds only the underbase from the current inks and their relationships.
 *
 * Separate from `runSeparation` because changing "no white under the navy" is
 * an underbase decision, not a colour-separation one -- re-clustering the
 * artwork to answer it would risk changing the inks themselves, which is
 * exactly what a separator adjusting the base does not want.
 */
export function rebuildUnderbase(input: {
  inks: InkSeparation[];
  width: number;
  height: number;
  dpi: number;
  options: Partial<UnderbaseOptions>;
}): { mask: Uint8ClampedArray; coverage: number; meanDensity: number; note: string } {
  const { inks, width, height, dpi } = input;
  const opts: UnderbaseOptions = { ...DEFAULT_UNDERBASE, ...input.options };

  const tops = inks.filter((i) => i.type !== "underbase");
  const black = tops.find((i) => i.type === "black");

  const built = buildUnderbase({
    width,
    height,
    sources: tops.map((ink) => ({
      mask: { width, height, data: ink.mask },
      contribution: ink.underbaseContribution,
    })),
    blackMask: black ? { width, height, data: black.mask } : null,
    options: {
      ...opts,
      chokePx: resolveChokePixels(opts.chokePx, dpi),
      featherPx: resolveChokePixels(opts.featherPx, dpi),
    },
  });

  const stats = maskStats(built);
  const excluded = tops.filter((i) => i.underbaseContribution <= 0);
  const reduced = tops.filter((i) => i.underbaseContribution > 0 && i.underbaseContribution < 1);

  const parts = [`Choked ${opts.chokePx}px`];
  if (opts.removeUnderBlack) parts.push("pulled out from under black");
  if (excluded.length) parts.push(`no base under ${excluded.map((i) => i.name).join(", ")}`);
  if (reduced.length) parts.push(`reduced under ${reduced.map((i) => i.name).join(", ")}`);

  return {
    mask: built.data,
    coverage: stats.coverage,
    meanDensity: stats.meanDensity,
    note: `${parts.join(", ")}.`,
  };
}
