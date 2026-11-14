/**
 * split — sprite sheet -> transparent PNG elements + manifest + ZIP.
 *
 * Port of cli/src/split.rs; image decode/encode goes through png.mjs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  err,
  exists,
  isFile,
  isKebabId,
  loadYamlMap,
  mapGet,
  mapSet,
  mkdirp,
  readBytes,
  rmDir,
  strOf,
  writeRaw,
  writeYaml,
} from "./util.mjs";
import { decodePng, encodePng } from "./png.mjs";
import { Next, Outcome } from "./report.mjs";

const DEFAULTS = {
  mode: "auto",
  alphaThreshold: 8,
  backgroundTolerance: 24,
  connectGap: 2,
  minArea: 64,
  padding: 4,
  prefix: "element",
};

/** Integer parsers mirroring Rust `str::parse` for the integer types used by split.rs. */
function parseU8(text) {
  if (!/^\+?\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n <= 255 ? n : undefined;
}

function parseI32(text) {
  if (!/^[+-]?\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n >= -2147483648 && n <= 2147483647 ? n : undefined;
}

function parseUsize(text) {
  if (!/^\+?\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n <= Number.MAX_SAFE_INTEGER ? n : undefined;
}

const OS_ERRORS = {
  EPERM: "Operation not permitted",
  ENOENT: "No such file or directory",
  EIO: "Input/output error",
  EBUSY: "Resource busy",
  EEXIST: "File exists",
  ENOTDIR: "Not a directory",
  EISDIR: "Is a directory",
  EINVAL: "Invalid argument",
  EMFILE: "Too many open files",
  ENOSPC: "No space left on device",
  EROFS: "Read-only file system",
  ENAMETOOLONG: "File name too long",
  ENOTEMPTY: "Directory not empty",
  ELOOP: "Too many levels of symbolic links",
};

/** Render an fs error the way Rust's `io::Error` Display does. */
function ioErrorText(e) {
  const errno = typeof e.errno === "number" ? Math.abs(e.errno) : os.constants.errno[e.code];
  const text = OS_ERRORS[e.code];
  if (typeof errno === "number" && text !== undefined) return `${text} (os error ${errno})`;
  return e.message;
}

function stemOf(p) {
  const base = path.basename(p);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, base.length - ext.length) : base;
  return stem || "sprite";
}

/** Median of border samples (matches split.rs sample_background). */
function sampleBackground(img) {
  const { width: w, height: h, data } = img;
  const stepX = Math.max(Math.floor(w / 128), 1);
  const stepY = Math.max(Math.floor(h / 128), 1);
  const samples = [];
  const push = (x, y) => {
    const o = (y * w + x) * 4;
    samples.push([data[o], data[o + 1], data[o + 2]]);
  };
  for (let x = 0; x < w; x += stepX) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += stepY) {
    push(0, y);
    push(w - 1, y);
  }
  const median = (idx) => {
    const vals = samples.map((s) => s[idx]);
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  return [median(0), median(1), median(2)];
}

/** Foreground mask (one byte per pixel) plus detected mode / sampled background. */
function makeForegroundMask(img, settings) {
  const { width: w, height: h, data } = img;
  let alphaMin = 255;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < alphaMin) alphaMin = data[i];
  }
  let mode = settings.mode;
  if (mode === "auto") mode = alphaMin < 255 ? "alpha" : "background";

  const mask = new Uint8Array(w * h);
  if (mode === "alpha") {
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      mask[p] = data[i + 3] > settings.alphaThreshold ? 255 : 0;
    }
    return { mask, mode, background: null };
  }
  if (mode !== "background") return { mask, mode, background: null };

  const background = sampleBackground(img);
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const o = (y * w + x) * 4;
      const diff = Math.max(
        Math.abs(data[o] - background[0]),
        Math.abs(data[o + 1] - background[1]),
        Math.abs(data[o + 2] - background[2]),
      );
      const bgHit = diff > settings.backgroundTolerance ? 255 : 0;
      const vis = data[o + 3] > settings.alphaThreshold ? 255 : 0;
      mask[p] = Math.min(bgHit, vis);
    }
  }
  return { mask, mode, background };
}

/** Max-filter (dilation) with square kernel radius `radius`. */
function maxFilter(mask, w, h, radius) {
  if (radius <= 0) return mask.slice();
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = mask[yy * w + xx];
          if (v > best) best = v;
        }
      }
      out[y * w + x] = best;
    }
  }
  return out;
}

/** Run-length connected components -> boxes sorted by (top, left). */
function connectedBoxes(mask, w, h, minArea) {
  const parents = [];
  const runs = [];
  let previous = [];

  const find = (label) => {
    while (parents[label] !== label) {
      parents[label] = parents[parents[label]];
      label = parents[label];
    }
    return label;
  };
  const union = (left, right) => {
    const rl = find(left);
    const rr = find(right);
    if (rl !== rr) parents[rr] = rl;
  };

  for (let y = 0; y < h; y++) {
    const current = [];
    let x = 0;
    while (x < w) {
      while (x < w && mask[y * w + x] === 0) x++;
      if (x >= w) break;
      const start = x;
      while (x < w && mask[y * w + x] !== 0) x++;
      const end = x;
      const overlaps = [];
      for (const [ps, pe, label] of previous) {
        if (ps < end && start < pe) overlaps.push(label);
      }
      let label;
      if (overlaps.length > 0) {
        label = overlaps[0];
      } else {
        label = parents.length;
        parents.push(label);
      }
      for (let i = 1; i < overlaps.length; i++) union(label, overlaps[i]);
      current.push([start, end, label]);
      runs.push([y, start, end, label]);
    }
    previous = current;
  }

  const stats = new Map();
  for (const [y, start, end, label] of runs) {
    const root = find(label);
    let entry = stats.get(root);
    if (entry === undefined) {
      entry = [start, y, end, y + 1, 0];
      stats.set(root, entry);
    }
    if (start < entry[0]) entry[0] = start;
    if (y < entry[1]) entry[1] = y;
    if (end > entry[2]) entry[2] = end;
    if (y + 1 > entry[3]) entry[3] = y + 1;
    entry[4] += end - start;
  }

  const boxes = [];
  for (const entry of stats.values()) {
    if (entry[4] >= minArea) boxes.push([entry[0], entry[1], entry[2], entry[3]]);
  }
  boxes.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return boxes;
}

function tightenAndPad(box, mask, w, h, padding) {
  const [l, t, r, b] = box;
  let minX = r;
  let minY = b;
  let maxX = l;
  let maxY = t;
  let found = false;
  for (let y = t; y < b; y++) {
    for (let x = l; x < r; x++) {
      if (mask[y * w + x] !== 0) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + 1 > maxX) maxX = x + 1;
        if (y + 1 > maxY) maxY = y + 1;
      }
    }
  }
  if (!found) return null;
  return [
    Math.max(minX - padding, 0),
    Math.max(minY - padding, 0),
    Math.min(maxX + padding, w),
    Math.min(maxY + padding, h),
  ];
}

function prepareOutput(dir, force) {
  if (exists(dir)) {
    let nonEmpty = false;
    try {
      nonEmpty = fs.readdirSync(dir).length > 0;
    } catch {
      nonEmpty = false;
    }
    if (nonEmpty) {
      if (!force) err(`output directory is not empty: ${dir}; use --force`);
      rmDir(dir);
    }
  }
  try {
    mkdirp(dir);
  } catch (e) {
    err(`${dir}: ${ioErrorText(e)}`);
  }
}

function cropRgba(img, box) {
  const [x0, y0, x1, y1] = box;
  const w = Math.max(x1 - x0, 0);
  const h = Math.max(y1 - y0, 0);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy >= img.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx >= img.width) continue;
      const so = (sy * img.width + sx) * 4;
      const doff = (y * w + x) * 4;
      out[doff] = img.data[so];
      out[doff + 1] = img.data[so + 1];
      out[doff + 2] = img.data[so + 2];
      out[doff + 3] = img.data[so + 3];
    }
  }
  return { width: w, height: h, data: out };
}

function cropMask(mask, imgW, box) {
  const [x0, y0, x1, y1] = box;
  const w = Math.max(x1 - x0, 0);
  const h = Math.max(y1 - y0, 0);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = mask[(y0 + y) * imgW + x0 + x];
  }
  return out;
}

/* ------------------------------------------------------------------ zip ---- */

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

/** Write a deflated ZIP archive (fixed 1980-01-01 timestamps, like the Rust writer). */
function writeZip(zipPath, entries) {
  const DOS_TIME = 0;
  const DOS_DATE = 0x21;
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const name = Buffer.from(entry.name, "utf8");
    const flags = /[^\x00-\x7f]/.test(entry.name) ? 0x0800 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0o644 << 16, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  writeRaw(zipPath, Buffer.concat([...locals, centralBuf, end]));
}

/* ----------------------------------------------------------------- run ----- */

export function run(args) {
  const sourceArg = args.pos(0);
  if (sourceArg === undefined) {
    err(
      "usage: kui split <source.png> [--output-dir D] [--zip Z] [--mode auto|alpha|background] ...",
    );
  }
  let source;
  try {
    source = fs.realpathSync(path.resolve(sourceArg));
  } catch (e) {
    err(`${sourceArg}: ${ioErrorText(e)}`);
  }
  const stem = stemOf(source);
  const parent = path.dirname(source);
  const outputDir = args.opt("output-dir") ?? path.join(parent, `${stem}-items`);
  const zipPath = args.opt("zip") ?? path.join(parent, `${stem}-png.zip`);

  const settings = { ...DEFAULTS };
  const modeOpt = args.opt("mode");
  if (modeOpt !== undefined) settings.mode = modeOpt;
  const alphaOpt = args.opt("alpha-threshold");
  if (alphaOpt !== undefined) settings.alphaThreshold = parseU8(alphaOpt) ?? 8;
  const tolOpt = args.opt("background-tolerance");
  if (tolOpt !== undefined) settings.backgroundTolerance = parseU8(tolOpt) ?? 24;
  const gapOpt = args.opt("connect-gap");
  if (gapOpt !== undefined) settings.connectGap = Math.max(parseI32(gapOpt) ?? 2, 0);
  const minAreaOpt = args.opt("min-area");
  if (minAreaOpt !== undefined) settings.minArea = Math.max(parseUsize(minAreaOpt) ?? 64, 1);
  const paddingOpt = args.opt("padding");
  if (paddingOpt !== undefined) settings.padding = Math.max(parseI32(paddingOpt) ?? 4, 0);
  const prefixOpt = args.opt("prefix");
  if (prefixOpt !== undefined) settings.prefix = prefixOpt;
  const force = args.flag("force");

  let semanticItems = null;
  const mappingPath = args.opt("mapping");
  if (mappingPath !== undefined) {
    const m = loadYamlMap(mappingPath);
    const rawItems = mapGet(m, "items");
    if (!Array.isArray(rawItems)) err("mapping YAML requires an 'items' list");
    const list = [];
    for (const item of rawItems) {
      if (!(item instanceof Map)) err("every mapping item must be a mapping");
      list.push(item);
    }
    semanticItems = list;
  }

  if (!isFile(source)) err(`sprite sheet not found: ${source}`);
  prepareOutput(outputDir, force);
  if (exists(zipPath)) {
    if (!force) err(`package already exists: ${zipPath}; use --force`);
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* the old binary ignores removal errors here */
    }
  }
  const zipParent = path.dirname(zipPath);
  try {
    mkdirp(zipParent);
  } catch (e) {
    err(`${zipParent}: ${ioErrorText(e)}`);
  }

  let rgba;
  try {
    rgba = decodePng(fs.readFileSync(source));
  } catch (e) {
    err(`${source}: ${e.cli ? e.message : ioErrorText(e)}`);
  }

  const { mask: originalMask, mode: detectedMode, background } = makeForegroundMask(
    rgba,
    settings,
  );
  if (!["auto", "alpha", "background"].includes(settings.mode)) {
    err(`unsupported split mode: ${settings.mode}`);
  }
  const detectionMask =
    settings.connectGap > 0
      ? maxFilter(originalMask, rgba.width, rgba.height, settings.connectGap)
      : originalMask.slice();
  const boxes = connectedBoxes(detectionMask, rgba.width, rgba.height, settings.minArea);
  if (semanticItems !== null && semanticItems.length !== boxes.length) {
    err(`mapping contains ${semanticItems.length} item(s), but detection found ${boxes.length}`);
  }

  const items = [];
  for (const box of boxes) {
    const cropBox = tightenAndPad(box, originalMask, rgba.width, rgba.height, settings.padding);
    if (cropBox === null) continue;
    const crop = cropRgba(rgba, cropBox);
    if (detectedMode === "background") {
      const alphaCrop = cropMask(originalMask, rgba.width, cropBox);
      for (let i = 0; i < alphaCrop.length; i++) crop.data[i * 4 + 3] = alphaCrop[i];
    }
    const index = items.length + 1;
    const semantic = semanticItems !== null ? semanticItems[index - 1] : new Map();
    const semanticName = strOf(mapGet(semantic, "semantic_name"));
    if (semanticName !== undefined && !isKebabId(semanticName)) {
      err(`mapping item ${index}: semantic_name must use kebab-case`);
    }
    const itemId = semanticName ?? `${settings.prefix}-${String(index).padStart(3, "0")}`;
    if (items.some((m) => strOf(mapGet(m, "id")) === itemId)) {
      err(`mapping item ${index}: duplicate ID ${JSON.stringify(itemId)}`);
    }
    const filename = `${itemId}.png`;
    const outPath = path.join(outputDir, filename);
    writeRaw(outPath, encodePng(crop));

    const item = new Map();
    mapSet(item, "id", itemId);
    mapSet(item, "path", filename);
    mapSet(item, "bbox", [
      cropBox[0],
      cropBox[1],
      cropBox[2] - cropBox[0],
      cropBox[3] - cropBox[1],
    ]);
    mapSet(item, "dimensions", [crop.width, crop.height]);
    mapSet(item, "transparent_background", true);
    for (const key of ["semantic_name", "component_id", "category", "state", "slice"]) {
      const v = mapGet(semantic, key);
      if (v !== undefined) mapSet(item, key, v);
    }
    items.push(item);
  }

  if (items.length === 0) err("no sprite elements detected; adjust mode or thresholds");

  const manifest = new Map();
  mapSet(manifest, "schema_version", 1);
  mapSet(manifest, "source_sheet", path.basename(source));
  mapSet(manifest, "detected_mode", detectedMode);
  mapSet(manifest, "sampled_background", background === null ? null : [...background]);
  const settingsMap = new Map();
  mapSet(settingsMap, "alpha_threshold", settings.alphaThreshold);
  mapSet(settingsMap, "background_tolerance", settings.backgroundTolerance);
  mapSet(settingsMap, "connect_gap", settings.connectGap);
  mapSet(settingsMap, "min_area", settings.minArea);
  mapSet(settingsMap, "padding", settings.padding);
  mapSet(manifest, "settings", settingsMap);
  mapSet(manifest, "item_count", items.length);
  mapSet(manifest, "items", items);

  const manifestPath = path.join(outputDir, "sprite-manifest.yaml");
  writeYaml(manifestPath, manifest);

  const entries = [{ name: "sprite-manifest.yaml", data: readBytes(manifestPath) }];
  for (const item of items) {
    const fname = strOf(mapGet(item, "path")) ?? "";
    entries.push({
      name: `items/${fname}`,
      data: readBytes(path.join(outputDir, fname)),
    });
  }
  writeZip(zipPath, entries);

  return Outcome.ok("split", `split ${items.length} element(s)`)
    .fact("item_count", items.length)
    .fact("detected_mode", detectedMode)
    .artifact(outputDir)
    .artifact(zipPath)
    .withNext(
      Next.waitUser(
        "review PNG edges for text/crop/glow, then run kui atlas <project> after mapping semantic names",
      ),
    );
}
