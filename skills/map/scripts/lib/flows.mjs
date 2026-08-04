/**
 * flows.mjs — load and verify `data/flows/`, and render `docs/USER-FLOWS.md` from it.
 *
 * Reads three declared/generated tables and can render one derived doc:
 *
 *   data/features/*.md   read: id, slug, title, status
 *   data/surfaces/*.md   read: id, title, claimed_by   (written by `map sync` — never written here)
 *   data/flows/*.md      read: id, slug, title, feature, actor, entry, the Steps list, the Outcome
 *   docs/USER-FLOWS.md   rendered — GENERATED, never hand-edited
 *
 * A flow step names a surface. This module is what makes that claim machine-checkable: every
 * step's surface id must exist as a real row in data/surfaces/, and every flow's feature id must
 * exist as a real row in data/features/, or `loadMapTables` reports the problem instead of letting
 * a doc get built on an unverified claim. See a consumer's `data/flows/README.md` for the row
 * grammar this expects.
 *
 * Deterministic: every list below is sorted by id before it is rendered, and nothing here embeds
 * the current time. Rendering twice in a row from the same rows produces byte-identical output.
 *
 * `data/flows/` is optional, like every other source in this tool: a repo that does not author
 * flows through this table simply has none to load, not an error — `map check` decides what an
 * absent table means for its exit code, this module only reports what it found.
 *
 * Node built-ins only, no dependencies. Pure library: no disk writes, no `process.exit`, no
 * console output — `scripts/map.mjs`'s `flows`/`check` commands are the only callers that treat
 * `errors` as fatal or write `docs/USER-FLOWS.md`, and `scripts/lib/score.mjs` imports the loaders
 * below (plus the frontmatter reader) so the map dashboard's "authored" numbers are computed
 * exactly once and read here, not reimplemented.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { readFrontmatter } from "./frontmatter.js";
import { rowFilesIn } from "./rows.js";

export const ALLOWED_ACTORS = ["solo", "member", "coached-client", "coach", "admin"];
export const ALLOWED_ENTRY = ["nav", "inline", "external", "system"];

/** Where `renderUserFlowsDoc`'s output belongs, for a given root. */
export const outFile = (root) => join(root, "docs/USER-FLOWS.md");

// ── tiny frontmatter reader ─────────────────────────────────────────────────
// Reads exactly the subset flow/feature/surface rows use: bare or `"quoted"` scalars, and
// flow-style lists (`[a, b]` / `["a", "b"]`). Fails loudly on anything outside that subset rather
// than guessing — a silently-wrong parse is worse than a crash here.
//
// Exported: this is the one frontmatter reader `scripts/lib/score.mjs` reuses for data/resources/,
// which this module itself never reads — one reader for the whole map, not two that can disagree.

/**
 * The map has ONE frontmatter reader. This module used to carry a second, looser copy — two
 * readers of one format drift, and the looser one accepts rows the gate would reject.
 * Re-exported under the old name so `score.mjs` keeps working.
 */
export const parseFrontmatter = (text, file) => readFrontmatter(text, { file });

export function bodyOf(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  return m ? m[1] : "";
}

/** Pull a `## Heading` section's raw text out of a markdown body (up to the next `##` or EOF). */
export function section(body, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  const m = re.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/**
 * Rows in a table dir, as paths relative to it — the one definition, from `lib/rows.js`.
 *
 * This used to spell the definition itself, and got it wrong twice. Its README clause was
 * `f !== "README.md"`, case-SENSITIVE, where gitdata's loader — and this tool's other copy —
 * exclude `readme.md` in any casing. So a table documented in `ReadMe.md` was a row here and a
 * non-row everywhere else, and since the reader below fails loudly on a file with no frontmatter,
 * `map check` exited 1 on `features/ReadMe.md: no frontmatter block` with nothing `sync` could do
 * about it. And it read one flat level, so a sharded table's rows were not verified at all: a flow
 * step naming a deleted surface passed, because neither the flow nor the surface was seen.
 *
 * An absent dir is an absent table, not a crash: `data/flows/` in particular is optional (see the
 * module doc), and `rowFilesIn` on a directory that was never created throws ENOENT rather than
 * reporting an empty table the same way every other missing source in this tool does.
 */
export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return rowFilesIn(dir);
}

export const STEP_RE = /^(\d+)\.\s+`([a-z0-9-]+)`\s+—\s+(.+)$/;

// ── load the three tables ───────────────────────────────────────────────────

/**
 * Reads data/features/, data/surfaces/, data/flows/ under `root` and cross-validates every
 * reference between them (flow → feature, step → surface, duplicate ids). Pure: does not exit
 * the process or touch docs/USER-FLOWS.md — `scripts/map.mjs`'s `flows`/`check` commands are the
 * only callers that treat `errors` as fatal.
 */
export function loadMapTables(root = process.cwd()) {
  const featuresDir = join(root, "data/features");
  const surfacesDir = join(root, "data/surfaces");
  const flowsDir = join(root, "data/flows");

  const errors = [];
  const fail = (msg) => errors.push(msg);

  // An id is the join key: a step names a surface by id, a flow names a feature by id. Two rows
  // claiming one id makes every reference to it ambiguous, and the failure is silent in both
  // shapes it takes — a Map keyed by id drops the first row on the floor, and the flows array
  // keeps both and renders them twice under one heading. The filename check does not catch it,
  // because it only ever compares a file to itself. A stale id resurrected by a merge, or a copy
  // of `_template.md` with the id left alone, is exactly how this arrives.
  const seen = new Map(); // "table:id" -> the file that claimed it first
  const claimId = (table, id, file) => {
    const key = `${table}:${id}`;
    if (seen.has(key)) fail(`${file}: id "${id}" is already used by ${seen.get(key)}`);
    else seen.set(key, file);
  };

  const features = new Map(); // id -> { id, slug, title, status }
  for (const f of listFiles(featuresDir)) {
    const fm = parseFrontmatter(readFileSync(join(featuresDir, f), "utf8"), `features/${f}`);
    // Before claimId, before the Map, before anything sorts on it: an absent id becomes a Map key
    // of `undefined` and then a TypeError inside localeCompare, far from the row that caused it.
    // Collected as an error and skipped, so the loader keeps reporting every problem in one pass.
    if (!fm.id) {
      fail(`features/${f}: no id`);
      continue;
    }
    claimId("features", fm.id, `features/${f}`);
    features.set(fm.id, { id: fm.id, slug: fm.slug, title: fm.title, status: fm.status });
  }

  const surfaces = new Map(); // id -> { id, title, claimed_by: [] }
  for (const f of listFiles(surfacesDir)) {
    const fm = parseFrontmatter(readFileSync(join(surfacesDir, f), "utf8"), `surfaces/${f}`);
    // Before claimId, before the Map, before anything sorts on it: an absent id becomes a Map key
    // of `undefined` and then a TypeError inside localeCompare, far from the row that caused it.
    // Collected as an error and skipped, so the loader keeps reporting every problem in one pass.
    if (!fm.id) {
      fail(`surfaces/${f}: no id`);
      continue;
    }
    claimId("surfaces", fm.id, `surfaces/${f}`);
    surfaces.set(fm.id, { id: fm.id, title: fm.title, claimed_by: fm.claimed_by ?? [] });
  }

  const flows = []; // { id, slug, title, feature, actor, entry, steps: [{n, surface, text}], outcome }
  for (const f of listFiles(flowsDir)) {
    const file = `flows/${f}`;
    const text = readFileSync(join(flowsDir, f), "utf8");
    const fm = parseFrontmatter(text, file);
    // Same guard as the other two tables: nothing downstream — claimId, the flow list, the doc
    // renderer — has a sensible answer for a row with no id.
    if (!fm.id) {
      fail(`${file}: no id`);
      continue;
    }
    const body = bodyOf(text);

    // The filename convention is about the file, not about which shard it sits in: `f` may now be
    // `2026/FL-1--x.md`, and matching the whole relative path would report every sharded flow as
    // misnamed. `basename` keeps the rule the rule.
    const filenameMatch = /^([A-Za-z0-9-]+)--([a-z0-9-]+)\.md$/.exec(basename(f));
    if (!filenameMatch) {
      fail(`${file}: filename doesn't match <id>--<slug>.md`);
    } else {
      const [, fileId, fileSlug] = filenameMatch;
      if (fm.id !== fileId) fail(`${file}: frontmatter id "${fm.id}" != filename id "${fileId}"`);
      if (fm.slug !== fileSlug) fail(`${file}: frontmatter slug "${fm.slug}" != filename slug "${fileSlug}"`);
    }

    if (!fm.feature || !features.has(fm.feature)) {
      fail(`${file}: feature "${fm.feature}" does not resolve to a row in data/features/`);
    }
    if (!ALLOWED_ACTORS.includes(fm.actor)) {
      fail(`${file}: actor "${fm.actor}" is not one of ${ALLOWED_ACTORS.join(", ")}`);
    }
    if (!ALLOWED_ENTRY.includes(fm.entry)) {
      fail(`${file}: entry "${fm.entry}" is not one of ${ALLOWED_ENTRY.join(", ")}`);
    }

    const stepsRaw = section(body, "Steps");
    const steps = [];
    if (!stepsRaw) {
      fail(`${file}: no "## Steps" section`);
    } else {
      const lines = stepsRaw.split(/\r?\n/).filter((l) => l.trim() !== "");
      lines.forEach((line, i) => {
        const m = STEP_RE.exec(line.trim());
        if (!m) {
          fail(`${file}: step line doesn't match "N. \`surface-id\` — text": ${JSON.stringify(line)}`);
          return;
        }
        const [, nStr, surface, stepText] = m;
        const n = Number(nStr);
        if (n !== i + 1) fail(`${file}: step ${n} out of order (expected ${i + 1})`);
        if (!surfaces.has(surface)) {
          fail(`${file}: step ${n} names surface "${surface}", which does not exist in data/surfaces/`);
        }
        steps.push({ n, surface, text: stepText.trim() });
      });
      if (steps.length === 0) fail(`${file}: "## Steps" has no valid step lines`);
    }

    const outcomeRaw = section(body, "Outcome");
    if (!outcomeRaw) fail(`${file}: no "## Outcome" section`);
    const outcome = outcomeRaw ? outcomeRaw.replace(/\s*\r?\n\s*/g, " ").trim() : "";

    claimId("flows", fm.id, file);
    flows.push({
      id: fm.id,
      slug: fm.slug,
      title: fm.title,
      feature: fm.feature,
      actor: fm.actor,
      entry: fm.entry,
      steps,
      outcome,
    });
  }
  flows.sort((a, b) => a.id.localeCompare(b.id));

  const featuresSorted = [...features.values()].sort((a, b) => a.id.localeCompare(b.id));
  const surfacesSorted = [...surfaces.values()].sort((a, b) => a.id.localeCompare(b.id));

  return { features, featuresSorted, surfaces, surfacesSorted, flows, errors };
}

/**
 * The "authored" half of the map's score: how much of the featureset has an owned surface, and
 * how much of the featureset has a walked flow. Pure join arithmetic over already-loaded tables —
 * no disk access — so a caller can run this on the exact same `loadMapTables()` result it also
 * hands to a doc render, guaranteeing one number instead of two.
 */
export function computeAuthoredCoverage({ featuresSorted, surfacesSorted, flows }) {
  const claimedSurfaces = surfacesSorted.filter((s) => s.claimed_by.length > 0);
  const unclaimedSurfaces = surfacesSorted.filter((s) => s.claimed_by.length === 0);
  const featuresWithFlows = new Set(flows.map((f) => f.feature));
  const flowsByFeature = new Map();
  for (const fl of flows) {
    if (!flowsByFeature.has(fl.feature)) flowsByFeature.set(fl.feature, []);
    flowsByFeature.get(fl.feature).push(fl.id);
  }
  const surfacesByFeature = new Map();
  for (const s of surfacesSorted) {
    for (const fid of s.claimed_by) {
      if (!surfacesByFeature.has(fid)) surfacesByFeature.set(fid, []);
      surfacesByFeature.get(fid).push(s.id);
    }
  }
  return {
    claimedSurfaces,
    unclaimedSurfaces,
    featuresWithFlows,
    flowsByFeature,
    surfacesByFeature,
    surfacesTotal: surfacesSorted.length,
    featuresTotal: featuresSorted.length,
    flowsTotal: flows.length,
  };
}

// ── render docs/USER-FLOWS.md ───────────────────────────────────────────────

/**
 * Renders `docs/USER-FLOWS.md` from an error-free `loadMapTables()` result. Pure: takes the tables,
 * returns a string, touches no disk. The caller (`scripts/map.mjs`'s `flows` command) decides
 * whether to write it; `check` calls this and compares against what is already committed instead
 * of writing, so editing a flow's title without touching its references still shows up as drift.
 */
export function renderUserFlowsDoc({ features, featuresSorted, surfaces, surfacesSorted, flows }) {
  const { claimedSurfaces, unclaimedSurfaces, featuresWithFlows, flowsByFeature, surfacesByFeature } =
    computeAuthoredCoverage({ featuresSorted, surfacesSorted, flows });

  const lines = [];
  const p = (s = "") => lines.push(s);

  p("# User Flows");
  p();
  p(
    "<!-- GENERATED by `map flows` — do not hand-edit. Edit " +
      "`data/flows/*.md`, `data/features/*.md`, or `data/surfaces/*.md` and regenerate. -->",
  );
  p();
  p(
    "Every flow below is an ordered walk through surfaces that exist in `data/surfaces/`, reaching " +
      "an outcome for an actor. Each step is authored by a person and verified by a machine: a step " +
      "naming a screen that doesn't exist fails `map check`, which is also what produced this file. " +
      "See `data/flows/README.md` for the row grammar.",
  );
  p();
  p(
    `Only flows for **shipped** features are authored yet (${flows.length} of ${featuresSorted.filter((f) => f.status === "shipped").length} shipped features). ` +
      "A feature with no flow row below either has no ordered multi-surface job worth authoring " +
      "yet, or hasn't shipped — see the table in the next section for which.",
  );
  p();
  p("## Flows");
  p();
  for (const fl of flows) {
    const feature = features.get(fl.feature);
    p(`### ${fl.id} — ${fl.title}`);
    p();
    p(`**Feature:** ${feature.id} — ${feature.title} (${feature.status}) · **Actor:** ${fl.actor} · **Entry:** ${fl.entry}`);
    p();
    for (const step of fl.steps) {
      const surface = surfaces.get(step.surface);
      p(`${step.n}. \`${step.surface}\` (${surface.title}) — ${step.text}`);
    }
    p();
    p(`**Outcome:** ${fl.outcome}`);
    p();
  }

  p("## Features and their surfaces");
  p();
  p("All features, generated from `data/features/` joined against `data/surfaces/`'s `claimed_by`.");
  p();
  p("| id | title | status | surfaces | flows |");
  p("| --- | --- | --- | --- | --- |");
  for (const f of featuresSorted) {
    const surfaceIds = (surfacesByFeature.get(f.id) ?? []).map((id) => `\`${id}\``).join(", ") || "—";
    const flowIds = (flowsByFeature.get(f.id) ?? []).join(", ") || "—";
    p(`| ${f.id} | ${f.title} | ${f.status} | ${surfaceIds} | ${flowIds} |`);
  }
  p();

  p("## Surfaces with no feature");
  p();
  p(
    "Generated from `data/surfaces/` rows whose `claimed_by` is empty — a screen no feature row " +
      "claims yet. Not every row here is a gap; some are chrome (a redirect, a 404) that no job is " +
      "meant to own.",
  );
  p();
  if (unclaimedSurfaces.length === 0) {
    p("None — every surface is claimed.");
  } else {
    for (const s of unclaimedSurfaces) p(`- \`${s.id}\` — ${s.title}`);
  }
  p();

  p("## Coverage");
  p();
  p(`- Surfaces claimed by a feature: ${claimedSurfaces.length} / ${surfacesSorted.length}`);
  p(`- Features with at least one authored flow: ${featuresWithFlows.size} / ${featuresSorted.length}`);
  p(`- Flows authored: ${flows.length}`);
  p();

  p("## How this gets verified");
  p();
  p(
    "A flow row is a claim, not a screenshot. An end-to-end test suite is where a claim like this " +
      "gets walked for real; a flow tagged to a specific test is future work, not done here.",
  );
  p();

  return lines.join("\n");
}
