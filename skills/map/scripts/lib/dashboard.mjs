#!/usr/bin/env node
/**
 * dashboard.mjs — renders the `map` dashboard HTML from a `computeScore()` result.
 *
 * Pure function of its input: `renderDashboardHtml(score)` takes exactly the object
 * `scripts/lib/score.mjs`'s `computeScore()` returns and does no disk I/O of its own — the
 * request-time freshness (read `data/` fresh on every request) lives in `scripts/serve.mjs`,
 * which calls `computeScore()` fresh per HTTP request and hands the result here. This file only
 * turns that one object into HTML, so there is nothing here to read stale.
 *
 * Self-contained on purpose: no build step, no bundler, no framework — this is a static page
 * served by `node:http` (see `scripts/serve.mjs`'s zero-new-dependencies constraint). Colors below
 * are a plain, brand-neutral default palette as literal `hsl()` triples, so this file has no
 * dependency on Tailwind, a design system, or a build — a consumer that wants its own look can
 * swap the custom-property values in `STYLE` below for its own tokens.
 *
 * Nothing here embeds the current time or any other run-to-run varying value.
 */

// ── tiny HTML helpers ────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function chip(text, cls = "") {
  return `<span class="chip ${cls}">${escapeHtml(text)}</span>`;
}

function pct(num, den) {
  return den === 0 ? null : Math.round((num / den) * 100);
}

// ── copy: gap captions, framed as open questions rather than failures ───────
// Keyed on the exact label text `data/_views/blind-spots.md` and the authored coverage use — a
// label this doesn't recognize still renders (falls back to the row's own `note`, or a generic
// line), it just won't get the hand-written phrasing.

const AUTHORED_CAPTIONS = {
  "surfaces claimed by a feature": {
    complete: "Every screen has a job claiming it.",
    gap: (n) => `${n} screen${n === 1 ? "" : "s"} claimed by no feature yet — whose work is this?`,
  },
  "features with a flow": {
    complete: "Every feature has at least one walked flow.",
    gap: (n) => `${n} feature${n === 1 ? "" : "s"} with no ordered walk authored yet.`,
  },
};

function fractionCard({ label, num, den, note }) {
  const p = pct(num, den);
  const complete = p === 100;
  const gap = den - num;
  const captionSet = AUTHORED_CAPTIONS[label];
  let caption;
  if (captionSet) {
    caption = complete ? captionSet.complete : captionSet.gap(gap);
  } else if (note) {
    caption = note;
  } else {
    caption = complete ? "Complete." : `${gap} remaining.`;
  }
  return `
    <div class="score-card ${complete ? "is-complete" : "is-gap"}">
      <div class="score-frac"><span class="num">${num}</span><span class="den">/ ${den}</span></div>
      <div class="score-bar"><div class="score-bar-fill" style="width:${p ?? 0}%"></div></div>
      <div class="score-label">${escapeHtml(label)}</div>
      <div class="score-note">${escapeHtml(caption)}</div>
    </div>`;
}

function countCard({ label, count, note }) {
  return `
    <div class="score-card is-count">
      <div class="score-frac"><span class="num">${count}</span></div>
      <div class="score-label">${escapeHtml(label)}</div>
      <div class="score-note">${escapeHtml(note)}</div>
    </div>`;
}

// ── sections ──────────────────────────────────────────────────────────────

function renderScoreSection(score) {
  if (score.errors.length > 0) {
    return `
      <section id="score">
        <h2>Score</h2>
        <div class="banner banner-error">
          <p><strong>The authored layer doesn't resolve right now</strong> — the numbers below
          would be a guess, so they're not shown. This is the same check
          <code>map check</code> runs:</p>
          <ul>${score.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
        </div>
      </section>`;
  }

  const a = score.authored;
  const authoredCards = [
    fractionCard({ label: "surfaces claimed by a feature", num: a.surfacesClaimed, den: a.surfacesTotal }),
    fractionCard({ label: "features with a flow", num: a.featuresWithFlow, den: a.featuresTotal }),
    countCard({
      label: "flows authored",
      count: a.flowsTotal,
      note: "Ordered walks through surfaces, each one written by a person.",
    }),
  ].join("");

  const extractedCards = score.extracted.length
    ? score.extracted.map((r) => fractionCard(r)).join("")
    : `<div class="banner banner-muted"><p>No extracted numbers yet — <code>data/_views/blind-spots.md</code>
        wasn't found. Run <code>map sync</code> to populate it.</p></div>`;

  return `
    <section id="score">
      <h2>Score</h2>
      <p class="section-lede">Every fraction is a floor, not a target — see
        <code>data/_views/blind-spots.md</code>. A gap is unclaimed work, not a bug.</p>

      <h3 class="subhead">Authored <span class="subhead-note">— data/features/, data/surfaces/, data/flows/</span></h3>
      <div class="score-grid">${authoredCards}</div>

      <h3 class="subhead">Extracted <span class="subhead-note">— data/_views/blind-spots.md, written by <code>map sync</code></span></h3>
      <div class="score-grid">${extractedCards}</div>
    </section>`;
}

function renderFlowsSection(score) {
  if (score.errors.length > 0) return "";
  const featureById = new Map(score.features.map((f) => [f.id, f]));
  const surfaceById = new Map(score.surfaces.map((s) => [s.id, s]));

  const cards = score.flows
    .map((fl) => {
      const feature = featureById.get(fl.feature);
      const steps = fl.steps
        .map((step, i) => {
          const surface = surfaceById.get(step.surface);
          const label = surface ? surface.title : step.surface;
          const c = `${chip(label, "chip-step")}`;
          return i === 0 ? c : `<span class="arrow" aria-hidden="true">&rarr;</span>${c}`;
        })
        .join("");
      return `
        <article class="flow-card">
          <header class="flow-head">
            <span class="mono id-badge">${escapeHtml(fl.id)}</span>
            <h3>${escapeHtml(fl.title)}</h3>
          </header>
          <p class="flow-meta">
            Feature: <strong>${escapeHtml(feature ? feature.title : fl.feature)}</strong>
            &nbsp;&middot;&nbsp; Actor: ${escapeHtml(fl.actor)}
            &nbsp;&middot;&nbsp; Entry: ${escapeHtml(fl.entry)}
          </p>
          <div class="flow-steps">${steps}</div>
          <p class="flow-outcome"><strong>Outcome</strong> — ${escapeHtml(fl.outcome)}</p>
        </article>`;
    })
    .join("");

  return `
    <section id="flows">
      <h2>Flows</h2>
      <p class="section-lede">${score.flows.length} authored walk${score.flows.length === 1 ? "" : "s"} through
        surfaces that exist, each reaching a stated outcome.</p>
      <div class="flow-list">${cards}</div>
    </section>`;
}

function renderFeaturesSection(score) {
  if (score.errors.length > 0) return "";
  const { surfacesByFeature, flowsByFeature } = score.coverage;

  const rows = score.features
    .map((f) => {
      const owned = surfacesByFeature.get(f.id) ?? [];
      const flowIds = flowsByFeature.get(f.id) ?? [];
      const hasFlow = flowIds.length > 0;
      return `
        <tr data-gap="${hasFlow ? "0" : "1"}">
          <td class="mono">${escapeHtml(f.id)}</td>
          <td>${escapeHtml(f.title)}</td>
          <td>${owned.length ? owned.map((id) => chip(id, "chip-mini")).join(" ") : "<span class=\"muted\">none yet</span>"}</td>
          <td>${statusBadge(f.status)}</td>
          <td>${hasFlow ? `<span class="ok-mark" title="${escapeHtml(flowIds.join(", "))}">&check; ${escapeHtml(flowIds.join(", "))}</span>` : `<span class="gap-mark">not yet</span>`}</td>
        </tr>`;
    })
    .join("");

  return `
    <section id="features">
      <h2>Features</h2>
      <p class="section-lede">${score.features.length} jobs someone is trying to achieve, each with
        <code>owns:</code> globs claiming the code that serves it.</p>
      ${filterToggle("features-table", "Show only features with no flow yet")}
      <div class="table-wrap" id="features-table">
        <table>
          <thead><tr><th>id</th><th>job</th><th>screens owned</th><th>status</th><th>has a flow</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function renderSurfacesSection(score) {
  if (score.errors.length > 0) return "";
  const rows = score.surfaces
    .map((s) => {
      const unclaimed = s.claimed_by.length === 0;
      const reads = s.reads ?? [];
      const writes = s.writes ?? [];
      return `
        <tr data-gap="${unclaimed ? "1" : "0"}">
          <td class="mono">${escapeHtml(s.id)}</td>
          <td>${escapeHtml(s.title)}</td>
          <td class="mono">${escapeHtml(s.component ?? "—")}</td>
          <td>${(s.scopes ?? []).map((sc) => chip(sc, "chip-mini")).join(" ") || "<span class=\"muted\">—</span>"}</td>
          <td>${unclaimed ? "<span class=\"gap-mark\">unclaimed</span>" : s.claimed_by.map((id) => chip(id, "chip-mini")).join(" ")}</td>
          <td>${reads.length ? reads.map((r) => chip(r, "chip-mini")).join(" ") : "<span class=\"muted\">—</span>"}</td>
          <td>${writes.length ? writes.map((w) => chip(w, "chip-mini")).join(" ") : "<span class=\"muted\">—</span>"}</td>
        </tr>`;
    })
    .join("");

  return `
    <section id="surfaces">
      <h2>Surfaces</h2>
      <p class="section-lede">${score.surfaces.length} screens the router can reach. Reads/writes are
        blank until map sync records data edges — a blank cell isn't a bug, it's an unasked
        question.</p>
      ${filterToggle("surfaces-table", "Show only unclaimed")}
      <div class="table-wrap" id="surfaces-table">
        <table>
          <thead><tr><th>id</th><th>title</th><th>component</th><th>scopes</th><th>claimed by</th><th>reads</th><th>writes</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function renderResourcesSection(score) {
  if (score.errors.length > 0) return "";
  const backings = [...new Set(score.resources.map((r) => r.backing))].sort();

  const rows = score.resources
    .map((r) => {
      const nothingReaches = r.reach === "none" && r.used_by.length === 0;
      const rlsState =
        r.rls_enabled === "true" ? "enabled" : r.rls_enabled === "false" ? "disabled" : "unknown";
      const rlsCls = rlsState === "enabled" ? "ok-mark" : rlsState === "disabled" ? "gap-mark" : "muted";
      const reach = [
        chip(r.reach, r.reach === "feature" ? "chip-mini chip-ok" : "chip-mini"),
        r.used_by.length ? chip(`edge ×${r.used_by.length}`, "chip-mini chip-ok") : null,
      ]
        .filter(Boolean)
        .join(" ") || "<span class=\"gap-mark\">nothing reaches it</span>";
      return `
        <tr data-gap="${nothingReaches ? "1" : "0"}" data-backing="${escapeHtml(r.backing)}">
          <td class="mono">${escapeHtml(r.name)}</td>
          <td>${chip(r.backing, "chip-mini")}</td>
          <td>${r.declared === "undeclared" ? "<span class=\"gap-mark\">undeclared</span>" : escapeHtml(r.declared)}</td>
          <td><span class="${rlsCls}">${rlsState}</span>${r.rls.length ? ` <span class="muted">(${escapeHtml(r.rls.join(", "))})</span>` : ""}</td>
          <td>${reach}</td>
        </tr>`;
    })
    .join("");

  const backingOptions = ['<option value="">all backings</option>']
    .concat(backings.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`))
    .join("");

  return `
    <section id="resources">
      <h2>Resources</h2>
      <p class="section-lede">${score.resources.length} data nouns, reconciled across the registry,
        generated types, <code>.from()</code> calls and migrations.</p>
      <div class="controls">
        ${filterToggle("resources-table", "Show only resources nothing reaches", true)}
        <label class="select-filter">
          <span>Filter by backing</span>
          <select data-role="backing-filter" data-target="resources-table">
            ${backingOptions}
          </select>
        </label>
      </div>
      <div class="table-wrap" id="resources-table">
        <table>
          <thead><tr><th>name</th><th>backing</th><th>declared</th><th>RLS</th><th>reach</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function statusBadge(status) {
  const cls = { shipped: "badge-success", building: "badge-info", idea: "badge-muted", planned: "badge-muted", dropped: "badge-muted" }[status] ?? "badge-muted";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function filterToggle(tableId, label, inline = false) {
  return `
    <label class="filter-toggle${inline ? " filter-toggle-inline" : ""}">
      <input type="checkbox" onchange="document.getElementById('${tableId}').classList.toggle('gap-only', this.checked)" />
      <span>${escapeHtml(label)}</span>
    </label>`;
}

// ── page shell ────────────────────────────────────────────────────────────

const STYLE = `
  :root {
    --background: 140 10% 97%; --foreground: 160 30% 8%;
    --card: 0 0% 100%; --card-foreground: 160 30% 8%;
    --primary: 152 60% 30%; --primary-foreground: 0 0% 100%;
    --secondary: 160 15% 92%; --secondary-foreground: 160 30% 8%;
    --muted: 140 10% 94%; --muted-foreground: 160 10% 38%;
    --accent: 45 100% 58%; --accent-foreground: 160 30% 8%;
    --destructive: 0 72% 51%; --destructive-foreground: 0 0% 100%;
    --border: 140 12% 89%; --input: 140 12% 89%; --ring: 152 60% 36%;
    --radius: 0.75rem;
    --success: 152 60% 36%; --success-foreground: 0 0% 100%;
    --warning: 45 100% 58%; --warning-foreground: 160 30% 8%;
    --info: 210 90% 45%; --info-foreground: 0 0% 100%;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: 160 30% 6%; --foreground: 140 10% 94%;
      --card: 160 25% 10%; --card-foreground: 140 10% 94%;
      --primary: 152 60% 46%; --primary-foreground: 0 0% 100%;
      --secondary: 160 20% 16%; --secondary-foreground: 140 10% 94%;
      --muted: 160 20% 14%; --muted-foreground: 140 10% 50%;
      --accent: 45 100% 58%; --accent-foreground: 160 30% 8%;
      --destructive: 0 72% 51%; --destructive-foreground: 0 0% 100%;
      --border: 160 20% 16%; --input: 160 20% 16%; --ring: 152 60% 46%;
      --success: 152 60% 46%; --success-foreground: 0 0% 100%;
      --warning: 45 100% 58%; --warning-foreground: 160 30% 8%;
      --info: 210 90% 60%; --info-foreground: 160 30% 8%;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; overflow-x: hidden; }
  body {
    background: hsl(var(--background)); color: hsl(var(--foreground));
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.5;
  }
  h1, h2, h3 { font-family: 'Space Grotesk', 'Inter', sans-serif; font-weight: 600; margin: 0; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: hsl(var(--muted)); color: hsl(var(--foreground));
    padding: 0.05em 0.4em; border-radius: 0.3em; font-size: 0.9em;
  }
  a { color: hsl(var(--primary)); }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 2rem 1.5rem 5rem; }
  header.page-head {
    border-bottom: 1px solid hsl(var(--border)); padding-bottom: 1.25rem; margin-bottom: 2rem;
    display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.75rem;
  }
  header.page-head h1 { font-size: 1.6rem; letter-spacing: -0.01em; }
  header.page-head p { margin: 0.3rem 0 0; color: hsl(var(--muted-foreground)); font-size: 0.92rem; max-width: 60ch; }
  nav.toc { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  nav.toc a {
    text-decoration: none; color: hsl(var(--foreground)); font-size: 0.85rem;
    padding: 0.35rem 0.7rem; border-radius: 999px; border: 1px solid hsl(var(--border));
  }
  nav.toc a:hover { background: hsl(var(--secondary)); }
  section { margin-bottom: 3rem; scroll-margin-top: 1rem; }
  section h2 { font-size: 1.25rem; margin-bottom: 0.35rem; }
  .subhead { font-size: 0.95rem; margin: 1.25rem 0 0.6rem; color: hsl(var(--foreground)); }
  .subhead-note { font-weight: 400; color: hsl(var(--muted-foreground)); font-size: 0.85rem; }
  .section-lede { color: hsl(var(--muted-foreground)); font-size: 0.92rem; margin: 0.35rem 0 1rem; max-width: 75ch; }

  .score-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 0.85rem; }
  .score-card {
    background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius);
    padding: 0.95rem 1.05rem; display: flex; flex-direction: column; gap: 0.35rem;
  }
  .score-card.is-gap { border-color: hsl(var(--accent) / 0.55); }
  .score-frac { display: flex; align-items: baseline; gap: 0.3rem; }
  .score-frac .num { font-family: 'Space Grotesk', sans-serif; font-size: 1.7rem; font-weight: 600; }
  .score-frac .den { color: hsl(var(--muted-foreground)); font-size: 1rem; }
  .score-bar { height: 6px; border-radius: 999px; background: hsl(var(--muted)); overflow: hidden; }
  .score-card.is-complete .score-bar-fill { background: hsl(var(--success)); }
  .score-card.is-gap .score-bar-fill { background: hsl(var(--accent)); }
  .score-bar-fill { height: 100%; }
  .score-label { font-size: 0.82rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; color: hsl(var(--muted-foreground)); }
  .score-note { font-size: 0.85rem; color: hsl(var(--foreground) / 0.85); }
  .score-card.is-count .score-frac { margin-bottom: 0.1rem; }

  .banner { border: 1px solid hsl(var(--border)); border-radius: var(--radius); padding: 1rem 1.15rem; font-size: 0.9rem; }
  .banner-error { border-color: hsl(var(--destructive) / 0.5); background: hsl(var(--destructive) / 0.06); }
  .banner-muted { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
  .banner ul { margin: 0.5rem 0 0; padding-left: 1.2rem; }

  .flow-list { display: flex; flex-direction: column; gap: 0.9rem; }
  .flow-card { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius); padding: 1rem 1.15rem; }
  .flow-head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.25rem; flex-wrap: wrap; }
  .flow-head h3 { font-size: 1.02rem; }
  .id-badge {
    font-size: 0.72rem; color: hsl(var(--primary)); background: hsl(var(--primary) / 0.12);
    padding: 0.12rem 0.5rem; border-radius: 999px; font-weight: 600;
  }
  .flow-meta { font-size: 0.85rem; color: hsl(var(--muted-foreground)); margin: 0 0 0.7rem; }
  .flow-steps { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.7rem; }
  .arrow { color: hsl(var(--muted-foreground)); padding: 0 0.15rem; }
  .flow-outcome { font-size: 0.88rem; margin: 0; padding-top: 0.6rem; border-top: 1px dashed hsl(var(--border)); }

  .chip {
    display: inline-block; font-size: 0.78rem; padding: 0.22rem 0.6rem; border-radius: 999px;
    background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); white-space: nowrap;
  }
  .chip-step { background: hsl(var(--primary) / 0.12); color: hsl(var(--primary)); font-weight: 500; }
  .chip-mini { font-size: 0.72rem; padding: 0.12rem 0.5rem; }
  .chip-ok { background: hsl(var(--success) / 0.15); color: hsl(var(--success)); }

  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; margin-bottom: 0.75rem; }
  .filter-toggle { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer; user-select: none; }
  .filter-toggle input { accent-color: hsl(var(--primary)); }
  .select-filter { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; }
  .select-filter select {
    font: inherit; background: hsl(var(--card)); color: hsl(var(--foreground));
    border: 1px solid hsl(var(--border)); border-radius: 0.4rem; padding: 0.25rem 0.5rem;
  }

  .table-wrap { overflow-x: auto; border: 1px solid hsl(var(--border)); border-radius: var(--radius); }
  table { border-collapse: collapse; width: 100%; min-width: 640px; font-size: 0.86rem; }
  th, td { text-align: left; padding: 0.55rem 0.8rem; border-bottom: 1px solid hsl(var(--border)); vertical-align: top; }
  thead th {
    position: sticky; top: 0; background: hsl(var(--muted)); color: hsl(var(--muted-foreground));
    font-weight: 600; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.03em;
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr[data-gap="1"] { background: hsl(var(--accent) / 0.06); }
  .table-wrap.gap-only tr[data-gap="0"] { display: none; }
  .table-wrap.backing-filtered tbody tr[data-backing-hidden="1"] { display: none; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.82rem; }
  .muted { color: hsl(var(--muted-foreground)); }
  .ok-mark { color: hsl(var(--success)); font-weight: 500; }
  .gap-mark {
    color: hsl(var(--accent-foreground)); background: hsl(var(--accent) / 0.35);
    padding: 0.08rem 0.5rem; border-radius: 999px; font-size: 0.78rem; font-weight: 500;
  }
  .badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.15rem 0.55rem; border-radius: 999px; }
  .badge-success { background: hsl(var(--success) / 0.15); color: hsl(var(--success)); }
  .badge-info { background: hsl(var(--info) / 0.15); color: hsl(var(--info)); }
  .badge-muted { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }

  footer { color: hsl(var(--muted-foreground)); font-size: 0.8rem; border-top: 1px solid hsl(var(--border)); padding-top: 1.25rem; margin-top: 3rem; }
`;

// JS: the resources table's "filter by backing" <select> needs to hide rows whose data-backing
// doesn't equal whatever the visitor picked — a runtime value, which CSS attribute selectors
// can't compare against (only against a literal in the stylesheet). So this listens for the
// select's change event and stamps each row with data-backing-hidden itself; the CSS above just
// hides whatever gets stamped "1". Every other filter on the page (the gap-only toggles) needs no
// runtime comparison, so those stay inline onchange handlers with no JS of their own to maintain.
const SCRIPT = `
  document.querySelectorAll('select[data-role="backing-filter"]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var wrap = document.getElementById(sel.dataset.target);
      var rows = wrap.querySelectorAll('tbody tr');
      rows.forEach(function (tr) {
        var matches = !sel.value || tr.dataset.backing === sel.value;
        tr.dataset.backingHidden = matches ? '0' : '1';
      });
      wrap.classList.toggle('backing-filtered', !!sel.value);
    });
  });
`;

/** Renders the full dashboard page for a `computeScore()` result. `repoName` labels the header —
 *  the tool has no fixed identity of its own, so `scripts/serve.mjs` passes the root directory's
 *  own name; a caller with nothing to pass gets a plain, still-true "Map" heading. */
export function renderDashboardHtml(score, repoName = null) {
  const heading = repoName ? `${repoName} — Map` : "Map";
  const nav = [
    ["score", "Score"],
    ["flows", "Flows"],
    ["features", "Features"],
    ["surfaces", "Surfaces"],
    ["resources", "Resources"],
  ]
    .map(([id, label]) => `<a href="#${id}">${label}</a>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(heading)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header class="page-head">
    <div>
      <h1>${escapeHtml(heading)}</h1>
      <p>What the router, the resource registry, and the people writing features and flows each
        say about this app — read straight from <code>data/</code> on every request.</p>
    </div>
    <nav class="toc">${nav}</nav>
  </header>

  ${renderScoreSection(score)}
  ${renderFlowsSection(score)}
  ${renderFeaturesSection(score)}
  ${renderSurfacesSection(score)}
  ${renderResourcesSection(score)}

  <footer>
    Served by <code>map</code> (<code>scripts/serve.mjs</code>) — reads <code>data/</code>
    fresh on every request. Edit a row and reload to see it change.
  </footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
