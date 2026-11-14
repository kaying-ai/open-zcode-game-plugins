/**
 * atlas — pack semantic sprite PNGs into an atlas image + JSON.
 *
 * Port of cli/src/atlas.rs; image decode/encode goes through png.mjs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  boolOf,
  err,
  exists,
  intOf,
  isFile,
  loadYamlMap,
  mapGet,
  mapSet,
  mkdirp,
  strOf,
  writeText,
  writeYaml,
  yamlToJson,
} from "./util.mjs";
import { decodePng, encodePng } from "./png.mjs";
import { Next, Outcome } from "./report.mjs";

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

function nextPowerOfTwo(value) {
  if (value <= 1) return 1;
  let n = 1;
  while (n < value) n *= 2;
  return n;
}

/** Rust `PathBuf::join`: absolute replaces the base, relative is appended verbatim. */
function joinPath(base, rel) {
  if (path.isAbsolute(rel)) return rel;
  return `${base}${path.sep}${rel}`;
}

/** Rust `Path::strip_prefix`, textually (no `..` normalization). */
function relativeToProject(target, project) {
  if (target === project) return "";
  const prefix = project.endsWith(path.sep) ? project : `${project}${path.sep}`;
  if (target.startsWith(prefix)) {
    return target.slice(prefix.length).split(path.sep).join("/");
  }
  return target;
}

const f = Math.fround;

/**
 * `image::imageops::overlay` compositing for one pixel. The Rust writer blends
 * in f32 and truncates on cast back to u8, so every step is rounded explicitly.
 */
function overlayPixel(dst, doff, src, soff) {
  const bgR = f(dst[doff] / 255);
  const bgG = f(dst[doff + 1] / 255);
  const bgB = f(dst[doff + 2] / 255);
  const bgA = f(dst[doff + 3] / 255);
  const fgR = f(src[soff] / 255);
  const fgG = f(src[soff + 1] / 255);
  const fgB = f(src[soff + 2] / 255);
  const fgA = f(src[soff + 3] / 255);
  const alphaFinal = f(f(bgA + fgA) - f(bgA * fgA));
  if (alphaFinal === 0) return;
  const rest = f(1 - fgA);
  const channel = (fg, bg) => f(f(f(fg * fgA) + f(f(bg * bgA) * rest)) / alphaFinal);
  dst[doff] = Math.trunc(f(255 * channel(fgR, bgR)));
  dst[doff + 1] = Math.trunc(f(255 * channel(fgG, bgG)));
  dst[doff + 2] = Math.trunc(f(255 * channel(fgB, bgB)));
  dst[doff + 3] = Math.trunc(f(255 * alphaFinal));
}

function overlay(dst, dw, dh, src, x, y) {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dh) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dw) continue;
      overlayPixel(dst, (dy * dw + dx) * 4, src.data, (sy * src.width + sx) * 4);
    }
  }
}

/** serde_json maps are BTreeMaps: object keys are emitted in sorted order. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

export function run(args) {
  const projectArg = args.pos(0);
  if (projectArg === undefined) {
    err(
      "usage: kui atlas <project> [--sprite-contract F] [--atlas-contract F] [--force]",
    );
  }
  let project;
  try {
    project = fs.realpathSync(path.resolve(projectArg));
  } catch (e) {
    err(`${projectArg}: ${ioErrorText(e)}`);
  }

  const spriteContractPath =
    args.opt("sprite-contract") ?? path.join(project, "contracts", "sprite-contract.yaml");
  const atlasContractPath =
    args.opt("atlas-contract") ?? path.join(project, "contracts", "atlas-contract.yaml");
  const force = args.flag("force");

  const sprite = loadYamlMap(spriteContractPath);
  const atlasContract = loadYamlMap(atlasContractPath);

  const settings = mapGet(atlasContract, "settings");
  if (!(settings instanceof Map)) {
    err("atlas contract requires settings and output mappings");
  }
  const output = mapGet(atlasContract, "output");
  if (!(output instanceof Map)) {
    err("atlas contract requires settings and output mappings");
  }

  const maxSize = mapGet(settings, "max_size");
  if (!Array.isArray(maxSize)) {
    err("atlas settings.max_size must contain two positive integers");
  }
  if (maxSize.length !== 2 || !maxSize.every((v) => intOf(v) !== undefined && intOf(v) > 0)) {
    err("atlas settings.max_size must contain two positive integers");
  }
  const maxW = intOf(maxSize[0]) ?? 0;
  const maxH = intOf(maxSize[1]) ?? 0;
  const padding = intOf(mapGet(settings, "padding"));
  if (padding === undefined) err("atlas settings.padding must be non-negative");
  if (padding < 0) err("atlas settings.padding must be non-negative");
  if (boolOf(mapGet(settings, "allow_rotation")) !== false) {
    err("built-in atlas packing does not rotate sprites");
  }
  const powerOfTwo = boolOf(mapGet(settings, "power_of_two")) === true;

  const imageRel = strOf(mapGet(output, "image_path")) ?? "";
  const dataRel = strOf(mapGet(output, "data_path")) ?? "";
  const imagePath = joinPath(project, imageRel);
  const dataPath = joinPath(project, dataRel);
  for (const p of [imagePath, dataPath]) {
    if (exists(p) && !force) err(`output already exists: ${p}; use --force`);
    try {
      mkdirp(path.dirname(p));
    } catch (e) {
      err(`${path.dirname(p)}: ${ioErrorText(e)}`);
    }
  }

  const itemList = mapGet(sprite, "items");
  if (!Array.isArray(itemList)) err("sprite contract requires items list");

  const loaded = [];
  const names = new Set();
  for (let index = 0; index < itemList.length; index++) {
    const rawItem = itemList[index];
    if (!(rawItem instanceof Map)) err(`sprite item ${index} must be a mapping`);
    const item = rawItem;
    const name = strOf(mapGet(item, "semantic_name")) ?? strOf(mapGet(item, "id"));
    if (name === undefined) err(`sprite item ${index} requires semantic_name or id`);
    if (name === "") err(`sprite item ${index} requires semantic_name or id`);
    if (names.has(name)) err(`duplicate semantic sprite name: ${name}`);
    names.add(name);
    const pathValue = strOf(mapGet(item, "path")) ?? "";
    const spritePath = joinPath(project, pathValue);
    if (!isFile(spritePath)) err(`sprite PNG not found: ${JSON.stringify(pathValue)}`);
    let image;
    try {
      image = decodePng(fs.readFileSync(spritePath));
    } catch (e) {
      err(`${spritePath}: ${e.cli ? e.message : ioErrorText(e)}`);
    }
    loaded.push({ item, image });
  }

  loaded.sort((a, b) => {
    const ah = a.image.height;
    const bh = b.image.height;
    const aw = a.image.width;
    const bw = b.image.width;
    const ai = strOf(mapGet(a.item, "id")) ?? "";
    const bi = strOf(mapGet(b.item, "id")) ?? "";
    if (ah !== bh) return bh - ah;
    if (aw !== bw) return bw - aw;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  let cursorX = padding;
  let cursorY = padding;
  let rowHeight = 0;
  const packed = [];
  const placements = [];
  let usedWidth = 0;
  let usedHeight = 0;

  for (const entry of loaded) {
    const iw = entry.image.width;
    const ih = entry.image.height;
    if (iw + padding * 2 > maxW) {
      err(`sprite is wider than atlas: ${optionDebug(strOf(mapGet(entry.item, "id")))}`);
    }
    if (cursorX + iw + padding > maxW) {
      cursorX = padding;
      cursorY += rowHeight + padding;
      rowHeight = 0;
    }
    if (cursorY + ih + padding > maxH) {
      err("sprites do not fit within configured atlas max_size");
    }
    placements.push([entry.image, cursorX, cursorY]);

    const e = new Map();
    mapSet(e, "id", mapGet(entry.item, "id") ?? null);
    const sem = strOf(mapGet(entry.item, "semantic_name")) ?? strOf(mapGet(entry.item, "id")) ?? "";
    mapSet(e, "semantic_name", sem);
    mapSet(e, "component_id", mapGet(entry.item, "component_id") ?? null);
    const state = mapGet(entry.item, "state");
    mapSet(e, "state", state === undefined ? "default" : state);
    mapSet(e, "source_path", mapGet(entry.item, "path") ?? null);
    mapSet(e, "region", [cursorX, cursorY, iw, ih]);
    mapSet(e, "pivot", [0.5, 0.5]);
    mapSet(e, "rotated", false);
    const slice = mapGet(entry.item, "slice");
    if (slice !== undefined) mapSet(e, "slice", slice);
    packed.push(e);

    cursorX += iw + padding;
    if (ih > rowHeight) rowHeight = ih;
    if (cursorX > usedWidth) usedWidth = cursorX;
    if (cursorY + ih + padding > usedHeight) usedHeight = cursorY + ih + padding;
  }

  const width = powerOfTwo ? nextPowerOfTwo(usedWidth) : usedWidth;
  const height = powerOfTwo ? nextPowerOfTwo(usedHeight) : usedHeight;
  if (width > maxW || height > maxH) {
    err("power-of-two atlas exceeds configured max_size");
  }
  const atlasW = Math.max(width, 1);
  const atlasH = Math.max(height, 1);
  const atlasData = new Uint8Array(atlasW * atlasH * 4);
  for (const [img, x, y] of placements) overlay(atlasData, atlasW, atlasH, img, x, y);
  try {
    fs.writeFileSync(imagePath, encodePng({ width: atlasW, height: atlasH, data: atlasData }));
  } catch (e) {
    err(`${imagePath}: ${ioErrorText(e)}`);
  }

  const sprites = {};
  for (const e of packed) {
    const name = strOf(mapGet(e, "semantic_name")) ?? "";
    sprites[name] = yamlToJson(e);
  }
  const data = sortKeysDeep({
    schema_version: 1,
    atlas_id:
      mapGet(atlasContract, "atlas_id") === undefined
        ? null
        : yamlToJson(mapGet(atlasContract, "atlas_id")),
    image: relativeToProject(imagePath, project),
    size: [atlasW, atlasH],
    sprites,
  });
  const text = `${JSON.stringify(data, null, 2)}\n`;
  writeText(dataPath, text);

  mapSet(atlasContract, "status", "packed");
  mapSet(atlasContract, "source_sprite_pack", mapGet(sprite, "pack_id") ?? null);
  mapSet(atlasContract, "items", packed);
  writeYaml(atlasContractPath, atlasContract);

  const imgRel = relativeToProject(imagePath, project);
  const dataRelOut = relativeToProject(dataPath, project);
  return Outcome.ok("atlas", `packed ${packed.length} sprite(s) into ${imgRel}`)
    .withProject(project)
    .fact("sprite_count", packed.length)
    .fact("atlas_size", `${atlasW}x${atlasH}`)
    .artifact(imgRel)
    .artifact(dataRelOut)
    .withNext(Next.run(`kui export ${project}`));
}

/** Rust `{:?}` for `Option<&str>`. */
function optionDebug(value) {
  return value === undefined ? "None" : `Some(${JSON.stringify(value)})`;
}
