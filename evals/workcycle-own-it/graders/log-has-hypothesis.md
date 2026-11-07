---
type: regex
target: { source: file, path: LOG.md }
flags: i
pattern: 'hypothesis[^\n\w]*\n?[ \t]*(?!(none|n/?a|tbd)\b)[a-z"`][^\n]{10,}'
---
The log states a real hypothesis, not a placeholder.
