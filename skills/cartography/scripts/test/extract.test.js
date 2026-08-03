/**
 * Extractor tests, against fixture repos built in a temp dir.
 *
 * Every case here is a defect that shipped. An adversarial review reproduced each one against
 * real committed output — a lost `role: admin`, a missing verb, a screen deleted by a name
 * collision, a table emptied by a router refactor. The tool had no tests at all when it wrote a
 * map of 41 screens, six of which were wrong.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

import { readFrontmatter, yamlList, yamlScalar } from "../lib/frontmatter.js";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cartography.mjs");
const roots = [];

after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A fixture repo: an App.tsx plus any page files it names. */
function repo(appBody, pages = {}) {
  const root = mkdtempSync(join(tmpdir(), "carto-"));
  roots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/App.tsx"), `<Routes>\n${appBody}\n</Routes>\n`);
  for (const [name, body] of Object.entries(pages)) {
    mkdirSync(join(root, "src/pages"), { recursive: true });
    writeFileSync(join(root, `src/pages/${name}.tsx`), body);
  }
  return root;
}

const run = (root, cmd = "sync") => {
  try {
    return { out: execFileSync("node", [CLI, cmd, "--root", root], { encoding: "utf8" }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status };
  }
};
const rows = (root) => {
  const dir = join(root, "data/surfaces");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md")
      .map((f) => [f.replace(/\.md$/, ""), readFrontmatter(readFileSync(join(dir, f), "utf8"))]),
  );
};

describe("frontmatter", () => {
  test("reads a block-style list, not just flow style", () => {
    // The bug: only `owns: [a, b]` parsed. A block list silently became empty, so the feature
    // claimed nothing AND was exempt from the dead-feature check — invisible on both sides.
    const flow = readFrontmatter("---\nid: F-1\nowns: [a.ts, b.ts]\n---\n");
    const block = readFrontmatter("---\nid: F-1\nowns:\n  - a.ts\n  - b.ts\n---\n");
    assert.deepEqual(flow.owns, ["a.ts", "b.ts"]);
    assert.deepEqual(block.owns, ["a.ts", "b.ts"]);
  });

  test("distinguishes an absent key from an empty list", () => {
    assert.equal("owns" in readFrontmatter("---\nid: F-1\n---\n"), false);
    assert.deepEqual(readFrontmatter("---\nid: F-1\nowns: []\n---\n").owns, []);
  });

  test("strips a trailing comment rather than keeping it in the value", () => {
    assert.equal(readFrontmatter("---\ntitle: Rocks # the quarterly ones\n---\n").title, "Rocks");
  });

  test("quotes scalars that would otherwise break the document or truncate", () => {
    // Unquoted, `Metrics: Company` is a nested mapping (throws) and `Rocks # x` truncates.
    for (const v of ["Metrics: Company", "Rocks # note", "@mentions", "c=worksheets/:id", 'a "q" b']) {
      const parsed = readFrontmatter(`---\ntitle: ${yamlScalar(v)}\n---\n`);
      assert.equal(parsed.title, v, `round-trip failed for ${JSON.stringify(v)}`);
    }
  });

  test("splits a list on commas between items, not commas inside one", () => {
    // A brace glob is the realistic case: `owns: ["src/pages/{A,B}.tsx"]` is one claim, not two.
    const v = ["src/pages/{Alpha,Beta}.tsx", "src/lib/x.ts"];
    assert.deepEqual(readFrontmatter(`---\nowns: ${yamlList(v)}\n---\n`).owns, v);
  });

  test("keeps a comment out of the value on both list styles", () => {
    assert.deepEqual(readFrontmatter("---\nowns: [a, b] # why\n---\n").owns, ["a", "b"]);
    assert.deepEqual(readFrontmatter("---\nowns:\n  - a # why\n---\n").owns, ["a"]);
  });
});

describe("extraction", () => {
  test("keeps every path a component mounts at, not just the last", () => {
    // `/profile` was overwritten by `/profile/:id`, losing the canonical route.
    const root = repo(
      `<Route path="profile" element={<Profile />} />\n<Route path="profile/:id" element={<Profile />} />`,
      { Profile: "export default function Profile(){}" },
    );
    run(root);
    assert.deepEqual(rows(root).profile.routes, ["personal=profile", "personal=profile/:id"]);
  });

  test("reads every specifier in an import, not only the first", () => {
    // `import { CreateHabitForm, LogHabitForm }` yielded only the first, dropping a real verb.
    const root = repo(`<Route path="h" element={<Habits />} />`, {
      Habits: `import { CreateHabitForm, LogHabitForm } from "@/components/forms/HabitForms";`,
    });
    run(root);
    assert.deepEqual(rows(root).habits.affordances, ["CreateHabitForm", "LogHabitForm"]);
  });

  test("takes the guarded component, not the guard", () => {
    const root = repo(`<Route path="admin" element={<AdminGuard><AdminHome /></AdminGuard>} />`, {
      AdminHome: "export default function AdminHome(){}",
    });
    run(root);
    assert.ok(rows(root)["admin-home"], "expected the inner component to become the row");
  });

  test("finds a route written across several lines", () => {
    // `/auth` — the app's own front door — was absent from a 41-screen map because of a newline.
    const root = repo(
      `<Route\n  path="/auth"\n  element={\n    <AuthGuard>\n      <Auth />\n    </AuthGuard>\n  }\n/>`,
      { Auth: "" },
    );
    run(root);
    assert.deepEqual(rows(root).auth?.routes, ["personal=auth"]);
  });

  test("ignores a commented-out route", () => {
    const root = repo(`{/* <Route path="old" element={<Retired />} /> */}\n<Route index element={<Home />} />`, {
      Home: "",
      Retired: "",
    });
    run(root);
    assert.deepEqual(Object.keys(rows(root)), ["home"]);
    assert.deepEqual(rows(root).home.routes, ["personal=(index)"]);
  });

  test("scopes a screen by the resolver it nests in, not by where it sits in the file", () => {
    // The app-wide 404 is written last, after every scope block. Slicing the file positionally
    // filed it as a product screen — stated confidently, and wrong.
    const root = repo(
      `<Route path="pd/:productId" element={<ProductScopeResolver />}>\n` +
        `  <Route path="specs" element={<Specs />} />\n` +
        `</Route>\n` +
        `<Route path="*" element={<NotFound />} />`,
      { Specs: "", NotFound: "" },
    );
    run(root);
    assert.deepEqual(rows(root).specs.scopes, ["product"]);
    assert.deepEqual(rows(root)["not-found"].scopes, ["personal"]);
  });

  test("reads nav facts per scope, so a coach-only screen is not recorded as open", () => {
    // One flat map keyed by suffix kept whichever scope the registry listed last. /engagements is
    // gated to coaches in personal scope and open in client scope; the row said open.
    const nav = `
      const NAV = [
        { id: "engagements", suffix: "engagements", title: "Engagements", group: "practice", scopes: ["personal"], role: "coach" },
        { id: "projects", suffix: "projects", suffixByScope: { personal: "p" }, title: "Projects", group: "execution", scopes: ["personal", "client"] },
      ];
      const CLIENT_NAV = [
        { id: "c-engagements", suffix: "engagements", title: "Engagements", group: "tracking", scopes: ["client"] },
      ];`;
    const root = repo(
      `<Route path="engagements" element={<Engagements />} />\n` +
        `<Route path="p" element={<Projects />} />\n` +
        `<Route path="c/:clientId" element={<ClientScopeResolver />}>\n` +
        `  <Route path="engagements" element={<Engagements />} />\n` +
        `</Route>`,
      { Engagements: "", Projects: "" },
    );
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/nav-registry.ts"), nav);
    run(root);
    assert.deepEqual(rows(root).engagements.role, ["personal=coach"], "the gate was dropped");
    assert.deepEqual(rows(root).engagements.group, ["client=tracking", "personal=practice"]);
    // suffixByScope means this entry answers to "p" in personal scope, not "projects".
    assert.deepEqual(rows(root).projects.group, ["personal=execution"]);
  });

  test("ignores routes inside line comments, block comments, and strings", () => {
    const root = repo(
      `{/* <Route path="jsx" element={<JsxGone />} /> */}\n` +
        `/* <Route path="block" element={<BlockGone />} /> */\n` +
        `// <Route path="line" element={<LineGone />} />\n` +
        `<Route path="a" element={<Alpha />} />`,
      { Alpha: "", JsxGone: "", BlockGone: "", LineGone: "" },
    );
    run(root);
    assert.deepEqual(Object.keys(rows(root)), ["alpha"]);
  });

  test("is not desynced by a brace inside an attribute string", () => {
    // The brace counter dropped this route and, on a resolver, refiled its children — exit 0 both.
    const root = repo(
      `<Route path="t/:teamId" element={<TeamScopeResolver label="a{b" />}>\n` +
        `  <Route path="rocks" element={<Rocks />} />\n` +
        `</Route>\n` +
        `<Route path="x" element={<Xx title="y{z" />} />`,
      { Rocks: "", Xx: "" },
    );
    run(root);
    assert.deepEqual(rows(root).rocks.scopes, ["team"], "children fell out of their scope");
    assert.ok(rows(root).xx, "a route with a braced string in an attribute went missing");
  });

  test("finds a routed component in a nested directory", () => {
    const root = repo(`<Route path="b" element={<Billing />} />`);
    mkdirSync(join(root, "src/components/settings"), { recursive: true });
    writeFileSync(
      join(root, "src/components/settings/Billing.tsx"),
      `import { CreatePlanForm } from "@/components/forms/PlanForms";`,
    );
    run(root);
    assert.equal(rows(root).billing.file, "src/components/settings/Billing.tsx");
    assert.deepEqual(rows(root).billing.affordances, ["CreatePlanForm"]);
  });

  test("counts only the app's own components as verbs, not design-system primitives", () => {
    const root = repo(`<Route path="j" element={<Journal />} />`, {
      Journal:
        `import { Dialog, AlertDialog } from "@marktiderman/genesis-ui";\n` +
        `import { CreateEntryForm } from "@/components/forms/EntryForm";`,
    });
    run(root);
    assert.deepEqual(rows(root).journal.affordances, ["CreateEntryForm"]);
  });

  test("does not file chrome as a screen", () => {
    // The root route's element is the layout shell. It holds a path but is not somewhere you go.
    const root = repo(
      `<Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>\n<Route path="x" element={<Xx />} />\n</Route>`,
      { Xx: "" },
    );
    run(root);
    assert.deepEqual(Object.keys(rows(root)), ["xx"]);
  });
});

describe("destructive operations", () => {
  test("refuses to empty a populated table when extraction finds nothing", () => {
    // A router refactor to createBrowserRouter previously deleted all 41 rows and exited 0.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    assert.equal(Object.keys(rows(root)).length, 1);

    writeFileSync(join(root, "src/App.tsx"), "const router = createBrowserRouter([]);\n");
    const second = run(root);
    assert.equal(second.code, 1);
    assert.match(second.out, /refusing to empty the table/);
    assert.equal(Object.keys(rows(root)).length, 1, "rows must survive a failed extraction");
  });

  test("preserves the table's own README and template, and does not report them as gone", () => {
    // Two definitions of "row" disagreed: writeSurfaces preserved these files, diff counted them.
    // So every run reported them `- gone`, check exited 1 forever, and `sync` — the fix the
    // failure prints — could not clear it. Documenting the table was enough to break the gate.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    const dir = join(root, "data/surfaces");
    writeFileSync(join(dir, "README.md"), "what a row means\n");
    writeFileSync(join(dir, "_template.md"), "---\nid: X\n---\n");
    run(root);
    assert.ok(existsSync(join(dir, "README.md")), "README.md was deleted");
    assert.ok(existsSync(join(dir, "_template.md")), "_template.md was deleted");

    const check = run(root, "check");
    assert.doesNotMatch(check.out, /gone/, "a preserved non-row must not read as a deleted screen");
    assert.equal(check.code, 0, "the gate must be clearable");
  });

  test("fails on a duplicate id instead of overwriting a row", () => {
    // `Messages` and `MessagesPage` both derive the id `messages`; one silently replaced the
    // other, and the drift map — keyed by the same id — could not see the loss.
    const root = repo(
      `<Route path="m" element={<Messages />} />\n<Route path="m2" element={<MessagesPage />} />`,
      { Messages: "", MessagesPage: "" },
    );
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /duplicate surface id "messages"/);
  });
});

describe("the owns join", () => {
  const withFeature = (frontmatter) => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    mkdirSync(join(root, "data/features"), { recursive: true });
    writeFileSync(join(root, "data/features/F-1--x.md"), `---\nid: F-1\n${frontmatter}\n---\n\n## The job\n\nx\n`);
    return root;
  };

  test("claims a surface via a block-style owns list", () => {
    const root = withFeature("owns:\n  - src/pages/Alpha.tsx");
    run(root);
    const r = run(root, "check");
    assert.doesNotMatch(r.out, /claimed by no feature/);
    assert.deepEqual(rows(root).alpha.claimed_by, ["F-1"]);
    assert.equal(r.code, 0);
  });

  test("passes check while screens still await a job, and fails once the map is stale", () => {
    // Coverage on an existing codebase starts near total. A gate that cannot be turned green on
    // the day it is installed gets deleted, so only stale facts fail.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    const clean = run(root, "check");
    assert.match(clean.out, /claimed by no feature/);
    assert.equal(clean.code, 0, "unclaimed screens must not fail the gate");

    writeFileSync(join(root, "src/App.tsx"), `<Routes>\n<Route path="b" element={<Beta />} />\n</Routes>\n`);
    const stale = run(root, "check");
    assert.equal(stale.code, 1, "a map that no longer matches the code must fail");
  });

  test("expands a brace glob instead of matching it literally", () => {
    // The frontmatter test calls this "the realistic case" and only checks the splitter. The glob
    // matched nothing, so copying that example produced a red gate no sync could clear.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    mkdirSync(join(root, "data/features"), { recursive: true });
    writeFileSync(
      join(root, "data/features/F-1--x.md"),
      `---\nid: F-1\nowns: ["src/pages/{Alpha,Beta}.tsx"]\n---\n\n## The job\n\nx\n`,
    );
    run(root);
    assert.deepEqual(rows(root).alpha.claimed_by, ["F-1"]);
    assert.equal(run(root, "check").code, 0);
  });

  test("reads a block owns: list that starts after a comment or a blank line", () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    mkdirSync(join(root, "data/features"), { recursive: true });
    writeFileSync(
      join(root, "data/features/F-1--x.md"),
      `---\nid: F-1\nowns:\n  # the alpha surface\n\n  - src/pages/Alpha.tsx\n---\n\n## The job\n\nx\n`,
    );
    run(root);
    assert.deepEqual(rows(root).alpha.claimed_by, ["F-1"], "the claim was silently dropped");
  });

  test("does not report a feature owning code this extractor cannot see", () => {
    // `owns: [supabase/functions/**]` is a real claim about real code. Reporting it as dead is a
    // permanent false positive no action can clear.
    const r = run(withFeature('owns: ["supabase/functions/**"]'), "check");
    assert.doesNotMatch(r.out, /owns nothing/);
    // Asserting the absence of a string also passes when the tool crashes, so pin the exit code
    // and one positive fact: this test used to survive `throw` at the top of report().
    assert.equal(r.code, 0);
    assert.match(r.out, /surface\(s\) extracted/);
  });

  test("still reports a feature whose globs point into extracted territory and match nothing", () => {
    const r = run(withFeature('owns: ["src/pages/Deleted.tsx"]'), "check");
    assert.match(r.out, /owns nothing/);
    assert.equal(r.code, 1, "a feature pointing at deleted code must fail the gate");
  });
});
