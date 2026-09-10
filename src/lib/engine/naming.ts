/**
 * Human ink names from color values.
 *
 * Screen printers talk in ink names, not hex. A separation list reading
 * "Navy / Light Blue / Cream" is immediately actionable; one reading
 * "#1A2A58 / #7AB0DB / #EBDFC2" is not. Names come from a reference table
 * scored in LAB so that near-misses still land on a sensible family.
 */

import { rgbToLab, hexToRgb, deltaE2000, type Lab } from "@/lib/color/space";

interface NamedColor {
  name: string;
  hex: string;
  lab: Lab;
}

function nc(name: string, hex: string): NamedColor {
  const [r, g, b] = hexToRgb(hex);
  return { name, hex, lab: rgbToLab(r, g, b) };
}

/** Reference names chosen to match common plastisol/water-based stock inks. */
const REFERENCE: NamedColor[] = [
  nc("White", "#ffffff"),
  nc("Off White", "#f4f1e8"),
  nc("Cream", "#e8dcc0"),
  nc("Sand", "#d8c9a3"),
  nc("Tan", "#c19a6b"),
  nc("Gold", "#d4a017"),
  nc("Yellow", "#f5d211"),
  nc("Athletic Gold", "#e8b423"),
  nc("Orange", "#f07818"),
  nc("Burnt Orange", "#c04a12"),
  nc("Red", "#c8262a"),
  nc("Scarlet", "#e02b20"),
  nc("Crimson", "#9e1b32"),
  nc("Maroon", "#6d1f2c"),
  nc("Pink", "#f0839f"),
  nc("Magenta", "#c2185b"),
  nc("Purple", "#5b2a86"),
  nc("Violet", "#7a52c0"),
  nc("Navy", "#1a2a58"),
  nc("Royal Blue", "#1f4fa8"),
  nc("Blue", "#2166c4"),
  nc("Light Blue", "#7ab0db"),
  nc("Powder Blue", "#b7d6ea"),
  nc("Teal", "#158a8a"),
  nc("Turquoise", "#2fbfb0"),
  nc("Forest Green", "#1f4d2b"),
  nc("Green", "#2e8b3d"),
  nc("Kelly Green", "#3aa54a"),
  nc("Lime", "#93c93c"),
  nc("Olive", "#6b6b32"),
  nc("Brown", "#6b4423"),
  nc("Chocolate", "#41291b"),
  nc("Charcoal", "#3c3f44"),
  nc("Dark Gray", "#5a5f66"),
  nc("Gray", "#8b9099"),
  nc("Light Gray", "#c2c7cd"),
  nc("Silver", "#d4d8dc"),
  nc("Black", "#111114"),
];

/** Ranked reference names for a color, nearest first. */
function rankedNames(hex: string): { name: string; dE: number }[] {
  const [r, g, b] = hexToRgb(hex);
  const lab = rgbToLab(r, g, b);
  return REFERENCE
    .map((ref) => ({ name: ref.name, dE: deltaE2000(lab, ref.lab) }))
    .sort((a, b2) => a.dE - b2.dE || a.name.localeCompare(b2.name));
}

/** Nearest reference name, ignoring what other separations are called. */
export function nameForColor(hex: string): string {
  return rankedNames(hex)[0].name;
}

/** Qualifier words that must not be stacked on top of each other. */
const QUALIFIERS = ["Light", "Dark", "Pale", "Deep"];

function stripQualifier(name: string): string {
  for (const q of QUALIFIERS) {
    if (name.startsWith(`${q} `)) return name.slice(q.length + 1);
  }
  return name;
}

/**
 * Assigns every separation a distinct, meaningful ink name.
 *
 * Two screens both labelled "Light Blue" is worse than useless on a press
 * sheet, but so is mechanically prefixing qualifiers -- that is how you end up
 * with "Light Light Blue". Instead each separation is given the nearest
 * reference name not already taken, working outward from the most confident
 * match, so a pair of blues becomes "Light Blue" and "Powder Blue": names an
 * artist can actually pull ink for.
 *
 * Qualifiers are only used as a last resort, and never stacked.
 */
export function disambiguateNames(entries: { hex: string; name: string }[]): string[] {
  const ranked = entries.map((e) => rankedNames(e.hex));

  // Most confident matches claim their name first.
  const order = entries
    .map((_, i) => i)
    .sort((a, b) => ranked[a][0].dE - ranked[b][0].dE || a - b);

  const taken = new Set<string>();
  const out: string[] = new Array(entries.length).fill("");

  for (const i of order) {
    // Only consider alternatives that are still a plausible description.
    const candidate = ranked[i].find((c) => !taken.has(c.name) && c.dE < ranked[i][0].dE + 18);
    if (candidate) {
      out[i] = candidate.name;
      taken.add(candidate.name);
    }
  }

  // Anything still unnamed shares a family with a screen that claimed it;
  // separate them by lightness without stacking qualifiers.
  const unresolved = order.filter((i) => !out[i]);
  for (const i of unresolved) {
    const base = stripQualifier(ranked[i][0].name);
    const [r, g, b] = hexToRgb(entries[i].hex);
    const L = rgbToLab(r, g, b).L;
    const options = L > 55 ? [`Light ${base}`, `Pale ${base}`] : [`Dark ${base}`, `Deep ${base}`];
    let chosen = options.find((o) => !taken.has(o));
    if (!chosen) {
      let n = 2;
      while (taken.has(`${base} ${n}`)) n++;
      chosen = `${base} ${n}`;
    }
    out[i] = chosen;
    taken.add(chosen);
  }

  return out;
}

/** Slug for file names: "Light Blue" -> "light-blue". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ink";
}
