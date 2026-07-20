import { PmtError } from "../../errors.js";
import type { EspnCredentials } from "./espn-auth.js";

export interface EspnClientOptions {
  readonly credentials: EspnCredentials;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

export interface EspnRequestRecord {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

const DEFAULT_BASE_URL = "https://fantasy.espn.com/apis/v3/games/ffl/seasons";

export class EspnPlatformClient {
  readonly credentials: EspnCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly recorded: EspnRequestRecord[] = [];

  constructor(options: EspnClientOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  get recordedRequests(): readonly EspnRequestRecord[] {
    return this.recorded;
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const { espnS2, swid } = this.credentials;
    if (espnS2 && swid) {
      headers.cookie = `espn_s2=${espnS2}; SWID=${swid}`;
    }
    return headers;
  }

  private leagueBase(): string {
    return `${this.baseUrl}/${this.credentials.season}/segments/1/leagues/${this.credentials.leagueId}`;
  }

  async getJson<T>(path: string, view?: string[]): Promise<T> {
    const url = new URL(this.leagueBase() + path);
    if (view && view.length > 0) {
      for (const v of view) url.searchParams.append("view", v);
    }
    const headers = this.buildHeaders({ accept: "application/json" });
    this.recorded.push({ method: "GET", url: url.toString(), headers });
    const response = await this.fetchImpl(url.toString(), { method: "GET", headers });
    return this.parse<T>(response);
  }

  async postJson<T>(path: string, body: unknown, filter?: unknown): Promise<T> {
    const url = new URL(this.leagueBase() + path);
    const headers = this.buildHeaders({ "content-type": "application/json" });
    if (filter !== undefined) {
      headers["X-Fantasy-Filter"] = JSON.stringify(filter);
    }
    this.recorded.push({ method: "POST", url: url.toString(), headers, body });
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    return this.parse<T>(response);
  }

  private async parse<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new PmtError({
        code: "ESPN_REQUEST_FAILED",
        message: `ESPN request failed with status ${response.status}: ${text.slice(0, 200)}`,
        source: "platform_adapter",
        retryable: response.status >= 500
      });
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PmtError({
        code: "ESPN_UNEXPECTED_RESPONSE",
        message: "ESPN response was not valid JSON.",
        source: "platform_adapter",
        retryable: false
      });
    }
  }
}
