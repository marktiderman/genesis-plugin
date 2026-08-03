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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

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
const yamlList = (a) => `[${a.join(", ")}]`;

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
/**
 * Route sections keyed by scope. A scope resolver opens a nested block of routes, so the file is
 * sliced at each resolver rather than parsed as a tree — the shape only needs to be right enough
 * to say which scopes a screen is reachable in.
 */
function routeSections(appSrc) {
  const marks = [...appSrc.matchAll(/<Route\s+path="([a-z]{1,2})\/:(\w+)"/g)].map((m) => ({
    scope: { c: "client", t: "team", p: "project", pd: "product" }[m[1]] ?? m[1],
    at: m.index,
  }));
  const cuts = [{ scope: "personal", at: 0 }, ...marks].sort((a, b) => a.at - b.at);
  const out = {};
  cuts.forEach((cut, i) => {
    const end = cuts[i + 1]?.at ?? appSrc.length;
    out[cut.scope] = appSrc.slice(cut.at, end);
  });
  return out;
}

function extractRoutes(root) {
  const appPath = join(root, "src/App.tsx");
  if (!existsSync(appPath)) throw new Error(`no src/App.tsx under ${root}`);
  const src = readFileSync(appPath, "utf8");
  const found = [];
  for (const [scope, section] of Object.entries(routeSections(src))) {
    // A route's element may be wrapped by a guard (`<AdminGuard><AdminDashboard /></AdminGuard>`).
    // The screen is the innermost component; taking the outer one collapses every guarded page
    // into a single row named after the guard.
    for (const m of section.matchAll(
      /<Route\s+(?:path="([^"]*)"|index)\s+element=\{<(\w+)[^>]*>\s*(?:<(\w+))?/g,
    )) {
      const [, path, outer, inner] = m;
      const component = inner ?? outer;
      if (/^(Navigate|Legacy)/.test(component) || /ScopeResolver$/.test(component)) continue;
      found.push({ scope, path: path ?? "", component });
    }
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
    const affordances = uniq(
      [...src.matchAll(/import\s+\{?\s*(\w*(?:Form|Dialog|Sheet|Panel))\b/g)].map((m) => m[1]),
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
    s.routes[scope] = path === "" ? "(index)" : path;
    s.scopes.push(scope);
  }
  return [...byComponent.values()]
    .map((s) => {
      const suffix = s.routes.personal ?? Object.values(s.routes)[0];
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

const surfaceRow = (s) =>
  `---
id: ${s.id}
kind: surface
title: ${s.title}
component: ${s.component}
file: ${s.file ?? "null"}
routes: ${yamlList(Object.entries(s.routes).sort().map(([k, v]) => `${k}=${v}`))}
scopes: ${yamlList(s.scopes)}
group: ${s.group ?? "null"}
role: ${s.role ?? "null"}
layout: ${s.layout}
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
      const src = readFileSync(join(dir, f), "utf8");
      const fm = (src.match(/^---\n([\s\S]*?)\n---/) || [])[1] ?? "";
      const owns = (fm.match(/^owns:\s*\[([^\]]*)\]/m) || [])[1] ?? "";
      return {
        id: (fm.match(/^id:\s*(\S+)/m) || [])[1] ?? basename(f, ".md"),
        owns: owns.split(",").map((g) => g.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
      };
    });
}

function report(root, surfaces) {
  const features = readFeatures(root);
  const claimed = (file) => features.filter((f) => file && matchesAny(file, f.owns)).map((f) => f.id);
  const unclaimed = surfaces.filter((s) => claimed(s.file).length === 0);
  const dead = features.filter(
    (f) => f.owns.length > 0 && !surfaces.some((s) => s.file && matchesAny(s.file, f.owns)),
  );
  return { unclaimed, dead, features };
}

// ── commands ────────────────────────────────────────────────────────────────────
function writeSurfaces(root, surfaces) {
  const dir = join(root, "data/surfaces");
  // Rewritten wholesale so a deleted screen's row disappears rather than lingering.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
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
  const surfaces = extractSurfaces(root);
  const d = diff(root, surfaces);
  const r = report(root, surfaces);

  if (command === "check") {
    const findings = printReport(d, r, surfaces);
    if (findings > 0) console.log(`\n  ${findings} finding(s) — run \`cartography sync\` and commit.`);
    process.exit(findings > 0 ? 1 : 0);
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
