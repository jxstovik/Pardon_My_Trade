import { readPregameArchive } from '../probabilistic/pregame-archive.js';
import { readFile, readdir, mkdir, open, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export function scoutPaths(week) {
    if (!Number.isInteger(week) || week < 1 || week > 18)
        throw new Error('Week must be 1..18.');
    const dir = resolve(root, `output/pdf/week${week}-scout`);
    return { dir, status: resolve(dir, 'workflow-status.json'), html: resolve(dir, `week${week}-scout-interactive.html`), markdown: resolve(dir, `week${week}-scout-report.md`) };
}
export async function getScoutingReport(week) {
    const paths = scoutPaths(week);
    try {
        return { workflow: JSON.parse(await readFile(paths.status, 'utf8')), artifacts: paths };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { workflow: { status: 'not_run', week }, artifacts: paths };
        throw error;
    }
}
export async function startScoutingReport(week, asOf) {
    const paths = scoutPaths(week);
    const existing = await getScoutingReport(week);
    const state = existing.workflow;
    if (state.status === 'running' && Date.now() - Date.parse(String(state.startedAt)) < 30 * 60 * 1000)
        return { ...existing, already_running: true };
    await mkdir(paths.dir, { recursive: true });
    const args = [resolve(root, 'scripts/weekly-scout.mjs'), '--week', String(week), ...(asOf ? ['--as-of', asOf] : [])];
    const log = await open(resolve(paths.dir, 'workflow.log'), 'a', 0o600);
    await writeFile(paths.status, JSON.stringify({ status: 'running', stage: 'starting', week, startedAt: new Date().toISOString(), platformWrites: 0 }));
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, PMT_MCP_ROLE: 'read', PMT_EXECUTION_ENABLED: 'false' }, detached: true, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((ok, bad) => { child.once('spawn', ok); child.once('error', bad); });
    child.unref();
    await log.close();
    return { workflow: { status: 'running', week, pid: child.pid }, artifacts: paths, next_tool: 'pmt_get_scout_report', note: 'Poll for completion. Candidate-only model refresh; no ESPN writes or promotion.' };
}
export async function getModelEvaluation() {
    const dir = resolve(root, 'output/evaluation/2026-model-performance');
    try {
        const state = JSON.parse(await readFile(resolve(dir, 'status.json'), 'utf8'));
        const summary = state.summary ?? {};
        const calibration = state.calibrationCandidate ?? summary.calibration;
        return { workflow: { status: state.status, stage: state.stage, startedAt: state.startedAt, completedAt: state.completedAt, error: state.error, platformWrites: state.platformWrites, modelPromotions: state.modelPromotions, summary: { overall: summary.overall, rosterOverall: summary.rosterOverall, targetAudit: summary.targetAudit }, calibrationCandidate: calibration ? { candidateVersion: calibration.candidateVersion, status: calibration.status, comparisons: calibration.comparisons, cutoffRule: calibration.cutoffRule, limitations: calibration.limitations } : undefined, forecastArchives: state.forecastArchives, verification: state.verification }, artifacts: state.artifacts ?? { dir } };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { workflow: { status: 'not_run' }, artifacts: { dir } };
        throw error;
    }
}
export async function startModelEvaluation() {
    const existing = await getModelEvaluation();
    const state = existing.workflow;
    if (state.status === 'running' && Date.now() - Date.parse(String(state.startedAt)) < 60 * 60 * 1000)
        return { ...existing, already_running: true };
    const dir = resolve(root, 'output/evaluation/2026-model-performance');
    await mkdir(dir, { recursive: true });
    const log = await open(resolve(dir, 'workflow.log'), 'a', 0o600);
    await writeFile(resolve(dir, 'status.json'), JSON.stringify({ status: 'running', stage: 'starting', startedAt: new Date().toISOString(), platformWrites: 0, modelPromotions: 0 }));
    const child = spawn(process.execPath, [resolve(root, 'scripts/evaluate-season.mjs')], { cwd: root, env: { ...process.env, PMT_MCP_ROLE: 'read', PMT_EXECUTION_ENABLED: 'false' }, detached: true, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((ok, bad) => { child.once('spawn', ok); child.once('error', bad); });
    child.unref();
    await log.close();
    return { workflow: { status: 'running', pid: child.pid }, next_tool: 'pmt_get_model_evaluation', note: 'Isolated causal replay and actual-scoring audit; no ESPN write or model promotion.' };
}
export async function archivePregameForecasts(week) {
    if (!Number.isInteger(week) || week < 1 || week > 18)
        throw new Error('Week must be 1..18.');
    return new Promise((ok, bad) => { const child = spawn(process.execPath, [resolve(root, 'scripts/archive-pregame.mjs'), '--week', String(week)], { cwd: root, env: { ...process.env, PMT_MCP_ROLE: 'read', PMT_EXECUTION_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '', error = ''; child.stdout.on('data', v => output += String(v)); child.stderr.on('data', v => error += String(v)); child.on('error', bad); child.on('exit', code => code === 0 ? ok(JSON.parse(output.trim())) : bad(new Error(error.slice(-1500) || 'Archive failed.'))); });
}
export async function getForecastArchives() {
    const dir = resolve(root, 'data/forecast-archives');
    let names;
    try {
        names = await readdir(dir);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return { archives: [], dir };
        throw e;
    }
    const archives = [];
    for (const name of names.filter(n => n.endsWith('.json')).sort()) {
        const path = resolve(dir, name), data = await readPregameArchive(path);
        archives.push({ path, sha256: data.sha256, recordedAt: data.recordedAt, season: data.payload.season, week: data.payload.week, firstKickoff: data.payload.firstKickoff, cutoffWeek: data.payload.cutoffWeek, modelVersion: data.payload.modelManifest.modelVersion, forecasts: data.payload.forecasts.length, status: 'immutable_pregame_verified' });
    }
    return { archives, dir };
}
