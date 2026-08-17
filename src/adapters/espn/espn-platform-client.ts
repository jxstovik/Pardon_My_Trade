import { PmtError } from "../../errors.js";
import type { EspnCredentials } from "./espn-auth.js";

export interface EspnClientOptions {
  readonly credentials: EspnCredentials;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  /** Host used for read-only views (ESPN's `lm-api-reads` mirror). */
  readonly readBaseUrl?: string;
}

export interface EspnRequestRecord {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

/**
 * Which ESPN resource a request targets. Defaults reproduce the original
 * league-scoped behaviour (`segments/1/leagues/{leagueId}` on the write host),
 * so existing callers are unaffected.
 */
export interface EspnRequestScope {
  readonly season?: string;
  /** ESPN segment; 1 for league play, 0 for the global/default player universe. */
  readonly segment?: number;
  readonly leagueId?: string;
  /**
   * Target `segments/{segment}/leaguedefaults/{id}` instead of a league — the
   * league-agnostic player universe used by the `kona_player_info` draft board.
   */
  readonly leagueDefaults?: number;
  /** Use the read host (`lm-api-reads`) instead of the default host. */
  readonly readHost?: boolean;
}

export interface EspnGetOptions {
  readonly view?: string[];
  /**
   * Serialized into the `X-Fantasy-Filter` header. ESPN uses this on GET for
   * filtering and pagination, e.g. `{ players: { limit: 50, offset: 0 } }`.
   */
  readonly filter?: unknown;
  readonly query?: Record<string, string | number>;
  readonly scope?: EspnRequestScope;
}

const DEFAULT_BASE_URL = "https://fantasy.espn.com/apis/v3/games/ffl/seasons";
const DEFAULT_READ_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

export class EspnPlatformClient {
  readonly credentials: EspnCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly readBaseUrl: string;
  private readonly recorded: EspnRequestRecord[] = [];

  constructor(options: EspnClientOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    // When a caller pins `baseUrl` (tests, fixtures) honour it for reads too.
    this.readBaseUrl = options.readBaseUrl ?? options.baseUrl ?? DEFAULT_READ_BASE_URL;
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

  /**
   * Resolve the host + season-segment base URL for a request scope. Returns the
   * bare `…/{season}/{segment-or-leaguedefaults}/…` base without any league
   * id appended, so callers can add either a league or a leaguedefaults path.
   */
  private resolveBase(scope?: EspnRequestScope): string {
    const season = scope?.season ?? this.credentials.season;
    const host = scope?.readHost ? this.readBaseUrl : this.baseUrl;
    if (scope?.leagueDefaults !== undefined) {
      return `${host}/${season}/segments/${scope.segment ?? 0}/leaguedefaults/${scope.leagueDefaults}`;
    }
    const segment = scope?.segment ?? 1;
    const leagueId = scope?.leagueId ?? this.credentials.leagueId;
    return `${host}/${season}/segments/${segment}/leagues/${leagueId}`;
  }

  async getJson<T>(path: string, options?: string[] | EspnGetOptions): Promise<T> {
    const opts: EspnGetOptions =
      Array.isArray(options) ? { view: options } : (options ?? {});
    const url = new URL(this.resolveBase(opts.scope) + path);
    if (opts.view && opts.view.length > 0) {
      for (const v of opts.view) url.searchParams.append("view", v);
    }
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.filter !== undefined) {
      headers["X-Fantasy-Filter"] = JSON.stringify(opts.filter);
    }
    const fullHeaders = this.buildHeaders(headers);
    this.recorded.push({ method: "GET", url: url.toString(), headers: fullHeaders });
    const response = await this.fetchImpl(url.toString(), { method: "GET", headers: fullHeaders });
    return this.parse<T>(response);
  }

  async postJson<T>(path: string, body: unknown, filter?: unknown, idempotencyKey?: string): Promise<T> {
    const url = new URL(this.resolveBase() + path);
    const headers = this.buildHeaders({ "content-type": "application/json" });
    if (filter !== undefined) {
      headers["X-Fantasy-Filter"] = JSON.stringify(filter);
    }
    if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
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
