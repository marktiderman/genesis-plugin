---
type: llm
focus: last_message
weight: 2
---
PASS if the final message recommends reusing or extending the plugin's existing review skill
(`review`, with or without a plugin prefix) for this request, rather than creating a new skill.
FAIL if it recommends a new skill, rejects or discourages reusing the review skill (wherever the
negation sits, e.g. "Reuse `/review` is not recommended"), or only mentions reviewing without
recommending the existing skill.
