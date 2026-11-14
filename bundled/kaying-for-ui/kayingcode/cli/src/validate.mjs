/**
 * validate — Spec-Kit project + cross-file contract checks (port of validate.rs).
 *
 * Checks, in the same order as the Rust implementation:
 *   markdown docs -> contract loading -> planning gate -> headers -> style ->
 *   screens -> components -> assets -> sprite -> atlas -> export -> strict gate
 *
 * Error codes and their `fix` text come from `classify()` (substring rules kept
 * verbatim). Mappings are `Map` instances, so use mapGet/mapHas.
 */

import fs from "node:fs";
import path from "node:path";
import {
  err,
  isDir,
  isFile,
  readText,
  loadYamlMap,
  mapGet,
  strOf,
  boolOf,
  intOf,
  isKebabId,
  inspectImage,
} from "./util.mjs";
import { Problem, Next, Outcome } from "./report.mjs";

const MARKDOWN_FILES = [
  "spec.md",
  "research.md",
  "plan.md",
  "tasks.md",
  "quickstart.md",
  "gdd.md",
  "prd.md",
  "interaction.md",
];
const PLANNING_FILES = ["gdd.md", "prd.md", "interaction.md"];
const CONTRACT_FILES = [
  "style-contract.yaml",
  "screen-contract.yaml",
  "component-contract.yaml",
  "asset-manifest.yaml",
];
const OPTIONAL_CONTRACT_FILES = [
  "sprite-contract.yaml",
  "atlas-contract.yaml",
  "export-contract.yaml",
];
const COMPONENT_CATEGORIES = [
  "background",
  "button",
  "frame",
  "panel",
  "card",
  "icon",
  "badge",
  "progress",
  "popup",
  "decoration",
  "currency",
  "character",
  "npc",
  "texture",
  "control",
  "container",
];
const SLICE_TYPES = ["9-slice", "full", "1:1", "tile"];
const EXPORT_TARGETS = ["godot", "unity", "cocos", "generic", "taptap-maker", "taptapmaker", "urhox"];
const ENGINE_TARGETS = [
  "godot",
  "unity",
  "cocos",
  "generic",
  "taptap-maker",
  "taptapmaker",
  "urhox",
];

/* --------------------------------------------------------------- report ---- */

function classify(msg) {
  let fix;
  if (msg.includes("missing required document")) {
    fix = "restore the Spec-Kit markdown from templates (kui init --force) or write the missing file";
  } else if (msg.includes("missing required contract")) {
    fix = "restore contracts/ from templates/contracts (kui init --force) or add the YAML";
  } else if (msg.includes("unresolved PROJECT_ID")) {
    fix = "replace {{PROJECT_ID}} with the real project id";
  } else if (msg.includes("document is empty")) {
    fix = "write real content into the document";
  } else if (msg.includes("status") && msg.includes("draft")) {
    fix = "set Document Status status to draft or approved (or record an explicit skip in quickstart.md)";
  } else if (msg.includes("schema_version")) {
    fix = "set schema_version: 1 in the contract";
  } else if (msg.includes("project_id")) {
    fix = "set contract project_id to the directory name (kebab-case id)";
  } else if (msg.includes("kebab-case")) {
    fix = "rename to lowercase kebab-case (a-z0-9 and single hyphens)";
  } else if (msg.includes("must be a mapping")) {
    fix = "make the field a YAML mapping (key: value)";
  } else if (msg.includes("must be a list")) {
    fix = "make the field a YAML list (- item)";
  } else if (msg.includes("does not exist") || msg.includes("missing linked")) {
    fix = "create the file or fix the path in the contract";
  } else if (msg.includes("dimensions")) {
    fix = "set dimensions to two positive integers matching the real file size";
  } else if (msg.includes("alpha")) {
    fix = "export PNG with alpha, or set transparent_background: false";
  } else if (msg.includes("9-slice")) {
    fix = "shrink margins so a stretchable center remains; re-review 9-slice";
  } else if (msg.includes("priority")) {
    fix = "set priority to must-have | genre-specific | optional";
  } else if (msg.includes("status")) {
    fix = "set status to one of the allowed values for this contract";
  } else if (msg.includes("slice")) {
    fix = "fix slice.type/margins (types: 9-slice, full, 1:1, tile)";
  } else if (msg.includes("ZIP")) {
    fix = "re-run kui split to rebuild the package";
  } else if (msg.includes("approved=true")) {
    fix = "set status: approved or set approved: false";
  } else if (msg.includes("review.complete")) {
    fix = "set review.complete: true after human review";
  } else if (msg.includes("duplicate")) {
    fix = "rename the duplicate id to be unique";
  } else if (msg.includes("unknown screen_id") || msg.includes("known screen")) {
    fix = "add the screen to screen-contract.yaml or fix the reference";
  } else if (msg.includes("unknown component_id") || msg.includes("known component")) {
    fix = "add the component to component-contract.yaml or fix the reference";
  } else if (msg.includes("incomplete draft")) {
    fix = "fill the empty style values or leave them empty only while draft";
  } else if (msg.includes("planning docs")) {
    fix = "approve gdd/prd/interaction or record an explicit skip in quickstart.md before visual generation";
  } else {
    fix = "read the contract schema and correct the field";
  }

  let code;
  if (msg.includes("missing")) code = "E_MISSING";
  else if (msg.includes("must be") || msg.includes("invalid")) code = "E_SCHEMA";
  else if (msg.includes("does not match") || msg.includes("do not match")) code = "E_MISMATCH";
  else if (msg.includes("duplicate")) code = "E_DUPLICATE";
  else if (msg.includes("unknown")) code = "E_REF";
  else if (msg.includes("approved")) code = "E_GATE";
  else code = "E_CONTRACT";
  return [code, fix];
}

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(msg) {
    const [code, fix] = classify(msg);
    this.errors.push(new Problem(code, msg, fix));
  }

  warn(msg) {
    const [code, fix] = classify(msg);
    this.warnings.push(new Problem(`W${code.slice(1)}`, msg, fix));
  }
}

/* ------------------------------------------------------------ debug fmt ---- */

/** Rust `{:?}` for &str. */
function dbgStr(s) {
  let out = '"';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += `\\u{${cp.toString(16)}}`;
    else out += ch;
  }
  return `${out}"`;
}

/** Rust `{:?}` for Option<&str>. */
function dbgOpt(s) {
  return s === undefined ? "None" : `Some(${dbgStr(s)})`;
}

/** Rust `{:?}` for Vec<i64>. */
function dbgVec(v) {
  return `[${v.join(", ")}]`;
}

/** Rust `{:?}` for Option<Vec<i64>>. */
function dbgOptVec(v) {
  return v === null ? "None" : `Some(${dbgVec(v)})`;
}

/** Rust `{:?}` for serde_yaml::Value (see serde_yaml value/debug.rs). */
function dbgValue(v) {
  if (v === null || v === undefined) return "Null";
  if (typeof v === "boolean") return `Bool(${v})`;
  if (typeof v === "number") return `Number(${v})`;
  if (typeof v === "string") return `String(${dbgStr(v)})`;
  if (Array.isArray(v)) return `Sequence [${v.map(dbgValue).join(", ")}]`;
  if (v instanceof Map) {
    const parts = [];
    for (const [k, val] of v.entries()) {
      const key = typeof k === "string" ? dbgStr(k) : dbgValue(k);
      parts.push(`${key}: ${dbgValue(val)}`);
    }
    return `Mapping {${parts.join(", ")}}`;
  }
  return String(v);
}

/* --------------------------------------------------------------- helpers ---- */

function joinProject(base, p) {
  return path.isAbsolute(p) ? p : path.join(base, p);
}

function requireMapping(value, key, source, report) {
  const m = mapGet(value, key);
  if (m instanceof Map) return m;
  report.error(`${source}: '${key}' must be a mapping`);
  return null;
}

function requireList(value, key, source, report) {
  const seq = mapGet(value, key);
  if (Array.isArray(seq)) return seq;
  report.error(`${source}: '${key}' must be a list`);
  return null;
}

function validateId(value, label, report) {
  const s = strOf(value);
  if (s !== undefined && isKebabId(s)) return true;
  report.error(`${label}: expected lowercase kebab-case ID, got ${dbgOpt(s)}`);
  return false;
}

function validateDimensions(value, label, report) {
  let ok = false;
  if (Array.isArray(value)) {
    ok = value.length === 2 && value.every((x) => Number.isInteger(x) && x > 0);
  }
  if (!ok) report.error(`${label}: dimensions must be two positive integers`);
}

function sameInts(a, b) {
  if (a === null || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function planningStatus(text) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("- status:")) {
      const v = t.slice("- status:".length).trim();
      if (v === "draft" || v === "approved") return v;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------ validators ---- */

function validateMarkdown(project, report) {
  for (const name of MARKDOWN_FILES) {
    const p = joinProject(project, name);
    if (!isFile(p)) {
      report.error(`missing required document: ${p}`);
      continue;
    }
    let text = "";
    try {
      text = readText(p);
    } catch {
      text = "";
    }
    if (text.includes("{{PROJECT_ID}}")) {
      report.error(`${p}: unresolved PROJECT_ID placeholder`);
    }
    if (text.trim() === "") {
      report.error(`${p}: document is empty`);
    }
  }
}

function validatePlanningDocs(project, assets, report) {
  const statuses = new Map();
  for (const name of PLANNING_FILES) {
    const p = joinProject(project, name);
    if (!isFile(p)) continue;
    let text = "";
    try {
      text = readText(p);
    } catch {
      text = "";
    }
    const status = planningStatus(text);
    statuses.set(name, status);
    if (status === undefined) {
      report.error(
        `${p}: missing status field under Document Status (expected \`- status: draft\` or \`- status: approved\`)`,
      );
    }
  }

  let visualAssets = 0;
  const seq = mapGet(assets, "assets");
  if (Array.isArray(seq)) {
    for (const a of seq) {
      if (!(a instanceof Map)) continue;
      const ty = strOf(mapGet(a, "type")) ?? strOf(mapGet(a, "kind"));
      const st = strOf(mapGet(a, "status"));
      const visual =
        ty === "page" || ty === "component" || ty === "sprite" || ty === "sprite-sheet";
      const done = st === "generated" || st === "approved" || st === "packed";
      if (visual && done) visualAssets++;
    }
  }
  if (visualAssets === 0) return;

  const unapproved = [];
  for (const [name, status] of statuses.entries()) {
    if (status === "draft") unapproved.push(name);
  }
  if (unapproved.length > 0) {
    report.warn(
      `planning docs not approved before visual generation: ${unapproved.join(", ")} (approve gdd.md / prd.md / interaction.md or document an explicit skip)`,
    );
  }
  if (statuses.size < PLANNING_FILES.length) {
    report.warn(
      "visual assets exist but one or more planning docs are missing; page generation should follow approved GDD/PRD/interaction",
    );
  }
}

function validateContractHeaders(contracts, projectId, report) {
  for (const [name, data] of contracts.entries()) {
    if (intOf(mapGet(data, "schema_version")) !== 1) {
      report.error(`${name}: schema_version must be 1`);
    }
    const pid = strOf(mapGet(data, "project_id"));
    if (pid !== projectId) {
      report.error(`${name}: project_id ${dbgOpt(pid)} does not match directory ${dbgStr(projectId)}`);
    }
  }
}

function validateStyle(style, report) {
  const source = "style-contract.yaml";
  const status = strOf(mapGet(style, "status"));
  if (!(status === "draft" || status === "approved")) {
    report.error(`${source}: status must be draft or approved`);
  }
  for (const key of ["platform", "visual", "colors", "typography", "geometry", "effects"]) {
    requireMapping(style, key, source, report);
  }

  const incomplete = [];
  const visual = mapGet(style, "visual");
  if (visual instanceof Map) {
    for (const key of ["theme", "mood"]) {
      const v = mapGet(visual, key);
      let empty;
      if (v === undefined || v === null) empty = true;
      else if (typeof v === "string") empty = v === "";
      else empty = false;
      if (empty) incomplete.push(`visual.${key}`);
    }
  }
  const colors = mapGet(style, "colors");
  if (colors instanceof Map) {
    for (const [k, v] of colors.entries()) {
      const key = typeof k === "string" ? k : "?";
      // `pressed` is optional: the exporter derives it from primary when omitted.
      if (key === "pressed") continue;
      const empty = v === null || (typeof v === "string" && v === "");
      if (empty) incomplete.push(`colors.${key}`);
    }
  }
  const tokens = mapGet(style, "tokens");
  if (tokens !== undefined) {
    if (!(tokens instanceof Map)) {
      report.error(`${source}: tokens must be a mapping`);
    } else {
      for (const [g, values] of tokens.entries()) {
        if (!(values instanceof Map)) {
          report.error(`${source}: tokens.${typeof g === "string" ? g : "?"} must be a mapping`);
        }
      }
    }
  }
  if (incomplete.length > 0) {
    report.warn(`${source}: incomplete draft values: ${incomplete.join(", ")}`);
  }
  const platform = mapGet(style, "platform");
  if (platform instanceof Map) {
    validateDimensions(mapGet(platform, "reference_size"), `${source}: reference_size`, report);
  }
}

function validateScreens(screenContract, report) {
  const ids = new Set();
  const statuses = new Map();
  const screens = requireList(screenContract, "screens", "screen-contract.yaml", report);
  if (!screens) return { ids, statuses };

  for (let index = 0; index < screens.length; index++) {
    const label = `screen-contract.yaml: screens[${index}]`;
    const screen = screens[index];
    if (!(screen instanceof Map)) {
      report.error(`${label}: must be a mapping`);
      continue;
    }
    const sid = strOf(mapGet(screen, "id"));
    if (sid === undefined) {
      validateId(mapGet(screen, "id"), `${label}.id`, report);
      continue;
    }
    if (!isKebabId(sid)) {
      report.error(`${label}.id: expected lowercase kebab-case ID, got ${dbgStr(sid)}`);
      continue;
    }
    if (ids.has(sid)) {
      report.error(`${label}: duplicate screen ID ${dbgStr(sid)}`);
    }
    ids.add(sid);
    statuses.set(sid, strOf(mapGet(screen, "status")) ?? "");

    const priority = strOf(mapGet(screen, "priority"));
    if (!(priority === "must-have" || priority === "genre-specific" || priority === "optional")) {
      report.error(`${label}: invalid priority ${dbgOpt(priority)}`);
    }
    for (const key of ["entry_points", "primary_actions", "dependencies", "components", "states"]) {
      requireList(screen, key, label, report);
    }
    const output = requireMapping(screen, "output", label, report);
    if (output) {
      for (const key of ["brief", "prompt", "image"]) {
        if (mapGet(output, key) === undefined) {
          report.error(`${label}.output: missing '${key}'`);
        }
      }
    }
  }
  return { ids, statuses };
}

function validateSlice(value, dimensions, label, report) {
  if (!(value instanceof Map)) {
    report.error(`${label}: slice must be a mapping`);
    return;
  }
  const ty = strOf(mapGet(value, "type"));
  if (!SLICE_TYPES.includes(ty ?? "")) {
    report.error(`${label}: invalid slice type ${dbgOpt(ty)}`);
  }
  const marginsSeq = mapGet(value, "margins");
  const margins = Array.isArray(marginsSeq) ? marginsSeq : null;
  const marginsOk =
    margins !== null &&
    margins.length === 4 &&
    margins.every((x) => Number.isInteger(x) && x >= 0);
  if (!marginsOk) {
    report.error(`${label}: slice margins must be four non-negative integers`);
    return;
  }
  if (ty === "9-slice") {
    const dim = Array.isArray(dimensions) ? dimensions : null;
    if (dim && dim.length === 2 && dim.every((x) => Number.isInteger(x) && x > 0)) {
      const m = margins.filter((x) => Number.isInteger(x));
      const [l, r, t, b] = [m[0], m[1], m[2], m[3]];
      const w = dim[0];
      const h = dim[1];
      if (l + r >= w || t + b >= h) {
        report.error(`${label}: 9-slice margins leave no stretchable center`);
      }
    }
  }
}

function validateComponents(componentContract, screenIds, report) {
  const ids = new Set();
  const sourceScreen = strOf(mapGet(componentContract, "source_screen_id"));
  if (!screenIds.has(sourceScreen ?? "")) {
    report.error("component-contract.yaml: source_screen_id must reference a known screen");
  }
  const components = requireList(componentContract, "components", "component-contract.yaml", report);
  if (!components) return ids;

  for (let index = 0; index < components.length; index++) {
    const label = `component-contract.yaml: components[${index}]`;
    const component = components[index];
    if (!(component instanceof Map)) {
      report.error(`${label}: must be a mapping`);
      continue;
    }
    const cid = strOf(mapGet(component, "id"));
    if (cid === undefined) {
      validateId(mapGet(component, "id"), `${label}.id`, report);
      continue;
    }
    if (!isKebabId(cid)) {
      report.error(`${label}.id: expected lowercase kebab-case ID, got ${dbgStr(cid)}`);
      continue;
    }
    if (ids.has(cid)) {
      report.error(`${label}: duplicate component ID ${dbgStr(cid)}`);
    }
    ids.add(cid);

    const category = strOf(mapGet(component, "category"));
    if (!COMPONENT_CATEGORIES.includes(category ?? "")) {
      report.error(`${label}: invalid category ${dbgOpt(category)}`);
    }
    if (boolOf(mapGet(component, "transparent_background")) === undefined) {
      report.error(`${label}: transparent_background must be boolean`);
    }
    validateDimensions(mapGet(component, "target_size"), `${label}.target_size`, report);

    const statesSeq = requireList(component, "states", label, report);
    const states = statesSeq ? statesSeq.filter((x) => typeof x === "string") : [];
    // Two-state rule: clickable controls must ship default + pressed so the
    // generated UI never shows identical visuals for normal vs clicked.
    const clickable = category === "control" || boolOf(mapGet(component, "clickable")) === true;
    if (clickable) {
      for (const required of ["default", "pressed"]) {
        if (!states.includes(required)) {
          report.error(
            `${label}: clickable control (category=${dbgOpt(category)}) must declare the '${required}' state; add it to states and generate <component-id>-${required} assets with a clearly different pressed visual (darken ~14% + 2px sink, same outline)`,
          );
        }
      }
    }
    if (mapGet(component, "slice") !== undefined) {
      validateSlice(
        mapGet(component, "slice"),
        mapGet(component, "target_size"),
        `${label}.slice`,
        report,
      );
    }
    if (mapGet(component, "atlas_group") !== undefined) {
      validateId(mapGet(component, "atlas_group"), `${label}.atlas_group`, report);
    }
    const targets = mapGet(component, "export_targets");
    if (Array.isArray(targets)) {
      for (const t of targets) {
        const s = strOf(t) ?? "";
        if (!EXPORT_TARGETS.includes(s)) {
          report.error(`${label}: invalid export target ${dbgValue(t)}`);
        }
      }
    }
  }
  return ids;
}

/**
 * Two-state coverage: warn when a clickable control declared `pressed` but the
 * atlas never packed a pressed-state sprite for it.
 */
function validateStateCoverage(componentContract, atlas, report) {
  const components = mapGet(componentContract, "components");
  if (!Array.isArray(components)) return;

  const packed = [];
  const items = mapGet(atlas, "items");
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!(item instanceof Map)) continue;
      const cid = strOf(mapGet(item, "component_id"));
      if (cid === undefined) continue;
      const state = strOf(mapGet(item, "state")) ?? "default";
      packed.push([cid, state]);
    }
  }
  if (packed.length === 0) return;

  for (let index = 0; index < components.length; index++) {
    const m = components[index];
    if (!(m instanceof Map)) continue;
    const id = strOf(mapGet(m, "id"));
    if (id === undefined) continue;
    const category = strOf(mapGet(m, "category"));
    const clickable = category === "control" || boolOf(mapGet(m, "clickable")) === true;
    if (!clickable) continue;
    const hasPressed = packed.some(([cid, state]) => cid === id && state === "pressed");
    if (!hasPressed) {
      report.warn(
        `component-contract.yaml: components[${index}] (${id}): clickable control has no pressed-state sprite in the atlas; generate <${id}>-pressed (darken ~14% + 2px sink, same outline) and re-run kui split / kui atlas, or the pressed state will look identical to normal`,
      );
    }
  }
}

function validateAssets(project, manifest, screenIds, componentIds, report) {
  const assets = requireList(manifest, "assets", "asset-manifest.yaml", report);
  if (!assets) return;
  const ids = new Set();

  for (let index = 0; index < assets.length; index++) {
    const label = `asset-manifest.yaml: assets[${index}]`;
    const asset = assets[index];
    if (!(asset instanceof Map)) {
      report.error(`${label}: must be a mapping`);
      continue;
    }
    const assetId = strOf(mapGet(asset, "id"));
    if (assetId === undefined) {
      validateId(mapGet(asset, "id"), `${label}.id`, report);
      continue;
    }
    if (!isKebabId(assetId)) {
      report.error(`${label}.id: expected lowercase kebab-case ID, got ${dbgStr(assetId)}`);
      continue;
    }
    if (ids.has(assetId)) {
      report.error(`${label}: duplicate asset ID ${dbgStr(assetId)}`);
    }
    ids.add(assetId);

    const kind = strOf(mapGet(asset, "kind"));
    if (!(kind === "page" || kind === "component" || kind === "sprite-sheet" || kind === "package")) {
      report.error(`${label}: kind must be page, component, sprite-sheet, or package`);
    }
    const screenId = strOf(mapGet(asset, "screen_id")) ?? "";
    if (!screenIds.has(screenId)) {
      report.error(`${label}: unknown screen_id ${dbgStr(screenId)}`);
    }
    const componentId = strOf(mapGet(asset, "component_id")) ?? "";
    if (kind === "component" && !componentIds.has(componentId)) {
      report.error(`${label}: unknown component_id ${dbgStr(componentId)}`);
    }
    const status = strOf(mapGet(asset, "status"));
    if (
      !(
        status === "pending-generation" ||
        status === "generated" ||
        status === "approved" ||
        status === "stale"
      )
    ) {
      report.error(`${label}: invalid status ${dbgOpt(status)}`);
    }
    if (kind !== "package") {
      validateDimensions(mapGet(asset, "dimensions"), `${label}.dimensions`, report);
      if (boolOf(mapGet(asset, "transparent_background")) === undefined) {
        report.error(`${label}: transparent_background must be boolean`);
      }
    }

    const promptValue = strOf(mapGet(asset, "prompt_path"));
    const prompt = promptValue === undefined ? null : joinProject(project, promptValue);
    if (kind !== "package") {
      if (prompt === null || !isFile(prompt)) {
        report.error(`${label}: prompt_path does not exist: ${dbgOpt(promptValue)}`);
      }
    }

    const pathValue = strOf(mapGet(asset, "path"));
    const output = pathValue === undefined ? null : joinProject(project, pathValue);
    if (status === "generated" || status === "approved") {
      if (output === null || !isFile(output)) {
        report.error(`${label}: generated asset path does not exist: ${dbgOpt(pathValue)}`);
      }
    }
    if (kind !== "package" && output !== null && isFile(output)) {
      if (status === "generated" || status === "approved") {
        let inspected = null;
        let failure = null;
        try {
          inspected = inspectImage(output);
        } catch (e) {
          failure = e;
        }
        if (failure) {
          report.error(`${label}: cannot inspect ${dbgOpt(pathValue)}: ${failure.message}`);
        } else if (inspected === null) {
          const extName = path.extname(output);
          const shown = extName === "" ? "extensionless files" : extName.slice(1);
          report.warn(`${label}: actual dimensions and alpha are not checked for ${shown}`);
        } else {
          const [actualDimensions, hasAlpha] = inspected;
          const dimValue = mapGet(asset, "dimensions");
          const expected = Array.isArray(dimValue)
            ? dimValue.filter((x) => Number.isInteger(x))
            : null;
          if (!sameInts(expected, actualDimensions)) {
            report.error(
              `${label}: manifest dimensions ${dbgOptVec(expected)} do not match actual ${dbgVec(actualDimensions)}`,
            );
          }
          if (boolOf(mapGet(asset, "transparent_background")) === true && !hasAlpha) {
            report.error(`${label}: transparent_background=true but the file has no alpha channel`);
          }
        }
      }
    }
    if (boolOf(mapGet(asset, "approved")) === true && status !== "approved") {
      report.error(`${label}: approved=true requires status=approved`);
    }
  }
}

/* ------------------------------------------------------------------- zip ---- */

/**
 * Parse the central directory. Returns the entry names, or null when the file
 * is not a structurally valid ZIP archive (equivalent to `ZipArchive::new`).
 */
function zipEntryNames(file) {
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    return null;
  }
  const len = data.length;
  if (len < 22) return null;
  let eocd = -1;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  let count = data.readUInt16LE(eocd + 10);
  let cdSize = data.readUInt32LE(eocd + 12);
  let cdOffset = data.readUInt32LE(eocd + 16);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && data.readUInt32LE(locator) === 0x07064b50) {
      const z64 = Number(data.readBigUInt64LE(locator + 8));
      if (z64 + 56 <= len && data.readUInt32LE(z64) === 0x06064b50) {
        count = Number(data.readBigUInt64LE(z64 + 32));
        cdSize = Number(data.readBigUInt64LE(z64 + 40));
        cdOffset = Number(data.readBigUInt64LE(z64 + 48));
      }
    }
  }
  if (cdOffset + cdSize > len) return null;

  const names = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > len || data.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    const start = p + 46;
    if (start + nameLen > len) return null;
    names.push(data.toString("utf8", start, start + nameLen));
    p = start + nameLen + extraLen + commentLen;
  }
  return names;
}

function validateSpriteContract(project, sprite, screenIds, componentIds, report) {
  const sourceName = "sprite-contract.yaml";
  const status = strOf(mapGet(sprite, "status"));
  if (
    !(status === "draft" || status === "generated" || status === "approved" || status === "stale")
  ) {
    report.error(`${sourceName}: invalid status ${dbgOpt(status)}`);
  }
  validateId(mapGet(sprite, "pack_id"), `${sourceName}: pack_id`, report);
  if (strOf(mapGet(sprite, "text_policy")) !== "remove-all") {
    report.error(`${sourceName}: text_policy must be remove-all`);
  }
  const source = requireMapping(sprite, "source", sourceName, report);
  if (!source) return;
  const detection = requireMapping(sprite, "detection", sourceName, report);
  if (!detection) return;
  const output = requireMapping(sprite, "output", sourceName, report);
  if (!output) return;
  const items = requireList(sprite, "items", sourceName, report);
  const review = requireMapping(sprite, "review", sourceName, report);

  const semanticMapping = mapGet(sprite, "semantic_mapping");
  const semanticRequired =
    semanticMapping instanceof Map && boolOf(mapGet(semanticMapping, "required")) === true;

  const screenId = strOf(mapGet(source, "screen_id")) ?? "";
  if (!screenIds.has(screenId)) {
    report.error(`${sourceName}: unknown source screen_id ${dbgStr(screenId)}`);
  }
  const mode = strOf(mapGet(detection, "mode"));
  if (!(mode === "auto" || mode === "alpha" || mode === "background")) {
    report.error(`${sourceName}: invalid detection mode`);
  }
  for (const key of [
    "alpha_threshold",
    "background_tolerance",
    "connect_gap",
    "min_area",
    "padding",
  ]) {
    const v = intOf(mapGet(detection, key));
    if (v === undefined || v < 0) {
      report.error(`${sourceName}: detection.${key} must be non-negative`);
    }
  }

  const itemIds = new Set();
  if (items) {
    for (let index = 0; index < items.length; index++) {
      const label = `${sourceName}: items[${index}]`;
      const item = items[index];
      if (!(item instanceof Map)) {
        report.error(`${label}: must be a mapping`);
        continue;
      }
      const itemId = strOf(mapGet(item, "id"));
      if (itemId === undefined) {
        validateId(mapGet(item, "id"), `${label}.id`, report);
        continue;
      }
      if (!isKebabId(itemId)) {
        report.error(`${label}.id: expected lowercase kebab-case ID, got ${dbgStr(itemId)}`);
        continue;
      }
      if (itemIds.has(itemId)) {
        report.error(`${label}: duplicate item ID ${dbgStr(itemId)}`);
      }
      itemIds.add(itemId);

      const bboxSeq = mapGet(item, "bbox");
      const bbox = Array.isArray(bboxSeq) ? bboxSeq : null;
      const bboxOk =
        bbox !== null &&
        bbox.length === 4 &&
        bbox.every((x) => Number.isInteger(x) && x >= 0) &&
        bbox[2] > 0 &&
        bbox[3] > 0;
      if (!bboxOk) {
        report.error(`${label}: bbox must be [x, y, width, height]`);
      }
      validateDimensions(mapGet(item, "dimensions"), `${label}.dimensions`, report);
      if (semanticRequired) {
        const cid = strOf(mapGet(item, "component_id")) ?? "";
        if (!componentIds.has(cid)) {
          report.error(`${label}: component_id must reference a known component`);
        }
        validateId(mapGet(item, "semantic_name"), `${label}.semantic_name`, report);
        const category = strOf(mapGet(item, "category"));
        if (!COMPONENT_CATEGORIES.includes(category ?? "")) {
          report.error(`${label}: invalid category ${dbgOpt(category)}`);
        }
        if ((strOf(mapGet(item, "state")) ?? "") === "") {
          report.error(`${label}: state is required`);
        }
        validateSlice(mapGet(item, "slice"), mapGet(item, "dimensions"), `${label}.slice`, report);
      }
      const pathValue = strOf(mapGet(item, "path"));
      const itemPath = pathValue === undefined ? null : joinProject(project, pathValue);
      if (status === "generated" || status === "approved") {
        if (itemPath !== null && isFile(itemPath)) {
          const isPng = path.extname(itemPath).slice(1).toLowerCase() === "png";
          let inspected = null;
          try {
            inspected = inspectImage(itemPath);
          } catch {
            inspected = null;
          }
          if (inspected !== null && isPng) {
            const [dimensions, hasAlpha] = inspected;
            const dimValue = mapGet(item, "dimensions");
            const expected = Array.isArray(dimValue)
              ? dimValue.filter((x) => Number.isInteger(x))
              : null;
            if (!sameInts(expected, dimensions)) {
              report.error(
                `${label}: dimensions ${dbgOptVec(expected)} do not match actual ${dbgVec(dimensions)}`,
              );
            }
            if (!hasAlpha) {
              report.error(`${label}: sprite PNG has no alpha channel`);
            }
          } else {
            report.error(`${label}: sprite item must be a PNG`);
          }
        } else {
          report.error(`${label}: PNG path does not exist: ${dbgOpt(pathValue)}`);
        }
      }
    }
  }

  if (status === "generated" || status === "approved") {
    if (!items || items.length === 0) {
      report.error(`${sourceName}: generated packs require items`);
    }
    const sheetValue = strOf(mapGet(source, "sheet_path"));
    const sheet = sheetValue === undefined ? null : joinProject(project, sheetValue);
    if (sheet === null || !isFile(sheet)) {
      report.error(`${sourceName}: source sheet does not exist: ${dbgOpt(sheetValue)}`);
    }
    const manifestValue = strOf(mapGet(output, "manifest_path"));
    const spriteManifest = manifestValue === undefined ? null : joinProject(project, manifestValue);
    if (spriteManifest === null || !isFile(spriteManifest)) {
      report.error(`${sourceName}: split manifest does not exist: ${dbgOpt(manifestValue)}`);
    }
    const packageValue = strOf(mapGet(output, "package_path"));
    const pkgPath = packageValue === undefined ? null : joinProject(project, packageValue);
    if (pkgPath !== null && isFile(pkgPath)) {
      const names = zipEntryNames(pkgPath);
      if (names === null) {
        report.error(`${sourceName}: package is not a valid ZIP`);
      } else {
        if (!names.includes("sprite-manifest.yaml")) {
          report.error(`${sourceName}: ZIP is missing sprite-manifest.yaml`);
        }
        if (items) {
          for (const item of items) {
            if (!(item instanceof Map)) continue;
            const pv = strOf(mapGet(item, "path"));
            if (pv === undefined) continue;
            const fname = path.basename(pv) || pv;
            const expected = `items/${fname}`;
            if (!names.includes(expected)) {
              report.error(`${sourceName}: ZIP is missing item ${dbgStr(expected)}`);
            }
          }
        }
      }
    } else {
      report.error(`${sourceName}: package_path does not exist: ${dbgOpt(packageValue)}`);
    }
  }
  if (status === "approved") {
    if (!(review instanceof Map) || boolOf(mapGet(review, "complete")) !== true) {
      report.error(`${sourceName}: approved packs require review.complete=true`);
    }
    if (!(review instanceof Map) || boolOf(mapGet(review, "text_free")) !== true) {
      report.error(`${sourceName}: approved packs require review.text_free=true`);
    }
  }
}

function validateAtlasContract(project, atlas, componentIds, report) {
  const sourceName = "atlas-contract.yaml";
  const status = strOf(mapGet(atlas, "status"));
  if (
    !(status === "draft" || status === "packed" || status === "approved" || status === "stale")
  ) {
    report.error(`${sourceName}: invalid status ${dbgOpt(status)}`);
  }
  let atlasId = null;
  if (validateId(mapGet(atlas, "atlas_id"), `${sourceName}: atlas_id`, report)) {
    atlasId = strOf(mapGet(atlas, "atlas_id")) ?? null;
  }
  const settings = requireMapping(atlas, "settings", sourceName, report);
  const output = requireMapping(atlas, "output", sourceName, report);
  const items = requireList(atlas, "items", sourceName, report);
  const review = requireMapping(atlas, "review", sourceName, report);

  if (settings) {
    validateDimensions(mapGet(settings, "max_size"), `${sourceName}: max_size`, report);
    const padding = intOf(mapGet(settings, "padding"));
    if (padding === undefined || padding < 0) {
      report.error(`${sourceName}: settings.padding must be non-negative`);
    }
    if (boolOf(mapGet(settings, "allow_rotation")) !== false) {
      report.error(`${sourceName}: allow_rotation must be false`);
    }
  }

  const semanticNames = new Set();
  if (items) {
    for (let index = 0; index < items.length; index++) {
      const label = `${sourceName}: items[${index}]`;
      const item = items[index];
      if (!(item instanceof Map)) {
        report.error(`${label}: must be a mapping`);
        continue;
      }
      const semanticName = strOf(mapGet(item, "semantic_name"));
      if (validateId(mapGet(item, "semantic_name"), `${label}.semantic_name`, report)) {
        if (semanticName !== undefined) {
          if (semanticNames.has(semanticName)) {
            report.error(`${label}: duplicate semantic_name ${dbgStr(semanticName)}`);
          }
          semanticNames.add(semanticName);
        }
      }
      const cid = strOf(mapGet(item, "component_id")) ?? "";
      if (!componentIds.has(cid)) {
        report.error(`${label}: component_id must reference a known component`);
      }
      const regionSeq = mapGet(item, "region");
      const region = Array.isArray(regionSeq) ? regionSeq : null;
      const regionOk =
        region !== null &&
        region.length === 4 &&
        region.every((x) => Number.isInteger(x) && x >= 0) &&
        region[2] > 0 &&
        region[3] > 0;
      if (!regionOk) {
        report.error(`${label}: region must be [x, y, width, height]`);
      }
      if (mapGet(item, "slice") !== undefined) {
        validateSlice(mapGet(item, "slice"), mapGet(item, "region"), `${label}.slice`, report);
      }
    }
  }

  if (status === "packed" || status === "approved") {
    const imageValue = output ? strOf(mapGet(output, "image_path")) : undefined;
    const dataValue = output ? strOf(mapGet(output, "data_path")) : undefined;
    const image = imageValue === undefined ? null : joinProject(project, imageValue);
    const dataPath = dataValue === undefined ? null : joinProject(project, dataValue);
    if (image === null || !isFile(image)) {
      report.error(`${sourceName}: atlas image does not exist: ${dbgOpt(imageValue)}`);
    }
    if (dataPath !== null && isFile(dataPath)) {
      let text = null;
      try {
        text = readText(dataPath);
      } catch {
        text = null;
      }
      if (text !== null) {
        try {
          const parsed = JSON.parse(text);
          const sprites =
            parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
              ? parsed.sprites
              : undefined;
          if (
            sprites === null ||
            sprites === undefined ||
            typeof sprites !== "object" ||
            Array.isArray(sprites)
          ) {
            report.error(`${sourceName}: atlas JSON requires a sprites mapping`);
          }
        } catch (e) {
          report.error(`${sourceName}: invalid atlas JSON: ${e.message}`);
        }
      }
    } else {
      report.error(`${sourceName}: atlas data does not exist: ${dbgOpt(dataValue)}`);
    }
    if (!items || items.length === 0) {
      report.error(`${sourceName}: packed atlases require items`);
    }
  }
  if (status === "approved") {
    if (!(review instanceof Map) || boolOf(mapGet(review, "complete")) !== true) {
      report.error(`${sourceName}: approved atlases require review.complete=true`);
    }
  }
  return atlasId;
}

function validateExportContract(project, exportContract, atlasId, report) {
  const sourceName = "export-contract.yaml";
  const status = strOf(mapGet(exportContract, "status"));
  if (
    !(status === "draft" || status === "generated" || status === "approved" || status === "stale")
  ) {
    report.error(`${sourceName}: invalid status ${dbgOpt(status)}`);
  }
  if (atlasId !== null) {
    if (strOf(mapGet(exportContract, "source_atlas_id")) !== atlasId) {
      report.error(`${sourceName}: source_atlas_id must match atlas-contract`);
    }
  }
  const targets = requireList(exportContract, "targets", sourceName, report);
  if (!targets) return;
  requireMapping(exportContract, "review", sourceName, report);

  for (let index = 0; index < targets.length; index++) {
    const label = `${sourceName}: targets[${index}]`;
    const target = targets[index];
    if (!(target instanceof Map)) {
      report.error(`${label}: must be a mapping`);
      continue;
    }
    const engine = strOf(mapGet(target, "engine"));
    if (!ENGINE_TARGETS.includes(engine ?? "")) {
      report.error(`${label}: invalid engine ${dbgOpt(engine)}`);
    }
    if (strOf(mapGet(target, "format")) !== "json-manifest") {
      report.error(`${label}: format must be json-manifest`);
    }
    if (boolOf(mapGet(target, "native_project_files")) === undefined) {
      report.error(`${label}: native_project_files must be boolean`);
    }
    if (boolOf(mapGet(target, "native_project_files")) === true) {
      report.warn(`${label}: native engine files are not generated by the built-in exporter`);
    }
    if (status === "generated" || status === "approved") {
      const pathValue = strOf(mapGet(target, "manifest_path"));
      const manifestPath = pathValue === undefined ? null : joinProject(project, pathValue);
      let engineNorm = engine;
      if (engine === "taptapmaker" || engine === "taptap_maker" || engine === "urhox") {
        engineNorm = "taptap-maker";
      }
      if (manifestPath !== null && isFile(manifestPath)) {
        let text = null;
        try {
          text = readText(manifestPath);
        } catch {
          text = null;
        }
        if (text !== null) {
          try {
            const parsed = JSON.parse(text);
            const got =
              parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed.engine
                : undefined;
            if (typeof got !== "string" || got !== engineNorm) {
              report.error(`${label}: JSON engine does not match contract`);
            }
          } catch (e) {
            report.error(`${label}: invalid JSON manifest: ${e.message}`);
          }
        }
      } else {
        report.error(`${label}: manifest does not exist: ${dbgOpt(pathValue)}`);
      }
    }
  }
  if (status === "approved") {
    const review = mapGet(exportContract, "review");
    if (!(review instanceof Map) || boolOf(mapGet(review, "complete")) !== true) {
      report.error(`${sourceName}: approved exports require review.complete=true`);
    }
  }
}

/* ------------------------------------------------------------- entrypoint ---- */

function loadYamlMapOrReport(p, report) {
  try {
    return loadYamlMap(p);
  } catch (e) {
    report.error(e.message);
    return new Map();
  }
}

function validate(project, strict, report) {
  if (!isDir(project)) {
    report.error(`project directory does not exist: ${project}`);
    return;
  }
  let projectId = path.basename(project);
  if (projectId === "." || projectId === ".." || projectId === path.sep) projectId = "";
  if (!isKebabId(projectId)) {
    report.error(`project directory: expected lowercase kebab-case ID, got ${dbgStr(projectId)}`);
  }
  validateMarkdown(project, report);

  const contracts = new Map();
  for (const name of CONTRACT_FILES) {
    const p = joinProject(project, path.join("contracts", name));
    if (!isFile(p)) {
      report.error(`missing required contract: ${p}`);
      contracts.set(name, new Map());
    } else {
      contracts.set(name, loadYamlMapOrReport(p, report));
    }
  }
  for (const name of OPTIONAL_CONTRACT_FILES) {
    const p = joinProject(project, path.join("contracts", name));
    if (isFile(p)) contracts.set(name, loadYamlMapOrReport(p, report));
  }

  const assets = contracts.get("asset-manifest.yaml") ?? new Map();
  validatePlanningDocs(project, assets, report);
  validateContractHeaders(contracts, projectId, report);

  const style = contracts.get("style-contract.yaml");
  if (style) validateStyle(style, report);

  const screens = contracts.has("screen-contract.yaml")
    ? validateScreens(contracts.get("screen-contract.yaml"), report)
    : { ids: new Set(), statuses: new Map() };
  const screenIds = screens.ids;

  const componentIds = contracts.has("component-contract.yaml")
    ? validateComponents(contracts.get("component-contract.yaml"), screenIds, report)
    : new Set();

  const manifest = contracts.get("asset-manifest.yaml");
  if (manifest) validateAssets(project, manifest, screenIds, componentIds, report);

  const sprite = contracts.get("sprite-contract.yaml");
  if (sprite) validateSpriteContract(project, sprite, screenIds, componentIds, report);

  let atlasId = null;
  const atlas = contracts.get("atlas-contract.yaml");
  if (atlas) {
    atlasId = validateAtlasContract(project, atlas, componentIds, report);
    const componentContract = contracts.get("component-contract.yaml");
    if (componentContract) validateStateCoverage(componentContract, atlas, report);
  }
  const exportContract = contracts.get("export-contract.yaml");
  if (exportContract) validateExportContract(project, exportContract, atlasId, report);

  if (strict && report.warnings.length > 0) {
    const warnings = report.warnings;
    report.warnings = [];
    for (const w of warnings) {
      w.message = `strict: ${w.message}`;
      w.code = `S${w.code.slice(1)}`;
      report.errors.push(w);
    }
  }
}

export function run(args) {
  const raw = args.pos(0);
  if (raw === undefined) return err("usage: kui validate <project-dir> [--strict]");
  let project = raw;
  try {
    project = fs.realpathSync(raw);
  } catch {
    project = raw;
  }
  const strict = args.flag("strict");
  const report = new Report();
  validate(project, strict, report);

  const nErr = report.errors.length;
  const nWarn = report.warnings.length;
  let o = Outcome.ok(
    "validate",
    nErr === 0 ? `valid (${nWarn} warning(s))` : `${nErr} error(s), ${nWarn} warning(s)`,
  )
    .withProject(project)
    .fact("error_count", nErr)
    .fact("warning_count", nWarn)
    .artifact(project);
  o.mergeProblems(report.errors, report.warnings);

  if (nErr === 0) {
    // Web pack present -> treat as delivery point (SKILL.md section 7).
    const indexHtml = joinProject(project, "index.html");
    if (isFile(indexHtml)) {
      o = o
        .fact("index_html", indexHtml)
        .withNext(
          Next.waitUser(
            "deliver index.html: open in host right/preview panel if available; else add link to task summary and open in system browser (open/xdg-open/start). Always list PREVIEW/PREVIEW_ALT absolute paths.",
          ),
        );
    } else {
      o = o.withNext(Next.none());
    }
  } else {
    o = o.withNext(Next.run(`kui validate ${project}`));
  }
  return o.finalize();
}
