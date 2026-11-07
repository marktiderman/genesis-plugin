---
type: regex
target: last_message
flags: i
pattern: '##\s*recommendation(?:(?!\n#{1,2}\s)[\s\S]){0,1500}$'
---
The last section is the recommendation: no `#` or `##` heading follows it.
