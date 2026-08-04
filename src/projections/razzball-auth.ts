import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PmtError } from "../errors.js";

/**
 * Razzball premium (Pigskinonator / DFS) pages require a logged-in session
 * cookie. This module performs the WordPress login once and persists the cookie
 * string so subsequent fetches can attach it. Falls back silently to the free
 * tier when credentials are absent.
 */

export interface RazzballSession {
  readonly cookies: string;
  readonly fetched_at: string;
}

export interface RazzballAuthOptions {
  readonly fetchImpl?: typeof fetch;
  readonly dataDir?: string;
  readonly cookiePath?: string;
}

const LOGIN_URL = "https://football.razzball.com/wp-login.php";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function defaultCookiePath(dataDir: string): string {
  return join(dataDir, "razzball-cookies.json");
}

export async function loginRazzball(
  username: string,
  password: string,
  options: RazzballAuthOptions = {}
): Promise<RazzballSession> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({
    log: username,
    pwd: password,
    "wp-submit": "Log In",
    redirect_to: "https://football.razzball.com/",
    testcookie: "1"
  });

  let response: Response;
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
  } catch (cause) {
    throw new PmtError({
      code: "RAZZBALL_LOGIN_FAILED",
      message: `Network error during Razzball login: ${(cause as Error).message}`,
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

  const session: RazzballSession = { cookies, fetched_at: new Date().toISOString() };
  await persistSession(session, options);
  return session;
}

export async function loadRazzballCookies(options: RazzballAuthOptions = {}): Promise<string | undefined> {
  const path = options.cookiePath ?? defaultCookiePath(options.dataDir ?? "data");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  let session: RazzballSession;
  try {
    session = JSON.parse(raw) as RazzballSession;
  } catch {
    return undefined;
  }
  const fetched = Date.parse(session.fetched_at);
  if (Number.isNaN(fetched) || Date.now() - fetched > SESSION_TTL_MS) {
    return undefined;
  }
  return session.cookies;
}

export async function persistSession(session: RazzballSession, options: RazzballAuthOptions = {}): Promise<void> {
  const path = options.cookiePath ?? defaultCookiePath(options.dataDir ?? "data");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(session, null, 2), "utf8");
}

function extractCookieString(response: Response): string {
  const all = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""].filter(Boolean);
  return all
    .map((c) => c.split(";")[0])
    .filter((pair) => pair.includes("="))
    .join("; ");
}
