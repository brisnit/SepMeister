"use client";

/**
 * Paints an RGBA buffer to a canvas at natural size, letting CSS fit it to the
 * viewport. Draws through ImageData rather than an <img> so no re-encode step
 * sits between the engine's output and what the artist sees.
 */

import { useEffect, useRef } from "react";

export function CanvasView({
  rgba, width, height, className = "", checkered = false, alt,
}: {
  rgba: Uint8ClampedArray | null;
  width: number;
  height: number;
  className?: string;
  checkered?: boolean;
  alt: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !rgba || width <= 0 || height <= 0) return;
    if (rgba.length < width * height * 4) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  }, [rgba, width, height]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={alt}
      className={`max-h-full max-w-full object-contain ${checkered ? "checkerboard" : ""} ${className}`}
    />
  );
}

/** Converts a grayscale coverage mask into a black-on-white film RGBA buffer. */
export function maskToFilmRgba(mask: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = 255 - mask[i];
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Renders one ink's coverage in its own color over a garment ground. */
export function maskToInkRgba(
  mask: Uint8ClampedArray,
  hex: string,
  garment: string,
): Uint8ClampedArray {
  const parse = (h: string): [number, number, number] => {
    const s = h.replace("#", "");
    const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ir, ig, ib] = parse(hex);
  const [gr, gg, gb] = parse(garment);
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i] / 255;
    out[i * 4] = Math.round(ir * a + gr * (1 - a));
    out[i * 4 + 1] = Math.round(ig * a + gg * (1 - a));
    out[i * 4 + 2] = Math.round(ib * a + gb * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Draws the underbase over the original artwork.
 *
 * The base is tinted rather than painted opaque so both are visible at once:
 * the artist needs to see where white creeps past a colour's edge and where a
 * colour has no base beneath it, and either is invisible if the base simply
 * covers the art.
 */
export function buildUnderbaseOverlay(
  original: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const cov = mask[i] / 255;
    // Magenta reads clearly over both the light and dark parts of most artwork
    // and is very unlikely to be an actual ink in the design.
    const a = cov * 0.55;
    out[p] = Math.round(255 * a + original[p] * (1 - a));
    out[p + 1] = Math.round(0 * a + original[p + 1] * (1 - a));
    out[p + 2] = Math.round(170 * a + original[p + 2] * (1 - a));
    // Keep the base visible even where the artwork is transparent, since that
    // is exactly where an over-spilled base would be a problem.
    out[p + 3] = Math.max(original[p + 3], Math.round(cov * 255));
  }
  return out;
}

/**
 * Renders a coverage mask as greyscale: white is full ink, black is none.
 *
 * The exact inverse of the film positive, which is why the two are always
 * labelled explicitly wherever either is shown — confusing them means burning
 * a screen backwards.
 */
export function maskToGrayRgba(mask: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}
