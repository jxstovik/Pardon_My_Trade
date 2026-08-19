export interface DraftHarnessConfig {
  readonly format: "snake" | "auction";
  readonly teams: number;
  readonly myTeamId: string;
  readonly draftPosition: number;
  readonly feed: "espn" | "manual";
  readonly pollMs: number;
  readonly espnDraftId?: string;
}

export interface LLMProviderConfig {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface AppConfig {
  readonly appName: "Pardon My Trade";
  readonly environment: string;
  readonly configVersion: string;
  readonly defaultSport: "football";
  readonly fixturePath: string;
  readonly readOnlyMode: true;
  readonly draft: DraftHarnessConfig;
  readonly llm: {
    readonly providers: LLMProviderConfig[];
    readonly fallbackOrder: string[];
  };
  /** @deprecated Use llm.providers instead */
  readonly ollama: {
    readonly baseUrl: string;
    readonly model: string;
    readonly apiKey?: string;
  };
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
      espnDraftId: process.env.PMT_DRAFT_ESPN_ID,
    },
    llm: {
      providers: [
        {
          name: "opencode-zen",
          baseUrl: process.env.OPENCODE_BASE_URL ?? "https://opencode.ai",
          apiKey: process.env.OPENCODE_API_KEY,
          model: process.env.OPENCODE_ZEN_MODEL ?? "zen",
          temperature: 0.7,
          maxTokens: 1024,
        },
        {
          name: "opencode-go",
          baseUrl: process.env.OPENCODE_BASE_URL ?? "https://opencode.ai",
          apiKey: process.env.OPENCODE_API_KEY,
          model: process.env.OPENCODE_GO_MODEL ?? "go",
          temperature: 0.7,
          maxTokens: 1024,
        },
        {
          name: "openai",
          baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL ?? "gpt-4",
          temperature: 0.7,
          maxTokens: 1024,
        },
      ],
      fallbackOrder: ["opencode-zen", "opencode-go", "openai"],
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL ?? "https://ollama.cloud",
      model: process.env.OLLAMA_MODEL ?? "llama3",
      apiKey: process.env.OLLAMA_API_KEY,
    },
  };
}
