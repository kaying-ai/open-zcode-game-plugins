/**
 * `kui init` — create a project workspace from plugin templates.
 *
 * Layout:
 *   default:        <cwd>/<base-dir>/<project-id>/   (base-dir default `specs`)
 *   --into <dir>:   <dir>/                           (flat — dir IS the project)
 *
 * `--root` is the plugin root (templates only). Project files never land inside
 * the plugin package.
 */

import fs from "node:fs";
import path from "node:path";
import { Next, Outcome, Problem } from "./report.mjs";
import {
  Args,
  err,
  findRoot,
  isDir,
  isFile,
  isKebabId,
  mkdirp,
  readText,
  writeRaw,
} from "./util.mjs";

const MARKDOWN_TEMPLATES = [
  "spec.md",
  "research.md",
  "plan.md",
  "tasks.md",
  "quickstart.md",
  "gdd.md",
  "prd.md",
  "interaction.md",
];

const CONTRACT_TEMPLATES = [
  "asset-manifest.yaml",
  "atlas-contract.yaml",
  "component-contract.yaml",
  "export-contract.yaml",
  "screen-contract.yaml",
  "sprite-contract.yaml",
  "style-contract.yaml",
];

const KEEP_DIRS = [
  "assets/pages",
  "assets/components",
  "assets/sprites",
  "assets/atlases",
  "packages",
  "exports",
  "mappings",
  "prompts/pages",
  "prompts/components",
  "contracts",
];

export function run(args) {
  const projectId = args.pos(0);
  if (!projectId) {
    err(
      "usage: kui init <project-id> [--into DIR] [--workspace DIR] [--base-dir specs] [--root DIR] [--force]",
    );
  }
  if (!isKebabId(projectId)) {
    err("project_id must use lowercase letters, numbers, and single hyphens");
  }

  const pluginRoot = findRoot(args.opt("root"));
  const force = args.flag("force");

  let projectDir;
  if (args.opt("into")) {
    projectDir = path.resolve(args.opt("into"));
  } else {
    const workspace = args.opt("workspace")
      ? path.resolve(args.opt("workspace"))
      : process.cwd();
    const baseDir = args.opt("base-dir") ?? "specs";
    if (path.isAbsolute(baseDir) || baseDir.split("/").includes("..")) {
      err("base_dir must be a safe relative path (e.g. specs)");
    }
    projectDir = path.join(workspace, baseDir, projectId);
  }

  // Guard: refuse to write into the plugin package.
  const canon = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const canonProj = canon(projectDir);
  const canonPlugin = canon(pluginRoot);
  if (canonProj === canonPlugin || canonProj.startsWith(canonPlugin + path.sep)) {
    err(
      `refusing to write project into plugin root ${pluginRoot}; use --workspace or --into <user-project-dir>`,
    );
  }

  for (const rel of KEEP_DIRS) mkdirp(path.join(projectDir, rel));

  let written = 0;
  const specTemplates = path.join(pluginRoot, "templates", "spec-kit");
  const contractTemplates = path.join(pluginRoot, "templates", "contracts");

  for (const name of MARKDOWN_TEMPLATES) {
    const src = path.join(specTemplates, name);
    if (!isFile(src)) continue;
    if (copyTemplate(src, path.join(projectDir, name), projectId, force)) written++;
  }
  for (const name of CONTRACT_TEMPLATES) {
    const src = path.join(contractTemplates, name);
    if (!isFile(src)) continue;
    if (copyTemplate(src, path.join(projectDir, "contracts", name), projectId, force)) written++;
  }

  for (const rel of KEEP_DIRS) {
    const keep = path.join(projectDir, rel, ".gitkeep");
    if (!fs.existsSync(keep)) {
      writeRaw(keep, "");
      written++;
    }
  }

  let o = Outcome.ok("init", `initialized ${projectId} (${written} file(s))`)
    .withProject(projectDir)
    .fact("project_id", projectId)
    .fact("files_written", written)
    .artifact(projectDir)
    .withNext(Next.run(`kui validate ${projectDir}`));

  if (written === 0) {
    o.pushWarn(
      new Problem(
        "W_NO_TEMPLATE_WRITE",
        "no templates overwritten",
        "pass --force to refresh templates into an existing project",
      ),
    );
  }
  return o;
}

function copyTemplate(source, target, projectId, force) {
  if (fs.existsSync(target) && !force) return false;
  const text = readText(source).replaceAll("{{PROJECT_ID}}", projectId);
  writeRaw(target, text);
  return true;
}

export { isDir };
