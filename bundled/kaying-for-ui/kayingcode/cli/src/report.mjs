/**
 * report.mjs — agent-facing result protocol for `kui`.
 *
 * Text mode:
 *   STATUS: ok|failed|error
 *   SUMMARY: <one line>
 *   PROJECT: <path>            (optional)
 *   NEXT: <single actionable next step>
 *   FACT: key=value            (0..n)
 *   ARTIFACT: <path>           (0..n)
 *   ERROR: CODE | path | msg | FIX: how
 *   WARN:  CODE | path | msg | FIX: how
 *
 * JSON mode (--json): one object with ok/command/status/exit_code/summary/project/
 * artifacts/errors/warnings/next/facts.
 *
 * Exit codes: 0 ok · 1 failed (fix ERROR items) · 2 error (do not retry same args).
 */

export const STATUS = { ok: "ok", failed: "failed", error: "error" };

const EXIT = { ok: 0, failed: 1, error: 2 };

export class Problem {
  constructor(code, message, fix, path = null) {
    this.code = code;
    this.message = message;
    this.fix = fix;
    this.path = path;
  }

  at(p) {
    this.path = p;
    return this;
  }
}

export class Next {
  constructor(action, { command = null, prompt = null, path = null } = {}) {
    this.action = action;
    this.command = command;
    this.prompt = prompt;
    this.path = path;
  }

  static run(command) {
    return new Next("run", { command });
  }

  static none() {
    return new Next("none");
  }

  static waitUser(prompt) {
    return new Next("wait_user", { prompt });
  }

  static read(path) {
    return new Next("read", { path });
  }
}

export class Outcome {
  constructor(command, status, summary) {
    this.command = command;
    this.status = status;
    this.summary = summary;
    this.project = null;
    this.artifacts = [];
    this.errors = [];
    this.warnings = [];
    this.next = Next.none();
    this.facts = [];
  }

  static ok(command, summary = "") {
    return new Outcome(command, STATUS.ok, summary);
  }

  static error(command, summary) {
    return new Outcome(command, STATUS.error, summary);
  }

  withProject(p) {
    this.project = p;
    return this;
  }

  withNext(n) {
    this.next = n;
    return this;
  }

  artifact(p) {
    this.artifacts.push(p);
    return this;
  }

  fact(k, v) {
    this.facts.push([k, v]);
    return this;
  }

  pushError(p) {
    this.errors.push(p);
    this.status = STATUS.failed;
  }

  pushWarn(p) {
    this.warnings.push(p);
  }

  mergeProblems(errors, warnings) {
    this.errors.push(...errors);
    this.warnings.push(...warnings);
    if (this.errors.length) this.status = STATUS.failed;
  }

  finalize() {
    if (this.errors.length && this.status === STATUS.ok) this.status = STATUS.failed;
    if (!this.errors.length && this.status === STATUS.failed) this.status = STATUS.ok;
    return this;
  }

  toJson() {
    return {
      ok: this.status === STATUS.ok,
      command: this.command,
      status: this.status,
      exit_code: EXIT[this.status],
      summary: this.summary,
      project: this.project,
      artifacts: this.artifacts,
      errors: this.errors.map(problemJson),
      warnings: this.warnings.map(problemJson),
      next: {
        action: this.next.action,
        command: this.next.command,
        prompt: this.next.prompt,
        path: this.next.path,
      },
      facts: Object.fromEntries(this.facts.map(([k, v]) => [k, v])),
    };
  }

  toText() {
    const lines = [];
    lines.push(`STATUS: ${this.status}`);
    lines.push(`SUMMARY: ${this.summary}`);
    if (this.project) lines.push(`PROJECT: ${this.project}`);
    lines.push(`NEXT: ${nextText(this.next)}`);
    for (const [k, v] of this.facts) lines.push(`FACT: ${k}=${factDisplay(v)}`);
    for (const a of this.artifacts) lines.push(`ARTIFACT: ${a}`);
    for (const e of this.errors) lines.push(problemLine("ERROR", e));
    for (const w of this.warnings) lines.push(problemLine("WARN ", w));
    return `${lines.join("\n")}\n`;
  }
}

function problemJson(p) {
  return { code: p.code, path: p.path, message: p.message, fix: p.fix };
}

function problemLine(kind, p) {
  return `${kind}: ${p.code} | ${p.path ?? "-"} | ${p.message} | FIX: ${p.fix}`;
}

function factDisplay(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function nextText(next) {
  switch (next.action) {
    case "run":
      return next.command ?? "run (unspecified)";
    case "read":
      return `read ${next.path ?? "-"}`;
    case "wait_user":
      return `wait_user: ${next.prompt ?? "(user decision)"}`;
    case "none":
      return "none — stage complete, stop for user gate or next stage";
    default:
      return next.action;
  }
}

/** Convert an execution failure into an Outcome (status=error). */
export function errOutcome(command, message, fix) {
  const o = Outcome.error(command, message);
  o.errors.push(new Problem("E_EXEC", message, fix));
  o.next = Next.none();
  return o;
}

/** Print the outcome and return the process exit code. */
export function emit(outcome, jsonMode) {
  const o = outcome.finalize();
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(o.toJson(), null, 2)}\n`);
  } else {
    process.stdout.write(o.toText());
  }
  return EXIT[o.status];
}
