/** Only documented read operations. No authentication/session extraction or write methods. */
export const READ_ENDPOINTS = ["getLeagueInfo", "getTeamRosters", "getStandings", "getDraftResults", "getMatchupScores"] as const;
export type ReadEndpoint = typeof READ_ENDPOINTS[number];
export class FantraxReadError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean, readonly endpoint: string) {super(message); this.name = "FantraxReadError";}
}
export async function readFantrax(endpoint: ReadEndpoint, leagueId: string, options: {period?: number; fetcher?: typeof fetch} = {}): Promise<unknown> {
  if (!(READ_ENDPOINTS as readonly string[]).includes(endpoint) || !/^[a-zA-Z0-9_-]+$/.test(leagueId)) throw new FantraxReadError("INVALID_SCOPE", "Unsupported Fantrax read operation or league ID", false, endpoint);
  if (options.period !== undefined && (!Number.isSafeInteger(options.period) || options.period < 1)) throw new FantraxReadError("INVALID_PERIOD", "An explicit positive period is required", false, endpoint);
  if ((endpoint === "getTeamRosters" || endpoint === "getMatchupScores") && options.period === undefined) throw new FantraxReadError("INVALID_PERIOD", "An explicit positive period is required; rollover defaults are unsupported", false, endpoint);
  const url = new URL(`https://www.fantrax.com/fxea/general/${endpoint}`);
  url.searchParams.set("leagueId", leagueId);
  if (endpoint === "getLeagueInfo") url.searchParams.set("excludePlayerInfo", "true");
  if (options.period !== undefined) url.searchParams.set("period", String(options.period));
  let response: Response;
  try {response = await (options.fetcher ?? fetch)(url, {method: "GET", signal: AbortSignal.timeout(20_000), redirect: "error"});}
  catch {throw new FantraxReadError("TRANSPORT_UNAVAILABLE", "Fantrax read did not complete; previous captures remain unchanged", true, endpoint);}
  if (!response.ok) throw new FantraxReadError(`HTTP_${response.status}`, `Fantrax ${endpoint} returned HTTP ${response.status}; use permitted browser capture when HTTP access is unavailable`, response.status === 429 || response.status >= 500, endpoint);
  try {return await response.json();} catch {throw new FantraxReadError("INVALID_JSON", "Fantrax read was not JSON; no snapshot was imported", false, endpoint);}
}
