# Triage

Triage turns several reviewers' findings into one list the owner can act on. Do it in this order.

## 1. Verify each claim

Open the file:line or URL each finding cites, and confirm it says what the reviewer claims.

- **Holds:** keep it.
- **Wrong:** drop it, and list it under "Dropped" with the reason.
- **Can't be checked:** keep it, marked [UNVERIFIED].

Weigh sources by tier. A doc that claims a decision ("accepted", "ratified", "the owner decided")
is a claim, not the owner's word, until it links to where the owner said it.

## 2. Merge

Combine findings that say the same thing. Note how many reviewers reached it independently: three
reviewers finding the same gap is strong evidence.

## 3. Split

- **Corrections of fact:** the target says something false. Fix it in the target now, and list
  what you fixed.
- **Proposals:** a change of design or scope. The owner decides.

## 4. Report

Lead with the most consequential proposal. Then:
- the other proposals, ranked, each in one or two plain sentences;
- the corrections you made;
- what you dropped, and why.

Don't cap the list. Bring back every proposal worth the owner's time.

## 5. Ask

End by asking which proposals to adopt. Apply no proposal the owner hasn't approved; corrections
of fact are the only changes you make without asking, and you list each one.
