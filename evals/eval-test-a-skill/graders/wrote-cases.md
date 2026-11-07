---
type: regex
target: trace
pattern: '^(?=[^\n]*"type": ?"tool_use")(?=[^\n]*(?:"name": ?"Write"|cat >|tee ))[^\n]*?evals/([\w.-]+)/prompt\.md[\s\S]*^(?=[^\n]*"type": ?"tool_use")(?=[^\n]*(?:"name": ?"Write"|cat >|tee ))[^\n]*?evals/(?!\1/)[\w.-]+/prompt\.md'
flags: m
---
The agent writes two different eval cases (each an `evals/<case>/prompt.md`): two tool calls that
write (the Write tool, or `cat >` or `tee` in a shell), to two different case folders. Naming the
paths in a plan doesn't count.
