---
name: cartography
description: >-
  Map a codebase into gitdata rows — extract every screen, the dialogs it opens, the scopes it is
  reachable in, and which design system it leans on, then report what no feature claims. Use when
  setting up a feature or flow registry, when asked "what screens do we have", "what does this app
  actually do", "what is not covered", or to check a codebase map is still true after routes
  change. Also use as a pre-push or CI check once a map exists.
---

# Cartography — the map the code already knows

A codebase knows its own structure and cannot state its own purpose. Cartography extracts the
first and refuses to guess the second.

```bash
CARTO="${CLAUDE_PLUGIN_ROOT}/skills/cartography/scripts/cartography.mjs"
node "$CARTO" init  --root .   # first run
node "$CARTO" sync  --root .   # re-extract, report
node "$CARTO" check --root .   # report only, exit 1 on stale facts
```

The script travels with the plugin — nothing to install, and `${CLAUDE_PLUGIN_ROOT}` resolves to
wherever it landed. It needs Node and a git checkout; that is all.

## The rule that makes it re-runnable

**Two tables. The extractor rewrites one and never writes the other.**

| table | owner | on every run |
| --- | --- | --- |
| `data/surfaces/` | machine | rows deleted and rewritten wholesale |
| `data/resources/` | machine | rows deleted and rewritten wholesale |
| `data/features/` | human | read for its `owns:` globs; **no row is ever written** |

(`init` may create `data/features/_inventory.md` once, if absent. It is a `_`-prefixed draft, not a
row, and no later run touches it.)

They join through `owns:` globs on a feature — declared by a person, evaluated by the machine. The
result lands back on the surface as `claimed_by`, so who claims a screen is a committed fact rather
than a number in a console. Narrow a glob and the row changes; the check that watches every other
generated fact watches that one too.

Mixing generated and authored fields in one file makes every re-run a merge conflict. Splitting
them makes regeneration safe by construction: nothing you wrote is at risk, because the extractor
has no reason to write your file.

Editing a feature's `owns:` therefore means re-running `sync` — the join moved.

Rows carry **no timestamp**. A generated file that embeds the time it was generated differs on
every run, and a check that always fails is a check nobody reads.

## What it extracts, and what it will not

**Extracted** — routes and the scopes each screen mounts in; the component behind each route;
the dialogs it imports, which are its verbs; whether it leans on the design system, a local kit,
or both; and, per surface, the resources it reads and writes (see `surfaces`' `reads`/`writes`
below).

**Not extracted — the job.** Nothing in the code says *"tell my coach how I'm really doing without
waiting for a session."* The code says one component imports another and reads a table. It can
say what is there, never why anyone would want it.

This matters more than it sounds. Clustering by imports produces **screen-shaped clusters**,
because imports follow screens. Accept those as features and you get a map of your navigation
wearing a product's clothes. Name the job first; attach screens to it with `owns:` after.

## The two tables it writes

**`surfaces`** — one row per screen the router reaches. Where you can go.

Each surface also carries `reads`/`writes` — the resource ids it touches, so the two tables join:
"if I change this table, what breaks" is a `grep` over `data/surfaces/*.md` away instead of a
question nobody's code answers. The evidence is a surface's own component file, plus the hooks it
imports directly (one hop, never followed further), read for three patterns unevenly — matching
how unevenly the app itself is written:

- a closed list of generic hooks over a legacy jsonb constant (`useContentRecords`,
  `useCreateContentRecord`, …) — read or write, decided by which hook, name alone.
- a hand-written hook calling `supabase.from("x")` directly — read or write, decided by the verb
  chained onto that same call (`.insert`/`.update`/`.upsert`/`.delete` is a write; anything else,
  including nothing this scan recognizes, is a read).
- a Genesis-native `useResource`/`useOne` call — **read only, never write.** That hook's return
  value always bundles `create`/`update`/`remove` regardless of whether a caller touches them, and
  this scan cannot see which of those a caller destructures and calls. Every resource reached this
  way is read-only on the map even where the page visibly calls `create(...)` — a real write is
  invisible here, not wrong. Overstating a write is the one error this field must not make.

A table name passed through a variable rather than written as a literal, or a mutation that
happens only inside a rendered dialog or form (a separate file — only a surface's *own* imports
are its evidence), is invisible the same way: absent, not guessed at. The blind-spots ledger's
"surfaces with a resource edge" row says so in its own note.

**`resources`** — one row per data noun the app addresses, reconciled across the five places a
table can be named: a legacy table constant, the generated Supabase types, a hand-written resource
registry, `.from(…)` calls, and migrations. Every source is recorded separately rather than merged
into one "exists" flag, **because the disagreements are the point.** A table with RLS enabled that
no type file knows about and no screen reaches is only visible if `declared`, `rls_enabled` and
`reach` are allowed to contradict each other on the same row.

`backing` is the reconciled verdict, and it consults the migrations: `jsonb`, `supabase` (in the
generated types), `migration` (created by a migration here, absent from those types), `edge-only`
(named by a function and nothing else), `orphan` (named by nothing that defines it). Without the
`migration` rung a monorepo whose data layer *is* its migrations reported 26 of 28 tables as
`edge-only` or `orphan` while creating every one of them.

`reach` is a four-value ladder, strongest first — `feature`, `listed`, `test`, `none` — not the
boolean it replaced. `reached_from_src: "true"|"false"` forced two different facts into one field:
a table an admin data browser lists as a literal string and reads through a variable (`.from(table
as string)`, never `.from("that_table")`) said `"false"` though it is genuinely reachable, just not
by any recognized call; a table whose only mention anywhere is a test asserting it is *denied* said
`"true"`, because the boolean could not tell "a feature reaches this" from "a test proves nothing
does." Flipping the false rows would have made the ledger row below an unfalsifiable 57/57 — the
fix is more values, not a flipped bit:

1. **`feature`** — a recognized call in a non-test file: `.from("x")`, the legacy `TABLES.KEY`
   constant, or a name the resource registry already declared appearing as a call's first
   argument, which is how a resource routed through a data-provider switchboard is written
   (`useResource("tasks")`). That third form is bounded twice — by the declaration, so it can
   confirm a reach but never invent a table from a string, and by the callee itself: only a `use*`
   hook or a CRUD verb (`getList`, `create`, …) counts, so a declared name passed to an unrelated
   call — a translation lookup, a log line, a test's `describe(...)` — does not read as `feature`.
2. **`listed`** — the name appears as a bare, exactly-quoted string literal in a non-test file, but
   no recognized call reaches it. Someone wrote the name down; nothing recognized calls it. This
   rung does not try to tell a config file's array of table names from an unrelated string that
   happens to match one — that would be guessing at a file's purpose, and "the literal appears, but
   no call I recognize uses it" is mechanically checkable without it.
3. **`test`** — the name appears, in any of the forms above, only inside test files (`*.test.*`,
   `*.spec.*`, anything under `__tests__/`).
4. **`none`** — the name appears nowhere under `src/`.

Precedence runs in that order regardless of which file a directory happens to read first: a table
both `listed` and `feature`-reached is `feature`; a table named in both a test and a non-test
literal is `listed`, not `test` — a real, if weak, non-test mention outranks a test-only one.

Where a legacy and a typed table share a name — one app had `Coaches` and `coaches` — the id is
qualified by backing rather than letting one row overwrite the other.

`data/_views/blind-spots.md` is written beside them: **how much of what exists the extractor can
see**, every denominator counted outside the map. Nothing you write in `data/` moves a number
there; the only way to move one is to teach the extractor to see more. Expect the numbers to get
worse when a new extractor lands — that is it working.

That last claim is enforced, not asserted: `check` recomputes the ledger and compares it to the
committed one, so a hand-edited number is drift and fails the gate exactly like a hand-edited row.
It used to be written by `sync` and verified by nothing, which made the property a decoration —
editing the file to read `typed tables reached from src 99 / 99` passed CI.

Both sides of every fraction are the same unit. `screens routed in src/App.tsx` counts distinct
innermost non-chrome components, not `<Route` tags: one app's 104 route tags are 42 screens once
`<Navigate>`s, legacy redirects and the same page mounted in five scopes are set aside, and a
denominator nothing can reach reports blindness where there is none.

Same unit is not the same predicate. The denominator counts every component a route mounts —
including the data-router `Component={Foo}` form the extractor cannot turn into a row — while the
numerator counts the ones that became rows. Computing both from one predicate made the row read
`42 / 42` forever: two real screens could land in a form the parser does not read and the number
would not move, which is improving a ratio by shrinking its denominator.

A denominator of `0` is not a fact on its own. Where the row's source can be absent, unreadable, or
genuinely empty, the note says which — `no src/App.tsx` and `src/App.tsx present but no <Route
element={<X/>}> the parser can read` are different sentences, and the second is the one a repo with
a `createBrowserRouter` gets.

## What `check` reports

| mark | finding | exit |
| --- | --- | --- |
| `+` `-` `~` | a screen, resource, or the blind-spots ledger appeared, vanished, or changed | 1 |
| `!` | a feature whose `owns:` globs match **no file on disk** | 1 |
| `?` | a screen no feature's `owns:` glob claims | 0 |
| `·` | a source this repo does not have, so that half was not extracted | 0 |

The committed rows are the baseline; `check` compares a fresh extraction against them.

**Only stale facts fail.** `+ - ~` mean the committed map is untrue, and one `sync` fixes it. `!`
is stale too, but in the one table `sync` never writes — the glob names a path that is not there,
and the fix is to correct the glob or delete the row, so it is reported and remedied separately.
The globs are matched against the filesystem, not against the extracted rows: a feature owning a
live file that is simply not a routed screen — a dashboard reached through a dispatcher — is not
dead, and used to fail a gate no command could clear.
`?` and `·` are gap reports — the parts of the app serving no articulated job, and the parts of
this app's stack the repo does not have — and on an existing codebase `?` starts at nearly every
screen. Failing on those would make the gate unusable the day it is installed, and a check nobody
can turn green is a check that gets deleted. Coverage is held instead by `claimed_by` in the rows:
lose a claim and it surfaces as `~`, which does fail.

## Using it

**First run.** `init` writes `data/surfaces/` and, if no inventory exists, proposes
`data/features/_inventory.md` — a `_`-prefixed draft gitdata never loads as a row. Name the jobs
there, in one file, until they settle.

**Then.** Split the survivors into `data/features/<id>--<slug>.md` rows, each with `owns:` globs:

```yaml
id: F-006
title: Report how I'm really doing
owns: ["src/pages/CheckIns*", "src/components/forms/CreateCheckInForm.tsx"]
```

**Then it runs itself.** `check` exits non-zero the moment the committed map stops matching the
code, so it belongs in a pre-push hook and in CI. A new screen fails until it is synced; a feature
whose globs match no file fails until the glob is fixed. A screen with no owner does not fail — it
waits.

A CI runner has no plugins, so `${CLAUDE_PLUGIN_ROOT}` is not there: point the build at a checkout
of this repo, **pinned to a commit**, or a change to the extractor breaks a build that did not
change.

## What it cannot see

Route extraction reads JSX, not a type-checked tree. It scans each `<Route>` tag to its closing
`>` at brace depth zero, so multi-line routes and guard wrappers are handled — but these are out
of reach, and a missing screen looks identical to a screen that does not exist:

- routes declared outside `src/App.tsx`, or through the data-router `Component={Foo}` form
- a component reached by a path built at runtime rather than written as a literal
- `scopes` records the **URL prefix**, not who may enter. Whether a route sits inside an auth
  guard is not extracted, so the sign-in page and the catch-all 404 read as prefix-less like any
  personal screen. Do not read `personal` as "shows a person's own data".
- a component named `Navigate`, or ending `Layout`, `Guard`, `Provider`, `Boundary`, `Redirect` or
  `ScopeResolver`, is treated as chrome and omitted. A real screen named that way is omitted too —
  on both sides of the blind-spots fraction, so that one is invisible there as well.
- `!` asks the filesystem, so a feature owning only an edge function or a shared hook is not dead:
  those files exist. It fires only when nothing on disk matches any glob the feature declares.

A surface's `reads`/`writes` follow the same rule — see "The two tables it writes" above for what
the three data patterns cover and what each one misses. In one sentence: a table named through a
variable is invisible; a write made through a Genesis `useResource`/`useOne` return value is
recorded read-only, never write; and a mutation reachable only from a rendered dialog or form —
not the surface's own file or its own direct hook imports — does not appear at all.

Affordances are import names ending in `Form`, `Dialog`, `Sheet`, `Panel`, or `Modal`, taken from
the app's own modules — a design system's `Dialog` primitive is not a verb. A dialog named
otherwise is invisible; an import that is never rendered still counts. It is a convention made
legible, not a call graph.

`group` and `role` are scope-tagged lists, not single values, because a screen can be grouped
differently and gated differently depending on the scope it is reached in. An app whose nav
subdivides a URL scope (one `/t/` prefix, three kinds of team) is reported in the nav's own words.

Treat the map as a floor: everything in it is in the code. Not everything in the code is in it.

Needs Node 18 or newer.

## Fitting another stack

Five functions read this stack:

| seam | assumes |
| --- | --- |
| `routeTokens` (`cartography.mjs`) | React Router JSX — `<Route>` tags in `src/App.tsx` |
| `SCOPE_PREFIX` (`cartography.mjs`) | scopes declared as a nested `<Route path="c/:clientId">` |
| `componentFacts` (`cartography.mjs`) | pages under `src/pages/` or `src/components/`, ES import syntax |
| `navFacts` (`cartography.mjs`) | an optional `src/lib/nav-registry.ts` for groups and labels |
| `surfaceResourceEdges` (`lib/resource-edges.js`) | hooks imported as `@/hooks/x`, exported `export function` (not an arrow const), and the three read/write patterns named above |

Everything downstream — the two-table split, the `owns:` join, the drift check — is stack-agnostic.
`navFacts` degrades to empty when its file is absent; an app with no scope prefixes simply files
every screen under `personal`. `surfaceResourceEdges` degrades to empty `reads`/`writes` for a
repo whose hooks use a different import alias or export shape — a real gap the ledger states,
never a crash.

**No single file is required.** The two extractors are independent: a repo with no React Router
still has a data layer, and a repo with no migrations still has screens. A source this repo does
not have is reported as `·` and the other half runs anyway. The tool fails only when *nothing at
all* was extracted and no map is already committed — a stack it cannot read — because writing "no
screens, no tables" for one would be a confident, wrong fact, which is the failure the whole map
exists to avoid. That is asked of what was read, not of what is on disk: the same guard phrased as
`existsSync` could not fire for any repo with a directory named `src`, which is every repo.

A table whose sources are all absent is left alone entirely: not written, not emptied. If rows for
it are already committed and the source has since vanished, that fails rather than wiping them —
a moved router looks identical to a deleted app, and only one of those should cost you the map.

That refusal is scoped to the one table. The other table is still written, because a refusal about
screens is not a reason to withhold a freshly-read fact about a database — a run that refused
surfaces once left `rls_enabled: "true"` committed against migrations that had just turned it off,
with no path to correct it. The ledger *is* withheld, since it is derived from both tables. The
error names what was written and what was not.
