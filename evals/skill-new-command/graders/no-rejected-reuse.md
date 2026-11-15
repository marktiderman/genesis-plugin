---
type: regex
target: last_message
flags: i
pattern: '\b(?:don''?t|do not|not|never|no need to|rather than|instead of|without|avoid|skip)\s+(?:\w+\s+){0,2}(?:reuse|extend)'
match: false
weight: 2
---
The answer doesn't turn reuse down ("do not reuse `/review`, create a new skill"). Paired with
reuses-review, which needs the recommendation to reuse or extend the named review skill.
