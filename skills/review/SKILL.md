---
name: review
description: >-
  Adversarial review by several independent agents, then a verified triage of what they bring
  back. Use when the user asks to "review this adversarially", "have N agents review", "poke
  holes", "how could this be better", "1% better and 10x", or "triage the findings", and when an
  owner asks for an independent review of a plan, design, report or change before deciding on it.
argument-hint: "[adversarial|triage] [reviewers] [target]"
---

# Review: independent eyes, then a verified triage

Two modes. `adversarial` (the default) runs the reviewers and then triage. `triage` runs only the
second half on findings you already have.

## adversarial

1. **Name the target.** A file, a PR, a diff. If the work exists only in the conversation, write it
   to a file first: reviewers review something concrete, never a chat.
2. **Spawn the reviewers in parallel** (default 3), as independent subagents that did not write the
   target, in one message. Give each the brief in `references/reviewer-brief.md` and nothing that
   steers it: no list of concerns, no favoured answer.
   Explore and Plan subagents start without this repo's CLAUDE.md, so use a general-purpose agent.
3. Each reviewer brings back exactly **five 1% better changes** and **three 10x upgrades**, each
   with what to change, why, and the file:line or URL it checked.
4. Run **triage** on everything they return.

## triage

Follow `references/triage.md`. In short:

1. **Verify every claim** against the source it cites before you keep it. Drop what fails, and say
   which ones and why.
2. **Merge duplicates**, and note when reviewers found the same thing independently.
3. **Split** corrections of fact (fix them in the target now) from proposals (the owner decides).
4. **Don't cap the list.** Bring back every proposal worth the owner's time, each in one or two
   plain sentences.
5. **Ask** the owner which proposals to adopt. Change nothing they haven't approved.
