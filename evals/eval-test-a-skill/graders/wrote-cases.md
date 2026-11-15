---
type: tool_used
tool: Write
input_match: '"file_path"\s*:\s*"[^"]*evals/[\w.-]+/prompt\.md"'
min: 2
---
The agent writes at least two eval cases with the Write tool: two Write calls whose `file_path` is
an `evals/<case>/prompt.md`. Only the path is matched, so a plan that mentions case paths doesn't
count. Whether the two are different cases is checked by reading the run.
