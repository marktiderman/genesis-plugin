---
name: align
description: >-
  The alignment check — layered assertions with stable IDs, settled band by band from framing
  down to tuning, verified or clarified by ID until both sides hold the same worldview. Use before
  a build that could be read more than one way, when the user asks for an "alignment check" or
  says "align" or "let's get aligned", when the user hands you a numbered list of intent or
  decisions to verify, and when work in progress contradicts a verified line.
---

# Align — the alignment check

An alignment check is a set of **assertions** in progressive order: foundational framing first,
fine tuning last. Together they build one worldview — what we're making, for what outcome, and
how. The other party answers by ID. Repeat until every line is ✓.

Run it as a **refraction**. An eye doctor settles the big lens first (-1.00 or -2.00? -2.00 or
-3.00? → -2.00), then tests the next lens *through* it (-2.00 alone, or plus -0.50?). Each lens
is judged through every lens settled above it, and the patient only ever compares two options at
a time. The check works the same way: one band at a time, each line a pick between two lenses,
each band read through the bands already settled.

## Lines

Every line is one assertion with a stable ID, a tag, and, for decisions, the lens test:

```
**F2** [decision] Coaches are the user; clients only see what a coach shares — not a client-facing app. Rec: coaches.
**A3** [fact] Coaches can already invite clients by email (src/invites/send.ts:41).
**A4** [guess] Sharing reuses that invite flow — not a new permission model.
```

- **IDs are permanent.** The letter is the band, the number is its order: `F2`, `A7`. A line
  inserted later becomes `A7a`. A dropped line shows as `~~A9~~` for one round, then leaves. IDs
  are never reused, so "per A7" means the same thing in a commit next month. Write IDs in bold,
  not as a markdown `1.` list, which chat apps renumber.
- **Tags:** `[fact]` is something you verified yourself: one line, plus its evidence; it needs no
  ✓, only a challenge. `[decision]` is a call that belongs to the human. `[guess]` is your best inference
  and draws the eye. Settle every fact yourself before asking — the human's attention goes to
  decisions and guesses.
- **The ✗ test.** A reasonable reader could mark the line ✗. A line that only restates the
  request is filler: sharpen it into a pick or cut it.
- **The lens test.** Every framing and approach decision names its rejected alternative
  (`X — not Y`) and your recommendation (`Rec:`). The alternative you'd have dismissed is the
  one most worth showing. When a line has no clear two-way pick, run `/1-3-1` on it and assert
  the call.
- **Nesting.** Each line refines the lines above it and lives inside them. When two lines
  conflict, put the conflict to the human as a pick between them, quoting both IDs.

## Bands

| Band | Holds | Typical size |
| --- | --- | --- |
| **F** Framing | what the work *is*: purpose, outcome, who it serves, scope and non-scope | 3–6 |
| **A** Approach | how it gets built: the shape of the solution, the big technical calls | 3–8 |
| **C** Constraints | what this work must and must not do | 0–6 |
| **K** Checks | acceptance criteria, each one testable: "When X, then Y" | 2–6 |
| **T** Tuning | details, naming, defaults | 0–8 |

Size the check to the cost of a misread. A task you could describe as a one-sentence diff gets
two or three lines in one round. A task where a misread costs more than an hour gets every band.

**What binds.** Standing rules — CLAUDE.md, AGENTS.md, repo conventions, safety rules — always
bind and stay off the list. The list holds every closed decision, constraint, and criterion
*specific to this work*; one that's missing from the list doesn't bind it. A standing rule goes on
the list when this work bends it, or when it leaves a real choice about how to satisfy it (a new
registry entry or an edit to an existing one).

## The rounds

1. **Gather.** Read until you can write the framing band without guessing at it: the request,
   the code, prior decisions, the project's docs. Look up every fact you'd otherwise ask about.

2. **Send one band.** Round 1 is the framing band alone. Open with a header line, then the
   band, then the reply grammar:

   ```
   Round 1 · Framing · need you: F1–F4
   …lines…
   Reply by ID: ok · n · F2 coaches · rest ok
   ```

3. **Read the reply.** `ok`, `y`, `lgtm` → every open line ✓. `rest ok` → every line not named
   ✓. An ID with text replaces that line; an ID with just the
   rejected alternative (`F1 folder layout`) picks it, and you rewrite the line around it. `n` or `✗` on an ID → it's wrong; propose the
   replacement next round. In a partial reply, unnamed lines stay open and carry forward.

4. **Fold it in and send the next round.** A changed line reopens every line below it that it
   frames; lines above it stay settled. Send only what's open — changed lines, reopened lines,
   and the next band — and collapse the rest:

   ```
   Round 2 · changed F2 · new A1–A5 · need you: F2, A1–A5
   **F2** ✎ Coaches and their admins are the user — not coaches alone. (was: coaches)
   Settled: F1, F3, F4
   …A band…
   ```

5. **Close.** When every band is ✓, write the full list once, in order, with every ID, and save
   it wherever this project keeps decisions: the PR description, a decision log, the issue.
   In plan mode, the verified list is the plan. Build against it, and cite IDs in commits and PR
   notes ("per A4").

## When they hand you a list

Run the same check in reverse. Answer every ID with ✓ or a replacement assertion. Flag a tuning
line that sits above the framing it depends on. Mark any line you can disprove from the code as
✗ with the evidence.

## When the work contradicts the list

A finding mid-build that fits inside the verified lines goes on the list as `✎` when you close
the work. A finding that contradicts a verified line stops the build: run a round on that line
and every line it frames, naming the commits and files already built on them. The human can do
the same at any time with `reopen F3`.

## Notes

- When three rounds haven't converged, the disagreement sits higher than where the edits are
  landing. Reopen the framing band.
- A sketch can ride alongside a band — a tree, a table, a Mermaid diagram, a mock terminal — when
  a shape is faster to verify by eye. The lines stay the contract.
- Alignment artifacts are disposable: lists, docs, sketches, mocks. Show intent with those, and
  keep migrations, merges, deploys, and sends for after the list is ✓.
- A worked example of a full check, round by round: [example.md](example.md).
