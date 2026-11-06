# Eval runs

One row per run. Newest last. With / without are case scores (0–1); Δ = with − without.

| # | Date | Commit | Case | Hypothesis | With | W/out | Δ | Cost | Learned | 1% better |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-06 | a809e56 | review-adversarial | The skill writes the target, runs 3 reviewers, catches the planted flaw, triages | 1.00 | 0.60 | +0.40 | $0.88 for both | Without it, agents still review but skip writing the target and the triage shape | Keep triage as the skill's core |
| 1 | 2026-11-06 | a809e56 | 1-3-1-decision | The skill fires on "make the call" and answers the six tests | 0.33 | 0.00 | +0.33 | $0.88 for both | Never fired: the description led with what it is, not when to use it | Lead descriptions with triggers |
| 2 | 2026-11-06 | e3e70c4 + description rewrite, folder renamed to `1-3-1` | 1-3-1-decision | A trigger-first description makes it fire | 0.26 | 0.00 | +0.26 | $0.53 | Fires 3/3, but writes "My call" first and skips the tests; the required shape was buried at the bottom | Put the output template first |
| 3 | 2026-11-06 | e3e70c4 + output template | 1-3-1-decision | A template at the top makes agents keep the shape | 1.00 | 0.04 | +0.96 | $0.55 | The template fixed it: all tests answered, no invented intent, recommendation last | Templates beat prose for required shapes |
| 4 | 2026-11-06 | e3e70c4 + template | 1-3-1-owner-quote | Given the owner's words, test 4 quotes them | 1.00 | 0.67 | +0.33 | $0.51 | Quotes the owner 3/3; without the skill the recommendation still comes first | — |
| 5 | 2026-11-06 | e3e70c4 + template | 1-3-1-no-trigger | It stays quiet on a rename | 1.00 | 1.00 | 0.00 | $0.28 | No false trigger | — |
| 6 | 2026-11-06 | e27d921 + workcycle case | workcycle-own-it | Owning a small task, the agent keeps a log with hypothesis and 1% better, and runs a real test | 1.00 | 0.33 | +0.67 | $1.48 | Without the skill agents do the work and test it, but write no hypothesis or 1% better | — |

Rows 2–5 ran on uncommitted edits on top of e3e70c4; those edits were committed in e27d921. The exact working tree each row measured was not saved.

Install probe (`evals/install-probe.sh`), 2026-11-06, branch `claude/review-skill-and-evals`: marketplace add from the branch, install, load all passed; skills listed in a fresh session. The probe's own agent step needs a signed-in profile, so behaviour is proven by the evals above instead.
