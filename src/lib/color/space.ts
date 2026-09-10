/**
 * sRGB <-> CIE LAB (D65) conversions and CIEDE2000 color difference.
 *
 * All separation decisions run in LAB because screen-print ink families are
 * perceptual groupings, not RGB-numeric ones. Two navies that differ by 40 in
 * RGB may be the same screen; a red and an orange that differ by 40 are not.
 */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** D65 reference white, 2-degree observer. */
const Xn = 95.047;
const Yn = 100.0;
const Zn = 108.883;

/** sRGB transfer function (gamma-encoded 0..255 -> linear 0..1). */
export function srgbToLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Inverse sRGB transfer function (linear 0..1 -> gamma-encoded 0..255). */
export function linearToSrgb(l: number): number {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return clamp255(Math.round(c * 255));
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function fLab(t: number): number {
  // CIE standard: cube root above epsilon, linear segment below.
  return t > 0.008856451679035631 ? Math.cbrt(t) : 7.787037037037035 * t + 16 / 116;
}

function fLabInv(t: number): number {
  const t3 = t * t * t;
  return t3 > 0.008856451679035631 ? t3 : (t - 16 / 116) / 7.787037037037035;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  // sRGB D65 matrix, scaled to 0..100.
  const X = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) * 100;
  const Y = (0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) * 100;
  const Z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) * 100;

  const fx = fLab(X / Xn);
  const fy = fLab(Y / Yn);
  const fz = fLab(Z / Zn);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb(lab: Lab): [number, number, number] {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;

  const X = (Xn * fLabInv(fx)) / 100;
  const Y = (Yn * fLabInv(fy)) / 100;
  const Z = (Zn * fLabInv(fz)) / 100;

  const rl = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const gl = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;

  return [linearToSrgb(clamp01(rl)), linearToSrgb(clamp01(gl)), linearToSrgb(clamp01(bl))];
}

/** Fast squared euclidean distance in LAB. Used for hot inner loops. */
export function labDistSq(a: Lab, b: Lab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dL * dL + da * da + db * db;
}

const DEG = Math.PI / 180;

/**
 * CIEDE2000 color difference. Used wherever a decision is user-visible
 * (ink merging, similarity scoring) because CIE76 badly overstates
 * differences in saturated blues, which matters for navy-heavy artwork.
 */
export function deltaE2000(l1: Lab, l2: Lab): number {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.hypot(l1.a, l1.b);
  const C2 = Math.hypot(l2.a, l2.b);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625))); // 25^7

  const a1p = (1 + G) * l1.a;
  const a2p = (1 + G) * l2.a;

  const C1p = Math.hypot(a1p, l1.b);
  const C2p = Math.hypot(a2p, l2.b);

  const h1p = hueAngle(l1.b, a1p);
  const h2p = hueAngle(l2.b, a2p);

  const dLp = l2.L - l1.L;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

  const Lbarp = (l1.L + l2.L) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * DEG) +
    0.24 * Math.cos(2 * hbarp * DEG) +
    0.32 * Math.cos((3 * hbarp + 6) * DEG) -
    0.2 * Math.cos((4 * hbarp - 63) * DEG);

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 6103515625));
  const Rt = -Rc * Math.sin(2 * dTheta * DEG);

  const Lbarp50sq = (Lbarp - 50) * (Lbarp - 50);
  const Sl = 1 + (0.015 * Lbarp50sq) / Math.sqrt(20 + Lbarp50sq);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;

  const tL = dLp / (kL * Sl);
  const tC = dCp / (kC * Sc);
  const tH = dHp / (kH * Sh);

  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
}

function hueAngle(b: number, ap: number): number {
  if (ap === 0 && b === 0) return 0;
  const deg = Math.atan2(b, ap) / DEG;
  return deg >= 0 ? deg : deg + 360;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp255(Math.round(v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

/** Relative luminance 0..1 (linear-light), for dark/light garment decisions. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
