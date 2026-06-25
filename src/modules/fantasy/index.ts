/**
 * Public surface of the fantasy module.
 * Other modules / loaders should import from here only.
 */
export { fantasyRoutes } from './fantasy.routes';

export { fantasyRuleService, defaultCricketT20RuleSeed } from './fantasy-rule.service';
export {
  fantasyScoringRuleService,
  defaultCricketT20ScoringSeed,
} from './fantasy-scoring-rule.service';
export { fantasyTeamService } from './fantasy-team.service';
export { fantasyDraftService } from './fantasy-draft.service';
export { fantasyMatchService } from './fantasy-match.service';

export { FantasyRule, type IFantasyRule, type FantasyRuleDoc } from './fantasy-rule.model';
export {
  FantasyScoringRule,
  type IFantasyScoringRule,
  type FantasyScoringRuleDoc,
} from './fantasy-scoring-rule.model';
export {
  FantasyTeam,
  type IFantasyTeam,
  type IFantasyTeamPlayer,
  type FantasyTeamDoc,
} from './fantasy-team.model';
export {
  FantasyTeamPlayer,
  type IFantasyTeamPlayerRow,
  type FantasyTeamPlayerDoc,
} from './fantasy-team-player.model';
export {
  FantasyTeamDraft,
  type IFantasyTeamDraft,
  type IFantasyDraftPlayer,
  type FantasyTeamDraftDoc,
} from './fantasy-team-draft.model';

export {
  validateFantasyTeam,
  validateFantasyTeamShape,
  type FantasyValidationIssue,
  type FantasyValidationResult,
  type FantasyValidatorPlayer,
  type FantasyValidatorInput,
} from './fantasy.validator';

export {
  computePlayerPoints,
  computeTeamPoints,
  type FantasyScoringInput,
  type FantasyScoringOutput,
  type FantasyScoringBreakdown,
  type FantasyTeamScoringInput,
  type FantasyTeamScoringResult,
} from './fantasy.scoring';

export * from './fantasy.types';
