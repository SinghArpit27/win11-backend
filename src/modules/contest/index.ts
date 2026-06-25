/**
 * Public surface of the contest module.
 * Other modules / loaders should import from here only.
 */

export { contestRoutes } from './contest.routes';
export { initContestSeeds } from './contest.bootstrap';

export { contestService } from './contest.service';
export { contestJoinService } from './contest-join.service';
export { contestTemplateService } from './contest-template.service';
export { prizeDistributionService } from './prize-distribution.service';

export {
  Contest,
  type IContest,
  type IContestPrizeSnapshot,
  type IContestPrizeSlabSnapshot,
  type ContestDoc,
} from './contest.model';
export {
  ContestEntry,
  type IContestEntry,
  type ContestEntryDoc,
} from './contest-entry.model';
export {
  ContestTemplate,
  type IContestTemplate,
  type ContestTemplateDoc,
} from './contest-template.model';
export {
  PrizeDistribution,
  type IPrizeDistribution,
  type IPrizeSlab,
  type PrizeDistributionDoc,
} from './prize-distribution.model';

export {
  validateContestJoin,
  type ContestValidationResult,
  type ContestValidationIssue,
  type ValidateJoinInput,
} from './contest.validator';

export * from './contest.types';
