import { DraftSession } from "./draft-session.js";
import { applyPick, createDraftState, JsonDraftStateStore, nextOverallPick, picksUntilMyNext, resolveDraftStateStorePath, rosterNeeds } from "./state.js";
import { applySurvival, buildValuationModels, rankBestAvailable } from "./valuation/valuation.js";
import { buildDraftChatContext, buildPickAdvice } from "./skills/pick-advisor.js";
import { ollamaChat } from "../llm/ollama.js";
export class DraftController {
    deps;
    state;
    valuation;
    session;
    playersById;
    constructor(deps) {
        this.deps = deps;
        this.state = createDraftState(deps.config);
        this.valuation = buildValuationModels(deps.snapshot, { useProjections: true });
        this.playersById = new Map([...deps.snapshot.players, ...deps.snapshot.free_agents].map((p) => [p.player_id, p]));
        const sessionOptions = {
            intervalMs: deps.intervalMs,
            espnDraftId: deps.espnDraftId,
            client: deps.client,
            manualStoragePath: resolveDraftStateStorePath(deps.dataDir),
            onPick: (picks) => {
                for (const pick of picks)
                    this.recordPick(pick);
            }
        };
        this.session = new DraftSession(sessionOptions);
    }
    async init() {
        const store = this.store();
        const restored = await store.load();
        if (restored)
            this.state = restored;
    }
    store() {
        return new JsonDraftStateStore(resolveDraftStateStorePath(this.deps.dataDir));
    }
    startWatching() {
        this.session.startWatching();
    }
    stopWatching() {
        this.session.stopWatching();
    }
    recordManualPick(input) {
        const pick = this.session.recordManualPick(input);
        return this.recordPick(pick);
    }
    recordPick(pick) {
        this.state = applyPick(this.state, pick);
        void this.store().save(this.state);
        const snapshot = this.currentSnapshot();
        this.deps.onSnapshot?.(snapshot);
        return snapshot;
    }
    currentSnapshot() {
        const limit = 15;
        const ranked = rankBestAvailable(this.valuation.values(), this.state.draftedPlayerIds, limit);
        const untilNext = picksUntilMyNext(this.state);
        const bestAvailable = applySurvival(ranked, untilNext);
        const needs = rosterNeeds(this.state, this.deps.snapshot);
        const team = this.deps.snapshot.league.teams.find((t) => t.team_id === this.state.config.myTeamId);
        const nameOf = (id) => (id ? this.playersById.get(id)?.full_name : undefined);
        return {
            board: this.state.board,
            myRoster: {
                teamId: this.state.config.myTeamId,
                starters: (team?.roster.starters ?? []).map((slot) => ({
                    slot_type: slot.slot_type,
                    player_id: slot.player_id,
                    full_name: nameOf(slot.player_id)
                })),
                bench: (team?.roster.bench ?? []).map((slot) => ({
                    slot_type: slot.slot_type,
                    player_id: slot.player_id,
                    full_name: nameOf(slot.player_id)
                })),
                needs
            },
            needs,
            bestAvailable,
            nextPick: nextOverallPick(this.state),
            picksUntilMyNext: untilNext,
            mySeat: this.state.config.draftPosition
        };
    }
    async chat(messages) {
        const snapshot = this.currentSnapshot();
        const context = buildDraftChatContext(this.deps.snapshot, this.state, snapshot.bestAvailable, snapshot.needs);
        const system = {
            role: "system",
            content: `You are an advisory fantasy-football draft assistant. You ONLY discuss strategy using the provided draft context. You never invent player stats. Context:\n${context}`
        };
        return ollamaChat([system, ...messages]);
    }
    advice() {
        return buildPickAdvice(this.state, this.deps.snapshot, this.valuation, { limit: 10 });
    }
}
