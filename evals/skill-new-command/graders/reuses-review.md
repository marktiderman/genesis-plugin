---
type: regex
target: last_message
flags: i
pattern: '\b(?:reuse|extend)[^\n]{0,120}[/`](?:[\w-]+:)?review\b|[/`](?:[\w-]+:)?review\b[^\n]{0,120}\b(?:reuse|extend)'
weight: 2
---
The plugin's review skill already does this; the answer should recommend reusing or extending it,
naming the skill (`/review`, `` `review` ``, or with a plugin prefix) on the same line as "reuse"
or "extend". A bare "review the plan" doesn't count.
