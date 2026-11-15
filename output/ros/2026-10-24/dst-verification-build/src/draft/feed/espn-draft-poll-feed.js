/**
 * Live ESPN draft feed. Polls the league draft-detail endpoint on each tick and
 * emits picks made since the previous poll.
 *
 * NOTE: this endpoint and its response shape are **unverified** (doc 23 Phase 4
 * spike). The implementation attempts the documented request and degrades
 * safely: any error marks the feed unavailable and the {@link FallbackDraftFeed}
 * falls back to the manual feed. Parsing maps the best-known field paths but
 * tolerates missing/unknown shapes by returning no events rather than emitting
 * malformed picks. It must be confirmed against a real draft response before
 * being relied on.
 */
export class EspnDraftPollFeed {
    client;
    draftId;
    name = "espn";
    healthy = true;
    lastPickNo = 0;
    constructor(client, draftId) {
        this.client = client;
        this.draftId = draftId;
    }
    get available() {
        return this.healthy;
    }
    async poll() {
        try {
            const data = await this.client.getJson(`/draft/${this.draftId}`, { view: ["draftDetail"] });
            const picks = this.extractPicks(data);
            this.healthy = true;
            const fresh = picks.filter((p) => p.pickNo > this.lastPickNo);
            if (fresh.length > 0) {
                this.lastPickNo = Math.max(...fresh.map((p) => p.pickNo));
            }
            return fresh;
        }
        catch {
            this.healthy = false;
            return [];
        }
    }
    /**
     * Best-effort parse of the ESPN draft-detail shape. Returns [] on any
     * unexpected structure so the feed never emits garbage. The exact keys under
     * `draftDetail.picks[]` are pending the Phase 4 verification spike.
     */
    extractPicks(data) {
        const detailObj = data?.draftDetail;
        const picks = detailObj?.picks;
        if (!Array.isArray(picks))
            return [];
        const events = [];
        for (const raw of picks) {
            const p = raw;
            const pickNo = Number(p.pickNo ?? p.overallPickNumber);
            const player = p.player;
            const playerId = player ? String(player.id ?? player.playerId) : undefined;
            if (!Number.isFinite(pickNo) || !playerId)
                continue;
            events.push({
                pickNo,
                round: Number(p.round ?? 1),
                roundPick: Number(p.roundPick ?? pickNo),
                teamId: String(p.teamId ?? p.team?.id ?? "unknown"),
                playerExternalId: playerId,
                source: "espn",
                timestamp: Number(p.date ?? Date.now())
            });
        }
        return events;
    }
}
