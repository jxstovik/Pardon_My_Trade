import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
function proTeams() {
    return Array.from({ length: 32 }, (_, i) => ({ id: i + 1, abbrev: `T${i + 1}`, byeWeek: 10,
        proGamesByScoringPeriod: Object.fromEntries(weeks.map(w => [String(w.week), [{ id: w.week * 100 + Math.floor(i / 2), homeProTeamId: Math.floor(i / 2) * 2 + 1, awayProTeamId: Math.floor(i / 2) * 2 + 2, scoringPeriodId: w.week, date: Date.parse(i < 2 ? w.firstKickoff : w.lastKickoff), startTimeTBD: false, validForLocking: true }]]))
    }));
}
const script = pathToFileURL(resolve(import.meta.dirname, '../../scripts/refresh-tuesday-projections.mjs')).href;
// Dynamic import keeps the regression runnable before the wrapper exists.
const api = async () => import(script).catch(() => ({}));
const weeks = [
    { week: 6, firstKickoff: '2026-10-16T00:15:00Z', lastKickoff: '2026-10-20T08:00:00Z', games: [], complete: true },
    { week: 7, firstKickoff: '2026-10-23T00:15:00Z', lastKickoff: '2026-10-27T00:15:00Z', games: [], complete: true },
    { week: 8, firstKickoff: '2026-10-30T00:15:00Z', lastKickoff: '2026-11-03T01:15:00Z', games: [], complete: true }
];
test('Tuesday Oct 20 at 03 ET selects whole Week 7, not a remaining Monday game', async () => {
    const { selectPlanningTarget } = await api();
    assert.equal(typeof selectPlanningTarget, 'function', 'deterministic schedule target resolver is implemented');
    const result = selectPlanningTarget({ at: new Date('2026-10-20T03:00:00-04:00'), season: '2026', espnWeek: 6, weeks });
    assert.equal(result.week, 7);
    assert.equal(result.scoringPeriod, '2026-W7');
    assert.equal(result.timing, 'before_first_kickoff');
});
test('published NFL schedule validates all teams and deduplicates mirrored games', async () => {
    const { publishedWeeks } = await api();
    assert.equal(typeof publishedWeeks, 'function');
    const parsed = publishedWeeks(proTeams());
    const week = parsed.find((w) => w.week === 7);
    assert.equal(week.complete, true);
    assert.equal(week.games.length, 16);
    assert.equal(Date.parse(week.firstKickoff), Date.parse(weeks[1].firstKickoff));
    const tbd = proTeams();
    tbd[0].proGamesByScoringPeriod['7'][0].startTimeTBD = true;
    assert.equal(publishedWeeks(tbd).find((w) => w.week === 7).complete, false);
    assert.throws(() => publishedWeeks(proTeams().slice(1)), /32|team/i);
});
test('Oct 27 selects Week 8 with either lagging or rolled-forward ESPN period', async () => {
    const { selectPlanningTarget } = await api();
    for (const espnWeek of [7, 8])
        assert.equal(selectPlanningTarget({ at: new Date('2026-10-27T03:00:00-04:00'), season: '2026', espnWeek, weeks }).week, 8);
});
test('Saturday explicit Week 7 is current and never labeled pregame; default is Week 8', async () => {
    const { selectPlanningTarget } = await api();
    const input = { at: new Date('2026-10-24T10:00:00Z'), season: '2026', espnWeek: 7, weeks };
    assert.equal(selectPlanningTarget({ ...input, week: 7 }).timing, 'in_progress_refresh_not_pregame');
    assert.equal(selectPlanningTarget(input).week, 8);
    assert.throws(() => selectPlanningTarget({ ...input, week: 6 }), /current|mapped/i);
});
test('missing/TBD near-term schedule and duplicate weeks fail closed', async () => {
    const { selectPlanningTarget } = await api();
    const input = { at: new Date('2026-10-20T07:00:00Z'), season: '2026', espnWeek: 6, weeks };
    assert.throws(() => selectPlanningTarget({ ...input, weeks: weeks.map(w => w.week === 6 ? { ...w, complete: false } : w) }), /schedule|ambiguous/i);
    assert.throws(() => selectPlanningTarget({ ...input, weeks: [...weeks, weeks[1]] }), /duplicate|ambiguous/i);
    assert.throws(() => selectPlanningTarget({ ...input, espnWeek: 4 }), /schedule|mapped/i);
});
async function persistenceFixture() {
    const dataDir = await mkdtemp(resolve(tmpdir(), 'pmt-tuesday-'));
    const db = new Database(resolve(dataDir, 'pmt.sqlite'));
    db.exec('CREATE TABLE league_snapshots (snapshot_id TEXT PRIMARY KEY, data TEXT); CREATE TABLE scoped_projections (scoped_projection_id TEXT PRIMARY KEY, league_external_id TEXT, scoring_period TEXT, data TEXT, updated_at TEXT)');
    const snapshot = { snapshot_id: 'snapshot-owned', league: { platform: 'espn', external_id: '98806880', season: '2026', teams: [{ external_id: '7', team_id: '7' }] }, players: [{ player_id: 'canonical-101', external_id: '101', external_ids: { espn: '101' } }], free_agents: [] };
    db.prepare('INSERT INTO league_snapshots VALUES (?,?)').run(snapshot.snapshot_id, JSON.stringify(snapshot));
    await writeFile(resolve(dataDir, 'last-snapshot.json'), JSON.stringify({ snapshot_id: snapshot.snapshot_id, league_id: '98806880' }));
    let calls = 0;
    const raw = { id: 98806880, seasonId: 2026, scoringPeriodId: 6, settings: { scheduleSettings: { matchupPeriods: { '7': [7] } }, rosterSettings: { lineupSlotCounts: { '0': 1, '20': 5, '21': 1 } } }, schedule: [{ matchupPeriodId: 7, home: { teamId: 7 }, away: { teamId: 1 } }], teams: [{ id: 7, owners: ['owner-safe-test-id'], roster: { entries: [{ playerId: 101, lineupSlotId: 0, playerPoolEntry: { player: { id: 101, fullName: 'Fixture Quarterback', proTeamId: 1 } } }] } }] };
    const deps = { dataDir, credentials: { leagueId: '98806880', season: '2026', swid: 'owner-safe-test-id' }, teamId: '7', clock: () => new Date('2026-10-20T07:00:00Z'), readLeague: async () => raw, readSchedule: async () => proTeams(),
        refresh: async (args) => {
            calls++;
            assert.deepEqual(args, { season: '2026', week: 7, force: true });
            const ts = new Date(Date.parse('2026-10-20T07:00:00Z') + calls).toISOString();
            const projection = { projection_id: 'espn-canonical-101-2026-W7', player_id: 'canonical-101', source: 'espn', scoring_period: '2026-W7', projected_points: 20 };
            db.prepare('INSERT INTO scoped_projections VALUES (?,?,?,?,?) ON CONFLICT(scoped_projection_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run('98806880|p', '98806880', '2026-W7', JSON.stringify(projection), ts);
            await writeFile(resolve(dataDir, 'models.json'), JSON.stringify({ saved_at: ts, models: [{ playerId: 'canonical-101', mu: 20 }] }));
            return { snapshotId: snapshot.snapshot_id, season: '2026', scoringPeriod: '2026-W7', projectionsStored: 1, modelsRebuilt: 1, sources: { espn: 1 }, skipped: {}, errors: [] };
        }
    };
    return { dataDir, db, deps, raw, snapshot, calls: () => calls, close: async () => { db.close(); await rm(dataDir, { recursive: true, force: true }); } };
}
test('refresh force-persists exact league/period, independently reads SQLite and atomically replaces receipt on repeat', async () => {
    const { runProjectionRefresh } = await api();
    assert.equal(typeof runProjectionRefresh, 'function', 'real persistence wrapper is implemented');
    const f = await persistenceFixture();
    try {
        const first = await runProjectionRefresh(f.deps);
        assert.equal(first.status, 'complete');
        assert.equal(first.targetWeek, 7);
        assert.equal(first.scoringPeriod, '2026-W7');
        assert.equal(first.persistence.freshRows, 1);
        assert.equal(first.coverage.starters[0].status, 'positive');
        const second = await runProjectionRefresh(f.deps);
        assert.equal(second.receiptPath, first.receiptPath);
        assert.equal(f.calls(), 2);
        assert.equal(f.db.prepare('SELECT count(*) AS n FROM scoped_projections').get() && f.db.prepare('SELECT count(*) AS n FROM scoped_projections').get().n, 1);
        assert.equal(JSON.parse(await readFile(second.receiptPath, 'utf8')).status, 'complete');
        assert.equal((await readdir(resolve(f.dataDir, 'weekly-projections'))).filter(n => n.endsWith('.tmp')).length, 0);
    }
    finally {
        await f.close();
    }
});
test('MCP refresh may sync a new snapshot; verify its exact readback instead of requiring old pointer', async () => {
    const { runProjectionRefresh } = await api();
    const f = await persistenceFixture();
    try {
        const original = f.deps.refresh;
        f.deps.refresh = async (args) => {
            const result = await original(args);
            const next = { ...f.snapshot, snapshot_id: 'fresh-synced-snapshot' };
            f.db.prepare('INSERT INTO league_snapshots VALUES (?,?)').run(next.snapshot_id, JSON.stringify(next));
            await writeFile(resolve(f.dataDir, 'last-snapshot.json'), JSON.stringify({ snapshot_id: next.snapshot_id, league_id: '98806880' }));
            return { ...result, snapshotId: next.snapshot_id };
        };
        assert.equal((await runProjectionRefresh(f.deps)).refresh.snapshotId, 'fresh-synced-snapshot');
    }
    finally {
        await f.close();
    }
});
test('read-MCP child forces read role, disabled execution, exact target and closes after request', async () => {
    const { refreshThroughReadMcp } = await api();
    assert.equal(typeof refreshThroughReadMcp, 'function');
    const calls = [];
    const client = { connect: async (t) => { calls.push(t); }, callTool: async (request) => { calls.push(request); return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data: { refresh: { scoringPeriod: '2026-W7' } } }) }] }; }, close: async () => { calls.push('closed'); } };
    const result = await refreshThroughReadMcp({ root: '/repo', dataDir: '/repo/data', args: { season: '2026', week: 7, force: true }, env: { PMT_MCP_ROLE: 'operator', PMT_EXECUTION_ENABLED: 'true' }, client, transportFactory: (options) => options });
    assert.equal(result.scoringPeriod, '2026-W7');
    assert.equal(calls[0].env.PMT_MCP_ROLE, 'read');
    assert.equal(calls[0].env.PMT_EXECUTION_ENABLED, 'false');
    assert.equal(calls[0].args[0], '/repo/dist/src/mcp/stdio.js');
    assert.deepEqual(calls[1], { name: 'pmt_refresh_projections', arguments: { season: '2026', week: 7, force: true } });
    assert.equal(calls[2], 'closed');
});
test('CLI help and invalid week do not start any network work', () => {
    const path = resolve(import.meta.dirname, '../../scripts/refresh-tuesday-projections.mjs');
    const help = execFileSync(process.execPath, [path, '--help'], { encoding: 'utf8' });
    assert.match(help, /--week/);
    assert.throws(() => execFileSync(process.execPath, [path, '--week', '0'], { encoding: 'utf8', stdio: 'pipe' }), (error) => error.status === 1 && /--week must be an integer from 1 to 18/.test(error.stderr));
});
test('fresh explicit zero projections are coverage, and published byes are named', async () => {
    const { runProjectionRefresh } = await api();
    for (const bye of [false, true]) {
        const f = await persistenceFixture();
        try {
            if (bye)
                f.deps.readSchedule = async () => {
                    const teams = proTeams();
                    for (const t of teams.slice(0, 2)) {
                        t.byeWeek = 7;
                        delete t.proGamesByScoringPeriod['7'];
                    }
                    return teams;
                };
            const original = f.deps.refresh;
            f.deps.refresh = async (args) => {
                const result = await original(args);
                f.db.prepare("UPDATE scoped_projections SET data=json_set(data,'$.projected_points',0)").run();
                return result;
            };
            const result = await runProjectionRefresh(f.deps);
            assert.equal(result.coverage.starters[0].status, bye ? 'bye' : 'zero_projection');
            if (bye)
                assert.equal(result.coverage.starters[0].byeWeek, 7);
        }
        finally {
            await f.close();
        }
    }
});
test('an empty required starter slot fails before any refresh', async () => {
    const { runProjectionRefresh } = await api();
    const f = await persistenceFixture();
    try {
        f.raw.settings.rosterSettings.lineupSlotCounts['2'] = 1;
        await assert.rejects(runProjectionRefresh(f.deps), /starting slot|starter slot/i);
        assert.equal(f.calls(), 0);
    }
    finally {
        await f.close();
    }
});
test('invalid saved_at is not a fresh model file', async () => {
    const { runProjectionRefresh } = await api();
    const f = await persistenceFixture();
    try {
        const original = f.deps.refresh;
        f.deps.refresh = async (args) => {
            const result = await original(args);
            await writeFile(resolve(f.dataDir, 'models.json'), JSON.stringify({ saved_at: 'not-a-time', models: [{ playerId: 'canonical-101', mu: 20 }] }));
            return result;
        };
        await assert.rejects(runProjectionRefresh(f.deps), /model file/i);
    }
    finally {
        await f.close();
    }
});
for (const failure of ['zero', 'wrong-period', 'errors', 'old-rows', 'other-league', 'wrong-row-period', 'no-models', 'missing-starter', 'scope', 'mapping', 'owner']) {
    test(`persistence fails closed: ${failure}`, async () => {
        const { runProjectionRefresh } = await api();
        const f = await persistenceFixture();
        try {
            const original = f.deps.refresh;
            if (failure === 'scope')
                f.raw.id = 123;
            if (failure === 'mapping')
                f.raw.settings.scheduleSettings.matchupPeriods['99'] = [7];
            if (failure === 'owner')
                f.raw.teams[0].owners = [];
            f.deps.refresh = async (args) => {
                const result = await original(args);
                if (failure === 'zero')
                    result.projectionsStored = 0;
                if (failure === 'wrong-period')
                    result.scoringPeriod = '2026-W6';
                if (failure === 'errors')
                    result.errors = ['ESPN unavailable'];
                if (failure === 'old-rows')
                    f.db.prepare("UPDATE scoped_projections SET updated_at='2026-10-19T07:00:00Z'").run();
                if (failure === 'other-league')
                    f.db.prepare("UPDATE scoped_projections SET league_external_id='123'").run();
                if (failure === 'wrong-row-period')
                    f.db.prepare("UPDATE scoped_projections SET data=json_set(data,'$.scoring_period','2026-W6')").run();
                if (failure === 'no-models')
                    await writeFile(resolve(f.dataDir, 'models.json'), JSON.stringify({ saved_at: '2026-10-20T07:00:01Z', models: [] }));
                if (failure === 'missing-starter')
                    f.db.prepare("UPDATE scoped_projections SET data=json_set(data,'$.player_id','unowned')").run();
                return result;
            };
            await assert.rejects(runProjectionRefresh(f.deps), /Receipt:/);
            const names = await readdir(resolve(f.dataDir, 'weekly-projections'));
            const receipt = JSON.parse(await readFile(resolve(f.dataDir, 'weekly-projections', names[0]), 'utf8'));
            assert.equal(receipt.status, 'failed');
            if (['scope', 'mapping', 'owner'].includes(failure))
                assert.equal(f.calls(), 0);
        }
        finally {
            await f.close();
        }
    });
}
