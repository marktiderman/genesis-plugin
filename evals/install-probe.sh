#!/bin/bash
# Pure, real install test: an empty Claude Code profile installs genesis-plugin from a branch,
# then a fresh headless agent works a real decision in a clean clone of a public repo.
# Check transcript.jsonl for the Skill call to see that the skill loaded and fired.
# Usage: evals/install-probe.sh <branch> <out-dir>
# Exits nonzero if a setup step fails; otherwise exits with the agent's status.
set -u
BRANCH="$1"
mkdir -p "$2" || exit 1
OUT="$(cd "$2" && pwd)"
PROFILE="$OUT/profile"
WORK="$OUT/repo"
rm -rf "$PROFILE" "$WORK"
mkdir -p "$PROFILE"
export CLAUDE_CONFIG_DIR="$PROFILE"

step() {
  echo "== $1" >>"$OUT/steps.log"
  shift
  "$@" >>"$OUT/steps.log" 2>&1 || { echo "FAILED: $*" | tee -a "$OUT/steps.log" >&2; exit 1; }
}

: >"$OUT/steps.log"
step "add marketplace from branch" claude plugin marketplace add "marktiderman/genesis-plugin#$BRANCH"
step "install" claude plugin install genesis@genesis
step "list" claude plugin list
step "clone a clean public repo" git clone -q --depth 1 https://github.com/marktiderman/genesis.git "$WORK"

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
STATUS=$?
echo "exit $STATUS" >>"$OUT/steps.log"
exit "$STATUS"
