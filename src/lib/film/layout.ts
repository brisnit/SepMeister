/**
 * Film artboard geometry and registration marks.
 *
 * Registration is the whole game. Every film in a job MUST share an identical
 * artboard, identical artwork placement, identical scale and identical marks,
 * or the screens will not line up on press.
 *
 * That guarantee is structural here rather than a matter of care: the layout
 * is computed once per job from the artwork and export settings, and every
 * renderer -- PDF, PNG, on-screen preview -- consumes that one object. There
 * is no code path that can compute a mark position per-film.
 */

export interface FilmLayout {
  /** Artboard size in PDF points (1/72in). */
  boardWidthPt: number;
  boardHeightPt: number;
  /** Artwork rectangle within the artboard, in points, origin bottom-left. */
  artXPt: number;
  artYPt: number;
  artWidthPt: number;
  artHeightPt: number;
  /** Source raster dimensions. */
  pixelWidth: number;
  pixelHeight: number;
  /** Effective resolution of the placed artwork. */
  dpi: number;
  marginPt: number;
  registration: RegMark[];
  centerMarks: CenterMark[];
  cropMarks: CropMark[];
  /** Stroke width for registration artwork, in points. */
  markStroke: number;
  registrationLayout: RegistrationLayout;
}

/** A registration target: circle with a cross extending past it. */
export interface RegMark {
  cx: number;
  cy: number;
  radius: number;
  armLength: number;
  /** Where this target sits, so renderers and tests can reason about layout. */
  position: "top-left" | "top-center" | "top-right" | "bottom-center" | "bottom-left" | "bottom-right" | "left-center" | "right-center";
}

/**
 * Registration target arrangement.
 *
 * "t-shape" is what came back from the shop: three targets across the top and
 * one at the bottom centre, forming a T. The lower corners are dropped because
 * on press they sit where the platen and the operator's hands are, and a mark
 * you cannot see is a mark you cannot align to.
 *
 * "corners" is the earlier eight-target arrangement, kept for jobs that key
 * off the lower corners.
 */
export type RegistrationLayout = "t-shape" | "corners";

/**
 * Line weight for registration artwork.
 *
 * Bold is the default because a hairline target is hard to see through a
 * screen mesh under shop lighting. The weight is bounded against the target
 * radius so the circle never closes into a blob and the cross intersection
 * stays a precise point.
 */
export type RegistrationWeight = "normal" | "bold";

/** A center-line tick on one edge of the artwork bounds. */
export interface CenterMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** An L-shaped corner crop mark, expressed as two segments. */
export interface CropMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const PT_PER_IN = 72;

export interface LayoutOptions {
  pixelWidth: number;
  pixelHeight: number;
  /** Working resolution of the raster. Determines physical artwork size. */
  dpi: number;
  /** Margin around the artwork, in inches. Registration lives here. */
  marginIn: number;
  includeRegistration: boolean;
  includeCenterMarks: boolean;
  includeCropMarks: boolean;
  registrationLayout?: RegistrationLayout;
  registrationWeight?: RegistrationWeight;
}

export function buildLayout(opts: LayoutOptions): FilmLayout {
  const { pixelWidth, pixelHeight, dpi, marginIn } = opts;

  const artWidthPt = (pixelWidth / dpi) * PT_PER_IN;
  const artHeightPt = (pixelHeight / dpi) * PT_PER_IN;
  const marginPt = marginIn * PT_PER_IN;

  const boardWidthPt = artWidthPt + marginPt * 2;
  const boardHeightPt = artHeightPt + marginPt * 2;

  const artXPt = marginPt;
  const artYPt = marginPt;

  // Marks sit centered in the margin band, clear of the artwork.
  const markInset = marginPt / 2;
  const weight: RegistrationWeight = opts.registrationWeight ?? "bold";
  const baseStroke = weight === "bold" ? 1.25 : 0.5;

  // A bold stroke on a small target closes the circle into a dot. Growing the
  // radius with the stroke keeps the ring open and the centre readable.
  const radius = Math.max(Math.min(9, marginPt * 0.18), baseStroke * 3.5);
  const armLength = radius * 2.2;
  // And cap the stroke against the radius actually achieved, so a very tight
  // margin cannot produce a blob.
  const markStroke = Math.min(baseStroke, radius / 3.5);

  const registrationLayout: RegistrationLayout = opts.registrationLayout ?? "t-shape";
  const registration: RegMark[] = [];

  if (opts.includeRegistration) {
    const left = markInset;
    const right = boardWidthPt - markInset;
    const bottom = markInset;
    const top = boardHeightPt - markInset;
    const cx = boardWidthPt / 2;
    const cy = boardHeightPt / 2;

    const places: [number, number, RegMark["position"]][] =
      registrationLayout === "t-shape"
        ? [
            [left, top, "top-left"],
            [cx, top, "top-center"],
            [right, top, "top-right"],
            [cx, bottom, "bottom-center"],
          ]
        : [
            [left, bottom, "bottom-left"],
            [right, bottom, "bottom-right"],
            [left, top, "top-left"],
            [right, top, "top-right"],
            [cx, bottom, "bottom-center"],
            [cx, top, "top-center"],
            [left, cy, "left-center"],
            [right, cy, "right-center"],
          ];

    for (const [x, y, position] of places) {
      registration.push({ cx: x, cy: y, radius, armLength, position });
    }
  }

  const centerMarks: CenterMark[] = [];
  if (opts.includeCenterMarks) {
    const tick = Math.min(marginPt * 0.45, 14);
    const gap = 3;
    const cxArt = artXPt + artWidthPt / 2;
    const cyArt = artYPt + artHeightPt / 2;
    // Ticks pointing at the artwork center from all four edges.
    centerMarks.push({ x1: cxArt, y1: artYPt - gap, x2: cxArt, y2: artYPt - gap - tick });
    centerMarks.push({ x1: cxArt, y1: artYPt + artHeightPt + gap, x2: cxArt, y2: artYPt + artHeightPt + gap + tick });
    centerMarks.push({ x1: artXPt - gap, y1: cyArt, x2: artXPt - gap - tick, y2: cyArt });
    centerMarks.push({ x1: artXPt + artWidthPt + gap, y1: cyArt, x2: artXPt + artWidthPt + gap + tick, y2: cyArt });
  }

  const cropMarks: CropMark[] = [];
  if (opts.includeCropMarks) {
    const len = Math.min(marginPt * 0.5, 18);
    const gap = 4;
    const x0 = artXPt;
    const x1 = artXPt + artWidthPt;
    const y0 = artYPt;
    const y1 = artYPt + artHeightPt;
    const corners: [number, number, number, number][] = [
      // bottom-left
      [x0, y0 - gap, x0, y0 - gap - len],
      [x0 - gap, y0, x0 - gap - len, y0],
      // bottom-right
      [x1, y0 - gap, x1, y0 - gap - len],
      [x1 + gap, y0, x1 + gap + len, y0],
      // top-left
      [x0, y1 + gap, x0, y1 + gap + len],
      [x0 - gap, y1, x0 - gap - len, y1],
      // top-right
      [x1, y1 + gap, x1, y1 + gap + len],
      [x1 + gap, y1, x1 + gap + len, y1],
    ];
    for (const [ax, ay, bx, by] of corners) cropMarks.push({ x1: ax, y1: ay, x2: bx, y2: by });
  }

  return {
    boardWidthPt,
    boardHeightPt,
    artXPt,
    artYPt,
    artWidthPt,
    artHeightPt,
    pixelWidth,
    pixelHeight,
    dpi,
    marginPt,
    registration,
    centerMarks,
    cropMarks,
    markStroke,
    registrationLayout,
  };
}

/** Total reach of a target from its centre, including the cross arms. */
export function markReach(m: RegMark): number {
  return Math.max(m.radius, m.armLength);
}

/** Human-readable artwork size, e.g. `11.00 x 14.00 in`. */
export function describeSize(layout: FilmLayout): string {
  const w = layout.artWidthPt / PT_PER_IN;
  const h = layout.artHeightPt / PT_PER_IN;
  return `${w.toFixed(2)} x ${h.toFixed(2)} in`;
}

/** Metadata printed on every film so a loose sheet is still identifiable. */
export interface FilmLabel {
  jobName: string;
  /** Optional customer name, printed when there is room. */
  customer?: string;
  index: number;
  total: number;
  inkName: string;
  inkColor: string;
  mesh: number;
  sizeText: string;
  scalePercent: number;
  halftone: string | null;
}

export function formatFilmTitle(label: FilmLabel): string {
  return `${String(label.index).padStart(2, "0")} — ${label.inkName.toUpperCase()}`;
}
