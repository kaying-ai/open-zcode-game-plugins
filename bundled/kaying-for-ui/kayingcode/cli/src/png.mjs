/**
 * png.mjs — dependency-free PNG decode/encode used by `kui split` and `kui atlas`.
 *
 * Decode: color types 0/2/3/4/6, bit depths 1/2/4/8/16, all five row filters,
 * Adam7 interlacing, tRNS transparency. Everything lands in RGBA8.
 * Encode: RGBA8, non-interlaced, filter 0 — enough for atlas output.
 */

import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export class PngError extends Error {}

export function isPng(buf) {
  return buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE);
}

/** @returns {{width:number,height:number,data:Uint8Array}} RGBA8 */
export function decodePng(buf, label = "PNG") {
  if (!isPng(buf)) throw new PngError(`${label}: not a PNG file`);
  let off = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      trns = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!ihdr) throw new PngError(`${label}: missing IHDR`);
  if (!idat.length) throw new PngError(`${label}: missing IDAT`);
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  const channels = CHANNELS[colorType];
  if (!channels) throw new PngError(`${label}: unsupported color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);

  const bitPP = channels * bitDepth;
  const bpp = Math.max(1, Math.ceil(bitPP / 8));

  const readPixel = (bufForRow, x) => {
    // returns [r,g,b,a]
    if (bitDepth === 8) {
      const i = x * channels;
      switch (colorType) {
        case 0: {
          const g = bufForRow[i];
          return [g, g, g, 255];
        }
        case 2:
          return [bufForRow[i], bufForRow[i + 1], bufForRow[i + 2], 255];
        case 3: {
          const idx = bufForRow[i];
          const p = paletteIdx(idx);
          return p;
        }
        case 4: {
          const g = bufForRow[i];
          return [g, g, g, bufForRow[i + 1]];
        }
        default:
          return [bufForRow[i], bufForRow[i + 1], bufForRow[i + 2], bufForRow[i + 3]];
      }
    }
    if (bitDepth === 16) {
      const i = x * channels * 2;
      const hi = (k) => bufForRow[k * 2];
      switch (colorType) {
        case 0: {
          const g = hi(i / 2);
          return [g, g, g, 255];
        }
        case 2:
          return [hi(i / 2), hi(i / 2 + 1), hi(i / 2 + 2), 255];
        case 4: {
          const g = hi(i / 2);
          return [g, g, g, hi(i / 2 + 1)];
        }
        default:
          return [hi(i / 2), hi(i / 2 + 1), hi(i / 2 + 2), hi(i / 2 + 3)];
      }
    }
    // 1/2/4-bit: grayscale or palette, one channel
    const perByte = 8 / bitDepth;
    const byte = bufForRow[Math.floor(x / perByte)];
    const shift = 8 - bitDepth * ((x % perByte) + 1);
    const v = (byte >> shift) & ((1 << bitDepth) - 1);
    if (colorType === 3) return paletteIdx(v);
    const scale = Math.round((v * 255) / ((1 << bitDepth) - 1));
    return [scale, scale, scale, 255];
  };

  const paletteIdx = (idx) => {
    if (!palette) throw new PngError(`${label}: palette image without PLTE`);
    const r = palette[idx * 3] ?? 0;
    const g = palette[idx * 3 + 1] ?? 0;
    const b = palette[idx * 3 + 2] ?? 0;
    const a = trns && idx < trns.length ? trns[idx] : 255;
    return [r, g, b, a];
  };

  const passes = interlace === 1
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];

  let pos = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitPP) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[pos++];
      const row = new Uint8Array(stride);
      for (let i = 0; i < stride; i++) row[i] = raw[pos + i];
      pos += stride;
      unfilter(filter, row, prev, bpp);
      for (let x = 0; x < pw; x++) {
        const [r, g, b, a] = readPixel(row, x);
        const px = x0 + x * dx;
        const py = y0 + y * dy;
        const o = (py * width + px) * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
      prev = row;
    }
  }
  return { width, height, data: out };
}

function unfilter(filter, row, prev, bpp) {
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < row.length; i++) row[i] = (row[i] + row[i - bpp]) & 0xff;
      return;
    case 2:
      for (let i = 0; i < row.length; i++) row[i] = (row[i] + prev[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < row.length; i++) {
        const left = i >= bpp ? row[i - bpp] : 0;
        row[i] = (row[i] + ((left + prev[i]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < row.length; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[i] = (row[i] + pred) & 0xff;
      }
      return;
    default:
      throw new PngError(`unsupported PNG filter ${filter}`);
  }
}

/** Encode RGBA8 pixels to PNG bytes. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
