import { EspnDraftPollFeed } from "./feed/espn-draft-poll-feed.js";
import { FallbackDraftFeed, ManualDraftFeed, type DraftFeed, type DraftPickEvent, type ManualPickInput } from "./feed/draft-feed.js";
import { DraftPoller } from "./feed/draft-poller.js";
import type { EspnPlatformClient } from "../adapters/espn/espn-platform-client.js";

export interface DraftSessionOptions {
  /** Poll cadence in ms for the live feed (seconds-granularity). */
  readonly intervalMs?: number;
  /** ESPN draft id; when present the live poll feed is the primary source. */
  readonly espnDraftId?: string;
  readonly client?: EspnPlatformClient;
  /** Durable JSONL path for the manual backup feed. */
  readonly manualStoragePath?: string;
  /** Called once per batch of newly observed picks (manual or live). */
  readonly onPick?: (picks: readonly DraftPickEvent[]) => void;
}

/**
 * Bound draft context: owns the composite feed (ESPN live primary, manual
 * backup) and the poller, and accumulates the observed board so the agent can
 * reason about what is gone. The manual feed is always available, so draft day
 * never blocks on the live endpoint being healthy.
 */
export class DraftSession {
  readonly manual: ManualDraftFeed;
  private readonly feed: DraftFeed;
  private readonly poller: DraftPoller;
  private readonly board: DraftPickEvent[] = [];

  constructor(options: DraftSessionOptions = {}) {
    this.manual = new ManualDraftFeed(options.manualStoragePath);
    const primary = options.espnDraftId && options.client
      ? new EspnDraftPollFeed(options.client, options.espnDraftId)
      : this.manual;
    this.feed = new FallbackDraftFeed(primary, this.manual);
    this.poller = new DraftPoller(this.feed, {
      intervalMs: options.intervalMs ?? 15_000,
      onPicks: (picks) => {
        this.applyPicks(picks);
        options.onPick?.(picks);
      }
    });
  }

  get feedName(): string {
    return this.feed.name;
  }

  get isWatching(): boolean {
    return this.poller.running;
  }

  /** Record a human-entered pick via the manual backup feed. */
  recordManualPick(input: ManualPickInput): DraftPickEvent {
    return this.manual.enqueue(input);
  }

  startWatching(): void {
    this.poller.start();
  }

  stopWatching(): void {
    this.poller.stop();
  }

  /** Force a single poll (used by the `draft-watch --once` path and tests). */
  async pollOnce(): Promise<readonly DraftPickEvent[]> {
    return this.poller.pollOnce();
  }

  getBoard(): readonly DraftPickEvent[] {
    return this.board.slice().sort((a, b) => a.pickNo - b.pickNo);
  }

  private applyPicks(picks: readonly DraftPickEvent[]): void {
    for (const pick of picks) {
      if (!this.board.some((p) => p.pickNo === pick.pickNo)) {
        this.board.push(pick);
      }
    }
  }
}
