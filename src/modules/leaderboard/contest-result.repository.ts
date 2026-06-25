import type { ClientSession, Types } from 'mongoose';

import { ContestSettlementStatus } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  ContestResult,
  type ContestResultDoc,
  type IContestResult,
  type IContestResultWinner,
} from './contest-result.model';

interface InitResultInput {
  contestId: Types.ObjectId | string;
  matchId: Types.ObjectId | string;
  poolAmount: number;
  currency: string;
  totalEntries: number;
}

interface FinaliseResultInput {
  status: ContestSettlementStatus;
  totalPaidOut: number;
  commissionAmount: number;
  totalWinners: number;
  topScore: number;
  uniqueWinningScores: number;
  topEntries: IContestResultWinner[];
  durationMs: number;
  errorMessage?: string | null;
}

class ContestResultRepository extends BaseRepository<IContestResult> {
  constructor() {
    super(ContestResult);
  }

  findByContestId(contestId: Types.ObjectId | string): Promise<ContestResultDoc | null> {
    return ContestResult.findOne({ contestId }).exec();
  }

  /**
   * Atomic claim-or-create. Returns the row only if it was successfully
   * flipped to IN_PROGRESS — otherwise returns null (someone else is
   * settling). The worker uses this to guarantee single-runner semantics
   * without a separate distributed lock.
   */
  claimForSettlement(
    input: InitResultInput,
    lockToken: string,
    session?: ClientSession,
  ): Promise<ContestResultDoc | null> {
    return ContestResult.findOneAndUpdate(
      {
        contestId: input.contestId,
        status: { $in: [ContestSettlementStatus.NOT_STARTED, ContestSettlementStatus.FAILED] },
      },
      {
        $set: {
          status: ContestSettlementStatus.IN_PROGRESS,
          lockToken,
          startedAt: new Date(),
          errorMessage: null,
          poolAmount: input.poolAmount,
          currency: input.currency,
          totalEntries: input.totalEntries,
        },
        $setOnInsert: {
          contestId: input.contestId,
          matchId: input.matchId,
        },
      },
      { upsert: true, new: true, session, setDefaultsOnInsert: true },
    ).exec();
  }

  finalise(
    contestId: Types.ObjectId | string,
    lockToken: string,
    payload: FinaliseResultInput,
    session?: ClientSession,
  ): Promise<ContestResultDoc | null> {
    return ContestResult.findOneAndUpdate(
      { contestId, lockToken },
      {
        $set: {
          status: payload.status,
          totalPaidOut: payload.totalPaidOut,
          commissionAmount: payload.commissionAmount,
          totalWinners: payload.totalWinners,
          topScore: payload.topScore,
          uniqueWinningScores: payload.uniqueWinningScores,
          topEntries: payload.topEntries,
          durationMs: payload.durationMs,
          errorMessage: payload.errorMessage ?? null,
          completedAt: new Date(),
        },
      },
      { new: true, session },
    ).exec();
  }
}

export const contestResultRepository = new ContestResultRepository();
export { ContestResultRepository };
