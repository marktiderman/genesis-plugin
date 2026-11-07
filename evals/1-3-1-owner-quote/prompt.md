---
description: A decision where the owner's own words are given. Test 4 must quote them, not paraphrase or invent.
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---
Our app's settings live in three files today. The owner said: "I want one config file in each repo that inherits defaults and overrides them as needed; with no file you get all the defaults." Should we merge the three files into one, keep three with a shared loader, or move settings into environment variables? Make the call.
