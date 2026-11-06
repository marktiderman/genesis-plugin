---
type: regex
target: last_message
flags: i
pattern: 'no (owner |direct )?quote|missing|not stated|needs (the owner|your|a human)|ask (the owner|you)'
weight: 2
---
The prompt gives no owner quote, so the intent test must say so instead of inventing one.
