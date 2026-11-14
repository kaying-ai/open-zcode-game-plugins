/**
 * yaml.mjs — dependency-free YAML subset parser/serializer for kui contracts.
 *
 * Scope (deliberately small, matches every file this toolkit reads or writes):
 *   - block mappings and block sequences, nested by indentation
 *   - compact mapping items inside a sequence (`- key: value`)
 *   - flow collections (`[a, b]`, `{a: 1}`) with nesting and quoted strings
 *   - single/double quoted scalars, plain scalars with type inference
 *   - literal/folded block scalars (`|`, `>`, with `-`/`+` chomping)
 *   - comments, `---` / `...` document markers
 * Not supported (throws a clear error): anchors, aliases, tags, multiple documents.
 *
 * Mappings are returned as `Map` so key order survives a parse → emit round trip;
 * helpers in util.mjs (`mapGet`, `mapSet`, `mapHas`) work on `Map` instances.
 */

export class YamlError extends Error {}

const NULLS = new Set(["", "~", "null", "Null", "NULL"]);
const TRUES = new Set(["true", "True", "TRUE"]);
const FALSES = new Set(["false", "False", "FALSE"]);

function fail(msg, line) {
  throw new YamlError(line ? `line ${line}: ${msg}` : msg);
}

function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

function isBlank(line) {
  return line.trim() === "" || line.trimStart().startsWith("#");
}

/** Split `key: value` respecting quotes. Returns null when the text is not a mapping pair. */
function splitKey(text) {
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }
    if (c === "#" && i > 0 && /\s/.test(text[i - 1])) return null;
    if (c === ":" && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return { key: text.slice(0, i), rest: text.slice(i + 1).trim() };
    }
    i++;
  }
  return null;
}

export function parseYaml(text, opts = {}) {
  const where = opts.file ? `${opts.file}: ` : "";
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  const cur = { lines, i: 0, where };

  skipNoise(cur);
  // document start
  if (cur.i < lines.length && lines[cur.i].trim() === "---") cur.i++;
  skipNoise(cur);
  if (cur.i >= lines.length) return null;

  const value = parseNode(cur, indentOf(lines[cur.i]));

  skipNoise(cur);
  if (cur.i < lines.length && lines[cur.i].trim() === "...") cur.i++;
  skipNoise(cur);
  if (cur.i < lines.length) {
    fail(`unexpected content: ${JSON.stringify(lines[cur.i].trim().slice(0, 40))}`, cur.i + 1);
  }
  return value;
}

function skipNoise(cur) {
  while (cur.i < cur.lines.length && isBlank(cur.lines[cur.i])) cur.i++;
}

function parseNode(cur, indent) {
  const line = cur.lines[cur.i];
  const body = line.slice(indent);
  if (body === "-" || body.startsWith("- ")) return parseSeq(cur, indent);
  if (splitKey(body)) return parseMap(cur, indent);
  // a bare scalar document / nested scalar block
  const value = parseInline(cur, body, indent);
  return value;
}

function parseMap(cur, indent) {
  const out = new Map();
  for (;;) {
    skipNoise(cur);
    if (cur.i >= cur.lines.length) break;
    const line = cur.lines[cur.i];
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) fail("unexpected indentation", cur.i + 1);
    const body = line.slice(ind);
    const pair = splitKey(body);
    if (!pair) {
      fail(`expected "key: value", got ${JSON.stringify(body.slice(0, 40))}`, cur.i + 1);
    }
    const key = parseKey(pair.key);
    cur.i++;
    out.set(key, parseValueAfterKey(cur, pair.rest, indent));
  }
  return out;
}

function parseKey(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") fail("empty mapping key");
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return parseQuoted(trimmed);
  if (trimmed.includes("&") || trimmed.startsWith("*") || trimmed.startsWith("!")) {
    fail("anchors, aliases and tags are not supported");
  }
  return trimmed;
}

/** Value for `key:` — inline scalar/flow, block scalar, nested block, or null. */
function parseValueAfterKey(cur, rest, indent) {
  const cleaned = stripComment(rest);
  if (cleaned === "") {
    skipNoise(cur);
    if (cur.i < cur.lines.length) {
      const next = cur.lines[cur.i];
      const nextIndent = indentOf(next);
      if (nextIndent > indent) return parseNode(cur, nextIndent);
      // indentless sequence: `key:` followed by `- item` at the same indentation
      const nextBody = next.slice(nextIndent);
      if (nextIndent === indent && (nextBody === "-" || nextBody.startsWith("- "))) {
        return parseSeq(cur, indent);
      }
    }
    return null;
  }
  if (/^[|>][+-]?$/.test(cleaned)) return parseBlockScalar(cur, cleaned, indent);
  return parseInline(cur, cleaned, indent);
}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trim();
  }
  return text.trim();
}

function parseBlockScalar(cur, header, indent) {
  const folded = header[0] === ">";
  const chomp = header[1] || "";
  const raw = [];
  let blockIndent = -1;
  while (cur.i < cur.lines.length) {
    const line = cur.lines[cur.i];
    if (line.trim() === "") {
      raw.push("");
      cur.i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= indent) break;
    if (blockIndent < 0) blockIndent = ind;
    if (ind < blockIndent) break;
    raw.push(line.slice(blockIndent));
    cur.i++;
  }
  // drop trailing blanks generated by the loop, keep interior ones
  while (raw.length && raw[raw.length - 1] === "") raw.pop();
  let body = folded ? foldLines(raw) : raw.join("\n");
  if (chomp === "-") return body;
  if (chomp === "+") return `${body}\n`;
  return body === "" ? "" : `${body}\n`;
}

function foldLines(raw) {
  const out = [];
  let prevBlank = false;
  for (const line of raw) {
    if (line === "") {
      out.push("\n");
      prevBlank = true;
      continue;
    }
    if (out.length && !prevBlank) out.push(" ");
    prevBlank = false;
    out.push(line);
  }
  return out.join("").replace(/\n$/, "");
}

function parseSeq(cur, indent) {
  const out = [];
  for (;;) {
    skipNoise(cur);
    if (cur.i >= cur.lines.length) break;
    const line = cur.lines[cur.i];
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) fail("unexpected indentation in sequence", cur.i + 1);
    const body = line.slice(ind);
    if (!(body === "-" || body.startsWith("- "))) break;
    const restRaw = body === "-" ? "" : body.slice(2);
    const content = restRaw.replace(/^\s+/, "");
    const contentIndent = ind + 2 + (restRaw.length - content.length);
    cur.i++;

    if (content === "") {
      skipNoise(cur);
      if (cur.i < cur.lines.length && indentOf(cur.lines[cur.i]) > ind) {
        out.push(parseNode(cur, indentOf(cur.lines[cur.i])));
      } else {
        out.push(null);
      }
      continue;
    }

    const pair = splitKey(content);
    if (pair) {
      // compact mapping item: first pair lives on the "- " line
      const map = new Map();
      const key = parseKey(pair.key);
      map.set(key, parseValueAfterKey(cur, pair.rest, contentIndent));
      // subsequent keys of the same item
      for (;;) {
        skipNoise(cur);
        if (cur.i >= cur.lines.length) break;
        const next = cur.lines[cur.i];
        const nInd = indentOf(next);
        if (nInd !== contentIndent) break;
        const nBody = next.slice(nInd);
        if (nBody === "-" || nBody.startsWith("- ")) break;
        const nPair = splitKey(nBody);
        if (!nPair) fail("expected continuation key in sequence item", cur.i + 1);
        cur.i++;
        map.set(parseKey(nPair.key), parseValueAfterKey(cur, nPair.rest, contentIndent));
      }
      out.push(map);
      continue;
    }

    if (/^[|>][+-]?$/.test(stripComment(content))) {
      out.push(parseBlockScalar(cur, stripComment(content), ind));
      continue;
    }
    out.push(parseInline(cur, stripComment(content), ind));
    // multi-line plain scalar continuation is not supported on purpose
    skipNoise(cur);
    if (cur.i < cur.lines.length && indentOf(cur.lines[cur.i]) > ind) {
      fail("multi-line plain scalars are not supported; quote the value", cur.i + 1);
    }
  }
  return out;
}

function parseInline(cur, text, indent) {
  const t = text.trim();
  if (t === "") return null;
  if (t.startsWith("[") || t.startsWith("{")) return parseFlow(t, cur);
  if (t.startsWith('"') || t.startsWith("'")) return parseQuoted(t, cur);
  if (t.startsWith("&") || t.startsWith("*") || t.startsWith("!")) {
    fail("anchors, aliases and tags are not supported", cur.i);
  }
  return inferScalar(t);
}

function inferScalar(raw) {
  const t = raw.trim();
  if (NULLS.has(t)) return null;
  if (TRUES.has(t)) return true;
  if (FALSES.has(t)) return false;
  if (/^[-+]?\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function parseQuoted(text, cur) {
  const q = text[0];
  if (q === "'") {
    let out = "";
    for (let i = 1; i < text.length; i++) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i++;
          continue;
        }
        return out;
      }
      out += text[i];
    }
    fail("unterminated single-quoted scalar", cur.i);
  }
  let out = "";
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      const n = text[++i];
      const map = {
        n: "\n",
        t: "\t",
        r: "\r",
        "0": "\0",
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
      };
      if (n === "u") {
        out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
        i += 4;
        continue;
      }
      out += map[n] ?? n;
      continue;
    }
    if (c === '"') return out;
    out += c;
  }
  fail("unterminated double-quoted scalar", cur.i);
}

/** Flow collections: `[a, b]` / `{a: 1, b: [2]}`. */
function parseFlow(text, cur) {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const readScalar = (stops) => {
    ws();
    if (text[i] === '"' || text[i] === "'") {
      const start = i;
      const q = text[i];
      i++;
      while (i < text.length) {
        if (text[i] === "\\" && q === '"') i += 2;
        else if (text[i] === q) {
          i++;
          break;
        } else i++;
      }
      return parseQuoted(text.slice(start, i), cur);
    }
    let out = "";
    while (i < text.length && !stops.includes(text[i])) out += text[i++];
    return inferScalar(out.trim());
  };
  const readNode = (stops) => {
    ws();
    if (text[i] === "[") {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (text[i] === "]") {
          i++;
          break;
        }
        arr.push(readNode([",", "]"]));
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") {
          i++;
          break;
        } else if (i >= text.length) fail("unterminated flow sequence", cur.i);
      }
      return arr;
    }
    if (text[i] === "{") {
      i++;
      const map = new Map();
      for (;;) {
        ws();
        if (text[i] === "}") {
          i++;
          break;
        }
        const keyRaw = readScalar([":", "}", ","]);
        ws();
        let val = null;
        if (text[i] === ":") {
          i++;
          val = readNode([",", "}"]);
        }
        map.set(typeof keyRaw === "string" ? keyRaw : String(keyRaw), val);
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") {
          i++;
          break;
        } else if (i >= text.length) fail("unterminated flow mapping", cur.i);
      }
      return map;
    }
    return readScalar(stops);
  };
  const value = readNode([]);
  ws();
  if (i < text.length) fail(`trailing characters in flow value: ${JSON.stringify(text.slice(i))}`, cur.i);
  return value;
}

/* ---------------------------------------------------------------- serialize */

const LEADING_UNSAFE = /^[-?:,\[\]{}#&*!|>'"%@`]/;

function needsQuote(s) {
  if (s === "") return true;
  if (s !== s.trim()) return true;
  if (/[\n\r\t]/.test(s)) return true;
  if (LEADING_UNSAFE.test(s)) return true;
  if (s.startsWith("- ") || s.startsWith("? ") || s.startsWith(": ")) return true;
  if (s.includes(": ") || s.includes(" #") || s.endsWith(":")) return true;
  if (NULLS.has(s) || TRUES.has(s) || FALSES.has(s)) return true;
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return true;
  return false;
}

function quoteScalar(s) {
  if (s.includes("\n") || s.includes("\t") || s.includes("\r")) {
    return JSON.stringify(s);
  }
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function emitScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new YamlError("cannot serialize non-finite number");
    return String(v);
  }
  const s = String(v);
  return needsQuote(s) ? quoteScalar(s) : s;
}

const pad = (n) => " ".repeat(n);

/** One `key: value` head line, dispatching the value to the right block style. */
function emitHead(head, keyIndent, value, out) {
  if (Array.isArray(value) && value.length > 0) {
    out.push(head);
    emitSeq(value, keyIndent, out);
    return;
  }
  if (value instanceof Map && value.size > 0) {
    out.push(head);
    emitMap(value, keyIndent + 2, out);
    return;
  }
  out.push(appendInline(head, value));
}

/** Block mapping; `keyIndent` is the column where key text starts. */
function emitMap(map, keyIndent, out) {
  for (const [k, v] of map.entries()) {
    emitHead(`${pad(keyIndent)}${emitKey(k)}:`, keyIndent, v, out);
  }
}

/** Block sequence; `seqIndent` is the column where `-` starts. */
function emitSeq(arr, seqIndent, out) {
  for (const item of arr) {
    if (item instanceof Map) {
      const entries = [...item.entries()];
      if (entries.length === 0) {
        out.push(`${pad(seqIndent)}- {}`);
        continue;
      }
      const [k0, v0] = entries[0];
      emitHead(`${pad(seqIndent)}- ${emitKey(k0)}:`, seqIndent + 2, v0, out);
      for (const [k, v] of entries.slice(1)) {
        emitHead(`${pad(seqIndent + 2)}${emitKey(k)}:`, seqIndent + 2, v, out);
      }
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length === 0) {
        out.push(`${pad(seqIndent)}- []`);
      } else {
        out.push(`${pad(seqIndent)}-`);
        emitSeq(item, seqIndent + 2, out);
      }
      continue;
    }
    out.push(`${pad(seqIndent)}- ${emitScalar(item)}`);
  }
}

function appendInline(head, v) {
  if (Array.isArray(v)) return `${head} []`;
  if (v instanceof Map) return `${head} {}`;
  return `${head} ${emitScalar(v)}`;
}

function emitKey(k) {
  const s = String(k);
  return needsQuote(s) ? quoteScalar(s) : s;
}

export function dumpYaml(value) {
  const out = [];
  if (value instanceof Map) emitMap(value, 0, out);
  else if (Array.isArray(value)) emitSeq(value, 0, out);
  else out.push(emitScalar(value));
  return out.join("\n");
}
