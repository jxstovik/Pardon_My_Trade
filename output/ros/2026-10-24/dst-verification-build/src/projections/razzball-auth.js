import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PmtError } from "../errors.js";
const LOGIN_URL = "https://football.razzball.com/wp-login.php";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export function defaultCookiePath(dataDir) {
    return join(dataDir, "razzball-cookies.json");
}
export async function loginRazzball(username, password, options = {}) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const body = new URLSearchParams({
        log: username,
        pwd: password,
        "wp-submit": "Log In",
        redirect_to: "https://football.razzball.com/",
        testcookie: "1"
    });
    let response;
    try {
        response = await fetchImpl(LOGIN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "pardon-my-trade/0.2 (+razzball-auth)"
            },
            body: body.toString(),
            redirect: "manual"
        });
    }
    catch (cause) {
        throw new PmtError({
            code: "RAZZBALL_LOGIN_FAILED",
            message: `Network error during Razzball login: ${cause.message}`,
            source: "projection_source",
            retryable: true
        });
    }
    const cookies = extractCookieString(response);
    if (!cookies) {
        throw new PmtError({
            code: "RAZZBALL_LOGIN_FAILED",
            message: "Razzball login did not return a session cookie (check credentials).",
            source: "projection_source",
            retryable: false
        });
    }
    const session = { cookies, fetched_at: new Date().toISOString() };
    await persistSession(session, options);
    return session;
}
export async function loadRazzballCookies(options = {}) {
    const path = options.cookiePath ?? defaultCookiePath(options.dataDir ?? "data");
    let raw;
    try {
        raw = await readFile(path, "utf8");
    }
    catch {
        return undefined;
    }
    let session;
    try {
        session = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    const fetched = Date.parse(session.fetched_at);
    if (Number.isNaN(fetched) || Date.now() - fetched > SESSION_TTL_MS) {
        return undefined;
    }
    return session.cookies;
}
export async function persistSession(session, options = {}) {
    const path = options.cookiePath ?? defaultCookiePath(options.dataDir ?? "data");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(session, null, 2), "utf8");
}
function extractCookieString(response) {
    const all = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie") ?? ""].filter(Boolean);
    return all
        .map((c) => c.split(";")[0])
        .filter((pair) => pair.includes("="))
        .join("; ");
}
