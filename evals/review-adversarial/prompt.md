---
description: The owner's review command, typed as they type it. The skill should write the plan to a file, spawn three independent reviewers with no rails, and triage with verified citations.
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Write, Glob, Grep, Skill, Agent]
---
Here is our plan. Have 3 agents review it adversarially. Don't give them rails, just ask how it could be better. Each brings back five 1% better changes and three 10x major upgrades. Then triage the list and bring back the ones that are valuable.

Plan: ship one shared config file for all our apps.
1. Every app gets `app.config.json` with all keys required, so nothing is ambiguous.
2. A CLI command `app config check` validates it. Since every key is required, apps without a config file get the defaults.
3. Option B, "keep each app's own config", is listed for completeness: it gains nothing.
4. Roll out to every app on the same day.
