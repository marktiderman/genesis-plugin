---
name: 1-3-1
description: >-
  Use before making any choice between approaches: when asked "should we X or Y", "which
  approach", "make the call", "what do you recommend", "give me options", "1-3-1", or when you are
  about to pick a design, an architecture, where code or content lives, an API shape, a data
  model, a migration or a tool. Lays out ONE problem, THREE real options and the six tests
  (upstream, greenfield best practice, three real options, the owner's intent, could it be
  simpler, reuse then extend then invent), then ONE recommendation, last.
---

# 1-3-1 — one problem, three options, one call

Don't take the obvious option because it arrived first. Run 1-3-1.

## Write your answer in this shape, in this order

Even when asked to "make the call", don't state the call first. The reader needs the tests to
trust it.

```
## The problem
<one sentence, at its source>

## Options
1. <name>: how it works, its cost, its risk, who it serves
2. <name>: …
3. <name>: …

## The six tests, for the option I recommend
1. Upstream: <the root cause it removes, or "missing: …">
2. Greenfield best practice: <the primary source or standard pattern, or "missing: …">
3. Three real options: <why each option actually solves the problem>
4. Owner's intent: <their words, quoted. If you have none, write "no quote from the owner;
   this needs their call". Never invent it.>
5. Could it be simpler: <the simpler option, and why it does or doesn't reach the outcome>
6. Reuse, extend, invent: <what it reuses, extends and invents>

## Recommendation
<the option, and which advantage outweighs which disadvantage>
```

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
the call fails a test, the decision is not ready: keep working on the options until it passes
every test, or say plainly what evidence is still missing. Passing is not always a "yes": "no
simpler option exists" passes test 5, and an invention passes test 6 when reuse and extension
were tried and ruled out, it is invented in the app first with the reason stated, and it recreates
nothing that exists or should exist upstream.

1. **Upstream, not duct tape.** Does it solve the problem at its source, or does it patch
   downstream because the existing code happens to be shaped a certain way? Name the root cause it
   removes. A fix that only exists because of today's implementation is a symptom of the problem.
2. **Greenfield best practice.** If you were building this fresh, is this how it would be done?
   Ground it in primary sources — the platform's own docs, the standard pattern for this kind of
   system — not in habit or in what the codebase already does. Judge the target design, not the
   path to it: a backfill, a dual write or a staged cutover that only exists to move today's data
   doesn't fail this test, as long as it is temporary and has an end.
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
  to reconstruct _why_ later, including the options you rejected. Post to a shared record (an
  issue, a PR) only when your task already covers that or the owner agrees; otherwise give the
  decision in your reply.
- **Execute it.** A documented decision that stalls waiting for approval is a blocked decision.
  If you have the authority, make the call and keep moving — the written trail is how the owner
  stays in the loop without becoming a bottleneck, and any call can be reversed.
- **Escalate only when the options differ in a way you can't resolve** — when they trade off
  values rather than facts, or when being wrong would be expensive and hard to undo.

## Why three

Two options is a yes/no in disguise, and you've usually already picked. Three forces you past the
first instinct into the space where the better answer actually lives. Aim small on the problem,
think wide on the options, then commit.
