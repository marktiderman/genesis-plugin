---
type: regex
target: last_message
flags: i
pattern: '(?:^|\n)[ \t>*_#|-]*(?:4\.|test 4\b)[^\n]{0,80}intent[^\n]{0,300}["“][^"”\n]{0,200}inherits defaults and overrides them[^"”\n]{0,200}["”]'
weight: 2
---
Test 4 (intent) quotes the owner's words, in a complete quotation on the test-4 line, as given. A quote under another test doesn't count.
