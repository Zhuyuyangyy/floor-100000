// Minimal PNG codec (8-bit RGB/RGBA, non-interlaced) built on Node's zlib.
//
// The art pack ships as flat presentation sheets, so slicing needs real pixel
// access. There is no image library in this project and no Python on the box,
// and round-tripping through a browser canvas is slow and awkward to script —
// so this is the whole codec. ~120 lines, no dependencies.

import { inflateSync, deflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** @returns {{width:number,height:number,channels:number,pixels:Buffer}} */
export function decodePng(file) {
  const buf = file;
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let palette = null;
  let trns = null;

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error(`color type ${colorType} not supported`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= bpp ? prior[i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = line[i]; break;
        case 1: v = line[i] + a; break;
        case 2: v = line[i] + b; break;
        case 3: v = line[i] + ((a + b) >> 1); break;
        case 4: v = line[i] + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
  }

  // Palette -> RGB, tRNS -> alpha, so every caller sees 3 or 4 channels.
  if (colorType === 3 && palette) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let p = 0, q = 0; p < out.length; p++, q += 3) {
      const idx = out[p] * 3;
      rgb[q] = palette[idx];
      rgb[q + 1] = palette[idx + 1];
      rgb[q + 2] = palette[idx + 2];
    }
    return { width, height, channels: 3, pixels: rgb };
  }
  if (colorType === 0 && trns && trns.length >= 2) {
    const key = trns.readUInt16BE(0);
    const rgba = Buffer.alloc(width * height * 4);
    for (let p = 0, q = 0; p < out.length; p++, q += 4) {
      rgba[q] = rgba[q + 1] = rgba[q + 2] = out[p];
      rgba[q + 3] = out[p] === key ? 0 : 255;
    }
    return { width, height, channels: 4, pixels: rgba };
  }
  return { width, height, channels, pixels: out };
}

/** @param {{width:number,height:number,channels:number,pixels:Buffer}} img */
export function encodePng(img) {
  const { width, height, channels, pixels } = img;
  const colorType = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Crops a rectangle out of an image, returning a new image. */
export function crop(img, x, y, w, h) {
  const { width, channels, pixels } = img;
  const out = Buffer.alloc(w * h * channels);
  const srcStride = width * channels;
  for (let row = 0; row < h; row++) {
    pixels.copy(out, row * w * channels, (y + row) * srcStride + x * channels, (y + row) * srcStride + (x + w) * channels);
  }
  return { width: w, height: h, channels, pixels: out };
}
