# Genesis

Surgical, portable process skills for agent-built software.

Small skills that do one thing, work in any repository, and depend on nothing but the model.
No scripts to install, no CLI, no config, no assumptions about your project's shape.

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

Every skill here has to earn its place against four rules. They exist because the alternative —
skills accreting until nobody knows what's in the box — is the failure mode this repo was built
to escape.

1. **Runs anywhere.** No dependency on this or any other repository's layout, data, or conventions.
   Proven by running it in a repo that knows nothing about Genesis, not by reading it and assuming.
2. **No external dependencies.** No scripts, no binaries, no MCP servers, no `gh`. If a skill needs
   a tool installed to work, it belongs somewhere else.
3. **Under ~60 lines.** Longer means it's doing more than one thing. Split it or cut it.
4. **One clear purpose**, with a description that says exactly when to invoke it.

A skill that can't pass all four doesn't go in.

## Contributing

Open an issue describing the decision, alignment, or reflection problem you keep hitting. Skills
here come from repeated real friction, not from speculation about what might be useful.

## License

MIT
