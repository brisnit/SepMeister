/**
 * Spatial overlap between separations.
 *
 * Moire happens where two screened inks are laid over each other at similar
 * angles. Two screens that never touch can share an angle safely, and on a
 * large job they usually must: only about six angles fit inside 90 degrees at
 * a usable spacing, so a 16-station press has no choice but to reuse them.
 *
 * Without knowing which screens actually overlap, a 16-colour job produces
 * roughly eighteen "these angles are close" warnings, nearly all of which are
 * about pairs that never meet on the shirt. That is worse than silence: it
 * trains the operator to ignore the one warning that mattered. Measuring the
 * overlap turns the whole set into two or three real ones.
 */

export interface OverlapPair {
  a: number;
  b: number;
  /** Overlapping area as a fraction of the smaller of the two inks. */
  fraction: number;
}

/** Coverage below this is edge fringe rather than a real overlap. */
const INK_THRESHOLD = 96;

/**
 * Sampling target. Overlap is a broad-area property, so a few hundred thousand
 * samples resolves it as well as every pixel would while keeping a 16-screen
 * job's 120 pairs cheap to evaluate.
 */
const SAMPLE_BUDGET = 250_000;

/**
 * Measures how much each pair of separations overlaps.
 *
 * Reported as a fraction of the *smaller* ink, because that is what determines
 * whether the overlap is meaningful: a small highlight sitting entirely inside
 * a large background is fully overlapped even though it covers little of it.
 */
export function computeOverlaps(
  masks: Uint8ClampedArray[],
  pixelCount: number,
): OverlapPair[] {
  const n = masks.length;
  if (n < 2 || pixelCount <= 0) return [];

  const step = Math.max(1, Math.floor(pixelCount / SAMPLE_BUDGET));
  const inkedCounts = new Float64Array(n);
  // Pair counts in row-major upper-triangle order.
  const pairCounts = new Float64Array((n * (n - 1)) / 2);
  const pairIndex = (a: number, b: number) => (a * (2 * n - a - 1)) / 2 + (b - a - 1);

  const present: number[] = [];

  for (let i = 0; i < pixelCount; i += step) {
    present.length = 0;
    for (let m = 0; m < n; m++) {
      if (masks[m][i] >= INK_THRESHOLD) {
        present.push(m);
        inkedCounts[m]++;
      }
    }
    // Typically one or two inks per pixel, so this inner loop stays trivial.
    for (let x = 0; x < present.length; x++) {
      for (let y = x + 1; y < present.length; y++) {
        pairCounts[pairIndex(present[x], present[y])]++;
      }
    }
  }

  const out: OverlapPair[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const shared = pairCounts[pairIndex(a, b)];
      if (shared <= 0) continue;
      const smaller = Math.min(inkedCounts[a], inkedCounts[b]);
      if (smaller <= 0) continue;
      out.push({ a, b, fraction: shared / smaller });
    }
  }
  return out;
}

/**
 * Overlap below which two screens sharing an angle will not produce visible
 * moire. A sliver of shared area along a shared edge is not a pattern.
 */
export const SIGNIFICANT_OVERLAP = 0.08;

export interface MoireRisk {
  a: string;
  b: string;
  separation: number;
  overlap: number;
}

/**
 * Finds screen pairs that will actually beat against each other: both
 * screened, angles too close, and enough shared area for the interference to
 * show.
 */
export function findMoireRisks(
  screens: {
    label: string;
    angle: number;
    screened: boolean;
    mask: Uint8ClampedArray;
  }[],
  pixelCount: number,
  minSeparation = 15,
): MoireRisk[] {
  const active = screens.filter((s) => s.screened);
  if (active.length < 2) return [];

  const overlaps = computeOverlaps(active.map((s) => s.mask), pixelCount);
  const risks: MoireRisk[] = [];

  for (const { a, b, fraction } of overlaps) {
    if (fraction < SIGNIFICANT_OVERLAP) continue;
    // A halftone grid repeats every 90 degrees, so 5 and 95 are the same screen.
    const raw = Math.abs(active[a].angle - active[b].angle) % 90;
    const separation = Math.min(raw, 90 - raw);
    if (separation >= minSeparation) continue;
    risks.push({ a: active[a].label, b: active[b].label, separation, overlap: fraction });
  }

  // Worst offenders first: closest angles, then heaviest overlap.
  risks.sort((x, y) => x.separation - y.separation || y.overlap - x.overlap);
  return risks;
}

/**
 * Assigns angles across more screens than a preset holds.
 *
 * Angle reuse is unavoidable past about six screens. Where it has to happen,
 * the reused pairs should be screens that do not overlap, so the choice is
 * made from measured overlap rather than from print order. Each screen takes
 * the angle whose already-assigned holders it overlaps least.
 */
export function assignAnglesByOverlap(
  masks: Uint8ClampedArray[],
  pixelCount: number,
  angles: number[],
): number[] {
  const n = masks.length;
  if (n === 0 || angles.length === 0) return [];
  if (n <= angles.length) return masks.map((_, i) => angles[i]);

  const overlaps = computeOverlaps(masks, pixelCount);
  const overlapOf = new Map<string, number>();
  for (const { a, b, fraction } of overlaps) {
    overlapOf.set(`${a}:${b}`, fraction);
    overlapOf.set(`${b}:${a}`, fraction);
  }

  const assigned: number[] = new Array(n).fill(-1);
  const holders: number[][] = angles.map(() => []);

  for (let i = 0; i < n; i++) {
    let bestAngle = 0;
    let bestCost = Infinity;
    for (let a = 0; a < angles.length; a++) {
      // Cost is the worst overlap against anything already on this angle;
      // an empty angle costs nothing and is taken first.
      let cost = 0;
      for (const holder of holders[a]) {
        cost = Math.max(cost, overlapOf.get(`${i}:${holder}`) ?? 0);
      }
      // Break ties toward the emptier angle so screens spread out evenly.
      const tie = holders[a].length * 1e-6;
      if (cost + tie < bestCost) {
        bestCost = cost + tie;
        bestAngle = a;
      }
    }
    assigned[i] = angles[bestAngle];
    holders[bestAngle].push(i);
  }

  return assigned;
}
