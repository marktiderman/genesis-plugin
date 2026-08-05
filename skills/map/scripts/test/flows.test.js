/**
 * Tests for `lib/flows.mjs` (data/flows/ verification and doc rendering) and the `map flows`
 * command plus `map check`'s folded-in flows verification.
 *
 * Two layers, matching how the module itself splits: `lib/flows.mjs`'s pure functions
 * (`loadMapTables`, `renderUserFlowsDoc`, `computeAuthoredCoverage`) are exercised directly, and
 * the CLI (`map.mjs flows` / `map.mjs check`) is exercised end to end the same way
 * `extract.test.js` exercises `sync`/`check` — through a fixture repo in a temp dir.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

import { computeAuthoredCoverage, loadMapTables, renderUserFlowsDoc } from "../lib/flows.mjs";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "map.mjs");
const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function bare() {
  const root = mkdtempSync(join(tmpdir(), "map-flows-"));
  roots.push(root);
  return root;
}

const put = (root, rel, text) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text, "utf8");
};

/**
 * A repo with one routed screen (Alpha), synced into a real `data/surfaces/alpha.md` row whose
 * `claimed_by` already names `data/features/F-1--x.md` (via its `owns:` glob). Flow fixtures layer
 * on top of this so the fixture matches what `check` expects to find already true before it gets
 * to flows: a surfaces table that agrees with the code, so a flows-specific assertion is not
 * muddied by ordinary drift.
 */
function repoWithFeature() {
  const root = bare();
  mkdirSync(join(root, "src/pages"), { recursive: true });
  writeFileSync(join(root, "src/App.tsx"), `<Routes>\n<Route path="a" element={<Alpha />} />\n</Routes>\n`);
  writeFileSync(join(root, "src/pages/Alpha.tsx"), "export default function Alpha(){}\n");
  put(
    root,
    "data/features/F-1--x.md",
    `---\nid: F-1\nslug: x\ntitle: Do the thing\nstatus: shipped\nowns: ["src/pages/Alpha.tsx"]\n---\n\n## The job\n\nx\n`,
  );
  // Assert the setup worked. A sync that fails here used to surface as a puzzling assertion
  // failure in whichever test used the fixture, rather than as the sync error it actually was.
  const synced = run(root, "sync");
  assert.equal(synced.code, 0, `fixture sync failed: ${synced.stderr || synced.stdout}`);
  return root;
}

const run = (root, cmd) => {
  try {
    return { out: execFileSync("node", [CLI, cmd, "--root", root], { encoding: "utf8" }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status };
  }
};

const FLOW = (over = {}) => {
  const f = {
    id: "FL-001",
    slug: "do-it",
    feature: "F-1",
    actor: "solo",
    entry: "nav",
    steps: "1. `alpha` — do the thing",
    outcome: "The thing is done.",
    ...over,
  };
  return (
    `---\nid: ${f.id}\nslug: ${f.slug}\ntitle: Do it\nfeature: ${f.feature}\nactor: ${f.actor}\n` +
    `entry: ${f.entry}\n---\n\n## Steps\n\n${f.steps}\n\n## Outcome\n\n${f.outcome}\n`
  );
};

describe("loadMapTables", () => {
  test("resolves a step to its surface and a flow to its feature", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW());
    const { errors, flows, features, surfaces } = loadMapTables(root);
    assert.deepEqual(errors, []);
    assert.equal(flows.length, 1);
    assert.equal(flows[0].steps[0].surface, "alpha");
    assert.ok(features.has("F-1"));
    assert.ok(surfaces.has("alpha"));
  });

  test("fails when a step names a surface that does not exist", () => {
    const root = repoWithFeature();
    put(
      root,
      "data/flows/FL-001--do-it.md",
      FLOW({ steps: "1. `ghost-screen` — do the thing" }),
    );
    const { errors } = loadMapTables(root);
    assert.match(errors.join("\n"), /step 1 names surface "ghost-screen", which does not exist/);
  });

  test("fails when a flow's feature does not resolve", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW({ feature: "F-999" }));
    const { errors } = loadMapTables(root);
    assert.match(errors.join("\n"), /feature "F-999" does not resolve to a row in data\/features\//);
  });

  test("fails on an actor or entry outside the allowed lists", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW({ actor: "wizard" }));
    assert.match(loadMapTables(root).errors.join("\n"), /actor "wizard" is not one of/);

    // Both halves of the name, or the second enum could stop being checked and nothing would say so.
    const root2 = repoWithFeature();
    put(root2, "data/flows/FL-001--do-it.md", FLOW({ entry: "telepathy" }));
    assert.match(loadMapTables(root2).errors.join("\n"), /entry "telepathy" is not one of/);
  });

  test("fails on a duplicate flow id", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW());
    put(root, "data/flows/FL-001--do-it-2.md", FLOW({ slug: "do-it-2" }));
    const { errors } = loadMapTables(root);
    assert.match(errors.join("\n"), /id "FL-001" is already used by/);
  });

  test("an absent data/flows/ directory loads as zero flows, not an error", () => {
    const root = repoWithFeature();
    const { errors, flows } = loadMapTables(root);
    assert.deepEqual(errors, []);
    assert.deepEqual(flows, []);
  });

  test("an absent data/features/ or data/surfaces/ directory loads as zero rows, not a crash", () => {
    const root = bare();
    const { errors, features, surfaces, flows } = loadMapTables(root);
    assert.deepEqual(errors, []);
    assert.equal(features.size, 0);
    assert.equal(surfaces.size, 0);
    assert.deepEqual(flows, []);
  });

  test("a table documented in `ReadMe.md` is documentation here too, not a row", () => {
    // This reader's row rule was `f !== "README.md"` — case-SENSITIVE — while gitdata's loader and
    // the rest of this tool exclude `readme.md` in any casing. So `ReadMe.md` was a row to this
    // half alone, the frontmatter reader threw `no frontmatter block` on it, and `map check` exited
    // 1 with nothing `sync` could do about it. Documenting a table broke the gate, again.
    const root = repoWithFeature();
    put(root, "data/features/ReadMe.md", "What a feature row means. Documentation, not a row.\n");
    put(root, "data/surfaces/ReadMe.md", "What a surface row means. Documentation, not a row.\n");
    const { errors, features } = loadMapTables(root);
    assert.deepEqual(errors, [], "a documented table must not be an error");
    assert.equal(features.size, 1, "the README was counted as a feature row");
    assert.equal(run(root, "check").code, 0, "the gate must be clearable");
  });

  test("a sharded table's rows are loaded and verified, not silently skipped", () => {
    // One flat read meant a row in a shard was not seen at all — and unseen is not neutral here.
    // A flow in a shard was never checked, so a step naming a deleted surface passed; a surface in
    // a shard was not in the table, so a step naming it failed as nonexistent. Both directions
    // wrong, both silent, from the same missing recursion.
    const root = repoWithFeature();
    put(root, "data/flows/2026/01/FL-001--do-it.md", FLOW());
    const { errors, flows } = loadMapTables(root);
    assert.deepEqual(errors, [], "a sharded flow must resolve like a flat one");
    assert.equal(flows.length, 1, "the sharded flow was not loaded");
    assert.equal(flows[0].steps[0].surface, "alpha");
  });

  test("a sharded flow with a broken reference still fails — the shard is not a hiding place", () => {
    const root = repoWithFeature();
    put(root, "data/flows/2026/01/FL-001--do-it.md", FLOW({ steps: "1. `ghost-screen` — do it" }));
    const { errors } = loadMapTables(root);
    assert.match(errors.join("\n"), /step 1 names surface "ghost-screen", which does not exist/);
    // The path locates the row inside the table, so the error says which shard to open.
    assert.match(errors.join("\n"), /flows\/2026\/01\/FL-001--do-it\.md/);
  });
});

describe("computeAuthoredCoverage", () => {
  test("counts a surface as claimed once any feature's owns: reaches it", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW());
    const tables = loadMapTables(root);
    const coverage = computeAuthoredCoverage(tables);
    assert.equal(coverage.claimedSurfaces.length, 1);
    assert.equal(coverage.featuresWithFlows.size, 1);
    assert.deepEqual(coverage.flowsByFeature.get("F-1"), ["FL-001"]);
  });
});

describe("renderUserFlowsDoc", () => {
  test("renders a flow's steps against surface titles, and is deterministic", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW());
    const tables = loadMapTables(root);
    const once = renderUserFlowsDoc(tables);
    const twice = renderUserFlowsDoc(tables);
    assert.equal(once, twice, "rendering twice from the same tables must be byte-identical");
    assert.match(once, /### FL-001 — Do it/);
    assert.match(once, /1\. `alpha` \(Alpha\) — do the thing/);
    assert.match(once, /Surfaces claimed by a feature: 1 \/ 1/);
  });

  test("lists a surface with no claiming feature under its own section", () => {
    const root = bare();
    mkdirSync(join(root, "src/pages"), { recursive: true });
    writeFileSync(join(root, "src/App.tsx"), `<Routes>\n<Route path="b" element={<Beta />} />\n</Routes>\n`);
    writeFileSync(join(root, "src/pages/Beta.tsx"), "export default function Beta(){}\n");
    run(root, "sync");
    const tables = loadMapTables(root);
    const doc = renderUserFlowsDoc(tables);
    assert.match(doc, /- `beta` — Beta/);
    assert.match(doc, /Surfaces claimed by a feature: 0 \/ 1/);
  });
});

describe("map flows (CLI)", () => {
  test("writes docs/USER-FLOWS.md from the rows", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW());
    const r = run(root, "flows");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /wrote docs\/USER-FLOWS\.md/);
    const doc = readFileSync(join(root, "docs/USER-FLOWS.md"), "utf8");
    assert.match(doc, /GENERATED by `map flows`/);
    assert.match(doc, /### FL-001 — Do it/);
  });

  test("fails without writing when a step doesn't resolve", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW({ steps: "1. `ghost` — nope" }));
    const r = run(root, "flows");
    assert.equal(r.code, 1);
    assert.equal(existsSync(join(root, "docs/USER-FLOWS.md")), false);
  });
});

describe("map check folds in flows", () => {
  test("passes when data/flows/ is absent — nothing to check there", () => {
    const root = repoWithFeature();
    const r = run(root, "check");
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /flows:/);
  });

  test("fails when a flow step names a surface that does not exist", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW({ steps: "1. `ghost` — nope" }));
    const r = run(root, "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /flows: 1 problem\(s\)/);
    assert.match(r.out, /names surface "ghost"/);
  });

  test("fails when docs/USER-FLOWS.md is stale relative to the rows", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW());
    assert.equal(run(root, "flows").code, 0);
    assert.equal(run(root, "check").code, 0, "freshly generated doc must pass");

    put(root, "data/flows/FL-001--do-it.md", FLOW({ outcome: "A different outcome entirely." }));
    const r = run(root, "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /docs\/USER-FLOWS\.md is stale — run `map flows` and commit/);
  });

  test("passes once the doc is regenerated to match", () => {
    const root = repoWithFeature();
    put(root, "data/flows/FL-001--do-it.md", FLOW());
    run(root, "flows");
    put(root, "data/flows/FL-001--do-it.md", FLOW({ outcome: "A different outcome entirely." }));
    assert.equal(run(root, "check").code, 1, "sanity: stale before regenerating");
    run(root, "flows");
    assert.equal(run(root, "check").code, 0, "check must be clearable by running flows and committing");
  });
});
