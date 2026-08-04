#!/usr/bin/env node
/**
 * map — map a codebase into gitdata rows.
 *
 * Extracts the facts a codebase already knows about itself (routes, screens, the dialogs each
 * screen opens, which design system it leans on) and writes them as machine-owned rows. Human
 * intent — what job a screen serves — lives in a separate table this tool never opens.
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
import { basename, dirname, join, relative, resolve } from "node:path";

import { readFrontmatter, yamlList, yamlScalar } from "./lib/frontmatter.js";
import {
  RESOURCE_SOURCES,
  TYPES_FILE,
  declaredResources,
  edgeFunctions,
  extractResources,
  legacyTables,
  typedTables,
  typedTablesState,
  unparsedLegacyTableFile,
} from "./lib/resources.js";
import { surfaceResourceEdges } from "./lib/resource-edges.js";
import { loadMapTables, outFile, renderUserFlowsDoc } from "./lib/flows.mjs";

const HELP = `map — map a codebase into gitdata rows

  map init  [--root <dir>]   first run: extract surfaces, propose a feature inventory
  map sync  [--root <dir>]   re-extract surfaces and resources, report what changed
  map check [--root <dir>]   report without writing; exit 1 on findings (CI, pre-push)
  map flows [--root <dir>]   regenerate the generated flows doc from data/flows/

Reads:  <root>/src/App.tsx (surfaces), <root>/src/**, <root>/supabase/** (resources),
        <root>/src/lib/nav-registry.ts (optional), <root>/data/{features,surfaces,flows}/ (flows)
        Every source is optional and an absent one is reported, not fatal — the surface and
        resource extraction are independent of each other. Only an entirely unreadable repo fails.
Writes: <root>/data/{surfaces,resources}/*.md, <root>/data/_views/blind-spots.md   (sync)
        <root>/data/features/_inventory.md — on \`init\` only, and only if absent
        <root>/docs/USER-FLOWS.md                                                  (flows)
Never writes a feature, surface or flow row. \`check\` verifies the surface rows, the resource
        rows, the ledger, and that every flow step names a real surface — not the
        \`_inventory.md\` draft, which is yours and no run reads back.
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
/** The only file the surface scan reads routes from. Its absence is the surface blind spot. */
const APP_FILE = "src/App.tsx";

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
          `map cannot read this router`,
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
 * The non-chrome component one `<Route>` tag mounts, and the form it is written in — or null when
 * there is no element at all, or the one there is chrome.
 *
 * `element` is `element={<Home />}`, possibly wrapped in guards and providers
 * (`<AdminGuard><AdminHome /></AdminGuard>`). The screen is the innermost component — the last one
 * opened — since taking an outer one collapses every guarded page into a single row named after
 * the guard. It is the only form extraction turns into a row.
 *
 * `component` is the React Router 6.4+ data-router form, `Component={Home}`, which this scan
 * cannot follow. Naming it here is the point: the blind-spots denominator has to be able to count
 * a screen the scan cannot see. Both sides of that fraction were computed by this one
 * predicate, so it read 100% forever — two real screens could be added in a form the parser does
 * not read and `42 / 42` did not move, while the row's own note promised "a gap is a routed
 * component that produced no row". The two sides now share one parser and differ by exactly what
 * it can turn into a row, which is the quantity the ledger claims to measure.
 */
function routeMount(text) {
  const at = text.indexOf("element={");
  if (at !== -1) {
    const opened = [...braced(text, at + "element=".length).matchAll(/<(\w+)/g)].map((m) => m[1]);
    const component = opened.at(-1);
    return component && !NOT_A_SCREEN.test(component) ? { component, form: "element" } : null;
  }
  const data = /\bComponent=\{\s*(\w+)\s*\}/.exec(text);
  return data && !NOT_A_SCREEN.test(data[1]) ? { component: data[1], form: "component" } : null;
}

/** The screen behind one `<Route>` tag, in the one form extraction reads. */
function routeScreen(text) {
  const mount = routeMount(text);
  return mount?.form === "element" ? mount.component : null;
}

/** The router file, comments blanked — or null when this repo has no React Router to read. */
function routerSource(root) {
  const p = join(root, APP_FILE);
  // A commented-out route is not a route, and a route-shaped string is not a route either.
  return existsSync(p) ? stripComments(readFileSync(p, "utf8")) : null;
}

/**
 * Every distinct non-chrome component the router mounts, in any form, whether or not the scan
 * can turn it into a row. The blind-spots denominator: counted in the router, not in the map.
 */
function routedScreens(root) {
  const src = routerSource(root);
  if (src === null) return [];
  return uniq(routeTokens(src).filter((t) => !t.close).map((t) => routeMount(t.text)?.component).filter(Boolean));
}

/**
 * A screen's scope is the resolver it is nested inside, tracked on a stack of open routes.
 *
 * Slicing the file positionally instead — from one resolver to the next — put every route written
 * after the last resolver inside it. That is how the app-wide 404 came to be recorded as a product
 * screen: a fact stated confidently and wrong, which is worse in a generated table than a gap.
 *
 * A repo with no router extracts no routes and says so. It does NOT abort: it used to throw here,
 * which killed resource extraction too — one monorepo with 13 migrations and a dozen edge
 * functions produced no map at all because it routes from files instead of from JSX.
 */
function extractRoutes(root) {
  const src = routerSource(root);
  if (src === null) return [];
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

    const component = routeScreen(t.text);
    if (!component) continue;
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
function extractSurfaces(root, resourceIndex) {
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
      const facts = componentFacts(root, s.component);
      // The resource-edge scan reads the same file `componentFacts` just resolved, so a screen
      // whose component could not be found (`file: null`) gets no reads/writes rather than a scan
      // of nothing pretending to be a fact.
      const edges = facts.file ? surfaceResourceEdges(root, facts.file, resourceIndex) : { reads: [], writes: [] };
      return {
        id: s.component.replace(/Page$/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
        title: canonical?.title ?? s.component.replace(/Page$/, ""),
        ...s,
        scopes,
        group: scoped("group"),
        role: scoped("role"),
        ...facts,
        ...edges,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Ids become filenames, so a collision overwrites a row — and because the drift map is keyed by
 * the same id, the check cannot see the loss either. Two apps in a monorepo each with a
 * SettingsPage collide on the first run, so this fails loudly rather than losing a screen.
 */
function assertUniqueIds(rows, kind = "surface", label = (r) => r.component ?? r.name) {
  const seen = new Map();
  for (const r of rows) {
    if (seen.has(r.id)) {
      throw new Error(
        `duplicate ${kind} id "${r.id}" from ${seen.get(r.id)} and ${label(r)} — ` +
          `ids become filenames, so one row would silently overwrite the other`,
      );
    }
    seen.set(r.id, label(r));
  }
  return rows;
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
reads: ${yamlList(s.reads)}
writes: ${yamlList(s.writes)}
claimed_by: ${yamlList(s.claimedBy)}
---

<!-- GENERATED by \`map sync\`. Hand edits are overwritten and \`map check\` fails.
     Intent belongs in data/features/, which this tool never touches. -->
`;

/**
 * A resource row records each source separately rather than merging them into one "exists" flag.
 * The disagreements are the point: a table with RLS that no type file knows about and no screen
 * reaches is a finding, and it is only visible if `declared`, `rls_enabled` and `reach` are
 * allowed to contradict each other on the same row.
 */
const resourceRow = (r) =>
  `---
id: ${yamlScalar(r.id)}
kind: resource
name: ${yamlScalar(r.name)}
backing: ${yamlScalar(r.backing)}
declared: ${yamlScalar(r.declared)}
scope: ${yamlScalar(r.scope)}
debt: ${yamlScalar(r.debt)}
rls_enabled: ${yamlScalar(r.rls_enabled)}
rls: ${yamlList(r.rls)}
reach: ${yamlScalar(r.reach)}
used_by: ${yamlList(r.used_by)}
fields: ${yamlList(r.fields)}
claimed_by: ${yamlList(r.claimed_by)}
---

<!-- GENERATED by \`map sync\`. Hand edits are overwritten and \`map check\` fails.
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

/**
 * Where each half of map reads from, as groups of alternatives: a group is readable if any path in
 * it exists.
 *
 * The two halves are independent. A repo with no React Router still has a data layer; a repo
 * with no migrations still has screens. So a missing source is a **stated absence** — printed,
 * survivable, and never a reason to take the other half down. `extractRoutes` used to throw
 * on a missing `src/App.tsx`, which aborted the run before resources were touched at all.
 *
 * Every source missing is different, and that one does fail: nothing here is an app this tool can
 * read, and writing an empty map for it would state "no screens, no tables" as a fact.
 */
const SOURCES = { surfaces: [[APP_FILE]], resources: RESOURCE_SOURCES };

/** For each table, the source groups that are not on disk. Existence only, never content. */
function missingSources(root) {
  return Object.fromEntries(
    Object.entries(SOURCES).map(([table, groups]) => [
      table,
      groups.filter((g) => !g.some((p) => existsSync(join(root, p)))).map((g) => g.join(" | ")),
    ]),
  );
}

/**
 * Every path in the repo, root-relative, minus the trees no `owns:` glob is about.
 *
 * Directories appear twice, bare and with a trailing slash, because `owns: ["packages/"]` is how
 * people write "this whole directory" and a file-only list would report that feature as owning
 * nothing while the directory sits right there. Five of one consumer's 108 features name a
 * directory that way.
 */
function repoPaths(root) {
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        out.push(prefix + e.name, `${prefix}${e.name}/`);
        walk(join(dir, e.name), `${prefix}${e.name}/`);
      } else out.push(prefix + e.name);
    }
  };
  walk(root, "");
  return out;
}

function report(root, surfaces, features) {
  const unclaimed = surfaces.filter((s) => s.claimedBy.length === 0);
  // `!` means the glob points at code that is not there. It is asked of the filesystem, because
  // that is the question — the glob was previously matched against surface ROWS, so a feature
  // owning a live file that is not a routed screen (a dashboard reached through a dispatcher
  // rather than a `<Route>`) was reported as owning nothing, failed the gate, and no `sync` could
  // clear it: `sync` never writes data/features/, and the file it named was right there on disk.
  //
  // A feature owning only code map does not extract — an edge function, a shared hook —
  // is still not dead, and now for the honest reason: those files exist, so the globs match. The
  // old prefix heuristic reached the same verdict by guessing from where surface rows happened to
  // live, which made the false positive it was written to prevent fire inside `src/pages` itself.
  const paths = repoPaths(root);
  const dead = features.filter((f) => f.owns.length > 0 && !paths.some((p) => matchesAny(p, f.owns)));
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

/** Rewrite one machine-owned table: rows replaced wholesale, non-rows left alone. */
function writeTable(root, table, rows, serialize) {
  const dir = join(root, "data", table);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (isRowFile(f) && statSync(join(dir, f)).isFile()) rmSync(join(dir, f));
  }
  for (const r of rows) writeFileSync(join(dir, `${r.id}.md`), serialize(r), "utf8");
}

/**
 * The committed rows, by the same definition `writeSurfaces` uses.
 *
 * These two disagreed: one preserved the table's README and `_template.md`, the other counted them
 * as rows — so every run reported them `- gone`, the gate was red forever, and running `sync` (the
 * advice the failure prints) could not clear it. Documenting a machine-owned table in the gitdata
 * idiom was enough to make the tool permanently fail.
 */
function committedRows(root, table) {
  const dir = join(root, "data", table);
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir)
      .filter(isRowFile)
      .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
  );
}

function diffTable(root, table, rows, serialize) {
  const before = committedRows(root, table);
  const after = new Map(rows.map((r) => [`${r.id}.md`, serialize(r)]));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

const LEDGER = "data/_views/blind-spots.md";

/**
 * The ledger is generated output too, so `check` compares it the same way it compares a row.
 *
 * It did not, for a while: `sync` wrote it and nothing verified it. An adversarial reviewer edited
 * the committed copy to read `typed tables on the map 99 / 99` and the gate CI runs exited 0. The
 * file's own claim — that nothing you write in `data/` can move a number in it — was then true of
 * `sync` and false of the only command anyone enforces, which makes the anti-gaming property a
 * decoration rather than a structure. A hand-edited number is a stale fact, and stale facts fail.
 */
function diffLedger(root, expected) {
  const p = join(root, LEDGER);
  const before = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (before === expected) return { added: [], removed: [], changed: [] };
  return before === null
    ? { added: [LEDGER], removed: [], changed: [] }
    : { added: [], removed: [], changed: [LEDGER] };
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
function printReport(diffs, { unclaimed, dead }, surfaces, resources, missing, unparsedLegacy) {
  const line = (mark, label, items) =>
    items.length && console.log(`  ${mark} ${label.padEnd(22)} ${items.join(", ")}`);
  console.log(`  ${surfaces.length} surface(s), ${resources.length} resource(s) extracted`);
  // What each half could not read. A gap prints; it never fails. Silence here used to mean
  // "this repo has no data layer" and "this repo has no screens" indistinguishably from "the file
  // those facts live in is not where this tool looks".
  for (const [table, absent] of Object.entries(missing)) line("·", `unread (${table})`, absent);
  // `missing` above is existence only, so a file that exists but does not parse as a `TABLES` map
  // prints no `·` there — `unparsedLegacyTableFile` is content-based, the same way the reader it
  // reports on is, so the two can no longer disagree in silence.
  if (unparsedLegacy) line("·", "unparsed (legacy tables)", [`${unparsedLegacy.join(", ")} — present, no \`export const TABLES = {...}\` found`]);
  let drift = 0;
  for (const [table, d] of Object.entries(diffs)) {
    line("+", `new ${table}`, d.added);
    line("-", `gone ${table}`, d.removed);
    line("~", `changed ${table}`, d.changed);
    drift += d.added.length + d.removed.length + d.changed.length;
  }
  line("!", "feature owns nothing", dead.map((f) => f.id));
  line("?", "claimed by no feature", unclaimed.map((s) => s.id));
  // `!` fails, but it is not drift: drift is a generated table gone stale and `sync` rewrites it,
  // while a glob pointing at no file lives in a row this tool never writes. Counting the two
  // together printed "run `map sync` and commit" as the remedy for a finding `sync`
  // structurally cannot touch.
  return { drift, dead: dead.length, coverage: unclaimed.length };
}

/**
 * The blind-spots ledger: how much of what exists map can see.
 *
 * Every denominator here is counted **outside** the map — routes in the router, tables in the
 * generated types, functions on disk. That is deliberate and it is the whole design: no amount of
 * editing `data/` moves a single number, so the only way to improve this file is to teach map to
 * see more. A score the tool computes about itself from its own output would report
 * a perfect trace while blind to an entire layer, which is exactly the state this app was in.
 */
function blindSpots(root, surfaces, resources) {
  // Both sides of this fraction are screens. It used to be unique screen components over `<Route`
  // tokens — two units in one fraction, with a denominator map could never reach: 104
  // route tags resolve to 42 screens because `<Navigate>`s, legacy redirects and the same page
  // mounted in five scopes are all route tags and none of them is another screen. A ratio whose
  // ceiling is unreachable reports permanent blindness where there is none, and hides the real
  // miss — a routed component that produced no row — inside the noise.
  const routed = routedScreens(root);
  const onSurfaces = new Set(surfaces.map((s) => s.component));
  const typed = typedTables(root);
  const { names: fns } = edgeFunctions(root);
  const resourceByName = new Map(resources.map((r) => [r.name, r]));
  // `scope: unknown` on a resource that *does* declare one — through a helper call the parser
  // cannot read — is the blind spot this row exists to show, so it is counted as a miss.
  const scopeUnread = resources.filter((r) => r.declared !== "undeclared" && r.scope === "unknown").length;
  // "No routed screens" is two different facts and they must not share a sentence: the file can be
  // absent, or it can be present in a form `routeScreen()` cannot read — the data-router
  // `Component={Foo}` form named at its definition above. A fixture with a real, readable-by-eye
  // App.tsx using `createBrowserRouter` produced a note byte-identical to a repo with no `src/` at
  // all, and nothing else in the report said otherwise: `missingSources` checks existence, so a
  // present-but-unreadable file prints no `·` either. The only sentence about the surface layer was
  // the wrong one, and the run still exited 0.
  const routerAbsent = routerSource(root) === null;
  const rows = [
    [
      "screens routed in src/App.tsx",
      routed.filter((c) => onSurfaces.has(c)).length,
      routed.length,
      routed.length
        ? "a gap is a routed component that produced no row"
        : routerAbsent
          ? `no ${APP_FILE} — no router to read`
          : `${APP_FILE} present but no <Route element={<X/>}> the parser can read — data-router Component={} form?`,
    ],
    // NOT "typed tables on the map": `extractResources` seeds its name set from `...typed`
    // (lib/resources.js), so every typed table becomes a row unconditionally — that numerator
    // could never read below its own denominator. A table added to the generated types and named
    // nowhere else (no migration, no registry entry, no `.from()`, no `TABLES` key) still read
    // 58 / 58. `reach` is a fact the map does not guarantee: a typed table can sit unused in
    // `src/`, reached only from an edge function or from nothing at all.
    // NOT `reach !== "none"` either: that would count a table whose only src/ evidence is
    // `listed` (a bare literal nothing calls) or `test` (a call that exists to assert the
    // resource is *denied*) as seen — the same unfalsifiable-ledger failure the old boolean
    // field this row used to read (`reached_from_src`) already had, one column over. `feature` is
    // the only rung a real screen produced.
    // A denominator of zero is three different facts, and this row stated only one of them. The
    // same conflation the router row above was fixed for: a repo with no `types.ts` and a repo
    // whose `types.ts` this parser cannot follow produced byte-identical output, and
    // `missingSources` is existence-only so the present-but-unreadable case printed no `·` either.
    [
      "typed tables reached by a feature",
      typed.filter((t) => resourceByName.get(t)?.reach === "feature").length,
      typed.length,
      typed.length
        ? "the rest are `listed` (a bare literal, no recognized call), reached only by a `test`, or `none`"
        : { absent: `no ${TYPES_FILE} — no generated types to read`, unreadable: `${TYPES_FILE} present but no \`Tables: {\` block the parser can read`, read: "the generated types declare no tables" }[typedTablesState(root)],
    ],
    ["edge functions on the map", fns.filter((f) => resources.some((r) => r.used_by.includes(f))).length, fns.length, "a function touching no table cannot appear"],
    // Counts a surface whose OWN file, or a hook it imports one hop deep, yielded a resolved
    // reads/writes hit — see `resource-edges.js`'s module doc for the three patterns this covers
    // unevenly on purpose. What the numerator misses, stated so the gap does not read as "none":
    // a table name passed through a variable rather than written as a literal; a write made
    // through a Genesis `useResource`/`useOne` return value (recorded read-only, never write,
    // because this scan cannot see which of the bundled create/update/remove a caller calls); and
    // any mutation that happens only inside a rendered dialog or form — a separate file this scan
    // does not open, since only the surface's own imports count as its evidence.
    [
      "surfaces with a resource edge",
      surfaces.filter((s) => (s.reads?.length ?? 0) + (s.writes?.length ?? 0) > 0).length,
      surfaces.length,
      "a surface's own file plus the hooks it imports one hop deep; a table behind a variable, a Genesis useResource/useOne write, or a mutation only a rendered dialog calls is invisible here",
    ],
    // Counts what the label says: rows carrying an actual scope value. The old numerator counted
    // *declaredness* — `r.declared !== "undeclared"` — under a label about scope, which read 35/82
    // while only ~20 rows named a scope. Relabelling it to "declared" instead would have been the
    // cheaper fix and the dishonest one: it answers a friendlier question, and the resources whose
    // scope rule the parser cannot read would vanish from the ledger entirely, which is precisely
    // the blind spot a blind-spots ledger is for.
    [
      "resources with a declared scope",
      resources.filter((r) => r.scope !== "unknown").length,
      resources.length,
      scopeUnread ? `${scopeUnread} declare a rule the parser cannot read` : "",
    ],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return `# Blind spots — what map cannot see

**Not a score, and not a target.** Every denominator below is counted outside the map: screens in
the router, tables in the generated types, functions on disk. Both sides of each fraction are the
same unit, so the ceiling is reachable. Nothing you write in \`data/\` can move a single number
here — \`map check\` recomputes this file and fails on any difference, so editing it is
drift, not improvement. The only way to move a number is to teach map to see more.

Expect these to get *worse* when map gets better at reading the code. That is map working.

\`\`\`text
${rows.map(([label, n, d, note]) => `${label.padEnd(width)}  ${String(n).padStart(4)} / ${note ? `${String(d).padEnd(4)}  ${note}` : String(d)}`).join("\n")}
\`\`\`

<!-- GENERATED by \`map sync\`. Hand edits are overwritten. -->
`;
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

/**
 * Verifies `data/flows/` against `data/features/` and `data/surfaces/` — the ON-DISK committed
 * rows, not the freshly extracted ones in this run's `surfaces`/`resources` arrays. This table is
 * authored, not generated, and its checker reads exactly what `map flows`'s own render reads.
 *
 * Absent `data/flows/` means this repo does not author flows through this table — reported, not
 * fatal, the same rule every other optional source in this tool follows (see `missingSources`
 * above). Reporting instead of skipping in silence is what lets a repo that adopts the table later
 * discover the gate for free instead of wondering why nothing checks it.
 */
function checkFlows(root) {
  if (!existsSync(join(root, "data/flows"))) {
    return { present: false, errors: [], docStale: false };
  }
  const tables = loadMapTables(root);
  if (tables.errors.length > 0) {
    return { present: true, errors: tables.errors, docStale: false };
  }
  const rendered = renderUserFlowsDoc(tables);
  const path = outFile(root);
  const committed = existsSync(path) ? readFileSync(path, "utf8") : null;
  return { present: true, errors: [], docStale: committed !== rendered };
}

// ── entry ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const command = argv[0];
const rootFlag = argv.indexOf("--root");
const root = resolve(rootFlag === -1 ? process.cwd() : argv[rootFlag + 1]);

try {
  if (command === "flows") {
    const tables = loadMapTables(root);
    if (tables.errors.length > 0) {
      console.error(`map flows: ${tables.errors.length} problem(s):\n`);
      for (const e of tables.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    const rendered = renderUserFlowsDoc(tables);
    mkdirSync(dirname(outFile(root)), { recursive: true });
    writeFileSync(outFile(root), rendered);
    console.log(`map flows: wrote ${relative(root, outFile(root))}`);
    process.exit(0);
  }

  if (!["init", "sync", "check"].includes(command)) {
    console.log(HELP);
    process.exit(command ? 1 : 0);
  }
  const missing = missingSources(root);
  const features = readFeatures(root);
  // Resources first: the surface scan's reads/writes join against resource ids, which only
  // exist once `extractResources` has reconciled a name to one. Computing resources first does
  // not compromise "the two halves are independent" below — a repo with no data layer simply
  // hands the surface scan an empty index, so every surface's reads/writes come back empty
  // (a real fact: there is nothing to reference), not a crash and not a skipped table.
  const resources = assertUniqueIds(extractResources(root), "resource");
  const resourceIndex = {
    tableByKey: legacyTables(root),
    addressed: declaredResources(root, legacyTables(root)).map((d) => d.name),
    nameToId: new Map(resources.map((r) => [r.name, r.id])),
  };
  // The two halves are independent: neither absence takes the other down.
  const surfaces = joinFeatures(assertUniqueIds(extractSurfaces(root, resourceIndex)), features);
  // Nothing read at all is not a stack this tool maps. Writing "no screens, no tables" for it
  // would be a confident, wrong fact — the failure mode the whole map avoids.
  //
  // Asked of what was extracted, not of what exists on disk. The `existsSync` form of this guard
  // could not fire: `RESOURCE_SOURCES` lists the whole `src` tree as a source, so every repo with
  // a directory named `src` had at least one "present" source and the guard was dead code for
  // every JS/TS repo there is. A checkout holding one `src/a.ts` got a committed ledger reading
  // `0 / 0` on every row, and `check` then held that green forever — the ledger's own preamble
  // tells the reader those denominators were counted outside the map, so the zeros read as facts
  // about the repo rather than as the tool having read nothing.
  //
  // A repo that already has a committed map is not this case, and gets the per-table refusal
  // below instead, which names the table and the source that went missing.
  const committed = committedRows(root, "surfaces").size + committedRows(root, "resources").size;
  if (surfaces.length === 0 && resources.length === 0 && committed === 0) {
    throw new Error(
      `no extractable source under ${root} — looked for ` +
        `${Object.values(SOURCES).flat().map((g) => g.join(" | ")).join(", ")}.\n` +
        `  Nothing here is a codebase map reads; refusing to write an empty map.`,
    );
  }
  const ledger = blindSpots(root, surfaces, resources);
  const diffs = {
    surfaces: diffTable(root, "surfaces", surfaces, surfaceRow),
    resources: diffTable(root, "resources", resources, resourceRow),
    // Generated output is generated output. The ledger is checked, not just written.
    ledger: diffLedger(root, ledger),
  };
  const r = report(root, surfaces, features);
  const unparsedLegacy = unparsedLegacyTableFile(root);

  if (command === "check") {
    const { drift, dead, coverage } = printReport(diffs, r, surfaces, resources, missing, unparsedLegacy);
    // Flows are authored, not extracted, so the surface/resource scan above never reads
    // data/flows/ — its one guarantee is that every step names a surface that exists, and a
    // guarantee nothing runs is a claim, not a check. This is what makes it true, folded into the
    // one command rather than left as a second gate doing the other half of one job.
    const flowsCheck = checkFlows(root);
    if (flowsCheck.present && flowsCheck.errors.length > 0) {
      console.log(`\n  flows: ${flowsCheck.errors.length} problem(s):`);
      for (const e of flowsCheck.errors) console.log(`    - ${e}`);
    }
    if (flowsCheck.present && flowsCheck.docStale) {
      console.log(`\n  ~ ${relative(root, outFile(root))} is stale — run \`map flows\` and commit.`);
    }
    const flowsFailed = flowsCheck.errors.length > 0 || flowsCheck.docStale;
    if (drift > 0) console.log(`\n  ${drift} stale fact(s) — run \`map sync\` and commit.`);
    // `sync` never writes data/features/, so it cannot clear this one — printing it as the remedy
    // sent a reader to a command that provably does nothing. The glob is the thing to fix.
    if (dead > 0) console.log(`  ${dead} feature(s) own no file that exists — fix the \`owns:\` glob, or delete the row.`);
    else if (drift === 0 && !flowsFailed && coverage > 0) console.log(`\n  Map is current. ${coverage} screen(s) await a job.`);
    process.exit(drift + dead > 0 || flowsFailed ? 1 : 0);
  }

  // Refuse to empty a populated table. A router refactor, a moved registry, or a source map can
  // no longer find looks exactly like "there is nothing here", and wiping the map on
  // that reading loses more than it reports. Per table, so a repo that has one and not the other
  // keeps the one it has.
  //
  // The two tables' writes are independent too — the same promise the two *halves* make
  // (HELP above, SKILL.md's "the other half runs anyway"). A refusal on one table used to `throw`
  // from inside this loop, which unwound past the other table's `writeTable` call and past the
  // ledger write below it: a refusal on surfaces alone left `data/resources/` holding a fact
  // (`rls_enabled: "true"`) the freshly-read migrations already contradicted, with no write and no
  // error able to fix it. Collecting refusals and writing everything else first keeps both
  // properties this guard exists for — a populated table is never silently emptied, and a refusal
  // still exits non-zero — without letting one table's refusal block the other's write.
  const refusals = [];
  const written = [];
  for (const [table, rows, serialize] of [
    ["surfaces", surfaces, surfaceRow],
    ["resources", resources, resourceRow],
  ]) {
    const existing = committedRows(root, table).size;
    if (rows.length === 0 && existing > 0) {
      refusals.push({
        table,
        message:
          `extracted 0 ${table} but ${existing} row(s) are committed — refusing to empty the table.\n` +
          `      ${missing[table].length ? `Source(s) not found: ${missing[table].join(", ")}.` : "Map no longer understands its sources."}\n` +
          `      Fix it, or delete data/${table}/ deliberately.`,
      });
      continue;
    }
    // A table whose every source is absent gets no empty directory: the absence is reported, not
    // materialised as a table that claims this repo has no screens.
    if (missing[table].length === SOURCES[table].length) continue;
    writeTable(root, table, rows, serialize);
    written.push(table);
  }
  if (refusals.length > 0) {
    // The ledger is derived from both tables (it cross-references surfaces and resources), so
    // writing it here would commit a blind-spot count computed in part from the table this run is
    // simultaneously refusing to write — a stale fact stated with the same confidence as a fresh
    // one. Leave it as it was; the next clean `sync` will catch it up along with everything else.
    throw new Error(
      `${written.length ? `Wrote: ${written.map((t) => `data/${t}/`).join(", ")}.` : "Wrote nothing."} ` +
        `Did not write: ${refusals.map((ref) => `data/${ref.table}/`).join(", ")}, ${LEDGER} (derived from both tables).\n` +
        refusals.map((ref) => `  - ${ref.message}`).join("\n"),
    );
  }
  mkdirSync(join(root, "data/_views"), { recursive: true });
  writeFileSync(join(root, LEDGER), ledger, "utf8");
  printReport(diffs, r, surfaces, resources, missing, unparsedLegacy);
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
