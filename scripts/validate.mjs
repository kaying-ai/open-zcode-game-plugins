/**
 * Validate every plugins/<name>.json against schema/plugin.schema.json plus
 * catalog-specific semantic rules. Zero dependencies.
 *
 *   node scripts/validate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, readJson, readText, exists, loadConfig, loadPlugins,
} from "./lib.mjs";

const SCHEMA = readJson("schema/plugin.schema.json");

/* ---------- minimal JSON Schema (draft 2020-12 subset) evaluator ---------- */
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref: ${ref}`);
  return ref.slice(2).split("/").reduce((o, k) => o?.[k], root);
}

function checkValue(value, rawSchema, at, errors, root = SCHEMA) {
  const s = rawSchema.$ref ? { ...resolveRef(rawSchema.$ref, root), ...omit(rawSchema, ["$ref"]) } : rawSchema;
  if (!s || typeof s !== "object") return;

  if (s.type) {
    const expected = Array.isArray(s.type) ? s.type : [s.type];
    if (!expected.includes(typeOf(value))) {
      errors.push(`${at}: expected ${expected.join("|")}, got ${typeOf(value)}`);
      return;
    }
  }
  if (s.enum && !s.enum.includes(value)) errors.push(`${at}: must be one of ${s.enum.join(", ")} (got ${JSON.stringify(value)})`);

  if (typeOf(value) === "string") {
    if (s.minLength !== undefined && value.length < s.minLength) errors.push(`${at}: shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && value.length > s.maxLength) errors.push(`${at}: longer than ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${at}: does not match ${s.pattern}`);
    if (s.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push(`${at}: expected YYYY-MM-DD`);
    if (s.format === "date" && Number.isNaN(Date.parse(value))) errors.push(`${at}: invalid calendar date`);
    if (s.format === "uri" && !/^https?:\/\//.test(value)) errors.push(`${at}: expected an http(s) URI`);
  }

  if (typeOf(value) === "array") {
    if (s.minItems !== undefined && value.length < s.minItems) errors.push(`${at}: needs >= ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${at}: needs <= ${s.maxItems} items`);
    if (s.uniqueItems && new Set(value.map((x) => JSON.stringify(x))).size !== value.length) errors.push(`${at}: duplicate items`);
    if (s.items) value.forEach((item, i) => checkValue(item, s.items, `${at}[${i}]`, errors, root));
  }

  if (typeOf(value) === "object") {
    if (s.minProperties !== undefined && Object.keys(value).length < s.minProperties) errors.push(`${at}: needs >= ${s.minProperties} keys`);
    if (s.maxProperties !== undefined && Object.keys(value).length > s.maxProperties) errors.push(`${at}: needs <= ${s.maxProperties} keys`);
    for (const key of s.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${at}: missing required field "${key}"`);
    }
    const props = s.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) checkValue(child, props[key], `${at}.${key}`, errors, root);
      else if (s.additionalProperties === false) errors.push(`${at}: unknown field "${key}"`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object")
        checkValue(child, s.additionalProperties, `${at}.${key}`, errors, root);
    }
  }
}

const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/* ---------- catalog-specific semantic rules ---------- */
function checkSemantics({ file, rel, data }, config, errors) {
  const at = rel;
  const name = data.name;
  if (file !== `${name}.json`) errors.push(`${at}: file name must be "${name}.json"`);

  const hosts = [...(data.hosts || [])].sort().join(",");
  const packages = Object.keys(data.source?.packages || {}).sort().join(",");
  if (hosts !== packages) errors.push(`${at}: hosts [${hosts}] must match source.packages keys [${packages}]`);

  if (config.spdxLicenses && !config.spdxLicenses.includes(data.license))
    errors.push(`${at}: license "${data.license}" is not in catalog.config.json spdxLicenses (open an issue to add it)`);
  if (!config.categories?.[data.category]) errors.push(`${at}: unknown category "${data.category}"`);

  if (data.updatedAt && data.updatedAt < data.addedAt) errors.push(`${at}: updatedAt is earlier than addedAt`);
  if (/^One sentence in English/.test(data.description) || data.name === "your-game-plugin")
    errors.push(`${at}: still contains template placeholder values`);

  const src = data.source || {};
  for (const [host, pkg] of Object.entries(src.packages || {})) {
    const p = `${at}.source.packages.${host}`;
    if (/(^|[\\/])\.\.([\\/]|$)/.test(pkg.path) || path.isAbsolute(pkg.path) || pkg.path.startsWith("/"))
      errors.push(`${p}.path: must be a relative path without ".."`);

    if (src.type === "bundled") {
      if (!pkg.path.startsWith(`bundled/${name}/`)) errors.push(`${p}.path: bundled packages must live under bundled/${name}/`);
      if (!fs.existsSync(path.join(ROOT, pkg.path))) { errors.push(`${p}.path: directory not found`); continue; }
      verifyLocalPackage(pkg, p, name, data.version, errors);
    } else if (src.type === "zip") {
      if (!pkg.url || !/^https:\/\//.test(pkg.url)) errors.push(`${p}: zip packages require a https url`);
      if (!pkg.sha256 || !/^[0-9a-f]{64}$/.test(pkg.sha256)) errors.push(`${p}: zip packages require a lowercase 64-char sha256`);
    }
  }

  if (src.type === "bundled" || src.type === "git") {
    if (!src.repository) errors.push(`${at}.source.repository: required for ${src.type} sources`);
    if (!src.ref) errors.push(`${at}.source.ref: pin an immutable commit SHA`);
    if (src.type === "bundled" && !/^[0-9a-f]{40}$/.test(src.ref || ""))
      errors.push(`${at}.source.ref: bundled entries must pin the upstream 40-char commit SHA`);
  }
  if (!(data.install?.strategy)) errors.push(`${at}.install.strategy: recommended (local-marketplace | plugin-dir | manual)`);
}

function verifyLocalPackage(pkg, at, name, version, errors) {
  const read = (rel) => {
    const p = path.join(ROOT, pkg.path, rel);
    if (!fs.existsSync(p)) { errors.push(`${at}: missing ${rel}`); return undefined; }
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { errors.push(`${at}: ${rel} is not valid JSON (${e.message})`); return undefined; }
  };
  for (const f of [pkg.licenseFile || "LICENSE", pkg.noticeFile || "NOTICE"]) {
    if (!fs.existsSync(path.join(ROOT, pkg.path, f))) errors.push(`${at}: missing ${f} (third-party license must travel with the copy)`);
  }
  const market = read(pkg.marketplace);
  const entry = market?.plugins?.find((p) => p.name === name);
  if (!entry) errors.push(`${at}: ${pkg.marketplace} has no plugin named "${name}"`);
  else if (entry.version !== version) errors.push(`${at}: ${pkg.marketplace} version ${entry.version} != ${version}`);
  const manifest = read(pkg.pluginManifest);
  if (manifest && manifest.name !== name) errors.push(`${at}: ${pkg.pluginManifest} name "${manifest.name}" != "${name}"`);
  if (manifest && manifest.version !== version) errors.push(`${at}: ${pkg.pluginManifest} version ${manifest.version} != ${version}`);
  checkPackageLinks(pkg, at, errors);
}

/**
 * Bundled copies live in this repository, so their documentation is our own
 * deliverable. A relative link resolves against the file that contains it:
 * `references/foo.md` written from inside `references/` resolves one level too
 * deep. Reject those before they ship to an Agent.
 */
function checkPackageLinks(pkg, at, errors) {
  const base = path.join(ROOT, pkg.path);
  if (!fs.existsSync(base)) return;
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(md|markdown)$/i.test(e.name)) files.push(f);
    }
  };
  walk(base);
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      for (const m of line.matchAll(/\]\(([^)]*)\)/g)) {
        let t = m[1].trim();
        if (t.startsWith("<") && t.includes(">")) t = t.slice(1, t.indexOf(">")).trim();
        t = t.split("#")[0].trim();
        if (!t || /^(https?:|mailto:|data:|tel:)/i.test(t) || /[<>*?{}]/.test(t)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(file), t))) {
          const rel = path.relative(base, file).replace(/\\/g, "/");
          errors.push(`${at}: broken link ${rel}:${i + 1} -> ${t}`);
        }
      }
    });
  }
}

/* ---------- entry point ---------- */
export function validateAll({ quiet = false } = {}) {
  const config = loadConfig();
  const plugins = loadPlugins();
  const errors = [];
  const seen = new Set();

  for (const item of plugins) {
    if (seen.has(item.data.name)) errors.push(`${item.rel}: duplicate plugin name "${item.data.name}"`);
    seen.add(item.data.name);
    checkValue(item.data, SCHEMA, item.rel, errors);
    checkSemantics(item, config, errors);
  }
  if (plugins.length === 0) errors.push("plugins/: no plugin entries found");

  if (!quiet) {
    if (errors.length) {
      console.error(`validation FAILED — ${errors.length} error(s):`);
      for (const e of errors) console.error(`  ✗ ${e}`);
    } else {
      console.log(`validation passed — ${plugins.length} plugin(s), ${Object.keys(config.categories).length} categories`);
    }
  }
  return { ok: errors.length === 0, errors, plugins, config };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("validate.mjs")) {
  const result = validateAll();
  process.exit(result.ok ? 0 : 1);
}
