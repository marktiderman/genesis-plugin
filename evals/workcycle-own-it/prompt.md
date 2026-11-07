---
description: An owner hands over a small piece of work end to end. The agent should state a hypothesis, test it for real, record what it learned with a 1% better, and loop until it works.
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Write, Edit, Bash, Glob, Grep, Skill]
---
Own this until it's done. Write `slug.js` exporting `slug(text)` that turns "Hello, World!  Again" into "hello-world-again" (lowercase, words joined by single hyphens, no punctuation, no leading or trailing hyphens). Prove it works with a small test you run, and keep a short log of what you tried and learned in `LOG.md`.
