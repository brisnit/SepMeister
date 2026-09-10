/**
 * Structured separation operations.
 *
 * This is the ONLY vocabulary through which anything -- a UI control, a typed
 * command, or a future language model -- may change a separation. Nothing may
 * hand back pixels. A provider proposes operations from this closed set; the
 * deterministic engine executes them and produces the masks.
 *
 * That boundary is the point. It means an AI can never invent artwork, and any
 * change it suggests is inspectable, reversible, and reproducible.
 */

import { MAX_SCREENS } from "@/lib/types";

export type SeparationOperation =
  | { action: "reduce_screen_count"; target: number }
  | { action: "increase_screen_count"; target: number }
  | { action: "set_garment_color"; color: string }
  | { action: "use_garment_as_black"; enabled: boolean }
  | { action: "set_underbase_choke"; pixels: number }
  | { action: "set_underbase_strength"; strength: number }
  | { action: "set_highlight_white"; enabled: boolean }
  | { action: "remove_ink"; inkId: string }
  | { action: "merge_ink"; sourceInkId: string; targetInkId: string }
  | { action: "rename_ink"; inkId: string; name: string }
  | { action: "set_ink_color"; inkId: string; color: string }
  | { action: "set_ink_gain"; inkId: string; gain: number }
  | { action: "set_ink_threshold"; inkId: string; threshold: number }
  | { action: "set_ink_choke"; inkId: string; pixels: number }
  | { action: "set_ink_spread"; inkId: string; pixels: number }
  | { action: "set_ink_mesh"; inkId: string; mesh: number }
  | { action: "set_ink_visible"; inkId: string; visible: boolean }
  | { action: "set_print_order"; inkIds: string[] }
  | { action: "set_method"; method: "ai" | "spot" | "simulated" | "index" }
  | { action: "set_halftone"; enabled: boolean; lpi?: number; shape?: "round" | "ellipse" | "square" }
  | { action: "set_mesh_safety_target"; mesh: number };

export interface OperationResult {
  operations: SeparationOperation[];
  /** Plain-language description of what will happen, shown before applying. */
  explanation: string;
  /** True when the request was understood; false surfaces a helpful message. */
  understood: boolean;
  /** Whether applying these operations requires re-running the full pipeline. */
  requiresReseparation: boolean;
}

/** Operations that change ink identity and so need the pipeline re-run. */
const RESEPARATION_ACTIONS = new Set<SeparationOperation["action"]>([
  "reduce_screen_count",
  "increase_screen_count",
  "set_garment_color",
  "use_garment_as_black",
  "set_highlight_white",
  "set_method",
]);

export function requiresReseparation(ops: SeparationOperation[]): boolean {
  return ops.some((o) => RESEPARATION_ACTIONS.has(o.action));
}

export interface CommandContext {
  inks: { id: string; name: string; type: string }[];
  currentScreenCount: number;
  maxScreens: number | null;
  garmentColor: string;
  underbaseChoke: number;
  meshCounts: number[];
}

/**
 * Provider seam.
 *
 * The built-in implementation is a deterministic parser -- no network, no key,
 * no nondeterminism. A hosted model can be dropped in behind this same
 * interface, and because it returns operations rather than images, the
 * separation engine below it does not change at all.
 */
export interface SepAiProvider {
  readonly id: string;
  readonly label: string;
  /** True when the provider can actually be called in this environment. */
  isAvailable(): boolean;
  interpret(input: string, context: CommandContext): Promise<OperationResult>;
}

/** Finds an ink by loose name match, e.g. "the red" -> the Red separation. */
function findInk(context: CommandContext, phrase: string): { id: string; name: string } | null {
  const p = phrase.toLowerCase().trim();
  if (!p) return null;
  // Exact name first, then containment, longest name wins to avoid
  // "blue" matching "Light Blue" when "Blue" exists.
  const byExact = context.inks.find((i) => i.name.toLowerCase() === p);
  if (byExact) return byExact;

  const candidates = context.inks
    .filter((i) => p.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(p))
    .sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

function parseNumber(text: string): number | null {
  const digits = text.match(/-?\d+(\.\d+)?/);
  if (digits) return parseFloat(digits[0]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

const GARMENT_NAMES: Record<string, string> = {
  black: "#111111",
  white: "#f5f5f5",
  navy: "#1b2a4a",
  red: "#a01c24",
  gray: "#8a8f96",
  grey: "#8a8f96",
  charcoal: "#36393f",
  royal: "#1f4fa8",
  forest: "#1f4d2b",
  maroon: "#5c1a2b",
};

/**
 * Deterministic natural-language command parser.
 *
 * Handles the documented command set exactly and predictably. Anything it does
 * not recognise is reported as not understood rather than guessed at -- a
 * wrong guess here silently changes a press-bound separation.
 */
export function parseCommand(input: string, context: CommandContext): OperationResult {
  const raw = input.trim();
  const text = raw.toLowerCase();
  const no = (msg: string): OperationResult => ({
    operations: [], explanation: msg, understood: false, requiresReseparation: false,
  });
  const yes = (ops: SeparationOperation[], explanation: string): OperationResult => ({
    operations: ops, explanation, understood: true, requiresReseparation: requiresReseparation(ops),
  });

  if (!text) return no("Type a command, or pick one of the suggestions.");

  // ---- Screen count ---------------------------------------------------
  if (/\b(reduce|cut|drop|lower|limit|bring)\b/.test(text) && /\bscreens?\b/.test(text)) {
    const n = parseNumber(text);
    if (n === null) return no("How many screens should this reduce to? Try “reduce this to 5 screens”.");
    if (n < 1 || n > MAX_SCREENS) return no(`Screen counts between 1 and ${MAX_SCREENS} are supported.`);
    return yes([{ action: "reduce_screen_count", target: Math.round(n) }],
      `Re-separate with a maximum of ${Math.round(n)} screens, merging the least significant inks.`);
  }
  if (/\b(increase|raise|more|add|allow)\b/.test(text) && /\bscreens?\b/.test(text)) {
    const n = parseNumber(text);
    if (n === null) return no("How many screens should this allow? Try “allow 8 screens”.");
    return yes([{ action: "increase_screen_count", target: Math.round(n) }],
      `Re-separate allowing up to ${Math.round(n)} screens.`);
  }

  // ---- Garment as black ----------------------------------------------
  if (/\bgarment\b/.test(text) && /\bblack\b/.test(text)) {
    const off = /\b(don'?t|do not|stop|no longer|disable|turn off)\b/.test(text);
    return yes([{ action: "use_garment_as_black", enabled: !off }],
      off
        ? "Print a dedicated black screen instead of relying on the garment."
        : "Knock the artwork's black out to the garment and drop the black screen where it is safe to do so.");
  }

  // ---- Garment color --------------------------------------------------
  if (/\bgarment\b/.test(text) || /\bshirt\b/.test(text)) {
    const hex = text.match(/#[0-9a-f]{3,6}/);
    if (hex) return yes([{ action: "set_garment_color", color: hex[0] }], `Re-separate for a ${hex[0]} garment.`);
    for (const [name, value] of Object.entries(GARMENT_NAMES)) {
      if (new RegExp(`\\b${name}\\b`).test(text)) {
        return yes([{ action: "set_garment_color", color: value }], `Re-separate for a ${name} garment.`);
      }
    }
  }

  // ---- Underbase ------------------------------------------------------
  if (/\bunderbase\b|\bbase\b/.test(text)) {
    const n = parseNumber(text);
    if (/\bchoke\b/.test(text)) {
      if (n === null) return no("How many pixels of choke? Try “set underbase choke to 2px”.");
      const px = Math.max(0, Math.min(4, n));
      return yes([{ action: "set_underbase_choke", pixels: px }], `Choke the underbase by ${px}px.`);
    }
    if (/\b(increase|more|stronger|boost|raise)\b/.test(text)) {
      return yes([{ action: "set_underbase_choke", pixels: 0 }, { action: "set_underbase_strength", strength: 1 }],
        "Remove the underbase choke and print the base at full strength for maximum opacity.");
    }
    if (/\b(reduce|less|thinner|lighter|lower|decrease)\b/.test(text)) {
      return yes([{ action: "set_underbase_strength", strength: 0.75 }],
        "Thin the underbase to 75% density to reduce ink deposit.");
    }
    if (n !== null && /\bpx\b|\bpixel/.test(text)) {
      return yes([{ action: "set_underbase_choke", pixels: Math.max(0, Math.min(4, n)) }],
        `Choke the underbase by ${Math.max(0, Math.min(4, n))}px.`);
    }
  }

  // ---- Highlight white ------------------------------------------------
  if (/\bhighlight\b/.test(text) && /\bwhite\b/.test(text)) {
    const off = /\b(remove|no|without|drop|disable)\b/.test(text);
    return yes([{ action: "set_highlight_white", enabled: !off }],
      off ? "Let the underbase carry the white and free a screen."
          : "Add a dedicated highlight white screen printed over the base.");
  }

  // ---- Halftones -------------------------------------------------------
  if (/\bhalftone|\blpi\b|\bdots?\b/.test(text)) {
    const off = /\b(no|remove|disable|without|off)\b/.test(text);
    if (off) return yes([{ action: "set_halftone", enabled: false }], "Export continuous-tone films with no halftone screening.");
    const n = parseNumber(text);
    const shape = /\bellipse|elliptical\b/.test(text) ? "ellipse" : /\bsquare\b/.test(text) ? "square" : "round";
    return yes([{ action: "set_halftone", enabled: true, lpi: n ? Math.round(n) : 55, shape }],
      `Screen the films at ${n ? Math.round(n) : 55} LPI with ${shape} dots.`);
  }

  // ---- Remove / merge a named ink -------------------------------------
  if (/\b(remove|delete|drop|kill|get rid of)\b/.test(text)) {
    const ink = findInk(context, text.replace(/\b(remove|delete|drop|kill|get rid of|the|screen|ink)\b/g, " "));
    if (!ink) return no("Which separation should be removed? Name it, for example “remove the cream screen”.");
    return yes([{ action: "remove_ink", inkId: ink.id }], `Remove the ${ink.name} separation and rebuild the composite.`);
  }
  if (/\bmerge\b/.test(text)) {
    const parts = text.split(/\binto\b|\bwith\b|\band\b/);
    if (parts.length >= 2) {
      const a = findInk(context, parts[0].replace(/\bmerge\b|\bthe\b/g, " "));
      const b = findInk(context, parts[1]);
      if (a && b && a.id !== b.id) {
        return yes([{ action: "merge_ink", sourceInkId: a.id, targetInkId: b.id }],
          `Fold ${a.name} into ${b.name}, freeing one screen.`);
      }
    }
    return no("Name both separations, for example “merge light blue into navy”.");
  }

  // ---- Per-ink strength ------------------------------------------------
  if (/\b(stronger|darker|heavier|bolder|richer|more)\b/.test(text)) {
    const ink = findInk(context, text.replace(/\b(make|the|stronger|darker|heavier|bolder|richer|more|screen|ink)\b/g, " "));
    if (ink) return yes([{ action: "set_ink_gain", inkId: ink.id, gain: 1.25 }],
      `Increase ${ink.name} coverage by 25%.`);
  }
  if (/\b(weaker|lighter|softer|less)\b/.test(text)) {
    const ink = findInk(context, text.replace(/\b(make|the|weaker|lighter|softer|less|screen|ink)\b/g, " "));
    if (ink) return yes([{ action: "set_ink_gain", inkId: ink.id, gain: 0.8 }],
      `Reduce ${ink.name} coverage by 20%.`);
  }

  // ---- Mesh safety -----------------------------------------------------
  if (/\bmesh\b/.test(text)) {
    const n = parseNumber(text);
    if (n === null) return no("Which mesh count? Try “make this safer for 156 mesh”.");
    return yes([{ action: "set_mesh_safety_target", mesh: Math.round(n) }],
      `Re-check every screen against ${Math.round(n)} mesh and cap the halftone accordingly.`);
  }

  // ---- Explicitly unsupported -----------------------------------------
  if (/\b(detail|face|sharpen|enhance|redraw|fix|improve)\b/.test(text)) {
    return no(
      "Sep AI cannot add or invent detail — separations are derived from the artwork's own pixels. " +
      "To hold more detail, allow more screens, use a finer mesh, or supply higher-resolution artwork.",
    );
  }

  return no(
    "That command isn't recognised yet. Try “reduce this to 5 screens”, “use the garment for black”, " +
    "“increase underbase coverage”, or “remove the cream screen”.",
  );
}

/** Built-in provider: fully local, deterministic, always available. */
export const deterministicProvider: SepAiProvider = {
  id: "deterministic",
  label: "Built-in (deterministic)",
  isAvailable: () => true,
  async interpret(input, context) {
    return parseCommand(input, context);
  },
};

/** Suggestions surfaced in the command bar. All are handled locally. */
export const SUGGESTED_COMMANDS = [
  "Reduce this to 5 screens",
  "Use the garment for black",
  "Increase underbase coverage",
  "Reduce underbase",
  "Remove the cream screen",
  "Make this safer for 156 mesh",
  "Add halftones at 55 LPI",
];
