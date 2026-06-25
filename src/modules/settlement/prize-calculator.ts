import { PrizeDistributionType } from '@common/enums';

import type {
  IContestPrizeSlabSnapshot,
  IContestPrizeSnapshot,
} from '@modules/contest/contest.model';

/**
 * Pure prize-calculation utilities.
 *
 * Phase 7 keeps payout maths in a small, testable module that is
 * imported by **both** the leaderboard read path (for projected
 * winnings) and the settlement worker (for final payouts). Centralising
 * the maths guarantees the FE never shows a projection that disagrees
 * with the final payout.
 */

/**
 * Compute the prize a single rank would receive from a slab snapshot.
 *
 * Behaviour by distribution type:
 *   - `RANK_BASED` / `FIXED`  → returns the slab's `prizeAmount`
 *     (already in minor units).
 *   - `PERCENTAGE_BASED`      → returns `floor(pool * bps / 10_000)`.
 *
 * Returns `0` if the rank is outside the snapshot's ladder.
 */
export const prizeForRank = (
  rank: number,
  snapshot: IContestPrizeSnapshot,
): number => {
  if (!snapshot || !Array.isArray(snapshot.slabs) || rank < 1) return 0;
  const slab = snapshot.slabs.find((s) => rank >= s.fromRank && rank <= s.toRank);
  if (!slab) return 0;
  return prizeForSlab(slab, snapshot);
};

/** Compute the per-rank prize *within* a slab (no tie handling). */
export const prizeForSlab = (
  slab: IContestPrizeSlabSnapshot,
  snapshot: IContestPrizeSnapshot,
): number => {
  switch (snapshot.type) {
    case PrizeDistributionType.PERCENTAGE_BASED:
      return Math.floor((snapshot.poolAmount * (slab.percentageBps ?? 0)) / 10_000);
    case PrizeDistributionType.RANK_BASED:
    case PrizeDistributionType.FIXED:
    default:
      return slab.prizeAmount ?? 0;
  }
};

/**
 * Sum the prizes for a contiguous rank range `[fromRank..toRank]` from
 * a snapshot. Handles the case where the range crosses multiple slabs.
 *
 * The result is in minor units. Used by tie handling to "pool" the
 * prizes for tied positions and then split them equally.
 */
export const prizePoolForRange = (
  fromRank: number,
  toRank: number,
  snapshot: IContestPrizeSnapshot,
): number => {
  if (toRank < fromRank) return 0;
  let total = 0;
  for (let r = fromRank; r <= toRank; r += 1) {
    total += prizeForRank(r, snapshot);
  }
  return total;
};

export interface RankedEntryInput {
  entryId: string;
  userId: string;
  teamId: string;
  points: number;
  /** Original join order — used to break exact ties deterministically. */
  joinedAt: Date;
}

export interface AllocatedWinning extends RankedEntryInput {
  rank: number;
  winningAmount: number;
  isTied: boolean;
}

/**
 * Allocate winnings across a list of ranked entries.
 *
 * Algorithm (the industry standard "split tied prizes evenly"):
 *   1. Sort entries descending by points, then ascending by joinedAt
 *      so ties are broken deterministically.
 *   2. Walk the sorted list and group consecutive entries with the
 *      same `points` into a "tie cluster".
 *   3. For each cluster occupying ranks `[startRank..endRank]`:
 *        - Sum the prizes for those ranks → `clusterPool`.
 *        - Split equally: `share = floor(clusterPool / size)`.
 *        - Any "rounding remainder" goes to the **earliest** tied
 *          entry (deterministic, prevents pool drift).
 *
 * Total payout is always ≤ `sum(prizeForRank(r))` over the contested
 * ranks — never over the pool. Settlement also asserts this invariant.
 */
export const allocateWinnings = (
  entries: RankedEntryInput[],
  snapshot: IContestPrizeSnapshot,
): AllocatedWinning[] => {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });

  const out: AllocatedWinning[] = [];
  let i = 0;
  while (i < sorted.length) {
    const head = sorted[i]!;
    let j = i;
    // Tie cluster: every entry with identical points to head.
    while (j + 1 < sorted.length && sorted[j + 1]!.points === head.points) {
      j += 1;
    }
    const clusterSize = j - i + 1;
    const startRank = i + 1;
    const endRank = j + 1;

    const isTied = clusterSize > 1;
    const clusterPool = prizePoolForRange(startRank, endRank, snapshot);
    const share = Math.floor(clusterPool / clusterSize);
    const remainder = clusterPool - share * clusterSize;

    for (let k = 0; k < clusterSize; k += 1) {
      const entry = sorted[i + k]!;
      const extra = k === 0 ? remainder : 0;
      const winning = share + extra;
      out.push({
        ...entry,
        rank: startRank + k,
        winningAmount: winning,
        isTied,
      });
    }
    i = j + 1;
  }
  return out;
};

/**
 * Quick predicate — true if the snapshot would pay out *any* money
 * for at least one rank. Used by the settlement worker to skip
 * wallet credits entirely for free practice contests.
 */
export const snapshotHasPayouts = (snapshot: IContestPrizeSnapshot): boolean => {
  if (!snapshot || snapshot.poolAmount <= 0) return false;
  return snapshot.slabs.some((s) => prizeForSlab(s, snapshot) > 0);
};
