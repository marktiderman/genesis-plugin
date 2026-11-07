---
type: tool_used
tool: Write
input_match: '(?=[\s\S]*"file_path"\s*:\s*"[^"]*/graders/[^"]*")(?=[\s\S]*type: tool_used)(?=[\s\S]*tool: Skill)(?=[\s\S]*\bmin: 0)(?=[\s\S]*\bmax: 0)(?=[\s\S]*standup)'
---
The agent writes a should-not-fire grader file under `graders/`: a `tool_used` Skill check on the standup skill with min 0 and max 0 (min defaults to 1, so both must be set).
