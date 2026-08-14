/**
 * 把 public/emotions 里无透明通道的 RGB PNG 抠成 RGBA。
 * 这些图是 GenerateImage 产出的 1024×1024 不透明图，白底会作为情绪贴图
 * 出现在头像右上角。从四边洪水填充近白色像素，再给抗锯齿边做软透明。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";

const DIR = path.join(process.cwd(), "public", "emotions");

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(filter, row, prev, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = i >= bpp && prev ? prev[i - bpp] : 0;
    let v = row[i];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) v += paeth(a, b, c);
    else if (filter !== 0) throw new Error(`unknown filter ${filter}`);
    out[i] = v & 255;
  }
  return out;
}

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  const idats = [];
  let w;
  let h;
  let colorType;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString("ascii");
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    }
    if (type === "IDAT") idats.push(data);
    off += 12 + len;
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`${file} colorType ${colorType}, expected RGB or RGBA`);
  }
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  const rows = [];
  let i = 0;
  let prev = null;
  for (let y = 0; y < h; y++) {
    const filter = inflated[i++];
    const raw = inflated.slice(i, i + stride);
    i += stride;
    const recon = unfilter(filter, raw, prev, bpp);
    rows.push(recon);
    prev = recon;
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = rows[y][x * bpp];
      rgba[i + 1] = rows[y][x * bpp + 1];
      rgba[i + 2] = rows[y][x * bpp + 2];
      rgba[i + 3] = bpp === 4 ? rows[y][x * bpp + 3] : 255;
    }
  }
  return { w, h, rgba };
}

function chroma(r, g, b) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function lum(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 有颜色的图标芯，或深色描边——白卡片、浅灰底都不算 */
function isIconCore(r, g, b, a) {
  if (a < 16) return false;
  const c = chroma(r, g, b);
  const y = lum(r, g, b);
  if (c >= 0.18 && y < 248) return true;
  if (y <= 70 && c < 0.35) return true;
  return false;
}

function knockout({ w, h, rgba }) {
  const keep = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isIconCore(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3])) keep[y * w + x] = 1;
    }
  }

  // 向外扩 3 圈，保住描边、高光和星星点
  const dilated = new Uint8Array(keep);
  for (let pass = 0; pass < 3; pass++) {
    const src = Uint8Array.from(dilated);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (src[y * w + x]) continue;
        if (
          src[y * w + x - 1] ||
          src[y * w + x + 1] ||
          src[(y - 1) * w + x] ||
          src[(y + 1) * w + x]
        ) {
          dilated[y * w + x] = 1;
        }
      }
    }
  }

  const core = keep;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!dilated[y * w + x]) {
        rgba[i + 3] = 0;
        continue;
      }
      const yv = lum(rgba[i], rgba[i + 1], rgba[i + 2]);
      const c = chroma(rgba[i], rgba[i + 1], rgba[i + 2]);
      // 扩边碰到的浅灰/白边一律丢掉，否则缩到 36px 会糊成一块白方块
      if (!core[y * w + x] && yv >= 200 && c < 0.16) {
        rgba[i + 3] = 0;
        continue;
      }
      if (yv >= 230 && c < 0.12) {
        rgba[i + 3] = 0;
      }
    }
  }

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] < 16) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const cropped = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    rgba.copy(cropped, y * cw * 4, ((minY + y) * w + minX) * 4, ((minY + y) * w + minX + cw) * 4);
  }
  return { w: cw, h: ch, rgba: cropped };
}

function encodeRgbaPng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function stats(w, h, rgba) {
  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 0) transparent++;
    else if (rgba[i] === 255) opaque++;
  }
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ].map(([x, y]) => rgba[(y * w + x) * 4 + 3]);
  return { transparent, opaque, total: w * h, cornerAlpha: corners };
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".png")).sort();
for (const name of files) {
  const file = path.join(DIR, name);
  const decoded = decodePng(file);
  const cut = knockout(decoded);
  const s = stats(cut.w, cut.h, cut.rgba);
  const out = encodeRgbaPng(cut.w, cut.h, cut.rgba);
  fs.writeFileSync(file, out);
  const hash = createHash("sha1").update(out).digest("hex").slice(0, 8);
  console.log(
    `${name} ${cut.w}x${cut.h} transparent=${s.transparent} opaque=${s.opaque} corners=${s.cornerAlpha.join(",")} sha=${hash}`
  );
}
