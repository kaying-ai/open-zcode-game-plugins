/**
 * export.mjs — `kui export`: deterministic Godot / Unity / Cocos / generic /
 * taptap-maker JSON handoff.
 *
 * Port of export.rs. Output is byte-identical to the Rust exporter: same file
 * order, same JSON key order (serde_json sorts object keys), same path joins and
 * the same trailing-newline normalisation (writeText).
 *
 * Every engine folder also gets `README.md` (agent-facing apply guide) and
 * `demo/` (runnable reference implementation: fixed assembler template +
 * generated data mirror, events only log `[kui-demo]`).
 * `taptap-maker` additionally emits a Maker-ready pack:
 *   theme.lua · component-map.json · screens.json · README.md
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  err,
  findRoot,
  exists,
  mkdirp,
  readText,
  writeText,
  loadYamlMap,
  writeYaml,
  mapGet,
  mapSet,
  strOf,
  boolOf,
  intOf,
  yamlToJson,
  jsonToYaml,
} from "./util.mjs";
import { Next, Outcome, Problem } from "./report.mjs";

/* --------------------------------------------------------------- helpers ---- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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

function asMap(v) {
  return v instanceof Map ? v : null;
}

function asSeq(v) {
  return Array.isArray(v) ? v : null;
}

/** JSON object member; undefined when the key is absent. */
function jget(v, key) {
  return isObj(v) && Object.prototype.hasOwnProperty.call(v, key) ? v[key] : undefined;
}

function jstr(v) {
  return typeof v === "string" ? v : undefined;
}

/** Iterate a JSON object in sorted key order (serde_json::Map is a BTreeMap). */
function jentries(obj) {
  if (!isObj(obj)) return [];
  return Object.keys(obj)
    .sort()
    .map((k) => [k, obj[k]]);
}

/** serde_json::to_string_pretty: object keys sorted, 2-space indent. */
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const val = v[k];
      out[k] = val === undefined ? null : sortValue(val);
    }
    return out;
  }
  return v === undefined ? null : v;
}

function jsonPretty(v) {
  return JSON.stringify(sortValue(v), null, 2);
}

function asciiLower(s) {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** `{:.1}` — Rust rounds the exact decimal value, ties to even. */
function fmt1(x) {
  const neg = x < 0;
  const s = Math.abs(x).toFixed(20);
  const dot = s.indexOf(".");
  const intPart = s.slice(0, dot);
  const frac = s.slice(dot + 1);
  const keep = frac.slice(0, 1);
  const rest = frac.slice(1);
  let roundUp;
  if (rest[0] > "5") roundUp = true;
  else if (rest[0] < "5") roundUp = false;
  else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
  else roundUp = Number(keep) % 2 === 1;
  let digits = `${intPart}${keep}`;
  if (roundUp) digits = (BigInt(digits) + 1n).toString();
  const cut = digits.length - 1;
  const out = `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  return neg ? `-${out}` : out;
}

/* ---------------------------------------------------------- atlas parsing ---- */

function margins(item) {
  const slice = asMap(mapGet(item, "slice"));
  if (slice && strOf(mapGet(slice, "type")) === "9-slice") {
    const m = asSeq(mapGet(slice, "margins"));
    if (m && m.length === 4) {
      const nums = m.map((x) => intOf(x));
      if (nums.every((n) => n !== undefined && n >= 0)) return nums;
    }
  }
  return [0, 0, 0, 0];
}

function spritesMap(atlas) {
  const s = jget(atlas, "sprites");
  if (!isObj(s)) err("atlas JSON requires a sprites object");
  return s;
}

function sliceTypeOf(item) {
  const t = jget(jget(item, "slice"), "type");
  return typeof t === "string" ? t : "full";
}

function pivotOf(item) {
  const has = isObj(item) && Object.prototype.hasOwnProperty.call(item, "pivot");
  return has ? item.pivot : [0.5, 0.5];
}

/* ------------------------------------------------------ engine exporters ---- */

function exportGodot(atlas) {
  const resources = {};
  const sprites = jget(atlas, "sprites");
  if (isObj(sprites)) {
    for (const [name, item] of jentries(sprites)) {
      const map = asMap(jsonToYaml(item)) ?? new Map();
      resources[name] = {
        texture: jget(atlas, "image"),
        region: jget(item, "region"),
        patch_margins: margins(map),
        component_id: jget(item, "component_id"),
        state: jget(item, "state"),
      };
    }
  }
  return { texture: jget(atlas, "image"), resources };
}

function exportUnity(atlas) {
  const sprites = [];
  const obj = jget(atlas, "sprites");
  if (isObj(obj)) {
    for (const [name, item] of jentries(obj)) {
      const map = asMap(jsonToYaml(item)) ?? new Map();
      sprites.push({
        name,
        rect: jget(item, "region"),
        pivot: pivotOf(item),
        border: margins(map),
        pixelsPerUnit: 100,
      });
    }
  }
  return { texture: jget(atlas, "image"), spriteMode: "Multiple", sprites };
}

function exportCocos(atlas) {
  const frames = {};
  const obj = jget(atlas, "sprites");
  if (isObj(obj)) {
    for (const [name, item] of jentries(obj)) {
      const map = asMap(jsonToYaml(item)) ?? new Map();
      const region = asSeq(jget(item, "region")) ?? [];
      const g = (i) => intOf(region[i]) ?? 0;
      const [x, y, w, h] = [g(0), g(1), g(2), g(3)];
      frames[name] = {
        rect: { x, y, width: w, height: h },
        offset: { x: 0, y: 0 },
        originalSize: { width: w, height: h },
        capInsets: margins(map),
      };
    }
  }
  return { texture: jget(atlas, "image"), frames };
}

function exportGeneric(atlas) {
  return { texture: jget(atlas, "image"), sprites: jget(atlas, "sprites") };
}

/* ------------------------------------------------ taptap-maker (UrhoX UI) ---- */

function hexToRgba(hex) {
  let s = hex.trim();
  while (s.startsWith("#")) s = s.slice(1);
  if (s.length !== 6 && s.length !== 8) return null;
  const parse = (i) => {
    const part = s.slice(i, i + 2);
    return /^[0-9a-fA-F]{2}$/.test(part) ? parseInt(part, 16) : null;
  };
  const r = parse(0);
  const g = parse(2);
  const b = parse(4);
  if (r === null || g === null || b === null) return null;
  const a = s.length === 8 ? parse(6) : 255;
  if (a === null) return null;
  return [r, g, b, a];
}

function rgbaJson(hex) {
  const c = hexToRgba(hex);
  return c ? [c[0], c[1], c[2], c[3]] : null;
}

function darkenRgba(rgba, factor) {
  const dim = (x) => Math.min(255, Math.max(0, Math.round(x * factor)));
  return [dim(rgba[0]), dim(rgba[1]), dim(rgba[2]), rgba[3]];
}

function pickStr(map, keys) {
  for (const k of keys) {
    const s = strOf(mapGet(map, k));
    if (s !== undefined && s !== "") return s;
  }
  return undefined;
}

function mapWidget(category, componentId) {
  const id = asciiLower(componentId);
  switch (category) {
    case "background":
      return ["UI.Panel", "full-bleed surface; place under SafeAreaView siblings"];
    case "character":
      return ["UI.Spine", "or UI.Sprite for static portraits"];
    case "icon":
      if (id.includes("badge")) return ["UI.Badge", "status / rarity badge"];
      return ["UI.Sprite", "icon-sized sprite from atlas region"];
    case "decoration":
      return ["UI.Sprite", "overlay decoration; keep pointer-events off if pure VFX"];
    case "container":
      if (id.includes("modal") || id.includes("popup") || id.includes("dialog")) {
        return ["UI.Modal", "overlay dialog with title / content / footer"];
      } else if (id.includes("progress") || id.includes("bar")) {
        return ["UI.ProgressBar", "determinate fill bar"];
      } else if (id.includes("toast") || id.includes("alert")) {
        return ["UI.Alert", "inline or floating status message"];
      } else if (id.includes("tooltip")) {
        return ["UI.Tooltip", "hover/touch detail bubble"];
      } else if (id.includes("list") || id.includes("inventory") || id.includes("slot")) {
        return ["UI.List", "scrollable inventory/list; see also UI.VirtualList"];
      } else if (id.includes("tab")) {
        return ["UI.Tabs", "segmented navigation"];
      }
      return ["UI.Card", "elevated panel / card surface"];
    case "control":
      if (id.includes("toggle") || id.includes("switch")) {
        return ["UI.Toggle", "on/off switch"];
      } else if (id.includes("check")) {
        return ["UI.Checkbox", "boolean checkbox"];
      } else if (id.includes("slider")) {
        return ["UI.Slider", "range slider"];
      } else if (id.includes("input") || id.includes("field") || id.includes("search")) {
        return ["UI.TextField", "text input"];
      } else if (id.includes("dropdown") || id.includes("select")) {
        return ["UI.Dropdown", "option picker"];
      } else if (id.includes("nav") || id.includes("tab")) {
        return ["UI.Tabs", "primary navigation row"];
      }
      return ["UI.Button", "gradient/solid CTA; variant from token role"];
    default:
      return ["UI.Panel", "generic container"];
  }
}

function exportTaptapMaker(atlas, style, components, screens) {
  const sprites = {};
  const atlasSprites = jget(atlas, "sprites");
  if (isObj(atlasSprites)) {
    for (const [name, item] of jentries(atlasSprites)) {
      const map = asMap(jsonToYaml(item)) ?? new Map();
      sprites[name] = {
        region: jget(item, "region"),
        pivot: pivotOf(item),
        slice: jget(item, "slice"),
        slice_type: sliceTypeOf(item),
        nine_patch: margins(map),
        component_id: jget(item, "component_id"),
        state: jget(item, "state"),
      };
    }
  }

  // ---- theme tokens from style-contract ----
  let theme = {
    source: "style-contract.yaml",
    base: "DefaultTaptap",
    notes: [
      "Colors are RGBA tables for UI.Theme.ExtendTheme",
      "Prefer DefaultTaptap / ui-astroon / ui-brawlforge / ui-pixelforge packs from Maker installer",
      "UI.Init({ theme = <this table>, scale = UI.Scale.DEFAULT })",
    ],
  };
  if (style) {
    const colors = asMap(mapGet(style, "colors")) ?? new Map();
    const geometry = asMap(mapGet(style, "geometry")) ?? new Map();
    const typography = asMap(mapGet(style, "typography")) ?? new Map();
    const tokens = asMap(mapGet(style, "tokens")) ?? new Map();
    const platform = asMap(mapGet(style, "platform")) ?? new Map();

    const colorMap = {};
    for (const key of [
      "primary",
      "secondary",
      "accent",
      "background",
      "warning",
      "reward",
      "disabled",
    ]) {
      const hex = strOf(mapGet(colors, key));
      if (hex !== undefined) {
        colorMap[key] = rgbaJson(hex);
        colorMap[`${key}_hex`] = hex;
      }
    }
    // Pressed-state color for clickable controls: explicit `colors.pressed` wins,
    // otherwise derive from primary by dimming ~14%.
    const pressedHex = strOf(mapGet(colors, "pressed"));
    let pressedRgba = pressedHex !== undefined ? hexToRgba(pressedHex) : null;
    if (!pressedRgba) {
      const primaryHex = strOf(mapGet(colors, "primary"));
      if (primaryHex !== undefined) {
        const rgba = hexToRgba(primaryHex);
        if (rgba) pressedRgba = darkenRgba(rgba, 0.86);
      }
    }
    if (pressedRgba) {
      colorMap.primaryPressed = pressedRgba;
      if (pressedHex !== undefined) colorMap.primaryPressed_hex = pressedHex;
    }
    // semantic aliases
    const tc = asMap(mapGet(tokens, "color"));
    if (tc) {
      for (const [k, v] of tc) {
        if (typeof k !== "string") continue;
        const hex = strOf(v);
        if (hex !== undefined) colorMap[`token.${k}`] = rgbaJson(hex);
      }
    }

    const radius = asMap(mapGet(geometry, "radius")) ?? new Map();
    const radiusMap = {};
    for (const [k, v] of radius) {
      const key = strOf(k);
      const n = intOf(v);
      if (key === undefined || n === undefined) continue;
      const token = key === "small" ? "sm" : key === "card" ? "lg" : key === "modal" ? "xl" : key;
      radiusMap[token] = n;
    }
    if (!Object.prototype.hasOwnProperty.call(radiusMap, "full")) radiusMap.full = 9999;

    const typeMap = {};
    for (const key of ["title", "section", "body", "number", "button"]) {
      const t = asMap(mapGet(typography, key));
      if (t) {
        typeMap[key] = {
          size: intOf(mapGet(t, "size")),
          weight: intOf(mapGet(t, "weight")),
        };
      }
    }

    const spacingTokens = asMap(mapGet(tokens, "spacing")) ?? new Map();
    const spacing = {};
    for (const [k, v] of spacingTokens) {
      const key = strOf(k);
      const n = intOf(v);
      if (key === undefined || n === undefined) continue;
      spacing[key] = n;
    }

    const visual = asMap(mapGet(style, "visual"));
    const keywords = visual ? mapGet(visual, "keywords") : undefined;

    theme = {
      source: "style-contract.yaml",
      name: pickStr(style, ["name", "visual.theme", "theme"]),
      base: "DefaultTaptap",
      visual_keywords: keywords === undefined ? [] : yamlToJson(keywords),
      platform: {
        target: strOf(mapGet(platform, "target")),
        orientation: strOf(mapGet(platform, "orientation")),
        reference_size: yamlToJson(mapGet(platform, "reference_size")),
        safe_area: yamlToJson(mapGet(platform, "safe_area")),
      },
      colors: colorMap,
      radius: radiusMap,
      typography: typeMap,
      spacing,
      ui_language: {
        engine: "UrhoX / TapTap Maker",
        script: "Lua 5.4",
        layout: "Yoga (Flexbox-like; defaults differ from CSS)",
        render: "NanoVG",
        init: ["UI.Init(config)", "build widget tree", "UI.SetRoot(root)"],
        scale: "UI.Scale.DEFAULT (1 base px ≈ 1 CSS px)",
        safe_area: "UI.SafeAreaView for interactive HUD; background outside",
        fonts: "copy TTF into assets/Fonts/ and register in UI.Init fonts",
      },
      style_packs: {
        DefaultTaptap: "clean flat rounded · teal/mint · Resource Han Rounded",
        "ui-astroon": "cosmic cartoon · purple/gradient/glow · Inter",
        "ui-brawlforge": "sci-fi HUD · sharp edges · Noto Sans SC bold",
        "ui-pixelforge": "retro pixel · radius 0 · Fusion Pixel",
      },
    };
  }

  // ---- component -> widget map ----
  const compEntries = [];
  if (components) {
    const list = asSeq(mapGet(components, "components"));
    if (list) {
      for (const item of list) {
        const m = asMap(item);
        if (!m) continue;
        const id = strOf(mapGet(m, "id")) ?? "component";
        const category = strOf(mapGet(m, "category")) ?? "container";
        const [widget, hint] = mapWidget(category, id);
        const statesSeq = asSeq(mapGet(m, "states"));
        const states = statesSeq ? statesSeq.filter((x) => typeof x === "string") : [];
        const slice = asMap(mapGet(m, "slice"));
        const sliceType = (slice ? strOf(mapGet(slice, "type")) : undefined) ?? "full";
        const marginsSeq = slice ? asSeq(mapGet(slice, "margins")) : null;
        const marginsV = marginsSeq
          ? marginsSeq.filter((x) => intOf(x) !== undefined).map((x) => intOf(x))
          : [0, 0, 0, 0];
        const textPolicy = strOf(mapGet(m, "text_policy")) ?? "none";
        const reusable = boolOf(mapGet(m, "reusable")) ?? false;
        const targetSize = yamlToJson(mapGet(m, "target_size"));
        const exportTargetsSeq = asSeq(mapGet(m, "export_targets"));
        const exportTargets = exportTargetsSeq
          ? exportTargetsSeq.filter((x) => typeof x === "string")
          : [];

        // atlas sprites that reference this component, grouped by state
        const spritesFor = [];
        const stateSprites = {};
        for (const [name, sp] of jentries(atlasSprites)) {
          if (jstr(jget(sp, "component_id")) !== id) continue;
          spritesFor.push(name);
          const state = jstr(jget(sp, "state"));
          if (state !== undefined && !Object.prototype.hasOwnProperty.call(stateSprites, state)) {
            stateSprites[state] = name;
          }
        }

        compEntries.push({
          id,
          name: strOf(mapGet(m, "name")),
          category,
          widget,
          widget_hint: hint,
          reusable,
          text_policy: textPolicy,
          target_size: targetSize,
          states,
          state_sprites: stateSprites,
          slice: { type: sliceType, margins: marginsV },
          atlas_sprites: spritesFor,
          export_targets: exportTargets,
        });
      }
    }
  }

  // ---- screens ----
  const screenEntries = [];
  if (screens) {
    const list = asSeq(mapGet(screens, "screens"));
    if (list) {
      for (const item of list) {
        const m = asMap(item);
        if (!m) continue;
        const id = strOf(mapGet(m, "id")) ?? "screen";
        const layout = asMap(mapGet(m, "layout")) ?? new Map();
        const layoutOut = {};
        for (const zone of ["top", "center", "bottom", "floating"]) {
          const seq = asSeq(mapGet(layout, zone));
          if (seq) layoutOut[zone] = seq.filter((x) => typeof x === "string");
        }
        const listOr = (key) => {
          const v = mapGet(m, key);
          return v === undefined ? [] : yamlToJson(v);
        };
        screenEntries.push({
          id,
          name: strOf(mapGet(m, "name")) ?? strOf(mapGet(m, "title")),
          priority: strOf(mapGet(m, "priority")),
          status: strOf(mapGet(m, "status")),
          purpose: strOf(mapGet(m, "purpose")),
          primary_actions: listOr("primary_actions"),
          components: listOr("components"),
          states: listOr("states"),
          layout: layoutOut,
          lua_module: `scripts/ui/screens/${id.replace(/-/g, "_")}.lua`,
        });
      }
    }
  }

  const body = {
    texture: jget(atlas, "image"),
    sprites,
    theme,
    components: compEntries,
    screens: screenEntries,
    platform: {
      id: "taptap-maker",
      engine: "UrhoX",
      ui: "urhox-libs/UI",
      layout: "Yoga",
      render: "NanoVG",
      script: "Lua",
      asset_roots: {
        images: "assets/image",
        sprites: "assets/sprites",
        audio_sfx: "assets/audio/sfx",
        audio_voice: "assets/audio/voice",
        fonts: "assets/Fonts",
        scripts: "scripts",
      },
      handoff_only: true,
      native_project_files: false,
    },
  };

  const pack = {
    theme,
    components: compEntries,
    screens: screenEntries,
    sprites,
    texture: jget(atlas, "image") ?? null,
    atlas_id: jget(atlas, "atlas_id") ?? null,
  };
  return { body, pack };
}

/* ---------------------------------------- Lua literal emission (ui-data) ---- */

function luaStrLit(s) {
  let out = '"';
  for (const c of s) {
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else out += c;
  }
  return `${out}"`;
}

const LUA_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if",
  "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
]);

/** Emit `key = ` for valid Lua identifiers, `["key"] = ` otherwise. */
function luaTableKey(k) {
  const isIdent =
    k.length > 0 && !LUA_KEYWORDS.has(k) && /^[A-Za-z_]/.test(k) && /^[A-Za-z0-9_]+$/.test(k);
  if (isIdent) return `${k} = `;
  return `[${luaStrLit(k)}] = `;
}

function luaLit(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return luaStrLit(v);
  if (Array.isArray(v)) return `{ ${v.map(luaLit).join(", ")} }`;
  if (isObj(v)) {
    const parts = jentries(v).map(([k, val]) => `${luaTableKey(k)}${luaLit(val)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return "nil";
}

function luaRgba(v) {
  if (Array.isArray(v) && v.length === 4) {
    const nums = v.map((x) => String(intOf(x) ?? 0));
    return `{ ${nums[0]}, ${nums[1]}, ${nums[2]}, ${nums[3]} }`;
  }
  return "nil";
}

function writeThemeLua(file, pack) {
  const theme = pack.theme;
  const name = typeof theme.name === "string" ? theme.name : "ProjectTheme";
  const colors = isObj(theme.colors) ? theme.colors : {};
  const radius = isObj(theme.radius) ? theme.radius : {};
  const typography = isObj(theme.typography) ? theme.typography : {};

  let color_lines = "";
  {
    // Prefer direct roles over token.* aliases when both map to the same Lua key.
    const keys = Object.keys(colors)
      .filter((k) => !k.endsWith("_hex"))
      .sort();
    const ordered = [
      ...keys.filter((k) => !k.startsWith("token.")),
      ...keys.filter((k) => k.startsWith("token.")),
    ];
    const byLuaKey = new Map();
    for (const k of ordered) {
      const v = colors[k];
      if (v === null || v === undefined) continue;
      let luaKey;
      switch (k) {
        case "primary":
        case "token.action-primary":
          luaKey = "primary";
          break;
        case "primaryPressed":
        case "token.action-primary-pressed":
          luaKey = "primaryPressed";
          break;
        case "secondary":
          luaKey = "secondary";
          break;
        case "accent":
          luaKey = "info";
          break;
        case "background":
          luaKey = "background";
          break;
        case "warning":
          luaKey = "warning";
          break;
        case "reward":
          luaKey = "reward";
          break;
        case "disabled":
          luaKey = "disabled";
          break;
        case "token.action-danger":
          luaKey = "error";
          break;
        case "token.surface-panel":
          luaKey = "surface";
          break;
        case "token.text-primary":
          luaKey = "text";
          break;
        default:
          luaKey = k;
      }
      if (luaKey.includes(".")) continue;
      byLuaKey.set(luaKey, v);
    }
    // Clickable controls must never look identical in normal vs pressed state.
    if (!byLuaKey.has("primaryPressed")) {
      const prim = byLuaKey.get("primary");
      if (Array.isArray(prim)) {
        const nums = prim.map((x) => intOf(x) ?? 0);
        if (nums.length === 4) {
          const dim = (x) => Math.round(x * 0.86);
          byLuaKey.set("primaryPressed", [dim(nums[0]), dim(nums[1]), dim(nums[2]), nums[3]]);
        }
      }
    }
    for (const k of [...byLuaKey.keys()].sort()) {
      color_lines += `    ${k} = ${luaRgba(byLuaKey.get(k))},\n`;
    }
  }
  if (color_lines.trim() === "") {
    color_lines +=
      "    primary = { 30, 214, 181, 255 },\n    primaryPressed = { 26, 184, 156, 255 },\n    background = { 215, 255, 246, 255 },\n    surface = { 255, 255, 255, 255 },\n    text = { 17, 17, 17, 255 },\n    textSecondary = { 39, 51, 49, 255 },\n";
  } else {
    if (!color_lines.includes("surface =")) {
      color_lines += "    surface = { 255, 255, 255, 255 },\n";
    }
    if (!color_lines.includes("text =")) {
      color_lines += "    text = { 17, 17, 17, 255 },\n";
    }
    if (!color_lines.includes("primaryPressed =")) {
      color_lines += "    primaryPressed = { 26, 184, 156, 255 },\n";
    }
  }

  let radius_lines = "";
  for (const k of Object.keys(radius).sort()) {
    const n = intOf(radius[k]);
    if (n !== undefined) radius_lines += `    ${k} = ${n},\n`;
  }
  if (radius_lines === "") {
    radius_lines += "    sm = 8,\n    md = 10,\n    lg = 14,\n    xl = 20,\n    full = 9999,\n";
  }

  const btn_size = isObj(typography.button) ? (intOf(typography.button.size) ?? 30) : 30;
  // Maker themes use pt-ish sizes: design px / 2 ≈ pt at 2x art
  const btnPt = fmt1(Math.min(24, Math.max(10, (btn_size / 2.0) * 0.75)));
  const card_radius = intOf(radius.lg) ?? 14;

  const body = `-- Generated by kaying-for-ui · taptap-maker export
-- Theme: ${name}
-- Usage:
--   local ProjectTheme = require("scripts/ui/theme")
--   UI.Init({ theme = ProjectTheme, scale = UI.Scale.DEFAULT })
--
-- Two-state (normal / pressed) convention:
--   · colors.primaryPressed  -  the pressed primary color (normal primary darkened ~14%); UrhoX Button applies it automatically on press;
--   · components.Button.pressedBorderWidth / pressedPadding  -  flattens the bottom edge and sinks the content on press;
--   · pressed state for atlas skins: each component state_sprites.pressed in component-map.json points to
--     \`<component-id>-pressed\` sprite; the integrator binds it to the pressed state to distinguish it from normal.

local Theme = require("urhox-libs/UI/Core/Theme")

return Theme.ExtendTheme(Theme.defaultTheme, {
  colors = {
${color_lines}  },
  radius = {
${radius_lines}  },
  componentDefaults = {
    borderRadius = ${card_radius},
  },
  components = {
    Button = {
      height = 48,
      fontSize = ${btnPt},
      fontWeight = "bold",
      borderRadius = ${card_radius},
      pressedBorderWidth = 1,
      pressedPadding = 0,
    },
    Card = {
      borderRadius = ${card_radius},
      borderWidth = 1,
    },
    Modal = {
      borderRadius = ${card_radius},
      borderWidth = 1,
    },
  },
})
`;
  writeText(file, body);
}

function writeComponentMapJson(file, pack) {
  const text = jsonPretty({
    schema_version: 1,
    engine: "taptap-maker",
    atlas_id: pack.atlas_id,
    texture: pack.texture,
    mapping_rules: {
      background: "UI.Panel",
      "control/button": "UI.Button",
      "control/toggle": "UI.Toggle",
      "control/input": "UI.TextField",
      "container/card": "UI.Card",
      "container/modal": "UI.Modal",
      "container/progress": "UI.ProgressBar",
      icon: "UI.Sprite",
      character: "UI.Spine or UI.Sprite",
      decoration: "UI.Sprite",
    },
    interaction: {
      two_state_rule:
        "every clickable control ships default + pressed; bind state_sprites.pressed to the pressed visual so normal vs clicked look different",
      states_required: ["default", "pressed"],
      pressed_color_role: "primaryPressed",
      pressed_theme_keys: {
        pressedBorderWidth: 1,
        pressedPadding: 0,
      },
      pressed_treatment:
        "darken ~14% (primaryPressed) + bottom edge collapse / 2px sink; keep outline identical to default",
    },
    text_policy: {
      "no-text": "sprite is art only; compose Label on top",
      composited: "text is baked; do not re-label in engine",
      none: "no interactive text expected",
    },
    nine_patch: "use slice.margins as NanoVG/image 9-patch insets when drawing stretched skins",
    components: pack.components,
  });
  writeText(file, `${text}\n`);
}

function writeScreensJson(file, pack) {
  const screens = pack.screens;
  const lua_samples = [];
  for (const s of screens) {
    if (typeof s.id !== "string") continue;
    const id = s.id;
    const safe = id.replace(/-/g, "_");
    const pascal = safe
      .split("_")
      .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : ""))
      .join("");
    const title = typeof s.name === "string" ? s.name : id;
    lua_samples.push(`-- scripts/ui/screens/${safe}.lua
local UI = require("urhox-libs/UI")

local function build${pascal}Screen(onAction)
  return UI.SafeAreaView {
    width = "100%",
    height = "100%",
    backgroundColor = UI.Theme.Color("background"),
    children = {
      UI.Panel {
        width = "100%",
        height = "100%",
        flexDirection = "column",
        padding = { 16, 24, 16, 24 },
        gap = 16,
        children = {
          UI.Label { text = "${title}", fontSize = 22, fontWeight = "bold" },
          -- map components via exports/taptap-maker/component-map.json
          UI.Button {
            text = "Start",
            variant = "primary",
            onClick = function() if onAction then onAction("primary") end end,
          },
        },
      },
    },
  }
end

return { id = "${id}", build = build${pascal}Screen }
`);
  }

  const text = jsonPretty({
    schema_version: 1,
    engine: "taptap-maker",
    conventions: {
      layout: "Yoga flex props (flexDirection, justifyContent, alignItems, gap, padding)",
      root: "always UI.SetRoot after building the tree",
      safe_area: "interactive content in UI.SafeAreaView; full-bleed art outside",
      events: "onClick / onChange on widgets; prefer self-describing handlers",
      two_states:
        "clickable controls must look different when pressed: theme.lua provides primaryPressed + pressedBorderWidth/pressedPadding; atlas skins bind state_sprites.pressed from component-map.json",
      scale: "UI.Scale.DEFAULT",
    },
    screens,
    lua_sample_modules: lua_samples,
  });
  writeText(file, `${text}\n`);
}

/* --------------------------------- taptap-maker demo (reference impl) ------- */

/** `demo/ui-data.lua` — Lua mirror of the manifest, consumed by demo/main.lua. */
function writeDemoUiData(file, project_id, pack) {
  let body = "";
  body += "-- Generated by kaying-for-ui · taptap-maker export · demo/ui-data.lua\n";
  body += `-- Project: ${project_id}\n`;
  body +=
    "-- ui-main.json is mirrored to Lua by the exporter for data-driven screen assembly in demo/main.lua.\n";
  body += `-- Hand edits are discarded; regenerate: kui export specs/${project_id} --force\n\n`;
  body += "return {\n";
  body += `  project_id = ${luaStrLit(project_id)},\n`;
  body += `  atlas_id = ${luaLit(pack.atlas_id)},\n`;
  body += `  texture = ${luaLit(pack.texture)},\n`;
  body +=
    '  runtime_texture = "assets/image/ui-main.png", -- conventional atlas PNG location; the demo picks up the image automatically once copied\n';
  body += "  sprites = {\n";
  for (const [name, item] of jentries(pack.sprites)) {
    body += `    [${luaStrLit(name)}] = ${luaLit(item)},\n`;
  }
  body += "  },\n";
  body += "  components = {\n";
  for (const item of pack.components) {
    body += `    ${luaLit(item)},\n`;
  }
  body += "  },\n";
  body += "  screens = {\n";
  for (const item of pack.screens) {
    body += `    ${luaLit(item)},\n`;
  }
  body += "  },\n";
  body += "}\n";
  writeText(file, body);
}

/** `demo/main.lua` — fixed generic loader template (identical for every project). */
function writeDemoMain(file, project_id) {
  const body = `-- Generated by kaying-for-ui · taptap-maker export · demo/main.lua
-- Project: __PROJECT_ID__
--
-- Reference demo (reference implementation): data-driven assembly of every screens.json screen from demo/ui-data.lua
-- into an interactive node tree; every event logs exactly one line and contains no business logic.
--
-- Usage (see README.md in this directory):
--   1) Copy this file and ui-data.lua into the Maker project scripts/demo/
--   2) Copy theme.lua to scripts/ui/theme.lua (optional; falls back to the library default theme)
--   3) The entry point calls require("scripts/demo/main").boot()
-- If the project require root differs, just adjust the two require lines below.

local UI = require("urhox-libs/UI")
local Data = require("scripts/demo/ui_data")

local RUNTIME_TEXTURE = "assets/image/ui-main.png" -- conventional atlas PNG location (image renders only if present)
local LOG_TAG = "kui-demo"

local hasTheme, ProjectTheme = pcall(require, "scripts/ui/theme")

local showScreen -- forward declaration (used for navigation callbacks)

local function emit(line)
  print("[" .. LOG_TAG .. "] " .. line)
end

local function themeColor(role)
  local ok, v = pcall(function() return UI.Theme.Color(role) end)
  if ok then return v end
  return nil
end

local function findScreen(id)
  for _, s in ipairs(Data.screens or {}) do
    if s.id == id then return s end
  end
  return nil
end

local function findComponent(id)
  for _, c in ipairs(Data.components or {}) do
    if c.id == id then return c end
  end
  return nil
end

local function logClick(screenId, componentId)
  emit(string.format("screen=%s event=click component=%s state=default", screenId, componentId))
end

-- Layout block -> node. Uses only documented base widgets; see the ADAPT comments for skin drawing.
local function buildBlock(screen, blockId)
  local c = findComponent(blockId)
  if not c then
    -- Layout block has no component contract: placeholder panel (structure present; the integrator replaces the skin)
    return UI.Panel {
      width = "100%",
      height = 56,
      backgroundColor = themeColor("surface"),
      borderRadius = 12,
      justifyContent = "center",
      alignItems = "center",
      children = { UI.Label { text = blockId, fontSize = 14 } },
    }
  end

  if c.widget == "UI.Button" then
    -- Two-state: normal/pressed feedback comes from the theme (primaryPressed + pressedBorderWidth/pressedPadding in theme.lua,
    -- the bottom edge flattens and color darkens on press). For atlas skins, bind ui-data.sprites[c.state_sprites.pressed]
    -- to the button pressed state (ADAPT: the pressed callback property name depends on your UrhoX version).
    return UI.Button {
      text = c.name or c.id,
      variant = "primary",
      onClick = function() logClick(screen.id, c.id) end,
    }
  end

  if c.widget == "UI.Sprite" and UI.Sprite then
    -- ADAPT: src / region property names depend on your UrhoX version;
    -- ui-data.sprites[<atlas_sprite>] provides region and slice.margins (9-patch insets).
    -- Clickable icons (c.clickable / category=control): bind the atlas sprite pointed to by c.state_sprites.pressed
    -- to the pressed state so normal and pressed differ; display-only icons need only default.
    return UI.Sprite {
      src = RUNTIME_TEXTURE,
      width = (c.target_size and c.target_size[1]) or 64,
      height = (c.target_size and c.target_size[2]) or 64,
    }
  end

  -- Other mapped widgets (Card / ProgressBar / Toggle ...): render them first as placeholder panels,
  -- then swap in the matching Widget per component-map.json for real integration.
  return UI.Panel {
    width = "100%",
    height = 56,
    backgroundColor = themeColor("surface"),
    borderRadius = 12,
    justifyContent = "center",
    alignItems = "center",
    children = { UI.Label { text = (c.name or c.id) .. " · " .. c.widget, fontSize = 14 } },
  }
end

local function buildZone(screen, zone)
  local blocks = screen.layout and screen.layout[zone]
  if not blocks or #blocks == 0 then return nil end
  local children = {}
  for _, blockId in ipairs(blocks) do
    children[#children + 1] = buildBlock(screen, blockId)
  end
  return UI.Panel {
    width = "100%",
    flexDirection = "column",
    flexGrow = zone == "center" and 1 or 0,
    gap = 12,
    children = children,
  }
end

local function buildScreenBody(id)
  local s = findScreen(id) or { id = id, name = id }
  emit("screen=" .. id .. " event=enter")

  local children = {}

  -- Header: screen name
  children[#children + 1] = UI.Label { text = s.name or s.id, fontSize = 22, fontWeight = "bold" }
  if s.purpose and #s.purpose > 0 then
    children[#children + 1] = UI.Label { text = s.purpose, fontSize = 13 }
  end

  for _, zone in ipairs({ "top", "center", "bottom" }) do
    local row = buildZone(s, zone)
    if row then children[#children + 1] = row end
  end

  local floating = s.layout and s.layout.floating
  if floating and #floating > 0 then
    children[#children + 1] = UI.Label {
      text = "floating: " .. table.concat(floating, ", "),
      fontSize = 12,
    }
  end

  return UI.Panel {
    width = "100%",
    flexGrow = 1,
    flexDirection = "column",
    padding = { 16, 24, 16, 24 },
    gap = 16,
    children = children,
  }
end

local function buildNavBar(currentId)
  local buttons = {}
  for _, s in ipairs(Data.screens or {}) do
    local label = (s.id == currentId and "● " or "") .. (s.name or s.id)
    buttons[#buttons + 1] = UI.Button {
      text = label,
      variant = "primary",
      onClick = function()
        if s.id == currentId then return end
        emit(string.format("event=navigate from=%s to=%s", currentId, s.id))
        showScreen(s.id)
      end,
    }
  end
  return UI.Panel {
    width = "100%",
    flexDirection = "row",
    gap = 12,
    justifyContent = "center",
    children = buttons,
  }
end

showScreen = function(id)
  local root = UI.SafeAreaView {
    width = "100%",
    height = "100%",
    backgroundColor = themeColor("background"),
    children = {
      UI.Panel {
        width = "100%",
        height = "100%",
        flexDirection = "column",
        gap = 12,
        children = {
          buildScreenBody(id),
          buildNavBar(id),
        },
      },
    },
  }
  UI.SetRoot(root)
end

local function boot()
  if hasTheme and ProjectTheme then
    UI.Init({ theme = ProjectTheme, scale = UI.Scale.DEFAULT })
  else
    UI.Init({ scale = UI.Scale.DEFAULT })
  end
  emit(string.format(
    "event=boot screens=%d theme=%s",
    #Data.screens,
    hasTheme and "project" or "default"
  ))
  showScreen(Data.screens[1] and Data.screens[1].id or "lobby")
end

return { boot = boot, showScreen = showScreen }
`;
  writeText(file, body.replace(/__PROJECT_ID__/g, project_id));
}

/** `demo/README.md` — how to drop the demo into a Maker project. */
function writeDemoReadme(file, project_id, pack) {
  const n_comp = pack.components.length;
  const n_scr = pack.screens.length;
  const body = `# demo · ${project_id} (reference implementation / smoke test)

This is the exporter-bundled **runnable reference demo**: it data-assembles the ${n_scr} screens from screens.json into an interactive
node tree (${n_comp} component mappings take part in assembly); every event logs exactly one line (prefix \`[kui-demo]\`) and contains no business logic.

## Files

| File | Purpose |
|---|---|
| \`main.lua\` | generic assembler - **fixed template**, identical for every project and independent of the exported content |
| \`ui-data.lua\` | \`ui-main.json\`  Lua mirror (generated by the exporter; hand edits are discarded) |

## Agent quickstart (setup -> run -> verify)

Goal: after reading this section the Agent can **independently** run the demo and see results; the whole process is **copy + one entry line**, with no edits to generated files.
Prerequisite: TapTap Maker is integrated on the client (the \`taptap-maker\` MCP tool set, or the local \`taptap-maker\` CLI).

1. **Prepare project**: use an existing Maker project root (with \`.project/\`); otherwise follow the next_action from MCP \`maker_status_lite\`
   to initialize or bind one.
2. **Copy files** (source -> target inside the Maker project; relative paths must match):

   | Source | Target |
   |---|---|
   | \`main.lua\`,\`ui-data.lua\` | \`scripts/demo/\` |
   | Parent directory \`theme.lua\` | \`scripts/ui/theme.lua\` (optional; falls back to the library default theme) |
   | Two levels up \`../../assets/atlases/ui-main.png\` | \`assets/image/ui-main.png\` (renders the atlas only if present) |
   | New entry | \`scripts/main.lua\`, one line: \`require("scripts/demo/main").boot()\` |

   If the project require root differs, only adjust the two require lines at the top of \`main.lua\`.
   Note: entry must be \`scripts/main.lua\` (boot is triggered here); setting entry directly to
   \`demo/main.lua\` only loads the module and does not start the UI.
3. **Build + run**:
   - MCP:\`maker_build_current_directory\`(entry=\`main.lua\`,scriptsPath=\`scripts\`)->
     on success use \`generate_test_qrcode\` to scan the QR code on a device, or open the returned web preview.
   - CLI:\`taptap-maker preview\` for a local window preview.
   - If the first run fails, check require and entry errors in the build/run logs; only adjust the step 2 destinations, not the demo logic.
4. **Verify (assertable)**:
   - The runtime logs (returned by the build) contain \`[kui-demo] event=boot screens=${n_scr} theme=project\`
     (or \`theme=default\` if theme.lua was not copied);
   - The UI shows a screen title and bottom navigation; tap to switch between ${n_scr} screens;
   - each enter/click/switch logs one \`[kui-demo]\` line (format below).
5. **After the preview**: the demo only verifies assembly and event wiring; for real integration use \`../ui-main.json\` /
   \`../screens.json\` / \`../component-map.json\` as the single source of truth, and model production screens after \`main.lua\`.

## Log format (grep-ready / assertable)

\`\`\`text
[kui-demo] event=boot screens=${n_scr} theme=project
[kui-demo] screen=lobby event=enter
[kui-demo] screen=lobby event=click component=btn-primary state=default
[kui-demo] event=navigate from=lobby to=shop
\`\`\`

## Coverage / ADAPT points

- **Covered**: screen structure (layout top/center/bottom/floating zones), \`UI.Button\` events,
  theme integration (theme.lua optional), screen-switch navigation, placeholder for contract-less layout blocks.
- **Two-state (normal / pressed)**: clickable controls must have a perceptible difference between normal and pressed.
  Theme path: theme.lua already ships the \`primaryPressed\` pressed color and Button \`pressedBorderWidth\`/\`pressedPadding\`
  (bottom edge flattens and content sinks on press); atlas skin path: \`state_sprites.pressed\` of each component in \`ui-data.lua\`
  points to the \`<component-id>-pressed\` sprite; bind it to the pressed state (ADAPT).
- **ADAPT (for your engine version)**: \`UI.Sprite\` \`src\`/region property names; 9-patch skin drawing
  (\`ui-data.lua\` already provides \`region\` and \`slice.margins\` per sprite); \`UI.Card\`/\`UI.ProgressBar\`
  and other Widgets replace placeholder panels (see the parent \`component-map.json\`).

## Boundaries

- The demo is a **reference implementation and smoke test**, not your project files; for real integration still use
  \`ui-main.json\` / \`screens.json\` / \`component-map.json\` as the source of truth.
- The demo has no business logic: every event only logs.
- The demo sits alongside the \`exports/web/\` preview shell, serving different verification goals.
`;
  writeText(file, body);
}

/* ------------------------------------------------- engine README + demo ---- */

function engineReadmeBody(engine, project_id, root) {
  if (root) {
    const p = path.join(root, "templates", "exports", engine, "README.md");
    try {
      const raw = readText(p);
      return raw.replace(/\{\{PROJECT_ID\}\}/g, project_id);
    } catch {
      /* fall through to the short fallback */
    }
  }
  return (
    `# ${engine} export - ${project_id}\n\n` +
    `Handoff package: read the JSON in this directory and auto-apply the UI to the target ${engine} project.\n\n` +
    "| File | Purpose |\n|---|---|\n| `ui-main.json` | Atlas + sprite metadata |\n| `README.md` | This guide |\n\n" +
    "## Auto integration\n\n" +
    "1. Import the `texture` atlas.\n" +
    "2. Create sprite assets from `region` / `pivot` / 9-patch margins.\n" +
    "3. Bind widget skins by `component_id` + `state`.\n" +
    "4. Align the theme with `exports/web/tokens.css` or the style contract.\n\n" +
    "## Boundaries\n\n" +
    "No native project files are generated; business logic belongs to the game project.\n\n" +
    "## Regenerate\n\n" +
    `\`\`\`bash\nkui export specs/${project_id} --force\n\`\`\`\n`
  );
}

function writeEngineReadme(file, engine, project_id, root, pack) {
  const body = engineReadmeBody(engine, project_id, root)
    .replace(/\{\{SCREEN_COUNT\}\}/g, String(pack.screens.length))
    .replace(/\{\{COMPONENT_COUNT\}\}/g, String(pack.components.length));
  writeText(file, body);
}

function writeTaptapReadme(file, project_id, pack) {
  const n_comp = pack.components.length;
  const n_scr = pack.screens.length;
  const body = `# taptap-maker export - ${project_id}

This is a **TapTap Maker / UrhoX** handoff package, not a runnable full game project.

> Agent goal: read the files in this directory and **auto-apply** the generated UI to Maker/UrhoX game scripts.

## Agent quickstart (read me -> run and see results)

Scope: after this section the Agent can, without follow-up questions or editing generated files, drop the demo into a Maker project and get a clickable ${n_scr}-screen skeleton.
Real business logic is not part of this step (every demo event only logs a \`[kui-demo]\` line); after it runs, follow the integration steps for the real project.

1. **Project**: pick a Maker project root (with \`.project/\`); otherwise use MCP \`maker_status_lite\`
   to confirm or initialize; the working directory is the project root.
2. **Copy files** (relative to the project root; paths must match):
   - \`demo/main.lua\`,\`demo/ui-data.lua\` -> \`scripts/demo/\`
   - \`theme.lua\` -> \`scripts/ui/theme.lua\` (optional; falls back to the library default theme)
   - Project atlas \`../../assets/atlases/ui-main.png\`(i.e. \`specs/<project-id>/assets/atlases/\`) -> \`assets/image/ui-main.png\`
   - New entry \`scripts/main.lua\`, one line: \`require("scripts/demo/main").boot()\`
3. **Build and run**: MCP \`maker_build_current_directory\` (entry=\`main.lua\`, scriptsPath=\`scripts\`),
   on success use \`generate_test_qrcode\` for an on-device QR preview; or CLI \`taptap-maker preview\` for a local window preview.
4. **Verify**: the runtime logs contain \`[kui-demo] event=boot screens=${n_scr} theme=project|default\`;
   The bottom navigation switches between ${n_scr} screens; each click/switch logs one \`[kui-demo]\` line (format in \`demo/README.md\`).
5. **Afterwards**: integrate the real project using \`ui-main.json\` / \`screens.json\` / \`component-map.json\` as the single source of truth,
   modeling the demo assembly; the ADAPT comments in the demo mark the points to adjust per engine version.

## This directory

| File | Purpose |
|---|---|
| \`ui-main.json\` | Atlas + theme + components + screens master manifest |
| \`theme.lua\` | \`require\`-able UI.Theme mapping (adapted from style-contract) |
| \`component-map.json\` | kui component -> \`urhox-libs/UI\` Widget mapping |
| \`screens.json\` | Screen structure and Lua module skeletons |
| \`demo/main.lua\` | **reference demo**: generic assembler (fixed template; events only log) |
| \`demo/ui-data.lua\` | **reference demo**:\`ui-main.json\`  Lua mirror (generated by the exporter; hand edits are discarded) |
| \`demo/README.md\` | **reference demo**: agent-facing setup-run-verify guide |
| \`README.md\` | This guide |

## UI language notes

- Script **Lua 5.4**, UI library **\`urhox-libs/UI\`**
- Layout **Yoga** (Flexbox-like; defaults differ from CSS)
- Render **NanoVG** (vector; supports 9-patch / gradients / glow)
- Standard three steps: \`UI.Init\` -> build the widget tree -> **\`UI.SetRoot(root)\`**
- Scale: \`scale = UI.Scale.DEFAULT\` (1 base px ~ 1 CSS px)
- Safe area: put interactive content in \`UI.SafeAreaView\`, full-bleed background outside it
- Colors are \`{R,G,B,A}\` arrays; use Theme tokens for radius and spacing
- **Two-state feedback**: clickable controls (buttons, clickable icons) must have distinct normal / pressed appearances;
  theme.lua provides the \`primaryPressed\` pressed color and Button \`pressedBorderWidth\`/\`pressedPadding\`,
  atlas-skin pressed states bind via \`state_sprites.pressed\` in \`component-map.json\`

## Integration steps

1. Copy page/component PNGs into the Maker project \`assets/image\` or \`assets/sprites\` (keep semantic names).
2. For stretched skins, apply 9-patch using \`slice.margins\` from \`component-map.json\`.
3. **Bind two states**: per \`state_sprites\` of each component in \`component-map.json\`, bind
   \`<component-id>-default\` to normal and \`<component-id>-pressed\` to pressed; for clickable controls missing a pressed asset,
   go back to the component decomposition stage and add it first.
4. Copy fonts to \`assets/Fonts/\` and register them in \`fonts\` of \`UI.Init\`.
5. Place \`theme.lua\` at \`scripts/ui/theme.lua\` and pass it during Init.
6. Create screen modules at the \`lua_module\` paths from \`screens.json\`, choosing Widgets via \`component-map.json\`.
7. For official style packs, prefer the Maker-bundled ones:
   - \`DefaultTaptap\` - flat rounded shapes, teal primary
   - \`ui-astroon\` - cosmic cartoon / gradient glow
   - \`ui-brawlforge\` - sci-fi HUD / sharp edges
   - \`ui-pixelforge\` - retro pixel / hard-edged shadows

To preview results or verify handoff consistency, run \`demo/\` per the Agent quickstart above (details in \`demo/README.md\`);
every interaction logs a \`[kui-demo]\` line, a direct smoke test of screen assembly and event wiring.

## Reference demo (demo/)

\`demo/\` is the exporter-bundled **runnable reference implementation**: \`main.lua\` (fixed template) reads \`ui-data.lua\`
(the Lua mirror of \`ui-main.json\`) and assembles each screen by layout zones into a node tree,
\`UI.Button\` events and screen switches each log one \`[kui-demo]\` line. Uses:

- **Smoke test**: run it once to see whether the handoff JSON is self-consistent (region/margins/screen structure);
- **Reference implementation**: model real integration after the demo assembly to avoid guesswork.

## Scale

- Component mappings: ${n_comp}
- Screens: ${n_scr}
- Atlas texture: see \`texture\` in \`ui-main.json\`

## Boundaries

- \`demo/\` is a plugin-bundled **standalone reference implementation and smoke sample**, not your project files;
  for real integration, use this directory JSON manifests as the single source of truth; do not copy the demo structure as the target project architecture
- No full native Maker project is generated / does not replace \`maker_build_current_directory\`
- Business logic, networking, and saves must be wired in game scripts (every demo event only logs)
- Sits alongside the \`exports/web/\` preview pack, serving different delivery goals
`;
  writeText(file, body);
}

/* ----------------------------------- engine demos (godot/unity/cocos/...) - */

/** 4-int array from a JSON value; falls back per slot to `def`. */
function jsonArr4(v, def) {
  if (!Array.isArray(v)) return [def[0], def[1], def[2], def[3]];
  const g = (i) => intOf(v[i]) ?? def[i];
  return [g(0), g(1), g(2), g(3)];
}

function intsLit(v) {
  return `[${v.join(", ")}]`;
}

/** Atlas sprites of one component grouped by state; declared `states` keep their order first. */
function stateSpritesFor(id, sprites, states) {
  const byState = new Map();
  for (const sp of sprites) {
    if (sp.component_id !== id) continue;
    if (!byState.has(sp.state)) byState.set(sp.state, sp.name);
  }
  const out = [];
  const seen = new Set();
  for (const s of states) {
    if (byState.has(s)) {
      out.push([s, byState.get(s)]);
      seen.add(s);
    }
  }
  for (const s of [...byState.keys()].sort()) {
    if (!seen.has(s)) out.push([s, byState.get(s)]);
  }
  return out;
}

function buildDemoPack(atlas, components, screens, project_id) {
  const sprites = [];
  const atlasSprites = jget(atlas, "sprites");
  if (isObj(atlasSprites)) {
    for (const [name, item] of jentries(atlasSprites)) {
      const map = asMap(jsonToYaml(item)) ?? new Map();
      const m4 = margins(map);
      sprites.push({
        name,
        region: jsonArr4(jget(item, "region"), [0, 0, 0, 0]),
        margins: [m4[0], m4[1], m4[2], m4[3]],
        slice_type: sliceTypeOf(item),
        component_id: jstr(jget(item, "component_id")) ?? "",
        state: jstr(jget(item, "state")) ?? "default",
      });
    }
  }

  // components: component-contract wins; else derive from atlas component_ids.
  const comps = [];
  if (components) {
    const list = asSeq(mapGet(components, "components"));
    if (list) {
      for (const item of list) {
        const m = asMap(item);
        if (!m) continue;
        const id = strOf(mapGet(m, "id")) ?? "component";
        const statesSeq = asSeq(mapGet(m, "states"));
        const states = statesSeq ? statesSeq.filter((x) => typeof x === "string") : [];
        const targetSizeSeq = asSeq(mapGet(m, "target_size"));
        const target_size = targetSizeSeq
          ? targetSizeSeq.filter((x) => intOf(x) !== undefined).map((x) => intOf(x))
          : [];
        comps.push({
          state_sprites: stateSpritesFor(id, sprites, states),
          id,
          name: strOf(mapGet(m, "name")) ?? "",
          category: strOf(mapGet(m, "category")) ?? "container",
          states,
          target_size,
        });
      }
    }
  }
  if (comps.length === 0) {
    const grouped = new Map();
    for (const sp of sprites) {
      if (sp.component_id === "") continue;
      if (!grouped.has(sp.component_id)) grouped.set(sp.component_id, []);
      grouped.get(sp.component_id).push(sp);
    }
    for (const id of [...grouped.keys()].sort()) {
      const group = grouped.get(id);
      const states = group.map((s) => s.state);
      const category =
        id.includes("btn") || id.includes("button")
          ? "control"
          : id.includes("icon") || id.includes("badge")
            ? "icon"
            : "container";
      comps.push({
        state_sprites: stateSpritesFor(id, sprites, states),
        id,
        name: id,
        category,
        states,
        target_size: [],
      });
    }
  }

  // screens: screen-contract wins; else one synthetic screen listing every component.
  const screenList = [];
  if (screens) {
    const list = asSeq(mapGet(screens, "screens"));
    if (list) {
      for (const item of list) {
        const m = asMap(item);
        if (!m) continue;
        const id = strOf(mapGet(m, "id")) ?? "screen";
        const layoutIn = asMap(mapGet(m, "layout"));
        const layout = [];
        for (const zone of ["top", "center", "bottom", "floating"]) {
          const seq = layoutIn ? asSeq(mapGet(layoutIn, zone)) : undefined;
          const items = seq ? seq.filter((x) => typeof x === "string") : [];
          layout.push([zone, items]);
        }
        screenList.push({
          layout,
          id,
          name: strOf(mapGet(m, "name")) ?? strOf(mapGet(m, "title")) ?? "",
          purpose: strOf(mapGet(m, "purpose")) ?? "",
        });
      }
    }
  }
  if (screenList.length === 0) {
    screenList.push({
      id: "lobby",
      name: "Lobby",
      purpose: "",
      layout: [
        ["top", []],
        ["center", comps.map((c) => c.id)],
        ["bottom", []],
        ["floating", []],
      ],
    });
  }

  const sizeSeq = asSeq(jget(atlas, "size"));
  const atlas_size = sizeSeq ? sizeSeq.map((x) => intOf(x) ?? 0) : [];
  const texture = jstr(jget(atlas, "image")) ?? "";

  return {
    project_id,
    texture,
    atlas_size,
    sprites,
    components: comps,
    screens: screenList,
  };
}

function writeDemoGodot(dir, pack) {
  const files = [];
  mkdirp(dir);

  // demo/ui_data.gd - data mirror
  let s = "";
  s += "class_name KuiUIData\n";
  s += "## Generated by kaying-for-ui · godot export · demo/ui_data.gd\n";
  s += `## Project: ${pack.project_id}\n`;
  s += "## ui-main.json mirror for demo/main.gd: hand edits are invalid;\n";
  s += `## regenerate: kui export specs/${pack.project_id} --force\n\n`;
  s += `const PROJECT_ID := ${luaStrLit(pack.project_id)}\n`;
  s +=
    "# Atlas image path (res://): by convention, copy the atlas PNG into the target project res://assets/atlases/ui-main.png; adjust if different.\n";
  s += 'const TEXTURE := "res://assets/atlases/ui-main.png"\n\n';
  s += "const SPRITES := {\n";
  for (const sp of pack.sprites) {
    s += `\t${luaStrLit(sp.name)}: {\n\t\t"region": ${intsLit(sp.region)},\n\t\t"patch_margins": ${intsLit(sp.margins)},\n\t\t"slice_type": ${luaStrLit(sp.slice_type)},\n\t\t"component_id": ${luaStrLit(sp.component_id)},\n\t\t"state": ${luaStrLit(sp.state)},\n\t},\n`;
  }
  s += "}\n\n";
  s += "const COMPONENTS := [\n";
  for (const c of pack.components) {
    const states = c.states.map((x) => luaStrLit(x));
    const sprites = c.state_sprites.map(([st, n]) => `${luaStrLit(st)}: ${luaStrLit(n)}`);
    s += `\t{\n\t\t"id": ${luaStrLit(c.id)},\n\t\t"name": ${luaStrLit(c.name)},\n\t\t"category": ${luaStrLit(c.category)},\n\t\t"states": [${states.join(", ")}],\n\t\t"target_size": ${intsLit(c.target_size)},\n\t\t"state_sprites": {${sprites.join(", ")}},\n\t},\n`;
  }
  s += "]\n\n";
  s += "const SCREENS := [\n";
  for (const sc of pack.screens) {
    s += `\t{\n\t\t"id": ${luaStrLit(sc.id)},\n\t\t"name": ${luaStrLit(sc.name)},\n\t\t"purpose": ${luaStrLit(sc.purpose)},\n\t\t"layout": {\n`;
    for (const [zone, blocks] of sc.layout) {
      const items = blocks.map((b) => luaStrLit(b));
      s += `\t\t${luaStrLit(zone)}: [${items.join(", ")}],\n`;
    }
    s += "\t\t},\n\t},\n";
  }
  s += "]\n";
  const dataPath = path.join(dir, "ui_data.gd");
  writeText(dataPath, s);
  files.push(dataPath);

  // demo/main.gd - fixed template
  const mainPath = path.join(dir, "main.gd");
  const body = `extends Control
## Generated by kaying-for-ui · godot export · demo/main.gd
## Project: __PROJECT_ID__
##
## Reference demo (reference implementation): data-driven assembly of every screen from demo/ui_data.gd
## into a Control node tree; every event logs exactly one [kui-demo] line and contains no business logic.
##
## Usage (see README.md in this directory):
##   1) Copy this directory into the target Godot project res://demo/
##   2) Copy the atlas PNG to res://assets/atlases/ui-main.png (path set by TEXTURE in ui_data.gd)
##   3) Create a scene: root node = Control, attach this script, press F6 to run the current scene
## If project paths differ, only change the top constants in ui_data.gd; do not edit the demo assembly logic.

const Data = preload("res://demo/ui_data.gd")
const LOG_TAG := "kui-demo"

var _atlas: Texture2D
var _page: VBoxContainer

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_atlas = _load_atlas()
	var shell := MarginContainer.new()
	shell.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		shell.add_theme_constant_override(side, 24)
	add_child(shell)
	_page = VBoxContainer.new()
	_page.add_theme_constant_override("separation", 16)
	shell.add_child(_page)
	print("[%s] event=boot screens=%d" % [LOG_TAG, Data.SCREENS.size()])
	_show_screen(_first_screen_id())

func _load_atlas() -> Texture2D:
	if not ResourceLoader.exists(Data.TEXTURE):
		push_warning("[%s] atlas not found:%s(demo falls back to placeholders)" % [LOG_TAG, Data.TEXTURE])
		return null
	return load(Data.TEXTURE) as Texture2D

func _first_screen_id() -> String:
	if Data.SCREENS.is_empty():
		return "lobby"
	return str(Data.SCREENS[0].get("id", "lobby"))

func _find_screen(id: String) -> Dictionary:
	for s in Data.SCREENS:
		if str(s.get("id", "")) == id:
			return s
	return {}

func _find_component(id: String) -> Dictionary:
	for c in Data.COMPONENTS:
		if str(c.get("id", "")) == id:
			return c
	return {}

func _show_screen(id: String) -> void:
	for c in _page.get_children():
		_page.remove_child(c)
		c.queue_free()
	print("[%s] screen=%s event=enter" % [LOG_TAG, id])
	var screen := _find_screen(id)

	var title := Label.new()
	title.text = str(screen.get("name", id))
	title.add_theme_font_size_override("font_size", 28)
	_page.add_child(title)
	var purpose := str(screen.get("purpose", ""))
	if purpose != "":
		var sub := Label.new()
		sub.text = purpose
		sub.add_theme_font_size_override("font_size", 15)
		_page.add_child(sub)

	var layout: Dictionary = screen.get("layout", {})
	for zone in ["top", "center", "bottom"]:
		for block_id in layout.get(zone, []):
			_page.add_child(_build_block(id, str(block_id)))

	var floating: Array = layout.get("floating", [])
	if floating.size() > 0:
		var note := Label.new()
		note.text = "floating: " + ", ".join(PackedStringArray(floating))
		note.add_theme_font_size_override("font_size", 12)
		_page.add_child(note)

	_page.add_child(_build_nav(id))

func _build_block(screen_id: String, block_id: String) -> Control:
	var c := _find_component(block_id)
	if c.is_empty():
		# Layout block has no component contract: placeholder panel (structure present; the integrator replaces the skin)
		return _make_flat_panel("%s (no contract - placeholder)" % block_id, 72)
	var category := str(c.get("category", "container"))
	if category == "control":
		return _make_button(screen_id, c)
	if category == "icon" or category == "decoration" or category == "character":
		return _make_icon(c)
	return _make_panel(c)

func _make_button(screen_id: String, c: Dictionary) -> Control:
	var comp_id := str(c.get("id"))
	var btn := Button.new()
	var label := str(c.get("name", comp_id))
	btn.text = label if label != "" else comp_id
	btn.custom_minimum_size = Vector2(0, 56)
	var states: Dictionary = c.get("state_sprites", {})
	var normal := _stylebox_for(str(states.get("default", "")))
	var pressed := _stylebox_for(str(states.get("pressed", "")))
	if normal != null:
		btn.add_theme_stylebox_override("normal", normal)
		btn.add_theme_stylebox_override("hover", normal)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	if pressed != null:
		btn.add_theme_stylebox_override("pressed", pressed)
	elif normal != null:
		# Two-state fallback: atlas lacks a pressed sprite, so the normal skin is darkened; the two states must stay perceptible
		var dim := normal.duplicate() as StyleBoxTexture
		dim.modulate_color = Color(0.86, 0.86, 0.86, 1.0)
		btn.add_theme_stylebox_override("pressed", dim)
	btn.pressed.connect(_log_click.bind(screen_id, comp_id))
	return btn

func _log_click(screen_id: String, component_id: String) -> void:
	print("[%s] screen=%s event=click component=%s state=default" % [LOG_TAG, screen_id, component_id])

func _atlas_texture_for(sprite_name: String) -> AtlasTexture:
	var def: Dictionary = Data.SPRITES.get(sprite_name, {})
	if def.is_empty() or _atlas == null:
		return null
	var at := AtlasTexture.new()
	at.atlas = _atlas
	var region: Array = def.get("region", [0, 0, 0, 0])
	at.region = Rect2(region[0], region[1], region[2], region[3])
	return at

func _stylebox_for(sprite_name: String) -> StyleBoxTexture:
	var at := _atlas_texture_for(sprite_name)
	if at == null:
		return null
	var def: Dictionary = Data.SPRITES.get(sprite_name, {})
	var sb := StyleBoxTexture.new()
	sb.texture = at
	var m: Array = def.get("patch_margins", [0, 0, 0, 0])
	sb.texture_margin_left = m[0]
	sb.texture_margin_right = m[1]
	sb.texture_margin_top = m[2]
	sb.texture_margin_bottom = m[3]
	return sb

func _make_icon(c: Dictionary) -> Control:
	var comp_id := str(c.get("id"))
	var states: Dictionary = c.get("state_sprites", {})
	var at := _atlas_texture_for(str(states.get("default", "")))
	if at == null:
		return _make_flat_panel(comp_id, 64)
	var tr := TextureRect.new()
	tr.texture = at
	tr.custom_minimum_size = Vector2(64, 64)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	# ADAPT: clickable icons bind the states "pressed" sprite to the pressed state (Button/TextureButton).
	return tr

func _make_panel(c: Dictionary) -> Control:
	var comp_id := str(c.get("id"))
	var states: Dictionary = c.get("state_sprites", {})
	var panel := PanelContainer.new()
	var sb := _stylebox_for(str(states.get("default", "")))
	if sb == null:
		panel.add_theme_stylebox_override("panel", _flat_style())
	else:
		panel.add_theme_stylebox_override("panel", sb)
	var label := Label.new()
	label.text = "%s · %s" % [str(c.get("name", comp_id)), comp_id]
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.custom_minimum_size = Vector2(0, 72)
	panel.add_child(label)
	return panel

func _make_flat_panel(text: String, min_h: float) -> Control:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _flat_style())
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.custom_minimum_size = Vector2(0, min_h)
	panel.add_child(label)
	return panel

func _flat_style() -> StyleBoxFlat:
	var flat := StyleBoxFlat.new()
	flat.bg_color = Color(1, 1, 1, 0.08)
	flat.set_corner_radius_all(12)
	return flat

func _build_nav(current_id: String) -> Control:
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 12)
	for s in Data.SCREENS:
		var sid := str(s.get("id", ""))
		var sname := str(s.get("name", sid))
		var btn := Button.new()
		btn.text = ("● " if sid == current_id else "") + sname
		btn.pressed.connect(_navigate.bind(current_id, sid))
		row.add_child(btn)
	return row

func _navigate(from_id: String, to_id: String) -> void:
	if from_id == to_id:
		return
	print("[%s] event=navigate from=%s to=%s" % [LOG_TAG, from_id, to_id])
	_show_screen(to_id)
`;
  writeText(mainPath, body.replace(/__PROJECT_ID__/g, pack.project_id));
  files.push(mainPath);

  return files;
}

function writeDemoUnity(dir, pack) {
  const files = [];
  mkdirp(dir);

  // demo/KuiUIData.cs - data mirror
  let s = "";
  s += "// Generated by kaying-for-ui · unity export · demo/KuiUIData.cs\n";
  s += `// Project: ${pack.project_id}\n`;
  s += "// ui-main.json mirror for demo/KuiDemoBuilder.cs: hand edits are invalid;\n";
  s += `// regenerate: kui export specs/${pack.project_id} --force\n\n`;
  s += "using System.Collections.Generic;\n\n";
  s += "namespace Kui.Demo\n{\n";
  s += "    public static class KuiUIData\n    {\n";
  s += `        public const string ProjectId = ${luaStrLit(pack.project_id)};\n`;
  s += "        // Atlas image Resources path (no extension): copy the atlas PNG under any\n";
  s += "        // Resources/ folder, e.g. Assets/Resources/UI/Atlases/ui-main.png\n";
  s += '        public const string TextureResource = "UI/Atlases/ui-main";\n\n';
  s += "        public class SpriteDef\n        {\n";
  s += "            public string name;\n";
  s += "            public int[] rect;      // [x, y, w, h] atlas pixel rect (origin top-left)\n";
  s += "            public int[] border;    // [left, right, top, bottom] 9-slice margins (px)\n";
  s += "            public string componentId;\n";
  s += "            public string state;\n";
  s += "        }\n\n";
  s += "        public class ComponentDef\n        {\n";
  s += "            public string id;\n            public string name;\n";
  s += "            public string category;\n            public string[] states;\n";
  s += "            public int[] targetSize;\n";
  s += "            public Dictionary<string, string> stateSprites; // state -> sprite name\n";
  s += "        }\n\n";
  s += "        public class ScreenDef\n        {\n";
  s += "            public string id;\n            public string name;\n";
  s += "            public string purpose;\n";
  s += "            public Dictionary<string, string[]> layout; // top/center/bottom/floating -> block ids\n";
  s += "        }\n\n";
  s += "        public static readonly SpriteDef[] Sprites = new SpriteDef[]\n        {\n";
  for (const sp of pack.sprites) {
    s += `            new SpriteDef { name = ${luaStrLit(sp.name)}, rect = new[] {${sp.region.join(", ")}}, border = new[] {${sp.margins.join(", ")}}, componentId = ${luaStrLit(sp.component_id)}, state = ${luaStrLit(sp.state)} },\n`;
  }
  s += "        };\n\n";
  s += "        public static readonly ComponentDef[] Components = new ComponentDef[]\n        {\n";
  for (const c of pack.components) {
    const states = c.states.map((x) => luaStrLit(x));
    const sprites = c.state_sprites.map(([st, n]) => `{ ${luaStrLit(st)}, ${luaStrLit(n)} }`);
    s += `            new ComponentDef { id = ${luaStrLit(c.id)}, name = ${luaStrLit(c.name)}, category = ${luaStrLit(c.category)}, states = new[] {${states.join(", ")}}, targetSize = new[] {${c.target_size.join(", ")}}, stateSprites = new Dictionary<string, string> { ${sprites.join(", ")} } },\n`;
  }
  s += "        };\n\n";
  s += "        public static readonly ScreenDef[] Screens = new ScreenDef[]\n        {\n";
  for (const sc of pack.screens) {
    const zones = sc.layout.map(([zone, blocks]) => {
      const items = blocks.map((b) => luaStrLit(b));
      return `{ ${luaStrLit(zone)}, new[] {${items.join(", ")}} }`;
    });
    s += `            new ScreenDef { id = ${luaStrLit(sc.id)}, name = ${luaStrLit(sc.name)}, purpose = ${luaStrLit(sc.purpose)}, layout = new Dictionary<string, string[]> { ${zones.join(", ")} } },\n`;
  }
  s += "        };\n";
  s += "    }\n}\n";
  const dataPath = path.join(dir, "KuiUIData.cs");
  writeText(dataPath, s);
  files.push(dataPath);

  // demo/KuiDemoBuilder.cs - fixed template
  const mainPath = path.join(dir, "KuiDemoBuilder.cs");
  const body = `// Generated by kaying-for-ui · unity export · demo/KuiDemoBuilder.cs
// Project: __PROJECT_ID__
//
// Reference demo (reference implementation): data-driven assembly of every screen from demo/KuiUIData.cs
// into a UGUI node tree; every event logs exactly one [kui-demo] line and contains no business logic.
//
// Usage (see README.md in this directory):
//   1) Copy this directory into Assets/KuiDemo/ (any directory name works)
//   2) Copy the atlas PNG into any Resources/ directory, e.g. Assets/Resources/UI/Atlases/ui-main.png
//      (path set by KuiUIData.TextureResource)
//   3) Just press Play: RuntimeInitializeOnLoadMethod builds the Canvas automatically, zero scene setup
// If project paths differ, only change the KuiUIData.cs constants; do not edit the demo assembly logic.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Kui.Demo
{
    [DisallowMultipleComponent]
    public class KuiDemoBuilder : MonoBehaviour
    {
        const string LogTag = "[kui-demo]";
        const float Ppu = 100f;

        Texture2D _atlas;
        RectTransform _page;
        readonly Dictionary<string, Sprite> _cache = new Dictionary<string, Sprite>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            var go = new GameObject("KuiDemo");
            Object.DontDestroyOnLoad(go);
            go.AddComponent<KuiDemoBuilder>();
        }

        void Start()
        {
            _atlas = Resources.Load<Texture2D>(KuiUIData.TextureResource);
            if (_atlas == null)
            {
                Debug.Log(LogTag + " warn atlas-not-found path=" + KuiUIData.TextureResource +
                          " (place the atlas PNG under a Resources/ folder; demo falls back to placeholders)");
            }
            Debug.Log(LogTag + " event=boot screens=" + KuiUIData.Screens.Length);
            ShowScreen(KuiUIData.Screens[0].id);
        }

        void ShowScreen(string screenId)
        {
            if (_page == null)
            {
                EnsureEventSystem();
                var canvasGo = new GameObject("KuiDemoCanvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
                canvasGo.transform.SetParent(transform, false);
                var canvas = canvasGo.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                var scaler = canvasGo.GetComponent<CanvasScaler>();
                scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
                scaler.referenceResolution = new Vector2(1080f, 1920f);
                scaler.matchWidthOrHeight = 1f;
                _page = NewRect("Page", canvasGo.transform);
                Stretch(_page);
                var v = _page.gameObject.AddComponent<VerticalLayoutGroup>();
                v.childAlignment = TextAnchor.UpperLeft;
                v.childForceExpandWidth = true;
                v.childForceExpandHeight = false;
                v.spacing = 24f;
                v.padding = new RectOffset(48, 48, 96, 96);
            }
            else
            {
                for (int i = _page.childCount - 1; i >= 0; i--)
                    Destroy(_page.GetChild(i).gameObject);
            }

            var screen = System.Array.Find(KuiUIData.Screens, x => x.id == screenId) ?? KuiUIData.Screens[0];
            Debug.Log(LogTag + " screen=" + screen.id + " event=enter");

            AddText(_page, string.IsNullOrEmpty(screen.name) ? screen.id : screen.name, 44);
            if (!string.IsNullOrEmpty(screen.purpose))
                AddText(_page, screen.purpose, 26);

            foreach (var zone in new[] { "top", "center", "bottom" })
            {
                if (!screen.layout.TryGetValue(zone, out var blocks)) continue;
                foreach (var blockId in blocks)
                {
                    var node = BuildBlock(screen.id, blockId);
                    node.transform.SetParent(_page, false);
                }
            }
            if (screen.layout.TryGetValue("floating", out var floating) && floating.Length > 0)
                AddText(_page, "floating: " + string.Join(", ", floating), 20);

            Nav(screen.id).transform.SetParent(_page, false);
        }

        GameObject BuildBlock(string screenId, string blockId)
        {
            var c = System.Array.Find(KuiUIData.Components, x => x.id == blockId);
            if (c == null)
            {
                // Layout block has no component contract: placeholder panel (structure present; the integrator replaces the skin)
                return MakeFlatPanel(blockId + " (no contract - placeholder)", 96f);
            }
            switch (c.category)
            {
                case "control": return MakeButton(screenId, c);
                case "icon":
                case "decoration":
                case "character": return MakeIcon(c);
                default: return MakePanel(c);
            }
        }

        GameObject MakeButton(string screenId, KuiUIData.ComponentDef c)
        {
            var go = new GameObject(c.id, typeof(Image), typeof(Button), typeof(LayoutElement));
            var img = go.GetComponent<Image>();
            img.type = Image.Type.Sliced;
            img.sprite = SpriteFor(DefaultSprite(c));
            if (img.sprite == null)
                img.color = new Color(1f, 1f, 1f, 0.14f);
            go.GetComponent<LayoutElement>().minHeight = 96f;

            var btn = go.GetComponent<Button>();
            var colors = btn.colors;
            colors.pressedColor = new Color(0.86f, 0.86f, 0.86f, 1f); // Two-state fallback: darken normal by ~14%
            btn.colors = colors;
            var pressed = SpriteFor(PressedSprite(c));
            if (pressed != null)
            {
                var st = btn.spriteState;
                st.pressedSprite = pressed;
                st.highlightedSprite = SpriteFor(DefaultSprite(c));
                btn.spriteState = st;
                btn.transition = Selectable.Transition.SpriteSwap;
            }

            var label = string.IsNullOrEmpty(c.name) ? c.id : c.name;
            var t = AddText(go.transform, label, 32, TextAnchor.MiddleCenter);
            Stretch(t.rectTransform);

            var compId = c.id;
            var scr = screenId;
            btn.onClick.AddListener(() =>
                Debug.Log(LogTag + " screen=" + scr + " event=click component=" + compId + " state=default"));
            return go;
        }

        GameObject MakeIcon(KuiUIData.ComponentDef c)
        {
            var go = new GameObject(c.id, typeof(Image), typeof(LayoutElement));
            var img = go.GetComponent<Image>();
            img.sprite = SpriteFor(DefaultSprite(c));
            img.preserveAspect = true;
            var le = go.GetComponent<LayoutElement>();
            le.minWidth = 96f;
            le.minHeight = 96f;
            if (img.sprite == null)
            {
                img.color = new Color(1f, 1f, 1f, 0.14f);
                var t = AddText(go.transform, c.id, 22, TextAnchor.MiddleCenter);
                Stretch(t.rectTransform);
            }
            // ADAPT: for clickable icons, bind the stateSprites["pressed"] sprite to the pressed state (SpriteState or a script sprite swap).
            return go;
        }

        GameObject MakePanel(KuiUIData.ComponentDef c)
        {
            var go = new GameObject(c.id, typeof(Image), typeof(LayoutElement));
            var img = go.GetComponent<Image>();
            img.type = Image.Type.Sliced;
            img.sprite = SpriteFor(DefaultSprite(c));
            if (img.sprite == null)
                img.color = new Color(1f, 1f, 1f, 0.08f);
            go.GetComponent<LayoutElement>().minHeight = 128f;
            var label = (string.IsNullOrEmpty(c.name) ? c.id : c.name) + " · " + c.id;
            var t = AddText(go.transform, label, 26, TextAnchor.MiddleCenter);
            Stretch(t.rectTransform);
            return go;
        }

        GameObject MakeFlatPanel(string text, float minH)
        {
            var go = new GameObject("placeholder", typeof(Image), typeof(LayoutElement));
            go.GetComponent<Image>().color = new Color(1f, 1f, 1f, 0.08f);
            go.GetComponent<LayoutElement>().minHeight = minH;
            var t = AddText(go.transform, text, 24, TextAnchor.MiddleCenter);
            Stretch(t.rectTransform);
            return go;
        }

        GameObject Nav(string currentId)
        {
            var row = new GameObject("Nav", typeof(HorizontalLayoutGroup), typeof(LayoutElement));
            var h = row.GetComponent<HorizontalLayoutGroup>();
            h.childAlignment = TextAnchor.MiddleCenter;
            h.spacing = 24f;
            h.childForceExpandWidth = false;
            h.childForceExpandHeight = false;
            row.GetComponent<LayoutElement>().minHeight = 96f;

            var skin = NavSkin();
            foreach (var s in KuiUIData.Screens)
            {
                var sid = s.id;
                var go = new GameObject("nav-" + sid, typeof(Image), typeof(Button), typeof(LayoutElement));
                go.transform.SetParent(row.transform, false);
                var img = go.GetComponent<Image>();
                img.type = Image.Type.Sliced;
                go.GetComponent<LayoutElement>().preferredWidth = 320f;
                go.GetComponent<LayoutElement>().minHeight = 88f;
                var btn = go.GetComponent<Button>();
                if (skin != null)
                {
                    img.sprite = SpriteFor(DefaultSprite(skin));
                    var pressed = SpriteFor(PressedSprite(skin));
                    if (pressed != null)
                    {
                        var st = btn.spriteState;
                        st.pressedSprite = pressed;
                        btn.spriteState = st;
                        btn.transition = Selectable.Transition.SpriteSwap;
                    }
                }
                if (img.sprite == null)
                {
                    img.color = new Color(1f, 1f, 1f, sid == currentId ? 0.28f : 0.12f);
                    var colors = btn.colors;
                    colors.pressedColor = new Color(0.86f, 0.86f, 0.86f, 1f);
                    btn.colors = colors;
                }
                var label = (sid == currentId ? "● " : "") + (string.IsNullOrEmpty(s.name) ? sid : s.name);
                var t = AddText(go.transform, label, 28, TextAnchor.MiddleCenter);
                Stretch(t.rectTransform);
                btn.onClick.AddListener(() =>
                {
                    if (sid == currentId) return;
                    Debug.Log(LogTag + " event=navigate from=" + currentId + " to=" + sid);
                    ShowScreen(sid);
                });
            }
            return row;
        }

        KuiUIData.ComponentDef NavSkin()
        {
            foreach (var c in KuiUIData.Components)
                if (c.category == "control")
                    return c;
            return null;
        }

        static string DefaultSprite(KuiUIData.ComponentDef c) =>
            (c.stateSprites != null && c.stateSprites.TryGetValue("default", out var s)) ? s : null;

        static string PressedSprite(KuiUIData.ComponentDef c) =>
            (c.stateSprites != null && c.stateSprites.TryGetValue("pressed", out var s)) ? s : null;

        Sprite SpriteFor(string name)
        {
            if (string.IsNullOrEmpty(name) || _atlas == null) return null;
            if (_cache.TryGetValue(name, out var s)) return s;
            var def = System.Array.Find(KuiUIData.Sprites, x => x.name == name);
            if (def == null) return null;
            // kui border order [left, right, top, bottom] -> Sprite.Create border is Vector4(left, bottom, right, top)
            var border = new Vector4(def.border[0], def.border[2], def.border[1], def.border[3]);
            s = Sprite.Create(_atlas,
                new Rect(def.rect[0], def.rect[1], def.rect[2], def.rect[3]),
                new Vector2(0.5f, 0.5f), Ppu, 0, SpriteMeshType.FullRect, border);
            _cache[name] = s;
            return s;
        }

        static Text AddText(Transform parent, string content, int size, TextAnchor anchor = TextAnchor.UpperLeft)
        {
            var go = new GameObject("Label", typeof(Text));
            go.transform.SetParent(parent, false);
            var t = go.GetComponent<Text>();
            t.text = content;
            t.font = BuiltinFont();
            t.fontSize = size;
            t.alignment = anchor;
            t.color = Color.white;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.raycastTarget = false; // do not block clicks on the parent Button
            return t;
        }

        static Font BuiltinFont()
        {
            // ADAPT: Unity 2022.1+ built-in font is "LegacyRuntime.ttf"; older versions use "Arial.ttf".
            Font f = null;
            try { f = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); } catch { }
            if (f == null)
            {
                try { f = Resources.GetBuiltinResource<Font>("Arial.ttf"); } catch { }
            }
            return f;
        }

        static void EnsureEventSystem()
        {
            if (Object.FindObjectOfType<UnityEngine.EventSystems.EventSystem>() != null) return;
            new GameObject("EventSystem",
                typeof(UnityEngine.EventSystems.EventSystem),
                typeof(UnityEngine.EventSystems.StandaloneInputModule));
        }

        static RectTransform NewRect(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        static void Stretch(RectTransform rt)
        {
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }
    }
}
`;
  writeText(mainPath, body.replace(/__PROJECT_ID__/g, pack.project_id));
  files.push(mainPath);

  return files;
}

function writeDemoCocos(dir, pack) {
  const files = [];
  mkdirp(dir);

  // demo/ui-data.ts - data mirror
  let s = "";
  s += "// Generated by kaying-for-ui · cocos export · demo/ui-data.ts\n";
  s += `// Project: ${pack.project_id}\n`;
  s += "// ui-main.json mirror for demo/ui-demo.ts: hand edits are invalid;\n";
  s += `// regenerate: kui export specs/${pack.project_id} --force\n\n`;
  s +=
    "// Atlas Texture2D path under the resources/ directory: copy the atlas PNG to assets/resources/ui-main.png\n";
  s += "export const TEXTURE_PATH = 'ui-main/texture';\n\n";
  s += "export interface KuiSpriteDef {\n    name: string;\n";
  s += "    region: number[];   // [x, y, w, h] atlas pixel rect (origin top-left)\n";
  s += "    insets: number[];   // [left, right, top, bottom] 9-slice margins (px)\n";
  s += "    sliceType: string;\n    componentId: string;\n    state: string;\n}\n\n";
  s += "export interface KuiComponentDef {\n    id: string;\n    name: string;\n";
  s += "    category: string;\n    states: string[];\n    targetSize: number[];\n";
  s += "    stateSprites: Record<string, string>;\n}\n\n";
  s += "export interface KuiScreenDef {\n    id: string;\n    name: string;\n";
  s += "    purpose: string;\n    layout: Record<string, string[]>;\n}\n\n";
  const arr = (items) => `[${items.join(", ")}]`;
  const nums = (v) => `[${v.join(", ")}]`;
  s += "export const SPRITES: KuiSpriteDef[] = [\n";
  for (const sp of pack.sprites) {
    s += `    { name: ${luaStrLit(sp.name)}, region: ${nums(sp.region)}, insets: ${nums(sp.margins)}, sliceType: ${luaStrLit(sp.slice_type)}, componentId: ${luaStrLit(sp.component_id)}, state: ${luaStrLit(sp.state)} },\n`;
  }
  s += "];\n\n";
  s += "export const COMPONENTS: KuiComponentDef[] = [\n";
  for (const c of pack.components) {
    const states = c.states.map((x) => luaStrLit(x));
    const sprites = c.state_sprites.map(([st, n]) => `${luaStrLit(st)}: ${luaStrLit(n)}`);
    s += `    { id: ${luaStrLit(c.id)}, name: ${luaStrLit(c.name)}, category: ${luaStrLit(c.category)}, states: ${arr(states)}, targetSize: ${nums(c.target_size)}, stateSprites: { ${sprites.join(", ")} } },\n`;
  }
  s += "];\n\n";
  s += "export const SCREENS: KuiScreenDef[] = [\n";
  for (const sc of pack.screens) {
    const zones = sc.layout.map(([zone, blocks]) => {
      const items = blocks.map((b) => luaStrLit(b));
      return `${luaStrLit(zone)}: ${arr(items)}`;
    });
    s += `    { id: ${luaStrLit(sc.id)}, name: ${luaStrLit(sc.name)}, purpose: ${luaStrLit(sc.purpose)}, layout: { ${zones.join(", ")} } },\n`;
  }
  s += "];\n";
  const dataPath = path.join(dir, "ui-data.ts");
  writeText(dataPath, s);
  files.push(dataPath);

  // demo/ui-demo.ts - fixed template
  const mainPath = path.join(dir, "ui-demo.ts");
  const body = `// Generated by kaying-for-ui · cocos export · demo/ui-demo.ts
// Project: __PROJECT_ID__
//
// Reference demo (reference implementation): data-driven assembly of every screen from demo/ui-data.ts
// into a node tree; every event logs exactly one [kui-demo] line and contains no business logic.
//
// Usage (see README.md in this directory):
//   1) Copy this directory into the target Cocos Creator project assets/kui-demo/
//   2) Copy the atlas PNG into assets/resources/ (keep the ui-main.png name, matching TEXTURE_PATH in ui-data.ts)
//   3) Create a scene (with Canvas) -> create an empty node under Canvas -> attach KuiDemoBuilder -> browser preview
// If project paths differ, only change TEXTURE_PATH in ui-data.ts; do not edit the demo assembly logic.

import {
    Button, Color, Component, Graphics, Label, Layout, Node, Rect, Sprite,
    SpriteFrame, Texture2D, UITransform, Widget, resources, _decorator,
} from 'cc';
import {
    SPRITES, SCREENS, TEXTURE_PATH,
    type KuiComponentDef, type KuiScreenDef,
} from './ui-data';

const { ccclass } = _decorator;
const LOG_TAG = 'kui-demo';

@ccclass('KuiDemoBuilder')
export class KuiDemoBuilder extends Component {
    private _tex: Texture2D | null = null;
    private _frames = new Map<string, SpriteFrame>();
    private _page: Node | null = null;

    start() {
        resources.load(TEXTURE_PATH, Texture2D, (err, tex) => {
            if (err || !tex) {
                console.log(\`[\${LOG_TAG}] warn atlas-not-found path=\${TEXTURE_PATH} (put atlas PNG under assets/resources/; demo falls back to placeholders)\`);
            } else {
                this._tex = tex;
            }
            console.log(\`[\${LOG_TAG}] event=boot screens=\${SCREENS.length}\`);
            this.showScreen(SCREENS[0]?.id ?? 'lobby');
        });
    }

    showScreen(id: string) {
        const screen: KuiScreenDef = SCREENS.find(s => s.id === id) ?? SCREENS[0];
        if (this._page && this._page.isValid) {
            this._page.removeFromParent();
            this._page.destroy();
            this._page = null;
        }
        const page = this.ensurePage();
        console.log(\`[\${LOG_TAG}] screen=\${screen.id} event=enter\`);

        this.label(page, screen.name || screen.id, 44);
        if (screen.purpose) this.label(page, screen.purpose, 24);

        for (const zone of ['top', 'center', 'bottom'] as const) {
            for (const blockId of screen.layout[zone] ?? []) {
                page.addChild(this.buildBlock(screen.id, blockId));
            }
        }
        const floating = screen.layout.floating ?? [];
        if (floating.length > 0) {
            this.label(page, \`floating: \${floating.join(', ')}\`, 18);
        }
        page.addChild(this.nav(screen.id));
    }

    /** Fill the parent (Canvas); the page container uses a vertical Layout, top to bottom. */
    private ensurePage(): Node {
        if (this._page && this._page.isValid) return this._page;
        const selfUt = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        const selfWidget = this.node.getComponent(Widget) ?? this.node.addComponent(Widget);
        selfWidget.isAlignLeft = selfWidget.isAlignRight = true;
        selfWidget.isAlignTop = selfWidget.isAlignBottom = true;
        selfWidget.left = selfWidget.right = selfWidget.top = selfWidget.bottom = 0;
        selfWidget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

        const page = new Node('Page');
        const size = selfUt.contentSize;
        page.addComponent(UITransform).setContentSize(
            size.width || 1080, Math.max(size.height || 1920, 1280),
        );
        this.node.addChild(page);
        const layout = page.addComponent(Layout);
        layout.type = Layout.Type.VERTICAL;
        layout.resizeMode = Layout.ResizeMode.NONE;
        layout.verticalDirection = Layout.VerticalDirection.TOP_TO_BOTTOM;
        layout.horizontalDirection = Layout.HorizontalDirection.LEFT_TO_RIGHT;
        layout.paddingTop = 120;
        layout.paddingLeft = 180;
        layout.paddingRight = 180;
        layout.spacingY = 24;
        this._page = page;
        return page;
    }

    private buildBlock(screenId: string, blockId: string): Node {
        const c = COMPONENTS.find(x => x.id === blockId);
        if (!c) {
            // Layout block has no component contract: placeholder panel (structure present; the integrator replaces the skin)
            return this.flatPanel(\`\${blockId} (no contract - placeholder)\`, 96);
        }
        if (c.category === 'control') return this.button(screenId, c);
        if (c.category === 'icon' || c.category === 'decoration' || c.category === 'character') {
            return this.icon(c);
        }
        return this.panel(c);
    }

    private button(screenId: string, c: KuiComponentDef): Node {
        const n = new Node(c.id);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const def = this.spriteFor(c.stateSprites?.default);
        sp.spriteFrame = def ?? undefined;
        n.getComponent(UITransform)!.setContentSize(560, 96);
        const b = n.addComponent(Button);
        b.target = n;
        const pressed = this.spriteFor(c.stateSprites?.pressed);
        if (def && pressed) {
            // Two-state: atlas skin pressed state
            b.transition = Button.Transition.SPRITE_TRANSITION;
            b.normalSprite = def;
            b.pressedSprite = pressed;
        } else if (def) {
            // Two-state fallback: darken normal by ~14%; the two states must stay perceptible
            b.transition = Button.Transition.COLOR;
            b.normalColor = Color.WHITE;
            b.pressedColor = new Color(219, 219, 219, 255);
        } else {
            // Atlas missing: semi-transparent Graphics base + normal/pressed alpha difference
            this.panelBase(n, 560, 96, 36);
            b.transition = Button.Transition.COLOR;
        }
        n.on(Button.EventType.CLICK, () => {
            console.log(\`[\${LOG_TAG}] screen=\${screenId} event=click component=\${c.id} state=default\`);
        });
        this.centerLabel(n, c.name || c.id, 30);
        return n;
    }

    private icon(c: KuiComponentDef): Node {
        const n = new Node(c.id);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const sf = this.spriteFor(c.stateSprites?.default);
        sp.spriteFrame = sf ?? undefined;
        n.getComponent(UITransform)!.setContentSize(96, 96);
        if (!sf) {
            this.panelBase(n, 96, 96, 36);
            this.centerLabel(n, c.id, 22);
        }
        // ADAPT: for clickable icons, bind the stateSprites["pressed"] SpriteFrame to the pressed state.
        return n;
    }

    private panel(c: KuiComponentDef): Node {
        const n = new Node(c.id);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const sf = this.spriteFor(c.stateSprites?.default);
        sp.spriteFrame = sf ?? undefined;
        n.getComponent(UITransform)!.setContentSize(720, 128);
        if (!sf) this.panelBase(n, 720, 128, 20);
        this.centerLabel(n, \`\${c.name || c.id} · \${c.id}\`, 24);
        return n;
    }

    private flatPanel(text: string, minH: number): Node {
        const n = new Node('placeholder');
        n.addComponent(UITransform).setContentSize(720, minH);
        this.panelBase(n, 720, minH, 20);
        this.centerLabel(n, text, 22);
        return n;
    }

    /** Placeholder base when the atlas is missing: rounded semi-transparent Graphics (Sprite does not render without a spriteFrame). */
    private panelBase(n: Node, w: number, h: number, alpha: number) {
        n.removeComponent(Sprite);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 255, alpha);
        g.roundRect(-w / 2, -h / 2, w, h, 12);
        g.fill();
    }

    private nav(currentId: string): Node {
        const row = new Node('Nav');
        row.addComponent(UITransform).setContentSize(1080, 96);
        const layout = row.addComponent(Layout);
        layout.type = Layout.Type.HORIZONTAL;
        layout.spacingX = 24;
        layout.resizeMode = Layout.ResizeMode.NONE;
        layout.horizontalAlignment = Layout.HorizontalAlign.CENTER;
        for (const s of SCREENS) {
            const btnNode = new Node(\`nav-\${s.id}\`);
            btnNode.addComponent(UITransform).setContentSize(300, 88);
            this.panelBase(btnNode, 300, 88, s.id === currentId ? 72 : 30);
            const b = btnNode.addComponent(Button);
            b.target = btnNode;
            const sid = s.id;
            btnNode.on(Button.EventType.CLICK, () => {
                if (sid === currentId) return;
                console.log(\`[\${LOG_TAG}] event=navigate from=\${currentId} to=\${sid}\`);
                this.showScreen(sid);
            });
            this.centerLabel(btnNode, \`\${sid === currentId ? '● ' : ''}\${s.name || s.id}\`, 26);
            row.addChild(btnNode);
        }
        return row;
    }

    private label(parent: Node, text: string, size: number): Node {
        const n = new Node('Label');
        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        l.color = Color.WHITE;
        parent.addChild(n);
        return n;
    }

    private centerLabel(parent: Node, text: string, size: number): Node {
        const n = this.label(parent, text, size);
        const l = n.getComponent(Label)!;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;
        // Label already has a UITransform attached; only position it here
        const ut = n.getComponent(UITransform)!;
        ut.setAnchorPoint(0.5, 0.5);
        const put = parent.getComponent(UITransform)!;
        ut.setContentSize(put.width, put.height);
        n.setPosition(0, 0);
        return n;
    }

    private spriteFor(name: string | undefined): SpriteFrame | null {
        if (!name || !this._tex) return null;
        const hit = this._frames.get(name);
        if (hit) return hit;
        const def = SPRITES.find(x => x.name === name);
        if (!def) return null;
        const sf = new SpriteFrame();
        sf.texture = this._tex;
        sf.rect = new Rect(def.region[0], def.region[1], def.region[2], def.region[3]);
        // kui insets order [left, right, top, bottom] -> SpriteFrame inset*
        sf.insetLeft = def.insets[0];
        sf.insetRight = def.insets[1];
        sf.insetTop = def.insets[2];
        sf.insetBottom = def.insets[3];
        this._frames.set(name, sf);
        return sf;
    }
}
`;
  writeText(mainPath, body.replace(/__PROJECT_ID__/g, pack.project_id));
  files.push(mainPath);

  return files;
}

function writeDemoGeneric(dir, pack) {
  const files = [];
  mkdirp(dir);
  const relTexture = `../../${pack.texture}`;

  // demo/ui-data.js - data mirror
  let s = "";
  s += "// Generated by kaying-for-ui · generic export · demo/ui-data.js\n";
  s += `// Project: ${pack.project_id}\n`;
  s += "// ui-main.json mirror for demo/main.js: hand edits are invalid;\n";
  s += `// regenerate: kui export specs/${pack.project_id} --force\n\n`;
  s +=
    "// Atlas image path relative to this directory; rasterize to PNG if the target engine lacks SVG support.\n";
  s += `export const TEXTURE = ${luaStrLit(relTexture)};\n`;
  s += `export const ATLAS_SIZE = [${pack.atlas_size.join(", ")}];\n\n`;
  s += "export const SPRITES = [\n";
  for (const sp of pack.sprites) {
    s += `  { name: ${luaStrLit(sp.name)}, region: ${intsLit(sp.region)}, margins: ${intsLit(sp.margins)}, sliceType: ${luaStrLit(sp.slice_type)}, componentId: ${luaStrLit(sp.component_id)}, state: ${luaStrLit(sp.state)} },\n`;
  }
  s += "];\n\n";
  s += "export const COMPONENTS = [\n";
  for (const c of pack.components) {
    const states = c.states.map((x) => luaStrLit(x));
    const sprites = c.state_sprites.map(([st, n]) => `${luaStrLit(st)}: ${luaStrLit(n)}`);
    s += `  { id: ${luaStrLit(c.id)}, name: ${luaStrLit(c.name)}, category: ${luaStrLit(c.category)}, states: [${states.join(", ")}], targetSize: ${intsLit(c.target_size)}, stateSprites: { ${sprites.join(", ")} } },\n`;
  }
  s += "];\n\n";
  s += "export const SCREENS = [\n";
  for (const sc of pack.screens) {
    const zones = sc.layout.map(([zone, blocks]) => {
      const items = blocks.map((b) => luaStrLit(b));
      return `${luaStrLit(zone)}: [${items.join(", ")}]`;
    });
    s += `  { id: ${luaStrLit(sc.id)}, name: ${luaStrLit(sc.name)}, purpose: ${luaStrLit(sc.purpose)}, layout: { ${zones.join(", ")} } },\n`;
  }
  s += "];\n";
  const dataPath = path.join(dir, "ui-data.js");
  writeText(dataPath, s);
  files.push(dataPath);

  // demo/main.js - fixed template
  const mainPath = path.join(dir, "main.js");
  const body = `// Generated by kaying-for-ui · generic export · demo/main.js
// Project: __PROJECT_ID__
//
// Reference demo (reference implementation): on a 2D canvas, verify with demo/ui-data.js
// the data semantics of ui-main.json (region / 9-slice / two-state / screen structure);
// every event logs one [kui-demo] line. The mapping cheat sheet in README.md is the porting template for your engine.
//
// Run: start a static server at the project root (e.g. python -m http.server 8000) and open index.html in this directory.

import { ATLAS_SIZE, COMPONENTS, SCREENS, SPRITES, TEXTURE } from './ui-data.js';

const LOG_TAG = 'kui-demo';
const spriteByName = new Map(SPRITES.map(s => [s.name, s]));
const componentById = new Map(COMPONENTS.map(c => [c.id, c]));

const W = 1080, H = 1920;

export function uvRect(region, size) {
  const [x, y, w, h] = region;
  const [Wd, Hd] = size;
  // GL-convention UV (v flipped); UI engines with a top-left origin can use region directly.
  return { u0: x / Wd, v0: 1 - (y + h) / Hd, u1: (x + w) / Wd, v1: 1 - y / Hd };
}

export function drawNineSlice(ctx, img, sprite, dx, dy, dw, dh) {
  const [x, y, w, h] = sprite.region;
  const [l, r, t, b] = sprite.margins;
  if (!l && !r && !t && !b) {
    ctx.drawImage(img, x, y, w, h, dx, dy, dw, dh);
    return;
  }
  const cw = Math.max(0, w - l - r), ch = Math.max(0, h - t - b);
  const W2 = Math.max(0, dw - l - r), H2 = Math.max(0, dh - t - b);
  const patches = [
    [x, y, l, t, dx, dy, l, t],
    [x + l, y, cw, t, dx + l, dy, W2, t],
    [x + w - r, y, r, t, dx + dw - r, dy, r, t],
    [x, y + t, l, ch, dx, dy + t, l, H2],
    [x + l, y + t, cw, ch, dx + l, dy + t, W2, H2],
    [x + w - r, y + t, r, ch, dx + dw - r, dy + t, r, H2],
    [x, y + h - b, l, b, dx, dy + dh - b, l, b],
    [x + l, y + h - b, cw, b, dx + l, dy + dh - b, W2, b],
    [x + w - r, y + h - b, r, b, dx + dw - r, dy + dh - b, r, b],
  ];
  for (const [sx, sy, sw, sh, px, py, pw, ph] of patches) {
    if (sw <= 0 || sh <= 0 || pw <= 0 || ph <= 0) continue;
    ctx.drawImage(img, sx, sy, sw, sh, px, py, pw, ph);
  }
}

function log(line) { console.log(\`[\${LOG_TAG}] \${line}\`); }

function findScreen(id) {
  return SCREENS.find(s => s.id === id) ?? SCREENS[0] ?? { id: 'lobby', name: 'Lobby', purpose: '', layout: {} };
}

const ROW_H = { control: 110, icon: 110, panel: 150, placeholder: 100 };

export function boot(canvas) {
  const state = { img: null, screenId: SCREENS[0]?.id ?? 'lobby', pressed: null, hits: [] };
  canvas.width = W;
  canvas.height = H;
  log(\`event=boot screens=\${SCREENS.length}\`);
  const img = new Image();
  img.onload = () => {
    state.img = img;
    render(canvas, state);
  };
  img.onerror = () => {
    log(\`warn atlas-not-found path=\${TEXTURE} (demo falls back to placeholders; check TEXTURE in ui-data.js)\`);
    render(canvas, state);
  };
  img.src = TEXTURE;

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    for (const h of state.hits) {
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      if (h.kind === 'nav') {
        if (h.to === state.screenId) return;
        log(\`event=navigate from=\${state.screenId} to=\${h.to}\`);
        state.screenId = h.to;
        render(canvas, state);
        return;
      }
      state.pressed = h.key;
      log(\`screen=\${state.screenId} event=click component=\${h.component} state=default\`);
      render(canvas, state);
      return;
    }
  });
  const release = () => {
    if (state.pressed === null) return;
    state.pressed = null;
    render(canvas, state);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointerleave', release);
}

function render(canvas, state) {
  const ctx = canvas.getContext('2d');
  const screen = findScreen(state.screenId);
  state.hits = [];
  if (state.entered !== screen.id) {
    state.entered = screen.id;
    log(\`screen=\${screen.id} event=enter\`);
  }

  ctx.fillStyle = '#12121a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText(screen.name || screen.id, 48, 72);
  if (screen.purpose) {
    ctx.font = '26px sans-serif';
    ctx.fillStyle = '#b9b9c8';
    ctx.fillText(screen.purpose, 48, 136);
  }

  let y = 210;
  for (const zone of ['top', 'center', 'bottom']) {
    for (const blockId of screen.layout?.[zone] ?? []) {
      y = drawBlock(ctx, state, blockId, 48, y, W - 96) + 24;
    }
  }
  const floating = screen.layout?.floating ?? [];
  if (floating.length > 0) {
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#8f8fa3';
    ctx.fillText(\`floating: \${floating.join(', ')}\`, 48, y);
    y += 40;
  }

  // Bottom navigation
  const navY = H - 150;
  const btnW = 260, gap = 24;
  let nx = (W - (SCREENS.length * btnW + (SCREENS.length - 1) * gap)) / 2;
  ctx.font = '28px sans-serif';
  ctx.textBaseline = 'middle';
  for (const s of SCREENS) {
    const isCur = s.id === state.screenId;
    drawPanelBox(ctx, state, null, isCur ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)', nx, navY, btnW, 96);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(\`\${isCur ? '● ' : ''}\${s.name || s.id}\`, nx + btnW / 2, navY + 48);
    ctx.textAlign = 'left';
    state.hits.push({ x: nx, y: navY, w: btnW, h: 96, kind: 'nav', to: s.id });
    nx += btnW + gap;
  }
  ctx.textBaseline = 'top';
}

function drawBlock(ctx, state, blockId, x, y, w) {
  const c = componentById.get(blockId);
  if (!c) {
    // Layout block has no component contract: placeholder panel (structure present; the integrator replaces the skin)
    return drawFlat(ctx, \`\${blockId} (no contract - placeholder)\`, x, y, w, ROW_H.placeholder);
  }
  const h = ROW_H[c.category] ?? 128;
  if (c.category === 'control') {
    const pressedKey = \`\${state.screenId}:\${c.id}\`;
    const isPressed = state.pressed === pressedKey;
    const spriteName = c.stateSprites?.[isPressed ? 'pressed' : 'default'];
    const drawn = drawSkin(ctx, state, spriteName, x, y, w, h)
      || drawPanelBox(ctx, state, null, isPressed ? 'rgba(160,160,170,0.35)' : 'rgba(255,255,255,0.14)', x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '30px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(c.name || c.id, x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    state.hits.push({ x, y, w, h, kind: 'control', component: c.id, key: pressedKey });
    return y + h;
  }
  if (c.category === 'icon' || c.category === 'decoration' || c.category === 'character') {
    const size = 96;
    const spriteName = c.stateSprites?.default;
    const ok = drawSkin(ctx, state, spriteName, x, y, size, size);
    if (!ok) drawPanelBox(ctx, state, null, 'rgba(255,255,255,0.14)', x, y, size, size);
    state.hits.push({ x, y, w: size, h: size, kind: 'icon', component: c.id, key: \`\${state.screenId}:\${c.id}\` });
    return y + size;
  }
  const spriteName = c.stateSprites?.default;
  const ok = drawSkin(ctx, state, spriteName, x, y, w, h);
  if (!ok) drawPanelBox(ctx, state, null, 'rgba(255,255,255,0.08)', x, y, w, h);
  ctx.fillStyle = '#d9d9e4';
  ctx.font = '26px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(\`\${c.name || c.id} · \${c.id}\`, x + 24, y + h / 2);
  ctx.textBaseline = 'top';
  return y + h;
}

function drawSkin(ctx, state, spriteName, x, y, w, h) {
  if (!state.img || !spriteName) return false;
  const sp = spriteByName.get(spriteName);
  if (!sp) return false;
  drawNineSlice(ctx, state.img, sp, x, y, w, h);
  return true;
}

function drawPanelBox(ctx, state, _sprite, fill, x, y, w, h) {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  return true;
}

function drawFlat(ctx, text, x, y, w, h) {
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.fillStyle = '#8f8fa3';
  ctx.font = '24px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 20, y + h / 2);
  ctx.textBaseline = 'top';
  return y + h;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// For Node-side static checks:node --input-type=module -e "import('./demo/main.js')" does not run boot.
if (typeof document !== 'undefined') {
  const el = document.getElementById('kui-canvas');
  if (el) boot(el);
}
`;
  writeText(mainPath, body.replace(/__PROJECT_ID__/g, pack.project_id));
  files.push(mainPath);

  // demo/index.html - fixed template
  const htmlPath = path.join(dir, "index.html");
  const html = `<!doctype html>
<!-- Generated by kaying-for-ui · generic export · demo/index.html (fixed template) -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kui generic demo · __PROJECT_ID__</title>
<style>
  body { margin: 0; background: #101014; display: flex; justify-content: center; min-height: 100vh; }
  canvas { height: 100vh; max-width: 100vw; }
</style>
</head>
<body>
<canvas id="kui-canvas" width="1080" height="1920"></canvas>
<script type="module" src="./main.js"></script>
</body>
</html>
`;
  writeText(htmlPath, html.replace(/__PROJECT_ID__/g, pack.project_id));
  files.push(htmlPath);

  return files;
}

/** Dispatch per-engine demo writers; `engine` must already be one of the doc ids. */
function writeEngineDemo(dir, engine, pack) {
  switch (engine) {
    case "godot":
      return writeDemoGodot(dir, pack);
    case "unity":
      return writeDemoUnity(dir, pack);
    case "cocos":
      return writeDemoCocos(dir, pack);
    case "generic":
      return writeDemoGeneric(dir, pack);
    default:
      return [];
  }
}

/** Per-engine demo/README.md: copy table, run steps, acceptance, ADAPT points. */
function writeEngineDemoReadme(dir, engine, pack) {
  const n_comp = pack.components.length;
  const n_scr = pack.screens.length;
  const project = pack.project_id;
  let body;
  if (engine === "godot") body = `# demo · ${project} (reference implementation / smoke test - Godot 4)

This is the exporter-bundled **runnable reference demo**: it data-assembles the ${n_scr} screens from ui-main.json into an interactive
Control node tree (${n_comp} component mappings take part in assembly); every event logs exactly one line (prefix \`[kui-demo]\`) and contains no business logic.

## Files

| File | Purpose |
|---|---|
| \`main.gd\` | generic assembler - **fixed template**, identical for every project and independent of the exported content |
| \`ui_data.gd\` | \`ui-main.json\`  GDScript mirror (generated by the exporter; hand edits are discarded) |

## Agent quickstart (setup -> run -> verify)

Goal: after reading this section the Agent can **independently** run the demo; the whole process is **copy + create a scene**, with no edits to generated files.
Prerequisite: a Godot 4.x project is available locally (an empty new project is fine).

1. **Copy files** (source -> target inside the Godot project; relative paths must match):

   | Source | Target |
   |---|---|
   | \`main.gd\`,\`ui_data.gd\` | \`res://demo/\` |
   | Project atlas PNG(i.e. \`specs/<project-id>/assets/atlases/ui-main.png\`) | \`res://assets/atlases/ui-main.png\` (if missing, the demo falls back to placeholders and logs) |

2. **Create scene**: Scene -> New Scene -> choose **Control** as root -> attach \`res://demo/main.gd\` to the root -> save (e.g. \`res://demo/demo.tscn\`).
3. **Run**: press **F6** (run current scene).
4. **Verify (assertable)**:
   - The Output panel shows \`[kui-demo] event=boot screens=${n_scr}\`;
   - The UI shows a screen title and bottom navigation; tap to switch between ${n_scr} screens;
   - each enter/click/switch logs one \`[kui-demo]\` line (format below).
5. **After the preview**: the demo only verifies assembly and event wiring; for real integration use the parent \`ui-main.json\` as the single source of truth,
   and port the demo assembly to production scenes per the mapping cheat sheet.

## Log format (grep-ready / assertable)

\`\`\`text
[kui-demo] event=boot screens=${n_scr}
[kui-demo] screen=lobby event=enter
[kui-demo] screen=lobby event=click component=btn-primary state=default
[kui-demo] event=navigate from=lobby to=shop
\`\`\`

## Coverage / ADAPT points

- **Covered**: screen structure (layout top/center/bottom/floating zones), button click events,
  AtlasTexture cropping, StyleBoxTexture 9-patch, screen-switch navigation, placeholder for contract-less layout blocks.
- **Two-state (normal / pressed)**: the button binds the \`state_sprites.pressed\` sprite to the \`pressed\` stylebox;
  If the atlas lacks a pressed sprite, fall back to darkening the normal skin (modulate 0.86); the two states stay perceptible.
- **ADAPT (for your project)**: Godot 3 compatibility (\`texture_margin_*\` is \`margin_*\` in Godot 3);
  atlas path constant \`TEXTURE\`; override widget sizes/fonts per project standards (\`add_theme_*_override\`).

## Boundaries

- The demo is a **reference implementation and smoke test**, not your project files; for real integration use \`ui-main.json\` as the source of truth.
- The demo has no business logic: every event only logs; no native assets beyond the \`.tscn\` template are generated.
`;
  else if (engine === "unity") body = `# demo · ${project} (reference implementation / smoke test - Unity UGUI)

This is the exporter-bundled **runnable reference demo**: it data-assembles the ${n_scr} screens from ui-main.json into an interactive
UGUI node tree (${n_comp} component mappings take part in assembly); every event logs exactly one line (prefix \`[kui-demo]\`) and contains no business logic.

## Files

| File | Purpose |
|---|---|
| \`KuiDemoBuilder.cs\` | generic assembler - **fixed template**, identical for every project and independent of the exported content |
| \`KuiUIData.cs\` | \`ui-main.json\`  C# mirror (generated by the exporter; hand edits are discarded) |

## Agent quickstart (setup -> run -> verify)

Goal: after reading this section the Agent can **independently** run the demo; the whole process is **copy + press Play**, with no edits to generated files.
Prerequisite: a Unity project is available locally (built-in render pipeline + UGUI, 2019.4+).

1. **Copy files** (source -> target inside the Unity project; relative paths must match):

   | Source | Target |
   |---|---|
   | \`KuiDemoBuilder.cs\`,\`KuiUIData.cs\` | \`Assets/KuiDemo/\` (any directory name works) |
   | Project atlas PNG(i.e. \`specs/<project-id>/assets/atlases/ui-main.png\`) | \`Assets/Resources/UI/Atlases/ui-main.png\` (if missing, the demo falls back to placeholders and logs) |

2. **Run**: just press **Play**. \`RuntimeInitializeOnLoadMethod\` builds Canvas + EventSystem automatically, zero scene setup.
3. **Verify (assertable)**:
   - The Console shows \`[kui-demo] event=boot screens=${n_scr}\`;
   - The Game view shows a screen title and bottom navigation; tap to switch between ${n_scr} screens;
   - each enter/click/switch logs one \`[kui-demo]\` line (format below).
4. **After the preview**: the demo only verifies assembly and event wiring; for real integration use the parent \`ui-main.json\` as the single source of truth,
   and build Sprite sub-assets into TextureImporter per the mapping cheat sheet (see the parent README auto-integration steps).

## Log format (grep-ready / assertable)

\`\`\`text
[kui-demo] event=boot screens=${n_scr}
[kui-demo] screen=lobby event=enter
[kui-demo] screen=lobby event=click component=btn-primary state=default
[kui-demo] event=navigate from=lobby to=shop
\`\`\`

## Coverage / ADAPT points

- **Covered**: screen structure (layout top/center/bottom/floating zones), button click events,
  \`Sprite.Create\` runtime cropping + Sliced 9-patch, \`SpriteState\` pressed sprite swap, screen-switch navigation, placeholder for contract-less layout blocks.
- **Two-state (normal / pressed)**: the button binds \`stateSprites.pressed\` to \`SpriteState.pressedSprite\`;
  If the atlas lacks a pressed sprite, fall back to \`colors.pressedColor\` darkening (0.86); the two states stay perceptible.
- **ADAPT (for your project)**: built-in font name (\`LegacyRuntime.ttf\` on 2022.1+, \`Arial.ttf\` on older);
  \`Text\` -> TextMeshProUGUI; adjust the CanvasScaler reference resolution per project standards; the Vector4 border order is
  (left, bottom, right, top), while kui JSON is [left, right, top, bottom] (the demo reorders it).

## Boundaries

- The demo is a **reference implementation and smoke test**, not your project files; for real integration use \`ui-main.json\` as the source of truth.
- The demo has no business logic: every event only logs; no Prefab / SpriteAtlas / \`.meta\` asset entries are generated.
`;
  else if (engine === "cocos") body = `# demo · ${project} (reference implementation / smoke test - Cocos Creator 3.x)

This is the exporter-bundled **runnable reference demo**: it data-assembles the ${n_scr} screens from ui-main.json into an interactive
node tree (${n_comp} component mappings take part in assembly); every event logs exactly one line (prefix \`[kui-demo]\`) and contains no business logic.

## Files

| File | Purpose |
|---|---|
| \`ui-demo.ts\` | generic assembler - **fixed template**, identical for every project and independent of the exported content |
| \`ui-data.ts\` | \`ui-main.json\`  TypeScript mirror (generated by the exporter; hand edits are discarded) |

## Agent quickstart (setup -> run -> verify)

Goal: after reading this section the Agent can **independently** run the demo; the whole process is **copy + attach a component**, with no edits to generated files.
Prerequisite: a Cocos Creator 3.x project is available locally (the 2D template is fine).

1. **Copy files** (source -> target inside the Cocos project; relative paths must match):

   | Source | Target |
   |---|---|
   | \`ui-demo.ts\`,\`ui-data.ts\` | \`assets/kui-demo/\` |
   | Project atlas PNG(i.e. \`specs/<project-id>/assets/atlases/ui-main.png\`) | \`assets/resources/ui-main.png\` (if missing, the demo falls back to placeholders and logs) |

2. **Create scene**: create a scene (with Canvas, design resolution 1080x1920 portrait recommended) -> create an empty node under Canvas
   -> add the \`KuiDemoBuilder\` component -> save the scene (the demo fills the Canvas and uses a vertical Layout).
3. **Run**: **Preview (browser)** in the editor toolbar.
4. **Verify (assertable)**:
   - The browser Console shows \`[kui-demo] event=boot screens=${n_scr}\`;
   - The page shows a screen title and bottom navigation; tap to switch between ${n_scr} screens;
   - each enter/click/switch logs one \`[kui-demo]\` line (format below).
5. **After the preview**: the demo only verifies assembly and event wiring; for real integration use the parent \`ui-main.json\` as the single source of truth,
   and build SpriteFrames per the mapping cheat sheet (or switch to Auto Atlas).

## Log format (grep-ready / assertable)

\`\`\`text
[kui-demo] event=boot screens=${n_scr}
[kui-demo] screen=lobby event=enter
[kui-demo] screen=lobby event=click component=btn-primary state=default
[kui-demo] event=navigate from=lobby to=shop
\`\`\`

## Coverage / ADAPT points

- **Covered**: screen structure (layout top/center/bottom/floating zones), button click events,
  runtime SpriteFrame (rect + inset 9-slice), Button two-state switching, screen-switch navigation, placeholder for contract-less layout blocks.
- **Two-state (normal / pressed)**: the button binds \`stateSprites.pressed\` to \`Button.pressedSprite\` (SPRITE_TRANSITION);
  If the atlas lacks a pressed sprite, fall back to \`pressedColor\` darkening; the two states stay perceptible.
- **ADAPT (for your project)**: atlas Resource path (\`TEXTURE_PATH\` in \`ui-data.ts\`);
  If the project uses Auto Atlas / atlas merging, reference SpriteFrames by name instead; override widget sizes/Label styles per project standards.

## Boundaries

- The demo is a **reference implementation and smoke test**, not your project files; for real integration use \`ui-main.json\` as the source of truth.
- The demo has no business logic: every event only logs; no \`.prefab\` / \`.scene\` / \`.meta\` are generated.
`;
  else if (engine === "generic") body = `# demo · ${project} (reference implementation / smoke test - generic canvas)

This is the exporter-bundled **runnable reference demo**: on a 2D canvas it verifies all \`ui-main.json\` semantics -
region cropping, 9-slice stretching, two-state switching, screen structure (${n_scr} screens / ${n_comp} component mappings).
Every event logs exactly one line (prefix \`[kui-demo]\`). \`main.js\` is a **fixed template**, usable as a reference before porting the mapping table to
any engine/framework.

## Files

| File | Purpose |
|---|---|
| \`main.js\` | generic assembler - **fixed template**: UV math, 9-slice drawing, screen switching |
| \`ui-data.js\` | \`ui-main.json\`  JS mirror (generated by the exporter; hand edits are discarded) |
| \`index.html\` | minimal host page that loads \`main.js\` |

## Agent quickstart (setup -> run -> verify)

Goal: after reading this section the Agent can **independently** run the demo; the whole process is **start a server + open a page**, with no edits to generated files.
Prerequisite: any static file server (python / npx serve both work). ES modules cannot be opened directly via \`file://\`.

1. **Start server**: run \`python -m http.server 8000\` (or \`npx serve\`) at the handoff project root.
2. **Open**: visit \`exports/generic/demo/index.html\` in a browser.
3. **Verify (assertable)**:
   - The browser Console shows \`[kui-demo] event=boot screens=${n_scr}\` (an extra line appears when the atlas is missing,
     \`[kui-demo] warn atlas-not-found ...\`, and the page falls back to placeholders);
   - The page shows a screen title and bottom navigation; tap to switch between ${n_scr} screens;
   - each enter/click/switch logs one \`[kui-demo]\` line (format below).
4. **After the preview**: the demo proves the data is self-consistent; port \`uvRect\` / \`drawNineSlice\` /
   and the two-state sprite-swap logic from \`main.js\` to the target engine (see the mapping cheat sheet in the parent README).

## Log format (grep-ready / assertable)

\`\`\`text
[kui-demo] event=boot screens=${n_scr}
[kui-demo] screen=lobby event=enter
[kui-demo] screen=lobby event=click component=btn-primary state=default
[kui-demo] event=navigate from=lobby to=shop
\`\`\`

## Coverage / ADAPT points

- **Covered**: \`region\` -> crop rect (\`uvRect\` also provides a GL-convention UV reference),
  \`margins\` -> 9-patch (\`drawNineSlice\`), two-state (pressed sprite swap), screen navigation, placeholder panels.
- **Two-state (normal / pressed)**: control blocks redraw with the \`stateSprites.pressed\` sprite on press;
  If the atlas lacks a pressed sprite, fall back to a darker fill; the two states stay perceptible.
- **ADAPT (for your engine)**: replace \`uvRect\`/\`drawNineSlice\` with the engine UV/9-slice API;
  \`TEXTURE\` (\`ui-data.js\`) points to a bitmap the engine can load (rasterize SVG first); layout values are illustrative, re-lay out with the target engine layout system.

## Boundaries

- The demo is a **reference implementation and smoke test**, engine-agnostic; for real integration use \`ui-main.json\` as the source of truth.
- The demo has no business logic: every event only logs.
`;
  else return;
  writeText(path.join(dir, "README.md"), body);
}

/* --------------------------------------------------------------- command ---- */

function exporterFor(engine) {
  switch (engine) {
    case "godot":
      return exportGodot;
    case "unity":
      return exportUnity;
    case "cocos":
      return exportCocos;
    case "generic":
      return exportGeneric;
    // taptap-maker needs contracts; handled in run() via exportTaptapMaker
    default:
      return null;
  }
}

function isTaptapEngine(engine) {
  return ["taptap-maker", "taptapmaker", "taptap_maker", "urhox"].includes(engine);
}

function tryLoadMap(p) {
  try {
    return loadYamlMap(p);
  } catch {
    return null;
  }
}

export function run(args) {
  const projectArg = args.pos(0);
  if (!projectArg) {
    err("usage: kui export <project> [--atlas-contract F] [--export-contract F] [--root DIR] [--force]");
  }
  let project;
  try {
    project = fs.realpathSync(path.resolve(projectArg));
  } catch (e) {
    err(`${projectArg}: ${ioErrorText(e)}`);
  }
  const atlasContract =
    args.opt("atlas-contract") ?? path.join(project, "contracts", "atlas-contract.yaml");
  const exportContract =
    args.opt("export-contract") ?? path.join(project, "contracts", "export-contract.yaml");
  const force = args.flag("force");
  // Optional: templates/exports/<engine>/README.md (fallback text if root missing).
  let pluginRoot = null;
  try {
    pluginRoot = findRoot(args.opt("root"));
  } catch {
    pluginRoot = null;
  }

  const atlasC = loadYamlMap(atlasContract);
  const exportC = loadYamlMap(exportContract);

  const atlasOutput = asMap(mapGet(atlasC, "output"));
  if (!atlasOutput) err("atlas contract requires output mapping");
  const dataRel = strOf(mapGet(atlasOutput, "data_path")) ?? "";
  const atlasDataPath = path.join(project, dataRel);
  const atlasText = readText(atlasDataPath);
  let atlas;
  try {
    atlas = JSON.parse(atlasText);
  } catch (e) {
    err(e.message);
  }
  spritesMap(atlas);

  // Optional contracts for richer handoffs (taptap-maker).
  const styleC = tryLoadMap(path.join(project, "contracts", "style-contract.yaml"));
  const componentC = tryLoadMap(path.join(project, "contracts", "component-contract.yaml"));
  const screenC = tryLoadMap(path.join(project, "contracts", "screen-contract.yaml"));

  const targets = asSeq(mapGet(exportC, "targets"));
  if (!targets) err("export contract requires targets list");

  const project_id = path.basename(project) || "project";

  // Shared data for engine demos (godot/unity/cocos/generic): atlas + contracts, once per project.
  const demoPack = buildDemoPack(atlas, componentC, screenC, project_id);

  const written = [];
  for (const target of targets) {
    const t = asMap(target);
    if (!t) err("every export target must be a mapping");
    const engine = strOf(mapGet(t, "engine")) ?? "";
    if (boolOf(mapGet(t, "native_project_files")) === true) {
      err(`${engine}: built-in exporter only writes JSON handoff manifests`);
    }
    const pathValue = strOf(mapGet(t, "manifest_path"));
    if (pathValue === undefined) err(`${engine}: manifest_path is required`);
    const outPath = path.join(project, pathValue);
    if (exists(outPath) && !force) {
      err(`output already exists: ${outPath}; use --force`);
    }
    mkdirp(path.dirname(outPath));

    let body;
    if (isTaptapEngine(engine)) {
      const made = exportTaptapMaker(atlas, styleC, componentC, screenC);
      body = made.body;
      const pack = made.pack;
      // Companion pack files next to the manifest.
      const dir = path.dirname(outPath);
      writeThemeLua(path.join(dir, "theme.lua"), pack);
      writeComponentMapJson(path.join(dir, "component-map.json"), pack);
      writeScreensJson(path.join(dir, "screens.json"), pack);
      writeTaptapReadme(path.join(dir, "README.md"), project_id, pack);
      const demoDir = path.join(dir, "demo");
      writeDemoMain(path.join(demoDir, "main.lua"), project_id);
      writeDemoUiData(path.join(demoDir, "ui-data.lua"), project_id, pack);
      writeDemoReadme(path.join(demoDir, "README.md"), project_id, pack);
      written.push(path.join(dir, "theme.lua"));
      written.push(path.join(dir, "component-map.json"));
      written.push(path.join(dir, "screens.json"));
      written.push(path.join(dir, "README.md"));
      written.push(path.join(demoDir, "main.lua"));
      written.push(path.join(demoDir, "ui-data.lua"));
      written.push(path.join(demoDir, "README.md"));
    } else {
      const exportFn = exporterFor(engine);
      if (!exportFn) err(`unsupported engine: ${JSON.stringify(engine)}`);
      // Agent-facing apply guide + runnable reference demo beside every engine manifest.
      const dir = path.dirname(outPath);
      const engineIdForDoc = engine;
      writeEngineReadme(path.join(dir, "README.md"), engineIdForDoc, project_id, pluginRoot, demoPack);
      written.push(path.join(dir, "README.md"));
      for (const f of writeEngineDemo(path.join(dir, "demo"), engineIdForDoc, demoPack)) {
        written.push(f);
      }
      writeEngineDemoReadme(path.join(dir, "demo"), engineIdForDoc, demoPack);
      written.push(path.join(dir, "demo", "README.md"));
      body = exportFn(atlas);
    }

    // Normalize engine id in payload for validate matching.
    const engineId = isTaptapEngine(engine) ? "taptap-maker" : engine;
    const payload = {
      schema_version: 1,
      engine: engineId,
      atlas_id: jget(atlas, "atlas_id") ?? null,
      atlas_size: jget(atlas, "size") ?? null,
    };
    if (isObj(body)) {
      for (const k of Object.keys(body)) payload[k] = body[k];
    }
    const text = `${jsonPretty(payload)}\n`;
    writeText(outPath, text);
    written.push(outPath);
  }

  mapSet(exportC, "status", "generated");
  writeYaml(exportContract, exportC);

  const o = Outcome.ok("export", `exported ${written.length} manifest(s)`)
    .withProject(project)
    .fact("manifest_count", written.length)
    .withNext(Next.none());
  for (const p of written) o.artifact(p);
  if (written.length === 0) {
    o.pushWarn(
      new Problem(
        "W_NO_EXPORT",
        "export contract targets produced no files",
        "check export-contract.yaml targets[].manifest_path and engine names",
      ),
    );
  }
  return o.finalize();
}
