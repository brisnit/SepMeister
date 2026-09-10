/**
 * Press presets: a shop's own equipment and habits, saved locally.
 *
 * The built-in examples are starting points drawn from common shop setups.
 * They are explicitly NOT industry standards, and the UI says so -- a manual
 * press with 110 mesh white and a six-color automatic with 230s are both
 * completely ordinary, and neither is "correct".
 */

import type { PressPreset, ProductionSettings, HalftoneSettings } from "@/lib/types";
import { readJson, writeJson, STORAGE_KEYS, makeId } from "./storage";

export const BUILT_IN_PRESETS: PressPreset[] = [
  {
    id: "builtin-manual-6",
    name: "Manual 6-Color Press",
    builtIn: true,
    garmentColor: "#111111",
    inkType: "plastisol",
    maxScreens: 6,
    useGarmentAsBlack: true,
    defaultMesh: 156,
    underbaseMesh: 110,
    highlightMesh: 230,
    detailMesh: 230,
    defaultLpi: 45,
    defaultDotShape: "round",
    halftonesEnabled: true,
    underbaseChoke: 1,
    notes: "Coarser white for a solid base, mid mesh for spots. A starting point, not a standard.",
  },
  {
    id: "builtin-auto-8",
    name: "8-Color Automatic",
    builtIn: true,
    garmentColor: "#111111",
    inkType: "plastisol",
    maxScreens: 8,
    useGarmentAsBlack: true,
    defaultMesh: 230,
    underbaseMesh: 156,
    highlightMesh: 230,
    detailMesh: 305,
    defaultLpi: 55,
    defaultDotShape: "ellipse",
    halftonesEnabled: true,
    underbaseChoke: 1,
    notes: "Finer mesh throughout, suited to an automatic holding tighter registration.",
  },
  {
    id: "builtin-light-waterbased",
    name: "Water-based, Light Garments",
    builtIn: true,
    garmentColor: "#f5f5f5",
    inkType: "waterbased",
    maxScreens: 4,
    useGarmentAsBlack: false,
    defaultMesh: 180,
    underbaseMesh: 156,
    highlightMesh: 230,
    detailMesh: 230,
    defaultLpi: 35,
    defaultDotShape: "round",
    halftonesEnabled: false,
    underbaseChoke: 0,
    notes: "No underbase needed on light garments. Coarser line count suits water-based ink.",
  },
];

export function loadPresets(): PressPreset[] {
  const saved = readJson<PressPreset[]>(STORAGE_KEYS.presets, []);
  const custom = Array.isArray(saved) ? saved.filter(isPreset).map(normalizePreset) : [];
  // Built-ins are always present and always first; custom presets follow.
  return [...BUILT_IN_PRESETS, ...custom.filter((p) => !p.builtIn)];
}

export function savePresets(presets: PressPreset[]): boolean {
  return writeJson(STORAGE_KEYS.presets, presets.filter((p) => !p.builtIn));
}

function isPreset(value: unknown): value is PressPreset {
  return !!value && typeof value === "object" && typeof (value as PressPreset).id === "string";
}

/** Fills in fields a preset saved by an older build may not have. */
function normalizePreset(p: PressPreset): PressPreset {
  const fallback = BUILT_IN_PRESETS[0];
  return {
    ...fallback,
    ...p,
    builtIn: false,
    maxScreens: p.maxScreens === undefined ? fallback.maxScreens : p.maxScreens,
  };
}

/** Captures the current job's settings as a reusable preset. */
export function presetFromCurrent(
  name: string,
  settings: ProductionSettings,
  halftone: HalftoneSettings,
  meshes: { defaultMesh: number; underbaseMesh: number; highlightMesh: number; detailMesh: number },
  underbaseChoke: number,
): PressPreset {
  return {
    id: makeId("preset"),
    name: name.trim() || "Untitled preset",
    builtIn: false,
    garmentColor: settings.garmentColor,
    inkType: settings.inkType,
    maxScreens: settings.maxScreens,
    useGarmentAsBlack: settings.useGarmentAsBlack,
    defaultMesh: meshes.defaultMesh,
    underbaseMesh: meshes.underbaseMesh,
    highlightMesh: meshes.highlightMesh,
    detailMesh: meshes.detailMesh,
    defaultLpi: halftone.lpi,
    defaultDotShape: halftone.shape,
    halftonesEnabled: halftone.enabled,
    underbaseChoke,
  };
}

export function duplicatePreset(preset: PressPreset): PressPreset {
  return { ...preset, id: makeId("preset"), name: `${preset.name} copy`, builtIn: false };
}

/** Mesh a preset assigns to a given ink role. */
export function meshForRole(preset: PressPreset, type: string): number {
  switch (type) {
    case "underbase": return preset.underbaseMesh;
    case "highlight": return preset.highlightMesh;
    case "black": return preset.detailMesh;
    default: return preset.defaultMesh;
  }
}

/** The production settings a preset implies, merged over the current ones. */
export function applyPresetToSettings(preset: PressPreset, current: ProductionSettings): ProductionSettings {
  return {
    ...current,
    garmentColor: preset.garmentColor,
    inkType: preset.inkType,
    maxScreens: preset.maxScreens,
    useGarmentAsBlack: preset.useGarmentAsBlack,
    meshCount: "auto",
  };
}

export function halftoneFromPreset(preset: PressPreset): HalftoneSettings {
  return { enabled: preset.halftonesEnabled, lpi: preset.defaultLpi, shape: preset.defaultDotShape };
}
