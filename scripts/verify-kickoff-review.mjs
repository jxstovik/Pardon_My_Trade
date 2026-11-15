/** Read-role end-to-end canary; never prepares, approves, executes, or delivers an action. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => i % 2 ? a : [...a, [v.replace(/^--/, ''), all[i + 1]]], []));
if (!args.season || !args.week || !args.kickoff) throw new Error('Use --season YYYY --week N --kickoff ISO_TIMESTAMP');
const client = new Client({ name: 'pmt-kickoff-read-canary', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/src/mcp/stdio.js'], env: { ...process.env, PMT_MCP_ROLE: 'read', PMT_EXECUTION_ENABLED: 'false' }, stderr: 'inherit' });
const call = async (name, arguments_) => {
  const response = await client.callTool({ name, arguments: arguments_ }, undefined, { timeout: 240000 });
  const envelope = JSON.parse(response.content.find(c => c.type === 'text').text);
  if (!envelope.ok) throw new Error(`${name}: ${envelope.error?.message}`);
  return envelope.data;
};
try {
  await client.connect(transport);
  const listed = (await client.listTools()).tools.map(t => t.name);
  for (const name of ['pmt_run_kickoff_review', 'pmt_finalize_kickoff_report', 'pmt_schedule_kickoff_reviews']) if (!listed.includes(name)) throw new Error(`Missing tool: ${name}`);
  const first = await call('pmt_run_kickoff_review', { season: args.season, nflWeek: Number(args.week), kickoff: args.kickoff });
  const final = await call('pmt_finalize_kickoff_report', { reportId: first.review.reportId });
  const dir = resolve('data/kickoff-verification'); await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'latest.json'), JSON.stringify({ review: first.review, final, platformWrites: 0 }, null, 2), { mode: 0o600 });
  await writeFile(resolve(dir, 'latest.md'), final.report, { mode: 0o600 });
  console.log(JSON.stringify({ status: final.status, reportId: first.review.reportId, players: first.review.players.map(p => ({ name: p.name, id: p.playerId, affected: p.affected, availability: p.availability })), changes: first.review.changes, blockers: first.review.blockers, action: final.action, artifacts: dir, platformWrites: 0 }, null, 2));
} finally { await client.close(); }
