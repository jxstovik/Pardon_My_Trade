import type { DraftFeed, DraftPickEvent } from "./draft-feed.js";

type TimerHandle = ReturnType<typeof setInterval>;

export interface DraftPollerOptions {
  /** Poll cadence in milliseconds (seconds-granularity, e.g. 15_000). */
  readonly intervalMs: number;
  /** Called with each batch of new picks (possibly empty between ticks). */
  readonly onPicks?: (picks: readonly DraftPickEvent[]) => Promise<void> | void;
  /** Consecutive errors tolerated before the poller stops itself. */
  readonly maxErrors?: number;
  /** Injectable clock for tests. */
  readonly now?: () => number;
  /** Injectable timers so tests can drive ticks deterministically. */
  readonly timers?: {
    setInterval: (fn: () => void, ms: number) => TimerHandle;
    clearInterval: (handle: TimerHandle) => void;
  };
}

/**
 * Seconds-granularity draft poller. Distinct from {@link InMemoryScheduler},
 * which is daily `HH:MM` and unsuitable for a 60–90s pick clock. This runs a
 * tight loop over a {@link DraftFeed} and dispatches every new pick to a
 * handler, with automatic stop on sustained failure.
 */
export class DraftPoller {
  private timer?: TimerHandle;
  private errorCount = 0;
  private readonly maxErrors: number;
  private readonly now: () => number;
  private readonly timers: NonNullable<DraftPollerOptions["timers"]>;

  constructor(private readonly feed: DraftFeed, private readonly options: DraftPollerOptions) {
    this.maxErrors = options.maxErrors ?? 5;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? { setInterval, clearInterval };
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (this.timer) return;
    // Fire an immediate poll so we never wait a full interval for the first tick.
    void this.pollOnce();
    this.timer = this.timers.setInterval(() => {
      void this.pollOnce();
    }, Math.max(1, this.options.intervalMs));
    const handle = this.timer as unknown as { unref?: () => void };
    if (typeof handle.unref === "function") handle.unref();
  }

  stop(): void {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One poll cycle: pull from the feed and dispatch. Exposed for tests that
   * want to drive ticks deterministically without real timers.
   */
  async pollOnce(): Promise<readonly DraftPickEvent[]> {
    try {
      const picks = await this.feed.poll();
      this.errorCount = 0;
      if (picks.length > 0) await this.options.onPicks?.(picks);
      return picks;
    } catch (error) {
      this.errorCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`DraftPoller tick failed (${this.errorCount}/${this.maxErrors}): ${message}`);
      if (this.errorCount >= this.maxErrors) {
        this.stop();
      }
      return [];
    }
  }
}
