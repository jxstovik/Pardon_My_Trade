const root = document.querySelector('#app');
const $ = (selector) => document.querySelector(selector);
const api = async (path, body) => {
  const options = body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store'
  };
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || `Request failed (${response.status})`);
  return result.data ?? result;
};
const node = (tag, cls, value) => {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (value !== undefined && value !== null) item.textContent = String(value);
  return item;
};
const label = (value, fallback = '—') => value === null || value === undefined || value === '' ? fallback : String(value);
const profileNames = ['balanced', 'guards', 'bigs'];
let latestState = null;
let loadInProgress = false;
let actionInProgress = false;
let reconciliationBundle = null;
let reconciliationView = 'original';

function playerMap(state) {
  const map = new Map();
  for (const player of state.playerCatalog ?? []) if (player?.playerId) map.set(player.playerId, player);
  for (const player of state.availablePlayers ?? []) if (player?.playerId) map.set(player.playerId, player);
  for (const profile of Object.values(state.advice?.profiles ?? {})) {
    for (const recommendation of profile?.recommendations ?? []) {
      const player = recommendation?.player ?? recommendation?.candidate ?? recommendation;
      const playerId = player?.playerId ?? player?.fantraxId;
      if (playerId) map.set(playerId, { ...player, playerId });
    }
  }
  return map;
}

function niceProfile(profile) {
  return ({ balanced: 'Balanced', guards: 'Guards', bigs: 'Bigs' })[profile] ?? label(profile);
}

function renderReconciliation(state = latestState) {
  const host = $('#reconciliation-rows');
  const head = $('#reconciliation-head');
  const select = $('#reconciliation-view');
  const note = $('#reconciliation-note');
  const bundle = reconciliationBundle;
  const scope = $('#reconciliation-scope');
  const outliers = $('#reconciliation-outliers');
  const openCards = new Set([...outliers.querySelectorAll('details[open]')].map(card => card.dataset.playerId));
  host.replaceChildren(); head.replaceChildren(); outliers.replaceChildren();
  select.value = reconciliationView;
  if (!bundle?.available) {
    select.disabled = true;
    scope.textContent = 'No candidate bundle';
    note.textContent = bundle?.reason ?? 'No reconciliation candidates were supplied.';
    $('#candidate-count').textContent = '';
    $('#candidate-view-label').textContent = 'ORIGINAL ACTIVE BOARD';
    $('#reconciliation-evidence-age').textContent = '—';
    $('#reconciliation-evidence-time').textContent = 'No reconciliation evidence';
    const emptyHeader = node('tr'); emptyHeader.append(node('th', '', 'Candidate view')); head.append(emptyHeader);
    const emptyRow = node('tr'); emptyRow.append(node('td', 'muted', 'No optional candidate data is available.')); host.append(emptyRow);
    outliers.append(node('p', 'muted', 'No reconciliation explanation cards are available.'));
    return;
  }
  select.disabled = false;
  const view = bundle.candidates?.[reconciliationView] ?? bundle.candidates?.original;
  const dataRows = Array.isArray(view?.rows) ? view.rows : [];
  scope.textContent = `${label(bundle.scope?.season)} · ${String(bundle.scope?.baselineRevision ?? '').slice(0, 12)} baseline`;
  const observedMs = Date.parse(bundle.newestEvidenceObservedAt ?? '');
  const ageHours = Number.isFinite(observedMs) ? Math.max(0, (Date.now() - observedMs) / 3_600_000) : null;
  $('#reconciliation-evidence-age').textContent = ageHours === null ? 'Age unavailable' : `${ageHours >= 24 ? 'STALE · ' : ''}${ageHours.toFixed(1)}h`;
  $('#reconciliation-evidence-age').className = ageHours !== null && ageHours >= 24 ? 'stale-evidence' : '';
  $('#reconciliation-evidence-time').textContent = bundle.newestEvidenceObservedAt ? `Observed ${new Date(bundle.newestEvidenceObservedAt).toLocaleString()}` : 'No source timestamp supplied';
  $('#candidate-view-label').textContent = label(view?.label, reconciliationView).toUpperCase();
  $('#candidate-count').textContent = `${dataRows.length} shown`;
  note.textContent = reconciliationView === 'providerFirst'
    ? 'Rank-only fallback: no projected statistics are included. Stale and uncovered identities keep their evidence labels.'
    : 'The candidate is a review aid. Category contribution values show standardized eight-category direction, not certainty or a pick instruction.';
  const headerRow = node('tr');
  for (const title of ['Rank', 'Player', reconciliationView === 'providerFirst' ? 'Rank evidence' : 'Category contributions']) headerRow.append(node('th', '', title));
  head.append(headerRow);
  for (const row of dataRows) {
    const tr = node('tr');
    tr.append(node('td', 'recon-rank', row.rank ?? '—'));
    const playerCell = node('td');
    playerCell.append(node('div', 'player-name', label(row.name, row.playerId ?? 'Unknown player')));
    if (row.school) playerCell.append(node('div', 'player-school', row.school));
    if (row.reviewRequired || (Array.isArray(row.flags) && row.flags.length)) playerCell.append(node('div', 'player-flags', (row.flags ?? []).join(' · ') || 'Review required'));
    tr.append(playerCell);
    const evidenceCell = node('td', 'recon-evidence');
    if (reconciliationView === 'providerFirst') {
      evidenceCell.append(node('span', 'rank-signal', `Provider ${row.providerRank ?? '—'} · model ${row.modelRank ?? '—'}`));
      evidenceCell.append(node('span', `freshness ${row.rankFreshness === 'stale' || row.rankFreshness === 'frozen-stale-baseline-rank' ? 'stale-rank' : 'freshness-tag'}`, label(row.rankFreshness, 'uncovered')));
      if (row.sourceObservedAt) evidenceCell.append(node('small', 'player-school', `Observed ${new Date(row.sourceObservedAt).toLocaleDateString()}`));
    } else {
      const values = row.categoryContributions && typeof row.categoryContributions === 'object' ? row.categoryContributions : {};
      for (const [category, value] of Object.entries(values)) evidenceCell.append(node('span', 'category-contribution', `${category} ${Number(value).toFixed(1)}`));
      if (!Object.keys(values).length) evidenceCell.append(node('span', 'muted', 'No category contribution data'));
    }
    tr.append(evidenceCell); host.append(tr);
  }
  if (!dataRows.length) { const emptyRow = node('tr'); emptyRow.append(node('td', 'muted', 'No candidate rows are available.')); host.append(emptyRow); }

  const cards = [...(bundle.explanations?.topOutliers ?? []), ...(bundle.explanations?.historicalOnly ?? [])];
  if (!cards.length) outliers.append(node('p', 'muted', 'No unresolved outlier cards were supplied.'));
  for (const card of cards.slice(0, 10)) {
    const detail = node('details', 'outlier-card');
    detail.dataset.playerId = card.playerId ?? card.name;
    detail.open = openCards.has(detail.dataset.playerId);
    const summary = node('summary');
    summary.append(node('strong', '', label(card.name, card.playerId ?? 'Unmatched player')));
    if (card.school) summary.append(node('span', '', ` · ${card.school}`));
    const rankLabel = card.providerRank !== null && card.providerRank !== undefined ? `Provider #${card.providerRank} · model #${card.modelRank ?? '—'}` : `Model #${card.modelRank ?? '—'} · no current provider rank`;
    summary.append(node('small', '', rankLabel));
    detail.append(summary);
    detail.append(node('p', '', label(card.reason, 'Evidence needs human review.')));
    outliers.append(detail);
  }
  const coverage = bundle.coverage ?? {};
  const coverageNote = node('p', 'coverage-note', `${coverage.availableForecastRows ?? '—'} forecasted identities · ${coverage.unforecastedCurrentPoolRows ?? '—'} current pool rows without forecasts · ${coverage.staleProviderRanks ?? '—'} stale ranks`);
  outliers.append(coverageNote);
  if (state?.advice?.selectedProfile && state.advice.selectedProfile !== 'balanced') {
    // Keep the comparison anchored to the same untouched baseline regardless of the active advisory profile.
    note.append(` Active advisory profile: ${niceProfile(state.advice.selectedProfile)}.`);
  }
}

async function loadReconciliation() {
  try { reconciliationBundle = await api('/api/reconciliation'); }
  catch (error) { reconciliationBundle = { available: false, reason: `Candidate view unavailable: ${error.message}` }; }
  renderReconciliation();
}

function nextPick(session) {
  const total = (session?.picks?.length ?? 0) + 1;
  if (!session || total > 112) return { overall: 'Complete', round: 14, number: 112, teamId: session?.teamId };
  const roundIndex = Math.floor((total - 1) / 8);
  const offset = (total - 1) % 8;
  const order = session.teamOrder ?? [];
  const teamIndex = roundIndex % 2 === 0 ? offset : 7 - offset;
  return { overall: total, round: roundIndex + 1, number: total, teamId: order[teamIndex] ?? '—' };
}

function candidateName(candidate) {
  if (!candidate) return 'Unknown player';
  candidate = candidate.player ?? candidate.candidate ?? candidate;
  return [candidate.name, candidate.school].filter(Boolean).join(' · ') || label(candidate.playerId, 'Unknown player');
}

function renderProfiles(state) {
  const host = $('#profiles');
  host.replaceChildren();
  const profiles = state.advice?.profiles ?? {};
  for (const name of profileNames) {
    const data = profiles[name] ?? {};
    const selected = state.selectedProfile === name || state.advice?.selectedProfile === name;
    const suggested = state.advice?.suggestedProfile === name;
    const card = node('article', `profile-card${selected ? ' selected' : ''}${suggested ? ' suggested' : ''}`);
    const head = node('div', 'profile-head');
    head.append(node('strong', '', niceProfile(name)));
    if (selected) head.append(node('span', 'selected-tag', 'SELECTED'));
    card.append(head);
    const rationale = Array.isArray(data.rationale) ? data.rationale.join(' ') : data.rationale;
    card.append(node('p', 'profile-reason', label(rationale, 'Construction path is ready for comparison.')));
    const evaluation = data.projectedRoster?.evaluation;
    if (evaluation) {
      const roster = data.projectedRoster;
      const evaluated = node('div', 'profile-evaluation');
      const score = typeof evaluation.score === 'number' ? evaluation.score.toFixed(2) : '—';
      evaluated.append(node('span', '', `Shared eight-category score ${score} · ${roster.active?.length ?? 0} active · ${roster.reserve?.length ?? 0} reserve`));
      const categoryZ = evaluation.categoryZ ?? {};
      const strongest = Object.entries(categoryZ).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 3);
      if (strongest.length) evaluated.append(node('span', 'category-ribbon', strongest.map(([category, value]) => `${category} ${Number(value).toFixed(1)}`).join(' · ')));
      card.append(evaluated);
    }
    const recommendations = data.recommendations ?? [];
    const first = recommendations[0];
    const firstLine = first ? candidateName(first) : 'No eligible candidate available';
    const delta = first?.marginalDelta ?? first?.categoryDelta ?? first?.delta ?? first?.constructionValue;
    const top = node('div', 'profile-top');
    top.append(node('span', '', 'Next option · '));
    top.append(node('b', '', firstLine));
    if (delta && typeof delta === 'object') {
      const parts = Object.entries(delta).slice(0, 3).map(([key, value]) => `${key} ${typeof value === 'number' ? value.toFixed(1) : value}`);
      if (parts.length) top.append(node('span', '', ` · ${parts.join(' / ')}`));
    }
    card.append(top);
    const button = node('button', 'button quiet select-profile', selected ? 'Selected profile' : 'Use this profile');
    button.type = 'button'; button.dataset.profile = name;
    button.addEventListener('click', async () => {
      if (actionInProgress) return;
      actionInProgress = true;
      const id = actionId();
      await api('/api/measurement', { kind: 'browser-click', actionId: id, clientTimeMs: performance.now(), revision: root.dataset.revision }).catch(() => {});
      await send('/api/profile', { profile: name }, id);
      actionInProgress = false;
    });
    card.append(button);
    host.append(card);
  }
}

function renderAvailable(state, players) {
  const tbody = $('#available-players');
  tbody.replaceChildren();
  const recommendationRows = state.advice?.profiles?.[state.selectedProfile]?.recommendations ?? [];
  const rowsById = new Map();
  for (const recommendation of recommendationRows) {
    const player = recommendation?.player ?? recommendation?.candidate ?? recommendation;
    const playerId = player?.playerId ?? player?.fantraxId;
    if (!playerId) continue;
    rowsById.set(playerId, {
      ...(players.get(playerId) ?? {}), ...player, playerId,
      constructionValue: recommendation?.constructionValue,
      marginalSharedScore: recommendation?.marginalSharedScore,
      marginalCategoryZ: recommendation?.marginalCategoryZ,
      reviewRequired: player?.reviewRequired ?? true,
      flags: Array.isArray(player?.flags) ? player.flags : ['Review required']
    });
  }
  for (const player of state.availablePlayers ?? []) if (player?.playerId && !rowsById.has(player.playerId)) rowsById.set(player.playerId, player);
  const rows = [...rowsById.values()];
  const limited = rows.slice(0, 20);
  $('#available-count').textContent = `${label(state.availableCount, rows.length)} in pool`;
  const candidateSelect = $('#candidate');
  const previous = candidateSelect.value;
  candidateSelect.replaceChildren();
  const empty = node('option', '', 'Choose an available player'); empty.value = ''; candidateSelect.append(empty);
  for (const player of limited) {
    const option = node('option', '', `${player.name ?? player.playerId}${player.school ? ` · ${player.school}` : ''}`);
    option.value = player.playerId; candidateSelect.append(option);
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td'); nameCell.append(node('div', 'player-name', label(player.name, label(player.playerId))));
    nameCell.append(node('div', 'player-school', label(player.school, '')));
    const flags = Array.isArray(player.flags) ? [...player.flags] : [];
    if (player.reviewRequired && !flags.length) flags.push('Review required');
    if (flags.length) nameCell.append(node('div', 'player-flags', flags.join(' · ')));
    tr.append(nameCell);
    tr.append(node('td', '', (player.eligibleGroups ?? []).join(' / ') || '—'));
    tr.append(node('td', '', player.adp ?? '—'));
    const signal = player.marginalCategoryZ ?? player.constructionValue ?? player.marginalValue ?? player.marginalDelta ?? player.categoryScore ?? player.rank ?? '—';
    const signalText = typeof signal === 'object'
      ? Object.entries(signal).slice(0, 2).map(([key, value]) => `${key} ${typeof value === 'number' ? value.toFixed(1) : value}`).join(' · ')
      : typeof signal === 'number' ? `Δ ${signal.toFixed(2)}` : signal;
    tr.append(node('td', 'rank-signal', signalText));
    const actionCell = document.createElement('td');
    const queueButton = node('button', 'mini-action mock-only', 'Queue'); queueButton.type = 'button'; queueButton.dataset.playerId = player.playerId;
    queueButton.dataset.action = 'queue';
    actionCell.append(queueButton); tr.append(actionCell); tbody.append(tr);
  }
  if (previous && [...candidateSelect.options].some((option) => option.value === previous)) candidateSelect.value = previous;
}

function renderBoard(state, players) {
  const host = $('#draft-board');
  host.replaceChildren();
  const order = state.session?.teamOrder ?? [];
  const picks = new Map((state.session?.picks ?? []).map((pick) => [pick.overall, pick]));
  host.append(node('div', 'board-head', 'ROUND'));
  for (let index = 0; index < 8; index++) host.append(node('div', 'board-head', label(order[index], `Team ${index + 1}`)));
  for (let round = 1; round <= 14; round++) {
    host.append(node('div', 'round-label', `R${round}`));
    for (let teamIndex = 0; teamIndex < 8; teamIndex++) {
      const overall = (round - 1) * 8 + ((round - 1) % 2 === 0 ? teamIndex + 1 : 8 - teamIndex);
      const pick = picks.get(overall);
      const isOwn = pick?.teamId === state.session?.teamId;
      const cell = node('div', `board-cell${pick ? ' filled' : ''}${isOwn ? ' own' : ''}`);
      if (pick) {
        cell.append(node('span', 'pick-num', `${overall}.`));
        const player = players.get(pick.playerId);
        cell.append(document.createTextNode(player?.name ?? pick.playerId));
      } else {
        cell.append(node('span', 'pick-num', `${overall}.`));
        cell.append(document.createTextNode(label(order[teamIndex], 'Open')));
      }
      cell.title = pick ? `${overall}: ${players.get(pick.playerId)?.name ?? pick.playerId} · ${pick.teamId}` : `Pick ${overall} · ${label(order[teamIndex])}`;
      host.append(cell);
    }
  }
}

function renderRosters(state, players) {
  const host = $('#rosters'); host.replaceChildren();
  const order = state.session?.teamOrder ?? [];
  const rosterMap = new Map(order.map((id) => [id, []]));
  for (const pick of state.session?.picks ?? []) {
    if (!rosterMap.has(pick.teamId)) rosterMap.set(pick.teamId, []);
    rosterMap.get(pick.teamId).push(pick);
  }
  for (const teamId of order) {
    const roster = rosterMap.get(teamId) ?? [];
    const card = node('article', `roster-card${teamId === state.session?.teamId ? ' own' : ''}`);
    const title = node('h3', '', teamId === state.session?.teamId ? `Your team · ${teamId}` : teamId);
    title.append(node('span', 'roster-count', `${roster.length}/14`)); card.append(title);
    const recent = roster.slice(-4).reverse();
    for (const pick of recent) card.append(node('p', '', `${players.get(pick.playerId)?.name ?? pick.playerId} · #${pick.overall}`));
    if (!roster.length) card.append(node('p', '', 'No picks yet'));
    else if (roster.length > recent.length) card.append(node('p', '', `+ ${roster.length - recent.length} earlier picks`));
    host.append(card);
  }
  $('#roster-summary').textContent = `${rosterMap.size} teams · ${(state.session?.picks ?? []).length} picks recorded`;
}

function trendEntries(trends) {
  if (!trends) return [];
  if (Array.isArray(trends)) return trends.slice(0, 10).map((value) => typeof value === 'string' ? value : JSON.stringify(value));
  const entries = [];
  const counts = trends.lastSixGroupCounts;
  if (counts) entries.push(`Last six picks: ${counts.G ?? 0} guards · ${counts['F/C'] ?? 0} F/C · ${counts.dual ?? 0} dual eligible.`);
  if (trends.currentRun?.group) entries.push(`Current run: ${trends.currentRun.count} consecutive ${trends.currentRun.group} picks.`);
  for (const team of trends.teams ?? []) {
    const needs = [];
    if (team.observedGEligible < 4) needs.push(`${4 - team.observedGEligible} G`);
    if (team.observedFCEligible < 4) needs.push(`${4 - team.observedFCEligible} F/C`);
    if (needs.length) entries.push(`${team.teamId}: ${team.observedPicks} picked; minimum eligibility still needed ${needs.join(', ')} (dual players count in both).`);
  }
  for (const scenario of trends.scenarios ?? []) {
    if (scenario.beforeFirstOwnPick?.length) entries.push(`${scenario.scenario}: ${scenario.beforeFirstOwnPick.length} opponent selections simulated before your next turn; next options below are conditional on that case.`);
    const pair = scenario.bestPair;
    if (pair) entries.push(`${scenario.scenario}: #${scenario.firstOwnOverall} ${pair.first.name}; #${scenario.secondOwnOverall} ${pair.second?.name ?? 'no legal option'}. Deterministic stress case.`);
    const wait = scenario.waitCase;
    if (wait) entries.push(`If waiting on ${wait.target.name}: ${wait.targetStillAvailableAtSecondPick ? 'still available' : 'taken'} in this case only.`);
  }
  if (trends.forecastCoverage) entries.push(`Selected-player coverage: ${trends.forecastCoverage.selectedWithForecast} forecasted · ${trends.forecastCoverage.selectedWithoutForecast} without forecasts.`);
  return entries;
}

function renderTrends(state) {
  const host = $('#trends'); host.replaceChildren();
  const entries = trendEntries(state.advice?.trends);
  if (state.copilotState?.issues?.length) entries.unshift(...state.copilotState.issues.slice(0, 2));
  if (!entries.length) host.append(node('p', 'muted', 'No observed selections yet. Scenario picks will be labeled synthetic.'));
  else for (const entry of entries) host.append(node('div', 'trend-item', entry));
  const warnings = $('#warnings'); warnings.replaceChildren();
  const source = state.copilotState?.observation;
  if (source) warnings.append(node('p', '', `Input: ${source.venue} · seq ${source.sequence} · ${source.completeHistory ? 'complete history' : 'incomplete history'} · identity ${source.identityVerified ? 'verified' : 'unverified'}.`));
  const ages = state.advice?.inputAgesHours;
  if (ages) warnings.append(node('p', '', `Saved inputs: history ${Number(ages.pool).toFixed(1)}h · provider retrieval ${Number(ages.provider).toFixed(1)}h · board ${Number(ages.board).toFixed(1)}h. Draft-state refresh does not refresh these sources.`));
  const coverage = state.advice?.coverage;
  if (coverage) warnings.append(node('p', '', `${coverage.availableForecasted ?? '—'} forecasted players available · ${coverage.unmodeledAvailable ?? '—'} unmodeled identities available. Current role and availability review flags remain in force.`));
  for (const warning of (state.advice?.warnings ?? []).slice(0, 5)) warnings.append(node('p', '', warning));
  if (!source && state.mode === 'coach') warnings.append(node('p', '', 'Coach mode waits for an explicit browser observation. Nothing is fetched from Fantrax and no platform action is available.'));
}

function render(state, measuredActionId = null) {
  if (latestState) {
    const incoming = Date.parse(state.serverTime);
    const current = Date.parse(latestState.serverTime);
    const counter = value => Number(String(value ?? '').split(':').at(-1));
    if (incoming < current || (incoming === current && counter(state.renderRevision) < counter(latestState.renderRevision))) return;
  }
  latestState = state;
  const session = state.session ?? {};
  const advice = state.advice ?? {};
  const now = performance.now();
  const renderedAt = new Date().toISOString();
  const revision = state.renderRevision ?? state.revision ?? advice.generatedAt ?? 'unversioned';
  root.dataset.revision = String(revision);
  root.dataset.renderedAt = renderedAt;
  root.dataset.renderedMonotonicMs = String(now);
  $('#render-stamp').textContent = `Rendered ${renderedAt} · t+${now.toFixed(1)}ms`;
  $('#revision-short').textContent = String(revision).slice(0, 16);
  $('#updated-at').textContent = advice.generatedAt ? `Advice ${new Date(advice.generatedAt).toLocaleTimeString()}` : 'Advice pending';
  $('#mode-badge').textContent = state.mode === 'mock' ? 'Synthetic mock' : 'Coach mode';
  $('#notice-title').textContent = state.mode === 'mock' ? 'Synthetic local simulator' : 'Coach · explicit observations only';
  $('#notice-copy').textContent = state.mode === 'mock'
    ? 'All opponents and picks in this session are synthetic. This simulator uses a local board and never changes a Fantrax league.'
    : 'Recommendations update from observations you explicitly send. The server does not access Fantrax or make platform changes.';
  $('#mode-notice').classList.toggle('coach', state.mode === 'coach');
  $('#session-label').textContent = `${label(session.leagueId)} · ${label(session.phase, 'pre-draft')} · ${label(state.scenario, 'balanced')} scenario`;
  $('#own-team').textContent = `Team ${label(session.teamId)}`;
  $('#own-count').textContent = `${advice.ownSelected ?? (session.picks ?? []).filter((pick) => pick.teamId === session.teamId).length} / 14`;
  const next = nextPick(session);
  $('#next-pick').textContent = typeof next.overall === 'number' ? `#${next.overall}` : next.overall;
  $('#round-detail').textContent = `Round ${next.round} · Pick ${next.number} of 112 · ${label(next.teamId)}`;
  $('#turn-state').textContent = state.paused ? 'Paused' : advice.ownTurn ? 'Your turn' : session.phase === 'pre-draft' ? 'Not started' : session.phase === 'complete' ? 'Complete' : 'Waiting';
  $('#turn-state').className = `turn-pill${state.paused ? ' paused' : advice.ownTurn ? ' live' : ''}`;
  const observation = state.copilotState?.observation;
  if (session.phase === 'live' && observation?.clockSeconds !== null && observation?.clockSeconds !== undefined) {
    const observedAt = Date.parse(session.observedAt);
    const remaining = Number.isFinite(observedAt) ? Math.max(0, observation.clockSeconds - (Date.now() - observedAt) / 1000) : observation.clockSeconds;
    const picker = observation.currentTeamId === session.teamId ? 'Your clock' : `${label(observation.currentTeamId)} clock`;
    $('#clock-detail').textContent = `${Math.ceil(remaining)}s · ${picker} · 60s own-pick limit`;
    if (remaining <= 0 && !state.paused) $('#turn-state').textContent = 'Clock expired';
  } else {
    $('#clock-detail').textContent = session.phase === 'pre-draft' ? '60s own-pick clock · not running' : 'No fresh displayed clock';
  }
  $('#source-age').textContent = Number.isFinite(state.sourceAgeSeconds) ? `${Math.max(0, Math.floor(state.sourceAgeSeconds))}s` : '—';
  $('#source-label').textContent = state.copilotState?.observation?.venue ?? (state.mode === 'mock' ? 'Synthetic simulator authority' : 'Awaiting explicit observation');
  $('#suggestion').textContent = `Suggested: ${niceProfile(advice.suggestedProfile ?? 'balanced')}`;
  $('#pause-button').textContent = state.paused ? 'Resume' : 'Pause';
  if (state.selectedSlot && [...$('#slot').options].some((option) => option.value === state.selectedSlot)) $('#slot').value = state.selectedSlot;
  const connection = $('#connection'); connection.className = 'connection online'; connection.lastChild.textContent = ' Live';
  const players = playerMap(state);
  renderProfiles(state);
  renderReconciliation(state);
  renderAvailable(state, players);
  renderTrends(state);
  renderBoard(state, players);
  renderRosters(state, players);
  for (const control of document.querySelectorAll('.mock-only')) control.disabled = state.mode !== 'mock' || (state.paused && control.dataset.action !== 'reset');
  const queued = state.queuedPlayerId ? players.get(state.queuedPlayerId) : null;
  $('#queued-player').textContent = queued ? candidateName(queued) : 'None';
  $('.queue-dot').classList.toggle('active', Boolean(queued));
  const receipt = $('#latest-receipt');
  receipt.replaceChildren(node('span', 'eyebrow', 'LATEST RECEIPT'));
  if (state.latestReceipt) {
    const text = `${state.latestReceipt.playerName ?? state.latestReceipt.playerId} · ${state.latestReceipt.teamId} · pick ${state.latestReceipt.overall} · slot ${state.latestReceipt.slot} · ${state.latestReceipt.verified ? 'verified local receipt' : 'pending verification'}`;
    receipt.append(node('p', '', text));
    if (state.latestReceipt.slotAssignment?.length) receipt.append(node('p', '', `Legal roster assignment: ${state.latestReceipt.slotAssignment.join(' · ')}`));
  } else receipt.append(node('p', '', 'No local selection recorded.'));
  const feedback = $('#pick-feedback');
  if (state.lastActionMessage) { feedback.textContent = state.lastActionMessage; feedback.className = `feedback ${state.lastActionOk ? 'success' : 'error'}`; }
  if (measuredActionId) {
    requestAnimationFrame(() => api('/api/measurement', { kind: 'browser-render', actionId: measuredActionId, clientTimeMs: performance.now(), revision: String(revision) }).catch(() => {}));
  }
}

async function load() {
  if (loadInProgress || actionInProgress) return;
  loadInProgress = true;
  try { render(await api('/api/state')); }
  catch (error) { const connection = $('#connection'); connection.className = 'connection'; connection.lastChild.textContent = ` ${error.message}`; }
  finally { loadInProgress = false; }
}

async function send(path, body, measuredActionId = null) {
  const feedback = $('#pick-feedback');
  try {
    const data = await api(path, body);
    if (measuredActionId) await api('/api/measurement', { kind: 'browser-api', actionId: measuredActionId, clientTimeMs: performance.now(), revision: data.renderRevision ?? data.copilotState?.revision }).catch(() => {});
    if (data && data.session) render(data, measuredActionId);
    else await load();
    feedback.className = 'feedback success';
    feedback.textContent = data.message ?? 'Local state updated.';
    return data;
  } catch (error) {
    feedback.className = 'feedback error'; feedback.textContent = error.message;
    await load();
    return null;
  }
}

function actionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (actionInProgress) return;
  const action = button.dataset.action;
  const id = actionId();
  actionInProgress = true;
  await api('/api/measurement', { kind: 'browser-click', actionId: id, clientTimeMs: performance.now(), revision: root.dataset.revision }).catch(() => {});
  if (action === 'pause') {
    await send('/api/pause', { paused: !latestState?.paused }, id); actionInProgress = false; return;
  }
  if (action === 'queue' && button.dataset.playerId) {
    $('#candidate').value = button.dataset.playerId;
    await send('/api/mock-actions', { action, playerId: button.dataset.playerId }, id); actionInProgress = false; return;
  }
  if (action === 'queue') {
    await send('/api/mock-actions', { action, playerId: $('#candidate').value }, id); actionInProgress = false; return;
  }
  if (action === 'choose-slot') {
    await send('/api/mock-actions', { action, slot: $('#slot').value }, id); actionInProgress = false; return;
  }
  if (action === 'confirm-ownpick') {
    await send('/api/mock-actions', { action, slot: $('#slot').value }, id); actionInProgress = false; return;
  }
  if (action === 'elapse-clock') {
    await send('/api/mock-actions', { action, seconds: Number(button.dataset.seconds ?? 60) }, id); actionInProgress = false; return;
  }
  await send('/api/mock-actions', { action, scenario: $('#scenario').value }, id);
  actionInProgress = false;
});

$('#slot').addEventListener('change', () => {
  if (latestState?.mode === 'mock') send('/api/mock-actions', { action: 'choose-slot', slot: $('#slot').value });
});
$('#scenario').addEventListener('change', () => { if (latestState?.mode === 'mock') send('/api/mock-actions', { action: 'scenario', scenario: $('#scenario').value }); });
$('#reconciliation-view').addEventListener('change', event => {
  reconciliationView = event.target.value;
  renderReconciliation(latestState);
});
window.addEventListener('DOMContentLoaded', load, { once: true });
load();
void loadReconciliation();
window.setInterval(load, 1500);
