# Genesis

Surgical, portable skills for agent-built software.

Small skills that do one thing, work in any repository, and make no assumptions about your
project's shape. Some are pure instruction; some bundle a script. Neither needs installing — a
skill's `scripts/` directory travels with the plugin.

## Install

```bash
/plugin marketplace add marktiderman/genesis-plugin
```

```bash
/plugin install genesis@genesis
```

Updates reach you automatically. This plugin sets no `version` field, so every commit is a new
version — pull the latest at any time with `/plugin update genesis@genesis`.

## Skills

| Skill | What it does |
| --- | --- |
| `/genesis:one-three-one` | ONE problem → THREE distinct options → pros and cons → ONE call. Forces past the first instinct on any non-trivial decision. |
| `/genesis:align` | Reflect intent back with a concrete sketch and drive to a fast yes/no before building. |
| `/genesis:debrief` | Close a work cycle in four lines with one concrete 1% improvement. |
| `/genesis:map` | Extract every screen a codebase has into rows, joined to hand-written features, verify authored flows against them, and fail a build when the map stops being true. |

Skills are model-invoked — Claude reaches for them when the situation fits. You can also call
them directly by name.

## Enable it for a project

Add to the project's `.claude/settings.json` so it's on by default for anyone who works there:

```json
{
  "extraKnownMarketplaces": {
    "genesis": { "source": { "source": "github", "repo": "marktiderman/genesis-plugin" } }
  },
  "enabledPlugins": { "genesis@genesis": true }
}
```

## The standard

Every skill here has to earn its place against five rules. They exist because the alternative —
skills accreting until nobody knows what's in the box — is the failure mode this repo was built
to escape.

1. **Runs anywhere.** No dependency on this or any other repository's layout, data, or conventions.
   Proven by running it in a repo that knows nothing about Genesis, not by reading it and assuming.
2. **Nothing to install.** No binaries, no MCP servers, no `gh`, no package manager. A bundled
   script counts as nothing to install — it ships with the plugin — provided it uses only the
   runtime's built-ins. The moment it needs a dependency tree, it belongs somewhere else.
3. **A bundled script is for extraction or verification** — work a model shouldn't redo by hand
   every run, or be trusted to redo identically. It ships with fixture tests that run in CI, and
   its SKILL.md states plainly what the script cannot see. A tool that quietly misses things is
   worse than no tool, and only the author knows where the edges are.
4. **Under ~60 lines of instruction.** Longer means it's doing more than one thing. Split it or cut
   it. Documenting a script's limits doesn't count against this — that text is a warning label.
5. **One clear purpose**, with a description that says exactly when to invoke it.

A skill that can't pass all five doesn't go in.

Invoke a bundled script by plugin root, never by a repo-relative path:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/<skill>/scripts/<script>.mjs"
```

`${CLAUDE_PLUGIN_ROOT}` resolves anywhere in skill content. A relative path works only when the
cwd happens to be this repo, which it never is once the plugin is installed.

## Contributing

Open an issue describing the decision, alignment, or reflection problem you keep hitting. Skills
here come from repeated real friction, not from speculation about what might be useful.

## License

MIT
