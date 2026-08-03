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
node skills/cartography/scripts/cartography.mjs init   --root .   # first run
node skills/cartography/scripts/cartography.mjs sync   --root .   # re-extract, report
node skills/cartography/scripts/cartography.mjs check  --root .   # report only, exit 1 (CI)
```

## The rule that makes it re-runnable

**Two tables. The extractor writes one and never opens the other.**

| table | owner | on every run |
| --- | --- | --- |
| `data/surfaces/` | machine | deleted and rewritten wholesale |
| `data/features/` | human | untouched |

They join through `owns:` globs on a feature — declared by a person, evaluated by the machine.

Mixing generated and authored fields in one file makes every re-run a merge conflict. Splitting
them makes regeneration safe by construction: nothing you wrote is at risk, because the extractor
has no reason to open your file.

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

| mark | finding |
| --- | --- |
| `+` `-` `~` | a screen appeared, vanished, or changed scope/route/layout |
| `?` | a screen no feature's `owns:` glob claims |
| `!` | a feature whose globs match nothing — renamed or deleted code |

The committed rows are the baseline; `check` compares a fresh extraction against them. `?` is the
gap report: the parts of the app serving no articulated job. `!` is its mirror.

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

**Then it runs itself.** `check` as a pre-push hook and in CI. New screen with no owner fails
loudly; a feature pointing at deleted code fails just as loudly.

## Fitting another stack

The extractor reads React Router in `src/App.tsx`, pages under `src/pages/`, and an optional
`src/lib/nav-registry.ts` for groups and labels. It degrades when those are absent rather than
failing. A different router means a different `extractRoutes` — that function is the seam, and it
is the only stack-specific part.
