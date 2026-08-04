/**
 * Read and write the frontmatter subset this tool needs.
 *
 * Deliberately not a YAML implementation. It reads scalars and string lists in BOTH flow style
 * (`owns: [a, b]`) and block style (`owns:\n  - a\n  - b`), and it fails loudly on anything else
 * rather than returning a plausible wrong answer.
 *
 * The block-style case is why this file exists: the previous reader matched only
 * `/^owns:\s*\[([^\]]*)\]/m`, so a block list silently parsed as empty — the feature claimed
 * nothing, and because the dead-feature check skips features with no globs, it also vanished from
 * the report. It looked wired up and was wired to nothing, in both directions at once.
 *
 * Quoting is scanned, not regexed, because this reader has to survive its own writer: `yamlScalar`
 * quotes any value containing `#` or `,`, and a reader that strips comments or splits lists before
 * honoring quotes truncates exactly the values quoting was meant to protect.
 */

export class FrontmatterError extends Error {}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Read the quoted string at s[0]; returns [value, index after the closing quote]. */
function readQuoted(s, file) {
  const quote = s[0];
  let out = "";
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (quote === '"' && c === "\\" && i + 1 < s.length) {
      out += s[++i];
      continue;
    }
    // YAML escapes a literal quote inside a single-quoted scalar by doubling it: 'it''s'.
    // Returning at the first one truncates the value and leaves the rest to be read as a comment.
    if (quote === "'" && c === "'" && s[i + 1] === "'") {
      out += "'";
      i++;
      continue;
    }
    if (c === quote) return [out, i + 1];
    out += c;
  }
  throw new FrontmatterError(`${file}: unterminated ${quote} in ${JSON.stringify(s)}`);
}

/** One scalar: a quoted string (any trailing comment ignored), or a bare value up to ` #`. */
function scalar(raw, file) {
  const t = raw.trim();
  if (t[0] === '"' || t[0] === "'") {
    const [value, end] = readQuoted(t, file);
    const tail = t.slice(end).trim();
    if (tail && !tail.startsWith("#")) {
      throw new FrontmatterError(`${file}: trailing text after a quoted value: ${JSON.stringify(raw)}`);
    }
    return value;
  }
  return t.replace(/\s+#.*$/, "").trim();
}

/** Split a flow-list body on top-level commas, stepping over quoted items whole. */
function splitFlow(inner, file) {
  const raws = [];
  let buf = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'") {
      const [, end] = readQuoted(inner.slice(i), file);
      buf += inner.slice(i, i + end);
      i += end - 1;
      continue;
    }
    if (c === ",") {
      raws.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  raws.push(buf);
  return raws.filter((r) => r.trim() !== "").map((r) => scalar(r, file));
}

/** If the value opens a flow list, return its body; otherwise null. */
function flowBody(value, file) {
  if (value[0] !== "[") return null;
  for (let i = 1; i < value.length; i++) {
    const c = value[i];
    if (c === '"' || c === "'") {
      const [, end] = readQuoted(value.slice(i), file);
      i += end - 1;
      continue;
    }
    if (c === "]") {
      const tail = value.slice(i + 1).trim();
      if (tail && !tail.startsWith("#")) {
        throw new FrontmatterError(`${file}: trailing text after a list: ${JSON.stringify(value)}`);
      }
      return value.slice(1, i);
    }
  }
  throw new FrontmatterError(`${file}: unclosed list in ${JSON.stringify(value)}`);
}

/**
 * @returns {Record<string, string|string[]>} scalars and string lists; other shapes are skipped
 */
export function readFrontmatter(text, { file = "<string>" } = {}) {
  const m = FENCE.exec(text);
  if (!m) throw new FrontmatterError(`${file}: no frontmatter block`);

  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue; // nested mapping or continuation — not part of the subset
    const [, key, rest] = kv;
    const value = rest.trim();

    const body = value === "" ? null : flowBody(value, file);
    if (body !== null) {
      out[key] = splitFlow(body, file);
      continue;
    }
    if (value === "") {
      // Possibly a block sequence. Blank lines and comments may precede and separate the items —
      // requiring the very next line to be an item meant `owns:` followed by a comment parsed as
      // empty, so the feature claimed nothing AND was exempt from the dead-feature check. That is
      // the exact both-directions-invisible failure this reader exists to prevent.
      const items = [];
      let j = i;
      while (j + 1 < lines.length) {
        const next = lines[j + 1];
        if (/^\s*-\s+/.test(next)) {
          items.push(scalar(next.replace(/^\s*-\s+/, ""), file));
          j++;
          continue;
        }
        if (next.trim() === "" || next.trimStart().startsWith("#")) {
          j++;
          continue;
        }
        break;
      }
      if (items.length) i = j;
      out[key] = items.length ? items : "";
      continue;
    }
    if (value === ">" || value === "|" || /^[>|][-+\d]*$/.test(value)) {
      throw new FrontmatterError(
        `${file}: block scalar (${key}: ${value}) is outside this reader's subset — ` +
          `use a quoted single-line value`,
      );
    }
    out[key] = scalar(value, file);
  }
  return out;
}

/**
 * Serialize a scalar for a frontmatter value.
 *
 * Unquoted YAML scalars break on `:` followed by a space (parsed as a nested mapping), on a
 * leading reserved character, and on ` #` (silently truncated to a comment). A generated row that
 * makes its own table unparseable is worse than no row, so anything risky is quoted.
 */
export function yamlScalar(v) {
  if (v === null || v === undefined) return "null";
  const s = String(v);
  if (s === "") return '""';
  if (/^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  if (/[:#\[\]{}&*!|>'"%@`,]|^\s|\s$/.test(s)) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return s;
}

/** A flow-style list of scalars, each escaped. */
export const yamlList = (a) => `[${a.map(yamlScalar).join(", ")}]`;
