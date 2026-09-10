/**
 * Deterministic synthetic artwork used for the demo mode and the engine tests.
 *
 * Rendered analytically at 3x and box-downsampled, which produces genuine
 * antialiased edges and blended intermediate colors -- exactly the condition
 * that makes naive "select exact pixel color" separation fall apart.
 * Nothing here is copyrighted; it is generated from primitives.
 */

import { clamp01, clamp255 } from "@/lib/color/space";

export interface RasterImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA8
}

type RGB = [number, number, number];

const INK = {
  black: [17, 17, 20] as RGB,
  navy: [26, 42, 88] as RGB,
  lightBlue: [122, 176, 219] as RGB,
  red: [196, 46, 42] as RGB,
  cream: [235, 223, 194] as RGB,
  white: [250, 250, 248] as RGB,
};

interface Painter {
  /** Returns coverage 0..1 and color at a sample point, or null for no paint. */
  sample(x: number, y: number): { color: RGB; alpha: number } | null;
}

function circle(cx: number, cy: number, r: number, color: RGB): Painter {
  return {
    sample(x, y) {
      const d = Math.hypot(x - cx, y - cy);
      return d <= r ? { color, alpha: 1 } : null;
    },
  };
}

function ring(cx: number, cy: number, rOuter: number, rInner: number, color: RGB): Painter {
  return {
    sample(x, y) {
      const d = Math.hypot(x - cx, y - cy);
      return d <= rOuter && d >= rInner ? { color, alpha: 1 } : null;
    },
  };
}

function rect(x0: number, y0: number, x1: number, y1: number, color: RGB): Painter {
  return {
    sample(x, y) {
      return x >= x0 && x <= x1 && y >= y0 && y <= y1 ? { color, alpha: 1 } : null;
    },
  };
}

/** Thick line segment with round caps -- the workhorse for linework. */
function stroke(x0: number, y0: number, x1: number, y1: number, w: number, color: RGB): Painter {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  return {
    sample(x, y) {
      let t = ((x - x0) * dx + (y - y0) * dy) / len2;
      t = clamp01(t);
      const px = x0 + t * dx;
      const py = y0 + t * dy;
      return Math.hypot(x - px, y - py) <= w / 2 ? { color, alpha: 1 } : null;
    },
  };
}

/** Vertical two-color gradient -- exercises tonal separation and halftones. */
function gradientBand(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  top: RGB,
  bottom: RGB,
): Painter {
  return {
    sample(x, y) {
      if (x < x0 || x > x1 || y < y0 || y > y1) return null;
      const t = clamp01((y - y0) / (y1 - y0 || 1));
      return {
        color: [
          top[0] + (bottom[0] - top[0]) * t,
          top[1] + (bottom[1] - top[1]) * t,
          top[2] + (bottom[2] - top[2]) * t,
        ],
        alpha: 1,
      };
    },
  };
}

/** Sine wave band, for the water -- gives curved antialiased edges. */
function wave(
  yBase: number,
  amp: number,
  period: number,
  phase: number,
  thickness: number,
  x0: number,
  x1: number,
  color: RGB,
): Painter {
  return {
    sample(x, y) {
      if (x < x0 || x > x1) return null;
      const yc = yBase + amp * Math.sin((x / period) * Math.PI * 2 + phase);
      return Math.abs(y - yc) <= thickness / 2 ? { color, alpha: 1 } : null;
    },
  };
}


/** Restricts a painter to the interior of a circle -- used to keep the water
 *  and rays inside the badge disc. */
function clipCircle(inner: Painter, cx: number, cy: number, r: number): Painter {
  return {
    sample(x, y) {
      if (Math.hypot(x - cx, y - cy) > r) return null;
      return inner.sample(x, y);
    },
  };
}

/** Anchor shape assembled from strokes and an arc. */
function anchorPainters(cx: number, cy: number, s: number, color: RGB): Painter[] {
  const shank = stroke(cx, cy - 34 * s, cx, cy + 40 * s, 7 * s, color);
  const crossbar = stroke(cx - 22 * s, cy - 22 * s, cx + 22 * s, cy - 22 * s, 6 * s, color);
  const topRing = ring(cx, cy - 42 * s, 10 * s, 5 * s, color);
  // Flukes: approximate the curved arms with short chained segments.
  const arms: Painter[] = [];
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12;
    const t1 = (i + 1) / 12;
    const ax = (t: number) => cx - 38 * s * Math.sin((t * Math.PI) / 2);
    const ay = (t: number) => cy + 40 * s - 26 * s * (1 - Math.cos((t * Math.PI) / 2));
    arms.push(stroke(ax(t0), ay(t0), ax(t1), ay(t1), 6.5 * s, color));
    arms.push(
      stroke(2 * cx - ax(t0), ay(t0), 2 * cx - ax(t1), ay(t1), 6.5 * s, color),
    );
  }
  return [shank, crossbar, topRing, ...arms];
}

/**
 * Builds the demo badge. Layers are painted back-to-front; each is sampled at
 * SS x SS subsample positions per output pixel and averaged.
 */
export function generateDemoArtwork(width = 900, height = 900, transparentBg = true): RasterImage {
  const S = 3; // supersample factor
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.44;

  const layers: Painter[] = [];

  // Cream disc with a navy outer ring and black keyline.
  layers.push(circle(cx, cy, R, INK.black));
  layers.push(circle(cx, cy, R - 5, INK.navy));
  layers.push(circle(cx, cy, R - 26, INK.black));
  layers.push(circle(cx, cy, R - 30, INK.cream));

  // Water: light blue gradient block with wave crests.
  const disc = R - 30;
  layers.push(
    clipCircle(
      gradientBand(cx - R, cy + R * 0.12, cx + R, cy + R, INK.lightBlue, [
        INK.lightBlue[0] * 0.62,
        INK.lightBlue[1] * 0.68,
        INK.lightBlue[2] * 0.82,
      ]),
      cx,
      cy,
      disc,
    ),
  );
  for (let i = 0; i < 3; i++) {
    layers.push(
      clipCircle(
        wave(
          cy + R * (0.18 + i * 0.17),
          R * 0.035,
          R * (0.5 + i * 0.12),
          i * 1.7,
          R * 0.022,
          cx - R,
          cx + R,
          INK.white,
        ),
        cx,
        cy,
        disc,
      ),
    );
  }

  // Anchor in navy with a black outline pass behind it.
  for (const p of anchorPainters(cx, cy - R * 0.06, R / 90, INK.black)) layers.push(p);
  for (const p of anchorPainters(cx, cy - R * 0.06, (R / 90) * 0.72, INK.lightBlue)) layers.push(p);

  // Red banner across the lower third with black edging.
  const by0 = cy + R * 0.30;
  const by1 = cy + R * 0.56;
  layers.push(rect(cx - R * 0.86, by0 - 4, cx + R * 0.86, by1 + 4, INK.black));
  layers.push(
    gradientBand(cx - R * 0.82, by0, cx + R * 0.82, by1, INK.red, [
      INK.red[0] * 0.72,
      INK.red[1] * 0.55,
      INK.red[2] * 0.55,
    ]),
  );

  // Cream "type" bars on the banner -- small features that stress fine detail.
  const barY = (by0 + by1) / 2;
  const barW = R * 0.115;
  for (let i = 0; i < 5; i++) {
    const x = cx - R * 0.6 + i * (barW + R * 0.055);
    layers.push(rect(x, barY - R * 0.045, x + barW, barY + R * 0.045, INK.cream));
  }

  // Radiating navy rays behind the anchor for shading interest.
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + 0.19;
    if (Math.sin(ang) > 0.2) continue; // keep them in the upper field only
    const r0 = R * 0.42;
    const r1 = R * 0.72;
    layers.push(
      clipCircle(
        stroke(
          cx + Math.cos(ang) * r0,
          cy - R * 0.1 + Math.sin(ang) * r0,
          cx + Math.cos(ang) * r1,
          cy - R * 0.1 + Math.sin(ang) * r1,
          R * 0.014,
          INK.navy,
        ),
        cx,
        cy,
        disc,
      ),
    );
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const inv = 1 / (S * S);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          // Painter's algorithm over subsample.
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          if (!transparentBg) {
            cr = INK.white[0];
            cg = INK.white[1];
            cb = INK.white[2];
            ca = 1;
          }
          for (const layer of layers) {
            const hit = layer.sample(px, py);
            if (!hit) continue;
            const a = hit.alpha;
            cr = hit.color[0] * a + cr * (1 - a);
            cg = hit.color[1] * a + cg * (1 - a);
            cb = hit.color[2] * a + cb * (1 - a);
            ca = a + ca * (1 - a);
          }
          rs += cr * ca;
          gs += cg * ca;
          bs += cb * ca;
          as += ca;
        }
      }
      const i = (y * width + x) * 4;
      const aAvg = as * inv;
      // Un-premultiply back to straight alpha.
      const k = aAvg > 0 ? 1 / as : 0;
      out[i] = clamp255(Math.round(rs * k));
      out[i + 1] = clamp255(Math.round(gs * k));
      out[i + 2] = clamp255(Math.round(bs * k));
      out[i + 3] = clamp255(Math.round(aAvg * 255));
    }
  }

  return { width, height, pixels: out };
}

/** Flat two-color logo: no antialiasing, for exact-separation regression tests. */
export function generateFlatLogo(width = 400, height = 400): RasterImage {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inSquare = x > width * 0.25 && x < width * 0.75 && y > height * 0.25 && y < height * 0.75;
      const c: RGB = inSquare ? [200, 30, 40] : [250, 250, 250];
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  return { width, height, pixels: px };
}

/** Smooth horizontal gradient, for tonal/halftone tests. */
export function generateGradient(width = 400, height = 200): RasterImage {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = x / (width - 1);
      px[i] = Math.round(20 + t * 220);
      px[i + 1] = Math.round(40 + t * 120);
      px[i + 2] = Math.round(120 - t * 60);
      px[i + 3] = 255;
    }
  }
  return { width, height, pixels: px };
}
