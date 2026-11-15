/**
 * Seconds-granularity draft poller. Distinct from {@link InMemoryScheduler},
 * which is daily `HH:MM` and unsuitable for a 60–90s pick clock. This runs a
 * tight loop over a {@link DraftFeed} and dispatches every new pick to a
 * handler, with automatic stop on sustained failure.
 */
export class DraftPoller {
    feed;
    options;
    timer;
    errorCount = 0;
    maxErrors;
    now;
    timers;
    constructor(feed, options) {
        this.feed = feed;
        this.options = options;
        this.maxErrors = options.maxErrors ?? 5;
        this.now = options.now ?? Date.now;
        this.timers = options.timers ?? { setInterval, clearInterval };
    }
    get running() {
        return this.timer !== undefined;
    }
    start() {
        if (this.timer)
            return;
        // Fire an immediate poll so we never wait a full interval for the first tick.
        void this.pollOnce();
        this.timer = this.timers.setInterval(() => {
            void this.pollOnce();
        }, Math.max(1, this.options.intervalMs));
        const handle = this.timer;
        if (typeof handle.unref === "function")
            handle.unref();
    }
    stop() {
        if (this.timer) {
            this.timers.clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    /**
     * One poll cycle: pull from the feed and dispatch. Exposed for tests that
     * want to drive ticks deterministically without real timers.
     */
    async pollOnce() {
        try {
            const picks = await this.feed.poll();
            this.errorCount = 0;
            if (picks.length > 0)
                await this.options.onPicks?.(picks);
            return picks;
        }
        catch (error) {
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
