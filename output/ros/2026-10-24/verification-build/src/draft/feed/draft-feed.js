import { appendFile, readFile } from "node:fs/promises";
/**
 * Human-driven feed. The `pmt draft-pick` command enqueues events here; the
 * live ESPN poller is the primary feed, and this is the always-available
 * backup used when the live feed is unreachable or unverified.
 *
 * When `storagePath` is provided the feed is durable across CLI invocations:
 * every enqueued pick is appended to a JSONL file and the queue is reloaded on
 * construction, so a human-entered pick survives process restarts and can be
 * read by a separate `draft-watch` process.
 */
export class ManualDraftFeed {
    storagePath;
    name = "manual";
    available = true;
    queue = [];
    nextPickNo = 1;
    constructor(storagePath) {
        this.storagePath = storagePath;
        if (storagePath) {
            void this.hydrate();
        }
    }
    async hydrate() {
        try {
            const raw = await readFile(this.storagePath, "utf8");
            for (const line of raw.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                const event = JSON.parse(trimmed);
                this.queue.push(event);
                this.nextPickNo = Math.max(this.nextPickNo, event.pickNo + 1);
            }
        }
        catch {
            // No prior file; start empty.
        }
    }
    enqueue(input, now = () => Date.now()) {
        const pickNo = input.pickNo ?? this.nextPickNo;
        this.nextPickNo = Math.max(this.nextPickNo, pickNo + 1);
        const event = {
            pickNo,
            round: input.round,
            roundPick: input.roundPick,
            teamId: input.teamId,
            playerExternalId: input.playerExternalId,
            source: "manual",
            timestamp: now()
        };
        this.queue.push(event);
        if (this.storagePath) {
            void appendFile(this.storagePath, JSON.stringify(event) + "\n", "utf8");
        }
        return event;
    }
    /** Snapshot and clear everything enqueued since the last poll. */
    async poll() {
        if (this.queue.length === 0)
            return [];
        const drained = this.queue.slice();
        this.queue.length = 0;
        return drained;
    }
    get pending() {
        return this.queue.length;
    }
}
/**
 * Composite feed that merges the primary (live ESPN poll) with the backup
 * (manual) and de-duplicates by `pickNo`, preferring the primary on conflict.
 *
 * Both feeds are always polled. This matters because the ESPN live endpoint is
 * unverified and may report success while returning no picks; an exclusive
 * fallback would then drop the human's manual picks and leave the board empty.
 * Merging guarantees the manual backup is always captured, and ESPN overrides
 * it when both report the same pick.
 */
export class FallbackDraftFeed {
    primary;
    backup;
    constructor(primary, backup) {
        this.primary = primary;
        this.backup = backup;
    }
    get name() {
        return `fallback(${this.primary.name}+${this.backup.name})`;
    }
    get available() {
        return this.primary.available || this.backup.available;
    }
    async poll() {
        const [primaryEvents, backupEvents] = await Promise.all([
            this.safePoll(this.primary),
            this.safePoll(this.backup)
        ]);
        const byPick = new Map();
        for (const event of backupEvents)
            byPick.set(event.pickNo, event);
        for (const event of primaryEvents)
            byPick.set(event.pickNo, event);
        return Array.from(byPick.values()).sort((a, b) => a.pickNo - b.pickNo);
    }
    async safePoll(feed) {
        if (!feed.available)
            return [];
        try {
            return await feed.poll();
        }
        catch {
            return [];
        }
    }
}
