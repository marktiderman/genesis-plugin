#!/bin/bash
# Pure, real install test: an empty Claude Code profile installs genesis-plugin from a branch,
# then a fresh headless agent works a real decision in a clean clone of a public repo.
# Usage: evals/install-probe.sh <branch> <out-dir>
set -u
BRANCH="$1"
OUT="$2"
mkdir -p "$OUT"
PROFILE="$OUT/profile"
WORK="$OUT/repo"
rm -rf "$PROFILE" "$WORK"
mkdir -p "$PROFILE"
export CLAUDE_CONFIG_DIR="$PROFILE"

echo "== add marketplace from branch" | tee "$OUT/steps.log"
claude plugin marketplace add "marktiderman/genesis-plugin#$BRANCH" >>"$OUT/steps.log" 2>&1
echo "== install" >>"$OUT/steps.log"
claude plugin install genesis@genesis >>"$OUT/steps.log" 2>&1
claude plugin list >>"$OUT/steps.log" 2>&1

echo "== clone a clean public repo" >>"$OUT/steps.log"
git clone -q --depth 1 https://github.com/marktiderman/genesis.git "$WORK" >>"$OUT/steps.log" 2>&1
mkdir -p "$WORK/.claude"
cat > "$WORK/.claude/settings.local.json" <<JSON
{
  "extraKnownMarketplaces": {
    "genesis": { "source": { "source": "github", "repo": "marktiderman/genesis-plugin", "ref": "$BRANCH" } }
  },
  "enabledPlugins": { "genesis@genesis": true }
}
JSON

echo "== fresh agent" >>"$OUT/steps.log"
cd "$WORK" || exit 1
claude -p --output-format stream-json --verbose --max-turns 25 \
  "Our packages need instructions for the coding agents that build apps with them. Should each package's agent instructions ship inside its npm package (our CLI copies them into the app on install and upgrade) or in our shared Claude Code plugin? Make the call." \
  > "$OUT/transcript.jsonl" 2>"$OUT/stderr.log"
echo "exit $?" >>"$OUT/steps.log"
