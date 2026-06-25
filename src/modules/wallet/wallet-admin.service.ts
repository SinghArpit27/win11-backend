import type { Request } from 'express';
import { Types } from 'mongoose';

import { ErrorCode, HttpStatus } from '@common/constants';
import {
  AdminWalletActionType,
  LedgerDirection,
  WalletBucket,
  WalletStatus,
} from '@common/enums';
import { AppError } from '@common/errors';
import type { PaginationParams } from '@common/types/common.types';

import { BaseService } from '@shared/services/base.service';

import { userRepository } from '@modules/user/user.repository';

import { adminWalletActionRepository } from './admin-wallet-action.repository';
import { walletService } from './wallet.service';
import { walletTransactionRepository } from './wallet-transaction.repository';

/**
 * Admin-facing wallet service. Thin layer that:
 *  - resolves admin actor context,
 *  - invokes the canonical `walletService` to actually move money,
 *  - records an `admin_wallet_actions` row so support can query the
 *    "what did admins do?" view without joining 4 audit log queries.
 */
class WalletAdminService extends BaseService {
  constructor() {
    super('wallet-admin-service');
  }

  async lookupUserWallet(userId: string): Promise<{
    user: { id: string; email: string | null; phone: string | null; displayName: string | null };
    wallet: ReturnType<typeof walletService.getWalletSnapshot> extends Promise<infer R>
      ? R
      : never;
  }> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError('User not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    const snapshot = await walletService.getWalletSnapshot(userId);
    return {
      user: {
        id: String(user._id),
        email: user.email ?? null,
        phone: user.phone ?? null,
        displayName: user.displayName ?? null,
      },
      wallet: snapshot,
    };
  }

  async adjust(args: {
    adminId: string;
    adminRoles: string[];
    targetUserId: string;
    direction: LedgerDirection;
    bucket: WalletBucket;
    amount: number;
    currency: string;
    idempotencyKey: string;
    reason: string;
    ticketRef?: string | null;
    notes?: string | null;
    req: Request;
  }): Promise<{ transactionId: string }> {
    const txn = await walletService.adminAdjust({
      adminId: args.adminId,
      adminRoles: args.adminRoles,
      targetUserId: args.targetUserId,
      direction: args.direction,
      bucket: args.bucket,
      amount: args.amount,
      currency: args.currency,
      idempotencyKey: args.idempotencyKey,
      reason: args.reason,
      ticketRef: args.ticketRef ?? null,
      notes: args.notes ?? null,
      req: args.req,
    });

    await adminWalletActionRepository.createEntry({
      adminId: new Types.ObjectId(args.adminId),
      adminRoles: args.adminRoles,
      targetUserId: new Types.ObjectId(args.targetUserId),
      targetWalletId: txn.walletId,
      actionType:
        args.direction === LedgerDirection.CREDIT
          ? AdminWalletActionType.ADJUSTMENT_CREDIT
          : AdminWalletActionType.ADJUSTMENT_DEBIT,
      amount: args.amount,
      currency: args.currency,
      bucket: args.bucket,
      walletTransactionId: txn._id,
      reason: args.reason,
      ticketRef: args.ticketRef ?? null,
      notes: args.notes ?? null,
      requestId: args.req.id ?? null,
      correlationId: args.req.correlationId ?? null,
    });

    return { transactionId: String(txn._id) };
  }

  async freeze(args: {
    adminId: string;
    adminRoles: string[];
    targetUserId: string;
    reason: string;
    req: Request;
  }): Promise<void> {
    const snapshot = await walletService.setWalletStatus({
      adminId: args.adminId,
      adminRoles: args.adminRoles,
      targetUserId: args.targetUserId,
      status: WalletStatus.FROZEN,
      reason: args.reason,
      req: args.req,
    });
    await adminWalletActionRepository.createEntry({
      adminId: new Types.ObjectId(args.adminId),
      adminRoles: args.adminRoles,
      targetUserId: new Types.ObjectId(args.targetUserId),
      targetWalletId: new Types.ObjectId(snapshot.id),
      actionType: AdminWalletActionType.FREEZE,
      amount: 0,
      currency: snapshot.currency,
      bucket: null,
      walletTransactionId: null,
      reason: args.reason,
      requestId: args.req.id ?? null,
      correlationId: args.req.correlationId ?? null,
    });
  }

  async unfreeze(args: {
    adminId: string;
    adminRoles: string[];
    targetUserId: string;
    reason: string;
    req: Request;
  }): Promise<void> {
    const snapshot = await walletService.setWalletStatus({
      adminId: args.adminId,
      adminRoles: args.adminRoles,
      targetUserId: args.targetUserId,
      status: WalletStatus.ACTIVE,
      reason: args.reason,
      req: args.req,
    });
    await adminWalletActionRepository.createEntry({
      adminId: new Types.ObjectId(args.adminId),
      adminRoles: args.adminRoles,
      targetUserId: new Types.ObjectId(args.targetUserId),
      targetWalletId: new Types.ObjectId(snapshot.id),
      actionType: AdminWalletActionType.UNFREEZE,
      amount: 0,
      currency: snapshot.currency,
      bucket: null,
      walletTransactionId: null,
      reason: args.reason,
      requestId: args.req.id ?? null,
      correlationId: args.req.correlationId ?? null,
    });
  }

  /**
   * Phase-3 refund is implemented as a `reverseTransaction`. A real
   * gateway integration may instead surface a webhook-driven refund —
   * that path will reuse `walletService.adminAdjust` with a CREDIT.
   */
  async refundTransaction(args: {
    adminId: string;
    adminRoles: string[];
    transactionId: string;
    reason: string;
    idempotencyKey: string;
    req: Request;
  }): Promise<{ reversalTransactionId: string }> {
    const original = await walletTransactionRepository.findById(args.transactionId);
    if (!original) {
      throw new AppError(
        'Transaction not found',
        HttpStatus.NOT_FOUND,
        ErrorCode.TRANSACTION_NOT_FOUND,
      );
    }

    const reversal = await walletService.reverseTransaction({
      transactionId: args.transactionId,
      adminId: args.adminId,
      adminRoles: args.adminRoles,
      reason: args.reason,
      idempotencyKey: args.idempotencyKey,
      req: args.req,
    });

    await adminWalletActionRepository.createEntry({
      adminId: new Types.ObjectId(args.adminId),
      adminRoles: args.adminRoles,
      targetUserId: original.userId,
      targetWalletId: original.walletId,
      actionType: AdminWalletActionType.REFUND,
      amount: original.amount,
      currency: original.currency,
      bucket: null,
      walletTransactionId: reversal._id,
      reason: args.reason,
      requestId: args.req.id ?? null,
      correlationId: args.req.correlationId ?? null,
    });

    return { reversalTransactionId: String(reversal._id) };
  }

  /** Admin reads — straight pass-through to repository for pagination. */
  listAdminActions(
    filters: { actionType?: AdminWalletActionType; adminId?: string; targetUserId?: string },
    pagination: PaginationParams,
  ) {
    return adminWalletActionRepository.list(filters, pagination);
  }
}

export const walletAdminService = new WalletAdminService();
export { WalletAdminService };
