#!/usr/bin/env node
/**
 * cartography — map a codebase into gitdata rows.
 *
 * Extracts the facts a codebase already knows about itself (routes, screens, the dialogs each
 * screen opens, which design system it leans on) and writes them as machine-owned rows. Human
 * intent — what job a screen serves — lives in a separate table the extractor never opens.
 *
 *   data/surfaces/    machine-owned · rewritten every run · never hand-edited
 *   data/features/    human-owned   · rows never written  · joins via `owns:` globs
 *
 * That separation is the whole design. Mixing generated and authored fields in one file makes
 * every re-run a merge conflict; keeping them in two tables makes regeneration safe by
 * construction — no run rewrites a feature you wrote. (`init` may create the `_`-prefixed
 * inventory draft, once, if it is absent. That is the one write, and it is not a row.)
 *
 * Output is deterministic and carries no timestamp. A generated row that embeds the time it was
 * generated differs on every run, and a drift check that always fails is a check nobody reads.
 *
 * Node built-ins only, no dependencies.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { readFrontmatter, yamlList, yamlScalar } from "./lib/frontmatter.js";

const HELP = `cartography — map a codebase into gitdata rows

  cartography init  [--root <dir>]   first run: extract surfaces, propose a feature inventory
  cartography sync  [--root <dir>]   re-extract surfaces, report what changed
  cartography check [--root <dir>]   report without writing; exit 1 on findings (CI, pre-push)

Reads:  <root>/src/App.tsx, <root>/src/**, <root>/src/lib/nav-registry.ts (optional)
Writes: <root>/data/surfaces/*.md
        <root>/data/features/_inventory.md — on \`init\` only, and only if absent
Never writes a feature row.
`;

// ── tiny helpers ────────────────────────────────────────────────────────────────
const uniq = (a) => [...new Set(a)];
/** Array.filter predicate that keeps first occurrences, for deduping mid-chain. */
const uniqFilter = () => {
  const seen = new Set();
  return (v) => !seen.has(v) && seen.add(v);
};

/** What counts as a verb on a screen. A convention, named here so it is visible and changeable. */
const AFFORDANCE_SUFFIXES = ["Form", "Dialog", "Sheet", "Panel", "Modal"];

/**
 * Components that hold a route but are not a screen: chrome, guards, redirects.
 *
 * Matched by suffix only. A `^Legacy` prefix rule used to live here and deleted any screen whose
 * name began with it — `LegacyImportPage` would have vanished from the map with exit 0, and a
 * missing screen is indistinguishable from one that never existed.
 */
const NOT_A_SCREEN = /^Navigate$|(?:ScopeResolver|Layout|Guard|Provider|Boundary|Redirect)$/;

/**
 * Blank out comments, preserving byte offsets and newlines. String bodies are left intact —
 * `path="today"` and `from "@/components/..."` are the facts being extracted.
 *
 * A route inside `/* *​/` or after `//` used to be extracted as a real screen, so deleting a page
 * by commenting it out left it on the map. Only `{/* … *​/}` was handled, and `App.tsx` is a
 * TypeScript file where the other two forms are the normal ones.
 */
function stripComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === "//") {
      for (; i < src.length && src[i] !== "\n"; i++) out += " ";
      out += "\n";
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
      i--;
      continue;
    }
    out += c;
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) {
        out += src[i];
        if (src[i] === "\\" && i + 1 < src.length) out += src[++i];
      }
      if (i < src.length) out += c;
    }
  }
  return out;
}

/**
 * Walk `text` from `from`, calling `fn(i, char)` only at positions that are real code — string and
 * template-literal bodies are stepped over whole. Returns the index where `fn` returned true.
 *
 * Every brace counter in this file needs this. Counting `{` inside an attribute string desynced
 * the scan, which dropped the route silently and — on a scope resolver — refiled all of its
 * children under whatever scope was open above it. Both with exit 0.
 */
function walkCode(text, from, fn) {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (fn(i, c)) return i;
  }
  return -1;
}

/** Expand `{a,b}` alternations. One level, which is all an `owns:` glob needs. */
function expandBraces(glob) {
  const m = /\{([^{}]*)\}/.exec(glob);
  if (!m) return [glob];
  return m[1].split(",").flatMap((alt) => expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)));
}

/** Minimal glob: `**` spans separators, `*` does not. Enough for `owns:` path patterns. */
function globToRe(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}
const matchesAny = (path, globs) =>
  globs.flatMap(expandBraces).some((g) => globToRe(g).test(path));

// ── extraction ──────────────────────────────────────────────────────────────────
/**
 * URL prefix a scope resolver claims: `<Route path="c/:clientId">` opens the client scope.
 *
 * This is the documented seam for another app's scopes, so the pattern that finds a resolver is
 * derived from these keys. It used to be a separate `[a-z]{1,2}` literal, which meant adding a
 * longer prefix here changed nothing at all and every screen in that scope was filed as personal.
 */
const SCOPE_PREFIX = { c: "client", t: "team", p: "project", pd: "product" };
const SCOPE_RE = new RegExp(`\\bpath="/?(${Object.keys(SCOPE_PREFIX).join("|")})/:\\w+"`);
const ROUTE_SCOPES = new Set(["personal", ...Object.values(SCOPE_PREFIX)]);

/**
 * Every `<Route>` token in order: opening tags with their text, and closers.
 *
 * Each opening tag is scanned to its first `>` at brace depth zero rather than matched as a shape,
 * because a route written across several lines is still one route. Matching `element={<` as a
 * literal missed `/auth` — the app's own front door — for no reason but a newline, and the map
 * then read as if the screen did not exist.
 */
const ROUTE_TAG = /^<\/?Route\b/; // `\b` so the `<Routes>` wrapper is not read as a route

function routeTokens(src) {
  const out = [];
  let from = 0;
  for (;;) {
    // Found through walkCode, so a route-shaped string — a doc snippet, a code sample — is not a
    // route. Same reason a commented-out one is not.
    const at = walkCode(src, from, (i) => ROUTE_TAG.test(src.slice(i, i + 8)));
    if (at === -1) return out;
    if (src[at + 1] === "/") {
      out.push({ close: true });
      from = at + 2;
      continue;
    }
    let depth = 0;
    const end = walkCode(src, at, (i, c) => {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      return c === ">" && depth === 0;
    });
    // Skipping it silently would drop the screen AND, on a scope resolver, refile every child
    // under the wrong scope — both with exit 0. Refuse instead.
    if (end === -1) {
      throw new Error(
        `unterminated <Route> tag near "${src.slice(at, at + 60).trim()}" — ` +
          `the extractor cannot read this router`,
      );
    }
    out.push({ close: false, text: src.slice(at, end), selfClosing: src[end - 1] === "/" });
    from = end + 1;
  }
}

/** The contents of the balanced `{...}` beginning at `open`, ignoring braces inside strings. */
function braced(text, open) {
  let depth = 0;
  const end = walkCode(text, open, (i, c) => {
    if (c === "{") depth++;
    else if (c === "}") return --depth === 0;
    return false;
  });
  return end === -1 ? text.slice(open + 1) : text.slice(open + 1, end);
}

/**
 * A screen's scope is the resolver it is nested inside, tracked on a stack of open routes.
 *
 * Slicing the file positionally instead — from one resolver to the next — put every route written
 * after the last resolver inside it. That is how the app-wide 404 came to be recorded as a product
 * screen: a fact stated confidently and wrong, which is worse in a generated table than a gap.
 */
function extractRoutes(root) {
  const appPath = join(root, "src/App.tsx");
  if (!existsSync(appPath)) throw new Error(`no src/App.tsx under ${root}`);
  // A commented-out route is not a route, and a route-shaped string is not a route either.
  const src = stripComments(readFileSync(appPath, "utf8"));
  const found = [];
  const open = []; // one entry per unclosed <Route>: the scope it opens, or null
  for (const t of routeTokens(src)) {
    if (t.close) {
      open.pop();
      continue;
    }
    const prefix = (t.text.match(SCOPE_RE) || [])[1];
    const opens = prefix ? SCOPE_PREFIX[prefix] : null;
    // No enclosing resolver means no URL prefix, which is all this field records. It does NOT mean
    // the screen shows a person's own data: `/auth` and the catch-all 404 land here too. Inferring
    // audience would need to know which routes sit inside an auth guard, and nothing here does —
    // see "What it cannot see" in SKILL.md.
    const scope = open.findLast((s) => s !== null) ?? "personal";
    if (!t.selfClosing) open.push(opens);

    const at = t.text.indexOf("element={");
    if (at === -1) continue; // a pathless grouping route, or the data-router `Component=` form
    // The element may be wrapped in guards and providers (`<AdminGuard><AdminHome /></AdminGuard>`).
    // The screen is the innermost component — the last one opened — since taking an outer one
    // collapses every guarded page into a single row named after the guard.
    const opened = [...braced(t.text, at + "element=".length).matchAll(/<(\w+)/g)].map((m) => m[1]);
    const component = opened.at(-1);
    if (!component || NOT_A_SCREEN.test(component)) continue;
    const path = (t.text.match(/\bpath="([^"]*)"/) || [])[1];
    if (path === undefined && !/\bindex\b/.test(t.text)) continue;
    found.push({ scope, path: (path ?? "").replace(/^\//, ""), component });
  }
  return found;
}

/**
 * nav-registry, when present, is the only place a screen's group, gating and human label live.
 *
 * Keyed by `scope=suffix`, never by suffix alone. A flat map collapsed every scope's entry for the
 * same path onto one key and kept whichever the file listed last, which is how `/engagements` came
 * to be recorded as open to everyone when the personal-scope entry gates it to coaches — a
 * generated table dropping an access restriction. Same collapse renamed four screens after the
 * label they carry in a scope they do not mount in.
 */
function navFacts(root) {
  const p = join(root, "src/lib/nav-registry.ts");
  if (!existsSync(p)) return {};
  const src = stripComments(readFileSync(p, "utf8"));
  // `scopes: EVERYWHERE` is as common as a literal list. Resolving the constants is what keeps the
  // lookup exact — the alternative, treating an unresolved name as "applies anywhere", invented a
  // nav entry for `/settings` in a scope whose registry never mentions it.
  const raw = Object.fromEntries(
    [...src.matchAll(/\bconst\s+(\w+)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g)].map((m) => [
      m[1],
      m[2].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
    ]),
  );
  // `["personal", ...ALL_TEAMS]` is the ordinary way to write these, so a resolver that stops at
  // named references and ignores spreads silently drops most of an entry's scopes.
  const resolve = (names, seen = new Set()) =>
    names.flatMap((n) => {
      const ref = n.startsWith("...") ? n.slice(3) : n;
      if (!raw[ref] || seen.has(ref)) return /^\w+$/.test(ref) && !raw[ref] ? [ref] : [];
      return resolve(raw[ref], new Set([...seen, ref]));
    });
  const facts = {};
  for (const chunk of src.split(/\{\s*id:/).slice(1)) {
    const get = (re) => (chunk.match(re) || [])[1];
    const suffix = get(/suffix:\s*"([^"]*)"/);
    if (suffix === undefined) continue;
    const entry = {
      title: get(/title:\s*"([^"]+)"/),
      group: get(/group:\s*"([^"]+)"/),
      role: get(/role:\s*"([^"]+)"/) ?? null,
    };
    // `scopes:` is a literal list or a named constant; either way it resolves to concrete names.
    // An entry that declares none is registered under no scope rather than under all of them.
    const literal = get(/scopes:\s*\[([^\]]*)\]/);
    const named = get(/scopes:\s*(\w+)/);
    const scopes = resolve(
      literal
        ? literal.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
        : named
          ? [named]
          : [],
    );
    // A per-scope path override means the suffix this entry answers to differs by scope.
    const overrides = Object.fromEntries(
      [...(get(/suffixByScope:\s*\{([^}]*)\}/) ?? "").matchAll(/(\w+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    for (const scope of scopes) facts[`${scope}=${overrides[scope] ?? suffix}`] = entry;
  }
  return facts;
}

/** The nav entry for a screen reachable at `suffix` in `scope`. Exact, or nothing. */
const navLookup = (nav, scope, suffix) => nav[`${scope}=${suffix === "(index)" ? "" : suffix}`];

/** Find `<component>.tsx` anywhere under `src/`, nearest the top first. */
function findComponentFile(root, component) {
  const want = `${component}.tsx`;
  const queue = [join(root, "src")];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name === want) return join(dir, e.name);
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "node_modules") queue.push(join(dir, e.name));
    }
  }
  return null;
}

/**
 * A screen's dialog imports are its verbs: what can be done here without leaving.
 *
 * Only imports from the app itself count. Pulling them from every import made the design system's
 * own `Dialog` and `AlertDialog` primitives read as verbs — one row's entire stated verb set was
 * the word `Dialog`, which tells a reader nothing and looks like it tells them something.
 */
function componentFacts(root, component) {
  const p = findComponentFile(root, component);
  if (!p) return { file: null, affordances: [], layout: "unknown" };
  const src = stripComments(readFileSync(p, "utf8"));
  // Every specifier in the braces, not just the first: `import { CreateHabitForm, LogHabitForm }`
  // previously yielded only CreateHabitForm, dropping the core verb of the habits screen.
  const affordances = uniq(
    [...src.matchAll(/import\s+(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)]
      .filter((m) => m[2].startsWith("@/") || m[2].startsWith("."))
      .flatMap((m) => m[1].split(","))
      .map((sp) => sp.trim().split(/\s+as\s+/)[0].trim())
      .filter((n) => AFFORDANCE_SUFFIXES.some((suf) => n.endsWith(suf))),
  ).sort();
  const genesis = /@marktiderman\/genesis-(ui|core|design-system)\b/.test(src);
  const local = /@\/components\/(data|ui)\b/.test(src);
  return {
    file: relative(root, p),
    affordances,
    layout: genesis && local ? "partial" : genesis ? "genesis" : local ? "local" : "none",
  };
}

/** One row per screen, merged across every scope it is mounted in. */
function extractSurfaces(root) {
  const nav = navFacts(root);
  const byComponent = new Map();
  for (const { scope, path, component } of extractRoutes(root)) {
    if (!byComponent.has(component)) byComponent.set(component, { component, routes: {}, scopes: [] });
    const s = byComponent.get(component);
    // A component can mount at several paths in one scope (/profile and /profile/:id). Keeping
    // only the last silently lost the shorter, canonical one.
    (s.routes[scope] ??= []).push(path === "" ? "(index)" : path);
    s.scopes.push(scope);
  }
  return [...byComponent.values()]
    .map((s) => {
      // The canonical mount is the shortest path in the primary scope: /profile, not
      // /profile/:id. Sorting makes the nav lookup deterministic instead of insertion-ordered.
      const primary = (s.routes.personal ?? Object.values(s.routes)[0] ?? []).slice().sort(
        (a, b) => a.length - b.length || a.localeCompare(b),
      );
      const scopes = uniq(s.scopes).sort();
      // Group and gating are per-scope facts: /engagements is coach-only in personal scope and
      // open in client scope. A single value for both is a lie whichever one it picks, so each is
      // recorded scope-tagged, the way `routes` already is.
      // An app may subdivide a route scope in its nav — Breakthrough's one `team` URL prefix is
      // three nav scopes (family, business, coaching). Those names are reported as themselves
      // rather than folded into the route scope, because folding them would have to pick one.
      const suffixes = uniq(Object.values(s.routes).flat()).map((p) => (p === "" ? "(index)" : p));
      const navOnly = Object.keys(nav)
        .map((k) => k.split("=")[0])
        .filter((scope) => !ROUTE_SCOPES.has(scope));
      const lookIn = uniq([...scopes, ...navOnly]);
      const scoped = (field) =>
        lookIn
          .flatMap((scope) => suffixes.map((suffix) => [scope, navLookup(nav, scope, suffix)]))
          .filter(([, n]) => n?.[field])
          .map(([scope, n]) => `${scope}=${n[field]}`)
          .filter(uniqFilter())
          .sort();
      // The label comes from the screen's own scope. A nav-only scope stands in only when the nav
      // vocabulary has no word for that scope at all — `team` is three nav scopes here, so a team
      // screen would otherwise fall back to its component name. When nav *does* name the scope and
      // simply has no entry, there is no label: borrowing one from elsewhere is how the personal
      // `/settings` came to be called "Team Settings", which is not what the page says.
      const canonicalScope = s.routes.personal ? "personal" : scopes[0];
      const navNames = new Set(Object.keys(nav).map((k) => k.split("=")[0]));
      const canonical =
        navLookup(nav, canonicalScope, primary[0]) ??
        (navNames.has(canonicalScope)
          ? undefined
          : navOnly.map((scope) => navLookup(nav, scope, primary[0])).find(Boolean));
      return {
        id: s.component.replace(/Page$/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
        title: canonical?.title ?? s.component.replace(/Page$/, ""),
        ...s,
        scopes,
        group: scoped("group"),
        role: scoped("role"),
        ...componentFacts(root, s.component),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Ids become filenames, so a collision overwrites a row — and because the drift map is keyed by
 * the same id, the check cannot see the loss either. Two apps in a monorepo each with a
 * SettingsPage collide on the first run, so this fails loudly rather than losing a screen.
 */
function assertUniqueIds(surfaces) {
  const seen = new Map();
  for (const s of surfaces) {
    if (seen.has(s.id)) {
      throw new Error(
        `duplicate surface id "${s.id}" from ${seen.get(s.id)} and ${s.component} — ` +
          `ids become filenames, so one row would silently overwrite the other`,
      );
    }
    seen.set(s.id, s.component);
  }
  return surfaces;
}

const surfaceRow = (s) =>
  `---
id: ${yamlScalar(s.id)}
kind: surface
title: ${yamlScalar(s.title)}
component: ${yamlScalar(s.component)}
file: ${yamlScalar(s.file)}
routes: ${yamlList(
    Object.entries(s.routes)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([scope, paths]) => paths.slice().sort().map((p) => `${scope}=${p}`)),
  )}
scopes: ${yamlList(s.scopes)}
group: ${yamlList(s.group)}
role: ${yamlList(s.role)}
layout: ${yamlScalar(s.layout)}
affordances: ${yamlList(s.affordances)}
claimed_by: ${yamlList(s.claimedBy)}
---

<!-- GENERATED by \`cartography sync\`. Hand edits are overwritten and \`cartography check\` fails.
     Intent belongs in data/features/, which this tool never touches. -->
`;

// ── the join: which feature claims which file ───────────────────────────────────
function readFeatures(root) {
  const dir = join(root, "data/features");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md")
    .map((f) => {
      const fm = readFrontmatter(readFileSync(join(dir, f), "utf8"), { file: `features/${f}` });
      const owns = fm.owns ?? [];
      return {
        id: fm.id ?? basename(f, ".md"),
        // `owns:` absent and `owns: []` are different claims: one is unfinished, the other says
        // "this feature owns no code yet". Only the first should be reported as a mistake.
        declaresOwns: "owns" in fm,
        owns: Array.isArray(owns) ? owns : [owns].filter(Boolean),
      };
    });
}

/**
 * Record on each surface which features claim it.
 *
 * Coverage lives in the row rather than only in a report, so losing it is ordinary drift: a glob
 * narrowed or a feature deleted changes a committed file, and the existing check catches it. A
 * report alone would let coverage rot silently between runs, and a second gate to watch it would
 * be a mechanism where one already works.
 */
function joinFeatures(surfaces, features) {
  return surfaces.map((s) => ({
    ...s,
    claimedBy: features.filter((f) => s.file && matchesAny(s.file, f.owns)).map((f) => f.id).sort(),
  }));
}

function report(surfaces, features) {
  const unclaimed = surfaces.filter((s) => s.claimedBy.length === 0);
  // A feature owning only code cartography does not extract (an edge function, a shared hook) is
  // not dead — this tool simply cannot see it. Reporting it would be a permanent false positive
  // that no action can clear, so only globs pointing INTO an extracted area are judged.
  const extractedDirs = uniq(surfaces.map((s) => s.file?.split("/").slice(0, 2).join("/")).filter(Boolean));
  const looksExtractable = (g) => extractedDirs.some((d) => g.startsWith(d));
  const claimedIds = new Set(surfaces.flatMap((s) => s.claimedBy));
  const dead = features.filter(
    (f) => f.owns.length > 0 && f.owns.some(looksExtractable) && !claimedIds.has(f.id),
  );
  return { unclaimed, dead };
}

// ── commands ────────────────────────────────────────────────────────────────────
/**
 * Rewrite the table: rows are replaced wholesale so a deleted screen's row disappears, but
 * anything gitdata reserves as a non-row is left alone.
 *
 * The previous version was `rmSync` on the directory, which deleted the table's own README.md,
 * _template.md and .gitkeep — the files gitdata's `isRowFile` explicitly protects — and then
 * reported them as removed surfaces. A machine-owned table could not be documented in the
 * gitdata idiom, and an empty table vanished on clone.
 */
/** What gitdata loads as a row. `_`-prefixed files and the table's own README are not rows. */
const isRowFile = (f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md";

function writeSurfaces(root, surfaces) {
  const dir = join(root, "data/surfaces");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (isRowFile(f) && statSync(join(dir, f)).isFile()) rmSync(join(dir, f));
  }
  for (const s of surfaces) writeFileSync(join(dir, `${s.id}.md`), surfaceRow(s), "utf8");
}

/**
 * The committed rows, by the same definition `writeSurfaces` uses.
 *
 * These two disagreed: one preserved the table's README and `_template.md`, the other counted them
 * as rows — so every run reported them `- gone`, the gate was red forever, and running `sync` (the
 * advice the failure prints) could not clear it. Documenting a machine-owned table in the gitdata
 * idiom was enough to make the tool permanently fail.
 */
function committedSurfaces(root) {
  const dir = join(root, "data/surfaces");
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir)
      .filter(isRowFile)
      .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
  );
}

function diff(root, surfaces) {
  const before = committedSurfaces(root);
  const after = new Map(surfaces.map((s) => [`${s.id}.md`, surfaceRow(s)]));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/**
 * Drift and coverage are different findings and only one of them is a failure.
 *
 * Drift means the committed map is no longer true — a fact to correct, and correctable in one
 * command. Coverage means screens serve no articulated job: a real backlog, and on any existing
 * codebase a long one. Failing the build on it would make the gate unusable on the day it is
 * installed, and a check nobody can turn green is a check that gets removed. It is protected
 * instead by `claimed_by` living in the rows, where losing it shows up as drift.
 */
function printReport({ added, removed, changed }, { unclaimed, dead }, surfaces) {
  const line = (mark, label, items) =>
    items.length && console.log(`  ${mark} ${label.padEnd(22)} ${items.join(", ")}`);
  console.log(`  ${surfaces.length} surface(s) extracted`);
  line("+", "new", added);
  line("-", "gone", removed);
  line("~", "changed", changed);
  line("!", "feature owns nothing", dead.map((f) => f.id));
  line("?", "claimed by no feature", unclaimed.map((s) => s.id));
  return { drift: added.length + removed.length + changed.length + dead.length, coverage: unclaimed.length };
}

const INVENTORY_HEADER = `# Feature inventory — working draft

**Not a row.** The \`_\` prefix means gitdata never loads this file, so a draft lives inside the
table it will become. Define as much as possible here, reach alignment, then split into
\`data/features/<id>--<slug>.md\` rows.

A feature is a **job to be done** — what someone is trying to achieve, not the screen they achieve
it on. The screens below were extracted from the code; the jobs were not, and cannot be. Grouping
them by import proximity produces screen-shaped clusters, which is the trap: name the job, then
attach screens to it with \`owns:\` globs.

`;

function proposeInventory(root, surfaces) {
  const path = join(root, "data/features/_inventory.md");
  if (existsSync(path)) return null;
  mkdirSync(join(root, "data/features"), { recursive: true });
  const rows = surfaces
    .map((s) => `| ${s.id} | ${s.scopes.join(", ")} | ${s.layout} | \`${s.file ?? "?"}\` |`)
    .join("\n");
  writeFileSync(
    path,
    `${INVENTORY_HEADER}## Screens found — each needs a job, or a reason to exist\n\n` +
      `| surface | scopes | layout | file |\n| --- | --- | --- | --- |\n${rows}\n`,
    "utf8",
  );
  return path;
}

// ── entry ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const command = argv[0];
const rootFlag = argv.indexOf("--root");
const root = resolve(rootFlag === -1 ? process.cwd() : argv[rootFlag + 1]);

try {
  if (!["init", "sync", "check"].includes(command)) {
    console.log(HELP);
    process.exit(command ? 1 : 0);
  }
  const features = readFeatures(root);
  const surfaces = joinFeatures(assertUniqueIds(extractSurfaces(root)), features);
  const d = diff(root, surfaces);
  const r = report(surfaces, features);

  if (command === "check") {
    const { drift, coverage } = printReport(d, r, surfaces);
    if (drift > 0) console.log(`\n  ${drift} stale fact(s) — run \`cartography sync\` and commit.`);
    else if (coverage > 0) console.log(`\n  Map is current. ${coverage} screen(s) await a job.`);
    process.exit(drift > 0 ? 1 : 0);
  }

  const existing = committedSurfaces(root).size;
  if (surfaces.length === 0 && existing > 0) {
    throw new Error(
      `extracted 0 surfaces but ${existing} row(s) are committed — refusing to empty the table.\n` +
        `  This is what a router refactor looks like: the extractor no longer understands\n` +
        `  src/App.tsx. Fix the extractor, or delete data/surfaces/ deliberately.`,
    );
  }
  writeSurfaces(root, surfaces);
  printReport(d, r, surfaces);
  if (command === "init") {
    const proposed = proposeInventory(root, surfaces);
    console.log(
      proposed
        ? `\n  Wrote ${relative(root, proposed)} — name the jobs, then add \`owns:\` globs.`
        : "\n  data/features/_inventory.md exists — left alone.",
    );
  }
  process.exit(0);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
