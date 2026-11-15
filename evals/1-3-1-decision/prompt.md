---
description: A real design decision with no owner quote in the prompt. The skill should produce three real options, answer all six tests with evidence or "missing", refuse to invent the owner's intent, and recommend last.
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---
We maintain a framework published as several npm packages, plus a Claude Code plugin of shared skills. Each package needs instructions for the coding agents that build apps with it (which component to use, its import, its rules). Should those package instructions ship inside each npm package (our CLI copies them into the app's .claude/skills on install and upgrade) or inside the shared plugin? Make the call.
