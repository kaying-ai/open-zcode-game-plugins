/**
 * Verify a downloaded/bundled plugin package before registering it locally.
 * Designed to be fetched as a single file by an Agent:
 *   curl -fsSL <rawBase>/scripts/verify-install.mjs -o verify-install.mjs
 *   node verify-install.mjs <package-dir> [--name ID] [--version V] [--host zcode|kayingcode] [--json]
 *
 * Zero dependencies. Exit code 0 = safe to register, 1 = do NOT install.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const flag = (k) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : undefined;
};
const json = args.includes("--json");
const checks = [];
const add = (ok, label, detail = "") => checks.push({ ok, label, detail });

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return undefined; }
}

if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  if (json) console.log(JSON.stringify({ ok: false, error: "package directory not found", dir }, null, 2));
  else console.error(`verify-install: directory not found: ${dir}`);
  process.exit(1);
}

const host = flag("host");
const expectedName = flag("name");
const expectedVersion = flag("version");
const manifests = host === "zcode" ? [".zcode-plugin/plugin.json"]
  : host === "kayingcode" ? [".kayingcode-plugin/plugin.json"]
  : [".zcode-plugin/plugin.json", ".kayingcode-plugin/plugin.json"];

const marketFile = path.join(dir, "marketplace.json");
const market = readJson(marketFile);
add(!!market, "marketplace.json is valid JSON", marketFile);
const entry = market?.plugins?.[0];
add(!!entry, "marketplace.json declares a plugin", entry?.name || "none");
if (expectedName && entry) add(entry.name === expectedName, "plugin name matches catalog", `${entry.name} vs ${expectedName}`);
if (expectedVersion && entry) add(entry.version === expectedVersion, "version matches catalog", `${entry.version} vs ${expectedVersion}`);

const found = manifests.find((m) => fs.existsSync(path.join(dir, m)));
add(!!found, "host plugin manifest exists", found || manifests.join(" | "));
if (found) {
  const pm = readJson(path.join(dir, found));
  add(!!pm, `${found} is valid JSON`);
  if (pm && expectedName) add(pm.name === expectedName, `${found} name matches catalog`, `${pm.name} vs ${expectedName}`);
  if (pm && expectedVersion) add(pm.version === expectedVersion, `${found} version matches catalog`, `${pm.version} vs ${expectedVersion}`);
}

for (const f of ["LICENSE", "NOTICE"]) {
  add(fs.existsSync(path.join(dir, f)), `${f} present (third-party notice must travel with the copy)`);
}
add(
  fs.existsSync(path.join(dir, "skills")) || fs.existsSync(path.join(dir, "commands")) || fs.existsSync(path.join(dir, "agents")),
  "package provides skills / commands / agents"
);
for (const danger of [".git", "node_modules"]) {
  add(!fs.existsSync(path.join(dir, danger)), `no ${danger} directory in the installed package`);
}

const ok = checks.every((c) => c.ok);
if (json) {
  console.log(JSON.stringify({ ok, dir, checks, next: ok ? "register this directory as a LOCAL marketplace source" : "do not install" }, null, 2));
} else {
  console.log(`verify-install ${ok ? "PASSED" : "FAILED"} — ${dir}`);
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
  if (ok) console.log("\nNext: register this directory as a LOCAL marketplace source in the host. Never register a remote URL.");
}
process.exit(ok ? 0 : 1);
