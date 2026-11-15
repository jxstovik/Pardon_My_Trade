import { PmtError } from "../errors.js";
export class InMemoryKnowledgeRepository {
    snapshots = new Map();
    latestByLeague = new Map();
    recommendations = new Map();
    audits = new Map();
    projections = new Map();
    scopedProjections = new Map();
    constructor(options = {}) {
        for (const snapshot of options.snapshots ?? []) {
            this.snapshots.set(snapshot.snapshot_id, snapshot);
            this.latestByLeague.set(snapshot.league.league_id, snapshot.snapshot_id);
        }
        for (const recommendation of options.recommendations ?? []) {
            this.recommendations.set(recommendation.recommendation_id, recommendation);
        }
        for (const audit of options.audits ?? []) {
            this.audits.set(audit.audit_id, audit);
        }
    }
    async saveLeagueSnapshot(snapshot) {
        if (this.snapshots.has(snapshot.snapshot_id)) {
            throw new PmtError({
                code: "SNAPSHOT_ALREADY_EXISTS",
                message: `League snapshot ${snapshot.snapshot_id} already exists and is immutable.`,
                source: "knowledge",
                retryable: false
            });
        }
        if (snapshot.league.platform !== "fixture") {
            const conflict = [...this.snapshots.values()].find((existing) => existing.league.platform !== "fixture"
                && (existing.league.platform !== snapshot.league.platform || existing.league.external_id !== snapshot.league.external_id));
            if (conflict) {
                throw new PmtError({
                    code: "MULTIPLE_LIVE_LEAGUES_UNSUPPORTED",
                    message: `This store already contains live ${conflict.league.platform} league ${conflict.league.external_id}; refusing a second live league.`,
                    source: "knowledge",
                    retryable: false
                });
            }
        }
        this.snapshots.set(snapshot.snapshot_id, snapshot);
        this.latestByLeague.set(snapshot.league.league_id, snapshot.snapshot_id);
    }
    async getLatestLeagueSnapshot(leagueId) {
        const snapshotId = leagueId
            ? this.latestByLeague.get(leagueId)
            : [...this.latestByLeague.values()].reverse().find((id) => this.snapshots.get(id)?.league.platform !== "fixture")
                ?? [...this.latestByLeague.values()].at(-1);
        return snapshotId ? this.getLeagueSnapshot(snapshotId) : undefined;
    }
    async getLeagueSnapshot(snapshotId) {
        const snapshot = this.snapshots.get(snapshotId);
        if (!snapshot)
            return undefined;
        const season = snapshot.league.season;
        const stored = this.storedForSeason(season, snapshot.league.external_id);
        if (stored.length > 0) {
            const merged = [...snapshot.projections];
            for (const p of stored) {
                const key = `${p.player_id}|${p.source}|${p.scoring_period}`;
                const idx = merged.findIndex((x) => `${x.player_id}|${x.source}|${x.scoring_period}` === key);
                if (idx >= 0)
                    merged[idx] = p;
                else
                    merged.push(p);
            }
            return { ...snapshot, projections: merged };
        }
        return snapshot;
    }
    async saveRecommendation(recommendation) {
        this.recommendations.set(recommendation.recommendation_id, recommendation);
    }
    async getRecommendation(recommendationId) {
        return this.recommendations.get(recommendationId);
    }
    async saveDecisionAudit(audit) {
        this.audits.set(audit.audit_id, audit);
    }
    async getDecisionAudit(auditId) {
        return this.audits.get(auditId);
    }
    async listRecommendations(leagueId) {
        return Array.from(this.recommendations.values()).filter((recommendation) => recommendation.league_id === leagueId);
    }
    async upsertProjections(projections, leagueExternalId) {
        for (const p of projections) {
            if (leagueExternalId)
                this.scopedProjections.set(`${leagueExternalId}|${p.projection_id}`, p);
            else
                this.projections.set(p.projection_id, p);
        }
    }
    async getProjections(scoringPeriod, leagueExternalId) {
        if (leagueExternalId) {
            const scoped = [...this.scopedProjections.entries()].filter(([key, p]) => key.startsWith(`${leagueExternalId}|`) && p.scoring_period === scoringPeriod).map(([, p]) => p);
            if (scoped.length || !this.canUseLegacyProjections(leagueExternalId))
                return scoped;
            return Array.from(this.projections.values()).filter((p) => p.scoring_period === scoringPeriod);
        }
        return [...Array.from(this.projections.values()).filter((p) => p.scoring_period === scoringPeriod),
            ...Array.from(this.scopedProjections.values()).filter((p) => p.scoring_period === scoringPeriod)];
    }
    storedForSeason(season, leagueExternalId) {
        const scoped = [...this.scopedProjections.entries()].filter(([key, p]) => key.startsWith(`${leagueExternalId}|`) && p.scoring_period.startsWith(`${season}-`)).map(([, p]) => p);
        if (scoped.length || !this.canUseLegacyProjections(leagueExternalId))
            return scoped;
        return Array.from(this.projections.values()).filter((p) => p.scoring_period.startsWith(`${season}-`));
    }
    canUseLegacyProjections(leagueExternalId) {
        const live = [...this.snapshots.values()].filter((snapshot) => snapshot.league.platform !== "fixture");
        const hasFixture = [...this.snapshots.values()].some((snapshot) => snapshot.league.platform === "fixture");
        return live.length <= 1 && (!hasFixture || live.length === 0)
            && (live.length === 0 || live[0]?.league.external_id === leagueExternalId);
    }
}
