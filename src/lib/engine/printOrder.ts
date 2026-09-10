/**
 * Print order recommendation.
 *
 * Heuristic, not doctrine. Shops sequence jobs differently depending on press
 * type, ink chemistry, flash position and habit, and a separator will often
 * have a good reason to depart from this. The recommendation exists to give a
 * sensible starting point and to explain its reasoning, not to be obeyed.
 */

import { hexToRgb, relativeLuminance } from "@/lib/color/space";
import type { InkSeparation } from "@/lib/types";

export interface PrintOrderSuggestion {
  /** Ink ids in the suggested sequence. */
  order: string[];
  reasoning: string;
  /** True when the current order already matches the suggestion. */
  matchesCurrent: boolean;
}

function luminanceOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return relativeLuminance(r, g, b);
}

/**
 * Ranks inks into bands, then orders within each band.
 *
 * The bands encode the parts that are close to universal: the base goes down
 * first because everything else needs something opaque to sit on, a highlight
 * white goes immediately after it, and a detail black runs last so its
 * linework lands on top of everything and stays crisp. Within the spot colors,
 * light-to-dark is the common default for wet-on-wet buildup.
 */
export function suggestPrintOrder(inks: InkSeparation[]): PrintOrderSuggestion {
  const band = (ink: InkSeparation): number => {
    if (ink.type === "underbase") return 0;
    if (ink.type === "highlight") return 1;
    if (ink.type === "black") return 3;
    return 2;
  };

  const sorted = [...inks].sort((a, b) => {
    const ba = band(a);
    const bb = band(b);
    if (ba !== bb) return ba - bb;
    // Light to dark within the spot band.
    const la = luminanceOf(a.displayColor);
    const lb = luminanceOf(b.displayColor);
    if (Math.abs(la - lb) > 0.001) return lb - la;
    // Stable tiebreak so the suggestion is deterministic.
    return a.id.localeCompare(b.id);
  });

  const order = sorted.map((i) => i.id);
  const current = [...inks].sort((a, b) => a.order - b.order).map((i) => i.id);
  const matchesCurrent = order.length === current.length && order.every((id, i) => id === current[i]);

  const parts: string[] = [];
  if (inks.some((i) => i.type === "underbase")) {
    parts.push("the underbase prints first so the colors above it have something opaque to sit on");
  }
  if (inks.some((i) => i.type === "highlight")) {
    parts.push("highlight white follows the base");
  }
  const spots = inks.filter((i) => i.type === "spot").length;
  if (spots > 1) parts.push("spot colors run light to dark for tonal buildup");
  if (inks.some((i) => i.type === "black")) {
    parts.push("the detail black runs last so its linework stays crisp on top");
  }

  const reasoning = parts.length
    ? `Suggested because ${parts.join(", ")}. Your press, ink and flash position may call for a different sequence.`
    : "Only one screen, so there is nothing to sequence.";

  return { order, reasoning, matchesCurrent };
}

/** Reorders inks to the given id sequence and renumbers `order`. */
export function applyPrintOrder(inks: InkSeparation[], order: string[]): InkSeparation[] {
  const byId = new Map(inks.map((i) => [i.id, i]));
  const out: InkSeparation[] = [];
  for (const id of order) {
    const ink = byId.get(id);
    if (ink) { out.push(ink); byId.delete(id); }
  }
  // Anything the order did not mention keeps its relative position at the end.
  for (const ink of inks) if (byId.has(ink.id)) out.push(ink);
  return out.map((ink, i) => ({ ...ink, order: i }));
}
