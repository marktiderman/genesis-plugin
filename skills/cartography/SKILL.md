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
| `data/features/` | human | read for its `owns:` globs, never written |

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
or both.

**Not extracted — the job.** Nothing in the code says *"tell my coach how I'm really doing without
waiting for a session."* The code says one component imports another and reads a table. It can
say what is there, never why anyone would want it.

This matters more than it sounds. Clustering by imports produces **screen-shaped clusters**,
because imports follow screens. Accept those as features and you get a map of your navigation
wearing a product's clothes. Name the job first; attach screens to it with `owns:` after.

## What `check` reports

| mark | finding | exit |
| --- | --- | --- |
| `+` `-` `~` | a screen appeared, vanished, or changed scope/route/layout | 1 |
| `!` | a feature whose globs match nothing — renamed or deleted code | 1 |
| `?` | a screen no feature's `owns:` glob claims | 0 |

The committed rows are the baseline; `check` compares a fresh extraction against them.

**Only stale facts fail.** `+ - ~ !` mean the committed map is untrue, and one `sync` fixes it.
`?` is the gap report — the parts of the app serving no articulated job — and on an existing
codebase it starts at nearly every screen. Failing on it would make the gate unusable the day it
is installed, and a check nobody can turn green is a check that gets deleted. Coverage is held
instead by `claimed_by` in the rows: lose a claim and it surfaces as `~`, which does fail.

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
pointing at deleted code fails until it is fixed. A screen with no owner does not fail — it waits.

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
  guard is not extracted, so a public screen reads as prefix-less like any other.

Affordances are import names ending in `Form`, `Dialog`, `Sheet`, `Panel`, or `Modal`. A dialog
named otherwise is invisible; an import that is never rendered still counts. It is a convention
made legible, not a call graph.

Treat the map as a floor: everything in it is in the code. Not everything in the code is in it.

## Fitting another stack

Four functions read this stack, and all four are in one file:

| seam | assumes |
| --- | --- |
| `routeTokens` | React Router JSX — `<Route>` tags in `src/App.tsx` |
| `SCOPE_PREFIX` | scopes declared as a nested `<Route path="c/:clientId">` |
| `componentFacts` | pages under `src/pages/` or `src/components/`, ES import syntax |
| `navFacts` | an optional `src/lib/nav-registry.ts` for groups and labels |

Everything downstream — the two-table split, the `owns:` join, the drift check — is stack-agnostic.
`navFacts` degrades to empty when its file is absent; an app with no scope prefixes simply files
every screen under `personal`. Only `src/App.tsx` is required.
