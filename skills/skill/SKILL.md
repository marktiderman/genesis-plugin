---
name: skill
description: >-
  Use when someone wants a new skill or command, says "make this a skill", "add a command for
  this", "where should this skill live", types the same instructions a second time, or when
  /skill-doctor shows unused or overlapping skills. Decides reuse, extend or invent, where the
  skill lives, and gates it before it ships.
---

# Skills: reuse, then extend, then invent

Count the triggers, not the instructions. Every skill Claude can start on its own puts its
description in context on every turn, and the listing budget is about 1% of the context window,
so fifty overlapping skills crowd each other out and stop triggering.

## Answer in this shape

```
## The need
<what the person keeps asking for, in their words>

## Reuse
<the existing skill that already does it, and how to call it, or "none: <where you looked>">

## Extend
<the closest skill and the mode, trigger phrase or script you'd add, or "none fits: <why>">

## Invent (only if reuse and extend are ruled out)
<name, one-sentence trigger, who starts it (Claude, a person, or both), where it lives>

## Gate
<the eval cases and the review it needs before it ships>
```

## The steps

1. **Reuse.** Search this plugin, the Genesis package guides in `node_modules/@marktiderman/*/SKILL.md`,
   Anthropic's official plugins (`skill-creator`, `code-review`), and the repo's
   `.claude/skills/`. If one does the job, use it as it is.
2. **Extend.** If one is close, add a mode (an argument plus `references/<mode>.md`), a trigger
   phrase in its description, or a script. Most new commands land here.
3. **Invent in the app first.** A new trigger goes in that repo's `.claude/skills/` the second
   time someone types the same instructions. A command only a person starts gets
   `disable-model-invocation: true`, which costs no context until it's used.
4. **Promote** to this plugin when a second repo wants it. Delete the app copy only once that
   app's sessions load the plugin (its `.claude/settings.json` enables it, and a fresh session
   lists the skill), so nobody loses it in between. A skill that must name an app or customer goes
   to a private plugin instead.
5. **Gate the pull request.**
   - The description says when to use it, not what it is.
   - A required output shape goes first, as a template.
   - `SKILL.md` stays under 500 lines, with depth in `references/`.
   - Eval cases cover a natural trigger, a should-not-fire request and a truth-under-pressure
     case (`/genesis:eval`).
   - An independent review signs it off (`/genesis:review`).

   Use Anthropic's `skill-creator` for drafting and description tuning.
6. **Prune** monthly with `/skill-doctor`: retire skills that never fire and merge ones that
   overlap.

Where each kind of context reaches agents (rules, skills, hooks, plugins) is in
`references/carriers.md`.
