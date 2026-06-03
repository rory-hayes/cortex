import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectDashboardSnapshot, type DashboardSnapshot } from "./dashboard-data.js";

type DashboardCliOptions = {
  repoRoot: string;
  host: string;
  port: number;
};

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const options = parseArgs(process.argv.slice(2));

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderDashboardHtml(options.repoRoot));
      return;
    }

    if (url.pathname === "/api/status") {
      const snapshot = await collectDashboardSnapshot(options.repoRoot);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(snapshot, null, url.searchParams.has("pretty") ? 2 : 0));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Unable to render runner dashboard status." }));
  }
});

server.listen(options.port, options.host, () => {
  const host = options.host === "0.0.0.0" ? "localhost" : options.host;
  process.stdout.write(`Codex runner dashboard: http://${host}:${options.port}\n`);
  process.stdout.write(`Repo: ${options.repoRoot}\n`);
});

function parseArgs(args: string[]): DashboardCliOptions {
  let repoRoot = process.cwd();
  let host = "127.0.0.1";
  let port = 8787;

  for (const arg of args) {
    if (arg.startsWith("--repo=")) {
      repoRoot = path.resolve(arg.slice("--repo=".length));
      continue;
    }
    if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
      continue;
    }
    if (arg.startsWith("--port=")) {
      const parsedPort = Number.parseInt(arg.slice("--port=".length), 10);
      if (Number.isSafeInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65_535) {
        port = parsedPort;
      }
      continue;
    }
  }

  return {
    repoRoot: repoRoot || defaultRepoRoot,
    host,
    port,
  };
}

function renderDashboardHtml(repoRoot: string): string {
  const safeRepoRoot = escapeHtml(repoRoot);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Runner Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --panel-strong: #f9fafc;
      --text: #141923;
      --muted: #657084;
      --line: #dfe4ee;
      --blue: #4269e8;
      --green: #258c55;
      --red: #d84a4a;
      --amber: #b7791f;
      --shadow: 0 18px 45px rgba(22, 30, 50, 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      letter-spacing: 0;
    }

    main {
      width: min(1440px, calc(100vw - 48px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }

    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      margin-bottom: 24px;
    }

    h1, h2, h3, p { margin: 0; }

    h1 {
      font-size: 28px;
      line-height: 1.12;
      font-weight: 760;
    }

    h2 {
      font-size: 15px;
      font-weight: 720;
      margin-bottom: 14px;
    }

    .subhead {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      border-radius: 8px;
      min-height: 36px;
      padding: 0 12px;
      font: inherit;
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
    }

    button:hover { border-color: #bdc7da; }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--muted);
    }

    .is-running .dot { background: var(--green); }
    .is-stale .dot { background: var(--amber); }
    .is-stopped .dot { background: var(--muted); }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      min-width: 0;
    }

    .card-body { padding: 18px; }

    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-5 { grid-column: span 5; }
    .span-7 { grid-column: span 7; }
    .span-12 { grid-column: span 12; }

    .metric-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 780;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    }

    .metric {
      font-size: 34px;
      line-height: 1;
      font-weight: 760;
    }

    .metric-note {
      margin-top: 9px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }

    .progress-track {
      width: 100%;
      height: 9px;
      border-radius: 999px;
      background: #e8edf7;
      overflow: hidden;
      margin-top: 14px;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3f65e8, #26a269);
      width: 0%;
    }

    .row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 12px 0;
      border-top: 1px solid var(--line);
    }

    .row:first-of-type { border-top: 0; }

    .mono {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }

    .title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 0 9px;
      background: #eef2ff;
      color: var(--blue);
      font-size: 11px;
      font-weight: 780;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .badge.green { background: #e8f6ee; color: var(--green); }
    .badge.red { background: #fff0f0; color: var(--red); }
    .badge.amber { background: #fff7e6; color: var(--amber); }
    .badge.gray { background: #eef1f6; color: var(--muted); }

    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .mini {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px;
      background: var(--panel-strong);
      min-width: 0;
    }

    .mini strong {
      display: block;
      font-size: 18px;
      line-height: 1;
      margin-bottom: 6px;
    }

    .mini span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .empty {
      color: var(--muted);
      font-size: 13px;
      padding: 14px 0 2px;
    }

    .footer-note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 980px) {
      main { width: min(100vw - 28px, 760px); }
      header { flex-direction: column; }
      .toolbar { justify-content: flex-start; }
      .span-3, .span-4, .span-5, .span-7 { grid-column: span 12; }
      .split { grid-template-columns: 1fr; }
      .row { grid-template-columns: 78px minmax(0, 1fr); }
      .row .badge { justify-self: start; grid-column: 2; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Codex Runner Dashboard</h1>
        <p class="subhead">${safeRepoRoot}</p>
      </div>
      <div class="toolbar">
        <span id="runner-pill" class="status-pill is-stopped"><span class="dot"></span><span>Loading</span></span>
        <button type="button" id="refresh">Refresh</button>
      </div>
    </header>

    <section class="grid" aria-live="polite">
      <article class="card span-3">
        <div class="card-body">
          <div class="metric-label">Task Completion</div>
          <div class="metric" id="completion">--</div>
          <div class="progress-track"><div class="progress-fill" id="completion-fill"></div></div>
          <p class="metric-note" id="completion-note">Waiting for data.</p>
        </div>
      </article>

      <article class="card span-3">
        <div class="card-body">
          <div class="metric-label">Task Commits</div>
          <div class="metric" id="commits">--</div>
          <p class="metric-note" id="commit-note">Task-scoped commits on this repo.</p>
        </div>
      </article>

      <article class="card span-3">
        <div class="card-body">
          <div class="metric-label">Code Lines Added</div>
          <div class="metric" id="code-lines">--</div>
          <p class="metric-note" id="code-note">Approximate additions in apps, packages, and scripts.</p>
        </div>
      </article>

      <article class="card span-3">
        <div class="card-body">
          <div class="metric-label">Estimated Time Saved</div>
          <div class="metric" id="time-saved">--</div>
          <p class="metric-note" id="time-note">Rough estimate, 45 manual minutes per merged run.</p>
        </div>
      </article>

      <article class="card span-7">
        <div class="card-body">
          <h2>Recent Runs</h2>
          <div id="recent-runs"></div>
        </div>
      </article>

      <article class="card span-5">
        <div class="card-body">
          <h2>Now</h2>
          <div class="split">
            <div class="mini"><strong id="worktrees">--</strong><span>active runner worktrees</span></div>
            <div class="mini"><strong id="ready-count">--</strong><span>ready backlog tasks</span></div>
            <div class="mini"><strong id="active-runs">--</strong><span>unfinished run artifacts</span></div>
            <div class="mini"><strong id="failed-runs">--</strong><span>recent blocked or failed runs</span></div>
          </div>
          <p class="footer-note" id="runner-detail"></p>
        </div>
      </article>

      <article class="card span-5">
        <div class="card-body">
          <h2>Ready Tasks</h2>
          <div id="ready-tasks"></div>
        </div>
      </article>

      <article class="card span-7">
        <div class="card-body">
          <h2>Blocked / Needs Attention</h2>
          <div id="attention"></div>
        </div>
      </article>
    </section>
  </main>

  <script>
    const formatNumber = new Intl.NumberFormat();
    const stateClasses = { running: "is-running", stale_lock: "is-stale", stopped: "is-stopped" };

    async function refresh() {
      const response = await fetch("/api/status", { cache: "no-store" });
      const snapshot = await response.json();
      render(snapshot);
    }

    function render(snapshot) {
      const runnerPill = document.getElementById("runner-pill");
      runnerPill.className = "status-pill " + (stateClasses[snapshot.runner.state] || "is-stopped");
      runnerPill.lastElementChild.textContent = runnerLabel(snapshot.runner);

      setText("completion", snapshot.backlog.completionPercent + "%");
      document.getElementById("completion-fill").style.width = snapshot.backlog.completionPercent + "%";
      setText("completion-note", snapshot.backlog.completed + " of " + snapshot.backlog.total + " backlog tasks complete");
      setText("commits", formatNumber.format(snapshot.git.taskCommitCount));
      setText("commit-note", snapshot.git.latestTaskCommit ? snapshot.git.latestTaskCommit.subject : "No task commits found.");
      setText("code-lines", formatNumber.format(snapshot.git.codeAdditions));
      setText("code-note", formatNumber.format(snapshot.git.codeDeletions) + " deletions tracked in code directories");
      setText("time-saved", formatMinutes(snapshot.productivity.estimatedSavedMinutes));
      setText("time-note", snapshot.productivity.mergedRunCount + " recent merged runs measured at " + snapshot.productivity.heuristicMinutesPerTask + " min/task");
      setText("worktrees", snapshot.worktrees.count);
      setText("ready-count", snapshot.backlog.ready.length);
      setText("active-runs", snapshot.runs.active.length);
      setText("failed-runs", snapshot.runs.failed.length);
      setText("runner-detail", runnerDetail(snapshot));

      renderRows("recent-runs", snapshot.runs.recent.slice(0, 8), runRow, "No run artifacts found yet.");
      renderRows("ready-tasks", snapshot.backlog.ready, taskRow, "No ready tasks right now.");
      renderRows("attention", attentionRows(snapshot), attentionRow, "No current blockers found.");
    }

    function runnerLabel(runner) {
      if (runner.state === "running") return "Running" + (runner.pid ? " · pid " + runner.pid : "");
      if (runner.state === "stale_lock") return "Stale lock";
      return "Stopped";
    }

    function runnerDetail(snapshot) {
      const parts = [
        "Generated " + new Date(snapshot.generatedAt).toLocaleTimeString(),
        snapshot.git.branch ? "branch " + snapshot.git.branch : null,
        snapshot.git.head ? "head " + snapshot.git.head : null,
        snapshot.runner.uptimeSeconds ? "uptime " + formatSeconds(snapshot.runner.uptimeSeconds) : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }

    function runRow(run) {
      return row(run.taskId, run.title, [run.phase, run.warningCount + " warnings", run.hardBlockCount + " blocks"].join(" · "), statusBadge(run.status));
    }

    function taskRow(task) {
      return row(task.id, task.title, task.dependsOn.length ? "depends on " + task.dependsOn.join(", ") : "no dependencies", badge(task.priority, "gray"));
    }

    function attentionRows(snapshot) {
      const failed = snapshot.runs.failed.map((run) => ({
        id: run.taskId,
        title: run.title,
        meta: run.latestHardBlock || run.phase,
        badge: statusBadge(run.status),
      }));
      const stale = snapshot.runner.state === "stale_lock"
        ? [{ id: "LOCK", title: "Runner lock is stale", meta: "No live runner process owns the lock.", badge: badge("stale", "amber") }]
        : [];
      const unfinished = snapshot.runner.state !== "running"
        ? snapshot.runs.active.map((run) => ({
            id: run.taskId,
            title: "Unfinished run artifact",
            meta: run.title + " · " + run.phase,
            badge: badge("unfinished", "amber"),
          }))
        : [];
      const deps = snapshot.backlog.blockedByDependencies.slice(0, 5).map((task) => ({
        id: task.id,
        title: task.title,
        meta: "waiting on " + task.dependsOn.join(", "),
        badge: badge("dependency", "gray"),
      }));
      return [...stale, ...unfinished, ...failed, ...deps];
    }

    function attentionRow(item) {
      return row(item.id, item.title, item.meta, item.badge);
    }

    function row(id, title, meta, badgeHtml) {
      return '<div class="row"><div class="mono">' + escapeHtml(id) + '</div><div><div class="title">' + escapeHtml(title) + '</div><div class="meta">' + escapeHtml(meta) + '</div></div>' + badgeHtml + '</div>';
    }

    function statusBadge(status) {
      if (status === "merged") return badge("merged", "green");
      if (status === "failed" || status === "merge_blocked" || status === "blocked") return badge(status, "red");
      if (status === "active") return badge("active", "blue");
      return badge(status || "unknown", "gray");
    }

    function badge(value, color) {
      return '<span class="badge ' + color + '">' + escapeHtml(String(value).replace("_", " ")) + '</span>';
    }

    function renderRows(id, rows, renderRow, emptyText) {
      const target = document.getElementById(id);
      target.innerHTML = rows.length ? rows.map(renderRow).join("") : '<p class="empty">' + escapeHtml(emptyText) + '</p>';
    }

    function setText(id, value) {
      document.getElementById(id).textContent = value;
    }

    function formatMinutes(minutes) {
      if (minutes < 60) return Math.round(minutes) + "m";
      return Math.floor(minutes / 60) + "h " + Math.round(minutes % 60) + "m";
    }

    function formatSeconds(seconds) {
      if (seconds < 60) return seconds + "s";
      return formatMinutes(seconds / 60);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    document.getElementById("refresh").addEventListener("click", refresh);
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export type { DashboardSnapshot };
