---
type: regex
target: last_message
flags: i
pattern: '(required|default)[^.]{0,200}(contradict|conflict|inconsisten|incompatible|can.?t both|cannot both|doesn.?t follow|does not follow|non.sequitur)|(contradict|conflict|inconsisten|incompatible|non.sequitur)[^.]{0,200}(required|default)'
weight: 2
---
Step 1 makes every key required while step 2 says a missing file gets defaults. Triage must name the conflict, not just mention both words.
