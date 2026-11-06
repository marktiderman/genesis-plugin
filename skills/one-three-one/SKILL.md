---
name: 1-3-1
description: >-
  The 1-3-1 decision framework — ONE clear problem, THREE distinct options, advantages and
  disadvantages of each, ONE recommendation and the call. Use when facing any non-trivial
  decision: a fork in the approach, a contradiction between requirements, a tradeoff with no
  obvious winner, or whenever you catch yourself about to take the first option that came to
  mind. Also use when the user says "1-3-1", "give me options", "what are the alternatives",
  or asks you to make a judgment call. Use it for every design or architecture decision — data
  model, service boundaries, where code runs, refactor scope, API shape, migration strategy —
  and run its six tests before bringing the call to anyone.
---

# 1-3-1 — one problem, three options, one call

Don't take the obvious option because it arrived first. Run 1-3-1.

## The framework

1. **ONE problem.** State the decision crisply, in a sentence. If you need two sentences joined
   by "and", it's two decisions — run 1-3-1 on each.

2. **THREE options.** Generate at least three genuinely distinct approaches. One is usually
   obvious. The second takes effort. **The third is where the creativity lives** — forcing it is
   the entire point of the framework. If your third option is a strawman, you haven't found it yet.

3. **Advantages and disadvantages.** For each option, honestly. An option with no downsides means
   you haven't understood it. An option with no upsides shouldn't be on the list.

4. **ONE call.** Your recommendation, and the reasoning: which advantage outweighs which
   disadvantage, and why. Not a survey — a decision.

## The six tests (every design decision)

Before you bring the call to anyone, answer each of these about it, explicitly and in writing. If
any answer is "no", the decision is not ready: keep working on the options until every answer is
"yes", or say plainly what evidence is still missing.

1. **Upstream, not duct tape.** Does it solve the problem at its source, or does it patch
   downstream because the existing code happens to be shaped a certain way? Name the root cause it
   removes. A fix that only exists because of today's implementation is a symptom of the problem.
2. **Greenfield best practice.** If you were building this fresh, is this how it would be done?
   Ground it in primary sources — the platform's own docs, the standard pattern for this kind of
   system — not in habit or in what the codebase already does.
3. **Three real options.** Does each option actually solve the problem? A straw man that exists to
   make the favourite look good doesn't count. If you can only find one real option, the problem
   is probably stated too narrowly — restate it at its source.
4. **User value and the owner's intent.** Is the call rooted in what the people using the product
   need, or in what the owner said they want? Quote their words where they exist. "Easiest from
   where the code is today" is not a reason.
5. **Could it be simpler?** Is there a simpler solution that reaches the same outcome? If there is,
   add it as an option (a fourth one is fine) and weigh it honestly. Fewer moving parts usually
   wins.
6. **Reuse, then extend, then invent.** Can the call reuse what already exists (a framework
   primitive, a declared row, a component, a provider) configured as it is? If not, can it extend
   one through its extension points (a variant, a slot, a key, a wrapper)? Invent only when
   neither fits, invent in the app first, and say why. Never recreate something that exists or
   should exist upstream; a missing piece is a gap to raise there. Name what each option reuses,
   extends and invents.

Write each decision as: the problem at its source → the options (how each works, its cost, its
risk, who it serves) → the six tests answered for the recommended option → the recommendation,
last.

## Then

- **Record it** wherever this project keeps decisions — a decision log, the PR description, an
  issue comment, a commit message. The trail matters more than the venue: someone should be able
  to reconstruct _why_ later, including the options you rejected.
- **Execute it.** A documented decision that stalls waiting for approval is a blocked decision.
  If you have the authority, make the call and keep moving — the written trail is how the owner
  stays in the loop without becoming a bottleneck, and any call can be reversed.
- **Escalate only when the options differ in a way you can't resolve** — when they trade off
  values rather than facts, or when being wrong would be expensive and hard to undo.

## Why three

Two options is a yes/no in disguise, and you've usually already picked. Three forces you past the
first instinct into the space where the better answer actually lives. Aim small on the problem,
think wide on the options, then commit.
