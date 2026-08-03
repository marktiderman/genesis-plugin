---
name: align
description: >-
  The alignment loop — reflect the human's intent back in your own words with a concrete sketch,
  then drive to a fast yes/no before building. Use before starting any non-trivial build, when
  a request could be read more than one way, or when the user says "align", "is this what you
  mean", "reflect it back", "let's make sure we agree", or asks you to confirm understanding.
  Optimize for the shortest path to a clear yes or no.
---

# Align — reflect it back, get a fast yes/no

Say the idea back in your own words with a simple picture, and ask "is this it?" The sooner the
human can say **yes** or **no**, the faster everyone moves. Shared understanding beats speed,
because building the wrong thing quickly is the slowest path there is.

## The loop

1. **Restate in your own words.** Short and concrete. Show you understood — don't parrot the
   request back with synonyms. If you can't restate it, you don't have it yet.

2. **Draw it.** The cheapest artifact that conveys the shape: an indented tree, a table, a
   Mermaid diagram, a two-line user story, a fake terminal output, a rough wireframe. Match the
   medium to the idea, and notice which media earn faster yeses.

3. **Separate decided from open.** Say plainly what you've taken as settled and what still needs
   their call. Buried assumptions are where misalignment hides.

4. **Ask a crisp yes/no.** Or a numbered pick. Never an open "thoughts?" when a yes/no will do.
   Bundle a few questions if you must, but keep each answerable in seconds.

5. **Never stall on "I don't know."** Always bring a concrete proposal to react to. A specific
   wrong guess the human can correct beats a vague question they have to do work to answer.

6. **Capture the verdict** wherever this project keeps decisions, and iterate until yes.

## Notes

- One pass is fine when it's obvious; expect several when it isn't. Cheap iterations are the
  point — don't try to get it right in one shot.
- **Alignment artifacts are disposable.** Docs, sketches, and mocks only. Never make an
  irreversible change — a migration, a merge, a deploy, a send — to "show" someone what you mean.
- When you've had three passes without converging, the problem is usually the framing, not the
  drawing. Back up and restate the problem instead of redrawing the solution.
