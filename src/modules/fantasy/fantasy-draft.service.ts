import { Types, type HydratedDocument } from 'mongoose';

import { logger } from '@config/logger.config';

import { NotFoundError } from '@common/errors/AppError';
import { withTransaction } from '@common/utils/transaction.util';

import { Match, type IMatch } from '@modules/sports/match.model';
import { Player, type IPlayer } from '@modules/sports/player.model';

import { fantasyRuleService } from './fantasy-rule.service';
import { fantasyTeamDraftRepository } from './fantasy-team-draft.repository';
import type {
  FantasyTeamDraftDoc,
  IFantasyDraftPlayer,
  IFantasyTeamDraft,
} from './fantasy-team-draft.model';
import type { FantasyDraftUpsertBody } from './fantasy.validators';

interface UserCtx {
  userId: string;
}

/**
 * Service that owns the in-progress (draft) team lifecycle.
 *
 * Drafts deliberately skip the heavyweight validator — they exist to
 * persist intermediate state so the user does not lose work on reload
 * or device switch. Validation runs only on `FantasyTeamService.preview`
 * (called from the UI on every change) and on `FantasyTeamService.create`
 * (the final save). Keeping the draft endpoint loose means a single
 * touch saves cheaply even mid-build.
 */
class FantasyDraftService {
  list(ctx: UserCtx, matchId: string): Promise<FantasyTeamDraftDoc[]> {
    return fantasyTeamDraftRepository.listForUserAndMatch(ctx.userId, matchId);
  }

  async getSlot(
    ctx: UserCtx,
    matchId: string,
    clientDraftId: string | null,
  ): Promise<FantasyTeamDraftDoc | null> {
    return fantasyTeamDraftRepository.findSlot(ctx.userId, matchId, clientDraftId);
  }

  async upsert(ctx: UserCtx, body: FantasyDraftUpsertBody): Promise<FantasyTeamDraftDoc> {
    const match = await this.requireMatch(body.matchId);
    const rule = await fantasyRuleService.getActive(match.sport, match.format);

    const players = await this.snapshotPlayers(body.players.map((p) => p.playerId));

    const domainPlayers: IFantasyDraftPlayer[] = [];
    let totalCredits = 0;
    let captainId: Types.ObjectId | null = null;
    let viceCaptainId: Types.ObjectId | null = null;

    for (const entry of body.players) {
      const snap = players.get(entry.playerId);
      if (!snap) continue;
      domainPlayers.push({
        playerId: snap._id,
        role: snap.role,
        teamId: snap.teamId,
        credits: snap.baseCredits,
        isCaptain: entry.isCaptain,
        isViceCaptain: entry.isViceCaptain,
      });
      totalCredits += snap.baseCredits;
      if (entry.isCaptain) captainId = snap._id;
      if (entry.isViceCaptain) viceCaptainId = snap._id;
    }

    const payload: Partial<IFantasyTeamDraft> = {
      userId: new Types.ObjectId(ctx.userId),
      matchId: match._id,
      sport: match.sport,
      format: match.format,
      clientDraftId: body.clientDraftId ?? null,
      ruleId: rule?._id ?? null,
      ruleVersion: rule?.version ?? null,
      name: body.name?.trim() || 'Draft team',
      players: domainPlayers,
      totalCreditsUsed: Number(totalCredits.toFixed(2)),
      captainPlayerId: captainId,
      viceCaptainPlayerId: viceCaptainId,
    };

    const saved = await withTransaction(async (session) => {
      const doc = await fantasyTeamDraftRepository.upsertSlot(
        ctx.userId,
        body.matchId,
        body.clientDraftId ?? null,
        payload,
        session,
      );
      if (!doc) throw new NotFoundError('Draft');
      return doc;
    });

    logger.debug(
      { userId: ctx.userId, matchId: body.matchId, draftId: String(saved._id) },
      'fantasy.draft.upserted',
    );
    return saved;
  }

  async deleteById(ctx: UserCtx, id: string): Promise<void> {
    const removed = await fantasyTeamDraftRepository.hardDeleteById(id, ctx.userId);
    if (removed === 0) throw new NotFoundError('Draft');
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async requireMatch(matchId: string): Promise<HydratedDocument<IMatch>> {
    const match = await Match.findById(matchId).exec();
    if (!match) throw new NotFoundError('Match');
    return match;
  }

  private async snapshotPlayers(playerIds: string[]): Promise<Map<string, HydratedDocument<IPlayer>>> {
    if (playerIds.length === 0) return new Map();
    const uniqueIds = Array.from(new Set(playerIds));
    const players = await Player.find({ _id: { $in: uniqueIds } }).exec();
    const map = new Map<string, HydratedDocument<IPlayer>>();
    for (const p of players) map.set(String(p._id), p);
    return map;
  }
}

export const fantasyDraftService = new FantasyDraftService();
