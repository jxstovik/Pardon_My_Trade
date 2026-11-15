import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

/** ESPN's published pro-team schedule includes explicit bye weeks and mirrored game IDs. */
export function publishedWeeks(proTeams) {
  const teams = proTeams?.filter(t => Number(t.id) > 0);
  if (teams?.length !== 32 || new Set(teams.map(t => t.id)).size !== 32) throw Error('Published NFL schedule must identify all 32 distinct teams.');
  const ids = new Set(teams.map(t => t.id));
  return Array.from({ length: 18 }, (_, i) => {
    const week = i + 1;
    const games = new Map();
    const errors = [];
    for (const team of teams) {
      const rows = team.proGamesByScoringPeriod?.[week] ?? [];
      if (team.byeWeek === week) {
        if (rows.length) errors.push(`Team ${team.id} has both a bye and a game.`);
        continue;
      }
      if (rows.length !== 1) errors.push(`Team ${team.id} lacks exactly one game in Week ${week}.`);
      for (const g of rows) {
        if (g.scoringPeriodId !== week || !ids.has(g.homeProTeamId) || !ids.has(g.awayProTeamId) || ![g.homeProTeamId, g.awayProTeamId].includes(team.id) || g.homeProTeamId === g.awayProTeamId || !Number.isFinite(g.date) || g.startTimeTBD !== false || g.validForLocking !== true) errors.push(`Unverified or TBD game ${g.id} in Week ${week}.`);
        const previous = games.get(g.id);
        const identity = JSON.stringify([g.homeProTeamId, g.awayProTeamId, g.date, g.scoringPeriodId]);
        if (previous && previous.identity !== identity) errors.push(`Conflicting mirrored game ${g.id}.`);
        if (previous) previous.copies += 1;
        else games.set(g.id, { id: g.id, homeProTeamId: g.homeProTeamId, awayProTeamId: g.awayProTeamId, kickoff: Number.isFinite(g.date) ? new Date(g.date).toISOString() : null, identity, copies: 1 });
      }
    }
    const rows = [...games.values()].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
    if (!rows.length || rows.some(g => g.copies !== 2 || !g.id)) errors.push('Missing games or asymmetric published game identities.');
    return { week, complete: !errors.length, errors, firstKickoff: rows[0]?.kickoff, lastKickoff: rows.at(-1)?.kickoff, games: rows.map(({ identity, copies, ...g }) => g) };
  });
}


/** Select a whole NFL week from published kickoff timestamps, not calendar arithmetic. */
export function selectPlanningTarget({ at, season, espnWeek, weeks, week }) {
  const now = at.getTime();
  if (!Number.isFinite(now) || season !== '2026' || !Number.isInteger(espnWeek) || espnWeek < 1 || espnWeek > 18) throw Error('Invalid time, season or fresh ESPN scoringPeriodId.');
  const ordered = [...weeks].sort((a, b) => a.week - b.week);
  if (new Set(ordered.map(w => w.week)).size !== ordered.length) throw Error('Duplicate NFL weeks make the published schedule ambiguous.');
  if (!ordered.find(w => w.week === espnWeek)?.complete) throw Error(`Published schedule for fresh ESPN Week ${espnWeek} is missing or ambiguous.`);
  const next = ordered.find(w => Date.parse(w.firstKickoff) > now);
  const target = week === undefined ? next : ordered.find(w => w.week === week);
  if (!target || !target.complete) throw Error('No unambiguous whole upcoming NFL week with verified kickoff times.');
  if (![target.week, target.week - 1].includes(espnWeek)) throw Error(`Fresh ESPN scoringPeriodId ${espnWeek} cannot be mapped to NFL Week ${target.week}.`);
  if (week !== undefined && target !== next && !(Date.parse(target.firstKickoff) <= now && now <= Date.parse(target.lastKickoff) + 8 * 3600000)) throw Error('Explicit --week must be the current in-progress or first whole upcoming NFL week.');
  return { week: target.week, targetWeek: target.week, scoringPeriod: `${season}-W${target.week}`, firstKickoff: target.firstKickoff, lastKickoff: target.lastKickoff, timing: now < Date.parse(target.firstKickoff) ? 'before_first_kickoff' : 'in_progress_refresh_not_pregame' };
}

async function atomicReceipt(path, receipt) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}

async function storedState(dataDir, period) {
  const pointer = JSON.parse(await readFile(resolve(dataDir, 'last-snapshot.json'), 'utf8'));
  const dbPath = resolve(dataDir, 'pmt.sqlite');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT data FROM league_snapshots WHERE snapshot_id=?').get(pointer.snapshot_id);
    if (!row) throw Error('Imported snapshot pointer is absent from the exact SQLite store.');
    const snapshot = JSON.parse(row.data);
    if (pointer.league_id !== '98806880' || snapshot.league.platform !== 'espn' || snapshot.league.external_id !== '98806880' || snapshot.league.season !== '2026' || snapshot.league.teams.filter(t => t.external_id === '7').length !== 1) throw Error('Imported snapshot is outside configured ESPN league 98806880/team 7/season 2026.');
    const rows = db.prepare('SELECT scoped_projection_id, data, updated_at FROM scoped_projections WHERE league_external_id=? AND scoring_period=?').all('98806880', period).map(r => ({ ...JSON.parse(r.data), persistedAt: r.updated_at, scopedId: r.scoped_projection_id }));
    return { snapshot, rows, dbPath };
  } finally { db.close(); }
}

async function modelFile(dataDir) {
  const path = resolve(dataDir, 'models.json');
  const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  const parsed = JSON.parse(raw);
  return { path, savedAt: parsed.saved_at, modifiedAt: info.mtime.toISOString(), bytes: info.size, sha256: createHash('sha256').update(raw).digest('hex'), records: parsed.models?.length ?? 0, models: parsed.models ?? [] };
}

/** Injectable feed boundary; SQLite/model/receipt reads always use the real filesystem. */
export async function runProjectionRefresh(deps) {
  const { dataDir, credentials, teamId, readLeague, readSchedule, refresh, week } = deps;
  const clock = deps.clock ?? (() => new Date());
  const receipt = { version: 1, status: 'running', leagueId: '98806880', teamId: '7', season: '2026', startedAt: clock().toISOString(), targetWeek: week ?? null, scoringPeriod: null, platformWrites: 0, proposals: 0 };
  let receiptPath = resolve(dataDir, 'weekly-projections', '2026-unresolved.json');
  try {
    if (credentials.leagueId !== '98806880' || credentials.season !== '2026' || teamId !== '7') throw Error('Require configured ESPN league 98806880/team 7/season 2026.');
    const [raw, proTeams] = await Promise.all([readLeague(), readSchedule()]);
    receipt.readAt = clock().toISOString();
    if (raw.id !== 98806880 || raw.seasonId !== 2026) throw Error('Fresh ESPN league or season scope mismatch.');
    const teams = raw.teams?.filter(t => t.id === 7);
    if (teams?.length !== 1 || !credentials.swid || !teams[0].owners?.some(id => id.toLowerCase() === credentials.swid.toLowerCase())) throw Error('Fresh ESPN team ownership is absent or ambiguous.');
    const schedule = publishedWeeks(proTeams);
    const target = selectPlanningTarget({ at: clock(), season: credentials.season, espnWeek: raw.scoringPeriodId, weeks: schedule, week });
    Object.assign(receipt, target);
    receiptPath = resolve(dataDir, 'weekly-projections', `${target.scoringPeriod}.json`);
    receipt.receiptPath = receiptPath;
    const mappings = Object.entries(raw.settings?.scheduleSettings?.matchupPeriods ?? {}).filter(([, periods]) => Array.isArray(periods) && periods.includes(target.week));
    if (mappings.length !== 1 || mappings[0][1].length !== 1) throw Error('ESPN scoring-period to matchup mapping is absent or ambiguous; only verified single-week matchups are supported.');
    const matchupId = Number(mappings[0][0]);
    const matchups = raw.schedule?.filter(m => m.matchupPeriodId === matchupId && [m.home?.teamId, m.away?.teamId].includes(7));
    if (matchups?.length !== 1) throw Error('Fresh ESPN target matchup is absent or ambiguous.');
    receipt.espn = { scoringPeriodId: raw.scoringPeriodId, matchupPeriodId: matchupId, mapping: mappings[0][1], ownershipVerified: true };
    receipt.schedule = { source: 'ESPN proTeamSchedules_wl', retrievedAt: receipt.readAt, games: schedule.find(w => w.week === target.week).games, sha256: createHash('sha256').update(JSON.stringify(proTeams)).digest('hex') };
    const before = await storedState(dataDir, target.scoringPeriod);
    const beforeModel = await modelFile(dataDir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const entries = teams[0].roster?.entries?.filter(e => ![20, 21].includes(e.lineupSlotId ?? e.lineuSlotId));
    if (!entries?.length) throw Error('Fresh ESPN starting roster is empty.');
    const slots = raw.settings?.rosterSettings?.lineupSlotCounts;
    if (!slots || !Object.keys(slots).length) throw Error('Fresh ESPN starting slot settings are missing.');
    for (const [slot, count] of Object.entries(slots)) {
      if ([20, 21].includes(Number(slot))) continue;
      if (!Number.isInteger(count) || count < 0 || entries.filter(e => (e.lineupSlotId ?? e.lineuSlotId) === Number(slot)).length !== count) throw Error(`Current starting slot ${slot} is empty, duplicated or inconsistent with ESPN settings.`);
    }
    if (new Set(entries.map(e => e.playerId)).size !== entries.length || entries.some(e => !Object.hasOwn(slots, String(e.lineupSlotId ?? e.lineuSlotId)))) throw Error('Current starter slot/player identities are duplicated or unconfigured.');
    const identities = [...before.snapshot.players, ...before.snapshot.free_agents];
    const starters = entries.map(e => {
      const id = String(e.playerId);
      const candidates = identities.filter(p => [p.external_id, p.external_ids?.espn].includes(id));
      const player = e.playerPoolEntry?.player;
      if (candidates.length !== 1 || String(player?.id) !== id || !player.fullName || !proTeams.some(t => t.id === player.proTeamId)) throw Error(`Current starter ${id} lacks a unique canonical player/pro-team identity in the imported snapshot.`);
      return { playerId: candidates[0].player_id, espnId: id, name: player.fullName, proTeamId: player.proTeamId, slot: e.lineupSlotId ?? e.lineuSlotId };
    });
    const refreshStartedAt = clock().toISOString();
    receipt.refreshStartedAt = refreshStartedAt;
    const summary = await refresh({ season: credentials.season, week: target.week, force: true });
    receipt.refresh = summary;
    if (summary.season !== credentials.season || summary.scoringPeriod !== target.scoringPeriod) throw Error('Refresh result snapshot/season/scoring period mismatch.');
    if (!Number.isInteger(summary.projectionsStored) || summary.projectionsStored <= 0 || !Number.isInteger(summary.modelsRebuilt) || summary.modelsRebuilt <= 0 || !Array.isArray(summary.errors) || summary.errors.length) throw Error(`Refresh returned zero projections/models or fatal errors: ${JSON.stringify(summary.errors)}.`);
    const after = await storedState(dataDir, target.scoringPeriod);
    if (after.snapshot.snapshot_id !== summary.snapshotId) throw Error('Refresh result snapshot differs from independently read SQLite snapshot pointer.');
    const previous = new Map(before.rows.map(r => [r.scopedId, r.persistedAt]));
    const fresh = after.rows.filter(r => Date.parse(r.persistedAt) >= Date.parse(refreshStartedAt) && (!previous.has(r.scopedId) || Date.parse(r.persistedAt) > Date.parse(previous.get(r.scopedId))));
    const sourceCounts = {};
    for (const p of fresh) {
      if (p.scoring_period !== target.scoringPeriod || !Number.isFinite(p.projected_points)) throw Error('Persisted projection has a wrong period or non-finite points.');
      sourceCounts[p.source] = (sourceCounts[p.source] ?? 0) + 1;
    }
    if (fresh.length !== summary.projectionsStored || Object.entries(summary.sources ?? {}).some(([s, n]) => (sourceCounts[s] ?? 0) !== n) || Object.values(summary.sources ?? {}).reduce((a, n) => a + n, 0) !== fresh.length) throw Error(`Exact SQLite readback failed: refresh reported ${summary.projectionsStored}, found ${fresh.length} newly persisted rows for ${target.scoringPeriod}.`);
    receipt.persistence = { path: after.dbPath, leagueId: '98806880', scoringPeriod: target.scoringPeriod, freshRows: fresh.length, totalRows: after.rows.length, sources: sourceCounts, oldestFreshAt: fresh.map(r => r.persistedAt).sort()[0], newestFreshAt: fresh.map(r => r.persistedAt).sort().at(-1) };
    const model = await modelFile(dataDir);
    if (model.records < summary.modelsRebuilt || !Number.isFinite(Date.parse(model.savedAt)) || Date.parse(model.savedAt) < Date.parse(refreshStartedAt) || Date.parse(model.modifiedAt) < Date.parse(refreshStartedAt) || beforeModel && Date.parse(model.savedAt) <= Date.parse(beforeModel.savedAt)) throw Error('Model file has no newly saved nonzero records from this refresh.');
    const coverage = starters.map(p => {
      const rows = fresh.filter(r => r.player_id === p.playerId);
      const points = rows.map(r => r.projected_points);
      const currentModel = model.models.find(m => m.playerId === p.playerId);
      const proTeam = proTeams.find(t => t.id === p.proTeamId);
      const bye = proTeam.byeWeek === target.week;
      if ((!rows.length && !bye) || !currentModel || !Number.isFinite(currentModel.mu)) throw Error(`${p.name}: current starter lacks fresh projection/model coverage.`);
      const positive = points.some(n => n > 0);
      const zero = points.some(n => n === 0);
      if (!bye && !positive && !zero) throw Error(`${p.name}: current starter has no positive or valid explicit zero projection.`);
      return { ...p, status: bye ? 'bye' : positive ? 'positive' : 'zero_projection', ...(bye ? {byeWeek: target.week, byeEvidence: 'ESPN published pro-team byeWeek; no game in target period'} : {}), sources: rows.map(r => r.source), points };
    });
    receipt.coverage = { total: starters.length, covered: coverage.length, starters: coverage };
    const { models, ...modelData } = model;
    receipt.modelFile = modelData;
    receipt.status = 'complete';
    receipt.completedAt = clock().toISOString();
    await atomicReceipt(receiptPath, receipt);
    return receipt;
  } catch (error) {
    receipt.status = 'failed'; receipt.error = error.message; receipt.failedAt = clock().toISOString(); receipt.receiptPath = receiptPath;
    await atomicReceipt(receiptPath, receipt);
    throw Error(`${error.message} Receipt: ${receiptPath}`, { cause: error });
  }
}

/** Fresh read-role subprocess; intentionally no rebuild, orchestration, or operator call. */
export async function refreshThroughReadMcp({ root, dataDir, args, env = process.env, client, transportFactory }) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  client ??= new Client({ name: 'tuesday-projection-persistence', version: '1' });
  transportFactory ??= options => new StdioClientTransport(options);
  const childEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string'));
  try {
    await client.connect(transportFactory({ command: process.execPath, args: [resolve(root, 'dist/src/mcp/stdio.js')], cwd: root, env: { ...childEnv, PMT_DATA_DIR: dataDir, PMT_MCP_ROLE: 'read', PMT_EXECUTION_ENABLED: 'false' }, stderr: 'pipe' }));
    const result = await client.callTool({ name: 'pmt_refresh_projections', arguments: args }, undefined, { timeout: 300000 });
    const envelope = JSON.parse(result.content.find(c => c.type === 'text').text);
    if (result.isError || !envelope.ok || !envelope.data?.refresh) throw Error(`pmt_refresh_projections failed: ${envelope.error?.message ?? 'missing refresh result'}`);
    return envelope.data.refresh;
  } finally { await client.close(); }
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node scripts/refresh-tuesday-projections.mjs [--week 1..18]\nNo week: first whole upcoming published NFL week. Explicit week also permits an in-progress current week. Writes only PMT refresh data/models/receipt; never ESPN transactions or proposals.');
    return;
  }
  let week;
  if (argv.length) {
    const value = argv.length === 2 && argv[0] === '--week' ? argv[1] : argv.length === 1 && argv[0].startsWith('--week=') ? argv[0].slice(7) : undefined;
    if (!value || !/^(?:[1-9]|1[0-8])$/.test(value)) throw Error('--week must be an integer from 1 to 18. Usage: refresh-tuesday-projections.mjs [--week 7]');
    week = Number(value);
  }
  const root = resolve(import.meta.dirname, '..');
  process.chdir(root);
  const [{ loadEnv }, { loadEspnCredentials }, { loadRuntimeConfig }, { EspnPlatformReader }] = await Promise.all([
    import('../dist/src/config/load-env.js'), import('../dist/src/adapters/espn/espn-auth.js'), import('../dist/src/config/runtime-config.js'), import('../dist/src/adapters/espn/espn-platform-reader.js')
  ]);
  loadEnv();
  const credentials = loadEspnCredentials();
  const config = loadRuntimeConfig();
  if (config.platform !== 'espn' || config.leagueExternalId !== '98806880' || config.teamExternalId !== '7' || config.season !== '2026') throw Error('Runtime configuration must be ESPN league 98806880/team 7/season 2026.');
  const reader = new EspnPlatformReader({ credentials });
  const receipt = await runProjectionRefresh({ dataDir: config.dataDir, credentials, teamId: config.teamExternalId, week,
    readLeague: () => reader.getLeagueFresh(),
    readSchedule: async () => {
      const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${credentials.season}?view=proTeamSchedules_wl`;
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`Published ESPN NFL schedule HTTP ${response.status}.`);
      return (await response.json()).settings?.proTeams;
    },
    refresh: args => refreshThroughReadMcp({ root, dataDir: config.dataDir, args })
  });
  console.log(JSON.stringify({status: receipt.status, targetWeek: receipt.targetWeek, scoringPeriod: receipt.scoringPeriod, timing: receipt.timing, projectionsStored: receipt.refresh.projectionsStored, freshRows: receipt.persistence.freshRows, modelsRebuilt: receipt.refresh.modelsRebuilt, starterCoverage: `${receipt.coverage.covered}/${receipt.coverage.total}`, receiptPath: receipt.receiptPath}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(`Tuesday projection persistence FAILED: ${error.message}`); process.exitCode = 1; }
}
