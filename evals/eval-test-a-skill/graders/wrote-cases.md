---
type: regex
target: trace
pattern: 'evals/[\w.-]+/prompt\.md[\s\S]*evals/[\w.-]+/prompt\.md'
---
The agent writes at least two eval cases (each an `evals/<case>/prompt.md`), with the Write tool or
a shell command. The trace is read, so either way counts.
