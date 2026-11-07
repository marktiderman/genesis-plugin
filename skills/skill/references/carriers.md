# Where context reaches an agent

Pick the carrier by when the agent needs the context and where it runs. Sources: code.claude.com
docs (memory, skills, hooks, sub-agents, plugins, cloud-environments, claude-projects).

| Carrier | Loads | Local | Cloud session | Project thread | Cowork | Use for |
|---|---|---|---|---|---|---|
| Root `CLAUDE.md`, and `AGENTS.md` where the Claude Code version and settings load it (otherwise a `CLAUDE.md` that imports `@AGENTS.md`) | every session start, and again after compaction | ✓ | ✓ | `CLAUDE.md` only | n/a | the few rules an agent must never miss; reviewers read root CLAUDE.md too |
| `.claude/rules/*.md` without `paths` | session start | ✓ | ✓ | root rules only | n/a | always-on rules split by topic |
| `.claude/rules/*.md` with `paths`, nested `CLAUDE.md` | when the agent first touches a matching file | ✓ | ✓ | ✗ | n/a | rules for one area of the code |
| Skill (repo `.claude/skills` or plugin) | its description every turn; the body when it fires | ✓ | repo ✓, plugin via account | via account or Project plugin | via account | procedures and depth |
| Plugin skill with `disable-model-invocation: true` | only when a person types it | ✓ | via account | via Project plugin | via account | commands only a person starts |
| `SessionStart` hook | session start, resume, clear, compact | ✓ | ✓ (repo hooks) | ✗ | n/a | live facts (branch, versions) |
| `SubagentStart` hook | when a subagent starts | ✓ | ✓ | ✗ | n/a | Explore and Plan start without CLAUDE.md |
| `PreToolUse` hook / `permissions.deny` | before a tool call | ✓ | ✓ | deny rules: ✗ | n/a | rules the agent's own tool calls must never break. They check tool calls only: a script the agent runs can still open the file, so a real boundary needs the sandbox's file and network limits |
| Subagent `skills:` frontmatter | the full skill at the subagent's start | ✓ | ✓ | ✗ | ✓ | a reviewer that must know a method |
| CI check | on the events its workflow names (here: pull requests, and pushes to `main`) | always | always | always | always | the gate every merge passes |

Rules of thumb:
- **Must never be missed:** root CLAUDE.md, kept short. Keep the rules in AGENTS.md if other tools read it too, and have CLAUDE.md import it with `@AGENTS.md`, so they load whatever the version or settings.
- **Depth:** a skill.
- **Zero exceptions for tool calls:** a deny rule or a hook. A real security boundary also needs the sandbox.
- **Enforced before merge:** CI on pull requests.
- **To test injected context, forbid tools:** otherwise the agent's own file search hides whether the context arrived.
