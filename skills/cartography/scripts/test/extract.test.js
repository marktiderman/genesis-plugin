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

/** An empty checkout: no router, no data layer, nothing this tool reads. */
function bare() {
  const root = mkdtempSync(join(tmpdir(), "carto-"));
  roots.push(root);
  return root;
}

/** A fixture repo: an App.tsx plus any page files it names. */
function repo(appBody, pages = {}) {
  const root = bare();
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
const rows = (root, table = "surfaces") => {
  const dir = join(root, "data", table);
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md")
      .map((f) => [f.replace(/\.md$/, ""), readFrontmatter(readFileSync(join(dir, f), "utf8"))]),
  );
};
const LEDGER_PATH = "data/_views/blind-spots.md";
const ledgerOf = (root) => readFileSync(join(root, LEDGER_PATH), "utf8");

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

describe("resources", () => {
  /** A fixture with the five places a table can be named, each disagreeing with the others. */
  const dataRepo = () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    const put = (rel, text) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text, "utf8");
    };
    put("src/lib/content.ts", 'export const TABLES = {\n  PEOPLE: "People",\n  // REMOVED: GHOSTS: "Ghosts",\n}\n');
    put(
      "src/integrations/supabase/types.ts",
      `    Tables: {\n      journal_entries: {\n        Row: {}\n      }\n      projects: {\n        Row: {}\n      }\n    }\n    Views: {\n`,
    );
    put(
      "src/lib/resource-registry.ts",
      `const R = [defineResource({\n  name: TABLES.PEOPLE,\n  backing: "jsonb",\n` +
        `  fields: {\n    Name: "string",\n    Email: "string",\n  },\n  scope: "none",\n  debt: true,\n})];\n`,
    );
    put("src/hooks/use-journal.ts", 'supabase.from("journal_entries").select()');
    put("src/pages/Alpha.tsx", "import { TABLES } from '@/lib/airtable';\nconst t = TABLES.PEOPLE;");
    put(
      "supabase/migrations/0001_init.sql",
      `ALTER TABLE public.ghost_table ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY "Coaches manage fields on own templates" ON public.ghost_table\n  FOR SELECT USING (true);\n` +
        `-- CREATE POLICY "commented" ON public.never_real FOR SELECT USING (true);\n` +
        `ALTER TABLE public.retired ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY "p" ON public.retired\n  FOR ALL USING (\n    ${"x".repeat(300)}\n  );\n`,
    );
    put("supabase/migrations/0002_drop.sql", "DROP TABLE IF EXISTS public.retired;\n");
    put("supabase/functions/_shared/util.ts", 'await admin.from("ghost_table").select()');
    put("supabase/functions/send-sms/index.ts", 'await admin.from("ghost_table").insert({})');
    return root;
  };

  /** A repo whose only data layer is one migration file. */
  const migrationRepo = (sql) => {
    const root = bare();
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(join(root, "supabase/migrations/0001.sql"), sql, "utf8");
    return root;
  };

  test("reads the table from an ALTER TABLE that carries more than one action", () => {
    // `ALTER TABLE name action [, ...]` is ordinary Postgres, and the name was read as "whatever
    // precedes the first ENABLE". So this recorded a table called `integer` with RLS on and left
    // `ledger` — the real table — reported as having none: a security-posture record inverted on
    // both rows, at exit 0.
    const root = migrationRepo(
      "CREATE TABLE public.ledger (id uuid primary key);\n" +
        "ALTER TABLE public.ledger ADD COLUMN amount integer, ENABLE ROW LEVEL SECURITY;\n" +
        "ALTER TABLE public.acct FORCE ROW LEVEL SECURITY, ENABLE ROW LEVEL SECURITY;\n" +
        "ALTER TABLE public.owned OWNER TO postgres, ENABLE ROW LEVEL SECURITY;\n",
    );
    assert.equal(run(root).code, 0);
    const r = rows(root, "resources");
    assert.deepEqual(Object.keys(r).sort(), ["acct", "ledger", "owned"]);
    for (const id of ["acct", "ledger", "owned"]) assert.equal(r[id].rls_enabled, "true", id);
  });

  test("applies a multi-action DISABLE to the table it names, not to a column type", () => {
    // Worse than a phantom row: the DISABLE landed on a table called `text` and the real one kept
    // `rls_enabled: "true"` — overstating protection, which the replay's own comment calls the one
    // error this field must never make.
    const root = migrationRepo(
      "ALTER TABLE ledger ENABLE ROW LEVEL SECURITY;\n" +
        "ALTER TABLE ledger ADD COLUMN note text, DISABLE ROW LEVEL SECURITY;\n",
    );
    assert.equal(run(root).code, 0);
    const r = rows(root, "resources");
    assert.deepEqual(Object.keys(r), ["ledger"]);
    assert.equal(r.ledger.rls_enabled, "false", "a DISABLE applied to a phantom table protects nothing");
  });

  test("drops the policy a DROP POLICY ... CASCADE names", () => {
    // `DROP POLICY [IF EXISTS] name ON table [CASCADE|RESTRICT]` is valid Postgres. The trailing
    // keyword became the table name, so the delete was a silent no-op against `out["CASCADE"]` and
    // the map kept listing a write path that had been removed.
    const root = migrationRepo(
      'ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;\n' +
        'CREATE POLICY "read notes" ON public.notes FOR SELECT USING (true);\n' +
        'CREATE POLICY "write notes" ON public.notes FOR INSERT WITH CHECK (true);\n' +
        'DROP POLICY IF EXISTS "write notes" ON public.notes CASCADE;\n',
    );
    assert.equal(run(root).code, 0);
    assert.deepEqual(rows(root, "resources").notes.rls, ["select"]);
  });

  test("says a table is backed by a migration this repo writes, not by the function that reads it", () => {
    // The ladder consulted legacy constants, generated types and `.from()` hits, and never the
    // migrations — though the RLS replay had just read `create table` in the same statement list.
    // A monorepo with no `src/` reported 26 of its 28 tables as `edge-only` ("exists only because
    // a function names it") or `orphan` ("nothing defines or reaches it") while creating every one
    // of them, three of those rows carrying `rls_enabled: "true"` beside `backing: "orphan"`.
    const root = migrationRepo(
      "create table if not exists public.agent_notes (id uuid primary key);\n" +
        "alter table public.agent_notes enable row level security;\n",
    );
    assert.equal(run(root).code, 0);
    assert.equal(rows(root, "resources")["agent-notes"].backing, "migration");
  });

  test("a dropped policy and a disabled RLS are both replayed", () => {
    // The replay knew three statement kinds and ignored the rest, so a table whose policy was
    // removed or whose RLS was turned off still reported the protection it used to have —
    // overstating access, the one direction this field must never fail.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(
      join(root, "supabase/migrations/0001.sql"),
      `ALTER TABLE public.guarded ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY "readers" ON public.guarded FOR SELECT USING (true);\n` +
        `CREATE POLICY "writers" ON public.guarded FOR INSERT WITH CHECK (true);\n`,
    );
    writeFileSync(
      join(root, "supabase/migrations/0002.sql"),
      `DROP POLICY IF EXISTS "readers" ON public.guarded;\n` +
        `ALTER TABLE public.guarded DISABLE ROW LEVEL SECURITY;\n`,
    );
    run(root);
    const r = rows(root, "resources").guarded;
    assert.deepEqual(r.rls, ["insert"], "the dropped policy is still reported");
    assert.equal(r.rls_enabled, "false", "RLS reported on after it was disabled");
  });

  test("drops a table named with a quoted schema qualifier", () => {
    // `DROP TABLE "public"."retired"` captured `public` and left `retired` on the map.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(join(root, "supabase/migrations/0001.sql"), 'ALTER TABLE public.retired ENABLE ROW LEVEL SECURITY;\n');
    writeFileSync(join(root, "supabase/migrations/0002.sql"), 'DROP TABLE IF EXISTS "public"."retired";\n');
    run(root);
    const r = rows(root, "resources");
    assert.ok(!r.retired, "a quoted-qualified drop left the table on the map");
    assert.ok(!r.public, "captured the schema name as a table");
  });

  test("a table dropped below its own policies is still dropped", () => {
    // Three passes over one file applied every DROP before any CREATE POLICY was read, so a table
    // dropped after its policies came back to life — the same direction as the defect this whole
    // change exists to fix, reintroduced by the fix for it.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(
      join(root, "supabase/migrations/0001.sql"),
      `ALTER TABLE public.staging ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY "r" ON public.staging FOR SELECT USING (true);\n` +
        `DROP TABLE public.staging;\n`,
    );
    run(root);
    assert.ok(!rows(root, "resources").staging, "a dropped table came back to life");
  });

  test("the words DROP TABLE inside a string do not drop anything", () => {
    // A COMMENT ON TABLE mentioning a drop deleted two live tables from the map — valid SQL
    // containing no DROP statement at all, silently understating access.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(
      join(root, "supabase/migrations/0001.sql"),
      `ALTER TABLE public.legacy_a ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY "p" ON public.legacy_a FOR ALL USING (true);\n` +
        `COMMENT ON TABLE public.other IS 'supersedes DROP TABLE legacy_a, legacy_b';\n` +
        `DO $$ BEGIN RAISE NOTICE 'never DROP TABLE legacy_a'; END $$;\n`,
    );
    run(root);
    assert.deepEqual(rows(root, "resources")["legacy-a"].rls, ["all"]);
  });

  test("does not read a nested object's value as a table name", () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(
      join(root, "src/lib/content.ts"),
      'export const TABLES = {\n  PEOPLE: "People",\n  meta: { v: "1" },\n  WINS: "Wins",\n}\n',
    );
    run(root);
    const r = rows(root, "resources");
    assert.ok(!r["1"], "invented a table from a nested value");
    assert.ok(r.people && r.wins, "truncated the list at the nested object");
  });

  test("a table dropped and recreated keeps its RLS", () => {
    // Drop-then-create is the standard idempotency idiom. Retiring the name globally wiped RLS
    // off a live table — a regression in the one direction this must never fail.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(join(root, "supabase/migrations/0001.sql"), "ALTER TABLE public.recycled ENABLE ROW LEVEL SECURITY;\n");
    writeFileSync(
      join(root, "supabase/migrations/0002.sql"),
      `DROP TABLE IF EXISTS public.recycled;\nCREATE TABLE public.recycled ();\n` +
        `ALTER TABLE public.recycled ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY "p" ON public.recycled FOR UPDATE USING (true);\n`,
    );
    run(root);
    assert.deepEqual(rows(root, "resources").recycled.rls, ["update"]);
    assert.equal(rows(root, "resources").recycled.rls_enabled, "true");
  });

  test("drops every table named in one statement", () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(
      join(root, "supabase/migrations/0001.sql"),
      "ALTER TABLE public.aaa ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.bbb ENABLE ROW LEVEL SECURITY;\n",
    );
    writeFileSync(join(root, "supabase/migrations/0002.sql"), "DROP TABLE IF EXISTS public.aaa, public.bbb;\n");
    const r = rows((run(root), root), "resources");
    assert.ok(!r.aaa && !r.bbb, "a multi-table DROP retired only the first");
  });

  test("keeps a table reached only through a shared helper", () => {
    // Skipping `_shared/` deleted the only evidence for such a table, dropping the row entirely.
    // A rough consumer label beats a missing resource.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/functions/_shared"), { recursive: true });
    writeFileSync(join(root, "supabase/functions/_shared/audit.ts"), 'await admin.from("audit_log").insert({})');
    run(root);
    assert.ok(rows(root, "resources")["audit-log"], "a helper-only table vanished from the map");
  });

  test("does not name a computed key as a field", () => {
    // `[LEGACY_ACCOUNT_FIELD]: "relation"` names a constant, not a column. Emitting the identifier
    // put a field called LEGACY_ACCOUNT_FIELD on 14 rows; the real column is Account.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/content.ts"), 'export const TABLES = {\n  P: "P",\n}\n');
    writeFileSync(
      join(root, "src/lib/resource-registry.ts"),
      `const R = [defineResource({\n  name: TABLES.P,\n  backing: "jsonb",\n` +
        `  fields: {\n    "Check-in Date": "string",\n    [ACCOUNT]: "relation",\n  },\n})];\n`,
    );
    run(root);
    assert.deepEqual(rows(root, "resources").p.fields, ["Check-in Date"]);
  });

  test("picks the legacy file that defines TABLES, not merely one that exists", () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/content.ts"), "export const sanitize = (s) => s;\n");
    writeFileSync(join(root, "src/lib/airtable.ts"), 'export const TABLES = {\n  PEOPLE: "People",\n}\n');
    run(root);
    assert.ok(rows(root, "resources").people, "an unrelated namesake file cost all legacy tables");
  });

  test("a dropped table is not a resource", () => {
    // `companies` was dropped eight migrations back, survived as a row with full CRUD policies,
    // and was published as a headline finding. Migrations replay in order; a DROP retires it.
    const root = dataRepo();
    run(root);
    assert.ok(!rows(root, "resources").retired, "a dropped table is still on the map");
  });

  test("a commented-out policy does not invent a table", () => {
    const root = dataRepo();
    run(root);
    assert.ok(!rows(root, "resources")["never-real"], "invented a table from a SQL comment");
  });

  test("a commented-out legacy table is not a table", () => {
    const root = dataRepo();
    run(root);
    assert.ok(!rows(root, "resources").ghosts, "invented a table from a commented TABLES entry");
  });

  test("records a shared helper as a consumer rather than dropping the evidence", () => {
    // `_shared/` is an imprecise label — it is helper modules, not a function. Skipping it to fix
    // the label deleted the only evidence for tables reached solely through a helper, dropping
    // those rows from the map. A rough label beats a missing resource.
    const root = dataRepo();
    run(root);
    assert.ok(rows(root, "resources")["ghost-table"].used_by.includes("_shared"));
  });

  test("reads a policy longer than the old 200-character window", () => {
    // The parser gave up after 200 chars, so 9 tables read `rls: []` while holding live policies —
    // the field most likely to be read as a security fact, understating access.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(
      join(root, "supabase/migrations/0001.sql"),
      `ALTER TABLE public.wide ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY "p" ON public.wide\n  FOR UPDATE USING (\n    ${"y".repeat(300)}\n  );\n`,
    );
    run(root);
    assert.deepEqual(rows(root, "resources").wide.rls, ["update"]);
  });

  test("does not count the registry's own declaration as a read", () => {
    // `TABLES.PEOPLE` inside resource-registry.ts is a declaration. Counting it marked five
    // tables the app never touches as reached, contradicting their own `unused` note.
    const root = dataRepo();
    // Alpha.tsx is what actually reads TABLES.PEOPLE in this fixture; remove it and only the
    // registry mentions the table.
    writeFileSync(join(root, "src/pages/Alpha.tsx"), "export default function Alpha(){}");
    run(root);
    assert.equal(rows(root, "resources").people.reach, "none");
  });

  test("reconciles the sources into one row per resource", () => {
    const root = dataRepo();
    run(root);
    const r = rows(root, "resources");
    assert.deepEqual(Object.keys(r).sort(), ["ghost-table", "journal-entries", "people", "projects"]);
    assert.equal(r.people.backing, "jsonb");
    assert.equal(r.people.declared, "resource-registry.ts");
    assert.equal(r.people.debt, "true");
    assert.deepEqual(r.people.fields, ["Name", "Email"]);
    assert.equal(r.projects.backing, "supabase");
    assert.equal(r.projects.declared, "undeclared");
  });

  test("surfaces a table the app does not know exists", () => {
    // The finding this table is for: created with RLS, written by an edge function, absent from
    // the generated types and from every file in src/.
    const root = dataRepo();
    run(root);
    const ghost = rows(root, "resources")["ghost-table"];
    assert.equal(ghost.backing, "edge-only");
    assert.equal(ghost.rls_enabled, "true");
    assert.deepEqual(ghost.rls, ["select"]);
    assert.deepEqual(ghost.used_by, ["_shared", "send-sms"]);
    assert.equal(ghost.reach, "none", "reach is about src/ — an edge-function-only table is unreached there");
  });

  test("does not invent a table from words inside a policy name", () => {
    // `ON` appears inside "manage fields on own templates"; a loose scan produced tables called
    // `own` and `published` and filed them as orphaned findings.
    const root = dataRepo();
    run(root);
    const r = rows(root, "resources");
    assert.ok(!r.own && !r.published, "invented a table from a policy name");
  });

  test("counts a legacy table as reached, though it is never named in a .from() call", () => {
    // Legacy tables are addressed as `TABLES.PEOPLE`. Counting only `.from()` reported every one
    // of them as untouched by an app that reads them on nearly every screen.
    const root = dataRepo();
    run(root);
    assert.equal(rows(root, "resources").people.reach, "feature");
  });

  test("counts a declared resource reached through the provider, not only through .from()", () => {
    // An app that routes reads through a data-provider switchboard never writes `.from("tasks")`
    // — it writes `useResource("tasks")`, the exact form the registry's `name` is documented as.
    // Six of the seven resources on that path reported `reached_from_src: "false"`, which is the
    // "a table no screen reaches" finding the column exists to raise, raised falsely six times.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    const put = (rel, text) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text, "utf8");
    };
    put(
      "src/lib/resource-registry.ts",
      `const R = [defineResource({\n  name: "tasks",\n  backing: "supabase",\n  fields: {\n    title: "string",\n  },\n  scope: "none",\n})];\n`,
    );
    put("src/hooks/use-execution.ts", 'export const useTasks = () => useScopedResource<Task>("tasks", filters, {});\n');
    run(root);
    assert.equal(rows(root, "resources").tasks.reach, "feature");
  });

  test("does not invent a resource from a string literal that no declaration names", () => {
    // The licence for reading a bare literal is the declaration, and nothing else. Without that
    // bound this is the guessing the registry exists to replace: every `t("habits")` in a UI
    // string table would mint a data noun.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "src/hooks"), { recursive: true });
    writeFileSync(join(root, "src/hooks/use-copy.ts"), 'export const label = t("invoices");\n');
    run(root);
    assert.equal(rows(root, "resources").invoices, undefined);
  });
});

describe("reach ladder", () => {
  /** A fixture whose only source is a registry declaring every synthetic name this suite uses —
   * `defineResource` is enough to put a name in `names` (and, since these are all declared, in
   * `addressed`) without needing a migration or a generated type just to seed the noun. */
  const reachRepo = () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    const put = (rel, text) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text, "utf8");
    };
    put(
      "src/lib/resource-registry.ts",
      [
        "feature_widget",
        "listed_widget",
        "test_widget",
        "none_widget",
        "dual_widget",
        "split_widget",
        "tags",
        "tasks",
      ]
        .map((n) => `defineResource({ name: "${n}", backing: "supabase", scope: "none" })`)
        .join(",\n") + ";\n",
    );
    return { root, put };
  };

  test("reads `feature` from a recognized call in a non-test file", () => {
    const { root, put } = reachRepo();
    put("src/hooks/use-feature.ts", 'export const useFeatureWidget = () => supabase.from("feature_widget").select();\n');
    run(root);
    assert.equal(rows(root, "resources")["feature-widget"].reach, "feature");
  });

  test("reads `listed` from a bare literal in a non-test file that no recognized call reaches", () => {
    // The admin data browser's own case: `ADMIN_TABLES` writes every table name down as a plain
    // array element, and reads them back through `.from(table as string)` — a variable, not a
    // literal, so no recognized call names them even though the app plainly lists them.
    const { root, put } = reachRepo();
    put("src/lib/admin-tables.ts", 'export const ADMIN_TABLES = ["listed_widget"];\n');
    run(root);
    assert.equal(rows(root, "resources")["listed-widget"].reach, "listed");
  });

  test("reads `test` when the name appears only inside test files", () => {
    // The scope-middleware case: a call that exists to assert the resource is *denied* still
    // names it, and a boolean `reached_from_src` could not tell that apart from a real reach.
    const { root, put } = reachRepo();
    put("src/hooks/use-test-widget.test.ts", 'const NAME = "test_widget";\n');
    run(root);
    assert.equal(rows(root, "resources")["test-widget"].reach, "test");
  });

  test("reads `none` when the name appears nowhere under src/", () => {
    const { root } = reachRepo();
    run(root);
    assert.equal(rows(root, "resources")["none-widget"].reach, "none");
  });

  test("precedence: a table both listed and feature-reached is `feature`", () => {
    const { root, put } = reachRepo();
    put("src/hooks/use-dual.ts", 'export const useDual = () => supabase.from("dual_widget").select();\n');
    put("src/lib/other-list.ts", 'export const OTHER_TABLES = ["dual_widget"];\n');
    run(root);
    assert.equal(rows(root, "resources")["dual-widget"].reach, "feature");
  });

  test("precedence: a table named in both a test and a non-test literal is `listed`, not `test`", () => {
    const { root, put } = reachRepo();
    put("src/lib/config-list.ts", 'export const CONFIG_TABLES = ["split_widget"];\n');
    put("src/hooks/use-split.test.ts", 'const NAME = "split_widget";\n');
    run(root);
    assert.equal(rows(root, "resources")["split-widget"].reach, "listed");
  });

  test("does not match a bare literal as a substring of a longer identifier", () => {
    // A table named `tags` must not match `"tags-input"`. Only the substring guard is under test
    // here, so `tags` appears nowhere else — a false match reads `listed`, a correct one `none`.
    const { root, put } = reachRepo();
    put("src/components/TagsInput.tsx", 'export const INPUT_CLASS = "tags-input";\n');
    run(root);
    assert.equal(rows(root, "resources").tags.reach, "none", "\"tags-input\" was read as containing \"tags\"");
  });

  test("does not read a declared name passed to an unrecognized call as `feature`", () => {
    // Reviewer finding on this branch: the addressed-call form used to match a declared name as
    // the first argument to *any* call — `t("tasks")`, `console.log("tasks", x)` — because the
    // regex checked only what followed the `(`, never the callee. That is not a resource read,
    // and under this ladder a false `feature` is the worst place for it to land: `feature` is the
    // rung the ledger counts. The literal is still there, so the correct reading is `listed`, not
    // silence and not `feature`.
    const { root, put } = reachRepo();
    put("src/hooks/use-copy.ts", 'export const label = t("tasks");\nconsole.log("tasks", 1);\n');
    run(root);
    assert.equal(rows(root, "resources").tasks.reach, "listed");
  });
});

describe("surface resource edges", () => {
  /** Writes a file, creating parent directories as needed. */
  const put = (root, rel, text) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text, "utf8");
  };

  test("resolves a legacy hook pair to a read and a write, by hook name, through TABLES.KEY", () => {
    // Pattern 1 (CLAUDE.md's Data Flow): `useScopedRecords`/`useUpdateContentRecord` name no table
    // themselves — the literal comes from `TABLES.SESSIONS`, right there at the call site in the
    // page, the same shape `SessionsPage.tsx` actually uses.
    const root = repo(`<Route path="s" element={<Sessions />} />`, {
      Sessions:
        `import { useScopedRecords } from "@/hooks/use-scoped-records";\n` +
        `import { useUpdateContentRecord } from "@/hooks/use-content-records";\n` +
        `import { TABLES } from "@/lib/content";\n` +
        `export default function Sessions() {\n` +
        `  useScopedRecords(TABLES.SESSIONS, { contentType: "sessions" });\n` +
        `  useUpdateContentRecord(TABLES.SESSIONS);\n` +
        `}\n`,
    });
    put(root, "src/lib/content.ts", 'export const TABLES = {\n  SESSIONS: "Sessions",\n}\n');
    run(root);
    assert.deepEqual(rows(root).sessions.reads, ["sessions"]);
    assert.deepEqual(rows(root).sessions.writes, ["sessions"]);
  });

  test("follows one hop into an imported hook to find a .from() the page itself never names", () => {
    // Pattern 2: the page calls `useMilestones()`/`useDeleteMilestone()` with no table argument at
    // all — the literal is one file away, inside the hook's own body, the `use-milestones.ts` shape.
    const root = repo(`<Route path="m" element={<Milestones />} />`, {
      Milestones:
        `import { useMilestones, useDeleteMilestone } from "@/hooks/use-milestones";\n` +
        `export default function Milestones() {\n` +
        `  useMilestones();\n` +
        `  useDeleteMilestone();\n` +
        `}\n`,
    });
    put(
      root,
      "src/hooks/use-milestones.ts",
      `export function useMilestones() {\n` +
        `  return supabase.from("progress_milestones").select("*").order("created_at");\n` +
        `}\n` +
        `export function useDeleteMilestone() {\n` +
        `  return { mutateAsync: (id) => supabase.from("progress_milestones").delete().eq("id", id) };\n` +
        `}\n`,
    );
    run(root);
    assert.deepEqual(rows(root).milestones.reads, ["progress-milestones"]);
    assert.deepEqual(rows(root).milestones.writes, ["progress-milestones"]);
  });

  test("does not attribute a sibling export's table to a surface that never imported it", () => {
    // The regression this guards against: `use-execution.ts` houses `useTasks` (-> "tasks") and
    // `useProjects` (-> "projects") side by side. A whole-file scan would leak "projects" onto
    // every surface that imports only `useTasks` — over-claiming an edge, the wrong direction for
    // a tool whose whole value is that a row is a fact.
    const root = repo(`<Route path="t" element={<Tasks />} />`, {
      Tasks:
        `import { useTasks } from "@/hooks/use-execution";\n` +
        `export default function Tasks() {\n  useTasks();\n}\n`,
    });
    put(
      root,
      "src/hooks/use-execution.ts",
      `import { useResource } from "@marktiderman/genesis-core/hooks";\n` +
        `function useScopedResource(resource, filters, options) {\n` +
        `  return useResource(resource, { ...options, defaultFilters: filters });\n` +
        `}\n` +
        `export function useTasks() {\n  return useScopedResource("tasks", [], {});\n}\n` +
        `export function useProjects() {\n  return useScopedResource("projects", [], {});\n}\n`,
    );
    put(
      root,
      "src/lib/resource-registry.ts",
      `const R = [\n` +
        `  defineResource({ name: "tasks", backing: "supabase" }),\n` +
        `  defineResource({ name: "projects", backing: "supabase" }),\n` +
        `];\n`,
    );
    run(root);
    assert.deepEqual(rows(root).tasks.reads, ["tasks"], "projects leaked in from a sibling export");
  });

  test("records a Genesis useResource/useOne edge as read only, never write", () => {
    // The hook's return value always bundles create/update/remove regardless of whether the
    // caller touches them (`@marktiderman/genesis-core`'s `useResource`), and this scan cannot see
    // which of those a caller destructures and calls — so even a component that visibly
    // destructures `create` and calls it must still read `writes: []`. Overstating a write is the
    // one error this field must never make; understating it is the documented, accepted gap.
    const root = repo(`<Route path="t" element={<Tasks />} />`, {
      Tasks:
        `import { useTasks } from "@/hooks/use-execution";\n` +
        `export default function Tasks() {\n` +
        `  const { list, create } = useTasks();\n` +
        `  const onAdd = () => create({ title: "x" });\n` +
        `}\n`,
    });
    put(
      root,
      "src/hooks/use-execution.ts",
      `import { useResource } from "@marktiderman/genesis-core/hooks";\n` +
        `export function useTasks() {\n  return useResource("tasks", {});\n}\n`,
    );
    put(root, "src/lib/resource-registry.ts", `const R = [defineResource({ name: "tasks", backing: "supabase" })];\n`);
    run(root);
    assert.deepEqual(rows(root).tasks.reads, ["tasks"]);
    assert.deepEqual(rows(root).tasks.writes, [], "a Genesis write must never be reported");
  });

  test("does not invent an edge when the table name is passed through a variable", () => {
    // `useContentRecords(table, ...)` inside a wrapper the page itself defines, called with a
    // local variable rather than a literal or `TABLES.KEY` — this scan has no way to resolve
    // `table`, so it must record nothing rather than guess.
    const root = repo(`<Route path="x" element={<Mystery />} />`, {
      Mystery:
        `import { useContentRecords } from "@/hooks/use-content-records";\n` +
        `export default function Mystery({ table }) {\n` +
        `  useContentRecords(table, {});\n` +
        `}\n`,
    });
    run(root);
    assert.deepEqual(rows(root).mystery.reads, []);
    assert.deepEqual(rows(root).mystery.writes, []);
  });

  test("does not read a write verb from an unrelated statement past the chain's own boundary", () => {
    // Two `.from()` calls in one function, one read and one write on a DIFFERENT table. A write
    // search unbounded by the statement it belongs to would let "widgets" borrow "gadgets"'s
    // `.insert(` and report a write that never happened.
    const root = repo(`<Route path="w" element={<Widgets />} />`, {
      Widgets:
        `import { useWidgets } from "@/hooks/use-widgets";\n` +
        `export default function Widgets() {\n  useWidgets();\n}\n`,
    });
    put(
      root,
      "src/hooks/use-widgets.ts",
      `export function useWidgets() {\n` +
        `  const w = supabase.from("widgets").select("*").order("id");\n` +
        `  const g = supabase.from("gadgets").insert({ name: "x" }).select();\n` +
        `  return { w, g };\n` +
        `}\n`,
    );
    run(root);
    assert.deepEqual(rows(root).widgets.reads, ["widgets"]);
    assert.deepEqual(rows(root).widgets.writes, ["gadgets"], "the write must land on gadgets, not widgets");
  });

  test("joins reads/writes to a resource row's id, not a bare table name", () => {
    const root = repo(`<Route path="s" element={<Sessions />} />`, {
      Sessions:
        `import { useContentRecords } from "@/hooks/use-content-records";\n` +
        `import { TABLES } from "@/lib/content";\n` +
        `export default function Sessions() {\n` +
        `  useContentRecords(TABLES.SESSIONS, {});\n` +
        `}\n`,
    });
    put(root, "src/lib/content.ts", 'export const TABLES = {\n  SESSIONS: "Sessions",\n}\n');
    run(root);
    assert.deepEqual(Object.keys(rows(root, "resources")), ["sessions"]);
    assert.deepEqual(rows(root).sessions.reads, ["sessions"], "must be the row id, not the raw name");
  });

  test("the ledger counts a resolved edge, and states what the numerator misses", () => {
    const root = repo(`<Route path="s" element={<Sessions />} />`, {
      Sessions:
        `import { useContentRecords } from "@/hooks/use-content-records";\n` +
        `import { TABLES } from "@/lib/content";\n` +
        `export default function Sessions() {\n  useContentRecords(TABLES.SESSIONS, {});\n}\n`,
    });
    put(root, "src/lib/content.ts", 'export const TABLES = {\n  SESSIONS: "Sessions",\n}\n');
    run(root);
    assert.match(ledgerOf(root), /surfaces with a resource edge\s+1 \/ 1\s+a surface's own file/);
  });

  test("a surface with no resolvable edge reports the fraction honestly, not a crash", () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(rows(root).alpha.reads, []);
    assert.deepEqual(rows(root).alpha.writes, []);
    assert.match(ledgerOf(root), /surfaces with a resource edge\s+0 \/ 1\s/);
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
    // permanent false positive no action can clear. The claim is real because the file is there —
    // the fixture used to assert the withholding rule against a directory it never created, which
    // passed for the wrong reason and licensed a heuristic that guessed from surface rows.
    const root = withFeature('owns: ["supabase/functions/**"]');
    mkdirSync(join(root, "supabase/functions/notify"), { recursive: true });
    writeFileSync(join(root, "supabase/functions/notify/index.ts"), "export default () => null;\n");
    run(root);
    const r = run(root, "check");
    assert.doesNotMatch(r.out, /owns nothing/);
    // Asserting the absence of a string also passes when the tool crashes, so pin the exit code
    // and one positive fact: this test used to survive `throw` at the top of report().
    assert.equal(r.code, 0);
    assert.match(r.out, /surface\(s\), \d+ resource\(s\) extracted/);
  });

  test("does not report a feature owning a live file that is not a routed screen", () => {
    // `!` said "owns nothing" about `src/pages/ClientDashboard.tsx` — 11 KB of live code reached
    // through a dispatcher rather than a `<Route>`. The glob was matched against surface ROWS, so
    // a real file in the extracted directory read as deleted code, the gate went red, and the
    // remedy it printed (`run cartography sync`) could never clear it: sync does not write
    // data/features/, and the file it named was on disk the whole time.
    const root = withFeature('owns: ["src/pages/Dispatched.tsx"]');
    writeFileSync(join(root, "src/pages/Dispatched.tsx"), "export default function Dispatched(){return null}\n");
    run(root);
    const r = run(root, "check");
    assert.doesNotMatch(r.out, /owns nothing/, "a file that exists is not deleted code");
    assert.equal(r.code, 0, "a gate no sync can clear is a gate that gets deleted");
  });

  test("accepts a feature owning a directory, not only a file glob", () => {
    // `owns: ["packages/"]` is how people write "this whole directory" — five of one consumer's
    // 108 features do — and a file-only match reports every one of them as owning nothing while
    // the directory is on disk. A permanent red gate is the failure this mark exists to avoid.
    const root = withFeature('owns: ["packages/"]');
    mkdirSync(join(root, "packages/core"), { recursive: true });
    writeFileSync(join(root, "packages/core/index.ts"), "export const x = 1;\n");
    run(root);
    const r = run(root, "check");
    assert.doesNotMatch(r.out, /owns nothing/);
    assert.equal(r.code, 0);
  });

  test("still reports a feature whose globs match no file, and does not blame sync for it", () => {
    const r = run(withFeature('owns: ["src/pages/Deleted.tsx"]'), "check");
    assert.match(r.out, /owns nothing/);
    assert.equal(r.code, 1, "a feature pointing at deleted code must fail the gate");
    assert.match(r.out, /own no file that exists/, "the remedy must name the glob, not `sync`");
    assert.doesNotMatch(
      r.out,
      /stale fact\(s\)/,
      "`sync` never writes data/features/, so it cannot be the advice for this finding",
    );
  });
});

describe("independent extractors", () => {
  test("extracts the data layer from a repo with no React Router", () => {
    // `extractRoutes` threw on a missing src/App.tsx, and that aborted the run before resources
    // were touched at all. A monorepo with 13 migrations and a dozen edge functions produced no
    // map whatsoever — not a partial one, not a gap report, just `✗ no src/App.tsx`.
    const root = bare();
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(
      join(root, "supabase/migrations/0001.sql"),
      'ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "p" ON public.jobs FOR SELECT USING (true);\n',
    );
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(rows(root, "resources").jobs?.rls, ["select"], "no router cost the whole data layer");
    assert.match(r.out, /unread \(surfaces\)\s+src\/App\.tsx/, "the absent router must be stated, not silent");
    assert.equal(existsSync(join(root, "data/surfaces")), false, "materialised an empty surfaces table");
  });

  test("extracts screens from a repo with no data layer, and states what it could not read", () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.ok(rows(root).alpha, "no data layer cost the screens");
    assert.match(r.out, /unread \(resources\).*supabase\/migrations/, "a missing source must be reported");
  });

  test("fails rather than writing an empty map when nothing at all is extractable", () => {
    // Surviving one missing source must not become surviving all of them: "no screens, no tables"
    // is a confident, wrong fact, and a committed empty map is worse than no map.
    const r = run(bare());
    assert.equal(r.code, 1);
    assert.match(r.out, /no extractable source/);
  });

  test("refuses to wipe committed surfaces when the router file disappears", () => {
    // The per-table emptiness guard has to survive the source going missing, not just the parser
    // failing to understand it — otherwise making absence survivable makes deletion silent.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    assert.equal(Object.keys(rows(root)).length, 1);
    rmSync(join(root, "src/App.tsx"));
    const second = run(root);
    assert.equal(second.code, 1);
    assert.match(second.out, /refusing to empty the table/);
    assert.match(second.out, /Source\(s\) not found: src\/App\.tsx/);
    assert.equal(Object.keys(rows(root)).length, 1, "rows must survive a vanished source");
  });
});

describe("the blind-spots ledger", () => {
  test("check verifies the ledger it writes", () => {
    // `diffTable` covered surfaces and resources; the ledger was written by `sync` and verified by
    // nothing. An adversarial reviewer hand-edited the committed copy to read `99 / 99` and the
    // gate CI runs exited 0 — so "nothing you write in data/ can move a number here" was true of
    // sync and false of the only command anyone enforces.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    assert.equal(run(root, "check").code, 0, "a freshly synced ledger must pass");
    const p = join(root, LEDGER_PATH);
    writeFileSync(p, readFileSync(p, "utf8").replace(/\d+ \/ \d+/, "99 / 99"));
    const r = run(root, "check");
    assert.equal(r.code, 1, "a hand-edited ledger passed the gate");
    assert.match(r.out, /changed ledger/);
    assert.match(r.out, /stale fact/, "a wrong number is drift, not a coverage gap");
  });

  test("a missing ledger is drift too", () => {
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(root);
    rmSync(join(root, LEDGER_PATH));
    const r = run(root, "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /new ledger/);
  });

  test("compares screens with screens, not screens with route tags", () => {
    // The fraction was unique screen components over `<Route` tokens: two units, and a denominator
    // no extractor could ever reach. A scope resolver and a `<Navigate>` are route tags and neither
    // is another screen, so 42 / 104 read as permanent blindness where there was none — and hid
    // the finding that matters, a routed component that produced no row.
    const root = repo(
      `<Route path="c/:clientId" element={<ClientScopeResolver />}>\n` +
        `  <Route path="rocks" element={<Rocks />} />\n` +
        `</Route>\n` +
        `<Route path="rocks" element={<Rocks />} />\n` +
        `<Route path="old" element={<Navigate to="/rocks" />} />\n` +
        `<Route path="*" element={<NotFound />} />`,
      { Rocks: "", NotFound: "" },
    );
    run(root);
    // Five route tags, two screens. Both sides of the fraction are screens now.
    assert.match(ledgerOf(root), /screens routed in src\/App\.tsx\s+2 \/ 2\s/);
  });

  test("counts resources carrying a scope, not resources carrying a declaration", () => {
    // The label said "declared scope" and the numerator counted declaredness. A resource that
    // declares its rule through a helper call the parser cannot read reports `scope: unknown`;
    // counting it as seen hid the one blind spot this row exists to show.
    const root = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/content.ts"), 'export const TABLES = {\n  P: "P",\n  Q: "Q",\n}\n');
    writeFileSync(
      join(root, "src/lib/resource-registry.ts"),
      `const R = [\n` +
        `defineResource({ name: TABLES.P, backing: "jsonb", scope: "none" }),\n` +
        `defineResource({ name: TABLES.Q, backing: "jsonb", scope: ownerScope("Q") }),\n` +
        `];\n`,
    );
    run(root);
    const r = rows(root, "resources");
    assert.equal(r.q.declared, "resource-registry.ts", "fixture no longer exercises the case");
    assert.equal(r.q.scope, "unknown", "fixture no longer exercises the case");
    assert.match(ledgerOf(root), /resources with a declared scope\s+1 \/ 2\s+1 declare a rule the parser cannot read/);
  });

  test("counts a routed screen the parser cannot turn into a row", () => {
    // Numerator and denominator came from one predicate, so the fraction read 100% forever. Two
    // real screens could land in the data-router `Component={Foo}` form — the modern React Router
    // spelling, and one of the four blind spots SKILL.md lists — and `42 / 42` did not move,
    // while the row's own note promised "a gap is a routed component that produced no row".
    // Improving that ratio by shrinking its denominator is the failure this row exists to prevent.
    const root = repo(
      `<Route path="a" element={<Alpha />} />\n<Route path="audit" Component={AuditLog} />`,
      { Alpha: "", AuditLog: "" },
    );
    run(root);
    assert.deepEqual(Object.keys(rows(root)), ["alpha"], "the extractor still cannot read that form");
    assert.match(ledgerOf(root), /screens routed in src\/App\.tsx\s+1 \/ 2\s+a gap is a routed component/);
  });

  test("does not say a router file is absent when it is present and unreadable", () => {
    // The note was selected by "zero screens resolved", not by "the file is not there", so a repo
    // whose App.tsx mounts screens through `createBrowserRouter` produced a note byte-identical to
    // a repo with no App.tsx at all — and `missingSources` is existence-only, so no `·` corrected
    // it. The one sentence about the surface layer was a checkable falsehood, at exit 0.
    const root = bare();
    mkdirSync(join(root, "src/pages"), { recursive: true });
    mkdirSync(join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(join(root, "supabase/migrations/0001.sql"), "CREATE TABLE public.jobs (id uuid);\n");
    writeFileSync(
      join(root, "src/App.tsx"),
      `import Home from "./pages/Home";\nconst router = createBrowserRouter([{ path: "/", Component: Home }]);\n`,
    );
    writeFileSync(join(root, "src/pages/Home.tsx"), "export default function Home(){return null}\n");
    assert.equal(run(root).code, 0);
    const ledger = ledgerOf(root);
    assert.match(ledger, /screens routed in src\/App\.tsx\s+0 \/ 0\s+src\/App\.tsx present but no <Route/);
    assert.doesNotMatch(ledger, /no src\/App\.tsx/, "the file it says is missing is on disk");

    rmSync(join(root, "src/App.tsx"));
    rmSync(join(root, "data"), { recursive: true });
    run(root);
    assert.match(ledgerOf(root), /screens routed in src\/App\.tsx\s+0 \/ 0\s+no src\/App\.tsx/);
  });

  test("does not say a repo has no typed tables when it has an unreadable types file", () => {
    // Same conflation, one row down: `0 / 0` meant "no types.ts", "a types.ts this parser cannot
    // follow", and "a schema with no tables" indistinguishably — while the ledger's preamble tells
    // the reader every denominator was counted outside the map, so the zero reads as a fact.
    const absent = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    run(absent);
    assert.match(ledgerOf(absent), /typed tables reached by a feature\s+0 \/ 0\s+no src\/integrations\/supabase\/types\.ts/);

    const unreadable = repo(`<Route path="a" element={<Alpha />} />`, { Alpha: "" });
    mkdirSync(join(unreadable, "src/integrations/supabase"), { recursive: true });
    writeFileSync(
      join(unreadable, "src/integrations/supabase/types.ts"),
      "export type Database = { public: { Tables: { profiles: { Row: {} }, widgets: { Row: {} } } } }\n",
    );
    run(unreadable);
    assert.match(ledgerOf(unreadable), /typed tables reached by a feature\s+0 \/ 0\s+src\/integrations\/supabase\/types\.ts present but no/);
  });

  test("refuses a repo that merely has a directory named src", () => {
    // The all-sources-absent guard tested `existsSync`, and `RESOURCE_SOURCES` lists the whole
    // `src` tree, so it could not fire for any repo with a `src/` — dead code for every JS/TS
    // checkout there is. A repo holding one `src/a.ts` got a committed ledger of `0 / 0` rows and
    // `check` held it green forever: the tool had read nothing and said so nowhere.
    const root = bare();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /no extractable source/);
    assert.equal(existsSync(join(root, LEDGER_PATH)), false, "an empty map was committed anyway");
  });
});
