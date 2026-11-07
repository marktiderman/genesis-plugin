---
type: regex
target: trace
pattern: '^(?=[^\n]*"type": ?"tool_use")(?=[^\n]*graders/)(?=[^\n]*type: tool_used)(?=[^\n]*tool: Skill)(?=[^\n]*min: 0)(?=[^\n]*max: 0)(?=[^\n]*arm: both)[^\n]*standup'
flags: m
---
The agent writes a should-not-fire grader file under `graders/`: a `tool_used` Skill check on the
standup skill with min 0, max 0 and `arm: both` (min defaults to 1, and without `arm: both` a Skill
check isn't scored in a two-arm run). All of it in one tool call (one trace line), with the Write tool or
a shell command, so the skill's own text, which loads as a message rather than a tool call, can't
satisfy it.
