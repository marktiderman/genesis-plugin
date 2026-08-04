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
// Exported: `resource-edges.js` scans the same component/hook files this module scans repo-wide,
// and has to strip them the same way — two readers disagreeing on what counts as a comment would
// desync silently, the same failure `unparsedLegacyTableFile` exists to catch for a different pair.
export const stripJs = (s) => stripLine(s, "//");
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
// `d` adds `.indices` so `resourceReach` can blank exactly this block's characters in a legacy
// file without touching the rest of it — that file also carries the airtable-shim's real
// `.from("content_records")` calls, so excluding the whole file the way the registry is excluded
// hid a genuine `feature` reach behind the file's own declaration.
const TABLES_BLOCK = /export const TABLES(?:\s*:\s*[^=\n]+)?\s*=\s*\{([\s\S]*?)\n\}/d;

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

/** Where the generated types' table block begins. Named so the reader and its state agree. */
const TABLES_ANCHOR = "    Tables: {";

/**
 * Whether the generated types were absent, unreadable, or read — the same distinction
 * `unparsedLegacyTableFile` draws, for the same reason.
 *
 * A denominator of 0 typed tables has three causes and the ledger stated only one of them. A repo
 * with no `types.ts` and a repo whose `types.ts` this parser cannot follow produced byte-identical
 * output, and `missingSources` is existence-only so the present-but-unreadable case printed no
 * `·` either. "This repo has no typed tables" is a fact; "I could not read the file that would
 * have told me" is not the same fact.
 */
export function typedTablesState(root) {
  const p = join(root, TYPES_FILE);
  if (!existsSync(p)) return "absent";
  // The reader's own anchor, so the two cannot disagree: `typedTables` gives up exactly here.
  return readFileSync(p, "utf8").includes(TABLES_ANCHOR) ? "read" : "unreadable";
}

/** Table names in the generated Supabase types — the typed half of the data plane. */
export function typedTables(root) {
  const p = join(root, TYPES_FILE);
  if (!existsSync(p)) return [];
  const src = readFileSync(p, "utf8");
  const start = src.indexOf(TABLES_ANCHOR);
  if (start === -1) return [];
  // The block ends at the next key at the same indent (Views/Functions/Enums).
  const rest = src.slice(start + TABLES_ANCHOR.length);
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

/** `.from("x")` — the direct-call form. Exported so a single-file scan (`resource-edges.js`,
 * surface reads/writes) uses the identical pattern `tableRefs` uses across a whole tree — two
 * readers of "what counts as a `.from()` call" that quietly diverged would report different tables
 * touched from the same source, and neither number would be wrong loudly enough to notice. */
export const FROM_CALL_RE = /\.from\(\s*["']([\w.]+)["']/g;

/**
 * Regexes licensing a bare string literal as `name` only where a declaration already established
 * it — the third form `tableRefs` reads, and the one `resource-edges.js` reuses for the same
 * reason: `useResource("tasks")` names a resource nowhere but at the call site, so the license to
 * treat that literal as real has to come from somewhere that already declared it a resource.
 *
 * Anchored to a call whose name plausibly addresses a resource. Unanchored, a declared name as the
 * first argument to *any* call counted — `t("tasks")`, `console.log("tasks", x)` — and under the
 * reach ladder that mints the strongest rung, the one the ledger counts. A name matched only by the
 * looser shape falls to `listed` instead, which is the correct direction to fail in.
 */
export function addressedMatchers(addressed) {
  return addressed.map((name) => [
    name,
    new RegExp(String.raw`${RESOURCE_CALL}\(\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\s*[,)]`),
  ]);
}

/**
 * A callee name whose first argument plausibly *addresses* a resource, per the registry's own
 * documented contract for the third form below (`name` is "exactly as `useResource(name)` / the
 * router addresses it"): a `use*` hook, or one of the CRUD verbs a data provider exposes.
 *
 * The third form used to match a declared name as the first argument to *any* call —
 * `t("tasks")`, `console.log("tasks", x)`, a test's `describe("tasks", ...)` — because the regex
 * looked only at what followed the `(`, never at the name before it. That is strictly narrower
 * than reach ever reported under the old boolean, so it was not a regression there, but it can
 * mint a `feature` reach — now the strongest rung on the ladder below, and the one the ledger
 * counts — from a translation call or a log line. Anchoring to a call name the registry's own
 * contract already licenses reads the declaration instead of guessing at one; a name matched only
 * by the old, unanchored shape now falls to `listed` (`resourceReach` below), never `feature`.
 */
const RESOURCE_CALL = String.raw`\b(?:use[A-Z]\w*|getList|getOne|getMany|create|update|delete)\s*(?:<[^<>]*>)?`;

/**
 * Table references in a tree, mapped table -> the files that reach it.
 *
 * Three forms, because an app addresses its data through more than one seam: `.from("x")` for a
 * direct client call, `TABLES.KEY` for the legacy jsonb constants, and — for a resource the
 * registry has already declared by name — that name passed as a recognized call's first argument,
 * which is how a resource reached through a data-provider switchboard is written
 * (`useResource("tasks")`).
 *
 * Counting only `.from()` reported every legacy table as unreached from `src/` — 24 rows saying
 * the app never touches data it touches on nearly every screen — and, later, reported six of the
 * seven resources routed through the provider as reached by nothing, which is precisely the
 * "a table no screen reaches" finding this column exists to raise.
 *
 * The third form is bounded twice over: by `addressed`, so this can confirm a reach but can never
 * invent a table out of a string literal, and by `RESOURCE_CALL`, so the call doing the
 * addressing is one the registry's own contract actually describes.
 */
export function tableRefs(dir, tables, { label = (f) => f, addressed = [] } = {}) {
  const hits = {};
  const byKey = Object.entries(tables);
  // Compiled once, not once per file per key. The walk visits thousands of files and this pattern
  // never varies within a run — `addressedMatchers` below already worked this way.
  const legacyRe = byKey.map(([key, name]) => [new RegExp(String.raw`\bTABLES\.${key}\b`), name]);
  const addressedRe = addressedMatchers(addressed);
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
      for (const m of src.matchAll(FROM_CALL_RE)) {
        (hits[m[1]] ??= new Set()).add(label(path));
      }
      for (const [re, name] of legacyRe) {
        if (re.test(src)) (hits[name] ??= new Set()).add(label(path));
      }
      for (const [name, re] of addressedRe) {
        if (re.test(src)) (hits[name] ??= new Set()).add(label(path));
      }
    }
  };
  walk(dir);
  return hits;
}

/**
 * Test files, by this repo's convention: `*.test.*`, `*.spec.*`, or anything under a
 * `__tests__/` directory. `reach` needs this distinction and `used_by` does not — a function
 * either touches a table or it does not, regardless of who calls it, but a call that exists only
 * to assert a resource is *denied* is not evidence a feature reaches it.
 */
export function isTestFile(path) {
  const norm = path.replace(/\\/g, "/");
  return /\.(test|spec)\.[^./]+$/.test(norm) || /(?:^|\/)__tests__\//.test(norm);
}

/**
 * How far `src/` reaches each candidate resource `name`, resolved into a four-value ladder in
 * strict precedence order — `feature` beats `listed` beats `test` beats `none`:
 *
 *   1. `feature` — a recognized call (`.from("x")`, `TABLES.KEY`, or an addressed call's first
 *      argument — the same three forms `tableRefs` reads) in a NON-TEST file under `src/`.
 *   2. `listed`  — the name appears as a bare, exactly-quoted string literal in a NON-TEST file,
 *      but no recognized call reaches it. Someone wrote the name down; nothing recognized calls it.
 *   3. `test`    — the name appears (in any of the above forms) only inside test files.
 *   4. `none`    — the name appears nowhere under `src/`.
 *
 * This is a separate pass from `tableRefs`/`used_by`, on purpose. `used_by` answers "which edge
 * function touches this table" and rightly counts every file, test included. `reach` answers a
 * different question — "did a feature name this, or only a test proving it's unreachable" — and
 * conflating the two is exactly how a boolean `reached_from_src` came to read `"true"` for a
 * resource whose only call anywhere is
 * `scope-middleware.test.ts`'s `scoped.getList(TABLES.COACHES, {})`, written to assert that call
 * is *denied*. A test proving a table is unreachable is not the table being reached.
 *
 * `listed` deliberately does not try to tell a config file's array of table names from an
 * unrelated string that happens to match one — that would be a heuristic about a file's purpose,
 * and "the literal appears, but no call I recognize uses it" is mechanically checkable without
 * one. The registry is excluded wholesale — the same file `tableRefs` already excludes for the
 * same documented reason: declaring a resource is not reading it. The legacy `TABLES = { KEY:
 * "value" }` file gets the narrower version of that same treatment: only the declaration *block*
 * is blanked before matching, not the whole file, because that file is also the airtable shim —
 * it carries the real `.from("content_records")` calls that back every legacy CRUD operation.
 * Excluding it wholesale, the first cut at this did, put every jsonb table's own `KEY: "Name"`
 * entry out of reach of `listed` as intended, but took a genuine `feature` reach down with it.
 */
export function resourceReach(root, names, tables, { addressed = [] } = {}) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameToKey = new Map(Object.entries(tables).map(([key, name]) => [name, key]));
  const addressedSet = new Set(addressed);
  const perName = names.map((name) => {
    const esc = escape(name);
    const key = nameToKey.get(name);
    return {
      name,
      fromRe: new RegExp(String.raw`\.from\(\s*["']${esc}["']`),
      keyRe: key ? new RegExp(String.raw`\bTABLES\.${key}\b`) : null,
      callRe: addressedSet.has(name)
        ? new RegExp(String.raw`${RESOURCE_CALL}\(\s*["']${esc}["']\s*[,)]`)
        : null,
      literalRe: new RegExp(String.raw`"${esc}"|'${esc}'`),
    };
  });

  const state = new Map(names.map((n) => [n, { feature: false, listed: false, test: false }]));
  const dir = join(root, SRC_DIR);
  const declarationFiles = new Set(
    [REGISTRY_FILE, REGISTRY_FILE.replace(/\.ts$/, ".test.ts")].map((rel) => join(root, rel)),
  );
  const legacyFiles = new Set(LEGACY_TABLE_FILES.map((rel) => join(root, rel)));
  /** Blank just the `TABLES = {...}` block's characters (newlines kept), same idea as `stripLine`
   * blanking a comment: everything else in the file still scans normally. */
  const blankLegacyBlock = (src) => {
    const m = TABLES_BLOCK.exec(src);
    if (!m?.indices) return src;
    const [start, end] = m.indices[1];
    return src.slice(0, start) + src.slice(start, end).replace(/[^\n]/g, " ") + src.slice(end);
  };

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
      if (declarationFiles.has(path)) continue;
      const test = isTestFile(path);
      const stripped = stripJs(readFileSync(path, "utf8"));
      const src = legacyFiles.has(path) ? blankLegacyBlock(stripped) : stripped;
      for (const { name, fromRe, keyRe, callRe, literalRe } of perName) {
        const s = state.get(name);
        // No early exit once `s.feature` is set: the ladder's precedence is decided once, in the
        // final resolution below, from `feature`/`listed`/`test` together — not by which file a
        // directory happens to read first. Skipping further files the moment `feature` was found
        // left `listed` state order-dependent (true only if a listed-only file was read *before*
        // the feature one), which made the final ternary's own precedence untestable: reverting
        // it to check `listed` first passed or failed depending on `readdirSync` order, not on
        // the code.
        const feature = fromRe.test(src) || (keyRe?.test(src) ?? false) || (callRe?.test(src) ?? false);
        const literal = literalRe.test(src);
        if (test) {
          if (feature || literal) s.test = true;
        } else if (feature) {
          s.feature = true;
        } else if (literal) {
          s.listed = true;
        }
      }
    }
  };
  walk(dir);

  return Object.fromEntries(
    names.map((name) => {
      const s = state.get(name);
      return [name, s.feature ? "feature" : s.listed ? "listed" : s.test ? "test" : "none"];
    }),
  );
}

/**
 * A table name as SQL writes it: optionally quoted, optionally schema-qualified.
 *
 * Named once because three statement patterns need the same shape. Each of them used to end its
 * table position with a loose `(.+)`/`(.+?)` and lean on `qualifiedName` taking the last word —
 * which silently makes any trailing keyword the table. `ALTER TABLE t ADD COLUMN n integer,
 * ENABLE ROW LEVEL SECURITY` recorded a table called `integer`, and `DROP POLICY p ON t CASCADE`
 * dropped a policy from a table called `CASCADE`. Both are ordinary Postgres.
 */
const IDENT = String.raw`(?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))*`;

/**
 * `ALTER TABLE [IF EXISTS] [ONLY] name [*] action [, ...]` — the header, and the action list whole.
 *
 * The name is bounded by the grammar rather than by "whatever precedes the keyword I want",
 * because a statement may carry several actions and the one being looked for need not be first.
 */
const ALTER_TABLE = new RegExp(String.raw`^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${IDENT})\s*\*?\s+([\s\S]+)$`, "i");
/** ENABLE/DISABLE (never FORCE — that does not change whether RLS is on) among those actions. */
const RLS_ACTION = /\b(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/gi;
const CREATE_TABLE = new RegExp(String.raw`^\s*CREATE\s+(?:(?:GLOBAL|LOCAL|TEMP|TEMPORARY|UNLOGGED)\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, "i");
const DROP_POLICY = new RegExp(String.raw`^\s*DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]*"|\w+)\s+ON\s+(${IDENT})`, "is");
const CREATE_POLICY = new RegExp(String.raw`^\s*CREATE\s+POLICY\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]*"|\w+)\s+ON\s+(${IDENT})([\s\S]*)$`, "i");

/**
 * What the migrations say about each table: whether this repo creates it, and its RLS.
 *
 * This is NOT the deployed schema or policy set — a table or policy changed through the dashboard
 * never appears here — so it is recorded as "what the repo claims" and left for the verification
 * pass to confirm.
 */
export function migrationFacts(root) {
  const dir = join(root, MIGRATIONS_DIR);
  const created = new Set();
  if (!existsSync(dir)) return { rls: {}, created };
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
          if (bare) {
            delete out[bare];
            created.delete(bare);
          }
        }
        continue;
      }
      const create = CREATE_TABLE.exec(stmt);
      if (create) {
        const name = qualifiedName(create[1]);
        if (name) created.add(name);
        continue;
      }
      const alter = ALTER_TABLE.exec(stmt);
      if (alter) {
        const name = qualifiedName(alter[1]);
        // The action list is searched whole, and only for the RLS action. `ALTER TABLE t ADD
        // COLUMN n integer, ENABLE ROW LEVEL SECURITY` is one legal statement with two actions;
        // reading the name as "everything before the first ENABLE" made `integer` a table with
        // RLS on and left the real one reported as having none.
        const actions = [...alter[2].matchAll(RLS_ACTION)];
        // Last wins: Postgres applies actions in order. DISABLE is as real a statement as ENABLE.
        // Recognising only one direction meant a table whose RLS was later turned off still
        // reported it on — overstating protection, which is the one error this field must never
        // make. Applying it to the wrong table is the same error by another route.
        if (name && actions.length) {
          (out[name] ??= { enabled: false, policies: new Map() }).enabled = /ENABLE/i.test(actions.at(-1)[1]);
        }
        continue;
      }
      // Policies are tracked by name, not as a bare set of commands, so a DROP POLICY can remove
      // exactly the one it names rather than guessing which command to withdraw.
      const drops = DROP_POLICY.exec(stmt);
      if (drops) {
        const name = qualifiedName(drops[2]);
        out[name]?.policies.delete(drops[1].replace(/^"|"$/g, ""));
        continue;
      }
      // The policy name is consumed as a whole quoted string before ON is looked for; scanning
      // loosely for " ON " found it inside names like "manage fields on own templates".
      const policy = CREATE_POLICY.exec(stmt);
      if (policy) {
        const name = qualifiedName(policy[2]);
        const entry = (out[name] ??= { enabled: false, policies: new Map() });
        const cmd = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(policy[3]);
        entry.policies.set(policy[1].replace(/^"|"$/g, ""), cmd ? cmd[1].toLowerCase() : "all");
      }
    }
  }
  return { rls: out, created };
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
 * `backing` says where it lives — `jsonb` (a legacy content constant), `supabase` (in the
 * generated types), `migration` (created by a migration here but absent from those types),
 * `edge-only` (named by an edge function and nowhere else) or `orphan` (named by nothing that
 * defines it). `declared` says whether a human wrote it down. A resource can be real and
 * undeclared, which is the finding this table exists to surface.
 */
export function extractResources(root) {
  const tables = legacyTables(root);
  const legacyNames = Object.values(tables);
  const typed = typedTables(root);
  const declared = declaredResources(root, tables);
  const declaredBy = new Map(declared.map((d) => [d.name, d]));
  // The registry's `name` is documented as "the name exactly as `useResource(name)` / the router
  // addresses it", so it is the declaration that licenses looking for that literal in a call.
  const addressed = declared.map((d) => d.name);
  const appHits = tableRefs(join(root, SRC_DIR), tables, { addressed });
  const fnDir = join(root, FUNCTIONS_DIR);
  const fnHits = existsSync(fnDir)
    ? tableRefs(fnDir, tables, {
        addressed,
        // `_shared/` is helper modules rather than a function, so it is an imprecise consumer
        // label — but skipping the directory deleted the only evidence for tables reached solely
        // through a helper, dropping those rows from the map entirely. A rough label beats a
        // missing resource; resolving helpers to their importers is the real fix.
        label: (f) => f.slice(fnDir.length + 1).split("/")[0],
      })
    : {};
  const { rls, created } = migrationFacts(root);

  const names = [
    ...new Set([
      ...legacyNames,
      ...typed,
      ...declared.map((d) => d.name),
      ...Object.keys(appHits),
      ...Object.keys(fnHits),
      ...Object.keys(rls),
      ...created,
    ]),
  ].sort();

  // A legacy jsonb table and a typed table can carry the same name in different cases — this app
  // has both a `Coaches` content type and a `coaches` table. They are two different stores, so
  // the id is qualified by backing for every member of a collision, and left bare otherwise.
  const slugCounts = {};
  for (const name of names) slugCounts[slug(name)] = (slugCounts[slug(name)] ?? 0) + 1;

  // A second pass over `src/`, once `names` is closed: `appHits` above exists to discover names
  // (a `.from("x")` call can name a table nothing else does), while `reach` classifies the names
  // already found — the two questions need different answers per file (test or not) that a single
  // `table -> Set(files)` map does not carry.
  const reach = resourceReach(root, names, tables, { addressed });

  return names.map((name) => {
    const d = declaredBy.get(name);
    const usedBy = [...(fnHits[name] ?? [])].sort();
    // `migration` sits above `edge-only`/`orphan` because a `CREATE TABLE` in this repo's own
    // migrations is the strongest statement of where a table lives that a repo can make, and the
    // ladder used never to consult it: a monorepo whose data layer is migrations and edge
    // functions — no generated types, no `src/` — reported 26 of its 28 tables as `edge-only`
    // ("exists only because a function names it") or `orphan` ("nothing defines or reaches it")
    // while its own migrations create every one. Three of those rows said `rls_enabled: "true"`
    // and `backing: "orphan"` side by side, which cannot both be read from the same file.
    const backing = legacyNames.includes(name)
      ? "jsonb"
      : typed.includes(name)
        ? "supabase"
        : created.has(name)
          ? "migration"
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
      reach: reach[name],
      used_by: usedBy,
      claimed_by: [],
    };
  });
}
