import type { ClientSession, HydratedDocument, UpdateQuery } from 'mongoose';
import { Types } from 'mongoose';

import { WalletStatus } from '@common/enums';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Wallet, type IWallet } from './wallet.model';

/**
 * Repository for the `wallets` collection. Pure data access — services
 * call these methods inside `withTransaction` to keep ledger and balance
 * updates atomic.
 */
class WalletRepository extends BaseRepository<IWallet> {
  constructor() {
    super(Wallet);
  }

  findByUserId(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<HydratedDocument<IWallet> | null> {
    return this.model.findOne({ userId }).session(session ?? null).exec();
  }

  /**
   * Atomic balance mutation. Caller passes `$inc` deltas (positive or
   * negative) per bucket. We let MongoDB apply them server-side so the
   * read-modify-write cycle never opens.
   *
   * `expectedVersion` is an optimistic-lock guard — if the wallet was
   * updated in parallel we surface a `null` so the service can retry
   * the whole transaction.
   */
  applyBalanceDelta(
    walletId: string | Types.ObjectId,
    deltas: {
      depositDelta?: number;
      winningDelta?: number;
      bonusDelta?: number;
      lockedDelta?: number;
      creditedDelta?: number;
      debitedDelta?: number;
    },
    options: {
      expectedVersion?: number;
      session?: ClientSession;
    } = {},
  ): Promise<HydratedDocument<IWallet> | null> {
    const inc: Record<string, number> = {
      version: 1,
      transactionCount: 1,
    };
    if (deltas.depositDelta) inc.depositBalance = deltas.depositDelta;
    if (deltas.winningDelta) inc.winningBalance = deltas.winningDelta;
    if (deltas.bonusDelta) inc.bonusBalance = deltas.bonusDelta;
    if (deltas.lockedDelta) inc.lockedBalance = deltas.lockedDelta;
    if (deltas.creditedDelta) inc.totalCredited = deltas.creditedDelta;
    if (deltas.debitedDelta) inc.totalDebited = deltas.debitedDelta;

    const filter: Record<string, unknown> = { _id: walletId };
    if (options.expectedVersion !== undefined) filter.version = options.expectedVersion;

    const update: UpdateQuery<IWallet> = {
      $inc: inc,
      $set: { lastTransactionAt: new Date() },
    };

    return this.model
      .findOneAndUpdate(filter, update, { new: true, session: options.session ?? null })
      .exec();
  }

  setStatus(
    walletId: string | Types.ObjectId,
    status: WalletStatus,
    meta: { reason?: string | null } = {},
    session?: ClientSession,
  ): Promise<HydratedDocument<IWallet> | null> {
    const set: Record<string, unknown> = { status };
    if (status === WalletStatus.FROZEN) {
      set.frozenAt = new Date();
      set.frozenReason = meta.reason ?? null;
    } else if (status === WalletStatus.ACTIVE) {
      set.frozenAt = null;
      set.frozenReason = null;
    }
    return this.model
      .findByIdAndUpdate(walletId, { $set: set }, { new: true, session: session ?? null })
      .exec();
  }

  upsertForUser(userId: string | Types.ObjectId, currency: string): Promise<HydratedDocument<IWallet>> {
    return this.model
      .findOneAndUpdate(
        { userId },
        {
          $setOnInsert: {
            userId,
            currency: currency.toUpperCase(),
            status: WalletStatus.ACTIVE,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec() as Promise<HydratedDocument<IWallet>>;
  }
}

export const walletRepository = new WalletRepository();
export { WalletRepository };
