/**
 * web — generate the standard Web handoff pack for a UI project.
 *
 * Port of cli/src/web.rs. Outputs (templates/web/ + contracts):
 *   exports/web/manifest.json
 *   exports/web/tokens.css
 *   exports/web/README.md
 *   result.html          interactive phone-shell preview
 *   index.html           asset catalog + project structure
 *
 * JSON is emitted the way serde_json::to_string_pretty does it: 2-space indent
 * and object keys in BTreeMap order (sorted by UTF-8 bytes, recursively).
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  err,
  exists,
  findRoot,
  intOf,
  isDir,
  isFile,
  loadYamlMap,
  mapGet,
  mkdirp,
  readText,
  strOf,
  writeText,
  yamlToJson,
} from "./util.mjs";
import { Next, Outcome, Problem } from "./report.mjs";

/* ------------------------------------------------------------- helpers ---- */

/** Rust `Path::join`: absolute replaces the base, relative is appended verbatim. */
function joinPath(base, rel) {
  if (path.isAbsolute(rel)) return rel;
  if (base.endsWith(path.sep)) return `${base}${rel}`;
  return `${base}${path.sep}${rel}`;
}

/** Literal (non-pattern) replace-all — `String#replaceAll` would expand `$&`. */
function replaceAllLiteral(haystack, needle, value) {
  if (needle === "") return haystack;
  return haystack.split(needle).join(value);
}

function htmlEscapeAttr(s) {
  return replaceAllLiteral(
    replaceAllLiteral(replaceAllLiteral(s, "&", "&amp;"), '"', "&quot;"),
    "<",
    "&lt;",
  );
}

function mapStr(m, key) {
  return strOf(mapGet(m, key));
}

function colorStr(v) {
  const s = strOf(v);
  return s !== undefined && (s.startsWith("#") || s.startsWith("rgb")) ? s : "#888888";
}

/** Rust `str::trim_end_matches` — removes every trailing occurrence. */
function trimEndMatches(s, pat) {
  let out = s;
  while (out.endsWith(pat)) out = out.slice(0, out.length - pat.length);
  return out;
}

/** Rust `str::to_ascii_uppercase` (ASCII only, unlike toUpperCase). */
function asciiUpper(s) {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase());
}

function readDirOrNull(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

function readTextOrNull(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function parseJsonOrNull(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** BTreeMap<String> ordering is UTF-8 byte order. */
function compareKeys(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** serde_json::to_string_pretty, with keys sorted at every level. */
function jsonPretty(value, indent = "") {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  const pad = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad}${jsonPretty(v, pad)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const keys = Object.keys(value).sort(compareKeys);
  if (keys.length === 0) return "{}";
  const items = keys.map((k) => `${pad}${JSON.stringify(k)}: ${jsonPretty(value[k], pad)}`);
  return `{\n${items.join(",\n")}\n${indent}}`;
}

/* -------------------------------------------------------------- stage ------ */

function findRootTemplates(root) {
  const p = joinPath(joinPath(root, "templates"), "web");
  if (isFile(joinPath(p, "result.html")) && isFile(joinPath(p, "index.html"))) return p;
  return err(`templates/web not found under ${root}; reinstall plugin or pass --root`);
}

function renderTemplate(raw, vars) {
  let out = raw;
  for (const [k, v] of vars) out = replaceAllLiteral(out, `{{${k}}}`, v);
  return out;
}

function defaultStructureTree(projectId) {
  return `${projectId}/
├─ index.html              ← 物料与结构总览
├─ result.html             ← 可交互 Web 预览壳
├─ spec.md · research.md · plan.md · tasks.md · quickstart.md
├─ gdd.md · prd.md · interaction.md
├─ contracts/              视觉与交付契约
│  ├─ style-contract.yaml
│  ├─ screen-contract.yaml
│  ├─ component-contract.yaml
│  ├─ asset-manifest.yaml
│  ├─ sprite-contract.yaml
│  ├─ atlas-contract.yaml
│  └─ export-contract.yaml
├─ assets/
│  ├─ pages/ · components/ · sprites/ · atlases/
├─ prompts/ · mappings/ · packages/ · review/
└─ exports/
   ├─ web/     manifest.json + tokens.css
   ├─ taptap-maker/  ui-main.json + theme.lua + component-map.json
   ├─ godot/ · unity/ · cocos/ · generic/`;
}

const IMAGE_SUFFIXES = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

function listImages(dir, prefix) {
  const rd = readDirOrNull(dir);
  if (!rd) return [];
  const names = [];
  for (const e of rd) {
    const f = e.name;
    const lower = f.toLowerCase();
    if (IMAGE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) names.push(f);
  }
  names.sort();
  return names.map((n) => ({ name: n, path: `${prefix}${n}` }));
}

function exportNote(engine, name) {
  if (engine === "web") {
    if (name === "manifest.json") return "Web 清单";
    if (name === "tokens.css") return "设计令牌";
    if (name === "README.md") return "交付说明";
    return "";
  }
  if (engine === "godot") return "Atlas region + patch_margins";
  if (engine === "unity") return "Sprite rect / pivot / border";
  if (engine === "cocos") return "Frame rect / capInsets";
  if (engine === "generic") return "通用 sprites 映射";
  if (engine === "taptap-maker") {
    if (name === "ui-main.json" || name.endsWith(".json")) return "TapTap Maker / UrhoX 交接";
    if (name === "theme.lua") return "UrhoX UI.Theme 映射";
    if (name === "component-map.json") return "组件 → UI Widget 对照";
    if (name === "screens.json") return "屏幕结构 + Lua 骨架";
    if (name === "README.md") return "接入说明";
    return "";
  }
  return "";
}

function exportLabel(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".png") || lower.endsWith(".webp")) return "img";
  return "file";
}

function writeIfAllowed(p, content, force) {
  if (exists(p) && !force) return err(`output already exists: ${p}; use --force`);
  return writeText(p, content);
}

function tryLoadMap(p) {
  try {
    return loadYamlMap(p);
  } catch {
    return new Map();
  }
}

/* ----------------------------------------------------------------- run ----- */

export function run(args) {
  const rawProject = args.pos(0);
  if (rawProject === undefined) {
    return err("usage: kui web <project> [--root DIR] [--force] [--json]");
  }
  let project = rawProject;
  try {
    project = fs.realpathSync(rawProject);
  } catch {
    project = rawProject;
  }
  const force = args.flag("force");
  const root = findRoot(args.opt("root"));
  const tplDir = findRootTemplates(root);

  const projectId = path.basename(project) || "project";

  // ---- contracts ----
  const stylePath = joinPath(project, "contracts/style-contract.yaml");
  const screenPath = joinPath(project, "contracts/screen-contract.yaml");
  const assetPath = joinPath(project, "contracts/asset-manifest.yaml");
  let o = Outcome.ok("web", "").withProject(project);

  if (!isFile(stylePath)) {
    return err(`missing ${stylePath}; run the specification stage first`);
  }
  const style = loadYamlMap(stylePath);
  const screens = tryLoadMap(screenPath);
  const assets = tryLoadMap(assetPath);

  const themeName = mapStr(style, "name") ?? projectId;
  const colorsValue = mapGet(style, "colors");
  const colors = colorsValue instanceof Map ? colorsValue : new Map();
  const platformValue = mapGet(style, "platform");
  const platform = platformValue instanceof Map ? platformValue : new Map();
  const colorBg = colorStr(mapGet(colors, "background"));
  const styleStatus = mapStr(style, "status") ?? "draft";

  // ---- collect pages from screens + assets ----
  const pages = [];
  const pageFiles = [];
  const screensValue = mapGet(screens, "screens");
  const screenList = Array.isArray(screensValue) ? screensValue : [];

  // map screen_id -> image path from asset-manifest
  const imageByScreen = new Map();
  const assetsListValue = mapGet(assets, "assets");
  if (Array.isArray(assetsListValue)) {
    for (const a of assetsListValue) {
      if (!(a instanceof Map)) continue;
      if (strOf(mapGet(a, "kind")) !== "page") continue;
      const sid = strOf(mapGet(a, "screen_id"));
      const p = strOf(mapGet(a, "path"));
      if (sid === undefined || p === undefined) continue;
      if (!imageByScreen.has(sid)) imageByScreen.set(sid, p);
    }
  }

  for (const s of screenList) {
    if (!(s instanceof Map)) continue;
    const sid = mapStr(s, "id") ?? "screen";
    const name = mapStr(s, "title") ?? mapStr(s, "name") ?? sid;
    const img = imageByScreen.get(sid) ?? `assets/pages/${sid}-v1.png`;
    pageFiles.push(img);
    pages.push({
      id: sid,
      name,
      img,
      priority: mapStr(s, "priority") ?? null,
      hotspots: [],
      meta: `exports/web · ${projectId}`,
    });
  }

  // extra pages found on disk but not in screens (e.g. result-lose)
  const pagesDir = joinPath(project, "assets/pages");
  const pagesRd = readDirOrNull(pagesDir);
  if (pagesRd) {
    const extras = [];
    for (const e of pagesRd) {
      const f = e.name;
      if (!f.endsWith(".png")) continue;
      const rel = `assets/pages/${f}`;
      if (pageFiles.includes(rel)) continue;
      const id = trimEndMatches(trimEndMatches(f, ".png"), "-v1");
      extras.push([id, rel]);
    }
    extras.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    for (const [id, rel] of extras) {
      pages.push({
        id,
        name: id.split("-").join(" "),
        img: rel,
        priority: null,
        hotspots: [],
        meta: `exports/web · ${projectId}`,
      });
    }
  }

  // components sample (first 24 png names)
  const comps = [];
  const compDir = joinPath(project, "assets/components");
  const compRd = readDirOrNull(compDir);
  if (compRd) {
    for (const e of compRd) {
      if (e.name.endsWith(".png")) comps.push(e.name);
    }
  }
  comps.sort();

  // ---- full assets/ listing for index.html ----
  const assetPagesFull = listImages(pagesDir, "assets/pages/");
  for (const item of assetPagesFull) {
    if (pageFiles.includes(item.path)) item.tag = "page";
  }
  const assetCompsFull = listImages(compDir, "assets/components/");
  const assetSpritesFull = listImages(joinPath(project, "assets/sprites"), "assets/sprites/");

  // atlases: pair json + image
  const atlases = [];
  const atlasDir = joinPath(project, "assets/atlases");
  const atlasRd = readDirOrNull(atlasDir);
  if (atlasRd) {
    const jsons = [];
    const images = [];
    for (const e of atlasRd) {
      const f = e.name;
      const lower = f.toLowerCase();
      if (lower.endsWith(".json")) jsons.push(f);
      else if (lower.endsWith(".png") || lower.endsWith(".webp")) images.push(f);
    }
    jsons.sort();
    images.sort();
    for (const j of jsons) {
      const stem = trimEndMatches(j, ".json");
      const imgName =
        images.find((i) => i.startsWith(stem) || trimEndMatches(i, ".png") === stem) ??
        (images.length > 0 ? images[0] : undefined);
      const imgPath =
        imgName === undefined ? `assets/atlases/${stem}.png` : `assets/atlases/${imgName}`;
      let spritesN = 0;
      let dims = "";
      const v = parseJsonOrNull(readTextOrNull(joinPath(atlasDir, j)));
      if (v !== null && typeof v === "object") {
        if (isPlainObject(v.sprites)) spritesN = Object.keys(v.sprites).length;
        if (v.size !== undefined && v.size !== null) {
          const sz = v.size;
          const at = (i) => (Array.isArray(sz) ? (intOf(sz[i]) ?? 0) : 0);
          dims = `${at(0)}×${at(1)}`;
        }
      }
      atlases.push({
        name: trimEndMatches(j, ".json"),
        image: imgPath,
        json: `assets/atlases/${j}`,
        sprites: spritesN,
        dims,
      });
    }
  }

  // ---- exports/ listing ----
  const exportRows = [];
  const exportRoot = joinPath(project, "exports");
  const engines = ["web", "godot", "unity", "cocos", "generic", "taptap-maker"];
  for (const eng of engines) {
    const dir = joinPath(exportRoot, eng);
    if (!isDir(dir)) continue;
    const files = [];
    const rd = readDirOrNull(dir);
    if (rd) {
      for (const e of rd) {
        if (e.name === ".gitkeep") continue;
        if (e.isFile()) files.push(e.name);
      }
    }
    files.sort();
    for (const f of files) {
      exportRows.push({
        engine: eng,
        name: f,
        path: `exports/${eng}/${f}`,
        label: exportLabel(f),
        note: exportNote(eng, f),
      });
    }
  }

  // sprite count from atlas or sprite items
  let spriteCount = 0;
  const atlasJson = joinPath(project, "assets/atlases/ui-main.json");
  let atlasRel = "";
  if (isFile(atlasJson)) {
    atlasRel = "assets/atlases/ui-main.json";
  } else {
    const rd = readDirOrNull(joinPath(project, "assets/atlases"));
    if (rd) {
      for (const e of rd) {
        if (e.name.endsWith(".json")) {
          atlasRel = `assets/atlases/${e.name}`;
          break;
        }
      }
    }
  }
  let atlasSprites = {};
  let atlasImage = "assets/atlases/ui-main.png";
  let atlasSize = [0, 0];
  if (atlasRel !== "") {
    const v = parseJsonOrNull(readTextOrNull(joinPath(project, atlasRel)));
    if (v !== null && typeof v === "object") {
      if (typeof v.image === "string") atlasImage = v.image;
      if (v.size !== undefined && v.size !== null) atlasSize = v.size;
      if (isPlainObject(v.sprites)) {
        spriteCount = Object.keys(v.sprites).length;
        const out = {};
        for (const [k, raw] of Object.entries(v.sprites)) {
          const item = isPlainObject(raw) ? raw : null;
          out[k] = {
            region: item ? (item.region ?? null) : null,
            pivot: (item ? item.pivot : undefined) ?? [0.5, 0.5],
            slice: item ? (item.slice ?? null) : null,
            component_id: item ? (item.component_id ?? null) : null,
            state: item ? (item.state ?? null) : null,
          };
        }
        atlasSprites = out;
      }
    }
  }

  // ---- write exports/web ----
  const webDir = joinPath(project, "exports/web");
  if (exists(webDir) && !force) {
    const rd = readDirOrNull(webDir);
    if (rd && rd.length > 0) {
      return err(`output already exists: ${webDir}; use --force`);
    }
  }
  try {
    mkdirp(webDir);
  } catch (e) {
    return err(`${webDir}: ${e.message}`);
  }

  // tokens.css — game design tokens only (--game-*).
  // Delivery chrome in index.html/result.html uses a fixed --shell-* palette
  // so game visual style never recolors the web handoff pages.
  const surfaceValue = mapGet(colors, "surface");
  const surface = surfaceValue instanceof Map ? surfaceValue : new Map();
  const refSizeRaw = mapGet(platform, "reference_size");
  const refSize = Array.isArray(refSizeRaw)
    ? [intOf(refSizeRaw[0]) ?? 1080, intOf(refSizeRaw[1]) ?? 1920]
    : [1080, 1920];
  const tokensCss = `/* ${projectId} · game design tokens (from contracts/style-contract.yaml) */
/* These are GAME tokens (--game-*). Web delivery chrome uses fixed --shell-* in index/result.html. */
:root {
  --game-primary: ${colorStr(mapGet(colors, "primary"))};
  --game-secondary: ${colorStr(mapGet(colors, "secondary"))};
  --game-accent: ${colorStr(mapGet(colors, "accent"))};
  --game-bg: ${colorBg};
  --game-warning: ${colorStr(mapGet(colors, "warning"))};
  --game-reward: ${colorStr(mapGet(colors, "reward"))};
  --game-disabled: ${colorStr(mapGet(colors, "disabled"))};
  --game-surface-board: ${colorStr(mapGet(surface, "board"))};
  --game-surface-cell: ${colorStr(mapGet(surface, "cell"))};
  --game-surface-card: ${colorStr(mapGet(surface, "card"))};
  --game-surface-card-hi: ${colorStr(mapGet(surface, "card-hi"))};
  --game-ref-width: ${refSize[0]};
  --game-ref-height: ${refSize[1]};
  --game-radius-md: 20px;
  --game-radius-lg: 28px;
}
`;
  writeText(joinPath(webDir, "tokens.css"), tokensCss);

  // manifest.json
  const webManifest = {
    schema_version: 1,
    project_id: projectId,
    engine: "web",
    format: "json-manifest",
    description: `Web handoff for ${projectId}: tokens, page artboards, atlas sprite regions. Not a native engine project.`,
    platform: {
      target: strOf(mapGet(platform, "target")) ?? null,
      orientation: strOf(mapGet(platform, "orientation")) ?? null,
      aspect_ratio: strOf(mapGet(platform, "aspect_ratio")) ?? null,
      reference_size: refSizeRaw === undefined ? null : yamlToJson(refSizeRaw),
    },
    theme: themeName,
    colors: yamlToJson(colors),
    tokens_css: "tokens.css",
    style_status: styleStatus,
    atlas: {
      image: `../../${atlasImage}`,
      data: `../../${atlasRel}`,
      size: atlasSize,
      sprites: atlasSprites,
    },
    pages: pages.map((p) => ({
      id: p.id,
      title: p.name,
      image: `../../${typeof p.img === "string" ? p.img : ""}`,
    })),
    entry: pages.length > 0 ? pages[0].id : null,
    runtime: {
      result_html: "../../result.html",
      index_html: "../../index.html",
      note: "Open result.html for interactive shell; index.html for asset catalog.",
    },
  };
  writeText(joinPath(webDir, "manifest.json"), `${jsonPretty(webManifest)}\n`);

  // README
  const readmeTpl = readText(joinPath(tplDir, "README.md"));
  writeText(joinPath(webDir, "README.md"), renderTemplate(readmeTpl, [["PROJECT_ID", projectId]]));

  // ---- result.html ----
  const resultTpl = readText(joinPath(tplDir, "result.html"));
  const resultHtml = renderTemplate(resultTpl, [
    ["PROJECT_ID", projectId],
    ["THEME_NAME", themeName],
    // Shell chrome stays on the fixed template palette; do not inject game bg.
    ["COLOR_BG", "#0C0910"],
    ["PAGES_JSON", jsonPretty(pages)],
  ]);
  const resultPath = joinPath(project, "result.html");
  writeIfAllowed(resultPath, resultHtml, force);

  // ---- index.html ----
  const indexTpl = readText(joinPath(tplDir, "index.html"));
  const colorsSwatches = [
    ["primary", "主操作"],
    ["secondary", "次级面"],
    ["accent", "强调"],
    ["background", "底色"],
    ["warning", "破坏性"],
    ["reward", "奖励"],
  ].map(([k, label]) => ({
    key: k,
    value: colorStr(mapGet(colors, k)),
    label,
  }));

  const gateNote =
    styleStatus === "approved"
      ? "style-contract 已 approved。仍建议跑 kui validate --strict 做最终门禁。"
      : `当前 style-contract 状态为 <code>${styleStatus}</code>，本包可用于联调预览；正式冻结前请完成批准并再跑 <code>kui validate --strict</code>。`;

  const stats = {
    pages: pages.length,
    components: assetCompsFull.length,
    sprites: Math.max(assetSpritesFull.length, spriteCount),
    exports: exportRows.length,
  };
  const data = {
    badges: [
      `${refSize[0]}×${refSize[1]}`,
      asciiUpper(strOf(mapGet(platform, "orientation")) ?? "portrait"),
      themeName,
      `${spriteCount} SPRITES`,
      `${exportRows.length} EXPORT FILES`,
    ],
    heroImage: pages.length > 0 ? pages[0].img : null,
    heroTitle: `${themeName}<br/>UI 物料与项目结构`,
    heroDesc:
      "面向移动竖屏的游戏 UI 交付包：策划文档、样式契约、页面视觉、组件切图、Atlas 与 Godot / Unity / Cocos / <strong>Web</strong> 引擎清单。",
    stats,
    pages: pages.map((p) => ({ id: p.id, name: p.name, img: p.img })),
    comps,
    assets: {
      pages: assetPagesFull,
      components: assetCompsFull,
      sprites: assetSpritesFull,
      atlases,
    },
    exports: exportRows,
    colors: colorsSwatches,
    gateNote,
  };

  const structure = defaultStructureTree(projectId);
  const heroText = `${themeName} UI 物料与项目结构`;
  const heroEscaped = htmlEscapeAttr(heroText);
  let indexHtml = renderTemplate(indexTpl, [
    ["PROJECT_ID", projectId],
    ["THEME_NAME", themeName],
    // Fixed delivery shell color — game palette must not recolor the catalog.
    ["COLOR_BG", "#1D1522"],
    ["HERO_TITLE", replaceAllLiteral(heroEscaped, "&amp;br/&gt;", "<br/>")],
    [
      "HERO_DESC",
      "一套可复现的游戏 UI 交付包：策划、契约、页面、组件、Atlas 与多引擎 JSON（含 Web）。",
    ],
    ["STRUCTURE_TREE", structure],
    ["DATA_JSON", jsonPretty(data)],
  ]);
  // hero title should allow <br/>
  indexHtml = replaceAllLiteral(indexHtml, heroEscaped, `${themeName}<br/>UI 物料与项目结构`);
  const indexPath = joinPath(project, "index.html");
  writeIfAllowed(indexPath, indexHtml, force);

  o = o
    .fact("project_id", projectId)
    .fact("page_count", pages.length)
    .fact("sprite_count", spriteCount)
    .fact("style_status", styleStatus)
    .fact("index_html", indexPath)
    .artifact(joinPath(webDir, "manifest.json"))
    .artifact(joinPath(webDir, "tokens.css"))
    .artifact(resultPath)
    .artifact(indexPath)
    .withNext(
      Next.waitUser(
        "deliver index.html: open in host right/preview panel if available; else add link to task summary and open in system browser (open/xdg-open/start). Always list PREVIEW/PREVIEW_ALT absolute paths.",
      ),
    );
  o.summary = `web pack for ${projectId} (${pages.length} pages, ${spriteCount} sprites)`;
  if (styleStatus !== "approved") {
    o.pushWarn(
      new Problem(
        "W_GATE",
        `style-contract status is ${styleStatus}`,
        "approve contracts/style-contract.yaml (and planning docs) before production freeze",
      ),
    );
  }
  return o.finalize();
}
