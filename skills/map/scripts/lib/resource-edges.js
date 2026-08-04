/**
 * Surface -> resource edges: which resources a surface reads and writes.
 *
 * The surfaces table says where you can go; the resources table says what tables exist. Neither
 * says whether `SessionsPage` touches `Sessions`, which is what turns an inventory into something
 * that answers "if I change this table, what breaks". This module reads the evidence CLAUDE.md's
 * "Data Flow" describes it living in — a surface's own component file, plus the hooks it imports
 * directly (one hop, never followed further) — and resolves every table/resource name it finds
 * against the same names `extractResources` already reconciled, so a `reads`/`writes` value is a
 * resource `id` that joins straight to a `data/resources/<id>.md` row.
 *
 * Coverage is uneven ON PURPOSE, matching how unevenly this app's own data layer is written
 * (CLAUDE.md's "Data Flow", three patterns):
 *
 *   1. legacy jsonb, `TABLES.KEY` passed to one of a small, closed set of generic hooks
 *      (`useContentRecords`, `useScopedRecords`, `useCreateContentRecord`, ...). Read AND write,
 *      because the hook's own name says which — `CONTENT_HOOK_VERBS` below is that closed list.
 *   2. a hand-written hook calling `supabase.from("x")` directly. Read AND write, from the verb
 *      chained onto that same `.from(` call: `.insert`/`.update`/`.upsert`/`.delete` is a write,
 *      anything else — including nothing this scan recognizes — is read.
 *   3. Genesis-native `useResource`/`useOne`. READ ONLY, never write. The hook's return value
 *      always bundles `create`/`update`/`remove` (`@marktiderman/genesis-core`'s `useResource`),
 *      whether or not a caller ever touches them, and this module has no way to see which
 *      properties of that return value a caller destructures and calls. Recording every resource
 *      reached this way as read-only is the safe direction: a real write made through this path
 *      goes unreported, which is invisible, not wrong — the one rule that matters more than the
 *      feature.
 *
 * A table this scan cannot resolve to a literal name — passed through a variable, imported by a
 * convention this repo does not use — is not guessed at. It is simply absent, the same
 * "invisible rather than invented" rule the rest of map holds to. A name it DOES resolve
 * but that `extractResources` never saw from any of its own sources is dropped rather than
 * minted into a resource id: that should not happen (every form here is a form `tableRefs` in
 * `resources.js` already reads across the whole tree), but a defensive skip costs nothing and an
 * invented resource id costs a false fact.
 *
 * A verb this scan cannot decide either way is read, never write — the same asymmetry `check`
 * applies to every security-relevant fact this tool states: overstating access is the one error
 * these fields must never make.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FROM_CALL_RE, addressedMatchers, stripJs } from "./resources.js";

/**
 * The generic CRUD entry points over the legacy `content_records` shim
 * (`src/hooks/use-content-records.ts`, `src/hooks/use-scoped-records.ts`,
 * `src/hooks/use-scope-query.ts`) — a closed list, by name, of the only hooks whose name alone
 * says read or write. Anything else that reaches a table itself is read via the `.from()` verb
 * chain instead (form 2 above).
 */
const CONTENT_HOOK_VERBS = {
  useContentRecords: "read",
  useContentRecord: "read",
  useScopedRecords: "read",
  useScopeQuery: "read",
  useCreateContentRecord: "write",
  useUpdateContentRecord: "write",
  useDeleteContentRecord: "write",
};
const CONTENT_HOOK_RE = new RegExp(`\\b(${Object.keys(CONTENT_HOOK_VERBS).join("|")})\\s*\\(`, "g");

/** `useResource("x", ...)` / `useOne("x", ...)` — Genesis-native, always read (see module doc). */
const RESOURCE_HOOK_RE = /\b(?:useResource|useOne)\(\s*["']([\w.]+)["']/g;

/** The only verbs this module treats as a write. `.select(`, `.eq(`, `.order(`, ... are not. */
const WRITE_VERB_RE = /\.(insert|update|upsert|delete)\s*\(/;

/** How far past one `.from(` call this scan will look for its verb before giving up on a boundary. */
const CHAIN_WINDOW = 500;

/** `import { a, b } from "@/hooks/x"` — the one hop this module follows, never further. */
const HOOK_IMPORT_RE = /import\s+(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*["']@\/hooks\/([^"']+)["']/g;

/**
 * Skip a quoted or template-literal body starting at `text[i]`, honoring backslash escapes.
 * Every brace/semicolon counter below needs this: counting a `{` or `;` that is really inside a
 * string desyncs the scan the same way it did for the route parser in `map.mjs`.
 */
function skipString(text, i) {
  const q = text[i];
  for (i++; i < text.length && text[i] !== q; i++) if (text[i] === "\\") i++;
  return i;
}

/** Index of the character that closes the bracket opened at `open`, skipping string bodies. */
function matchBalanced(text, open, openChar, closeChar) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === openChar) depth++;
    else if (c === closeChar && --depth === 0) return i;
  }
  return -1;
}

/**
 * `export function NAME(...) { ... }` body — the one export shape every hook in this app uses (no
 * `export const NAME = (...) =>` hook exists here to also handle, and adding a branch for a shape
 * that does not occur is the over-reach the standing order rules out). Null when `name` is not
 * exported this way: a type-only import, an arrow-const export, or a name this scan simply cannot
 * find. Any of those means no evidence, not a guess.
 */
function exportedFunctionBody(text, name) {
  const sig = new RegExp(`\\bexport\\s+function\\s+${name}\\b`).exec(text);
  if (!sig) return null;
  const parenOpen = text.indexOf("(", sig.index);
  if (parenOpen === -1) return null;
  const parenClose = matchBalanced(text, parenOpen, "(", ")");
  if (parenClose === -1) return null;
  const braceOpen = text.indexOf("{", parenClose);
  if (braceOpen === -1) return null;
  const braceClose = matchBalanced(text, braceOpen, "{", "}");
  if (braceClose === -1) return null;
  return text.slice(braceOpen + 1, braceClose);
}

/**
 * The text from `from` to the end of the statement or call chain it opens — a top-level `;` or the
 * start of a sibling `.from(`, whichever comes first, capped at `CHAIN_WINDOW`. Bounding the write-
 * verb search to this window is what keeps an unrelated `.insert(` two statements later (a local
 * array, a different table entirely) from being read as evidence about THIS `.from(` call.
 */
function chainWindow(text, from) {
  let depth = 0;
  const cap = Math.min(text.length, from + CHAIN_WINDOW);
  for (let i = from; i < cap; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ";" || text.startsWith(".from(", i))) return text.slice(from, i);
  }
  return text.slice(from, cap);
}

/** Form 1: a known content-record hook called with a literal or `TABLES.KEY` first argument. */
function scanKnownHooks(text, tableByKey) {
  const hits = [];
  for (const m of text.matchAll(CONTENT_HOOK_RE)) {
    const verb = CONTENT_HOOK_VERBS[m[1]];
    const arg = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const key = /^\s*TABLES\.(\w+)/.exec(arg);
    const literal = /^\s*["']([^"']+)["']/.exec(arg);
    const name = key ? tableByKey[key[1]] : literal?.[1];
    if (name) hits.push({ name, verb });
  }
  return hits;
}

/** Form 2: `.from("x")`, verb decided by what is chained onto that same call. */
function scanFromCalls(text) {
  const hits = [];
  for (const m of text.matchAll(FROM_CALL_RE)) {
    const window = chainWindow(text, m.index + m[0].length);
    hits.push({ name: m[1], verb: WRITE_VERB_RE.test(window) ? "write" : "read" });
  }
  return hits;
}

/** Form 3a: `useResource("x")` / `useOne("x")` directly — always read (see module doc). */
function scanResourceHooks(text) {
  return [...text.matchAll(RESOURCE_HOOK_RE)].map((m) => ({ name: m[1], verb: "read" }));
}

/** Form 3b: a registry-declared name passed as any call's first argument — always read. */
function scanAddressed(text, addressed) {
  const hits = [];
  for (const [name, re] of addressedMatchers(addressed)) {
    if (re.test(text)) hits.push({ name, verb: "read" });
  }
  return hits;
}

/** `@/hooks/x` import specifiers in `componentText`, resolved to the file they name — one hop. */
function importedHookFiles(root, componentText) {
  const out = [];
  for (const m of componentText.matchAll(HOOK_IMPORT_RE)) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    if (!names.length) continue;
    const file = [".ts", ".tsx"]
      .map((ext) => join(root, "src/hooks", `${m[2]}${ext}`))
      .find((p) => existsSync(p));
    if (!file) continue;
    for (const name of names) out.push({ name, file });
  }
  return out;
}

/**
 * Reads and writes for one surface, as resource ids.
 *
 * `resourceIndex` is built from the same run's own `extractResources(root)` output:
 *   - `tableByKey`: `legacyTables(root)` — `TABLES.KEY` -> table name.
 *   - `addressed`: declared resource names, licensing form 3b.
 *   - `nameToId`: resource name -> the `id` its row was given, so the result joins to
 *     `data/resources/<id>.md` instead of repeating a name that row may have had to qualify.
 */
export function surfaceResourceEdges(root, componentFile, { tableByKey, addressed, nameToId }) {
  const componentPath = join(root, componentFile);
  if (!existsSync(componentPath)) return { reads: [], writes: [] };
  const componentText = stripJs(readFileSync(componentPath, "utf8"));

  const chunks = [componentText];
  const seenHookFiles = new Map(); // file -> stripped text, so a file imported for two names is read once
  for (const { name, file } of importedHookFiles(root, componentText)) {
    if (!seenHookFiles.has(file)) seenHookFiles.set(file, stripJs(readFileSync(file, "utf8")));
    const body = exportedFunctionBody(seenHookFiles.get(file), name);
    if (body !== null) chunks.push(body);
  }

  const hits = chunks.flatMap((text) => [
    ...scanKnownHooks(text, tableByKey),
    ...scanFromCalls(text),
    ...scanResourceHooks(text),
    ...scanAddressed(text, addressed),
  ]);

  const reads = new Set();
  const writes = new Set();
  for (const { name, verb } of hits) {
    const id = nameToId.get(name);
    // Cannot happen for any form above — every one is a form `tableRefs` also reads across the
    // whole tree, so `extractResources` already saw it — but a resource id is a stronger claim
    // than a name, and inventing one is a worse failure than silently dropping a hit that should
    // have resolved.
    if (!id) continue;
    (verb === "write" ? writes : reads).add(id);
  }
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}
