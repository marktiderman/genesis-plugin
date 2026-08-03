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

/** `export const TABLES = { PEOPLE: "People", ... }` — the legacy jsonb table names. */
export function legacyTables(root) {
  const p = join(root, "src/lib/airtable.ts");
  if (!existsSync(p)) return {};
  const block = /export const TABLES\s*=\s*\{([\s\S]*?)\n\}/.exec(readFileSync(p, "utf8"));
  if (!block) return {};
  return Object.fromEntries(
    [...block[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
}

/** Table names in the generated Supabase types — the typed half of the data plane. */
export function typedTables(root) {
  const p = join(root, "src/integrations/supabase/types.ts");
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
  const p = join(root, "src/lib/resource-registry.ts");
  if (!existsSync(p)) return [];
  const src = readFileSync(p, "utf8");
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
      fields: fields ? [...fields.matchAll(/^\s*"?([\w ]+)"?:\s*"/gm)].map((m) => m[1].trim()) : [],
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
      const src = readFileSync(path, "utf8");
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
  const dir = join(root, "supabase/migrations");
  if (!existsSync(dir)) return {};
  const out = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(/ALTER TABLE\s+(?:public\.)?"?(\w+)"?\s+ENABLE ROW LEVEL SECURITY/gi)) {
      (out[m[1]] ??= { enabled: false, commands: new Set() }).enabled = true;
    }
    // The policy name is consumed as a whole quoted string before ON is looked for. Scanning
    // loosely for " ON " found it inside names like "Coaches can manage fields on own templates"
    // and invented tables called `own` and `published`.
    for (const m of sql.matchAll(
      /CREATE POLICY\s+(?:IF NOT EXISTS\s+)?(?:"[^"]*"|\w+)\s+ON\s+(?:public\.)?"?(\w+)"?([\s\S]{0,200}?);/gi,
    )) {
      const entry = (out[m[1]] ??= { enabled: false, commands: new Set() });
      const cmd = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(m[2]);
      entry.commands.add(cmd ? cmd[1].toLowerCase() : "all");
    }
  }
  return out;
}

/** Edge function names, and which of them bypass JWT verification. */
export function edgeFunctions(root) {
  const dir = join(root, "supabase/functions");
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
  const appHits = tableRefs(join(root, "src"), tables);
  const fnDir = join(root, "supabase/functions");
  const fnHits = existsSync(fnDir)
    ? tableRefs(fnDir, tables, { label: (f) => f.slice(fnDir.length + 1).split("/")[0] })
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
      rls: rls[name] ? [...rls[name].commands].sort() : [],
      rls_enabled: rls[name] ? String(rls[name].enabled) : "unknown",
      reached_from_src: String(Boolean(inApp)),
      used_by: usedBy,
      claimed_by: [],
    };
  });
}
