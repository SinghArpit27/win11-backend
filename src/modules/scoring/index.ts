export { FantasyPoints } from './fantasy-points.model';
export type {
  FantasyPointsDoc,
  IFantasyPoints,
  IFantasyPointBreakdown,
  IFantasyPointEvent,
} from './fantasy-points.model';

export { ScoreEvent } from './score-event.model';
export type { IScoreEvent, ScoreEventDoc } from './score-event.model';

export { fantasyPointsRepository, FantasyPointsRepository } from './fantasy-points.repository';
export { scoreEventRepository, ScoreEventRepository } from './score-event.repository';

export { scoringService, ScoringService } from './scoring.service';

export { fantasyPointsSerializer, scoreEventSerializer } from './scoring.serializers';
export type {
  FantasyPointBreakdownDTO,
  FantasyPointEventDTO,
  FantasyPointsDTO,
  ManualPointsAdjustmentInput,
  RecomputeMatchResult,
  ScoreEventDTO,
  ScoringRecomputeJobPayload,
} from './scoring.types';

export { scoringRoutes } from './scoring.routes';
