---
name: eval
description: >-
  Use when you need proof that an agent setup works: a skill, a plugin, a hook, rules or an
  AGENTS.md change. Triggers: "does this skill work", "test the skill", "eval this", "verify the
  agent setup", "grill the agent", "is it triggering", or before calling any change to agent
  context done. Proves four things with fresh agents (it installs and loads, it triggers, it is
  followed, the outcome is right) and records each run with its hypothesis and debrief.
---

# Eval: prove an agent setup works, with a trail

Never trust a skill because it reads well. Prove it on a fresh agent that has never seen this
conversation, against a baseline without it.

## Write the cases as files, in this layout

Put the suite in `evals/` at the plugin root. One folder per case:

```
evals/<case>/prompt.md            # frontmatter: description, max_turns, timeout_seconds, allowed_tools
                                  # body: the request exactly as a user would type it
evals/<case>/graders/<name>.md    # one check per file, for example:
```

```markdown
---
type: tool_used          # did the skill fire?
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?<skill-name>"'
---
```

```markdown
---
type: tool_used          # in a should-not-fire case: it must stay quiet
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?<skill-name>"'
min: 0
max: 0
arm: both
---
```

```markdown
---
type: regex              # did the output keep the skill's required shape?
target: last_message
flags: i
pattern: '<a part the skill requires>'
---
```

Write the files first, then run them (below). Reading a skill and saying it looks right is not
a test.

## What to prove, in order

| Layer | Question | How |
|---|---|---|
| 1. Loads | Does a clean install load it? | `"${CLAUDE_PLUGIN_ROOT}/evals/install-probe.sh" <branch> <new-out-dir>`, with `PROBE_PLUGIN` (plugin@marketplace), `PROBE_MARKETPLACE` (its repo) and `PROBE_PROMPT` (a request that should trigger the skill under test) for another plugin or skill: an empty Claude Code profile adds the marketplace from the branch and installs, then a fresh agent works the request; the skill loaded only if `transcript.jsonl` shows its `Skill` call |
| 2. Triggers | Does it fire on natural phrasing, and stay quiet when it shouldn't? | `tool_used: Skill` grader; a should-not-fire case with `min: 0, max: 0, arm: both` |
| 3. Followed | Does the output keep the skill's required shape? | `regex` graders on `last_message`, one per required part |
| 4. Outcome | Is the result right and better than without? | the with/without Δ from `claude plugin eval`; for code, the repo's own checker (for example `genesis doctor --json` findings) |

## Grill it: every skill gets at least these cases

- **Natural trigger.** The request as a person would type it, without naming the skill.
- **Should not fire.** A nearby request that doesn't need it.
- **Truth under pressure.** A case where the easy answer is wrong. For example, give the owner's
  real words and check they're quoted, or leave them out and check nothing is invented.
- **The planted flaw.** For review-type skills, a target with one known error that must be found.

Write prompts the way a user types them, and don't spell out the skill's method in the prompt.

## Graders

Prefer the ones that give the same answer every run: `tool_used`, `regex`, `file_exists`. Use
`llm` only for short outputs, with concrete PASS and FAIL lines. Raise `max_turns` and
`timeout_seconds` for skills that spawn agents.

## The loop (one row per run)

1. **Hypothesis.** "If <change>, then <case> scores <X> with and <Y> without."
2. **Run.** `claude plugin eval . --case <name> --runs 3 --allow-tools Bash Write Edit --trust-plugin --no-publish --json <file>`
   (each case runs isolated, with and without the plugin; runs are billed).
3. **Read the failures,** not just the score. Open the run's output and see what the agent wrote.
4. **Record the row** in `evals/RUNS.md`: date, commit, case, hypothesis, with / without / Δ,
   cost, what you learned, and the 1% better. Keep each cell to one line.
5. **Change** what the failure points at, then run again.

Stop when every case passes with the plugin, Δ is positive where the skill should add value, and
the should-not-fire cases stay at zero.

## Rules

- Prove by hand first. Put evals in CI only after they have caught something real.
- One commit per change you test, so each row names the exact version it measured.
- Never claim a skill works without the row that shows it.
