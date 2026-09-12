/**
 * Canvas viewport maths for inspection.
 *
 * Kept as pure functions so the transform can be tested without a browser, and
 * so it is structurally obvious that inspecting artwork cannot alter it: none
 * of this touches a mask. Zoom and pan describe how pixels are *shown*, and
 * the separation is read-only throughout.
 */

export interface Viewport {
  /** Scale factor. 1 = one artwork pixel per CSS pixel. */
  scale: number;
  /** Pan offset in CSS pixels, from the container's top-left. */
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Zoom stops an operator expects, as fractions. */
export const ZOOM_STOPS = [0.25, 0.5, 1, 2, 4, 8, 16];

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;

/**
 * Above this scale each artwork pixel covers several screen pixels, and
 * smoothing would invent detail between them. Inspecting a mask edge or a
 * halftone dot means seeing the actual samples, so rendering switches to
 * nearest-neighbour.
 */
export const PIXEL_PRESERVING_SCALE = 2;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Scale that fits the whole artwork inside the container. */
export function fitScale(art: Size, container: Size, padding = 24): number {
  if (art.width <= 0 || art.height <= 0) return 1;
  const w = Math.max(1, container.width - padding * 2);
  const h = Math.max(1, container.height - padding * 2);
  return clampScale(Math.min(w / art.width, h / art.height));
}

/** Scale that fits the artwork's width, letting height overflow. */
export function fitWidthScale(art: Size, container: Size, padding = 24): number {
  if (art.width <= 0) return 1;
  return clampScale(Math.max(1, container.width - padding * 2) / art.width);
}

/** Centres artwork of the given scale inside the container. */
export function centered(art: Size, container: Size, scale: number): Viewport {
  return {
    scale,
    x: (container.width - art.width * scale) / 2,
    y: (container.height - art.height * scale) / 2,
  };
}

export function fitViewport(art: Size, container: Size, padding = 24): Viewport {
  return centered(art, container, fitScale(art, container, padding));
}

/**
 * Zooms about a fixed point, so the artwork pixel under the cursor stays under
 * the cursor. Anchoring to the container centre instead makes the thing you
 * were looking at slide away, which is the difference between inspecting and
 * chasing.
 */
export function zoomAbout(view: Viewport, focus: { x: number; y: number }, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  const ratio = scale / view.scale;
  return {
    scale,
    x: focus.x - (focus.x - view.x) * ratio,
    y: focus.y - (focus.y - view.y) * ratio,
  };
}

/** Next stop up or down from the current scale. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  if (direction > 0) {
    const next = ZOOM_STOPS.find((s) => s > scale + 1e-6);
    return next ?? clampScale(scale * 2);
  }
  const below = [...ZOOM_STOPS].reverse().find((s) => s < scale - 1e-6);
  return below ?? clampScale(scale / 2);
}

/** Container point -> artwork pixel. Fractional; floor for a sample index. */
export function toArtwork(view: Viewport, point: { x: number; y: number }): { x: number; y: number } {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/** Artwork pixel -> container point. */
export function toContainer(view: Viewport, point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

/** Whether an artwork coordinate is inside the image. */
export function withinArtwork(art: Size, point: { x: number; y: number }): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < art.width && point.y < art.height;
}

/**
 * Keeps at least a corner of the artwork reachable.
 *
 * Deliberately loose rather than a hard clamp to the edges: at high zoom a
 * separator needs to push the image right off-centre to get a detail under the
 * loupe, and a strict clamp fights that. This only prevents losing the artwork
 * entirely.
 */
export function constrainPan(view: Viewport, art: Size, container: Size): Viewport {
  const w = art.width * view.scale;
  const h = art.height * view.scale;
  const keep = 48;
  return {
    scale: view.scale,
    x: Math.min(container.width - keep, Math.max(keep - w, view.x)),
    y: Math.min(container.height - keep, Math.max(keep - h, view.y)),
  };
}

/** Label for a zoom stop, e.g. 1 -> "100%". */
export function zoomLabel(scale: number): string {
  const pct = scale * 100;
  return pct >= 100 ? `${Math.round(pct)}%` : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}
