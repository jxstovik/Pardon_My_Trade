import { PmtError } from "../../errors.js";
const DEFAULT_BASE_URL = "https://fantasy.espn.com/apis/v3/games/ffl/seasons";
const DEFAULT_WRITE_BASE_URL = "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons";
const DEFAULT_READ_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";
export class EspnPlatformClient {
    credentials;
    fetchImpl;
    baseUrl;
    readBaseUrl;
    writeBaseUrl;
    timeoutMs;
    readRetries;
    recorded = [];
    constructor(options) {
        this.credentials = options.credentials;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
        // When a caller pins `baseUrl` (tests, fixtures) honour it for reads too.
        this.writeBaseUrl = options.writeBaseUrl ?? options.baseUrl ?? DEFAULT_WRITE_BASE_URL;
        this.readBaseUrl = options.readBaseUrl ?? options.baseUrl ?? DEFAULT_READ_BASE_URL;
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.readRetries = options.readRetries ?? 2;
    }
    get recordedRequests() {
        return this.recorded;
    }
    buildHeaders(extra = {}) {
        const headers = { ...extra };
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
    resolveBase(scope) {
        const season = scope?.season ?? this.credentials.season;
        const host = scope?.writeHost ? this.writeBaseUrl : scope?.readHost ? this.readBaseUrl : this.baseUrl;
        if (scope?.leagueDefaults !== undefined) {
            return `${host}/${season}/segments/${scope.segment ?? 0}/leaguedefaults/${scope.leagueDefaults}`;
        }
        const segment = scope?.segment ?? 1;
        const leagueId = scope?.leagueId ?? this.credentials.leagueId;
        return `${host}/${season}/segments/${segment}/leagues/${leagueId}`;
    }
    async getJson(path, options) {
        const opts = Array.isArray(options) ? { view: options } : (options ?? {});
        const url = new URL(this.resolveBase(opts.scope) + path);
        if (opts.view && opts.view.length > 0) {
            for (const v of opts.view)
                url.searchParams.append("view", v);
        }
        if (opts.query) {
            for (const [k, v] of Object.entries(opts.query)) {
                url.searchParams.set(k, String(v));
            }
        }
        const headers = { accept: "application/json" };
        if (opts.filter !== undefined) {
            headers["X-Fantasy-Filter"] = JSON.stringify(opts.filter);
        }
        const fullHeaders = this.buildHeaders(headers);
        this.recorded.push({ method: "GET", url: url.toString(), headers: redactHeaders(fullHeaders) });
        let lastError;
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
                return await this.parse(response);
            }
            catch (error) {
                lastError = error;
                if (error instanceof PmtError)
                    throw error;
                if (attempt >= this.readRetries || !isRetryableReadError(error))
                    throw safeReadError(error);
                await delay(100 * 2 ** attempt);
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw safeReadError(lastError);
    }
    async postJson(path, body, filter, scope) {
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
            return await this.parse(response);
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new PmtError({
                    code: "ESPN_WRITE_OUTCOME_UNKNOWN",
                    message: "ESPN write timed out; acceptance is unknown and must be reconciled before retrying.",
                    source: "platform_adapter",
                    retryable: false
                });
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async parse(response) {
        const text = await response.text();
        if (!response.ok) {
            throw new PmtError({
                code: "ESPN_REQUEST_FAILED",
                message: `ESPN request failed (${classifyStatus(response.status)}; HTTP ${response.status}).`,
                source: "platform_adapter",
                retryable: response.status === 429 || response.status >= 500
            });
        }
        if (!text)
            return undefined;
        if (/^\s*</.test(text) || /text\/html/i.test(response.headers?.get("content-type") ?? "")) {
            throw new PmtError({
                code: "ESPN_NON_JSON_RESPONSE",
                message: "ESPN returned HTML instead of JSON (check credentials, endpoint, or rate limiting).",
                source: "platform_adapter",
                retryable: false
            });
        }
        try {
            return JSON.parse(text);
        }
        catch {
            throw new PmtError({
                code: "ESPN_UNEXPECTED_RESPONSE",
                message: "ESPN response was not valid JSON.",
                source: "platform_adapter",
                retryable: false
            });
        }
    }
}
function redactHeaders(headers) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => key.toLowerCase() === "cookie" ? [key, "[REDACTED]"] : [key, value]));
}
function classifyStatus(status) {
    if (status === 401 || status === 403)
        return "authentication or private-league access denied";
    if (status === 404)
        return "resource not found";
    if (status === 429)
        return "rate limited";
    if (status >= 500)
        return "ESPN server error";
    return "request rejected";
}
function isRetryableStatus(status) {
    return status === 429 || status >= 500;
}
function retryDelay(response, attempt) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 2_000) : 100 * 2 ** attempt;
}
function isRetryableReadError(error) {
    return error instanceof TypeError || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
}
function safeReadError(error) {
    return new PmtError({
        code: "ESPN_READ_UNAVAILABLE",
        message: error instanceof Error && error.name === "AbortError"
            ? "ESPN read timed out after bounded retries."
            : "ESPN read failed after bounded retries.",
        source: "platform_adapter",
        retryable: true
    });
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
