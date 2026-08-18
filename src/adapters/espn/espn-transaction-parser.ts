import type { Transaction } from "../../models/types.js";

/**
 * The ESPN mTransactions view is not a documented public contract. This
 * parser accepts only a root `transactions` array and records with an id,
 * recognized type, and usable timestamp. Unknown shapes produce no records.
 */
export function parseEspnTransactions(data: unknown, leagueId: string, since?: string): Transaction[] {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.transactions)) return [];

  const mapped: Transaction[] = [];
  for (const value of root.transactions) {
    const transaction = asRecord(value);
    if (!transaction) continue;

    const transactionId = asId(transaction.id ?? transaction.transactionId);
    const type = mapTransactionType(transaction.type ?? transaction.transactionType);
    const occurredAt = parseEspnDate(
      transaction.processDate ?? transaction.processedDate ?? transaction.proposedDate ?? transaction.createdDate ?? transaction.date
    );
    if (!transactionId || !type || !occurredAt) continue;

    const items = Array.isArray(transaction.items)
      ? transaction.items.map(asRecord).filter((item): item is Record<string, unknown> => item !== undefined)
      : [];
    const playerIds = uniqueIds([
      transaction.playerId,
      ...items.map((item) => item.playerId ?? asRecord(item.player)?.id)
    ]);
    const teamIds = uniqueIds([
      transaction.teamId,
      transaction.memberId,
      transaction.proposingTeamId,
      transaction.receivingTeamId,
      asRecord(transaction.team)?.id,
      ...items.flatMap((item) => [item.fromTeamId, item.toTeamId])
    ]).filter((id) => id !== "0");

    mapped.push({
      schema_version: "1.0.0",
      created_at: occurredAt,
      updated_at: occurredAt,
      source_system: "espn",
      source_record_id: transactionId,
      transaction_id: transactionId,
      league_id: leagueId,
      type,
      team_ids: teamIds,
      player_ids: playerIds,
      occurred_at: occurredAt
    });
  }

  if (!since) return mapped;
  const sinceTime = Date.parse(since);
  if (Number.isNaN(sinceTime)) return mapped;
  return mapped.filter((transaction) => Date.parse(transaction.occurred_at) >= sinceTime);
}

function mapTransactionType(value: unknown): Transaction["type"] | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.toUpperCase()) {
    case "ADD":
    case "FREEAGENT":
    case "FREE_AGENT":
      return "add";
    case "DROP":
      return "drop";
    case "WAIVER":
      return "waiver";
    case "TRADE":
      return "trade";
    case "COMMISSIONER":
      return "commissioner";
    default:
      return undefined;
  }
}

function uniqueIds(values: unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    const id = asId(value);
    if (id) ids.add(id);
  }
  return [...ids];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function asId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text && text !== "0" ? text : undefined;
}

function parseEspnDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(value.trim())) return parseEspnDate(numeric);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
