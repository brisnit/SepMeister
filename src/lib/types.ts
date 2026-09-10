/** Core data model for Sep AI. Shaped so accounts/jobs can be layered on later. */

export type SeparationMethod = "ai" | "spot" | "simulated" | "index";
export type InkType = "underbase" | "spot" | "black" | "highlight";
export type InkChemistry = "plastisol" | "waterbased" | "unknown";
export type DotShape = "round" | "ellipse" | "square";

export interface Artwork {
  id: string;
  fileName: string;
  fileType: string;
  width: number;
  height: number;
  /** DPI declared by the file, or null when the format carries none. */
  dpi: number | null;
  hasAlpha: boolean;
  /** Detected background hex, or null if artwork is fully opaque with no dominant border color. */
  detectedBackground: string | null;
  uniqueColors: number;
  /** Whether uniqueColors is an exact count or capped at a sampling ceiling. */
  uniqueColorsExact: boolean;
  /** RGBA8, length = width*height*4. Not persisted to storage. */
  pixels: Uint8ClampedArray;
}

export interface ProductionSettings {
  jobName: string;
  garmentColor: string;
  maxScreens: number | null; // null = no limit
  method: SeparationMethod;
  meshCount: number | "auto";
  inkType: InkChemistry;
  useGarmentAsBlack: boolean;
}

export interface MaskSettings {
  /** Lower bound below which coverage is dropped to zero (0..255). */
  threshold: number;
  /** Multiplies coverage before clamping. 1 = unchanged. */
  gain: number;
  /** Morphological erosion in pixels (pulls ink in). */
  choke: number;
  /** Morphological dilation in pixels (pushes ink out). */
  spread: number;
}

/**
 * Halftone screening for a single separation.
 *
 * Per-ink rather than per-job: an underbase is normally printed solid while
 * the colors above it are screened, and a detail black often runs a different
 * line count and angle from the rest. A single global setting cannot express
 * any of that.
 */
export interface InkHalftone {
  enabled: boolean;
  /** Lines per inch. */
  lpi: number;
  /** Screen angle in degrees. */
  angle: number;
  shape: DotShape;
}

export interface InkSeparation {
  id: string;
  name: string;
  displayColor: string;
  type: InkType;
  /** Print sequence, 0-based. */
  order: number;
  visible: boolean;
  /** Fraction of artboard area carrying ink, 0..1. */
  coverage: number;
  /** Mean coverage weighted over inked pixels — indicates tonal vs solid. */
  meanDensity: number;
  mesh: number;
  settings: MaskSettings;
  halftone: InkHalftone;
  /** Grayscale coverage, 0=no ink 255=full. length = width*height. */
  mask: Uint8ClampedArray;
  /** Human-readable note about how this ink was derived. */
  note?: string;
}

export interface MergeRecord {
  keptInk: string;
  mergedInk: string;
  deltaE: number;
  reason: string;
}

export interface SeparationPlan {
  garmentColor: string;
  garmentIsDark: boolean;
  maxScreens: number | null;
  method: SeparationMethod;
  recommendedScreens: number;
  naturalColorFamilies: number;
  inks: InkSeparation[];
  printOrder: string[];
  merges: MergeRecord[];
  knockouts: { hex: string; coverage: number }[];
  explanation: string;
}

/**
 * Job-level halftone defaults, applied to each separation as it is created.
 * Per-ink values live on the separation and always win.
 */
export interface HalftoneSettings {
  enabled: boolean;
  lpi: number;
  shape: DotShape;
}

export interface ExportSettings {
  /**
   * Raster resolution of the exported film, in DPI.
   *
   * Distinct from the artwork's own effective resolution. Films are output at
   * device resolution so halftone dots render crisply; when this exceeds the
   * artwork's effective DPI the coverage mask is resampled, which sharpens the
   * dots without inventing detail that was never in the artwork.
   */
  filmDpi: number;
  includeRegistration: boolean;
  includeCropMarks: boolean;
  includeCenterMarks: boolean;
  /** Extra artboard margin around artwork, in inches. */
  marginIn: number;
}

export type SizeUnit = "in" | "cm";

/**
 * The physical size the artwork will print at.
 *
 * This is the source of truth for film geometry. The artwork's pixel count
 * plus this size determines its effective resolution, which is what actually
 * governs how much detail can be held -- a 1200px file is a crisp 4in print
 * and a soft 14in one.
 */
export interface ProductionSize {
  widthIn: number;
  heightIn: number;
  /** Unit the artist is working in. Values are always stored in inches. */
  units: SizeUnit;
  lockAspect: boolean;
}

/** Optional job paperwork, printed on films, the proof and the production sheet. */
export interface JobMetadata {
  id: string;
  jobName: string;
  customer: string;
  notes: string;
  createdAt: string;
}

export interface QASubscore {
  key: string;
  label: string;
  score: number;
  detail: string;
  tooltip: string;
}

export interface QAResult {
  score: number;
  verdict: string;
  subscores: QASubscore[];
  warnings: string[];
}

export interface ImageAnalysis {
  width: number;
  height: number;
  hasAlpha: boolean;
  detectedBackground: string | null;
  uniqueColors: number;
  uniqueColorsExact: boolean;
  meanLuminance: number;
  meanSaturation: number;
  /** 0..1 share of pixels sitting on a strong gradient. */
  edgeComplexity: number;
  /** 0..1 share of pixels in smooth tonal ramps. */
  gradientRatio: number;
  /** Heuristic classification of artwork character. */
  artworkType: "line-art" | "illustration" | "photographic";
  isLineArt: boolean;
  darkRegionRatio: number;
  lightRegionRatio: number;
  transparentRatio: number;
  dominantColors: { hex: string; weight: number }[];
  notes: string[];
}

export interface Job {
  id: string;
  createdAt: string;
  metadata: JobMetadata;
  artwork: Artwork;
  settings: ProductionSettings;
  productionSize: ProductionSize;
  analysis: ImageAnalysis;
  plan: SeparationPlan;
  halftone: HalftoneSettings;
  exportSettings: ExportSettings;
  qa: QAResult;
  similarity: { deltaE: number; ssim: number; percent: number } | null;
}

/**
 * A saved press configuration.
 *
 * These describe one shop's equipment and habits. They are explicitly not
 * industry standards -- the built-in examples are starting points, and every
 * value is meant to be overridden.
 */
export interface PressPreset {
  id: string;
  name: string;
  /** Built-in examples cannot be deleted, only duplicated. */
  builtIn: boolean;
  garmentColor: string;
  inkType: InkChemistry;
  maxScreens: number | null;
  useGarmentAsBlack: boolean;
  /** Mesh for ordinary spot colors. */
  defaultMesh: number;
  underbaseMesh: number;
  highlightMesh: number;
  /** Mesh for a dedicated black/detail screen. */
  detailMesh: number;
  defaultLpi: number;
  defaultDotShape: DotShape;
  halftonesEnabled: boolean;
  underbaseChoke: number;
  notes?: string;
}

/** Product tiers. No billing is implemented; this only shapes the UI. */
export type PlanTier = "FREE" | "PAY_PER_JOB" | "CREATOR" | "SHOP" | "PRO";

export interface Entitlements {
  tier: PlanTier;
  /** null = unmetered. */
  separationCredits: number | null;
  maxScreens: number | null;
  savedJobs: number | null;
  premiumExports: boolean;
  advancedOptimization: boolean;
  shopPresets: boolean;
  batchJobs: boolean;
}

export interface AccountState {
  entitlements: Entitlements;
  /** Separations completed locally. Groundwork for a credit system; enforces nothing. */
  separationsCompleted: number;
  firstSeenAt: string;
}

export type FeedbackOutcome = "excellent" | "good" | "needs-adjustment" | "failed";

/**
 * A record of what actually happened on press.
 *
 * The point of collecting this is to connect artwork and settings to a real
 * printed result, including whatever the operator changed before printing --
 * that delta is the most informative part.
 */
export interface FeedbackRecord {
  id: string;
  jobId: string;
  jobName: string;
  recordedAt: string;
  outcome: FeedbackOutcome;
  filmsRegistered: boolean | null;
  underbasePrinted: boolean | null;
  detailHeld: boolean | null;
  colorsClose: boolean | null;
  changedAnything: boolean | null;
  whatChanged: string;
  notes: string;
  /** Snapshot of the settings that produced the films. */
  snapshot: {
    screens: number;
    garmentColor: string;
    widthIn: number;
    heightIn: number;
    effectiveDpi: number;
    sepScore: number;
    similarity: number;
    inks: { name: string; mesh: number; lpi: number | null; angle: number | null; shape: string | null }[];
  };
}

export type FilmQAStatus = "pass" | "warn" | "fail";

export interface FilmQACheck {
  key: string;
  label: string;
  status: FilmQAStatus;
  detail: string;
}

export interface FilmQAReport {
  checks: FilmQACheck[];
  passed: number;
  warnings: number;
  failures: number;
}

export interface ProgressEvent {
  stage: string;
  message: string;
  /** Only set when the stage can genuinely report a fraction. */
  fraction?: number;
}
