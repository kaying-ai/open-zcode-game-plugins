/**
 * Generate catalog.json and inject the plugin table into both READMEs.
 * Zero dependencies. Deterministic (no timestamps) so --check is stable.
 *
 *   node scripts/build.mjs                # write generated files
 *   node scripts/build.mjs --check        # fail if generated files are stale
 *   node scripts/build.mjs --dry-run      # preview only (used in PR CI)
 *   node scripts/build.mjs --repo=owner/repo
 */
import { validateAll } from "./validate.mjs";
import {
  readText, writeText, stableJson, links, renderTable, injectTable,
  buildCatalog, resolveRepository,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const DRY = argv.includes("--dry-run");

const result = validateAll({ quiet: false });
if (!result.ok) process.exit(1);

const { plugins, config } = result;
const repository = resolveRepository(argv);
const L = links(repository);
const outputs = [
  ["catalog.json", stableJson(buildCatalog(plugins, config, repository))],
  ["README.md", injectTable("README.md", renderTable(plugins, "zh", config))],
  ["README.en.md", injectTable("README.en.md", renderTable(plugins, "en", config))],
];

let changed = 0;
for (const [rel, content] of outputs) {
  let current = "";
  try { current = readText(rel); } catch { current = ""; }
  const differs = current !== content;
  if (differs) changed++;
  if (DRY) continue;
  if (!CHECK && differs) writeText(rel, content);
}

if (DRY) {
  console.log(`\n--- README.md table preview (${plugins.length} plugin(s)) ---`);
  console.log(renderTable(plugins, "zh", config));
  console.log(`\n--- catalog summary ---`);
  console.log(`catalogUrl : ${L.catalogUrl}`);
  console.log(`rawBase    : ${L.rawBase}`);
  console.log(`count      : ${plugins.length}`);
  console.log(`hosts      : ${config.hosts.join(", ")}`);
  console.log(`changed    : ${changed} of ${outputs.length} generated files`);
} else if (CHECK) {
  if (changed) {
    console.error(`generated files are stale (${changed}): run "npm run build" and commit the result`);
    process.exit(1);
  }
  console.log(`generated files are up to date (${outputs.length} files, ${plugins.length} plugin(s))`);
} else {
  console.log(`build ok — ${plugins.length} plugin(s), wrote ${changed} changed file(s)`);
  for (const [rel] of outputs) console.log(`  · ${rel}`);
  if (L.placeholder) {
    console.log("\nNOTE: repository owner is unresolved (no CI/remote-derived value).");
    console.log("      Set catalog.config.json -> repository, or pass --repo=owner/repo.");
    console.log("      GitHub Actions derives it automatically from GITHUB_REPOSITORY.");
  }
}
