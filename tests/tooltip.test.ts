import { describe, it, expect } from "vitest";
import {
  placeTooltip, tooltipSpan, TIP_MARGIN, TIP_WIDTH, TIP_OFFSET,
  type Rect, type Viewport,
} from "@/lib/ui/tooltip";

const VIEW: Viewport = { width: 1680, height: 1050 };

/** A 16px trigger button with its top-left at (x, y). */
function trigger(x: number, y: number): Rect {
  return { left: x, right: x + 16, top: y, bottom: y + 16 };
}

/**
 * The property that actually matters, asserted directly: whatever the anchor
 * position, the rendered tooltip must lie entirely inside the viewport.
 */
function assertOnScreen(anchor: Rect, view: Viewport, height = 120) {
  const p = placeTooltip(anchor, view, height);
  const span = tooltipSpan(p, height);
  expect(p.left, "left edge off screen").toBeGreaterThanOrEqual(0);
  expect(p.left + p.width, "right edge off screen").toBeLessThanOrEqual(view.width);
  expect(span.top, "top edge off screen").toBeGreaterThanOrEqual(0);
  expect(span.bottom, "bottom edge off screen").toBeLessThanOrEqual(view.height);
  return p;
}

describe("tooltip placement", () => {
  it("right-aligns to the trigger when there is room", () => {
    const anchor = trigger(1400, 500);
    const p = placeTooltip(anchor, VIEW, 120);
    expect(p.left).toBe(anchor.right - TIP_WIDTH);
    expect(p.width).toBe(TIP_WIDTH);
  });

  it("sits above the trigger when there is room above", () => {
    const p = placeTooltip(trigger(1400, 500), VIEW, 120);
    expect(p.below).toBe(false);
    expect(p.top).toBe(500 - TIP_OFFSET);
    // Positioned by its bottom edge, so the span runs upward from there.
    expect(tooltipSpan(p, 120)).toEqual({ top: 500 - TIP_OFFSET - 120, bottom: 500 - TIP_OFFSET });
  });

  it("flips below when the trigger is near the top", () => {
    const anchor = trigger(1400, 20);
    const p = placeTooltip(anchor, VIEW, 120);
    expect(p.below).toBe(true);
    expect(p.top).toBe(anchor.bottom + TIP_OFFSET);
    assertOnScreen(anchor, VIEW);
  });

  it("never crosses the left edge", () => {
    // A trigger at the far left would right-align to a negative x. This is the
    // exact failure that clipped the Sep Score tooltips against the panel wall.
    for (const x of [0, 4, 10, 40, 120, 255]) {
      const p = assertOnScreen(trigger(x, 500), VIEW);
      expect(p.left).toBeGreaterThanOrEqual(TIP_MARGIN);
    }
  });

  it("never crosses the right edge", () => {
    for (const x of [VIEW.width - 20, VIEW.width - 8, VIEW.width - 1]) {
      const p = assertOnScreen(trigger(x, 500), VIEW);
      expect(p.left + p.width).toBeLessThanOrEqual(VIEW.width - TIP_MARGIN);
    }
  });

  it("stays on screen from every corner", () => {
    const corners: [number, number][] = [
      [0, 0], [VIEW.width - 16, 0], [0, VIEW.height - 16], [VIEW.width - 16, VIEW.height - 16],
    ];
    for (const [x, y] of corners) assertOnScreen(trigger(x, y), VIEW);
  });

  it("stays on screen across a sweep of positions and viewports", () => {
    const viewports: Viewport[] = [
      { width: 1680, height: 1050 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 820, height: 1180 },
    ];
    for (const view of viewports) {
      for (let x = 0; x <= view.width - 16; x += 37) {
        for (let y = 0; y <= view.height - 16; y += 53) {
          assertOnScreen(trigger(x, y), view, 140);
        }
      }
    }
  });

  it("narrows rather than overflowing on a very small viewport", () => {
    const narrow: Viewport = { width: 240, height: 600 };
    const p = assertOnScreen(trigger(100, 300), narrow);
    expect(p.width).toBeLessThan(TIP_WIDTH);
    expect(p.width).toBeGreaterThanOrEqual(120);
  });

  it("uses the measured height to decide which way to flip", () => {
    const anchor = trigger(1400, 200);
    // A short tooltip fits above; a tall one does not and must flip.
    expect(placeTooltip(anchor, VIEW, 100).below).toBe(false);
    expect(placeTooltip(anchor, VIEW, 400).below).toBe(true);
  });

  it("prefers the side with more room when neither fits comfortably", () => {
    const squat: Viewport = { width: 1680, height: 300 };
    // Near the bottom of a short viewport there is more room above.
    expect(placeTooltip(trigger(1400, 260), squat, 200).below).toBe(false);
    // Near the top, more room below.
    expect(placeTooltip(trigger(1400, 10), squat, 200).below).toBe(true);
  });

  it("is deterministic", () => {
    const anchor = trigger(1400, 500);
    expect(placeTooltip(anchor, VIEW, 120)).toEqual(placeTooltip(anchor, VIEW, 120));
  });
});
