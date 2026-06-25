import type { ClientSession, Types } from 'mongoose';

import { ScoreEventStatus, type ScoreEventType } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { ScoreEvent, type IScoreEvent, type ScoreEventDoc } from './score-event.model';

interface CreateScoreEventInput {
  matchId: Types.ObjectId | string;
  type: ScoreEventType;
  playerId?: Types.ObjectId | string | null;
  scoringRuleId?: Types.ObjectId | string | null;
  scoringRuleVersion?: number | null;
  context?: Record<string, unknown>;
  triggeredBy?: Types.ObjectId | string | null;
}

interface CompleteScoreEventInput {
  inputRowsCount: number;
  teamsUpdatedCount: number;
  playersUpdatedCount: number;
  durationMs: number;
}

interface FailScoreEventInput {
  durationMs: number;
  errorMessage: string;
  errorCode?: string;
}

class ScoreEventRepository extends BaseRepository<IScoreEvent> {
  constructor() {
    super(ScoreEvent);
  }

  startEvent(input: CreateScoreEventInput, session?: ClientSession): Promise<ScoreEventDoc> {
    return this.create(
      {
        matchId: input.matchId as Types.ObjectId,
        playerId: (input.playerId ?? null) as Types.ObjectId | null,
        type: input.type,
        status: ScoreEventStatus.PROCESSING,
        scoringRuleId: (input.scoringRuleId ?? null) as Types.ObjectId | null,
        scoringRuleVersion: input.scoringRuleVersion ?? null,
        context: input.context ?? {},
        triggeredBy: (input.triggeredBy ?? null) as Types.ObjectId | null,
        startedAt: new Date(),
      } as Partial<IScoreEvent>,
      session,
    );
  }

  markCompleted(
    eventId: Types.ObjectId | string,
    payload: CompleteScoreEventInput,
  ): Promise<ScoreEventDoc | null> {
    return this.updateById(eventId, {
      $set: {
        status: ScoreEventStatus.COMPLETED,
        inputRowsCount: payload.inputRowsCount,
        teamsUpdatedCount: payload.teamsUpdatedCount,
        playersUpdatedCount: payload.playersUpdatedCount,
        durationMs: payload.durationMs,
        finishedAt: new Date(),
      },
    });
  }

  markFailed(
    eventId: Types.ObjectId | string,
    payload: FailScoreEventInput,
  ): Promise<ScoreEventDoc | null> {
    return this.updateById(eventId, {
      $set: {
        status: ScoreEventStatus.FAILED,
        durationMs: payload.durationMs,
        errorMessage: payload.errorMessage,
        errorCode: payload.errorCode ?? null,
        finishedAt: new Date(),
      },
    });
  }

  /** True if there's a PROCESSING event for the match (debounce live ticks). */
  hasInflightForMatch(matchId: Types.ObjectId | string): Promise<boolean> {
    return this.exists({ matchId, status: ScoreEventStatus.PROCESSING });
  }

  /** Most recent COMPLETED event — used to compute "computed at" wallclock. */
  findLatestCompleted(matchId: Types.ObjectId | string): Promise<ScoreEventDoc | null> {
    return ScoreEvent.findOne({ matchId, status: ScoreEventStatus.COMPLETED })
      .sort({ finishedAt: -1 })
      .exec();
  }

  findRecentForMatch(matchId: Types.ObjectId | string, limit = 20): Promise<ScoreEventDoc[]> {
    return ScoreEvent.find({ matchId }).sort({ createdAt: -1 }).limit(limit).exec();
  }
}

export const scoreEventRepository = new ScoreEventRepository();
export { ScoreEventRepository };
