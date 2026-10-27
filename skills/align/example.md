# A worked alignment check

The request: *"Let's get aligned before we build this: add structural checks to `genesis doctor`
so it catches projects that have drifted from the Genesis structure."*

Round 1 is a real run of this skill against the Genesis repo. The replies, the later rounds and
the mid-build finding are illustrative: they show how the protocol continues.

## Round 1 — framing only

```
Round 1 · Framing · need you: F1, F3–F5

**F1** [decision] "Genesis structure" means the files Genesis writes into an app and expects
intact: genesis.lock.json's owned files, the AGENTS.md block markers, genesis.config.json,
leftover `.genesis-next` files — not a folder layout for the app's own code. Rec: owned files.
**F2** [fact] The doctor's only structural rules today are `local-primitives` and
`starter-leftover` (doctor/rules.ts:55–77); nothing in the doctor reads genesis.lock.json.
**F3** [decision] For apps made by `genesis init` and kept current by `genesis upgrade` — not
this monorepo, and not genesis-ui's own layer split, which belongs in `pnpm lint:genesis`.
Rec: consumer apps.
**F4** [decision] The doctor reports drift and names the command that fixes it — not
`doctor --fix`; `genesis upgrade` stays the only repair path. Rec: report only.
**F5** [guess] Drift is what `upgrade` can't recover from by itself: a locked file that's gone, an
unresolved `.genesis-next`, broken AGENTS.md markers. An owned file the app edited on purpose
is not drift — upgrade's three-way merge expects it.

Reply by ID: ok · n · F1 folder layout · rest ok
```

Mark replies: `F1 both — owned files AND folder layout. rest ok`

## Round 2 — the changed lens, what it reopens, the next band

F1 changed, so every line it frames reopens. F2 is a fact and F4 doesn't depend on F1's scope,
so both stay settled.

```
Round 2 · changed F1 · reopened F3, F5 · new A1–A4 · need you: F1, F3, F5, A1–A4

**F1** ✎ "Genesis structure" means both the files Genesis owns in an app and the folder layout
Genesis expects for the app's own code. (was: owned files only)
**F3** ✎ For consumer apps — the layout half reads `doctor.src` and the installed packs, never
a list hard-coded in the CLI.
**F5** ✎ Drift is (a) owned-file damage `upgrade` can't recover from, plus (b) app code outside
the roots the layout names. Edited owned files are still not drift.
Settled: F2, F4

**A1** [decision] One `structure` rule group next to `layout` in `runDoctor` — not a separate
`genesis check` command. Rec: one group.
**A2** [decision] New rules warn by default; `--strict` makes them errors, so no app's build
breaks on upgrade — not errors from day one. Rec: warn.
**A3** [guess] A scan root in `doctor.src` that doesn't exist is the one error: today it
silently checks nothing.
**A4** [decision] Ship the owned-file half first, layout as a second PR — not both at once.
Rec: split.

Reply by ID: ok · n · A2 errors · rest ok
```

Mark replies: `ok`

## Round 3 — checks, then close

```
Round 3 · new K1–K3 · need you: K1–K3

**K1** When a file listed in genesis.lock.json is missing, doctor warns and names
`genesis upgrade`.
**K2** When `doctor.src` names a directory that doesn't exist, doctor errors, even without
`--strict`.
**K3** When an app has edited an owned file, doctor says nothing.

Reply by ID: ok · n · K3 warn · rest ok
```

Mark replies: `ok`. The agent writes the full list — F1–F5, A1–A4, K1–K3 — into the PR
description and the `cli-doctor` entry, then cites IDs as it builds: `feat(doctor): owned-file
drift checks (per A4, K1)`.

## Mid-build

Implementing K1, the agent finds lock entries for optional files that apps are allowed to
delete. That contradicts K1 as written, so the build stops:

```
Round 4 · reopened K1 · need you: K1a
**K1** ✎ When a *required* file listed in genesis.lock.json is missing, doctor warns.
**K1a** [decision] Optional lock entries are skipped — not warned on. Rec: skip.
Built on K1 so far: doctor/structure.ts, test/structure.test.ts (uncommitted).
```
