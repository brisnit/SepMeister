/**
 * Sep Score — a heuristic pre-press QA read.
 *
 * These are rules of thumb encoded from common screen-print failure modes,
 * not a model trained on production outcomes, and the UI says so. The value
 * is in directing attention: a low Fine Detail subscore tells the artist
 * where to look before burning screens.
 */

import { deltaE2000, hexToLab } from "@/lib/color/space";
import { componentStats, type Mask } from "./morphology";
import type { AnalyzeResult } from "./analyze";
import type { QAResult, QASubscore, SeparationPlan } from "@/lib/types";

export interface ScoreInput {
  plan: SeparationPlan;
  analysis: AnalyzeResult;
  width: number;
  height: number;
  dpi: number;
  /** Digital separation similarity, 0..100. */
  similarity: number;
  /** Fraction of artboard covered by the union of all non-base inks. */
  topInkUnion: number;
}

/**
 * Smallest feature a mesh can reliably hold, in inches.
 * Derived from the practical guideline that a printable line needs to span
 * several mesh openings; finer mesh holds finer detail.
 */
function minFeatureInches(mesh: number): number {
  // 110 mesh ~ 0.010in, 305 mesh ~ 0.003in, interpolated.
  const table: [number, number][] = [
    [110, 0.010], [156, 0.007], [180, 0.006], [200, 0.0055], [230, 0.0045], [305, 0.003],
  ];
  if (mesh <= table[0][0]) return table[0][1];
  if (mesh >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [m0, v0] = table[i];
    const [m1, v1] = table[i + 1];
    if (mesh >= m0 && mesh <= m1) {
      const t = (mesh - m0) / (m1 - m0);
      return v0 + (v1 - v0) * t;
    }
  }
  return 0.006;
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function scoreSeparation(input: ScoreInput): QAResult {
  const { plan, analysis, width, height, dpi, similarity, topInkUnion } = input;
  const warnings: string[] = [];
  const subscores: QASubscore[] = [];

  // ---- Color Fidelity -------------------------------------------------
  subscores.push({
    key: "fidelity",
    label: "Color Fidelity",
    score: clampScore(similarity),
    detail: `${similarity}% digital separation similarity`,
    tooltip:
      "How closely the composited separations reproduce the original artwork, from mean CIEDE2000 color error blended with structural similarity (SSIM). This measures the separation as pixels, not the physical print.",
  });
  if (similarity < 75) warnings.push("Composite differs noticeably from the original — consider allowing more screens.");

  // ---- Screen Efficiency ---------------------------------------------
  const printed = plan.inks.length;
  const spots = plan.inks.filter((i) => i.type === "spot" || i.type === "black");

  // Penalise near-duplicate inks: two screens doing one screen's work.
  let nearDupes = 0;
  let minPairDE = Infinity;
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const d = deltaE2000(hexToLab(spots[i].displayColor), hexToLab(spots[j].displayColor));
      minPairDE = Math.min(minPairDE, d);
      if (d < 10) nearDupes++;
    }
  }

  const knockoutShare = plan.knockouts.reduce((s, k) => s + k.coverage, 0);
  // Rewards using the garment instead of ink; penalises redundant screens
  // and screens that carry almost nothing.
  const trivialInks = plan.inks.filter((i) => i.coverage < 0.005).length;
  const efficiency =
    100 - nearDupes * 14 - trivialInks * 10 + Math.min(15, knockoutShare * 40) - Math.max(0, printed - 8) * 5;

  subscores.push({
    key: "efficiency",
    label: "Screen Efficiency",
    score: clampScore(efficiency),
    detail:
      `${printed} screen${printed === 1 ? "" : "s"}` +
      (nearDupes > 0 ? `, ${nearDupes} near-duplicate pair${nearDupes === 1 ? "" : "s"}` : "") +
      (knockoutShare > 0.01 ? `, ${(knockoutShare * 100).toFixed(0)}% garment knockout` : ""),
    tooltip:
      "Counts screens against the work they do: inks that are perceptually near-duplicates, inks covering almost nothing, and credit for letting the garment supply a color instead of printing it.",
  });
  if (nearDupes > 0) warnings.push(`${nearDupes} ink pair${nearDupes === 1 ? "" : "s"} within ΔE 10 — they may be combinable.`);
  if (trivialInks > 0) warnings.push(`${trivialInks} separation${trivialInks === 1 ? "" : "s"} cover under 0.5% of the artwork.`);

  // ---- Registration Risk ---------------------------------------------
  // Thin isolated features and many small components mean tight registration.
  let totalSmall = 0;
  let totalComponents = 0;
  for (const ink of plan.inks) {
    const m: Mask = { width, height, data: ink.mask };
    const st = componentStats(m, 128);
    totalSmall += st.smallAreas;
    totalComponents += st.count;
  }
  const fragmentRatio = totalComponents > 0 ? totalSmall / totalComponents : 0;
  const trapDependence = plan.knockouts.length > 0 && analysis.edgeComplexity > 0.2 ? 12 : 0;
  const regScore = 100 - fragmentRatio * 55 - analysis.edgeComplexity * 60 - trapDependence - Math.max(0, printed - 6) * 3;

  subscores.push({
    key: "registration",
    label: "Registration Risk",
    score: clampScore(regScore),
    detail: `${totalComponents.toLocaleString()} shapes, ${(fragmentRatio * 100).toFixed(0)}% very small`,
    tooltip:
      "Higher is safer. Considers the proportion of tiny isolated shapes across all screens, overall edge complexity, how much the design depends on knockouts trapping cleanly, and the number of screens that must align.",
  });
  if (fragmentRatio > 0.4) warnings.push("Many tiny isolated shapes — registration drift will be visible.");

  // ---- Underbase Coverage --------------------------------------------
  const base = plan.inks.find((i) => i.type === "underbase");
  let ubScore = 100;
  let ubDetail = "Not required on a light garment";
  if (plan.garmentIsDark) {
    if (!base) {
      ubScore = 25;
      ubDetail = "Dark garment with no underbase";
      warnings.push("Dark garment without an underbase — colored inks will not read.");
    } else {
      // The base should cover roughly the union of the top inks. Comparing
      // against the union rather than the largest single ink matters: with
      // six screens the biggest ink may cover a quarter of the art while the
      // inks together cover all of it, which would read as a wild over-base.
      const ratio = topInkUnion > 0 ? base.coverage / topInkUnion : 1;
      ubDetail = `${(base.coverage * 100).toFixed(1)}% of artboard, ${(ratio * 100).toFixed(0)}% of top-ink area`;
      if (ratio < 0.6) { ubScore = 55; warnings.push("Underbase is much smaller than the inks above it — the choke may be too aggressive."); }
      else if (ratio > 1.6) { ubScore = 70; warnings.push("Underbase extends well beyond the inks above it — it may show at the edges."); }
      else ubScore = 92;
    }
  }
  subscores.push({
    key: "underbase",
    label: "Underbase Coverage",
    score: clampScore(ubScore),
    detail: ubDetail,
    tooltip:
      "Compares the underbase against the ink that sits on it. A base much smaller than the top colors is over-choked and will show garment through the edges; a base much larger will halo white around the design.",
  });

  // ---- Fine Detail Risk ----------------------------------------------
  // Compare the artwork's smallest features against what the mesh can hold.
  const coarsestMesh = Math.min(...plan.inks.map((i) => i.mesh));
  const holdIn = minFeatureInches(coarsestMesh);
  const holdPx = holdIn * dpi;
  const featurePx = Math.max(1, Math.round(holdPx));
  // A feature is at risk if it is thinner than the mesh can hold.
  let atRisk = 0;
  let considered = 0;
  for (const ink of plan.inks) {
    const m: Mask = { width, height, data: ink.mask };
    const st = componentStats(m, 128);
    considered += st.count;
    // Components smaller in area than a square of the minimum feature size.
    if (st.count > 0) atRisk += st.smallAreas * (featurePx > 2 ? 1 : 0.5);
  }
  const detailRatio = considered > 0 ? atRisk / considered : 0;
  const detailScore = 100 - detailRatio * 70 - (analysis.isLineArt && coarsestMesh < 156 ? 15 : 0);

  subscores.push({
    key: "detail",
    label: "Fine Detail Risk",
    score: clampScore(detailScore),
    detail: `Coarsest screen ${coarsestMesh} mesh holds ~${holdIn.toFixed(3)}in (${featurePx}px at ${dpi} DPI)`,
    tooltip:
      "Higher is safer. Compares the smallest shapes in each separation against the finest feature the coarsest mesh in the job can reliably hold at the working resolution.",
  });
  if (detailRatio > 0.35) warnings.push(`Fine detail may not hold on ${coarsestMesh} mesh — consider a finer mesh.`);

  // ---- Halftone Compatibility ----------------------------------------
  // Tonal artwork needs halftones; halftones need enough mesh for the LPI.
  const tonal = analysis.gradientRatio;
  const meanDensity = plan.inks.reduce((s, i) => s + i.meanDensity, 0) / Math.max(1, plan.inks.length);
  // Practical guideline: mesh count should be roughly 3.5-4x the LPI.
  const maxSafeLpi = Math.floor(coarsestMesh / 4);
  let htScore = 100;
  let htDetail = `Up to ~${maxSafeLpi} LPI on ${coarsestMesh} mesh`;
  if (tonal > 0.2 && maxSafeLpi < 45) {
    htScore = 60;
    htDetail = `Tonal artwork but ${coarsestMesh} mesh supports only ~${maxSafeLpi} LPI`;
    warnings.push(`Artwork has gradients but the coarsest mesh (${coarsestMesh}) supports only about ${maxSafeLpi} LPI.`);
  } else if (meanDensity < 0.9 && maxSafeLpi < 40) {
    htScore = 70;
    htDetail = `Soft-edged separations on ${coarsestMesh} mesh`;
  }
  subscores.push({
    key: "halftone",
    label: "Halftone Compatibility",
    score: clampScore(htScore),
    detail: htDetail,
    tooltip:
      "Whether the tonal content in the separations can be screened at a line count the mesh will hold. Uses the common guideline that mesh count should be roughly four times the LPI.",
  });

  // ---- Overall --------------------------------------------------------
  const weights: Record<string, number> = {
    fidelity: 0.28, efficiency: 0.16, registration: 0.2, underbase: 0.14, detail: 0.14, halftone: 0.08,
  };
  let total = 0;
  for (const s of subscores) total += s.score * (weights[s.key] ?? 0);
  const score = clampScore(total);

  const verdict =
    score >= 88 ? "PRESS READY" :
    score >= 72 ? "REVIEW ADVISED" :
    score >= 55 ? "NEEDS WORK" : "NOT READY";

  return { score, verdict, subscores, warnings };
}
