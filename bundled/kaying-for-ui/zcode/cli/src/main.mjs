#!/usr/bin/env node
/**
 * kui — kaying-for-ui agent toolkit (Node implementation, no Rust toolchain).
 *
 * Agent protocol:
 *   - text:  STATUS / SUMMARY / NEXT / FACT / ARTIFACT / ERROR|WARN (with FIX)
 *   - json:  `--json` → single JSON object, same fields
 *   - exit:  0 ok · 1 failed (fix errors) · 2 error (do not retry same args)
 *
 * Subcommands: init · validate · skills · split · atlas · export · web · doctor
 */

import path from "node:path";
import { Args, findRoot, isDir, isFile } from "./util.mjs";
import { Outcome, Problem, Next, emit, errOutcome } from "./report.mjs";
import * as init from "./init.mjs";
import * as validate from "./validate.mjs";
import * as skills from "./skills.mjs";
import * as split from "./split.mjs";
import * as atlas from "./atlas.mjs";
import * as exporter from "./export.mjs";
import * as web from "./web.mjs";

function usage() {
  return `kui — kaying-for-ui toolkit (agent protocol)

USAGE:
  kui <command> [args…] [--json]

COMMANDS:
  init <project-id> [--into DIR] [--workspace DIR] [--base-dir specs] [--root DIR] [--force]
        --into DIR   project files go directly into DIR (flat)
        default      <cwd>/specs/<project-id>/   (never inside the plugin package)
  validate <project-dir> [--strict]
  skills [skills-dir]
  split <source.png> [--output-dir D] [--zip Z] [--mode auto|alpha|background]
        [--alpha-threshold N] [--background-tolerance N] [--connect-gap N]
        [--min-area N] [--padding N] [--prefix P] [--mapping F] [--force]
  atlas <project> [--sprite-contract F] [--atlas-contract F] [--force]
  export <project> [--atlas-contract F] [--export-contract F] [--root DIR] [--force]
        engines: godot · unity · cocos · generic · taptap-maker
        each engine folder also gets README.md (agent apply guide)
  web <project> [--root DIR] [--force]
  doctor

AGENT OUTPUT (text):
  STATUS: ok|failed|error
  SUMMARY: <one line>
  NEXT: <exact next command | read <path> | wait_user: <prompt> | none>
  FACT: key=value
  ARTIFACT: <path>
  ERROR: CODE | path | message | FIX: <how>
  WARN:  CODE | path | message | FIX: <how>

EXIT CODES:
  0  ok — continue
  1  failed — fix every ERROR line first
  2  error — usage/env/missing input; change args before retry

JSON MODE:
  add --json → one JSON object with ok/status/exit_code/summary/project/artifacts/errors/warnings/next/facts
  Each problem: {code, path, message, fix}
  next: {action: run|read|wait_user|none, command|path|prompt}

RUNTIME:
  requires Node.js >= 18 (cli/bin/kui is a thin launcher for cli/src/main.mjs)

DELIVERY (when work complete):
  open specs/<id>/index.html — host right/preview panel if available;
  else link in task summary + system browser (open/xdg-open/start).
  See skills/kaying-for-ui/SKILL.md §7.

Workflow & gates: skills/kaying-for-ui/SKILL.md
`;
}

const COMMANDS = {
  init,
  validate,
  skills,
  split,
  atlas,
  export: exporter,
  web,
  doctor: { run: doctor },
};

function doctor(args) {
  const root = findRoot(args.opt("root"));
  let o = Outcome.ok("doctor", `plugin root ${root}`).fact("root", root);
  const missing = [];
  // `skills/` exists in the full plugin package. A self-contained skill bundle
  // (WorkBuddy "Upload Skill") has no skills/ level: its resources are expanded
  // into a cache directory, so KUI_ROOT points there and the skill payload lives
  // next to the scripts that were installed instead.
  const selfContainedSkill =
    Boolean(process.env.KUI_ROOT) ||
    (isFile(path.join(root, "SKILL.md")) && isDir(path.join(root, "references")));
  for (const rel of ["templates/spec-kit", "templates/contracts", "schemas", "config", "skills"]) {
    if (isDir(path.join(root, rel))) o = o.fact(`has_${rel}`, "true");
    else if (rel === "skills" && selfContainedSkill) o = o.fact("layout", "self-contained-skill");
    else {
      missing.push(rel);
      o.pushError(
        new Problem(
          "E_MISSING_RESOURCE",
          `missing ${rel}/`,
          "reinstall the plugin package or restore the directory from source",
        ).at(rel),
      );
    }
  }
  o = o.fact("binary", process.argv[1] ?? "kui").artifact(root);
  if (missing.length === 0) {
    o = o.withNext(Next.run("kui init <project-id>"));
    o.summary = `ready at ${root}`;
  } else {
    o = o.withNext(Next.none());
  }
  return o;
}

function fixHint(msg) {
  if (msg.includes("usage:")) return "run `kui --help` and supply the required arguments";
  if (msg.includes("not found") || msg.includes("does not exist")) {
    return "verify the path exists and is readable, then retry with the corrected path";
  }
  if (msg.includes("--force")) return "pass --force to overwrite, or choose a different output path";
  if (msg.includes("plugin root") || msg.includes("templates")) {
    return "run `kui doctor`; if root is wrong, pass --root <plugin-root>";
  }
  return "inspect the message; fix the input or environment, then retry";
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || ["-h", "--help", "help"].includes(argv[0])) {
    process.stdout.write(usage());
    return 0;
  }
  const cmd = argv[0];
  const args = Args.parse(argv.slice(1));
  const jsonMode = args.flag("json");

  let outcome;
  try {
    const mod = COMMANDS[cmd];
    if (!mod) throw Object.assign(new Error(`unknown command: ${cmd}`), { cli: true });
    outcome = mod.run(args);
  } catch (e) {
    if (!e.cli) throw e;
    outcome = errOutcome(cmd, e.message, fixHint(e.message));
  }
  return emit(outcome, jsonMode);
}

process.exitCode = main();
