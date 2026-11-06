---
type: regex
target: last_message
flags: i
pattern: 'required[^.]{0,200}default|default[^.]{0,200}required'
weight: 2
---
Step 1 makes every key required while step 2 says a missing file gets defaults. Triage must surface it.
