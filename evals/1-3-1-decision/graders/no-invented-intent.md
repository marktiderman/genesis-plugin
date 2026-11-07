---
type: regex
target: last_message
flags: i
pattern: '(intent|owner)[^\n]{0,300}(no (owner |direct )?quote|missing|not stated|needs (the owner|your|a human)|ask (the owner|you))'
weight: 2
---
The prompt gives no owner quote, so the intent test must say so, on its own line, instead of inventing one.
