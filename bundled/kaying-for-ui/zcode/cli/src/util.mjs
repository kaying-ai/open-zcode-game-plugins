/**
 * util.mjs — shared helpers: errors, args, root discovery, file + YAML I/O.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dumpYaml as dumpYamlValue, parseYaml } from "./yaml.mjs";

export const ROOT_OF_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Throwable CLI failure — `main` turns it into a STATUS: error outcome. */
export function err(message) {
  const e = new Error(message);
  e.cli = true;
  throw e;
}

/** Flag / positional parser (same rules as the previous kui binary). */
export class Args {
  constructor(positional = [], flags = new Map()) {
    this.positional = positional;
    this.flags = flags;
  }

  static parse(argv) {
    const positional = [];
    const flags = new Map();
    const BOOLS = new Set(["force", "strict", "debug", "online", "list", "json", "help"]);
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith("--")) {
        const name = a.slice(2);
        if (name.includes("=")) {
          const eq = name.indexOf("=");
          flags.set(name.slice(0, eq), name.slice(eq + 1));
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
          if (BOOLS.has(name)) flags.set(name, null);
          else {
            flags.set(name, argv[i + 1]);
            i++;
          }
        } else {
          flags.set(name, null);
        }
      } else {
        positional.push(a);
      }
    }
    return new Args(positional, flags);
  }

  flag(name) {
    return this.flags.has(name);
  }

  opt(name) {
    const v = this.flags.get(name);
    return v === undefined || v === null ? undefined : v;
  }

  pos(i) {
    return this.positional[i];
  }
}

function hasTemplates(dir) {
  return isDir(path.join(dir, "templates", "spec-kit")) && isDir(path.join(dir, "templates", "contracts"));
}

function walkUpForTemplates(start) {
  let cur = path.resolve(start);
  for (;;) {
    if (hasTemplates(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** Plugin root = directory containing templates/spec-kit + templates/contracts. */
export function findRoot(explicit) {
  // A self-contained skill bundle carries its resources inline (assets.mjs) and
  // materializes them to a cache directory on first run; it passes that root down
  // through KUI_ROOT because the skill dir itself has no templates/ tree.
  const fromEnv = explicit ? null : process.env.KUI_ROOT;
  if (fromEnv && isDir(path.join(fromEnv, "templates", "spec-kit"))) return path.resolve(fromEnv);
  if (explicit) {
    const p = path.resolve(explicit);
    if (isDir(path.join(p, "templates", "spec-kit"))) return p;
    err(`templates not found under root: ${p}`);
  }
  // The running plugin owns its templates: prefer the module location so an
  // installed copy never picks up an unrelated templates/ tree from the
  // user's working directory. cwd is only a fallback (e.g. copied cli/ only).
  const fromCli = walkUpForTemplates(ROOT_OF_CLI);
  if (fromCli) return fromCli;
  const fromCwd = walkUpForTemplates(process.cwd());
  if (fromCwd) return fromCwd;
  err("cannot locate plugin root (templates/spec-kit); pass --root");
}

/* ------------------------------------------------------------------- fs ---- */

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    err(`${p}: ${e.message}`);
  }
}

export function readBytes(p) {
  try {
    return fs.readFileSync(p);
  } catch (e) {
    err(`${p}: ${e.message}`);
  }
}

/** Write text with LF endings and exactly one trailing newline (matches the old binary). */
export function writeText(p, text) {
  writeRaw(p, `${String(text).replace(/\r\n?/g, "\n").replace(/\n+$/, "")}\n`);
}

export function writeRaw(p, data) {
  try {
    mkdirp(path.dirname(p));
    fs.writeFileSync(p, data);
  } catch (e) {
    err(`${p}: ${e.message}`);
  }
}

export function readdir(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (e) {
    err(`${p}: ${e.message}`);
  }
}

export function copyDir(src, dest) {
  mkdirp(dest);
  for (const entry of readdir(src)) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

export function rmDir(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/* ----------------------------------------------------------------- yaml ---- */

export function loadYaml(p) {
  const text = readText(p);
  try {
    return parseYaml(text, { file: p });
  } catch (e) {
    err(`${p}: invalid YAML: ${e.message}`);
  }
}

export function loadYamlMap(p) {
  const v = loadYaml(p);
  if (!(v instanceof Map)) err(`${p}: YAML root must be a mapping`);
  return v;
}

export function dumpYaml(value) {
  try {
    return dumpYamlValue(value);
  } catch (e) {
    err(`YAML dump failed: ${e.message}`);
  }
}

export function writeYaml(p, value) {
  writeText(p, dumpYaml(value));
}

export function mapGet(m, key) {
  if (!(m instanceof Map)) return undefined;
  return m.get(key);
}

export function mapSet(m, key, value) {
  m.set(key, value);
}

export function mapHas(m, key) {
  return m instanceof Map && m.has(key);
}

export function strOf(v) {
  return typeof v === "string" ? v : undefined;
}

export function boolOf(v) {
  return typeof v === "boolean" ? v : undefined;
}

export function intOf(v) {
  return typeof v === "number" && Number.isInteger(v) ? v : undefined;
}

export function numOf(v) {
  return typeof v === "number" ? v : undefined;
}

/** YAML/JS value → JSON-safe value (Map → plain object). */
export function yamlToJson(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Map) {
    const out = {};
    for (const [k, val] of v.entries()) out[typeof k === "string" ? k : String(k)] = yamlToJson(val);
    return out;
  }
  if (Array.isArray(v)) return v.map(yamlToJson);
  if (typeof v === "bigint") return Number(v);
  return v;
}

/** JSON value → YAML value with ordered keys (plain objects keep insertion order). */
export function jsonToYaml(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(jsonToYaml);
  if (typeof v === "object") {
    const m = new Map();
    for (const [k, val] of Object.entries(v)) m.set(k, jsonToYaml(val));
    return m;
  }
  return v;
}

export function isKebabId(s) {
  if (!s) return false;
  return s.split("-").every((part) => part.length > 0 && /^[a-z0-9]+$/.test(part));
}

/* --------------------------------------------------------------- images ---- */

/** PNG IHDR width/height + whether an alpha channel is present. */
export function inspectPng(p) {
  const data = readBytes(p);
  if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    err(`${p}: invalid PNG signature or IHDR`);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  let i = 33;
  while (i + 8 <= data.length) {
    const length = data.readUInt32BE(i);
    const type = data.toString("ascii", i + 4, i + 8);
    if (type === "tRNS") hasAlpha = true;
    if (type === "IEND") break;
    i += 12 + length;
  }
  return [[width, height], hasAlpha];
}

function attrRaw(text, name) {
  const pat = `${name}=`;
  const idx = text.indexOf(pat);
  if (idx < 0) return null;
  const rest = text.slice(idx + pat.length);
  const quote = rest[0];
  if (quote !== '"' && quote !== "'") return null;
  const end = rest.slice(1).indexOf(quote);
  if (end < 0) return null;
  return rest.slice(1, 1 + end);
}

function attrLength(text, name) {
  const raw = attrRaw(text, name);
  if (raw === null) return null;
  const trimmed = raw.trim().replace(/px$/, "").trim();
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Minimal SVG size probe (width/height attrs, else viewBox). */
export function inspectSvg(p) {
  const text = readText(p);
  let w = attrLength(text, "width");
  let h = attrLength(text, "height");
  if (w === null || h === null) {
    const vb = attrRaw(text, "viewBox");
    if (vb) {
      const parts = vb.replace(/,/g, " ").split(/\s+/).filter(Boolean).map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        w = Math.round(parts[2]);
        h = Math.round(parts[3]);
      }
    }
  }
  if (w !== null && h !== null && w > 0 && h > 0) return [[w, h], true];
  err(`${p}: SVG requires positive width/height or viewBox`);
}

/** @returns {[[number,number], boolean] | null} */
export function inspectImage(p) {
  const suffix = path.extname(p).slice(1).toLowerCase();
  if (suffix === "png") return inspectPng(p);
  if (suffix === "svg") return inspectSvg(p);
  return null;
}

/** Relative path when the target sits under base, else the absolute path. */
export function relOrAbs(target, base) {
  const rel = path.relative(base, target);
  if (rel === "") return ".";
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  return target;
}
