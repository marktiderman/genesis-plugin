---
name: workcycle
description: >-
  How to carry a piece of work from an idea to merge-ready: state a hypothesis, run the smallest
  experiment that tests it, record what you learned, change the work, and run it again until the
  result is right. Use when you own an initiative, a feature or a fix end to end, when the user
  says "loop until it's done", "own this", "work cycle", or "hypothesis, experiment, learn", and
  whenever a change needs proof that it works rather than a claim.
---

# Work cycle: hypothesis → experiment → learn → change, until it's right

You own the outcome, not the first attempt. Keep looping until the work is merge-ready.

## The loop

1. **Hypothesis.** One sentence: "If we <change>, then <measurable result>." Name what would
   prove it wrong.
2. **Experiment.** The smallest real test of it: a run, an eval, a fresh agent, a user's real
   task. Prefer a real specimen to a reading of the code. For agent setups (skills, rules,
   hooks), use `/genesis:eval`.
3. **Learn and debrief.** Write what happened, with evidence (a file:line, a score, a
   transcript), and the one 1% better, in the cycle's log. Say plainly when the hypothesis
   failed.
4. **Change.** Fix what the evidence points at. A design choice goes through `/genesis:1-3-1`.
5. **Repeat** from 1 with the next hypothesis, until the done check passes. If a required check
   or the independent review can't run, stop: report the blocker and what is still unverified,
   and don't call the work merge-ready.

## Done check (merge-ready)

- The outcome the owner asked for is met, and a fresh run proves it.
- Tests, evals and the repo's own checks pass.
- An independent review (`/genesis:review`) found nothing open, or each finding is answered.
- The learnings log and the PR say what changed and why.
- `/genesis:debrief` names the one 1% better for next time.

## Learnings log

Keep one file per initiative. Number each entry, and keep it short:

```
## L<n> <date>: <one-line result>
Hypothesis: …
Experiment: … (command, case, or task)
Result: … (evidence)
Change: … (what you did about it)
```

## Rules

- **Simplest design that reaches the outcome.** Add complexity only when a result shows the
  simpler version can't get there.
- **Prove by hand before automating.** Automate a check only after it has caught something real.
- **Verify before you claim.** Every "done" or "works" cites the run that shows it.
- Ask the owner only for decisions that are theirs: product direction, merges to `main`, money,
  anything irreversible. Everything else, decide, record and keep going.
