/**
 * Minimal deterministic PNG encoder/decoder.
 *
 * Written by hand rather than delegating to canvas so that the exact same
 * bytes are produced in the browser worker, in Node tests, and in the PDF
 * embed path. Deterministic output is a hard requirement: the same artwork
 * plus settings must yield byte-identical films.
 */

import { zlibSync, unzlibSync } from "fflate";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Filters each scanline with the minimum-sum-of-absolute-differences
 * heuristic. Deterministic, and cuts film sizes dramatically because film
 * positives are large flat runs.
 */
function filterScanlines(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * (stride + 1));
  const prev = new Uint8Array(stride);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];

  for (let y = 0; y < height; y++) {
    const line = raw.subarray(y * stride, y * stride + stride);
    let best = 0;
    let bestSum = Infinity;

    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const cc = i >= bpp ? prev[i - bpp] : 0;
        let v: number;
        switch (f) {
          case 0: v = line[i]; break;
          case 1: v = line[i] - a; break;
          case 2: v = line[i] - b; break;
          case 3: v = line[i] - ((a + b) >> 1); break;
          default: v = line[i] - paeth(a, b, cc); break;
        }
        v &= 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }

    out[y * (stride + 1)] = best;
    out.set(cand[best], y * (stride + 1) + 1);
    prev.set(line);
  }
  return out;
}

export type PngColorType = "gray" | "rgb" | "rgba";

const CHANNELS: Record<PngColorType, number> = { gray: 1, rgb: 3, rgba: 4 };
const CT_CODE: Record<PngColorType, number> = { gray: 0, rgb: 2, rgba: 6 };

export interface EncodeOptions {
  /** Physical resolution written into a pHYs chunk, so films open at true size. */
  dpi?: number;
}

export function encodePng(
  data: Uint8Array,
  width: number,
  height: number,
  type: PngColorType,
  opts: EncodeOptions = {},
): Uint8Array {
  const bpp = CHANNELS[type];
  if (data.length !== width * height * bpp) {
    throw new Error(`encodePng: expected ${width * height * bpp} bytes, got ${data.length}`);
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;            // bit depth
  ihdr[9] = CT_CODE[type];
  ihdr[10] = 0;           // deflate
  ihdr[11] = 0;           // adaptive filtering
  ihdr[12] = 0;           // no interlace

  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
  ];

  if (opts.dpi && opts.dpi > 0) {
    const phys = new Uint8Array(9);
    const pdv = new DataView(phys.buffer);
    const ppm = Math.round(opts.dpi / 0.0254);
    pdv.setUint32(0, ppm);
    pdv.setUint32(4, ppm);
    phys[8] = 1; // unit = metre
    parts.push(chunk("pHYs", phys));
  }

  const filtered = filterScanlines(data, width, height, bpp);
  // level 6 is deterministic in fflate and a good size/speed tradeoff.
  parts.push(chunk("IDAT", zlibSync(filtered, { level: 6 })));
  parts.push(chunk("IEND", new Uint8Array(0)));

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export interface DecodedPng {
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // always RGBA8
  dpi: number | null;
}

/** Decoder covering the 8-bit non-interlaced color types this app produces. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i]) {
      throw new Error("Not a PNG file");
    }
  }
  let off = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let dpi: number | null = null;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;

  while (off < bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      depth = bytes[off + 16];
      ctype = bytes[off + 17];
      interlace = bytes[off + 20];
    } else if (type === "PLTE") {
      palette = body.slice();
    } else if (type === "tRNS") {
      trns = body.slice();
    } else if (type === "pHYs") {
      const ppuX = dv.getUint32(off + 8);
      if (bytes[off + 16] === 1 && ppuX > 0) dpi = Math.round(ppuX * 0.0254);
    } else if (type === "IDAT") {
      idat.push(body.slice());
    } else if (type === "IEND") break;
    off += 12 + len;
  }

  if (depth !== 8) throw new Error(`Unsupported PNG bit depth ${depth} (only 8-bit supported)`);
  if (interlace !== 0) throw new Error("Interlaced PNG is not supported");

  let cat: Uint8Array;
  if (idat.length === 1) cat = idat[0];
  else {
    let n = 0;
    for (const d of idat) n += d.length;
    cat = new Uint8Array(n);
    let o = 0;
    for (const d of idat) { cat.set(d, o); o += d.length; }
  }
  const raw = unzlibSync(cat);

  const chan = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : 4;
  const stride = width * chan;
  const recon = new Uint8Array(height * stride);
  const prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const line = recon.subarray(y * stride, y * stride + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= chan ? line[i - chan] : 0;
      const b = prev[i];
      const c = i >= chan ? prev[i - chan] : 0;
      let v = src[i];
      switch (ft) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
      }
      line[i] = v & 0xff;
    }
    prev.set(line);
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * chan;
    const d = i * 4;
    if (ctype === 0) { out[d] = out[d + 1] = out[d + 2] = recon[s]; out[d + 3] = 255; }
    else if (ctype === 4) { out[d] = out[d + 1] = out[d + 2] = recon[s]; out[d + 3] = recon[s + 1]; }
    else if (ctype === 2) { out[d] = recon[s]; out[d + 1] = recon[s + 1]; out[d + 2] = recon[s + 2]; out[d + 3] = 255; }
    else if (ctype === 3 && palette) {
      const pi = recon[s] * 3;
      out[d] = palette[pi]; out[d + 1] = palette[pi + 1]; out[d + 2] = palette[pi + 2];
      out[d + 3] = trns && recon[s] < trns.length ? trns[recon[s]] : 255;
    } else { out[d] = recon[s]; out[d + 1] = recon[s + 1]; out[d + 2] = recon[s + 2]; out[d + 3] = recon[s + 3]; }
  }

  return { width, height, pixels: out, dpi };
}
