/**
 * Slot-aware add/drop evaluation.
 *
 * Raw projections are not enough: a league with 1 QB slot only benefits from
 * an elite QB add if that QB actually displaces the starter. This module
 * evaluates every free-agent candidate by its MARGINAL LINEUP VALUE — the best
 * achievable change to the starting lineup given the league's slot rules —
 * plus a season-long stash signal (upside beats a starter even if the mean
 * does not, yet).
 *
 * Deterministic by design (ADR-0002): no prompts, no vibes, just arithmetic
 * over the caller's projections.
 */

const FLEX_ELIGIBLE: ReadonlySet<string> = new Set(["RB", "WR", "TE"]);

/** Lineup slots a player of `position` may occupy. */
export function eligibleSlotsFor(position: string): string[] {
  if (FLEX_ELIGIBLE.has(position)) return [position, "FLEX"];
  return [position];
}

export interface RosteredPlayer {
  readonly playerId: string;
  /** Lineup slot the player currently occupies (e.g. "QB", "RB", "FLEX", "BN"). */
  readonly slot: string;
  readonly projected: number;
}

export interface AddCandidate {
  readonly playerId: string;
  readonly position: string;
  /** Single-week projected points (apples-to-apples scale). */
  readonly projected: number;
  /** Optional upside (e.g. p90) for season-long stash evaluation. */
  readonly upside?: number;
}

export interface AddEvaluation {
  readonly playerId: string;
  readonly position: string;
  readonly projected: number;
  /**
   * Projected points gained THIS WEEK if the candidate is added and the
   * lineup re-optimized. 0 when the candidate cannot beat any eligible starter.
   */
  readonly weeklyDelta: number;
  readonly replaces?: { readonly playerId: string; readonly slot: string; readonly projected: number };
  readonly startsThisWeek: boolean;
  /** Upside-only stash: mean can't beat a starter, but p90 can. */
  readonly upsideStash: boolean;
  readonly bestDropPlayerId?: string;
  readonly rationale: string;
}

export interface SlotCounts {
  readonly [slot: string]: number;
}

function occupiedStarters(roster: readonly RosteredPlayer[]): RosteredPlayer[] {
  return roster.filter((p) => p.slot !== "BN");
}

function worstEligibleStarter(
  roster: readonly RosteredPlayer[],
  eligibleSlots: ReadonlySet<string>
): RosteredPlayer | undefined {
  const eligible = occupiedStarters(roster).filter((p) => eligibleSlots.has(p.slot));
  if (eligible.length === 0) return undefined;
  return eligible.reduce((worst, p) => (p.projected < worst.projected ? p : worst));
}

function bestDrop(
  roster: readonly RosteredPlayer[],
  candidatePlayerId: string,
  replaced: RosteredPlayer | undefined
): string | undefined {
  const dropPool = roster.filter(
    (p) =>
      p.playerId !== candidatePlayerId &&
      ((replaced && p.playerId === replaced.playerId) || p.slot === "BN")
  );
  if (dropPool.length === 0) return undefined;
  return dropPool.reduce((worst, p) => (p.projected < worst.projected ? p : worst)).playerId;
}

/**
 * Evaluate one free-agent candidate against the current roster.
 *
 * `slotCounts` (e.g. `{ QB: 1, RB: 2, FLEX: 1, K: 1 }`) is used to detect
 * *unfilled required slots*: a candidate who can fill a required slot that is
 * currently empty starts immediately and gains the slot's full projection
 * (delta vs. an implicit 0).
 */
export function evaluateAddCandidate(
  roster: readonly RosteredPlayer[],
  slotCounts: SlotCounts,
  candidate: AddCandidate
): AddEvaluation {
  const slots = new Set(eligibleSlotsFor(candidate.position));
  const occupied = occupiedStarters(roster);
  const worst = worstEligibleStarter(roster, slots);

  // Unfilled required slot: e.g. 1 K slot with no K slotted as a starter.
  const filled = new Map<string, number>();
  for (const p of occupied) {
    if (slots.has(p.slot)) filled.set(p.slot, (filled.get(p.slot) ?? 0) + 1);
  }
  const openSlot = Object.entries(slotCounts).find(
    ([slot, count]) => slots.has(slot) && count > 0 && (filled.get(slot) ?? 0) < count
  );

  if (openSlot) {
    return {
      playerId: candidate.playerId,
      position: candidate.position,
      projected: candidate.projected,
      weeklyDelta: round(candidate.projected),
      startsThisWeek: true,
      upsideStash: false,
      rationale: `fills an empty ${openSlot[0]} slot (+${round(candidate.projected)} projected).`
    };
  }

  if (worst && candidate.projected > worst.projected) {
    return {
      playerId: candidate.playerId,
      position: candidate.position,
      projected: candidate.projected,
      weeklyDelta: round(candidate.projected - worst.projected),
      replaces: { playerId: worst.playerId, slot: worst.slot, projected: worst.projected },
      startsThisWeek: true,
      upsideStash: false,
      bestDropPlayerId: bestDrop(roster, candidate.playerId, worst),
      rationale: `starts over ${worst.playerId} (${worst.slot}, ${round(worst.projected)} proj) for +${round(candidate.projected - worst.projected)}.`
    };
  }

  const upsideStash =
    worst !== undefined &&
    candidate.upside !== undefined &&
    candidate.upside > worst.projected &&
    candidate.projected <= worst.projected;

  return {
    playerId: candidate.playerId,
    position: candidate.position,
    projected: candidate.projected,
    weeklyDelta: 0,
    startsThisWeek: false,
    upsideStash,
    rationale: upsideStash
      ? `bench stash: mean (${round(candidate.projected)}) below ${worst.playerId} (${round(worst.projected)}) but upside ${round(candidate.upside!)} is not.`
      : `cannot beat any eligible starter (worst: ${worst ? `${worst.playerId} ${round(worst.projected)}` : "n/a"}); no add value this week.`
  };
}

/**
 * Rank free-agent candidates by weekly lineup value, then by upside stashes.
 * Returns only candidates with a reason to add (delta > 0 or upside stash),
 * sorted by weeklyDelta desc, then projected desc.
 */
export function rankFreeAgents(
  roster: readonly RosteredPlayer[],
  slotCounts: SlotCounts,
  candidates: readonly AddCandidate[]
): AddEvaluation[] {
  const evaluated = candidates.map((candidate) => evaluateAddCandidate(roster, slotCounts, candidate));
  return evaluated
    .filter((e) => e.weeklyDelta > 0 || e.upsideStash)
    .sort(
      (a, b) =>
        b.weeklyDelta - a.weeklyDelta ||
        b.projected - a.projected ||
        a.playerId.localeCompare(b.playerId)
    );
}

/**
 * Start/sit check inside the current roster: bench players whose projection
 * beats an eligible starter, or who can fill a required slot that is currently
 * empty (e.g. a rostered K sitting on the bench with no K started).
 * Position eligibility is supplied by the caller via `benchPositions`
 * (playerId -> position), since bench slots do not carry one.
 */
export function lineupSwapCandidates(
  roster: readonly RosteredPlayer[],
  benchPositions: Readonly<Record<string, string>>,
  slotCounts: SlotCounts = {}
): Array<{ benchPlayerId: string; outPlayerId: string; slot: string; delta: number }> {
  const bench = roster.filter((p) => p.slot === "BN");
  const swaps: Array<{ benchPlayerId: string; outPlayerId: string; slot: string; delta: number }> = [];
  for (const candidate of bench) {
    const position = benchPositions[candidate.playerId];
    if (!position) continue;
    const eligibleSlots = new Set(eligibleSlotsFor(position));
    const eligible = occupiedStarters(roster).filter((p) => eligibleSlots.has(p.slot));
    if (eligible.length === 0) {
      // Empty required slot: this bench player should simply be started.
      const openSlot = Object.entries(slotCounts).find(
        ([slot, count]) => eligibleSlots.has(slot) && count > 0
      );
      if (openSlot) {
        swaps.push({
          benchPlayerId: candidate.playerId,
          outPlayerId: "",
          slot: openSlot[0],
          delta: round(candidate.projected)
        });
      }
      continue;
    }
    const worst = eligible.reduce((w, p) => (p.projected < w.projected ? p : w));
    if (candidate.projected > worst.projected) {
      swaps.push({
        benchPlayerId: candidate.playerId,
        outPlayerId: worst.playerId,
        slot: worst.slot,
        delta: round(candidate.projected - worst.projected)
      });
    }
  }
  return swaps.sort((a, b) => b.delta - a.delta);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
