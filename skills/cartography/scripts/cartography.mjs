#!/usr/bin/env node
/**
 * cartography — map a codebase into gitdata rows.
 *
 * Extracts the facts a codebase already knows about itself (routes, screens, the dialogs each
 * screen opens, which design system it leans on) and writes them as machine-owned rows. Human
 * intent — what job a screen serves — lives in a separate table the extractor never opens.
 *
 *   data/surfaces/    machine-owned · rewritten every run · never hand-edited
 *   data/features/    human-owned   · never touched here  · joins via `owns:` globs
 *
 * That separation is the whole design. Mixing generated and authored fields in one file makes
 * every re-run a merge conflict; keeping them in two tables makes regeneration safe by
 * construction — the extractor has no reason to open the file you wrote.
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

Reads:  <root>/src/App.tsx, <root>/src/pages/**, <root>/src/lib/nav-registry.ts (optional)
Writes: <root>/data/surfaces/*.md
Never touches: <root>/data/features/*
`;

// ── tiny helpers ────────────────────────────────────────────────────────────────
const uniq = (a) => [...new Set(a)];

/** What counts as a verb on a screen. A convention, named here so it is visible and changeable. */
const AFFORDANCE_SUFFIXES = ["Form", "Dialog", "Sheet", "Panel", "Modal"];

/** Components that hold a route but are not a screen: chrome, guards, redirects. */
const NOT_A_SCREEN = /^(Navigate|Legacy)|(?:ScopeResolver|Layout|Guard|Provider|Boundary)$/;

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
const matchesAny = (path, globs) => globs.some((g) => globToRe(g).test(path));

// ── extraction ──────────────────────────────────────────────────────────────────
/** URL prefix a scope resolver claims: `<Route path="c/:clientId">` opens the client scope. */
const SCOPE_PREFIX = { c: "client", t: "team", p: "project", pd: "product" };

/**
 * Every `<Route>` token in order: opening tags with their text, and closers.
 *
 * Each opening tag is scanned to its first `>` at brace depth zero rather than matched as a shape,
 * because a route written across several lines is still one route. Matching `element={<` as a
 * literal missed `/auth` — the app's own front door — for no reason but a newline, and the map
 * then read as if the screen did not exist.
 */
function routeTokens(src) {
  const out = [];
  for (const m of src.matchAll(/<\/?Route\b/g)) {
    if (src[m.index + 1] === "/") {
      out.push({ close: true });
      continue;
    }
    let depth = 0;
    for (let i = m.index; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        out.push({ close: false, text: src.slice(m.index, i), selfClosing: src[i - 1] === "/" });
        break;
      }
    }
  }
  return out;
}

/** The contents of the balanced `{...}` beginning at `open`. */
function braced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
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
  // A commented-out route is not a route. `{/* ... */}` is the only comment form that can wrap one.
  const src = readFileSync(appPath, "utf8").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
  const found = [];
  const open = []; // one entry per unclosed <Route>: the scope it opens, or null
  for (const t of routeTokens(src)) {
    if (t.close) {
      open.pop();
      continue;
    }
    const prefix = (t.text.match(/\bpath="\/?([a-z]{1,2})\/:\w+"/) || [])[1];
    const opens = prefix ? (SCOPE_PREFIX[prefix] ?? prefix) : null;
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

/** nav-registry, when present, is the only place a screen's group and human label are declared. */
function navFacts(root) {
  const p = join(root, "src/lib/nav-registry.ts");
  if (!existsSync(p)) return {};
  const src = readFileSync(p, "utf8");
  const facts = {};
  for (const chunk of src.split(/\{\s*id:/).slice(1)) {
    const get = (re) => (chunk.match(re) || [])[1];
    const suffix = get(/suffix:\s*"([^"]*)"/);
    if (suffix === undefined) continue;
    facts[suffix] = {
      title: get(/title:\s*"([^"]+)"/),
      group: get(/group:\s*"([^"]+)"/),
      role: get(/role:\s*"([^"]+)"/) ?? null,
    };
  }
  return facts;
}

/** A screen's dialog imports are its verbs: what can be done here without leaving. */
function componentFacts(root, component) {
  for (const dir of ["src/pages", "src/components"]) {
    const p = join(root, dir, `${component}.tsx`);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    // Every specifier in the braces, not just the first: `import { CreateHabitForm, LogHabitForm }`
    // previously yielded only CreateHabitForm, dropping the core verb of the habits screen.
    const affordances = uniq(
      [...src.matchAll(/import\s+(?:\w+\s*,\s*)?\{([^}]*)\}\s*from/g)]
        .flatMap((m) => m[1].split(","))
        .map((sp) => sp.trim().split(/\s+as\s+/)[0].trim())
        .filter((n) => AFFORDANCE_SUFFIXES.some((suf) => n.endsWith(suf))),
    ).sort();
    const genesis = /@marktiderman\/genesis/.test(src);
    const local = /@\/components\/(data|ui)\b/.test(src);
    return {
      file: relative(root, p),
      affordances,
      layout: genesis && local ? "partial" : genesis ? "genesis" : local ? "local" : "none",
    };
  }
  return { file: null, affordances: [], layout: "unknown" };
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
      const suffix = primary[0];
      const n = nav[suffix === "(index)" ? "" : suffix] ?? {};
      return {
        id: s.component.replace(/Page$/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
        title: n.title ?? s.component.replace(/Page$/, ""),
        ...s,
        scopes: uniq(s.scopes).sort(),
        group: n.group ?? null,
        role: n.role ?? null,
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
group: ${yamlScalar(s.group)}
role: ${yamlScalar(s.role)}
layout: ${yamlScalar(s.layout)}
affordances: ${yamlList(s.affordances)}
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

function report(root, surfaces) {
  const features = readFeatures(root);
  const claimed = (file) => features.filter((f) => file && matchesAny(file, f.owns)).map((f) => f.id);
  const unclaimed = surfaces.filter((s) => claimed(s.file).length === 0);
  // A feature owning only code cartography does not extract (an edge function, a shared hook) is
  // not dead — this tool simply cannot see it. Reporting it would be a permanent false positive
  // that no action can clear, so only globs pointing INTO an extracted area are judged.
  const extractedDirs = uniq(surfaces.map((s) => s.file?.split("/").slice(0, 2).join("/")).filter(Boolean));
  const looksExtractable = (g) => extractedDirs.some((d) => g.startsWith(d));
  const dead = features.filter(
    (f) =>
      f.owns.length > 0 &&
      f.owns.some(looksExtractable) &&
      !surfaces.some((s) => s.file && matchesAny(s.file, f.owns)),
  );
  return { unclaimed, dead, features };
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
function writeSurfaces(root, surfaces) {
  const dir = join(root, "data/surfaces");
  mkdirSync(dir, { recursive: true });
  const isRow = (f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md";
  for (const f of readdirSync(dir)) {
    if (isRow(f) && statSync(join(dir, f)).isFile()) rmSync(join(dir, f));
  }
  for (const s of surfaces) writeFileSync(join(dir, `${s.id}.md`), surfaceRow(s), "utf8");
}

function committedSurfaces(root) {
  const dir = join(root, "data/surfaces");
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
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

function printReport({ added, removed, changed }, { unclaimed, dead }, surfaces) {
  const line = (mark, label, items) =>
    items.length && console.log(`  ${mark} ${label.padEnd(22)} ${items.join(", ")}`);
  console.log(`  ${surfaces.length} surface(s) extracted`);
  line("+", "new", added);
  line("-", "gone", removed);
  line("~", "changed", changed);
  line("?", "claimed by no feature", unclaimed.map((s) => s.id));
  line("!", "feature owns nothing", dead.map((f) => f.id));
  return added.length + removed.length + changed.length + unclaimed.length + dead.length;
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
  const surfaces = assertUniqueIds(extractSurfaces(root));
  const d = diff(root, surfaces);
  const r = report(root, surfaces);

  if (command === "check") {
    const findings = printReport(d, r, surfaces);
    if (findings > 0) console.log(`\n  ${findings} finding(s) — run \`cartography sync\` and commit.`);
    process.exit(findings > 0 ? 1 : 0);
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
