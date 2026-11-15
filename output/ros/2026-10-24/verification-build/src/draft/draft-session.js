import { EspnDraftPollFeed } from "./feed/espn-draft-poll-feed.js";
import { FallbackDraftFeed, ManualDraftFeed } from "./feed/draft-feed.js";
import { DraftPoller } from "./feed/draft-poller.js";
/**
 * Bound draft context: owns the composite feed (ESPN live primary, manual
 * backup) and the poller, and accumulates the observed board so the agent can
 * reason about what is gone. The manual feed is always available, so draft day
 * never blocks on the live endpoint being healthy.
 */
export class DraftSession {
    manual;
    feed;
    poller;
    board = [];
    constructor(options = {}) {
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
    get feedName() {
        return this.feed.name;
    }
    get isWatching() {
        return this.poller.running;
    }
    /** Record a human-entered pick via the manual backup feed. */
    recordManualPick(input) {
        return this.manual.enqueue(input);
    }
    startWatching() {
        this.poller.start();
    }
    stopWatching() {
        this.poller.stop();
    }
    /** Force a single poll (used by the `draft-watch --once` path and tests). */
    async pollOnce() {
        return this.poller.pollOnce();
    }
    getBoard() {
        return this.board.slice().sort((a, b) => a.pickNo - b.pickNo);
    }
    applyPicks(picks) {
        for (const pick of picks) {
            if (!this.board.some((p) => p.pickNo === pick.pickNo)) {
                this.board.push(pick);
            }
        }
    }
}
