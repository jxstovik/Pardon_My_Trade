import type { LeagueSnapshot, PlayerPosition } from "../models/types.js";
import { DraftSession, type DraftSessionOptions } from "./draft-session.js";
import {
  applyPick,
  createDraftState,
  DraftConfig,
  DraftNeed,
  DraftState,
  DraftStateStore,
  JsonDraftStateStore,
  nextOverallPick,
  picksUntilMyNext,
  resolveDraftStateStorePath,
  rosterNeeds
} from "./state.js";
import { applySurvival, buildValuationModels, rankBestAvailable, type ValuationModel } from "./valuation/valuation.js";
import { buildDraftChatContext, buildPickAdvice } from "./skills/pick-advisor.js";
import { ollamaChat, type OllamaMessage } from "../llm/ollama.js";
import type { EspnPlatformClient } from "../adapters/espn/espn-platform-client.js";
import type { DraftPickEvent, ManualPickInput } from "./feed/draft-feed.js";

export interface DraftRosterView {
  readonly teamId: string;
  readonly starters: ReadonlyArray<{ readonly slot_type: PlayerPosition; readonly player_id?: string; readonly full_name?: string }>;
  readonly bench: ReadonlyArray<{ readonly slot_type: PlayerPosition; readonly player_id?: string; readonly full_name?: string }>;
  readonly needs: ReadonlyArray<DraftNeed>;
}

export interface DraftSnapshotDto {
  readonly board: ReadonlyArray<DraftPickEvent>;
  readonly myRoster: DraftRosterView;
  readonly needs: ReadonlyArray<DraftNeed>;
  readonly bestAvailable: ReadonlyArray<ValuationModel>;
  readonly nextPick: number;
  readonly picksUntilMyNext: number;
  readonly mySeat: number;
}

export interface DraftControllerDeps {
  readonly snapshot: LeagueSnapshot;
  readonly config: DraftConfig;
  readonly dataDir?: string;
  readonly espnDraftId?: string;
  readonly client?: EspnPlatformClient;
  readonly intervalMs?: number;
  readonly onSnapshot?: (snapshot: DraftSnapshotDto) => void;
}

export class DraftController {
  private state: DraftState;
  private readonly valuation: Map<string, ValuationModel>;
  private readonly session: DraftSession;
  private readonly playersById: Map<string, { full_name: string }>;

  constructor(private readonly deps: DraftControllerDeps) {
    this.state = createDraftState(deps.config);
    this.valuation = buildValuationModels(deps.snapshot, { useProjections: true });
    this.playersById = new Map(
      [...deps.snapshot.players, ...deps.snapshot.free_agents].map((p) => [p.player_id, p])
    );

    const sessionOptions: DraftSessionOptions = {
      intervalMs: deps.intervalMs,
      espnDraftId: deps.espnDraftId,
      client: deps.client,
      manualStoragePath: resolveDraftStateStorePath(deps.dataDir),
      onPick: (picks) => {
        for (const pick of picks) this.recordPick(pick);
      }
    };
    this.session = new DraftSession(sessionOptions);
  }

  async init(): Promise<void> {
    const store = this.store();
    const restored = await store.load();
    if (restored) this.state = restored;
  }

  private store(): DraftStateStore {
    return new JsonDraftStateStore(resolveDraftStateStorePath(this.deps.dataDir));
  }

  startWatching(): void {
    this.session.startWatching();
  }

  stopWatching(): void {
    this.session.stopWatching();
  }

  recordManualPick(input: ManualPickInput): DraftSnapshotDto {
    const pick = this.session.recordManualPick(input);
    return this.recordPick(pick);
  }

  recordPick(pick: DraftPickEvent): DraftSnapshotDto {
    this.state = applyPick(this.state, pick);
    void this.store().save(this.state);
    const snapshot = this.currentSnapshot();
    this.deps.onSnapshot?.(snapshot);
    return snapshot;
  }

  currentSnapshot(): DraftSnapshotDto {
    const limit = 15;
    const ranked = rankBestAvailable(this.valuation.values(), this.state.draftedPlayerIds, limit);
    const untilNext = picksUntilMyNext(this.state);
    const bestAvailable = applySurvival(ranked, untilNext);
    const needs = rosterNeeds(this.state, this.deps.snapshot);
    const team = this.deps.snapshot.league.teams.find((t) => t.team_id === this.state.config.myTeamId);
    const nameOf = (id?: string) => (id ? this.playersById.get(id)?.full_name : undefined);

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

  async chat(messages: readonly OllamaMessage[]): Promise<string> {
    const snapshot = this.currentSnapshot();
    const context = buildDraftChatContext(this.deps.snapshot, this.state, snapshot.bestAvailable, snapshot.needs);
    const system: OllamaMessage = {
      role: "system",
      content: `You are an advisory fantasy-football draft assistant. You ONLY discuss strategy using the provided draft context. You never invent player stats. Context:\n${context}`
    };
    return ollamaChat([system, ...messages]);
  }

  advice() {
    return buildPickAdvice(this.state, this.deps.snapshot, this.valuation, { limit: 10 });
  }
}
