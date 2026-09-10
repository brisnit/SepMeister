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
}

/** A registration target: circle with a cross extending past it. */
export interface RegMark {
  cx: number;
  cy: number;
  radius: number;
  armLength: number;
}

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
  const radius = Math.min(8, marginPt * 0.16);
  const armLength = radius * 2.1;

  const registration: RegMark[] = [];
  if (opts.includeRegistration) {
    const left = markInset;
    const right = boardWidthPt - markInset;
    const bottom = markInset;
    const top = boardHeightPt - markInset;
    // Four corners plus mid-edge targets, which is what most manual and
    // semi-automatic presses key off.
    const cx = boardWidthPt / 2;
    const cy = boardHeightPt / 2;
    for (const [x, y] of [
      [left, bottom], [right, bottom], [left, top], [right, top],
      [cx, bottom], [cx, top], [left, cy], [right, cy],
    ]) {
      registration.push({ cx: x, cy: y, radius, armLength });
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
  };
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
