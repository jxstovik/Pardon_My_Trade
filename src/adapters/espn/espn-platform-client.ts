import { PmtError } from "../../errors.js";
import type { EspnCredentials } from "./espn-auth.js";

export interface EspnClientOptions {
  readonly credentials: EspnCredentials;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  /** Host used for read-only views (ESPN's `lm-api-reads` mirror). */
  readonly readBaseUrl?: string;
  readonly writeBaseUrl?: string;
  /** Per-attempt timeout for safe GET requests. */
  readonly timeoutMs?: number;
  /** Number of retries after the first safe GET attempt. */
  readonly readRetries?: number;
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
  readonly writeHost?: boolean;
}

export interface EspnGetOptions {
  readonly view?: string[];
  /** Private views must not silently degrade to public league responses. */
  readonly requireAuthenticatedRole?: boolean;
  /**
   * Serialized into the `X-Fantasy-Filter` header. ESPN uses this on GET for
   * filtering and pagination, e.g. `{ players: { limit: 50, offset: 0 } }`.
   */
  readonly filter?: unknown;
  readonly query?: Record<string, string | number>;
  readonly scope?: EspnRequestScope;
}

const DEFAULT_BASE_URL = "https://fantasy.espn.com/apis/v3/games/ffl/seasons";
const DEFAULT_WRITE_BASE_URL = "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons";
const DEFAULT_READ_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

export class EspnPlatformClient {
  readonly credentials: EspnCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly readBaseUrl: string;
  private readonly writeBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly readRetries: number;
  private readonly recorded: EspnRequestRecord[] = [];

  constructor(options: EspnClientOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    // When a caller pins `baseUrl` (tests, fixtures) honour it for reads too.
    this.writeBaseUrl = options.writeBaseUrl ?? options.baseUrl ?? DEFAULT_WRITE_BASE_URL;
    this.readBaseUrl = options.readBaseUrl ?? options.baseUrl ?? DEFAULT_READ_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.readRetries = options.readRetries ?? 2;
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
    const host = scope?.writeHost ? this.writeBaseUrl : scope?.readHost ? this.readBaseUrl : this.baseUrl;
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
    this.recorded.push({ method: "GET", url: url.toString(), headers: redactHeaders(fullHeaders) });
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.readRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url.toString(), {
          method: "GET", headers: fullHeaders, signal: controller.signal
        });
        if (isRetryableStatus(response.status) && attempt < this.readRetries) {
          await response.body?.cancel().catch(() => undefined);
          await delay(retryDelay(response, attempt));
          continue;
        }
        if (opts.requireAuthenticatedRole && response.ok) {
          const role = response.headers.get("x-fantasy-role");
          if (!role || role.toUpperCase() === "NONE") throw new PmtError({ code: "ESPN_AUTH_REQUIRED", source: "platform_adapter", message: "ESPN session is unauthenticated; refresh ESPN_S2 and SWID locally before reading private pending claims or submitting moves." });
        }
        return await this.parse<T>(response);
      } catch (error) {
        lastError = error;
        if (error instanceof PmtError) throw error;
        if (attempt >= this.readRetries || !isRetryableReadError(error)) throw safeReadError(error);
        await delay(100 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw safeReadError(lastError);
  }

  async postJson<T>(path: string, body: unknown, filter?: unknown, scope?: EspnRequestScope): Promise<T> {
    const url = new URL(this.resolveBase(scope) + path);
    const headers = this.buildHeaders({ "content-type": "application/json" });
    if (filter !== undefined) {
      headers["X-Fantasy-Filter"] = JSON.stringify(filter);
    }
    this.recorded.push({ method: "POST", url: url.toString(), headers: redactHeaders(headers), body });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      return await this.parse<T>(response);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new PmtError({
          code: "ESPN_WRITE_OUTCOME_UNKNOWN",
          message: "ESPN write timed out; acceptance is unknown and must be reconciled before retrying.",
          source: "platform_adapter",
          retryable: false
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new PmtError({
        code: "ESPN_REQUEST_FAILED",
        message: `ESPN request failed (${classifyStatus(response.status)}; HTTP ${response.status}).`,
        source: "platform_adapter",
        retryable: response.status === 429 || response.status >= 500
      });
    }
    if (!text) return undefined as T;
    if (/^\s*</.test(text) || /text\/html/i.test(response.headers?.get("content-type") ?? "")) {
      throw new PmtError({
        code: "ESPN_NON_JSON_RESPONSE",
        message: "ESPN returned HTML instead of JSON (check credentials, endpoint, or rate limiting).",
        source: "platform_adapter",
        retryable: false
      });
    }
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

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) =>
    key.toLowerCase() === "cookie" ? [key, "[REDACTED]"] : [key, value]
  ));
}

function classifyStatus(status: number): string {
  if (status === 401 || status === 403) return "authentication or private-league access denied";
  if (status === 404) return "resource not found";
  if (status === 429) return "rate limited";
  if (status >= 500) return "ESPN server error";
  return "request rejected";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 2_000) : 100 * 2 ** attempt;
}

function isRetryableReadError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
}

function safeReadError(error: unknown): PmtError {
  return new PmtError({
    code: "ESPN_READ_UNAVAILABLE",
    message: error instanceof Error && error.name === "AbortError"
      ? "ESPN read timed out after bounded retries."
      : "ESPN read failed after bounded retries.",
    source: "platform_adapter",
    retryable: true
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
