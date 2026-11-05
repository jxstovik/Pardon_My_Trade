import { open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from '../dist/src/config/load-env.js';
import { loadRuntimeConfig } from '../dist/src/config/runtime-config.js';
import { ActionQueue, SqliteActionQueueStore } from '../dist/src/agents/action-queue.js';
import { ActionExecutor, SqliteActionExecutionStore, rosterFingerprint } from '../dist/src/agents/action-executor.js';
import { executeAutomaticLineup } from '../dist/src/agents/automatic-lineups.js';
import { EspnPlatformReader } from '../dist/src/adapters/espn/espn-platform-reader.js';
import { EspnPlatformWriter, buildEspnLineupTransaction } from '../dist/src/adapters/espn/espn-platform-writer.js';
import { sameScoringPeriod } from '../dist/src/models/scoring-period.js';

loadEnv();
const actionId = process.argv[2];
if (!actionId || process.argv.length !== 3) throw new Error('Usage: node scripts/execute-automatic-lineup.mjs <exact-queued-lineup-action-id>');
const authorization = JSON.parse(await readFile(new URL('../config/football-lineup-authorization.json', import.meta.url), 'utf8'));
const config = loadRuntimeConfig();
if (config.platform !== 'espn' || config.leagueExternalId !== authorization.leagueId || config.teamExternalId !== authorization.teamId || config.season !== authorization.season) throw new Error('Runtime differs from authorized ESPN league/team/season.');
const queue = new ActionQueue(new SqliteActionQueueStore(config.databasePath));
const reader = new EspnPlatformReader();
const writer = new EspnPlatformWriter();
if (writer.client.credentials.leagueId !== authorization.leagueId || writer.client.credentials.season !== authorization.season) throw new Error('Writer credentials differ from authorized scope.');
const store = new SqliteActionExecutionStore(config.databasePath);
const lockPath = resolve(config.dataDir, `automatic-lineup-${authorization.leagueId}-${authorization.teamId}.lock`);
const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Lineup runner already active or stale lock present; reconcile receipts before removing its lock.'); });
try {
const result = await executeAutomaticLineup({
  authorization, actionId, queue,
  executor: new ActionExecutor({ queue, reader, writer, store, leagueExternalId: authorization.leagueId, actor: `standing-lineup:${authorization.authorizedBy}` }),
  preview: async queued => {
    if (queued.action.type !== 'set_roster') throw new Error('Only lineups are authorized.');
    const fresh = await reader.getLeagueFresh();
    if (String(fresh.id) !== authorization.leagueId || String(fresh.seasonId) !== authorization.season || !sameScoringPeriod(`${fresh.seasonId}-W${fresh.scoringPeriodId}`, queued.preconditions.scoringPeriod)) throw new Error('Fresh league/season/period differs from proposal.');
    const roster = await reader.getRoster(authorization.leagueId, authorization.teamId);
    if (rosterFingerprint(roster) !== queued.preconditions.expectedRosterHashes[authorization.teamId]) throw new Error('Roster changed since proposal.');
    const team = fresh.teams?.find(team => String(team.id) === authorization.teamId);
    buildEspnLineupTransaction(queued.action, writer.client.credentials.swid, fresh.scoringPeriodId, team?.roster?.entries ?? [], fresh.settings?.rosterSettings?.lineupSlotCounts ?? {});
    // An uncertain submission in this league/team must be reconciled first.
    const actions = await queue.list();
    for (const receipt of await store.listReceipts()) {
      const previous = actions.find(row => row.actionId === receipt.actionId);
      if (receipt.status === 'unknown' && previous?.preconditions?.leagueExternalId === authorization.leagueId && previous.action.type === 'set_roster' && previous.action.teamId === authorization.teamId) throw new Error('Unresolved lineup receipt; reconcile before submitting another lineup.');
    }
  }
});
let verified = false;
if (result.status === 'executed' || result.status === 'already_executed') {
  await reader.getLeagueFresh();
  const roster = await reader.getRoster(authorization.leagueId, authorization.teamId);
  const action = (await queue.get(actionId)).action;
  verified = action.type === 'set_roster' && roster.starters.length === action.starters.length && action.starters.every(desired => roster.starters.some(actual => actual.player_id === desired.playerId && actual.slot_type === desired.slot));
}
console.log(JSON.stringify({ actionId, status: result.status, reason: result.reason, verified, audit: await store.listAudit().then(rows => rows.filter(row => row.actionId === actionId)) }, null, 2));
if (!verified) process.exitCode = 1;
} finally {
  await lock.close();
  await unlink(lockPath);
}
