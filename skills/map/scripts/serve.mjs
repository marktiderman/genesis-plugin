#!/usr/bin/env node
/**
 * serve.mjs — regenerate the map, print the scoreboard, serve the dashboard.
 *
 *   node serve.mjs --root <dir>               regenerate, print, then serve on http://127.0.0.1:4321
 *   node serve.mjs --root <dir> --no-serve    regenerate + print only; exits 0 (the CI/scripting path)
 *
 * Three steps, always in this order, against the given `--root` (a consumer's checkout — this
 * script never assumes it is running from inside the repo it maps):
 *
 *   1. Regenerate. `map.mjs sync --root <dir>` then `map.mjs flows --root <dir>` — both live
 *      right next to this file, so there is nothing to search for the way a consumer once had to
 *      search for this tool. Either step exiting non-zero aborts here with its exit code: a broken
 *      map is not a dashboard you'd want to look at.
 *   2. Print the scoreboard — every fraction, one block, to stdout. Must work headless, so this
 *      happens whether or not step 3 runs.
 *   3. Serve. Reads `data/` fresh on every request (see `lib/score.mjs`'s `computeScore`) —
 *      that's the dogfooding point: edit a row and reload, see the change, no restart.
 *
 * The scoreboard and the dashboard are two renderings of the exact same computation
 * (`lib/score.mjs`'s `computeScore`/`formatScoreboard`) — this file never computes a fraction
 * itself, only prints or serves what that module returns. See that file's header for why.
 *
 * Zero new dependencies: node:http, node:fs (via the modules above), node:path, node:child_process
 * only. No express, no bundler, no framework — works right after cloning the plugin, no install.
 *
 * Nothing here embeds the current time or any other run-to-run varying value in a written file;
 * the server's own startup log line is fine (it's console output, not a generated artifact).
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeScore, formatScoreboard } from "./lib/score.mjs";
import { renderDashboardHtml } from "./lib/dashboard.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const MAP_CLI = join(SCRIPTS_DIR, "map.mjs");
const PORT = 4321;

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf("--root");
if (rootFlag !== -1 && (!argv[rootFlag + 1] || argv[rootFlag + 1].startsWith("--"))) {
  // Caught here, not in the try below: this runs before it, and `resolve(undefined)`
  // throws a TypeError that says nothing about the command line.
  console.error("\u2717 --root needs a directory");
  process.exit(2);
}
const ROOT = resolve(rootFlag === -1 ? process.cwd() : argv[rootFlag + 1]);
const noServe = argv.includes("--no-serve");

function run(label, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(`✗ map: couldn't run ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`✗ map: ${label} failed (exit ${result.status}) — fix it before the map can be trusted.`);
    process.exit(result.status ?? 1);
  }
}

// ── 1. regenerate ────────────────────────────────────────────────────────────

run("map sync", [MAP_CLI, "sync", "--root", ROOT]);
run("map flows", [MAP_CLI, "flows", "--root", ROOT]);

// ── 2. print the scoreboard ──────────────────────────────────────────────────

console.log();
console.log(formatScoreboard(computeScore(ROOT)));

// ── 3. serve ─────────────────────────────────────────────────────────────────

if (noServe) {
  process.exit(0);
}

const repoName = basename(ROOT);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/index.html")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found — the dashboard lives at /");
    return;
  }
  try {
    // Fresh on every request, on purpose — see the file header. No caching layer here to
    // accidentally serve a stale row.
    const html = renderDashboardHtml(computeScore(ROOT), repoName);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`map dashboard error: ${err.message}`);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`✗ map: port ${PORT} is already in use — is another \`map\` server running?`);
  } else {
    console.error(`✗ map: server error: ${err.message}`);
  }
  process.exit(1);
});

// Loopback only. Bare `listen(PORT)` binds 0.0.0.0, so this page — which names every table, its
// RLS state, and every screen nothing claims — would be readable by anyone on the same network.
// It is a local view of a private repo; it has no business answering the LAN.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Serving the map dashboard for ${repoName} at http://localhost:${PORT}`);
});
