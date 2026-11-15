import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const ROOT = resolve(import.meta.dirname, '..');

async function main(argv) {
  const persist = argv.includes('--persist');
  const reuse = argv.includes('--reuse');
  const buildIndex = argv.indexOf('--build-dir');
  const buildDir = resolve(ROOT, buildIndex >= 0 ? argv[buildIndex + 1] : 'dist');
  const known = argv.filter((arg, i) => i !== buildIndex + 1 || buildIndex < 0);
  if (known.some(arg => !['--audit', '--persist', '--reuse', '--build-dir'].includes(arg))) throw Error('Use --audit [--reuse] [--persist] [--build-dir DIR].');
  const moduleAt = path => import(pathToFileURL(join(buildDir, 'src', path)).href);
  const [{ loadEnv }, { loadRuntimeConfig }, { loadEspnCredentials }, { EspnPlatformClient },
    { ESPN_SCORING_STATS }, { scoreProjectionPoints }, { matchProjectionsToRoster }] = await Promise.all([
    moduleAt('config/load-env.js'), moduleAt('config/runtime-config.js'), moduleAt('adapters/espn/espn-auth.js'),
    moduleAt('adapters/espn/espn-platform-client.js'), moduleAt('adapters/espn/espn-scoring.js'),
    moduleAt('rules/rule-engine.js'), moduleAt('projections/projection-matching.js')]);
  process.chdir(ROOT); loadEnv();
  const config = loadRuntimeConfig(); const credentials = loadEspnCredentials();
  if (config.platform !== 'espn' || config.leagueExternalId !== '98806880' || config.teamExternalId !== '7'
    || config.season !== '2026' || credentials.leagueId !== '98806880' || credentials.season !== '2026') throw Error('Require league 98806880/team 7/season 2026.');
  const out = resolve(ROOT, 'output/ros/2026-10-24/verified-espn');
  await mkdir(out, { recursive: true });
  const pointer = JSON.parse(await readFile(join(config.dataDir, 'last-snapshot.json'), 'utf8'));
  const db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
  const snapshot = JSON.parse(db.prepare('SELECT data FROM league_snapshots WHERE snapshot_id=?').get(pointer.snapshot_id).data);
  const team = snapshot.league.teams.find(t => t.external_id === '7');
  if (pointer.league_id !== '98806880' || snapshot.league.external_id !== '98806880' || snapshot.league.season !== '2026' || !team) throw Error('Snapshot scope mismatch.');
  if (snapshot.league.scoring_settings.rules.length !== 47) throw Error('Require repaired 47-rule snapshot.');
  const weeklyHash = () => sha(db.prepare('SELECT scoped_projection_id,data,updated_at FROM scoped_projections WHERE league_external_id=? AND scoring_period <> ? ORDER BY scoped_projection_id').all('98806880', '2026-ROS'));
  const beforeWeekly = weeklyHash();
  const beforeModels = sha(await readFile(join(config.dataDir, 'models.json'), 'utf8'));
  const client = new EspnPlatformClient({ credentials });
  const cache = async (name, retrieve) => {
    const path = join(out, name);
    if (reuse) {
      const saved = JSON.parse(await readFile(path, 'utf8'));
      const age = Date.now() - Date.parse(saved.fetchedAt);
      if (!Number.isFinite(age) || age < 0 || age > 3600000 || sha(saved.data) !== saved.sha256) throw Error(`Stale or changed evidence: ${name}`);
      return saved;
    }
    const data = await retrieve();
    const evidence = { fetchedAt: new Date().toISOString(), sha256: sha(data), data };
    await writeFile(path, JSON.stringify(evidence, null, 2) + '\n'); return evidence;
  };
  const scheduleEvidence = await cache('schedule.json', async () => {
    const url = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl';
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`ESPN schedule HTTP ${response.status}`);
    return { url, body: await response.json() };
  });
  const at = new Date();
  if (at.getUTCFullYear() !== 2026) throw Error('This bounded 2026 ingestion is not valid in another year.');
  const proTeams = scheduleEvidence.data.body.settings?.proTeams?.filter(t => t.id > 0);
  if (proTeams?.length !== 32 || new Set(proTeams.map(t => t.id)).size !== 32) throw Error('Require 32 distinct published NFL teams.');
  const schedule = new Map();
  const excluded = [];
  for (const t of proTeams) {
    const games = [];
    let seasonGames = 0;
    for (let week = 1; week <= 18; week++) {
      const entries = t.proGamesByScoringPeriod?.[week] ?? [];
      if (t.byeWeek === week && entries.length === 0) continue;
      if (entries.length !== 1) throw Error(`Ambiguous published team ${t.id} Week ${week}.`);
      const g = entries[0]; seasonGames++;
      if (g.scoringPeriodId !== week || !g.id || ![g.homeProTeamId, g.awayProTeamId].includes(t.id)) throw Error('Unverified game identity.');
      const other = proTeams.find(p => p.id === (g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId));
      const mirror = other?.proGamesByScoringPeriod?.[week]?.find(m => m.id === g.id);
      if (!mirror || mirror.homeProTeamId !== g.homeProTeamId || mirror.awayProTeamId !== g.awayProTeamId || mirror.date !== g.date) throw Error('Asymmetric published game identity.');
      // Future TBD kickoff dates do not invalidate an identified NFL-week game.
      // Current/past weeks require a real kickoff, never a placeholder time.
      if (week <= 7 && g.startTimeTBD !== false) throw Error('Unknown current/past kickoff.');
      const played = g.statsOfficial === true || (g.startTimeTBD === false && g.date <= at.getTime());
      if (week < 7 || played) { excluded.push({ team: t.abbrev, week, gameId: g.id }); continue; }
      games.push({ week, id: g.id, kickoff: g.startTimeTBD ? null : new Date(g.date).toISOString(), kickoffTbd: g.startTimeTBD });
    }
    if (seasonGames !== 17) throw Error(`Published team ${t.id} does not have 17 regular-season games.`);
    schedule.set(t.id, games);
  }
  const weekNumbers = [...new Set([...schedule.values()].flat().map(g => g.week))].sort((a, b) => a - b);
  const weeks = [];
  for (let i = 0; i < weekNumbers.length; i += 3) {
    const batch = await Promise.all(weekNumbers.slice(i, i + 3).map(async week => {
      const evidence = await cache(`week-${week}.json`, async () => {
        const players = []; let page = 0;
        while (page < 30) {
          const body = await client.getJson('', { view: ['kona_player_info'], scope: { season: '2026', segment: 0, readHost: true },
            query: { scoringPeriodId: week }, filter: { players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] }, filterSlotIds: { value: [] }, limit: 1500, offset: page * 1500, sortPercOwned: { sortPriority: 1, sortAsc: false } } } });
          if (!Array.isArray(body.players)) throw Error(`Week ${week} schema missing players.`);
          players.push(...body.players.map(e => e.player)); page++;
          if (body.players.length < 1500) break;
          if (page === 30) throw Error('Player pagination incomplete.');
        }
        if (new Set(players.map(p => p.id)).size !== players.length) throw Error('Duplicate source IDs.');
        return { week, players };
      });
      return { ...evidence.data, fetchedAt: evidence.fetchedAt, sha256: evidence.sha256 };
    }));
    weeks.push(...batch);
  }
  const players = [...new Map([...snapshot.players, ...snapshot.free_agents].map(p => [p.player_id, p])).values()];
  const verified = []; const rejected = [];
  for (const player of players) {
    const result = aggregateRemaining(player, weeks, schedule, snapshot.league.scoring_settings, scoreProjectionPoints, ESPN_SCORING_STATS);
    if (result) verified.push({ player, ...result });
    else rejected.push({ playerId: player.player_id, name: player.full_name, team: player.team, position: player.positions[0], reason: 'missing/mismatched period, identity, team, position, league rescore or future projection coverage' });
  }
  const source = 'espn-ros-remaining-weekly-sum';
  const observedAt = new Date().toISOString();
  const rows = matchProjectionsToRoster(verified.map(v => ({ player_id: v.player.player_id, name: v.player.full_name,
    team: v.player.team, positions: v.player.positions, observed_at: observedAt, scoring_period: '2026-ROS',
    projected_points: v.projected_points, projected_stats: v.projected_stats,
    // No calibrated ROS quantiles: equal endpoints explicitly represent an
    // unmodeled range, rather than fabricating statistical uncertainty.
    floor: v.projected_points, ceiling: v.projected_points, confidence: 0.7 })), players, '2026-ROS', source);
  const ownedIds = [...team.roster.starters, ...team.roster.bench, ...team.roster.injured_reserve].map(s => s.player_id).filter(Boolean);
  const owned = ownedIds.map(id => { const v = verified.find(v => v.player.player_id === id); return v ? {
    playerId: id, name: v.player.full_name, team: proTeams.find(t => t.id === Number(v.player.team))?.abbrev,
    position: v.player.positions[0], total: v.projected_points, remainingGames: v.remainingGames, ppg: v.pointsPerRemainingGame
  } : { playerId: id, name: players.find(p => p.player_id === id)?.full_name, missing: true }; });
  const blockers = [];
  if (rows.length !== verified.length || !rows.length) blockers.push('No complete verified canonical rows.');
  if (owned.some(p => p.missing)) blockers.push('Owned roster does not have complete remaining-game coverage.');
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) if (!verified.some(v => v.player.positions.includes(position))) blockers.push(`No verified ${position} projections.`);
  const report = { version: 1, status: blockers.length ? 'blocked' : 'verified_not_persisted', asOf: at.toISOString(), observedAt,
    leagueId: '98806880', teamId: '7', season: '2026', snapshotId: snapshot.snapshot_id, scoringRules: 47, scoringPeriod: '2026-ROS', source,
    semantics: 'Sum of league-scored ESPN projected stats (statSourceId=1, statSplitTypeId=1) for explicitly identified unstarted NFL regular-season games, through Week 18. No season-total/PPG relabeling; completed/started games and byes excluded. No calibrated ROS quantiles.',
    ranksCertified: false, safeNonQBDropsSupported: false, platformWrites: 0, modelWrites: 0,
    sourceSchedule: { path: join(out, 'schedule.json'), sha256: scheduleEvidence.sha256 },
    sourceWeeks: weeks.map(w => ({ week: w.week, fetchedAt: w.fetchedAt, sha256: w.sha256, players: w.players.length,
      url: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/98806880?view=kona_player_info&scoringPeriodId=${w.week}`,
      exactStatSelector: { seasonId: 2026, scoringPeriodId: w.week, statSourceId: 1, statSplitTypeId: 1 } })),
    counts: Object.fromEntries(['QB','RB','WR','TE','K','DST'].map(pos => [pos, verified.filter(v => v.player.positions.includes(pos)).length])),
    verifiedRows: rows.length, rejectedRows: rejected.length, owned, blockers,
    remainingSchedule: proTeams.map(t => ({ team: t.abbrev, teamId: t.id, games: schedule.get(t.id) })), excludedGames: excluded,
    weeklyUnchanged: beforeWeekly === weeklyHash(), modelsUnchanged: beforeModels === sha(await readFile(join(config.dataDir, 'models.json'), 'utf8')) };
  await writeFile(join(out, 'canonical-projections.json'), JSON.stringify(rows, null, 2) + '\n');
  await writeFile(join(out, 'player-provenance.json'), JSON.stringify(verified.map(({ player, ...v }) => ({ playerId: player.player_id, name: player.full_name, team: player.team, position: player.positions[0], ...v })), null, 2) + '\n');
  await writeFile(join(out, 'rejected.json'), JSON.stringify(rejected, null, 2) + '\n');
  if (persist) {
    if (blockers.length || !report.weeklyUnchanged || !report.modelsUnchanged) throw Error(`ROS persistence blocked: ${blockers.join('; ')}`);
    // Deliberately do NOT call persistCandidates: it also rebuilds models.json.
    const { SqliteKnowledgeRepository } = await moduleAt('knowledge/sqlite-knowledge-repository.js');
    const repository = new SqliteKnowledgeRepository({ filePath: config.databasePath });
    await repository.upsertProjections(rows, '98806880');
    const stored = (await repository.getProjections('2026-ROS', '98806880')).filter(p => p.source === source);
    assert.equal(stored.length, rows.length);
    const byId = new Map(stored.map(p => [p.projection_id, p]));
    for (const row of rows) assert.deepEqual(byId.get(row.projection_id), row);
    report.status = 'persisted_verified'; report.persistedRows = stored.length;
    report.weeklyUnchanged = beforeWeekly === weeklyHash();
    report.modelsUnchanged = beforeModels === sha(await readFile(join(config.dataDir, 'models.json'), 'utf8'));
    assert.ok(report.weeklyUnchanged && report.modelsUnchanged, 'Weekly rows and models must remain byte-identical');
  }
  db.close();
  await writeFile(join(out, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, verifiedRows: rows.length, counts: report.counts, rejectedRows: rejected.length, owned, blockers, weeklyUnchanged: report.weeklyUnchanged, modelsUnchanged: report.modelsUnchanged, receipt: join(out, 'receipt.json') }, null, 2));
}


// Tests live with this dedicated ingestion script to avoid shared build output.
export function aggregateRemaining(player, weeks, schedule, scoring, scoreProjectionPoints, statDictionary) {
  const games = schedule.get(Number(player.team));
  if (!games?.length) return undefined;
  const projected_stats = {};
  const weekly = [];
  let total = 0;
  const positions = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
  const normalize = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const game of games) {
    const feed = weeks.find(w => w.week === game.week);
    const source = feed?.players.find(p => String(p.id) === player.player_id);
    if (!source || Number(source.proTeamId) !== Number(player.team)
      || normalize(source.fullName ?? '') !== normalize(player.full_name)
      || !player.positions.includes(positions[source.defaultPositionId])) return undefined;
    const stats = source.stats?.filter(s => s.seasonId === 2026 && s.scoringPeriodId === game.week
      && s.statSourceId === 1 && s.statSplitTypeId === 1);
    if (stats?.length !== 1 || !Number.isFinite(stats[0].appliedTotal)) return undefined;
    const selected = stats[0];
    const mapped = {};
    for (const [id, value] of Object.entries(selected.stats ?? {})) {
      const key = statDictionary[Number(id)]?.stat;
      if (key && Number.isFinite(value)) mapped[key] = value;
    }
    // Re-score raw values; never multiply already-weighted appliedStats.
    const rescored = scoreProjectionPoints(scoring, { projected_stats: mapped, projected_points: selected.appliedTotal }, player.positions);
    if (!Number.isFinite(rescored) || Math.abs(rescored - selected.appliedTotal) > 0.021) return undefined;
    total += selected.appliedTotal;
    for (const [key, value] of Object.entries(mapped)) projected_stats[key] = (projected_stats[key] ?? 0) + value;
    weekly.push({ week: game.week, gameId: game.id, appliedTotal: selected.appliedTotal, rescored });
  }
  return { projected_points: Math.round(total * 100) / 100, projected_stats,
    remainingGames: games.length, pointsPerRemainingGame: total / games.length, weekly };
}

async function selfTest() {
  const player = { player_id: '1', full_name: 'Test Player', team: '2', positions: ['RB'] };
  const schedule = new Map([[2, [{ week: 7, id: 'a' }, { week: 9, id: 'b' }]]]);
  const row = (week, points, yards) => ({ week, players: [{ id: 1, fullName: 'Test Player', proTeamId: 2, defaultPositionId: 2,
    stats: [{ seasonId: 2026, scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: points, stats: { 24: yards, 210: 1 } }] }] });
  const score = (_settings, p) => p.projected_stats.rushing_yards * 0.1;
  const statDictionary = { 24: { stat: 'rushing_yards' } };
  const result = aggregateRemaining(player, [row(7, 10, 100), row(9, 20, 200)], schedule, {}, score, statDictionary);
  assert.equal(result?.projected_points, 30, 'ROS is the sum of independently identified remaining weekly projections, not PPG or full-season estimates');
  assert.equal(result?.projected_stats.rushing_yards, 300);
  assert.equal(result?.remainingGames, 2);
  assert.equal(result?.pointsPerRemainingGame, 15);
  assert.equal(aggregateRemaining(player, [row(7, 10, 100)], schedule, {}, score, statDictionary), undefined, 'missing future week fails closed');
  assert.equal(aggregateRemaining(player, [row(7, 10, 100), row(9, 21, 200)], schedule, {}, score, statDictionary), undefined, 'league score mismatch fails closed');
  const wrongTeam = row(9, 20, 200); wrongTeam.players[0].proTeamId = 3;
  assert.equal(aggregateRemaining(player, [row(7, 10, 100), wrongTeam], schedule, {}, score, statDictionary), undefined, 'ID match does not override a contradictory NFL team');
  const wrongPeriod = row(9, 20, 200); wrongPeriod.players[0].stats[0].scoringPeriodId = 8;
  assert.equal(aggregateRemaining(player, [row(7, 10, 100), wrongPeriod], schedule, {}, score, statDictionary), undefined, 'period match is mandatory');
  const wrongSeason = row(9, 20, 200); wrongSeason.players[0].stats[0].seasonId = 2025;
  assert.equal(aggregateRemaining(player, [row(7, 10, 100), wrongSeason], schedule, {}, score, statDictionary), undefined, 'a fresh response cannot relabel an older-season projection');
  const byeNoise = row(8, 999, 9990);
  assert.equal(aggregateRemaining(player, [row(7, 10, 100), byeNoise, row(9, 20, 200)], schedule, {}, score, statDictionary).projected_points, 30, 'byes and excluded games never contribute');
  console.log('ROS aggregation self-tests passed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') === '--self-test') await selfTest();
  else {
    try { await main(process.argv.slice(2)); }
    catch (error) { console.error(`Verified ROS ingestion FAILED: ${error.message}`); process.exitCode = 1; }
  }
}
