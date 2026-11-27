/**
 * `map imago` — the code map Imago's `work map load` takes, and a dry run of that load.
 *
 * Imago keeps one code map per product (imago.code_maps): the code's features, with the screens,
 * tables and criteria each claims, and every screen with the features that claim it. Its loader
 * (`product_load_code_map`) replaces that one snapshot and mirrors the code's criteria; it never
 * writes a map feature. This module builds the snapshot from a checkout and, before anything is
 * loaded, says what the load would change, against the map as it stands.
 *
 * It never writes: no file unless `--out` names one, and never a database call. Loading stays
 * Imago's own step (`bun run work map load --product <slug> <file>`), taken by a person who has
 * read the dry run.
 *
 * Node built-ins only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { stripJs } from "./resources.js";

const ROUTES_DIR = "src/routes";

/** Every file under `dir`, relative to `root`, in a stable order. */
function walk(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * A TanStack route id (`/_owner/$product/features/$featureId/`) as the address a person types:
 * pathless segments (`_owner`) and the trailing `_` that breaks out of a parent's layout
 * (`sessions_`) are not in the URL, and `index` / a trailing slash is the parent's own address.
 */
export function routeUrl(id) {
  const segments = id
    .split("/")
    .filter(Boolean)
    .filter((s) => !s.startsWith("_"))
    .filter((s) => !/^\(.*\)$/.test(s)) // a route group, `(auth)`, is not in the URL
    .map((s) => s.replace(/_$/, ""))
    .filter((s) => s !== "index");
  return "/" + segments.join("/");
}

/**
 * The screens of a TanStack Router app: one per file under src/routes that calls
 * `createFileRoute("…")` with a `component`. A layout (its last segment pathless, like `_owner`,
 * or a route that renders `<Outlet />` and has child routes) wraps screens rather than being one; the root route and server-only routes have no
 * `createFileRoute(…)` component. A route file named through a variable is not read.
 */
export function tanstackRoutes(root, dir = ROUTES_DIR) {
  const found = [];
  for (const file of walk(root, dir)) {
    if (!/\.(t|j)sx?$/.test(file) || /\.(test|spec)\./.test(file)) continue;
    // Comments blanked first: a commented-out route is not a route.
    const src = stripJs(readFileSync(join(root, file), "utf8"));
    // The route is the one assigned (`Route = createFileRoute("…")({ … })`), not a call that sits
    // in a string, and its component is read from that call's own options.
    // Matching runs on a copy with every string's contents blanked, so text inside a string
    // (`'Route = createFileRoute("/old")…'`, `"component: fake"`) is never read as code; the
    // id is then read from the original at the same place.
    const code = blankStrings(src);
    const m = code.match(/\bRoute\s*=\s*createFileRoute\(\s*(["'`])([^"'`]*)\1\s*\)\s*\(/);
    if (!m) continue;
    if (!/\bcomponent\s*:/.test(callBody(code, m.index + m[0].length - 1))) continue;
    const idStart = m.index + m[0].indexOf(m[1]) + 1;
    const id = src.slice(idStart, idStart + m[2].length);
    if (!id.trim()) continue;
    const last = id.split("/").filter(Boolean).pop() ?? "";
    // A pathless layout (`_layout`) is not a screen, but it still counts as its parent's child.
    found.push({ id, url: routeUrl(id), file: relative(root, join(root, file)), outlet: /<Outlet\b/.test(src), pathless: last.startsWith("_") });
  }
  // A route that renders <Outlet /> and has child routes (by id, whatever the file layout: a
  // folder, `posts.index.tsx`, `posts/route.tsx`) is its children's layout, not a screen.
  const prefix = (id) => id.replace(/\/+$/, "") + "/";
  const hasChild = (r) => found.some((o) => o !== r && o.id !== r.id && o.id.startsWith(prefix(r.id)) && o.id !== prefix(r.id));
  const indexOf = (r) => found.some((o) => o !== r && o.id === prefix(r.id));
  const screens = found
    .filter((r) => !r.pathless)
    .filter((r) => !(r.outlet && (hasChild(r) || indexOf(r))))
    .map(({ id, url, file }) => ({ id, url, file }));
  return screens.sort((a, b) => a.url.localeCompare(b.url) || a.file.localeCompare(b.file));
}

/** `src` with each string's contents replaced by spaces (quotes and length kept). */
function blankStrings(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c !== '"' && c !== "'" && c !== "`") {
      out += c;
      continue;
    }
    out += c;
    let j = i + 1;
    for (; j < src.length && src[j] !== c; j++) {
      if (src[j] === "\\" && j + 1 < src.length) {
        out += "  ";
        j++;
      } else out += src[j] === "\n" ? "\n" : " ";
    }
    if (j < src.length) out += c;
    i = j;
  }
  return out;
}

/** The text of the call whose `(` is at `open`, to its matching `)` (strings skipped). */
function callBody(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") if (--depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** A glob as `map` reads `owns:` (`*` within a segment, `**` across them, `{a,b}`). */
function globToRe(glob) {
  const alts = glob.match(/\{([^}]*)\}/);
  if (alts) return new RegExp(alts[1].split(",").map((a) => globToRe(glob.replace(alts[0], a)).source).join("|"));
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
const matchesAny = (file, globs) => globs.some((g) => globToRe(g).test(file));

/**
 * The code's features, from the two places a repo states them: a Genesis registry
 * (features.json: id, name, status, links.code, acceptance) and `data/features/` rows (id,
 * `owns:` globs). Both are authored; this only reads them.
 */
export function codeFeatures(root, dataFeatures = []) {
  const out = new Map();
  const reg = join(root, "features.json");
  if (existsSync(reg)) {
    const list = JSON.parse(readFileSync(reg, "utf8")).features ?? [];
    for (const f of list) {
      if (!f?.id) continue;
      out.set(f.id, {
        id: f.id,
        name: f.name ?? f.id,
        status: f.status ?? null,
        code: [...(f.links?.code ?? [])],
        criteria: [...(f.acceptance ?? [])].filter((t) => typeof t === "string" && t.trim()),
        from: "features.json",
      });
    }
  }
  for (const f of dataFeatures) {
    const had = out.get(f.id);
    if (had) had.code.push(...f.owns);
    else out.set(f.id, { id: f.id, name: f.title ?? f.id, status: null, code: [...f.owns], criteria: [], from: "data/features" });
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The code map in the shape `product_load_code_map` takes: `meta.commit`, `features` (each with
 * its screens, tables, code and criteria), `screens` (each with the features claiming it, by
 * route file) and `resources`. `tablesOf(file)` gives the tables a screen file reads or writes.
 */
export function buildCodeMap({ meta, screens, features, resources, tablesOf = () => [] }) {
  const claims = (file) => features.filter((f) => matchesAny(file, f.code)).map((f) => f.id);
  const outScreens = screens.map((s) => ({ url: s.url, file: s.file, features: claims(s.file) }));
  const outFeatures = features.map((f) => {
    const mine = outScreens.filter((s) => s.features.includes(f.id));
    return {
      id: f.id,
      name: f.name,
      status: f.status,
      screens: mine.map((s) => s.file),
      tables: [...new Set(mine.flatMap((s) => tablesOf(s.file)))].sort(),
      code: f.code,
      criteria: f.criteria,
    };
  });
  return { meta, features: outFeatures, screens: outScreens, resources };
}

/**
 * What loading `next` would change, against the map as it stands.
 *
 * `mapFeatures` are the product's map features (key, name, kind; read from Imago); `current` is
 * the code map loaded now, when known. The loader writes two things only, and this says both:
 * the code snapshot (replaced whole) and the code's criteria (source `code`: added, re-worded or
 * dropped). Map features (name, owner, job, placement, status, stage) are never written by it.
 */
export function planLoad(next, { mapFeatures = null, current = undefined } = {}) {
  const keys = mapFeatures ? new Map(mapFeatures.map((f) => [String(f.key).toLowerCase(), f])) : null;
  const placed = keys ? next.features.filter((f) => keys.has(f.id.toLowerCase())) : [];
  const unplaced = keys ? next.features.filter((f) => !keys.has(f.id.toLowerCase())) : [];
  const inCode = new Set(next.features.map((f) => f.id.toLowerCase()));
  const noCode = keys
    ? mapFeatures.filter((f) => !["component", "area"].includes(f.kind ?? f.level) && !inCode.has(String(f.key).toLowerCase()))
    : [];
  const crit = (m) =>
    new Map((m?.features ?? []).flatMap((f) => (f.criteria ?? []).map((t, i) => [`${f.id}#${i + 1}`, String(t).trim()])));
  const before = crit(current);
  const after = crit(next);
  const criteria =
    current === undefined
      ? null
      : {
          added: [...after.keys()].filter((k) => !before.has(k)).length,
          changed: [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k)).length,
          dropped: [...before.keys()].filter((k) => !after.has(k)).length,
        };
  return {
    snapshot: {
      from: current === undefined ? "unknown" : current ? current.meta?.commit ?? "?" : "none",
      to: next.meta.commit,
      screens: { from: current ? current.screens?.length ?? 0 : null, to: next.screens.length },
      features: { from: current ? current.features?.length ?? 0 : null, to: next.features.length },
    },
    placed,
    unplaced,
    unclaimed: next.screens.filter((s) => s.features.length === 0),
    claimed: next.screens.filter((s) => s.features.length > 0),
    noCode,
    criteria,
    untouched: mapFeatures ? mapFeatures.length : null,
  };
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|");

/** The dry run as Markdown: what loads, what it changes, and what it leaves alone. */
export function renderPlan(plan, { product, written = null }) {
  const p = plan;
  const lines = [];
  lines.push(`# Dry run: loading ${product}'s code map into Imago`, "");
  lines.push(
    written
      ? `Wrote the code map to \`${written}\` only. Nothing was sent to Imago.`
      : "Nothing was written: no file, and no call to Imago.",
    "",
  );
  lines.push("## What the load would do", "");
  lines.push("| | Now | After the load |", "| --- | --- | --- |");
  lines.push(`| Code snapshot (commit) | ${cell(p.snapshot.from)} | ${cell(p.snapshot.to)} |`);
  lines.push(`| Screens in the code | ${p.snapshot.screens.from ?? "unknown"} | ${p.snapshot.screens.to} |`);
  lines.push(`| Features in the code | ${p.snapshot.features.from ?? "unknown"} | ${p.snapshot.features.to} |`);
  lines.push(
    `| Code criteria (source "code" only) | | ${
      p.criteria ? `${p.criteria.added} added, ${p.criteria.changed} re-worded, ${p.criteria.dropped} dropped` : "unknown: the loaded snapshot wasn't given (--current)"
    } |`,
  );
  lines.push("");
  lines.push("## What it leaves alone", "");
  lines.push(
    p.untouched === null
      ? "The map's features weren't given (--map-features), so this can't count them. The loader writes no map feature in any case."
      : `All ${p.untouched} map features keep their name, owner, job, place on the map, status and stage: 0 changed, 0 removed. The loader writes only the code snapshot and the code's own criteria.`,
    "",
  );
  if (p.untouched !== null) {
    lines.push("## Code features and the map", "");
    lines.push(`${p.placed.length} code features match a map feature by key; ${p.unplaced.length} don't, and would show in Gaps as "In the code, not on the map" (nothing is added to the map).`, "");
    if (p.unplaced.length) {
      lines.push("| Code feature | Name | Status | Screens |", "| --- | --- | --- | --- |");
      for (const f of p.unplaced) lines.push(`| ${cell(f.id)} | ${cell(f.name)} | ${cell(f.status)} | ${f.screens.length} |`);
      lines.push("");
    }
    lines.push(`${p.noCode.length} map features (not areas or components) would show in Gaps as "On the map, no code".`, "");
  }
  lines.push("## Screens", "");
  lines.push(`${p.claimed.length} of ${p.claimed.length + p.unclaimed.length} screens are claimed by a code feature.`, "");
  lines.push("| Screen | Route file | Claimed by |", "| --- | --- | --- |");
  for (const s of [...p.claimed, ...p.unclaimed]) lines.push(`| ${cell(s.url)} | ${cell(s.file)} | ${cell(s.features.join(", ") || "nobody")} |`);
  lines.push("");
  return lines.join("\n");
}
