import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export function archiveDigest(payload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export async function savePregameArchive(directory, payload, now = new Date()) {
    const built = Date.parse(payload.builtAt), kickoff = Date.parse(payload.firstKickoff), recorded = now.getTime();
    if (!Number.isInteger(payload.week) || payload.week < 1 || payload.week > 18 || payload.cutoffWeek >= payload.week || !Number.isInteger(payload.cutoffWeek) || payload.cutoffWeek < 0)
        throw new Error('Invalid causal archive scope.');
    if (!Number.isFinite(built) || !Number.isFinite(kickoff) || built > recorded || built >= kickoff || recorded >= kickoff)
        throw new Error('Cannot label a late or future-dated snapshot as pregame.');
    if (!payload.forecasts.length || !Object.keys(payload.models).length)
        throw new Error('Archive requires forecasts and model weights.');
    const sha256 = archiveDigest(payload);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${payload.season}-W${payload.week}-${sha256}.json`);
    const envelope = { schemaVersion: 1, recordedAt: now.toISOString(), sha256, payload };
    const temporary = join(directory, `.pending-${randomUUID()}`);
    await writeFile(temporary, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
    try {
        await link(temporary, path);
        return { path, created: true, sha256 };
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        const prior = JSON.parse(await readFile(path, 'utf8'));
        if (prior.sha256 !== sha256 || archiveDigest(prior.payload) !== sha256 || Date.parse(prior.recordedAt) >= kickoff)
            throw new Error('Existing archive failed integrity validation.');
        return { path, created: false, sha256 };
    }
    finally {
        await unlink(temporary);
    }
}
export async function readPregameArchive(path) {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (!Number.isFinite(Date.parse(data.recordedAt)) || !Number.isFinite(Date.parse(data.payload?.firstKickoff)) || !Number.isFinite(Date.parse(data.payload?.builtAt)) || data.schemaVersion !== 1 || archiveDigest(data.payload) !== data.sha256 || Date.parse(data.recordedAt) >= Date.parse(data.payload.firstKickoff) || Date.parse(data.payload.builtAt) > Date.parse(data.recordedAt) || data.payload.cutoffWeek >= data.payload.week)
        throw new Error('Invalid or tampered pregame archive.');
    return data;
}
