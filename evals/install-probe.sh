#!/bin/bash
# Pure, real install test: an empty Claude Code profile installs a plugin from a marketplace
# branch, then a fresh headless agent works a real request in a clean clone of a public repo.
# Check transcript.jsonl for the Skill call to see that the skill loaded and fired.
# Usage: install-probe.sh <branch> <out-dir>
#   <out-dir> must not exist yet, or be empty: the probe owns it and never deletes anything.
#   PROBE_MARKETPLACE  the marketplace repo (default marktiderman/genesis-plugin)
#   PROBE_PLUGIN       plugin@marketplace to install (default genesis@genesis)
#   PROBE_PROMPT       a request that should trigger the skill under test (default: a 1-3-1 decision)
#   PROBE_REPO         the public repo the agent works in (default marktiderman/genesis); one outside
#                      the marketplace's owner needs PROBE_REPO_TRUSTED=1
# Exits nonzero if a setup step fails; otherwise exits with the agent's status.
set -u
BRANCH="$1"
MARKETPLACE="${PROBE_MARKETPLACE:-marktiderman/genesis-plugin}"
PLUGIN="${PROBE_PLUGIN:-genesis@genesis}"
DEFAULT_PROMPT="Our packages need instructions for the coding agents that build apps with them. Should each package's agent instructions ship inside its npm package (our CLI copies them into the app on install and upgrade) or in our shared Claude Code plugin? Make the call."
PROMPT="${PROBE_PROMPT:-$DEFAULT_PROMPT}"
REPO="${PROBE_REPO:-marktiderman/genesis}"
# The agent runs inside a clone of PROBE_REPO, and a repo's own settings can run hooks there, so
# only a repo under the marketplace's owner runs unless PROBE_REPO_TRUSTED=1 says you checked it.
if [ "${REPO%%/*}" != "${MARKETPLACE%%/*}" ] && [ "${PROBE_REPO_TRUSTED:-}" != 1 ]; then
  echo "install-probe: $REPO isn't under ${MARKETPLACE%%/*}; read its .claude/settings.json first, then set PROBE_REPO_TRUSTED=1" >&2
  exit 1
fi
if [ -e "$2" ] && ! listing="$(ls -A -- "$2")"; then
  echo "install-probe: can't list $2; give it a new or empty folder you can read" >&2
  exit 1
fi
if [ -e "$2" ] && [ -n "$listing" ]; then
  echo "install-probe: $2 isn't empty; give it a new or empty folder (it never deletes anything)" >&2
  exit 1
fi
mkdir -p -- "$2" || exit 1
OUT="$(CDPATH= cd -- "$2" && pwd -P)" || exit 1
PROFILE="$OUT/profile"
WORK="$OUT/repo"
mkdir -p "$PROFILE"
export CLAUDE_CONFIG_DIR="$PROFILE"

step() {
  echo "== $1" >>"$OUT/steps.log"
  shift
  "$@" >>"$OUT/steps.log" 2>&1 || { echo "FAILED: $*" | tee -a "$OUT/steps.log" >&2; exit 1; }
}

: >"$OUT/steps.log"
step "add marketplace from branch" claude plugin marketplace add "$MARKETPLACE#$BRANCH"
step "install" claude plugin install "$PLUGIN"
step "list" claude plugin list
step "clone a clean public repo" git clone -q --depth 1 "https://github.com/$REPO.git" "$WORK"

mkdir -p "$WORK/.claude"
cat > "$WORK/.claude/settings.local.json" <<JSON
{
  "extraKnownMarketplaces": {
    "${PLUGIN#*@}": { "source": { "source": "github", "repo": "$MARKETPLACE", "ref": "$BRANCH" } }
  },
  "enabledPlugins": { "$PLUGIN": true }
}
JSON

echo "== fresh agent" >>"$OUT/steps.log"
cd "$WORK" || exit 1
claude -p --output-format stream-json --verbose --max-turns 25 \
  "$PROMPT" \
  > "$OUT/transcript.jsonl" 2>"$OUT/stderr.log"
STATUS=$?
echo "exit $STATUS" >>"$OUT/steps.log"
exit "$STATUS"
