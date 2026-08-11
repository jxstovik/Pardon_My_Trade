export interface DraftHarnessConfig {
  readonly format: "snake" | "auction";
  readonly teams: number;
  readonly myTeamId: string;
  readonly draftPosition: number;
  readonly feed: "espn" | "manual";
  readonly pollMs: number;
  readonly espnDraftId?: string;
}

export interface OllamaConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
}

export interface AppConfig {
  readonly appName: "Pardon My Trade";
  readonly environment: string;
  readonly configVersion: string;
  readonly defaultSport: "football";
  readonly fixturePath: string;
  readonly readOnlyMode: true;
  readonly draft: DraftHarnessConfig;
  readonly ollama: OllamaConfig;
}

export function createDefaultConfig(): AppConfig {
  return {
    appName: "Pardon My Trade",
    environment: process.env.PMT_ENV ?? "local",
    configVersion: "0.1.0-fixture",
    defaultSport: "football",
    fixturePath: process.env.PMT_FIXTURE_PATH ?? "tests/fixtures/sample-football-league.json",
    readOnlyMode: true,
    draft: {
      format: (process.env.PMT_DRAFT_FORMAT as "snake" | "auction") ?? "snake",
      teams: Number(process.env.PMT_DRAFT_TEAMS ?? 12),
      myTeamId: process.env.PMT_DRAFT_TEAM_ID ?? "team-001",
      draftPosition: Number(process.env.PMT_DRAFT_POSITION ?? 1),
      feed: (process.env.PMT_DRAFT_FEED as "espn" | "manual") ?? "manual",
      pollMs: Number(process.env.PMT_DRAFT_POLL_MS ?? 15000),
      espnDraftId: process.env.PMT_DRAFT_ESPN_ID
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL ?? "https://ollama.cloud",
      model: process.env.OLLAMA_MODEL ?? "llama3",
      apiKey: process.env.OLLAMA_API_KEY
    }
  };
}
