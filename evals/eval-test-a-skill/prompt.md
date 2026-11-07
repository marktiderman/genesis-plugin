---
description: Someone wrote a skill and asks whether it works. The agent should write eval cases (a natural trigger and a should-not-fire case) with deterministic graders, not just read the skill and say it looks fine.
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Write, Glob, Grep, Skill]
---
I wrote this skill for my plugin; it goes in `skills/standup/SKILL.md`. Does it work? Test it properly.

---
name: standup
description: Write a daily standup from recent git commits. Use when the user asks for a standup, "what did I do yesterday", or a status update.
---
Read `git log --since=yesterday`, group the commits by area, and write three lines: Yesterday, Today, Blockers.
