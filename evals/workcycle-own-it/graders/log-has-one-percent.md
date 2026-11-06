---
type: regex
target: { source: file, path: LOG.md }
flags: i
pattern: '1% better[^\n\w]*\n?[ \t]*(?!(none|n/?a|tbd)\b)[a-z"`][^\n]{10,}'
---
The log names a concrete 1% better, not a placeholder.
