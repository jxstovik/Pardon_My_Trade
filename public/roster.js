(() => {
  const $ = (id) => document.getElementById(id);
  let csrfToken = "";
  let analytics;
  let league;
  let activeTeamId;
  let period = "";
  let lineupMode = "optimized";
  let selectedForecastId = "";
  const api = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["content-type"] = "application/json";
    if (options.method && options.method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
    const response = await fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `Request failed (${response.status})`), { status: response.status });
    return payload;
  };

  async function init() {
    try {
      const session = await api("/api/auth/session");
      if (!session.authenticated) return showLogin();
      csrfToken = session.csrfToken || "";
      showApp();
      await load();
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    } catch (error) {
      if (error.status === 401) showLogin();
      else setFreshness(error.message, true);
    }
  }

  function showLogin() {
    $("app").hidden = true;
    $("login").hidden = false;
  }

  function showApp() { $("login").hidden = true; $("app").hidden = false; }

  async function load() {
    setFreshness("Updating from latest league snapshot…");
    const query = new URLSearchParams();
    if (period) query.set("period", period);
    query.set("samples", "2000");
    const [leagueResult, analyticsResult, activityResult] = await Promise.allSettled([
      api("/api/league"), api(`/api/roster-analytics?${query}`), api(`/api/agent-status?${query}`)
    ]);
    if (leagueResult.status === "rejected") {
      const error = leagueResult.reason;
      if (error.status === 401) return showLogin();
      setFreshness(error.message, true);
      return;
    }
    league = leagueResult.value;
    analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : undefined;
    if (activityResult.status === "fulfilled") renderActivity(activityResult.value);
    render();
    if (!analytics) {
      const error = analyticsResult.reason;
      if (error?.status === 401) return showLogin();
      setFreshness(`Roster loaded · analytics unavailable: ${error?.message || "projection coverage is incomplete"}`, true);
    }
  }

  function render() {
    const meta = analytics?.metadata || {};
    const roster = analytics?.roster || {};
    const lineups = analytics?.lineups || {};
    const selectedLineup = lineups[lineupMode] || {};
    const dist = selectedLineup.distribution || roster[lineupMode] || {};
    const currentTeam = (league?.league?.teams || []).find((team) => team.team_id === (meta.teamId || activeTeamId)) || (league?.league?.platform === "fixture" ? league?.league?.teams?.[0] : undefined);
    const rosterSlots = currentTeam?.roster || { starters: [], bench: [], injured_reserve: [] };
    const players = analytics?.players || {};
    const starterSet = new Set(rosterSlots.starters.map((slot) => slot.player_id).filter(Boolean));
    const benchSet = new Set(rosterSlots.bench.map((slot) => slot.player_id).filter(Boolean));
    const injuredSet = new Set((rosterSlots.injured_reserve || []).map((slot) => slot.player_id).filter(Boolean));
    const rosterIds = new Set([...starterSet, ...benchSet, ...injuredSet]);
    const snapshotPlayers = new Map((league?.players || []).map((player) => [player.player_id, player]));
    const names = new Map([...snapshotPlayers].map(([id, player]) => [id, normalizePlayer(player)]).concat(Object.entries(players).map(([id, player]) => [id, normalizePlayer(player)])));
    const playerRows = [...rosterIds].map((id) => [id, normalizePlayer(players[id] || snapshotPlayers.get(id) || {})]);
    const demo = league?.league?.platform === "fixture" && /synthetic demo/i.test(league?.league?.name || "");
    $("demoBanner").hidden = !demo;
    const starterIds = selectedLineup.starters || [...starterSet];
    const starters = starterIds.map((id) => ({ id, ...(names.get(id) || {}) }));
    $("lineupLabel").textContent = lineupMode === "current" ? "CURRENT STARTING LINEUP" : "RECOMMENDED LINEUP";
    $("starterTitle").textContent = lineupMode === "current" ? "Current starters" : "Recommended starters";
    $("showCurrent").classList.toggle("selected", lineupMode === "current");
    $("showRecommended").classList.toggle("selected", lineupMode === "optimized");
    $("summary").textContent = currentTeam ? `${currentTeam.name} · ${meta.period || period || "Current period"}` : "No active team is configured for this league.";
    const asOf = meta.asOf ? new Date(meta.asOf).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "time unavailable";
    $("provenance").innerHTML = [
      `Snapshot ${esc(meta.snapshotId || "unknown")}`,
      `${esc(meta.modelVersion || "Model version unavailable")}`,
      `Updated ${esc(asOf)}`,
      analytics ? `${Number(analytics.freeAgents?.coverage?.covered || 0)} of ${Number(analytics.freeAgents?.coverage?.total || 0)} free agents covered` : "Forecast coverage unavailable"
    ].map((text) => `<span>${text}</span>`).join("");
    $("sampleCount").textContent = `${formatNumber(dist.samples)} simulations`;
    $("mean").textContent = number(dist.mean);
    $("range").textContent = `${number(dist.p10)}–${number(dist.p90)}`;
    drawHistogram("histogram", dist.histogram);
    const hist = dist.histogram || [];
    $("axisLow").textContent = hist.length ? number(hist[0].lower ?? hist[0].binStart) : number(dist.p10);
    $("axisHigh").textContent = hist.length ? number(hist.at(-1).upper ?? hist.at(-1).binEnd) : number(dist.p90);
    $("starters").innerHTML = starters.length ? starters.map((player) => starterRow(player.id, player, lineupMode === "current" ? "Current" : "Recommended")).join("") : `<p class="muted">Starter selection is unavailable.</p>`;
    $("players").innerHTML = playerRows.map(([id, player]) => {
      const role = starterSet.has(id) ? "Starter" : benchSet.has(id) ? "Bench" : injuredSet.has(id) ? "IR" : "Roster";
      const lineupStatus = starterIds.includes(id) ? (lineupMode === "current" ? "Starting" : "Recommended") : role;
      const value = player.distribution || {};
      return `<tr><td>${esc(player.name || id)}</td><td class="role">${role} · ${esc(player.position || "—")}</td><td class="role">${lineupStatus}</td><td class="role">${esc(player.projectionCoverage || "unavailable")}</td><td>${number(value.median)}</td><td>${number(value.p10)}–${number(value.p90)}</td></tr>`;
    }).join("");
    const cov = analytics?.freeAgents?.coverage || {};
    $("coverage").textContent = analytics ? `${formatNumber(playerRows.length)} player forecasts` : "Roster visible · forecast blocked by projection coverage";
    $("freeAgentCoverage").textContent = `${formatNumber(cov.covered)} / ${formatNumber(cov.total)} covered`;
    const freeAgents = analytics?.freeAgents?.players || [];
    $("addPlayer").innerHTML = `<option value="">Choose a free agent</option>${freeAgents.map((p) => `<option value="${attr(p.playerId)}">${esc(p.name)} · ${esc(p.position || "—")}</option>`).join("")}`;
    $("dropPlayer").innerHTML = `<option value="">Choose a roster player</option>${playerRows.filter(([id]) => !injuredSet.has(id)).map(([id, p]) => `<option value="${attr(id)}">${esc(p.name || id)} · ${esc(p.position || "—")}</option>`).join("")}`;
    $("forecastPlayer").innerHTML = `<option value="">Choose a roster player</option>${playerRows.map(([id, p]) => `<option value="${attr(id)}">${esc(p.name || id)} · ${esc(p.position || "—")}</option>`).join("")}`;
    if (playerRows.some(([id]) => id === selectedForecastId)) $("forecastPlayer").value = selectedForecastId;
    renderPlayerForecast($("forecastPlayer").value);
    $("blockers").textContent = analytics ? (analytics.freeAgents?.blockers || []).join(" · ") : "Analytics are unavailable because one or more required starters lack a supported projection or learned model. Refresh projections or models, then reload this page.";
    const periodSelect = $("period");
    const options = [meta.period, ...(analytics?.availablePeriods || [])].filter((v, i, all) => v && all.indexOf(v) === i);
    if (options.length && periodSelect.options.length === 1) {
      periodSelect.innerHTML = `<option value="">Current</option>${options.map((v) => `<option value="${attr(v)}">${esc(v)}</option>`).join("")}`;
      periodSelect.value = period;
    }
    const importedAt = league?.league?.import_metadata?.imported_at;
    const freshness = meta.asOf ? asOf : importedAt ? new Date(importedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "time unavailable";
    const ageMs = Date.now() - Date.parse(meta.asOf || importedAt || "");
    const ageLabel = Number.isFinite(ageMs) && ageMs >= 0 ? ageMs < 3600000 ? `${Math.floor(ageMs / 60000)}m old` : ageMs < 86400000 ? `${(ageMs / 3600000).toFixed(1)}h old` : `${Math.floor(ageMs / 86400000)}d old` : "age unavailable";
    const stale = !Number.isFinite(ageMs) || ageMs > 24 * 3600000;
    setFreshness(`Snapshot ${meta.snapshotId || league?.snapshot_id || "—"} · updated ${freshness} · ${ageLabel}${stale ? " · Stale" : ""}`, stale);
  }

  function renderActivity(activity) {
    activeTeamId = activity.teamId;
    const counts = activity.jobCounts || {};
    $("activityJobs").textContent = `${counts.queued || 0} / ${counts.running || 0}`;
    $("pendingActions").textContent = String(activity.pendingActions ?? 0);
    $("executionState").textContent = activity.executionEnabled ? "Enabled" : "Disabled";
    const jobs = activity.jobs || [];
    const snapshot = activity.snapshot;
    const age = snapshot?.ageSeconds;
    const ageLabel = age == null ? "snapshot age unavailable" : age < 3600 ? `${Math.floor(age / 60)}m old` : `${(age / 3600).toFixed(1)}h old`;
    const coverage = snapshot?.starterCount ? `${snapshot.coveredStarters}/${snapshot.starterCount} starters covered` : "starter coverage unavailable";
    $("jobActivity").innerHTML = `<span>${esc(ageLabel)} · ${esc(coverage)}</span>${jobs.length ? jobs.slice(0, 2).map((job) => `<span class="job-chip">${esc(job.type)} · ${esc(job.status)}</span>`).join("") : `<span>No recent agent jobs</span>`}`;
  }

  function drawHistogram(elementId, buckets) {
    const target = $(elementId);
    if (!Array.isArray(buckets) || !buckets.length) {
      target.innerHTML = `<div class="muted">Aggregated simulation histogram unavailable</div>`;
      return;
    }
    const max = Math.max(...buckets.map((bucket) => bucket.count || bucket.samples || 0), 1);
    const midpoint = buckets.length / 2;
    target.innerHTML = buckets.map((bucket, index) => {
      const count = bucket.count || bucket.samples || 0;
      const height = Math.max(3, Math.round((count / max) * 100));
      return `<i class="${Math.abs(index - midpoint) < buckets.length * .17 ? "mid" : ""}" style="height:${height}%" title="${esc(number(bucket.lower ?? bucket.binStart))}–${esc(number(bucket.upper ?? bucket.binEnd))}: ${formatNumber(count)} simulations"></i>`;
    }).join("");
  }

  function renderPlayerForecast(playerId) {
    const player = analytics?.players?.[playerId];
    const distribution = player?.distribution;
    if (!playerId || !player || !distribution) {
      $("playerForecastStats").textContent = analytics ? "Select a player with available projection coverage." : "Player simulations are unavailable until projection coverage is restored.";
      drawHistogram("playerHistogram", []);
      return;
    }
    $("playerForecastStats").textContent = `${player.name} · median ${number(distribution.median)} · P10–P90 ${number(distribution.p10)}–${number(distribution.p90)} · ${player.projectionCoverage} coverage`;
    drawHistogram("playerHistogram", distribution.histogram);
  }

  function starterRow(id, player, label) {
    return `<div class="starter-row"><span class="position">${esc(player.position || "—")}</span><div class="player-name">${esc(player.name || id)}</div><span class="chance">${label}</span></div>`;
  }

  async function compare() {
    const addPlayerId = $("addPlayer").value;
    const dropPlayerId = $("dropPlayer").value;
    if (!addPlayerId || !dropPlayerId) return;
    const button = $("compare");
    button.disabled = true; button.textContent = "Simulating…";
    try {
      const result = await api("/api/free-agent-scenarios", { method: "POST", body: JSON.stringify({ addPlayerId, dropPlayerId, period: period || undefined, samples: 2000 }) });
      const delta = result.delta || {};
      const dist = delta.distribution || {};
      const average = Number(delta.mean ?? dist.mean ?? 0);
      const probability = Number(delta.probabilityImproves ?? 0);
      $("scenario").hidden = false;
      $("scenario").innerHTML = `<div class="delta ${average >= 0 ? "positive" : "negative"}">${average >= 0 ? "+" : ""}${number(average)} points expected</div><p>${Math.round(probability * 100)}% chance this move improves your optimized lineup · paired simulations</p><p>Projected change range: ${number(dist.p10)} to ${number(dist.p90)} points</p>`;
    } catch (error) {
      if (error.status === 401) showLogin();
      else { $("scenario").hidden = false; $("scenario").innerHTML = `<p class="error">${esc(error.message)}</p>`; }
    } finally { button.disabled = false; button.textContent = "Compare move"; }
  }

  function setFreshness(value, error = false) { $("freshness").textContent = value; $("freshness").style.color = error ? "var(--coral)" : ""; }
  function number(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—"; }
  function formatNumber(value) { return Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : "—"; }
  function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  function attr(value) { return esc(value); }
  function normalizePlayer(player) {
    return { ...player, name: player.name || player.full_name, position: player.position || player.positions?.[0] || "—" };
  }

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault(); $("loginError").textContent = "";
    try {
      const session = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
      csrfToken = session.csrfToken; $("password").value = ""; showApp(); await load();
    } catch (error) { $("loginError").textContent = error.message; }
  });
  $("refresh").addEventListener("click", load);
  $("period").addEventListener("change", (event) => { period = event.target.value; load(); });
  $("showCurrent").addEventListener("click", () => { lineupMode = "current"; render(); });
  $("showRecommended").addEventListener("click", () => { lineupMode = "optimized"; render(); });
  $("forecastPlayer").addEventListener("change", (event) => { selectedForecastId = event.target.value; renderPlayerForecast(selectedForecastId); });
  $("compare").addEventListener("click", compare);
  init();
})();
