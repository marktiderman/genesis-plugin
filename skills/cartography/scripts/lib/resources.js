/**
 * Extract the data layer: what nouns this app addresses, and what is known about each.
 *
 * A screen map answers "where can I go". It cannot answer "what does this touch", which for an
 * app whose complexity is its data patterns is the more important half. This module reads the
 * five places a table can be named and reconciles them into one row per resource.
 *
 * The point is the disagreements. A table declared in the registry but absent from the generated
 * types, or created by a migration and reached only from an edge function, is a real finding —
 * so every source is recorded separately rather than merged into a single "exists" flag.
 *
 * Node built-ins only.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Blank out comments, preserving offsets. A commented-out policy or a `defineResource` inside an
 * example comment otherwise becomes a live resource row — the map inventing tables out of prose.
 */
function stripLine(src, lineToken) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith(lineToken, i)) {
      for (; i < src.length && src[i] !== "\n"; i++) out += " ";
      out += "\n";
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
      i--;
      continue;
    }
    out += src[i];
    if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const q = src[i];
      // A `'` or `"` run may not cross a newline — only a template literal may. Without that
      // limit an apostrophe in JSX text ("Don't") or a quote inside a regex literal (/["']/)
      // opened a string that never closed, and the scanner ran on for a hundred lines with every
      // real comment inside it left un-blanked. Twelve files in one consumer desync that way.
      const start = i;
      let body = "";
      let closed = false;
      for (i++; i < src.length; i++) {
        if (q !== "`" && src[i] === "\n") break;
        body += src[i];
        if (src[i] === "\\" && i + 1 < src.length) {
          body += src[++i];
          continue;
        }
        if (src[i] === q) {
          closed = true;
          break;
        }
      }
      if (closed) out += body;
      else {
        // Not a string after all: emit nothing extra and resume scanning right after the quote.
        i = start;
      }
    }
  }
  return out;
}
const stripJs = (s) => stripLine(s, "//");
const stripSql = (s) => stripLine(s, "--");

/** `export const TABLES = { PEOPLE: "People", ... }` — the legacy jsonb table names. */
export const LEGACY_TABLE_FILES = ["src/lib/content.ts", "src/lib/airtable.ts"];
/** The generated Supabase types — the typed half of the data plane. */
export const TYPES_FILE = "src/integrations/supabase/types.ts";
/** The hand-written registry: the one place a human wrote down what each resource is. */
export const REGISTRY_FILE = "src/lib/resource-registry.ts";
/** App code, scanned for `.from("x")` and `TABLES.KEY` references. */
export const SRC_DIR = "src";
export const MIGRATIONS_DIR = "supabase/migrations";
export const FUNCTIONS_DIR = "supabase/functions";

/**
 * Every place this module reads a table name from, as groups of alternatives — a group is readable
 * if any path in it exists. Named here so the caller can report an absent source instead of
 * silently extracting nothing, and so the list cannot drift from the readers below: each function
 * uses the same constant.
 *
 * This is existence, not inference. It answers "did I have anything to read", never "what is in it".
 */
export const RESOURCE_SOURCES = [
  LEGACY_TABLE_FILES,
  [TYPES_FILE],
  [REGISTRY_FILE],
  [SRC_DIR],
  [MIGRATIONS_DIR],
  [FUNCTIONS_DIR],
];

/**
 * The `export const TABLES = {...}` block, tolerating an optional type annotation
 * (`export const TABLES: Record<string, string> = {`) between the name and the `=`. Ordinary
 * TypeScript — adding one changed nothing about what the object contains — silently cost the map
 * all 24 legacy tables, because the old pattern required `=` to follow `TABLES` with only
 * whitespace between them. The annotation is captured up to the first `=` on the same line, not
 * `[\s\S]`, so this still cannot be satisfied by unrelated code that merely also assigns an
 * object — the colon after `TABLES` is what makes it a type annotation and not a syntax error.
 */
const TABLES_BLOCK = /export const TABLES(?:\s*:\s*[^=\n]+)?\s*=\s*\{([\s\S]*?)\n\}/;

export function legacyTables(root) {
  // The file gets renamed — this one went `airtable.ts` -> `content.ts` and the map silently lost
  // all 24 legacy tables, taking every registry declaration keyed on them along too.
  // Chosen by content, not by existence: `content.ts` is a common filename, and picking a file
  // that merely exists lost all 24 tables to an unrelated namesake.
  for (const rel of LEGACY_TABLE_FILES) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    const block = TABLES_BLOCK.exec(stripJs(readFileSync(p, "utf8")));
    if (block) return Object.fromEntries([...block[1].matchAll(/^\s{0,4}(\w+):\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  }
  return {};
}

/**
 * A `LEGACY_TABLE_FILES` candidate that exists on disk but did not yield a `TABLES` block from
 * *any* present candidate — the disagreement between `missingSources` (existence) and this
 * reader (content) made visible, without failing.
 *
 * `RESOURCE_SOURCES`/`missingSources` answers "did I have anything to read" by `existsSync`, but
 * `legacyTables` reads by content — its own comment above says so. The two silently disagreed: a
 * ordinary TypeScript edit (or any future syntax this parser does not yet handle) left
 * `src/lib/content.ts` present and unreadable, `missingSources` correctly saw no absent file and
 * printed no `·`, and 24 tables vanished from the map with zero marks anywhere pointing at why.
 *
 * This does not fail, and it must not: `src/lib/content.ts` existing with no `TABLES` export is
 * ordinary in a repo that never had legacy Airtable tables — a common filename, not a defect — so
 * treating its mere presence as an error would misfire on every unrelated repo that happens to use
 * it. A `-` on the committed map already catches the row loss as drift; this only supplies the
 * reason a reader would otherwise have to guess at.
 */
export function unparsedLegacyTableFile(root) {
  const present = LEGACY_TABLE_FILES.filter((rel) => existsSync(join(root, rel)));
  return present.length > 0 && Object.keys(legacyTables(root)).length === 0 ? present : null;
}

/** Table names in the generated Supabase types — the typed half of the data plane. */
export function typedTables(root) {
  const p = join(root, TYPES_FILE);
  if (!existsSync(p)) return [];
  const src = readFileSync(p, "utf8");
  const start = src.indexOf("    Tables: {");
  if (start === -1) return [];
  // The block ends at the next key at the same indent (Views/Functions/Enums).
  const rest = src.slice(start + 13);
  const end = rest.search(/\n {4}\w+: \{/);
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^ {6}(\w+): \{$/gm)].map((m) => m[1]).sort();
}

/**
 * Declarations from `resource-registry.ts`: the one place a human wrote down what each resource
 * is, how it is scoped, and whether that scoping is a known hole.
 */
/** The balanced `{...}` following `key:`, or null. Indentation-independent on purpose. */
function bracedAfter(text, key) {
  const at = text.search(new RegExp(`\\b${key}:`));
  if (at === -1) return null;
  const open = text.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

export function declaredResources(root, tables) {
  const p = join(root, REGISTRY_FILE);
  if (!existsSync(p)) return [];
  const src = stripJs(readFileSync(p, "utf8"));
  const out = [];
  for (const chunk of src.split("defineResource({").slice(1)) {
    const head = chunk.slice(0, 4000);
    const named = /name:\s*TABLES\.(\w+)/.exec(head);
    const literal = /name:\s*"([^"]+)"/.exec(head);
    const name = named ? tables[named[1]] : literal?.[1];
    if (!name) continue;
    const fields = bracedAfter(head, "fields");
    out.push({
      name,
      backing: /backing:\s*"(\w+)"/.exec(head)?.[1] ?? null,
      description: /description:\s*"([^"]*)"/.exec(head)?.[1] ?? null,
      fields: fields ? [...fields.matchAll(/^\s*(?:"([^"]+)"|([\w ]+)):\s*"/gm)].map((m) => (m[1] ?? m[2]).trim()) : [],
      scope: /scope:\s*"(\w+)"/.exec(head)?.[1] ?? (/scope:\s*\{/.test(head) ? "rule" : null),
      debt: /\bdebt:\s*true/.test(head),
    });
  }
  return out;
}

/**
 * Table references in a tree, mapped table -> the files that reach it.
 *
 * Two forms, because this app addresses its two halves differently: `.from("x")` for typed
 * Supabase tables, and `TABLES.KEY` for the legacy jsonb ones. Counting only `.from()` reported
 * every legacy table as unreached from `src/` — 24 rows saying the app never touches data it
 * touches on nearly every screen.
 */
export function tableRefs(dir, tables, { label = (f) => f } = {}) {
  const hits = {};
  const byKey = Object.entries(tables);
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      // The registry declares `TABLES.COACHES`; that is a declaration, not a read. Counting it
      // marked five tables the app never touches as reached, contradicting their own `unused` note.
      if (/resource-registry\.(ts|test\.ts)$/.test(e.name)) continue;
      const src = stripJs(readFileSync(path, "utf8"));
      for (const m of src.matchAll(/\.from\(\s*["']([\w.]+)["']/g)) {
        (hits[m[1]] ??= new Set()).add(label(path));
      }
      for (const [key, name] of byKey) {
        if (new RegExp(`\\bTABLES\\.${key}\\b`).test(src)) (hits[name] ??= new Set()).add(label(path));
      }
    }
  };
  walk(dir);
  return hits;
}

/**
 * RLS as the migrations describe it. This is NOT the deployed policy set — a policy changed
 * through the dashboard never appears here — so it is recorded as "what the repo claims" and
 * left for the verification pass to confirm.
 */
export function rlsFromMigrations(root) {
  const dir = join(root, MIGRATIONS_DIR);
  if (!existsSync(dir)) return {};
  const out = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    // Statement by statement, in order. Three separate passes over one file meant a DROP was
    // applied before the policies below it were read, so a table dropped after its own
    // CREATE POLICY came back to life — and scanning raw text for "DROP TABLE" let the words
    // inside a COMMENT or a quoted string delete live tables. A statement is the unit that
    // decides both.
    for (const stmt of sqlStatements(stripSql(readFileSync(join(dir, file), "utf8")))) {
      const drop = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+)$/is.exec(stmt);
      if (drop) {
        for (const name of drop[1].split(",")) {
          const bare = qualifiedName(name.replace(/\b(CASCADE|RESTRICT)\b/i, ""));
          if (bare) delete out[bare];
        }
        continue;
      }
      const rls = /^\s*ALTER\s+TABLE\s+(.+?)\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/is.exec(stmt);
      if (rls) {
        const name = qualifiedName(rls[1]);
        // DISABLE is as real a statement as ENABLE. Recognising only one direction meant a table
        // whose RLS was later turned off still reported it on — overstating protection, which is
        // the one error this field must never make.
        if (name) (out[name] ??= { enabled: false, policies: new Map() }).enabled = /ENABLE/i.test(rls[2]);
        continue;
      }
      // Policies are tracked by name, not as a bare set of commands, so a DROP POLICY can remove
      // exactly the one it names rather than guessing which command to withdraw.
      const drops = /^\s*DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]*"|\w+)\s+ON\s+(.+)$/is.exec(stmt);
      if (drops) {
        const name = qualifiedName(drops[2]);
        out[name]?.policies.delete(drops[1].replace(/^"|"$/g, ""));
        continue;
      }
      // The policy name is consumed as a whole quoted string before ON is looked for; scanning
      // loosely for " ON " found it inside names like "manage fields on own templates".
      const policy = /^\s*CREATE\s+POLICY\s+(?:IF NOT EXISTS\s+)?("[^"]*"|\w+)\s+ON\s+(\S+)([\s\S]*)$/i.exec(stmt);
      if (policy) {
        const name = qualifiedName(policy[2]);
        const entry = (out[name] ??= { enabled: false, policies: new Map() });
        const cmd = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(policy[3]);
        entry.policies.set(policy[1].replace(/^"|"$/g, ""), cmd ? cmd[1].toLowerCase() : "all");
      }
    }
  }
  return out;
}

/**
 * The table identifier from a possibly schema-qualified, possibly quoted target.
 * `"public"."retired"` captured `public` and left `retired` on the map.
 */
function qualifiedName(raw) {
  const parts = [...raw.trim().matchAll(/"([^"]+)"|([\w]+)/g)].map((m) => m[1] ?? m[2]);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * Split SQL into top-level statements, stepping over string literals, quoted identifiers and
 * dollar-quoted bodies. Without this, `DROP TABLE` written inside a COMMENT or a plpgsql body
 * reads as a real drop.
 */
export function sqlStatements(sql) {
  const out = [];
  let buf = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c;
      buf += c;
      for (i++; i < sql.length; i++) {
        buf += sql[i];
        if (sql[i] === q) {
          if (sql[i + 1] === q) buf += sql[++i];
          else break;
        }
      }
      continue;
    }
    const tag = /^\$(\w*)\$/.exec(sql.slice(i, i + 40));
    if (tag) {
      const close = sql.indexOf(tag[0], i + tag[0].length);
      const stop = close === -1 ? sql.length : close + tag[0].length;
      buf += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (c === ";") {
      if (buf.trim()) out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** Edge function names, and which of them bypass JWT verification. */
export function edgeFunctions(root) {
  const dir = join(root, FUNCTIONS_DIR);
  if (!existsSync(dir)) return { names: [], noJwt: [] };
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
  const configPath = join(root, "supabase/config.toml");
  const noJwt = [];
  if (existsSync(configPath)) {
    const cfg = readFileSync(configPath, "utf8");
    for (const m of cfg.matchAll(/\[functions\.([\w-]+)\]([\s\S]*?)(?=\n\[|$)/g)) {
      if (/verify_jwt\s*=\s*false/.test(m[2])) noJwt.push(m[1]);
    }
  }
  return { names, noJwt: noJwt.sort() };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * One row per resource, reconciled across every source.
 *
 * `backing` says where it lives; `declared` says whether a human wrote it down. A resource can be
 * real and undeclared (`edge-only`), which is the finding this table exists to surface.
 */
export function extractResources(root) {
  const tables = legacyTables(root);
  const legacyNames = Object.values(tables);
  const typed = typedTables(root);
  const declared = declaredResources(root, tables);
  const declaredBy = new Map(declared.map((d) => [d.name, d]));
  const appHits = tableRefs(join(root, SRC_DIR), tables);
  const fnDir = join(root, FUNCTIONS_DIR);
  const fnHits = existsSync(fnDir)
    ? tableRefs(fnDir, tables, {
        // `_shared/` is helper modules rather than a function, so it is an imprecise consumer
        // label — but skipping the directory deleted the only evidence for tables reached solely
        // through a helper, dropping those rows from the map entirely. A rough label beats a
        // missing resource; resolving helpers to their importers is the real fix.
        label: (f) => f.slice(fnDir.length + 1).split("/")[0],
      })
    : {};
  const rls = rlsFromMigrations(root);

  const names = [
    ...new Set([
      ...legacyNames,
      ...typed,
      ...declared.map((d) => d.name),
      ...Object.keys(appHits),
      ...Object.keys(fnHits),
      ...Object.keys(rls),
    ]),
  ].sort();

  // A legacy jsonb table and a typed table can carry the same name in different cases — this app
  // has both a `Coaches` content type and a `coaches` table. They are two different stores, so
  // the id is qualified by backing for every member of a collision, and left bare otherwise.
  const slugCounts = {};
  for (const name of names) slugCounts[slug(name)] = (slugCounts[slug(name)] ?? 0) + 1;

  return names.map((name) => {
    const d = declaredBy.get(name);
    const inApp = appHits[name]?.size > 0;
    const usedBy = [...(fnHits[name] ?? [])].sort();
    const backing = legacyNames.includes(name)
      ? "jsonb"
      : typed.includes(name)
        ? "supabase"
        : usedBy.length
          ? "edge-only"
          : "orphan";
    return {
      id: slugCounts[slug(name)] > 1 ? `${slug(name)}--${backing}` : slug(name),
      name,
      backing,
      declared: d ? "resource-registry.ts" : "undeclared",
      // A declaration is the only thing that can say a scope rule is a known hole. Undeclared
      // resources get `unknown` rather than `false` — the schema has to be able to not know.
      scope: d ? (d.scope ?? "unknown") : "unknown",
      debt: d ? String(d.debt) : "unknown",
      fields: d?.fields ?? [],
      rls: rls[name] ? [...new Set(rls[name].policies.values())].sort() : [],
      rls_enabled: rls[name] ? String(rls[name].enabled) : "unknown",
      reached_from_src: String(Boolean(inApp)),
      used_by: usedBy,
      claimed_by: [],
    };
  });
}
