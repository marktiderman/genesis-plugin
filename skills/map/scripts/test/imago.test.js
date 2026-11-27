/**
 * `map imago --dry-run`: TanStack screens, the code map Imago loads, and a dry run that writes
 * nothing and never counts a map feature as changed.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

import { buildCodeMap, codeFeatures, planLoad, routeUrl, tanstackRoutes } from "../lib/imago.mjs";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "map.mjs");
const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function app(files) {
  const root = mkdtempSync(join(tmpdir(), "map-imago-"));
  roots.push(root);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}
const route = (id, extra = "") => `export const Route = createFileRoute("${id}")({ component: Page });${extra}\n`;

describe("routeUrl", () => {
  test("drops pathless segments, a break-out underscore and index", () => {
    assert.equal(routeUrl("/_owner/$product/features/$featureId/"), "/$product/features/$featureId");
    assert.equal(routeUrl("/_owner/$product/sessions_/$sessionId"), "/$product/sessions/$sessionId");
    assert.equal(routeUrl("/_owner/"), "/");
  });
});

describe("tanstackRoutes", () => {
  test("a screen per createFileRoute with a component; layouts and server routes are not screens", () => {
    const root = app({
      "src/routes/__root.tsx": "export const Route = createRootRoute({ component: Root });",
      "src/routes/_owner.tsx": route("/_owner", " <Outlet />"),
      "src/routes/_owner/map/index.tsx": route("/_owner/map/"),
      "src/routes/_owner/$product.tsx": route("/_owner/$product", " <Outlet />"),
      "src/routes/_owner/$product/today.tsx": route("/_owner/$product/today"),
      "src/routes/api/mcp.ts": 'export const Route = createFileRoute("/api/mcp")({ server: { handlers: {} } });',
    });
    assert.deepEqual(
      tanstackRoutes(root).map((s) => s.url),
      ["/$product/today", "/map"],
    );
  });
});

describe("tanstackRoutes, the review's cases", () => {
  test("a route group is not in the URL", () => {
    assert.equal(routeUrl("/(auth)/login"), "/login");
  });
  test("a commented-out route is not read over the live one", () => {
    const root = app({ "src/routes/new.tsx": '// createFileRoute("/old")({ component: Old })\n' + route("/new") });
    assert.deepEqual(tanstackRoutes(root).map((s) => s.url), ["/new"]);
  });
  test("a flat layout (posts.tsx + posts.index.tsx) is a layout; a leaf with an Outlet stays a screen", () => {
    const root = app({
      "src/routes/posts.tsx": route("/posts", " <Outlet />"),
      "src/routes/posts.index.tsx": route("/posts/"),
      "src/routes/about.tsx": route("/about", " <Outlet />"),
    });
    assert.deepEqual(tanstackRoutes(root).map((s) => s.file), ["src/routes/about.tsx", "src/routes/posts.index.tsx"]);
  });
});

describe("buildCodeMap and planLoad", () => {
  const root = app({
    "src/routes/_owner/map/index.tsx": route("/_owner/map/"),
    "src/routes/_owner/today.tsx": route("/_owner/today"),
    "features.json": JSON.stringify({
      features: [
        { id: "map", name: "Map", status: "beta", links: { code: ["src/routes/_owner/map/**"] }, acceptance: ["Shows the tree."] },
        { id: "new-thing", name: "New thing", status: "building", links: { code: [] } },
      ],
    }),
  });
  const next = buildCodeMap({
    meta: { commit: "abc" },
    screens: tanstackRoutes(root),
    features: codeFeatures(root),
    resources: [],
  });

  test("screens carry the features that claim their route file", () => {
    assert.deepEqual(next.screens.map((s) => [s.url, s.features]), [["/map", ["map"]], ["/today", []]]);
    assert.deepEqual(next.features.find((f) => f.id === "map").criteria, ["Shows the tree."]);
  });

  test("placed, unplaced and no-code are counted; map features are never changed", () => {
    const plan = planLoad(next, {
      mapFeatures: [
        { key: "map", level: "feature" },
        { key: "planned-only", level: "feature" },
        { key: "an-area", level: "area" },
      ],
      current: null,
    });
    assert.deepEqual(plan.placed.map((f) => f.id), ["map"]);
    assert.deepEqual(plan.unplaced.map((f) => f.id), ["new-thing"]);
    assert.deepEqual(plan.noCode.map((f) => f.key), ["planned-only"]);
    assert.equal(plan.untouched, 3);
    assert.deepEqual(plan.criteria, { added: 1, changed: 0, dropped: 0 });
  });

  test("criteria the loaded snapshot has and the new one doesn't are counted as dropped", () => {
    const current = { meta: { commit: "old" }, features: [{ id: "map", criteria: ["Shows the tree.", "Old promise."] }], screens: [] };
    assert.deepEqual(planLoad(next, { current }).criteria, { added: 0, changed: 0, dropped: 1 });
  });
});

describe("map imago (CLI)", () => {
  const files = {
    "src/routes/_owner/today.tsx": route("/_owner/today"),
  };
  test("refuses without --dry-run", () => {
    const root = app(files);
    assert.throws(() => execFileSync("node", [CLI, "imago", "--root", root], { stdio: "pipe" }));
  });
  test("--dry-run writes nothing to the checkout", () => {
    const root = app(files);
    const before = readdirSync(root, { recursive: true }).sort();
    const out = execFileSync("node", [CLI, "imago", "--dry-run", "--root", root, "--product", "acme"], { encoding: "utf8" });
    assert.match(out, /Nothing was written/);
    assert.match(out, /\| \/today \|/);
    assert.deepEqual(readdirSync(root, { recursive: true }).sort(), before);
  });
});
