# Genesis

Surgical, portable skills for agent-built software.

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
| `/1-3-1` | ONE problem → THREE distinct options → pros and cons → ONE recommendation. |
| `/align` | Reflect intent back with a concrete sketch and drive to a fast yes/no before building. |
| `/debrief` | Close a work cycle in four lines with one concrete 1% improvement. |
| `/map` | Extract every screen a codebase has into rows, joined to hand-written features, verify authored flows against them, and fail a build when the map stops being true. |

Skills are model-invoked — Claude reaches for them when the situation fits. You can also call them directly by name.

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

Every skill here has to earn its place against five rules. They exist because the alternative — skills accreting until nobody knows what's in the box — is the failure mode this repo was built to escape.

Invoke a bundled script by plugin root, never by a repo-relative path:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/<skill>/scripts/<script>.mjs"
```

`${CLAUDE_PLUGIN_ROOT}` resolves anywhere in skill content. A relative path works only when the cwd happens to be this repo, which it never is once the plugin is installed.

## Contributing

Open an issue describing the decision, alignment, or reflection problem you keep hitting. Skills here come from repeated real friction, not from speculation about what might be useful.

## License
MIT
