import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { asyncHandler, sendCreated, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { walletAdminService } from './wallet-admin.service';
import { walletService } from './wallet.service';
import { walletTransactionRepository } from './wallet-transaction.repository';
import type {
  AdminAdjustBody,
  AdminFreezeBody,
  AdminListActionsQuery,
  AdminListTransactionsQuery,
  AdminRefundBody,
} from './wallet.validators';

const assertAdmin = (req: Request): { id: string; roles: string[] } => {
  if (!req.user) {
    throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  }
  return { id: req.user.id, roles: req.user.roles };
};

const assertIdempotency = (req: Request): string => {
  if (!req.idempotencyKey) {
    throw new AppError(
      'Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
      ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
    );
  }
  return req.idempotencyKey;
};

export const adminListTransactionsController = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const query = req.query as unknown as AdminListTransactionsQuery;
  const pagination = parsePagination(query);

  const { items, meta } = await walletTransactionRepository.listForAdmin(
    {
      userId: query.userId,
      type: query.type,
      status: query.status,
      from: query.from,
      to: query.to,
      reference: query.reference,
    },
    pagination,
  );

  return sendSuccess(
    res,
    items.map((t) => ({
      id: String(t._id),
      userId: String(t.userId),
      walletId: String(t.walletId),
      type: t.type,
      status: t.status,
      amount: t.amount,
      currency: t.currency,
      reference: t.reference,
      referenceType: t.referenceType,
      description: t.description,
      balanceAfter: t.balanceAfter,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      reversedById: t.reversedById ? String(t.reversedById) : null,
    })),
    { meta },
  );
});

export const adminLookupWalletController = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const { userId } = req.params as { userId: string };
  const result = await walletAdminService.lookupUserWallet(userId);
  return sendSuccess(res, result);
});

export const adminAdjustController = asyncHandler(async (req: Request, res: Response) => {
  const admin = assertAdmin(req);
  const { userId } = req.params as { userId: string };
  const body = req.body as AdminAdjustBody;
  const key = assertIdempotency(req);

  const { transactionId } = await walletAdminService.adjust({
    adminId: admin.id,
    adminRoles: admin.roles,
    targetUserId: userId,
    direction: body.direction,
    bucket: body.bucket,
    amount: body.amount,
    currency: body.currency,
    idempotencyKey: key,
    reason: body.reason,
    ticketRef: body.ticketRef ?? null,
    notes: body.notes ?? null,
    req,
  });

  const wallet = await walletService.getWalletSnapshot(userId);
  return sendCreated(res, { transactionId, wallet });
});

export const adminFreezeWalletController = asyncHandler(async (req: Request, res: Response) => {
  const admin = assertAdmin(req);
  const { userId } = req.params as { userId: string };
  const body = req.body as AdminFreezeBody;

  await walletAdminService.freeze({
    adminId: admin.id,
    adminRoles: admin.roles,
    targetUserId: userId,
    reason: body.reason,
    req,
  });
  const wallet = await walletService.getWalletSnapshot(userId);
  return sendSuccess(res, { wallet });
});

export const adminUnfreezeWalletController = asyncHandler(async (req: Request, res: Response) => {
  const admin = assertAdmin(req);
  const { userId } = req.params as { userId: string };
  const body = req.body as AdminFreezeBody;

  await walletAdminService.unfreeze({
    adminId: admin.id,
    adminRoles: admin.roles,
    targetUserId: userId,
    reason: body.reason,
    req,
  });
  const wallet = await walletService.getWalletSnapshot(userId);
  return sendSuccess(res, { wallet });
});

export const adminRefundTransactionController = asyncHandler(async (req: Request, res: Response) => {
  const admin = assertAdmin(req);
  const { transactionId } = req.params as { transactionId: string };
  const body = req.body as AdminRefundBody;
  const key = assertIdempotency(req);

  const result = await walletAdminService.refundTransaction({
    adminId: admin.id,
    adminRoles: admin.roles,
    transactionId,
    reason: body.reason,
    idempotencyKey: key,
    req,
  });
  return sendCreated(res, result);
});

export const adminListActionsController = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const query = req.query as unknown as AdminListActionsQuery;
  const pagination = parsePagination(query);

  const { items, meta } = await walletAdminService.listAdminActions(
    {
      actionType: query.actionType,
      adminId: query.adminId,
      targetUserId: query.targetUserId,
    },
    pagination,
  );

  return sendSuccess(
    res,
    items.map((a) => ({
      id: String(a._id),
      adminId: String(a.adminId),
      adminRoles: a.adminRoles,
      targetUserId: String(a.targetUserId),
      targetWalletId: String(a.targetWalletId),
      actionType: a.actionType,
      amount: a.amount,
      currency: a.currency,
      bucket: a.bucket,
      walletTransactionId: a.walletTransactionId ? String(a.walletTransactionId) : null,
      reason: a.reason,
      ticketRef: a.ticketRef,
      notes: a.notes,
      requestId: a.requestId,
      createdAt: a.createdAt,
    })),
    { meta },
  );
});
