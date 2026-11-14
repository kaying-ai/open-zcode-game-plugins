/**
 * `kui skills` — validate skill metadata, size, and local Markdown references.
 */

import path from "node:path";
import { Next, Outcome, Problem } from "./report.mjs";
import { err, exists, findRoot, isKebabId, isFile, readdir, readText } from "./util.mjs";
import { parseYaml } from "./yaml.mjs";

function validateSkill(p) {
  const errors = [];
  let text;
  try {
    text = readText(p);
  } catch (e) {
    return [e.message];
  }

  const parts = text.split("---");
  if (parts.length < 3 || parts[0].trim() !== "") {
    return [`${p}: missing YAML frontmatter`];
  }
  let meta;
  try {
    meta = parseYaml(parts[1], { file: p });
  } catch (e) {
    return [`${p}: invalid frontmatter: ${e.message}`];
  }
  if (!(meta instanceof Map)) {
    return [`${p}: frontmatter must be a mapping`];
  }

  const name = meta.get("name");
  if (typeof name === "string" && isKebabId(name)) {
    const dirName = path.basename(path.dirname(p));
    if (name !== dirName) {
      errors.push(`${p}: name must match directory ${JSON.stringify(dirName)}`);
    }
  } else {
    errors.push(`${p}: invalid skill name ${JSON.stringify(typeof name === "string" ? name : "")}`);
  }

  const description = meta.get("description");
  if (typeof description !== "string" || description.trim() === "") {
    errors.push(`${p}: description is required`);
  } else if ([...description].length > 1024) {
    errors.push(`${p}: description exceeds 1024 characters`);
  }

  if (countLines(text) >= 500) {
    errors.push(`${p}: SKILL.md must stay under 500 lines`);
  }

  let i = 0;
  while (i + 1 < text.length) {
    if (text[i] === "[") {
      const close = text.indexOf("](", i);
      if (close >= 0) {
        const linkStart = close + 2;
        const end = text.indexOf(")", linkStart);
        if (end >= 0) {
          const target = text.slice(linkStart, end);
          if (
            !target.startsWith("http://") &&
            !target.startsWith("https://") &&
            !target.startsWith("#")
          ) {
            const local = target.split("#")[0];
            if (local !== "") {
              const targetPath = path.join(path.dirname(p), local);
              if (!exists(targetPath)) {
                errors.push(`${p}: missing linked file ${JSON.stringify(target)}`);
              }
            }
          }
          i = end + 1;
          continue;
        }
      }
    }
    i++;
  }
  return errors;
}

function countLines(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

export function run(args) {
  const skillsDir = args.pos(0) ?? path.join(findRoot(args.opt("root")), "skills");
  const paths = [];
  let entries;
  try {
    entries = readdir(skillsDir);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    if (isFile(skillMd)) paths.push(skillMd);
  }
  paths.sort();
  if (paths.length === 0) err(`no skills found under ${skillsDir}`);

  let o = Outcome.ok("skills", "");
  let nErr = 0;
  for (const p of paths) {
    for (const message of validateSkill(p)) {
      nErr++;
      o.pushError(
        new Problem(
          "E_SKILL",
          message,
          "fix the SKILL.md frontmatter, line count, or linked path",
        ).at(p),
      );
    }
  }
  o = o.fact("skill_count", paths.length);
  o.summary = nErr === 0 ? `validated ${paths.length} skill(s)` : `${nErr} skill error(s)`;
  o = o.withNext(Next.none());
  return o.finalize();
}
