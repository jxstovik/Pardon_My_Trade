const $ = (id) => document.getElementById(id);
const state = { replay: null, checkpoints: [], metrics: null };

function scope(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("season", $("season").value);
  url.searchParams.set("position", $("position").value);
  return `${url.pathname}${url.search}`;
}

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

function metric(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(2);
}

function renderReplay() {
  const walkforward = state.replay?.walkforward;
  const promotion = state.replay?.promotion;
  $("run-state").textContent = walkforward ? `${walkforward.checkpoints} checkpoints` : "Preseason artifact only";
  $("promotion-title").textContent = promotion?.approved ? "Candidate passed" : "Candidate not approved";
  $("promotion-status").textContent = promotion?.status ?? "unknown";
  $("replay-summary").innerHTML = [
    ["Season", walkforward?.season ?? state.replay?.preseason?.season ?? "-"],
    ["Cutoff", walkforward?.preseason_cutoff ?? state.replay?.preseason?.preseason_cutoff ?? "-"],
    ["Training", walkforward?.training_window ?? state.replay?.preseason?.training_window ?? "-"],
    ["Data", walkforward?.data_status ?? "-"],
  ].map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
  const sources = walkforward?.sources ?? [];
  const counts = sources.reduce((result, source) => { result[source.status] = (result[source.status] ?? 0) + 1; return result; }, {});
  $("source-summary").innerHTML = Object.entries(counts).map(([status, count]) => `<div><strong>${escapeHtml(status)}</strong><span>${count} records</span></div>`).join("") || "<p>No source manifest loaded.</p>";
}

function renderPeriods() {
  $("period").innerHTML = state.checkpoints.filter((row) => row.target_period !== "terminal").map((row) => `<option value="${escapeHtml(row.target_period)}">${escapeHtml(row.target_period)} · cutoff ${escapeHtml(row.prediction_cutoff)}</option>`).join("");
}

function renderMetrics() {
  const weekly = state.metrics?.weekly ?? [];
  const regime = $("regime").value;
  const rows = weekly.filter((row) => row.regime === regime && row.mae !== undefined);
  $("metric-note").textContent = `${rows.length} weekly rows · ${regime}`;
  $("metrics-table").innerHTML = `<table><thead><tr><th>Period</th><th>Samples</th><th>MAE</th><th>RMSE</th><th>P10-P90</th><th>P50 pinball</th><th>Rank rho</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.target_period)}</td><td>${row.samples ?? 0}</td><td>${metric(row.mae)}</td><td>${metric(row.rmse)}</td><td>${metric(row.p10_p90_coverage)}</td><td>${metric(row.pinball_p50)}</td><td>${metric(row.spearman)}</td></tr>`).join("")}</tbody></table>`;
}

async function renderPredictions() {
  const period = $("period").value;
  const regime = $("regime").value;
  const playerId = $("player-id").value.trim();
  const query = new URLSearchParams({ period, regime, season: $("season").value, position: $("position").value });
  if (playerId) query.set("playerId", playerId);
  const rows = await getJson(`/api/modeling/predictions?${query}`);
  $("player-note").textContent = `${rows.length} rows · ${period}`;
  $("predictions-table").innerHTML = `<table><thead><tr><th>Player</th><th>Team</th><th>Mean</th><th>P10-P90</th><th>Rank</th><th>Actual</th><th>Status</th></tr></thead><tbody>${rows.sort((a, b) => (a.predicted_rank ?? 999) - (b.predicted_rank ?? 999)).slice(0, 50).map((row) => `<tr><td>${escapeHtml(row.player_name || row.player_id)}</td><td>${escapeHtml(row.team)}</td><td>${metric(row.mean)}</td><td>${metric(row.p10)} - ${metric(row.p90)}</td><td>${row.predicted_rank ?? "-"}</td><td>${metric(row.actual_points)}</td><td>${escapeHtml(row.outcome_status)}</td></tr>`).join("")}</tbody></table>`;
}

async function load() {
  try {
    [state.replay, state.checkpoints, state.metrics] = await Promise.all([
      getJson(scope("/api/modeling/replay")), getJson(scope("/api/modeling/checkpoints")), getJson(scope("/api/modeling/metrics"))
    ]);
    renderReplay();
    renderPeriods();
    renderMetrics();
    await renderPredictions();
  } catch (error) {
    $("run-state").textContent = `Replay unavailable: ${error.message}`;
  }
}

$("load").addEventListener("click", () => { void renderPredictions(); });
$("regime").addEventListener("change", () => { renderMetrics(); void renderPredictions(); });
$("season").addEventListener("change", () => { void load(); });
$("position").addEventListener("change", () => { void load(); });
void load();
