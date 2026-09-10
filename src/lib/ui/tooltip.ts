/**
 * Tooltip placement.
 *
 * Extracted from the component as pure arithmetic so it can be tested at every
 * screen edge without a browser. This has regressed once already: the panels
 * these tooltips live in scroll, and a scrolling ancestor clips on *both* axes
 * -- `overflow-y: auto` implies horizontal clipping -- which sliced the left
 * edge off every explanation. The component now portals to `document.body` and
 * positions with these coordinates, so the only way to clip again is to get
 * this maths wrong, and that is what the tests pin down.
 */

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  /** True when the tooltip hangs below the trigger instead of above it. */
  below: boolean;
  /** Width actually used, which narrows on a viewport too small for the ideal. */
  width: number;
}

/** Gap kept between the tooltip and the viewport edge. */
export const TIP_MARGIN = 8;
/** Preferred width; narrowed only when the viewport cannot fit it. */
export const TIP_WIDTH = 256;
/** Gap between the tooltip and its trigger. */
export const TIP_OFFSET = 6;

/**
 * Places a tooltip relative to its trigger, clamped inside the viewport.
 *
 * Prefers right-aligned to the trigger and above it, because these sit in a
 * right-hand panel where that keeps them over the artwork rather than off the
 * edge. Both preferences yield to fitting on screen.
 */
export function placeTooltip(
  anchor: Rect,
  viewport: Viewport,
  estimatedHeight = 0,
): TooltipPlacement {
  // On a viewport too narrow for the preferred width, shrink rather than
  // overflow -- a narrower tooltip is readable, a clipped one is not.
  const width = Math.min(TIP_WIDTH, Math.max(120, viewport.width - TIP_MARGIN * 2));

  let left = anchor.right - width;
  const maxLeft = viewport.width - width - TIP_MARGIN;
  if (left > maxLeft) left = maxLeft;
  if (left < TIP_MARGIN) left = TIP_MARGIN;

  // Flip below the trigger when there is not room above for the content.
  const needed = estimatedHeight > 0 ? estimatedHeight : 120;
  const roomAbove = anchor.top - TIP_MARGIN - TIP_OFFSET;
  const roomBelow = viewport.height - anchor.bottom - TIP_MARGIN - TIP_OFFSET;
  const below = roomAbove < needed && roomBelow > roomAbove;

  const top = below ? anchor.bottom + TIP_OFFSET : anchor.top - TIP_OFFSET;

  return { left, top, below, width };
}

/**
 * The vertical span the tooltip will occupy once rendered.
 *
 * The element is positioned by its top edge and, when placed above the
 * trigger, shifted up by its own height with a transform. Callers verifying
 * the result on screen need the resolved span rather than the anchor point.
 */
export function tooltipSpan(placement: TooltipPlacement, height: number): { top: number; bottom: number } {
  return placement.below
    ? { top: placement.top, bottom: placement.top + height }
    : { top: placement.top - height, bottom: placement.top };
}
