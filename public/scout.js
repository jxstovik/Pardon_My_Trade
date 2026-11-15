(() => {
  const $ = (id) => document.getElementById(id);
  const SLOTS = [["QB", "QB"], ["RB1", "RB"], ["RB2", "RB"], ["WR1", "WR"], ["WR2", "WR"], ["TE", "TE"], ["FLEX", "FLEX"], ["D/ST", "DST"], ["K", "K"]];
  const COLORS = { current: "#91b7df", recommended: "#d3ec93", opponent: "#efa18a", scenario: "#a8e2bf", scenarioOpp: "#f0b986" };
  const $esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let data;
  let owner;
  let opponent;
  let recommended;
  let ownerScenario;
  let opponentScenario;
  let sampleCache = new Map();

  async function init() {
    try {
      const response = await fetch("/scout-data.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Model forecast data unavailable (${response.status}). Run npm run scout:data to rebuild the dashboard data.`);
      data = await response.json();
      owner = data.teams.find((team) => team.name === data.meta.owner);
      opponent = data.teams.find((team) => team.name === data.meta.opponent);
      if (!owner || !opponent) throw new Error("The saved weekly matchup roster is incomplete.");
      recommended = recommendLineup(owner);
      ownerScenario = { ...owner.currentLineup };
      opponentScenario = { ...opponent.currentLineup };
      renderProvenance();
      if (location.pathname === "/scout/players" || location.pathname.endsWith("player-comparison.html")) renderPlayerLab();
      else renderScout();
    } catch (error) {
      document.querySelector("main").innerHTML = `<div class="error-panel">${$esc(error.message)}</div>`;
    }
  }

  function renderProvenance() {
    const stamp = new Date(data.meta.asOf).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    const bits = [`Week ${data.meta.week} · ${data.meta.season}`, `Stats through ${data.meta.statsCutoff}`, ...(data.meta.rosterReadAt ? [`Live rosters read ${data.meta.rosterReadAt}`] : []), `${data.meta.modelStatus}`, data.meta.distributionNote, data.meta.newsStatus, `Source data SHA ${data.meta.statsSha256.slice(0, 12)}`];
    const status = $("dataStatus");
    if (status) status.textContent = `Model built ${stamp}${data.meta.rosterReadAt ? ` · ESPN read ${new Date(data.meta.rosterReadAt).toLocaleString()}` : ""}`;
    if ($("provenance")) $("provenance").innerHTML = bits.map((bit) => `<span>${$esc(bit)}</span>`).join("");
    if ($("modelCaveat")) $("modelCaveat").textContent = "D/ST targets use repaired fumble-recovery and touchdown rules, with captured 2026 ESPN stat counts rescored using league settings. Historical D/ST component parity and offensive returner scoring remain incompletely reconciled. Experimental interval calibration is unpromoted; these charts use the candidate models’ original quantiles.";
  }

  function recommendLineup(team) {
    const candidates = team.players.filter((player) => player.group !== "IR" && !["IR", "O", "D"].includes(player.status) && !(player.completed && player.group === "bench"));
    const used = new Set();
    const result = {};
    const takeBest = (position, key, filter = (p) => !p.bye) => {
      const player = candidates.filter((p) => p.position === position && !used.has(p.name) && filter(p)).sort((a, b) => b.mean - a.mean)[0];
      if (player) { result[key] = player.name; used.add(player.name); }
    };
    takeBest("QB", "QB");
    takeBest("RB", "RB1"); takeBest("RB", "RB2");
    takeBest("WR", "WR1"); takeBest("WR", "WR2");
    takeBest("TE", "TE");
    const flex = candidates.filter((p) => ["RB", "WR", "TE"].includes(p.position) && !used.has(p.name) && !p.bye && !p.locked && !["IR", "O", "D"].includes(p.status)).sort((a, b) => b.mean - a.mean)[0];
    if (flex) { result.FLEX = flex.name; used.add(flex.name); }
    takeBest("DST", "D/ST"); takeBest("K", "K");
    for (const [slot] of SLOTS) if (!result[slot]) result[slot] = team.currentLineup[slot] || "";
    return result;
  }

  function playerByName(team, name) { return team.players.find((p) => p.name === name) || data.freeAgents.find((p) => p.name === name); }
  function meanForLineup(team, lineup, chaseActive = true) {
    return SLOTS.reduce((sum, [slot]) => {
      const player = playerByName(team, lineup[slot]);
      if (!player || player.bye || ["IR", "O"].includes(player.status)) return sum;
      if (!chaseActive && player.name === "Ja'Marr Chase") return sum;
      return sum + Number(player.mean || 0);
    }, 0);
  }

  function hashSeed(text) {
    let h = 2166136261;
    for (const char of text) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0 || 1;
  }
  function rng(seed) {
    let state = seed >>> 0;
    return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  }
  function playerSamples(player, chaseActive = true, count = 7000) {
    if (!player) return new Float32Array(count);
    const key = `${player.name}|${chaseActive}|${count}`;
    if (sampleCache.has(key)) return sampleCache.get(key);
    const values = new Float32Array(count);
    if (player.bye || ["IR", "O"].includes(player.status) || (!chaseActive && player.name === "Ja'Marr Chase")) { sampleCache.set(key, values); return values; }
    const qs = Object.entries(player.quantiles || {}).map(([q, score]) => [Number(q) / 100, Number(score)]).filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1])).sort((a, b) => a[0] - b[0]);
    if (!qs.length) { values.fill(Number(player.mean || 0)); sampleCache.set(key, values); return values; }
    const random = rng(hashSeed(player.name));
    for (let i = 0; i < count; i++) {
      const u = random();
      let left = qs[0]; let right = qs[qs.length - 1];
      if (u <= left[0]) values[i] = left[1];
      else if (u >= right[0]) values[i] = right[1];
      else {
        for (let j = 1; j < qs.length; j++) if (u <= qs[j][0]) { left = qs[j - 1]; right = qs[j]; break; }
        const t = (u - left[0]) / (right[0] - left[0]);
        values[i] = left[1] + t * (right[1] - left[1]);
      }
    }
    sampleCache.set(key, values);
    return values;
  }
  function teamSamples(team, lineup, chaseActive = true) {
    const count = 7000;
    const total = new Float32Array(count);
    for (const [slot] of SLOTS) {
      const player = playerByName(team, lineup[slot]);
      const values = playerSamples(player, chaseActive, count);
      for (let i = 0; i < count; i++) total[i] += values[i];
    }
    return total;
  }
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const at = (sorted.length - 1) * p; const low = Math.floor(at); const high = Math.ceil(at);
    return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
  }
  function stats(values, mean) {
    const sorted = Array.from(values).sort((a, b) => a - b);
    return { mean, p10: percentile(sorted, .1), p25: percentile(sorted, .25), median: percentile(sorted, .5), p75: percentile(sorted, .75), p90: percentile(sorted, .9), p05: percentile(sorted, .05), p95: percentile(sorted, .95) };
  }
  function chanceToWin(ownDraws, opponentDraws) {
    let wins = 0;
    for (let i = 0; i < ownDraws.length; i++) if (ownDraws[i] > opponentDraws[i]) wins++;
    return wins / ownDraws.length;
  }
  function number(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—"; }
  function pct(v) { return `${Math.round(Number(v) * 100)}%`; }

  function density(samples, xs, bandwidth) {
    const result = new Array(xs.length).fill(0);
    const inv = 1 / (samples.length * bandwidth * Math.sqrt(2 * Math.PI));
    for (let i = 0; i < xs.length; i++) {
      let sum = 0;
      for (let j = 0; j < samples.length; j++) {
        const z = (xs[i] - samples[j]) / bandwidth;
        if (Math.abs(z) < 4) sum += Math.exp(-.5 * z * z);
      }
      result[i] = sum * inv;
    }
    return result;
  }
  function drawChart(elementId, series, opts = {}) {
    const target = $(elementId);
    if (!target) return;
    if (!series.length) { target.innerHTML = `<p class="muted">No forecast curves to display.</p>`; return; }
    const quantileVals = series.flatMap((item) => { const s = stats(item.values, item.mean); return [s.p05, s.p95]; });
    let xMin = Math.floor(Math.min(...quantileVals) - 3); let xMax = Math.ceil(Math.max(...quantileVals) + 3);
    if (opts.player) xMin = Math.floor(Math.min(...quantileVals) - 2);
    xMin = Math.min(xMin, 0); if (xMax - xMin < 20) xMax = xMin + 20;
    if (opts.xRange) [xMin, xMax] = opts.xRange;
    const width = opts.width || 900; const height = opts.height || 270; const ml = 45; const mr = 14; const mt = 14; const mb = 31;
    const plotW = width - ml - mr; const plotH = height - mt - mb; const steps = 88;
    const xs = Array.from({ length: steps }, (_, i) => xMin + (xMax - xMin) * i / (steps - 1));
    const bandwidth = Math.max(opts.player ? 1.2 : 2.0, (xMax - xMin) / 95);
    const curves = series.map((item) => ({ ...item, ys: density(item.values, xs, bandwidth) }));
    const scaleCurves = opts.scaleValues ? opts.scaleValues.filter((values) => !values.every((value) => value === values[0])).map((values) => density(values, xs, bandwidth)) : curves.map((c) => c.ys);
    const maxY = Math.max(...scaleCurves.flat(), 0.001) * 1.12;
    const px = (x) => ml + ((x - xMin) / (xMax - xMin)) * plotW;
    const py = (y) => mt + plotH - (y / maxY) * plotH;
    const ticksX = 5; const ticksY = 4;
    const gridX = Array.from({ length: ticksX + 1 }, (_, i) => xMin + (xMax - xMin) * i / ticksX);
    const gridY = Array.from({ length: ticksY + 1 }, (_, i) => maxY * i / ticksY);
    const grids = gridY.map((y) => `<line class="gridline" x1="${ml}" y1="${py(y)}" x2="${width - mr}" y2="${py(y)}"/>`).join("") + gridX.map((x) => `<line class="gridline" x1="${px(x)}" y1="${mt}" x2="${px(x)}" y2="${mt + plotH}"/><text class="axis-label" text-anchor="middle" x="${px(x)}" y="${height - 9}">${number(x)}</text>`).join("");
    const paths = curves.map((curve) => {
      if (curve.values.every((v) => v === curve.values[0])) return `<path class="density-line" d="M${px(curve.values[0])},${py(0)} L${px(curve.values[0])},${mt}" stroke="${curve.color}"/><text class="axis-label" x="${px(curve.values[0]) + 6}" y="${mt + 12}">Certain ${number(curve.values[0])} pts</text>`;
      const coords = curve.ys.map((y, i) => [px(xs[i]), py(y)]);
      const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      const area = `${line} L${px(xs.at(-1)).toFixed(1)},${py(0).toFixed(1)} L${px(xs[0]).toFixed(1)},${py(0).toFixed(1)} Z`;
      const dashed = curve.dashed ? " dashed" : "";
      return `<path class="density-area${dashed}" d="${area}" fill="${curve.color}"/><path class="density-line${dashed}" d="${line}" stroke="${curve.color}"/>`;
    }).join("");
    const meanLines = curves.map((curve) => `<line x1="${px(curve.mean)}" y1="${mt}" x2="${px(curve.mean)}" y2="${mt + plotH}" stroke="${curve.color}" stroke-width="1" stroke-dasharray="3 5" opacity=".7"><title>${$esc(curve.name)} model mean ${number(curve.mean)}</title></line>`).join("");
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${$esc(opts.aria || "Scoring distributions")}" xmlns="http://www.w3.org/2000/svg"><g>${grids}</g>${paths}${meanLines}<text class="chart-title" text-anchor="middle" x="${ml + plotW / 2}" y="${height - 1}">Fantasy points · model distributions</text></svg>`;
  }
  function legend(items, elementId) {
    const target = $(elementId); if (!target) return;
    target.innerHTML = items.map((item) => `<span class="legend-item"><i class="legend-line${item.dashed ? " dashed" : ""}" style="--series:${item.color}"></i>${$esc(item.label)}</span>`).join("");
  }
  function distributionCard(label, s, chance, sublabel = "") {
    return `<div class="dist-card"><span class="label">${$esc(label)}</span><strong>${number(s.mean)}</strong><small>Middle 80% ${number(s.p10)}–${number(s.p90)}${chance == null ? "" : ` · win ${pct(chance)}`}${sublabel ? ` · ${$esc(sublabel)}` : ""}</small></div>`;
  }
  function lineupDraw(team, lineup, active) {
    const values = teamSamples(team, lineup, active);
    return { values, summary: stats(values, meanForLineup(team, lineup, active)) };
  }
  function renderScout() {
    $("ownerName").textContent = owner.name; $("opponentName").textContent = opponent.name;
    $("ownerRecord").textContent = owner.record ? `(${owner.record})` : "";
    $("opponentRecord").textContent = opponent.record ? `(${opponent.record})` : "";
    $("subtitle").textContent = `${data.meta.leagueName} · 10-team PPR · Week ${data.meta.week} · current lineups from ${data.meta.lineupSource || "saved ESPN screenshots"}, forecasts from PMT models.`;
    $("lineupRule").textContent = "1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX · 1 D/ST · 1 K";
    const chaseToggle = $("chaseActive");
    const hasChase = opponent.players.some(p => p.name === "Ja'Marr Chase");
    chaseToggle.closest("label").hidden = !hasChase;
    $("matchupTitle").textContent = `${opponent.name} vs ${owner.name}`;
    const active = hasChase ? chaseToggle.checked : true;
    const cur = lineupDraw(owner, owner.currentLineup, active);
    const rec = lineupDraw(owner, recommended, active);
    const opp = lineupDraw(opponent, opponent.currentLineup, active);
    const curWin = chanceToWin(cur.values, opp.values);
    const recWin = chanceToWin(rec.values, opp.values);
    legend([
      { label: "Your current", color: COLORS.current },
      { label: "Your recommended", color: COLORS.recommended },
      { label: `${opponent.name} · ${hasChase ? (active ? "Chase active" : "Chase out") : "current lineup"}`, color: COLORS.opponent }
    ], "baselineLegend");
    drawChart("baselineChart", [
      { name: "Your current", values: cur.values, mean: cur.summary.mean, color: COLORS.current },
      { name: "Your recommended", values: rec.values, mean: rec.summary.mean, color: COLORS.recommended },
      { name: `${opponent.name} current`, values: opp.values, mean: opp.summary.mean, color: COLORS.opponent }
    ], { height: 285, aria: "Model distribution of current and recommended lineup scores" });
    $("baselineStats").innerHTML = [distributionCard("Your current", cur.summary, curWin), distributionCard("Your recommended", rec.summary, recWin), distributionCard(`${opponent.name} current`, opp.summary, null, hasChase ? (active ? "Chase active" : "Chase out") : "current lineup")].join("");
    const chaseOutOpp = lineupDraw(opponent, opponent.currentLineup, false);
    const chaseOutWin = chanceToWin(cur.values, chaseOutOpp.values);
    $("sensitivity").innerHTML = hasChase ? `Against the same model draws, your current lineup has a <strong>${pct(chanceToWin(cur.values, lineupDraw(opponent, opponent.currentLineup, true).values))}</strong> win chance with Chase active and <strong>${pct(chaseOutWin)}</strong> if Chase is out with his slot left empty; substitute Shakir to model an opponent replacement. Those are scenario results, not a probability that he will play.` : "Edit either roster below to compare legal lineup combinations. Forecasts for questionable players assume they play; out, IR and bye players score zero.";

    $("currentMean").textContent = `${number(meanForLineup(owner, owner.currentLineup, active))} model pts`;
    $("recommendedMean").textContent = `${number(meanForLineup(owner, recommended, active))} model pts`;
    $("currentLineup").innerHTML = renderLineupRows(owner, owner.currentLineup);
    $("recommendedLineup").innerHTML = renderLineupRows(owner, recommended, true);
    const delta = meanForLineup(owner, recommended, active) - meanForLineup(owner, owner.currentLineup, active);
    $("lineupDelta").innerHTML = delta > .05 ? `<strong>+${number(delta)} expected model points</strong> versus the submitted lineup.` : `The model keeps your current starters: no roster-only swap raises the projected mean.`;
    renderMatchup(active);
    renderScenario(active);
    renderWaivers(); renderBench(); renderNews(); renderRules(); renderDiagnostics();
    chaseToggle.onchange = () => { sampleCache = new Map(); renderScout(); };
    $("resetOwner").onclick = () => { ownerScenario = { ...recommended }; refreshSelection(); };
    $("resetCurrent").onclick = () => { ownerScenario = { ...owner.currentLineup }; refreshSelection(); };
    $("resetOpponent").onclick = () => { opponentScenario = { ...opponent.currentLineup }; refreshSelection(); };
  }

  function renderLineupRows(team, lineup, recommendedLineup = false) {
    return SLOTS.map(([slot]) => {
      const player = playerByName(team, lineup[slot]);
      const value = player ? player.mean : 0;
      const note = player ? `${player.team || "—"} · vs ${player.opponent || "—"}${player.bye ? " · BYE" : ""}` : "No forecast";
      const status = player?.status && player.status !== "—" ? `<span class="tag status">${$esc(player.status)}</span>` : "";
      const moved = recommendedLineup && owner.currentLineup[slot] !== lineup[slot] ? " · model move" : "";
      return `<div class="lineup-row"><span class="slot-badge">${$esc(slot)}</span><div><div class="player-main">${$esc(lineup[slot] || "—")}${status}</div><div class="player-sub">${$esc(note)}${$esc(moved)}</div></div><div class="player-score">${number(value)}<div class="player-sub">model pts</div></div></div>`;
    }).join("");
  }

  function slotEligible(player, slot) {
    if (!player || (player.completed && player.group === "bench") || player.group === "IR" || ["IR", "O"].includes(player.status)) return false;
    if (slot === "FLEX") return ["RB", "WR", "TE"].includes(player.position);
    const position = slot.startsWith("RB") ? "RB" : slot.startsWith("WR") ? "WR" : slot === "D/ST" ? "DST" : slot;
    return player.position === position;
  }
  function swapLineup(team, lineup, slot, name) {
    if (!SLOTS.some(([key]) => key === slot)) throw new Error("Unknown lineup slot.");
    const incoming = team.players.find((p) => p.name === name);
    if (team.players.find(p => p.name === lineup[slot])?.completed || incoming?.completed) throw new Error("Completed Thursday players are locked in their recorded slots.");
    if (name && !slotEligible(incoming, slot)) throw new Error("That player cannot fill this slot.");
    const result = { ...lineup };
    const source = name ? SLOTS.find(([key]) => key !== slot && result[key] === name)?.[0] : undefined;
    if (source) {
      const outgoing = team.players.find((p) => p.name === result[slot]);
      if (result[slot] && !slotEligible(outgoing, source)) throw new Error(`Empty ${slot} first; its player cannot move to ${source}.`);
      result[source] = result[slot] || "";
    }
    result[slot] = name;
    return result;
  }
  function refreshSelection() {
    const active = $("chaseActive").checked;
    renderMatchup(active); renderScenario(active); renderBench();
  }
  function renderMatchup(active) {
    const cell = (team, lineup, slot, side) => {
      const p = playerByName(team, lineup[slot]);
      const options = team.players.filter((player) => slotEligible(player, slot)).sort((a, b) => b.mean - a.mean).map((player) => {
        const source = SLOTS.find(([key]) => key !== slot && lineup[key] === player.name)?.[0];
        const outgoing = team.players.find((row) => row.name === lineup[slot]);
        const blocked = source && lineup[slot] && !slotEligible(outgoing, source);
        return `<option value="${$esc(player.name)}"${lineup[slot] === player.name ? " selected" : ""}${blocked ? " disabled" : ""}>${$esc(player.name)} · ${number(player.mean)}${source ? ` · from ${source}${blocked ? " (empty target first)" : " (swap)"}` : ""}${player.bye ? " · BYE" : ""}${player.status && player.status !== "—" ? ` · ${$esc(player.status)}` : ""}</option>`;
      }).join("");
      const zero = !p || p.bye || ["IR", "O"].includes(p.status) || (!active && p.name === "Ja'Marr Chase");
      const mean = zero ? 0 : p.mean;
      return `<div class="matchup-player ${side}"><label><span class="sr-only">${$esc(team.name)} ${slot}</span><select${p?.completed ? " disabled" : ""} data-team="${side}" data-slot="${slot}" aria-label="${$esc(team.name)} ${slot}"><option value=""${!lineup[slot] ? " selected" : ""}>Empty slot (0 points)</option>${options}</select></label><div class="matchup-meta"><span>${p ? `${$esc(p.position)} · ${$esc(p.team)} vs ${$esc(p.opponent)}${p.status && p.status !== "—" ? ` · ${$esc(p.status)}` : ""}` : "No starter selected"}</span><strong>${number(mean)} pts</strong></div><div id="slotCurve-${side}-${slot.replace("/", "")}" class="slot-curve"></div><span class="curve-note">${zero ? "Certain zero points in this scenario" : p.completed ? "Completed game · fixed actual points" : "Density curve · dotted line = model mean"}</span></div>`;
    };
    $("matchupRows").innerHTML = SLOTS.map(([slot]) => `<div class="matchup-row">${cell(opponent, opponentScenario, slot, "opponent")}<span class="slot-badge">${slot}</span>${cell(owner, ownerScenario, slot, "owner")}</div>`).join("");
    for (const [slot] of SLOTS) {
      const left = playerByName(opponent, opponentScenario[slot]); const right = playerByName(owner, ownerScenario[slot]);
      const leftValues = playerSamples(left, active, 2000); const rightValues = playerSamples(right, active, 2000);
      const bounds = [left, right].filter(Boolean).flatMap((p) => Object.values(p.quantiles || {}).map(Number));
      const range = [Math.floor(Math.min(0, ...bounds) - 2), Math.ceil(Math.max(20, ...bounds) + 2)];
      for (const [side, p, values, color] of [["opponent", left, leftValues, COLORS.opponent], ["owner", right, rightValues, COLORS.scenario]]) {
        const zero = !p || p.bye || ["IR", "O"].includes(p.status) || (!active && p.name === "Ja'Marr Chase");
        drawChart(`slotCurve-${side}-${slot.replace("/", "")}`, [{ name: p?.name || "Empty slot", values, mean: zero ? 0 : p.mean, color }], { width: 360, height: 160, player: true, xRange: range, scaleValues: [leftValues, rightValues], aria: `${slot} ${p?.name || "empty slot"} projected points density` });
      }
    }
    $("matchupRows").querySelectorAll("select").forEach((select) => select.addEventListener("change", (event) => {
      const target = event.currentTarget; const isOwner = target.dataset.team === "owner";
      try {
        const result = swapLineup(isOwner ? owner : opponent, isOwner ? ownerScenario : opponentScenario, target.dataset.slot, target.value);
        if (isOwner) ownerScenario = result; else opponentScenario = result;
        $("swapMessage").textContent = `${isOwner ? owner.name : opponent.name}: ${target.value || "empty"} at ${target.dataset.slot}. Team curves and win probabilities updated.`;
      } catch (error) { $("swapMessage").textContent = error.message; }
      refreshSelection();
    }));
  }
  function renderScenario(active) {
    const own = lineupDraw(owner, ownerScenario, active); const opp = lineupDraw(opponent, opponentScenario, active);
    const ownCurrent = lineupDraw(owner, owner.currentLineup, active); const oppCurrent = lineupDraw(opponent, opponent.currentLineup, active);
    const win = chanceToWin(own.values, opp.values);
    const ownDelta = own.summary.mean - ownCurrent.summary.mean; const oppDelta = opp.summary.mean - oppCurrent.summary.mean;
    $("ownerScenarioTitle").textContent = `${owner.name} · ${number(own.summary.mean)} pts`;
    $("opponentScenarioTitle").textContent = `${opponent.name} · ${number(opp.summary.mean)} pts`;
    $("scenarioSummary").innerHTML = [
      distributionCard("Opponent · left", opp.summary, 1 - win - Array.from(own.values).filter((v, i) => v === opp.values[i]).length / own.values.length, `${oppDelta >= 0 ? "+" : ""}${number(oppDelta)} vs current`),
      distributionCard("Your team · right", own.summary, win, `${ownDelta >= 0 ? "+" : ""}${number(ownDelta)} vs current`),
      `<div class="dist-card"><span class="label">Scenario win chance</span><strong>${pct(win)}</strong><small>${opponent.players.some(p => p.name === "Ja'Marr Chase") ? (active ? "Chase active" : "Chase out") : "Selected lineups"} · ${number(own.summary.mean - opp.summary.mean)} mean-point margin</small></div>`
    ].join("");
    legend([
      { label: "Your current", color: COLORS.current, dashed: true },
      { label: "Your scenario", color: COLORS.scenario },
      { label: "Opponent current", color: COLORS.opponent, dashed: true },
      { label: "Opponent scenario", color: COLORS.scenarioOpp }
    ], "scenarioLegend");
    drawChart("scenarioChart", [
      { name: "Your current", values: ownCurrent.values, mean: ownCurrent.summary.mean, color: COLORS.current, dashed: true },
      { name: "Your scenario", values: own.values, mean: own.summary.mean, color: COLORS.scenario },
      { name: "Opponent current", values: oppCurrent.values, mean: oppCurrent.summary.mean, color: COLORS.opponent, dashed: true },
      { name: "Opponent scenario", values: opp.values, mean: opp.summary.mean, color: COLORS.scenarioOpp }
    ], { height: 260, aria: "Model score distributions for edited lineups compared with current lineups" });
  }

  function renderWaivers() {
    const flex = data.freeAgents.filter((p) => ["RB", "WR", "TE"].includes(p.position) && !p.bye && !p.locked && !["IR", "O", "D"].includes(p.status)).sort((a, b) => b.mean - a.mean).slice(0, 4);
    const currentFlex = playerByName(owner, owner.currentLineup.FLEX);
    $("flexAdds").innerHTML = `<h3>Best available FLEX-eligible forecasts</h3>${flex.map((p, i) => `<div class="mini-row"><div><strong>${$esc(p.name)}${p.status && p.status !== "—" ? ` <span class="warning">· ${$esc(p.status)}</span>` : ""}</strong><p>${$esc(p.position)} · ${$esc(p.team)} vs ${$esc(p.opponent)} · ${i === 0 && currentFlex && currentFlex.mean > p.mean ? `below current FLEX ${$esc(currentFlex.name)} (${number(currentFlex.mean)})` : "model forecast conditional on status"}</p></div><div class="value">${number(p.mean)} <span>pts</span></div></div>`).join("")}<p class="callout">${flex[0] && currentFlex && flex[0].mean > currentFlex.mean ? `${$esc(flex[0].name)} is ${number(flex[0].mean - currentFlex.mean)} mean points above ${$esc(currentFlex.name)}, conditional on playing; compare availability and roster cost before a claim.` : `No modeled available FLEX option beats ${$esc(currentFlex?.name || "your current FLEX")} on mean.`} Keep Michael Wilson at WR.</p>`;
    const dst = data.freeAgents.filter((p) => p.position === "DST" && !p.bye && !p.locked && !["IR", "O", "D"].includes(p.status)).sort((a, b) => b.mean - a.mean).slice(0, 4);
    const currentDst = playerByName(owner, owner.currentLineup["D/ST"]);
    const dropCandidate = owner.players.filter((p) => p.group === "bench" && p.position !== "DST").sort((a, b) => a.mean - b.mean)[0];
    const topDst = dst[0];
    const edge = topDst && currentDst ? topDst.mean - currentDst.mean : 0;
    const dstCall = topDst && currentDst && edge > 0
      ? `The model’s top visible stream is ${$esc(topDst.name)} (+${number(edge)} mean points vs Bills). Your one-defense policy means a stream replaces Bills D/ST; do not cut an offensive bench player to carry a second defense. Otherwise keep Buffalo given D/ST variance.`
      : "Keep Bills D/ST; the visible options do not show a meaningful model edge.";
    $("dstAdds").innerHTML = `<h3>Available D/ST model ranking</h3>${dst.map((p) => `<div class="mini-row"><div><strong>${$esc(p.name)}</strong><p>${$esc(p.team)} vs ${$esc(p.opponent)} · ${number(p.mean - (currentDst?.mean || 0))} vs current Bills D/ST</p></div><div class="value">${number(p.mean)} <span>pts</span></div></div>`).join("")}<p class="callout">${dstCall} Team defense forecasts use the ESPN points-allowed and total-yards-allowed tiers.</p>`;
  }
  function renderBench() {
    const recommendedNames = new Set(Object.values(recommended));
    const selectedNames = new Set(Object.values(ownerScenario));
    const lowest = owner.players.filter((p) => p.group === "bench" && !recommendedNames.has(p.name)).sort((a, b) => a.mean - b.mean)[0];
    const rows = owner.players;
    $("benchPlan").innerHTML = rows.map((p, i) => {
      let action = "BENCH / KEEP"; let reason = "Keep as roster depth; below the recommended starters by this week's model mean.";
      if (recommendedNames.has(p.name)) { action = "START"; reason = "Start or retain in the model's recommended lineup, conditional on availability."; }
      else if (p.name === "Brian Robinson Jr.") { action = "BENCH / KEEP"; reason = "Added for RB/FLEX depth. His 10.2-point active-state mean is below your current starters; keep him available if Pollard is inactive."; }
      else if (["D", "O"].includes(p.status) || ["IR", "O"].includes(p.status) || p.group === "IR") { action = "STASH / MONITOR"; reason = "Keep pending availability updates; this active-state forecast does not assume clearance."; }
      else if (p.bye || p.name === "Tyjae Spears") { action = "STASH / KEEP"; reason = p.bye ? "No game this week; retain depth through the bye." : "Retain RB depth behind Pollard; a low one-week mean alone is insufficient to cut."; }
      return `<article class="action-row"><div class="action-heading"><strong>${$esc(p.name)}</strong><span class="action-badge ${action === "CUT CANDIDATE" ? "cut" : action === "START" ? "start" : ""}">${action}</span></div><p>${$esc(p.position)} · ${number(p.mean)} model pts${p.status && p.status !== "—" ? ` · ${$esc(p.status)}` : ""} · ${selectedNames.has(p.name) ? "starting in your edited lineup" : "on your edited bench"}</p><p>${reason}</p><div id="benchCurve-${i}" class="bench-curve"></div></article>`;
    }).join("") + `<p class="callout">Carry one defense. Bench, stash and cut labels are advisory; no roster action is made by this report. Confirm injury status and lineup locks before acting.</p>`;
    rows.forEach((p, i) => drawChart(`benchCurve-${i}`, [{ name: p.name, values: playerSamples(p, true, 2000), mean: p.bye || ["IR", "O"].includes(p.status) ? 0 : p.mean, color: COLORS.scenario }], { width: 360, height: 135, player: true, aria: `${p.name} bench scoring density` }));
  }
  function renderNews() {
    $("newsList").innerHTML = data.meta.news.map((item) => `<article class="news-item"><p class="eyebrow">${$esc(item.date)} · ${$esc(item.source)}</p><h3>${$esc(item.headline)}</h3><p>${$esc(item.detail)}</p><p><strong>Fantasy impact:</strong> ${$esc(item.impact)}</p><a href="${$esc(item.url)}" target="_blank" rel="noreferrer">View source ↗</a></article>`).join("");
  }
  function renderRules() {
    const rules = data.meta.scoring;
    const groups = rules.categories.map((group) => `<div class="rule-group"><h3>${$esc(group.group)}</h3>${group.rows.map(([label, score]) => `<div class="rule-row"><span>${$esc(label)}</span><span>${$esc(score)}</span></div>`).join("")}</div>`).join("");
    const positions = rules.positions.map((position) => `<span>${$esc(position.label)}: ${$esc(position.starters)}${position.maximum ? ` · max ${$esc(position.maximum)}` : ""}</span>`).join("");
    const transactions = rules.transactionRules.map(([label, value]) => `<span>${$esc(label)}: ${$esc(value)}</span>`).join("");
    $("rulesContent").innerHTML = `<p class="rules-intro">${$esc(rules.scoringType)} · 10 teams · nine starters · ${$esc(rules.source)}. Values transcribed from the league settings page supplied for this report.</p><div class="rule-pills">${positions}${transactions}</div><div class="rule-columns">${groups}</div><p class="subnote">Projection alignment: all six candidate position models were retrained with these ESPN scoring weights, including kicker misses and D/ST points-allowed and total-yards-allowed tiers. NFLverse does not separately identify rare D/ST 1-point safeties, so that event is excluded from the D/ST model target.</p><a class="settings-link" href="${$esc(rules.sourceUrl)}" target="_blank" rel="noreferrer">Open ESPN settings ↗</a>`;
  }

  function renderDiagnostics() {
    const metrics = Object.entries(data.meta.validation || {});
    $("modelValidation").innerHTML = `<div class="table-scroll"><table><thead><tr><th>Position</th><th>2025 games</th><th>Candidate MAE</th><th>Baseline MAE</th><th>80% interval coverage</th></tr></thead><tbody>${metrics.map(([position, m]) => `<tr><td>${$esc(position)}</td><td>${Number(m.n).toLocaleString()}</td><td>${number(m.model_mae)}</td><td>${number(m.baseline_mae)}</td><td>${pct(m.q10_q90_coverage)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderPlayerLab() {
    const all = [...owner.players, ...opponent.players, ...data.freeAgents].filter((p) => p.quantiles);
    const position = $("positionFilter");
    const selectA = $("playerA"); const selectB = $("playerB");
    if (!selectA || !selectB) return;
    let selectedA = "Josh Allen"; let selectedB = "Sam Darnold";
    const setOptions = () => {
      const filter = position.value;
      const rows = all.filter((p) => filter === "ALL" || p.position === filter).sort((a, b) => a.position.localeCompare(b.position) || b.mean - a.mean);
      const options = rows.map((p) => `<option value="${$esc(p.name)}">${$esc(p.name)} · ${$esc(p.position)} · ${number(p.mean)} · ${$esc(p.club === "available" ? "FA" : p.club)}</option>`).join("");
      selectA.innerHTML = options; selectB.innerHTML = options;
      selectA.value = rows.some((p) => p.name === selectedA) ? selectedA : rows[0]?.name || "";
      selectB.value = rows.some((p) => p.name === selectedB) ? selectedB : rows[1]?.name || rows[0]?.name || "";
      selectedA = selectA.value; selectedB = selectB.value;
      renderPlayerComparison(all, selectedA, selectedB);
      $("playerCount").textContent = `${rows.length} visible · ${all.length} modelled`;
      renderPlayerTable(rows);
    };
    selectA.onchange = () => { selectedA = selectA.value; renderPlayerComparison(all, selectedA, selectedB); };
    selectB.onchange = () => { selectedB = selectB.value; renderPlayerComparison(all, selectedA, selectedB); };
    position.onchange = setOptions;
    setOptions();
  }
  function playerThresholds(player) {
    const probs = player.probabilities || {};
    return [5, 10, 15, 20, 25].map((x) => `<span>P(${x}+): ${pct(probs[`${x}_plus`] || 0)}</span>`).join("");
  }
  function renderPlayerComparison(all, nameA, nameB) {
    const a = all.find((p) => p.name === nameA); const b = all.find((p) => p.name === nameB);
    if (!a || !b) return;
    const samplesA = playerSamples(a, true, 7000); const samplesB = playerSamples(b, true, 7000);
    const statA = stats(samplesA, a.mean); const statB = stats(samplesB, b.mean);
    legend([{ label: `${a.name} · ${a.position}`, color: COLORS.current }, { label: `${b.name} · ${b.position}`, color: COLORS.opponent }], "compareLegend");
    drawChart("playerChart", [{ name: a.name, values: samplesA, mean: a.mean, color: COLORS.current }, { name: b.name, values: samplesB, mean: b.mean, color: COLORS.opponent }], { player: true, height: 320, aria: `Scoring probability distribution: ${a.name} and ${b.name}` });
    const statusA = a.status && a.status !== "—" ? `<span class="warning">· ${$esc(a.status)} · conditional on playing</span>` : "";
    const statusB = b.status && b.status !== "—" ? `<span class="warning">· ${$esc(b.status)} · conditional on playing</span>` : "";
    $("playerMetrics").innerHTML = [`<article class="player-metric"><h3>${$esc(a.name)} <span class="position-pill">${$esc(a.position)}</span> ${statusA}</h3><div class="metric-main">${number(a.mean)} pts</div><div class="metric-sub">Median ${number(statA.median)} · P10–P90 ${number(statA.p10)}–${number(statA.p90)}</div><div class="thresholds">${playerThresholds(a)}</div></article>`, `<article class="player-metric"><h3>${$esc(b.name)} <span class="position-pill">${$esc(b.position)}</span> ${statusB}</h3><div class="metric-main">${number(b.mean)} pts</div><div class="metric-sub">Median ${number(statB.median)} · P10–P90 ${number(statB.p10)}–${number(statB.p90)}</div><div class="thresholds">${playerThresholds(b)}</div></article>`].join("");
    const delta = Number(a.mean) - Number(b.mean);
    $("compareNote").textContent = `${Math.abs(delta).toFixed(1)} model-point mean edge to ${delta >= 0 ? a.name : b.name}. Overlaid density curves are interpolated from the saved quantile model heads; they show outcome range, not an ESPN projection. ${data.meta.modelNote}`;
  }
  function renderPlayerTable(rows) {
    $("playerTable").innerHTML = `<table><thead><tr><th>Player</th><th>Team / opponent</th><th>Position</th><th>Model mean</th><th>Median</th><th>P10–P90</th><th>Role</th></tr></thead><tbody>${rows.map((p) => `<tr><td>${$esc(p.name)}${p.status && p.status !== "—" ? ` <span class="warning">${$esc(p.status)}</span>` : ""}</td><td>${$esc(p.team || "—")} / ${$esc(p.opponent || "—")}</td><td><span class="position-pill">${$esc(p.position)}</span></td><td>${number(p.mean)}</td><td>${number(p.median)}</td><td>${number(p.q10)}–${number(p.q90)}</td><td>${p.club === "available" ? "Available" : `${$esc(p.club)} · ${$esc(p.group)}`}</td></tr>`).join("")}</tbody></table>`;
  }

  init();
})();
