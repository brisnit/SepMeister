/**
 * A 5x7 bitmap font, for drawing plate names into test artwork.
 *
 * Deliberately hand-coded rather than rasterized from a real typeface. The
 * Emerald test target has to be byte-identical on every machine that builds
 * it, because the whole point is comparing what SepWiz drew against what a RIP
 * imaged. A system font would make the target depend on the machine.
 *
 * Only the characters plate names actually use are defined; anything else
 * renders as a blank cell rather than throwing, so a name with an unexpected
 * character still produces a readable film.
 */

/** Rows top-to-bottom, `1` = ink. */
const GLYPHS: Record<string, string> = {
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01110/10001/10000/10000/10000/10001/01110",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01110/10001/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "11111/00100/00100/00100/00100/00100/11111",
  J: "00111/00010/00010/00010/00010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/10101/10011/10001/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/11011/10001",
  X: "10001/01010/00100/00100/00100/01010/10001",
  Y: "10001/01010/00100/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
  "0": "01110/10011/10101/10101/10101/11001/01110",
  "1": "00100/01100/00100/00100/00100/00100/01110",
  "2": "01110/10001/00001/00110/01000/10000/11111",
  "3": "11111/00010/00100/00010/00001/10001/01110",
  "4": "00010/00110/01010/10010/11111/00010/00010",
  "5": "11111/10000/11110/00001/00001/10001/01110",
  "6": "00110/01000/10000/11110/10001/10001/01110",
  "7": "11111/00001/00010/00100/01000/01000/01000",
  "8": "01110/10001/10001/01110/10001/10001/01110",
  "9": "01110/10001/10001/01111/00001/00010/01100",
  "%": "11001/11010/00010/00100/01000/01011/10011",
  "-": "00000/00000/00000/11111/00000/00000/00000",
  ".": "00000/00000/00000/00000/00000/01100/01100",
  "/": "00001/00010/00010/00100/01000/01000/10000",
  " ": "00000/00000/00000/00000/00000/00000/00000",
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** One blank column between characters, at glyph scale. */
export const GLYPH_ADVANCE = GLYPH_WIDTH + 1;

/** Width in pixels of `text` drawn at `scale`, excluding the trailing gap. */
export function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return (text.length * GLYPH_ADVANCE - 1) * scale;
}

export function textHeight(scale: number): number {
  return GLYPH_HEIGHT * scale;
}

/**
 * Draws `text` into a single-channel coverage buffer.
 *
 * Nearest-neighbour block scaling, so edges stay hard. Antialiasing here would
 * put partial coverage into a target whose entire purpose is unambiguous
 * values — a separator checking whether a 100% region imaged solid should not
 * have to wonder whether a grey edge pixel is a RIP artifact or ours.
 */
export function drawText(
  target: Uint8ClampedArray,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  value = 255,
): void {
  let penX = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    const rows = glyph.split("/");
    for (let gy = 0; gy < rows.length; gy++) {
      const row = rows[gy];
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== "1") continue;
        // One glyph pixel becomes a scale x scale block.
        for (let dy = 0; dy < scale; dy++) {
          const py = y + gy * scale + dy;
          if (py < 0 || py >= height) continue;
          const rowOffset = py * width;
          for (let dx = 0; dx < scale; dx++) {
            const px = penX + gx * scale + dx;
            if (px < 0 || px >= width) continue;
            target[rowOffset + px] = value;
          }
        }
      }
    }
    penX += GLYPH_ADVANCE * scale;
  }
}
