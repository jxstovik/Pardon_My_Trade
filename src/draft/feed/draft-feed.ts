/** A single pick observed on a draft board, regardless of which feed saw it. */
export interface DraftPickEvent {
  /** Overall pick number within the draft (1-based). */
  readonly pickNo: number;
  readonly round: number;
  readonly roundPick: number;
  /** External id of the team/manager that made the pick. */
  readonly teamId: string;
  /** External player id as reported by the source feed (e.g. ESPN numeric id). */
  readonly playerExternalId: string;
  /** Which feed produced this event. */
  readonly source: "espn" | "manual";
  readonly timestamp: number;
}

/** A pick supplied by a human through the manual `draft-pick` path. */
export interface ManualPickInput {
  readonly pickNo?: number;
  readonly round: number;
  readonly roundPick: number;
  readonly teamId: string;
  readonly playerExternalId: string;
}

/**
 * A source of draft picks. A feed is polled repeatedly; each call returns only
 * the picks made since the previous call (or [] when nothing is new).
 */
export interface DraftFeed {
  readonly name: string;
  /** Whether this feed can currently be polled without guaranteed failure. */
  readonly available: boolean;
  poll(): Promise<readonly DraftPickEvent[]>;
}

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
export class ManualDraftFeed implements DraftFeed {
  readonly name = "manual";
  readonly available = true;

  private readonly queue: DraftPickEvent[] = [];
  private nextPickNo = 1;

  constructor(private readonly storagePath?: string) {
    if (storagePath) {
      void this.hydrate();
    }
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await readFile(this.storagePath!, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed) as DraftPickEvent;
        this.queue.push(event);
        this.nextPickNo = Math.max(this.nextPickNo, event.pickNo + 1);
      }
    } catch {
      // No prior file; start empty.
    }
  }

  enqueue(input: ManualPickInput, now: () => number = () => Date.now()): DraftPickEvent {
    const pickNo = input.pickNo ?? this.nextPickNo;
    this.nextPickNo = Math.max(this.nextPickNo, pickNo + 1);
    const event: DraftPickEvent = {
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
  async poll(): Promise<readonly DraftPickEvent[]> {
    if (this.queue.length === 0) return [];
    const drained = this.queue.slice();
    this.queue.length = 0;
    return drained;
  }

  get pending(): number {
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
export class FallbackDraftFeed implements DraftFeed {
  constructor(
    private readonly primary: DraftFeed,
    private readonly backup: DraftFeed
  ) {}

  get name(): string {
    return `fallback(${this.primary.name}+${this.backup.name})`;
  }

  get available(): boolean {
    return this.primary.available || this.backup.available;
  }

  async poll(): Promise<readonly DraftPickEvent[]> {
    const [primaryEvents, backupEvents] = await Promise.all([
      this.safePoll(this.primary),
      this.safePoll(this.backup)
    ]);
    const byPick = new Map<number, DraftPickEvent>();
    for (const event of backupEvents) byPick.set(event.pickNo, event);
    for (const event of primaryEvents) byPick.set(event.pickNo, event);
    return Array.from(byPick.values()).sort((a, b) => a.pickNo - b.pickNo);
  }

  private async safePoll(feed: DraftFeed): Promise<readonly DraftPickEvent[]> {
    if (!feed.available) return [];
    try {
      return await feed.poll();
    } catch {
      return [];
    }
  }
}
