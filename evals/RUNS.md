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
| 7 | 2026-11-06 | 0bb0417 | skill-new-command | Asked to make a skill of a repeated review request, the agent reuses `/genesis:review` and answers in the reuse / extend shape | 0.89 | 0.67 | +0.22 | $1.09 | Reuses review 3/3; one run skipped the reuse / extend headings | — |
| 8 | 2026-11-06 | 0bb0417 | align-before-build | Given an ambiguous request, the agent restates, sketches, and ends with a yes/no instead of building | 1.00 | 0.50 | +0.50 | $0.76 | Every run with the plugin hit the 300 s limit, under heavy machine load (load average about 300), so its score came from partial runs | Give cases room: 600 s |
| 9 | 2026-11-06 | 0bb0417 | debrief-cycle | The debrief keeps four lines, and its 1% is one concrete action | 0.50 | 0.00 | +0.50 | $0.96 | The four lines held 3/3, but every 1% named two actions ("comment the schema, then add a test") | Make the 1% one action in one sentence |
| 10 | 2026-11-07 | 5edea4b | debrief-cycle | One action in one sentence makes the 1% pass | 1.00 | 0.00 | +1.00 | $0.90 | The rule worked 3/3: one action, the second idea moved to Differently | Rules that say "one" need "no and, no or" |
| 11 | 2026-11-07 | a4b490f | align-before-build | With 600 s and Write allowed (so no-build can fail), the yes/no still holds | 0.83 | 0.50 | +0.33 | $0.73 | One run with the plugin ended without the yes/no. 600 s timeouts hit both arms (all three without the plugin), so the case runs long once agents may write | Cap the case's turns rather than raise its time again |
| 12 | 2026-11-07 | a4b490f (graders since changed) | eval-test-a-skill | The agent writes a trigger case and a should-not-fire case | 0.00 | 0.00 | 0.00 | $2.62 | Write was called 0 times in all 6 runs, both arms, and no transcript was kept, so the cause isn't known. A kept run afterwards wrote its cases with Write (and plugin.json with a heredoc) | Keep one transcript per run; grade write calls in the trace |
| 13 | 2026-11-07 | 2490e29 (graders read the trace; tightened after, in f30dfaa and 8e1886f) | eval-test-a-skill | With graders that read every write, the agent writes a trigger case and a should-not-fire case | 1.00 | 0.00 | +1.00 | $3.64 | With the skill, 3/3 runs wrote both cases and the should-not-fire grader; without it, 0/3 | Keep one transcript per run so a zero can be explained |

Rows 2–5 ran on uncommitted edits on top of e3e70c4; those edits were committed in e27d921. The exact working tree each row measured was not saved.

Install probe (`evals/install-probe.sh`), 2026-11-06, branch `claude/review-skill-and-evals`: marketplace add from the branch, install, load all passed; skills listed in a fresh session. The probe's own agent step needs a signed-in profile, so behaviour is proven by the evals above instead.
