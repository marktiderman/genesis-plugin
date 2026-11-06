# Genesis

Surgical, portable skills for agent-built software.

## Install

```bash
/plugin marketplace add marktiderman/genesis-plugin
```

```bash
/plugin install genesis@genesis
```

## Updates

The plugin sets a `version`, so you stay on a release until the next one is published. Claude Code
turns auto-update **off** for marketplaces outside Anthropic's own, so turn it on once: in
`/plugin`, open the **Marketplaces** tab, select `genesis`, and choose **Enable auto-update**. Or
set it in settings (below). New releases then install in the background and load at your next
launch. To update by hand, run `/plugin update genesis@genesis`.

## Skills

| Skill | What it does |
| --- | --- |
| `/genesis:1-3-1` | ONE problem → THREE distinct options → the six tests → ONE recommendation. |
| `/genesis:align` | Reflect intent back with a concrete sketch and drive to a fast yes/no before building. |
| `/genesis:debrief` | Close a work cycle in four lines with one concrete 1% improvement. |
| `/genesis:map` | Extract every screen a codebase has into rows, joined to hand-written features, verify authored flows against them, and fail a build when the map stops being true. |
| `/genesis:workcycle` | Own work to merge-ready: hypothesis → experiment → learn → change, looped, with a learnings log. |
| `/genesis:eval` | Prove an agent setup works on fresh agents (loads, triggers, followed, right outcome), with a run log. |
| `/genesis:review` | Independent adversarial review by several agents (five 1% changes and three 10x upgrades each, every claim cited), then a verified triage. |

Each skill runs as `/genesis:<name>`, where `<name>` is the `name` in its `SKILL.md` frontmatter.
Claude also reaches for a skill on its own when the situation matches its description.

## Enable it for a project

Add to the project's `.claude/settings.json` so it's on, and kept current, for anyone who works
there:

```json
{
  "extraKnownMarketplaces": {
    "genesis": {
      "source": { "source": "github", "repo": "marktiderman/genesis-plugin" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "genesis@genesis": true }
}
```

A cloud session doesn't install plugins from a repository's settings. To have these skills there
and in Cowork, also add the plugin to your claude.ai account.

## Scripts and tools

A skill that needs to do the same work identically every run calls a script instead of asking the
model to redo it. Invoke a bundled script by plugin root, never by a repo-relative path:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/<skill>/scripts/<script>.mjs"
```

`${CLAUDE_PLUGIN_ROOT}` resolves anywhere in skill content. A relative path works only when the cwd
happens to be this repo, which it never is once the plugin is installed. A tool that CI also runs
ships as an npm package (`@marktiderman/genesis-map`); CI pins an exact version.

## Evals

`evals/` holds one case per skill behaviour that matters, built from real decisions and reviews.
Run them with `claude plugin eval .` from the repo root. Each case runs with and without the
plugin, so the score shows what the plugin adds. Runs are billed model calls.

## Contributing

Open an issue describing the decision, alignment, review or reflection problem you keep hitting.
Skills here come from repeated real friction, not from speculation about what might be useful.

## License
MIT
