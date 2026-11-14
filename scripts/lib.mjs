/**
 * Shared helpers for the plugin catalog.
 * Zero third-party dependencies: Node >= 18 only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const START = "<!-- PLUGINS:START -->";
export const END = "<!-- PLUGINS:END -->";

export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
export const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
export const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

export function writeText(rel, content) {
  const target = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.replace(/\r\n/g, "\n"), "utf8");
}

export const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function loadConfig() {
  return readJson("catalog.config.json");
}

/**
 * Repository resolution order (first match wins):
 *   --repo=<owner>/<repo> | GITHUB_REPOSITORY | CATALOG_REPOSITORY
 *   | git remote origin | catalog.config.json
 * GitHub Actions sets GITHUB_REPOSITORY automatically, so published catalogs
 * always contain the correct URLs with no manual editing.
 */
export function resolveRepository(argv = process.argv.slice(2)) {
  const flag = argv.find((a) => a.startsWith("--repo="));
  const candidates = [
    flag?.slice("--repo=".length),
    process.env.GITHUB_REPOSITORY,
    process.env.CATALOG_REPOSITORY,
    gitRemoteOrigin(),
  ];
  for (const c of candidates) {
    const parsed = parseRepo(c);
    if (parsed) return parsed;
  }
  const fallback = loadConfig().repository || "https://github.com/kayingai/open-zcode-game-plugins";
  return { url: fallback, owner: "kayingai", repo: "open-zcode-game-plugins", placeholder: true };
}

function gitRemoteOrigin() {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function parseRepo(raw) {
  if (!raw) return undefined;
  let s = raw.trim().replace(/\.git$/, "");
  // git@gitee.com:owner/repo.git / ssh://git@github.com/owner/repo
  const scp = s.match(/^[\w.-]+@[^:]+:(.+)$/);
  if (scp) s = scp[1];
  const url = s.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (url) s = url[1];
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];
  if (!owner || !repo || /\s/.test(owner + repo)) return undefined;
  return { url: `https://github.com/${owner}/${repo}`, owner, repo, placeholder: false };
}

export function links(repository) {
  const branch = loadConfig().branch || "main";
  const { owner, repo } = repository;
  return {
    rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`,
    browseBase: `https://github.com/${owner}/${repo}/tree/${branch}/`,
    archiveUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.tar.gz`,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    catalogUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/catalog.json`,
    placeholder: repository.placeholder === true,
  };
}

export function listPluginFiles() {
  const dir = path.join(ROOT, "plugins");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_") && !f.startsWith("."))
    .sort();
}

export function loadPlugins() {
  return listPluginFiles().map((file) => ({
    file,
    rel: `plugins/${file}`,
    data: readJson(`plugins/${file}`),
  }));
}

/** Deterministic Markdown table for both README languages. */
export function renderTable(plugins, lang, config) {
  const zh = lang === "zh";
  const pick = (obj, fallback) => (obj && obj[zh ? "zh-CN" : "en"]) || fallback;
  const header = zh
    ? "| 插件 | 分类 | 支持宿主 | 版本 | 许可 | 说明 |\n| --- | --- | --- | --- | --- | --- |"
    : "| Plugin | Category | Hosts | Version | License | Description |\n| --- | --- | --- | --- | --- | --- |";
  const rows = [...plugins]
    .sort((a, b) => a.data.name.localeCompare(b.data.name))
    .map(({ data }) => {
      const title = pick(data.displayName_i18n, data.displayName || data.name);
      const desc = pick(data.description_i18n, data.description).replace(/\|/g, "\\|").replace(/\n/g, " ");
      const cat = config.categories[data.category]?.[zh ? "zh-CN" : "en"] || data.category;
      const hosts = data.hosts.map((h) => `\`${h}\``).join(" · ");
      const url = data.repository;
      return `| **[${title}](${url})** \`${data.name}\` | ${cat} | ${hosts} | \`${data.version}\` | \`${data.license}\` | ${desc} |`;
    });
  const footer = zh
    ? `\n\n> 共 ${plugins.length} 个插件。本表由 \`scripts/build.mjs\` 自动生成，请勿手动编辑。`
    : `\n\n> ${plugins.length} plugin(s). This table is generated by \`scripts/build.mjs\` — do not edit by hand.`;
  return `${START}\n${header}\n${rows.join("\n")}\n${END}${footer}`;
}

export function injectTable(rel, table) {
  const source = readText(rel);
  const re = new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}[^\\n]*(?:\\n\\n>[^\\n]*)?`);
  if (!re.test(source)) throw new Error(`${rel}: missing ${START} / ${END} markers`);
  return source.replace(re, table);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build the machine-readable catalog consumed by Agents. */
export function buildCatalog(plugins, config, repository) {
  const L = links(repository);
  return {
    schemaVersion: config.schemaVersion,
    name: config.name,
    description: config.description,
    description_i18n: config.description_i18n,
    license: config.license,
    unofficial: true,
    notice: "Not an official ZCode project. Not affiliated with or endorsed by Z.AI / Zhipu AI.",
    upstream: [
      { name: "ZCode", url: "https://github.com/zai-org/ZCode", license: "Apache-2.0", role: "compatible host" },
      { name: "zcode-plugins", url: "https://github.com/zai-org/zcode-plugins", license: "Apache-2.0", role: "official marketplace format reference" },
      { name: "KayingCode", url: "https://gitee.com/citiao/ZCode", license: "Apache-2.0", role: "compatible host (unofficial ZCode derivative)" },
    ],
    repository: repository.url,
    catalogUrl: L.catalogUrl,
    rawBase: L.rawBase,
    browseBase: L.browseBase,
    archiveUrl: L.archiveUrl,
    cloneUrl: L.cloneUrl,
    branch: config.branch,
    hosts: config.hosts,
    categories: config.categories,
    count: plugins.length,
    protocol: {
      version: "1.0",
      strategy: "github-to-local-source",
      reason: "KayingCode.localrun and local-first hosts reject remote marketplace / CDN plugin sources.",
      steps: [
        "Fetch this catalog.json over HTTPS (do not cache indefinitely).",
        "Filter entries by hosts, category and keywords; read description_i18n for the user's language.",
        "Resolve source.type: bundled (files inside this repo), git (clone at source.ref), or zip (download and verify sha256).",
        "Place the host package directory at a stable local path; never write into the host's internal state directly.",
        "Verify marketplace.json and the plugin manifest exist and that name/version match this entry; verify LICENSE / NOTICE are present.",
        "Register the local directory as a local marketplace source (or add it to plugins.dirs), then install and enable the plugin.",
        "Report what was installed, its version, and the exact local path to the user.",
      ],
      constraints: [
        "HTTPS only; prefer immutable commit SHAs over mutable tags.",
        "Verify sha256 whenever source.type is zip; abort on mismatch.",
        "Never register a remote GitHub URL as a marketplace source in local-first hosts.",
        "Do not execute plugin install scripts, hooks, or downloaded binaries without user review.",
        "Do not overwrite an existing installed plugin without a backup and explicit confirmation.",
        "The plugin's own license applies, not this repository's Apache-2.0.",
      ],
    },
    plugins: plugins
      .sort((a, b) => a.data.name.localeCompare(b.data.name))
      .map(({ rel, data }) => {
        const { $schema, ...entry } = data;
        const packages = {};
        for (const [host, pkg] of Object.entries(data.source.packages)) {
          packages[host] = {
            ...pkg,
            browseUrl: data.source.type === "bundled" ? `${L.browseBase}${pkg.path}` : undefined,
            marketplaceUrl: data.source.type === "bundled" ? `${L.rawBase}${pkg.path}/${pkg.marketplace}` : undefined,
          };
        }
        return {
          ...entry,
          source: { ...data.source, packages },
          catalog: {
            entryUrl: `${L.rawBase}${rel}`,
            entryBrowseUrl: `${L.browseBase}${rel}`,
            rawBase: L.rawBase,
            archiveUrl: L.archiveUrl,
            cloneUrl: L.cloneUrl,
          },
        };
      }),
  };
}
