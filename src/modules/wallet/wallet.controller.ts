import type { Request, Response } from 'express';

import { env } from '@config/env.config';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { asyncHandler, sendCreated, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { walletService } from './wallet.service';
import { walletTransactionRepository } from './wallet-transaction.repository';
import { transactionLedgerRepository } from './transaction-ledger.repository';
import type { DepositBody, HistoryQuery, WithdrawBody } from './wallet.validators';

/**
 * User-facing wallet controllers. Thin — every method delegates to the
 * service and decides the response envelope. No business rules here.
 */

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

export const getMyWalletController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const wallet = await walletService.getWalletSnapshot(req.user.id);
  return sendSuccess(res, { wallet });
});

export const depositController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  if (!env.MANUAL_DEPOSIT_ENABLED) {
    throw new AppError(
      'Direct deposit disabled — use POST /payments/orders',
      HttpStatus.BAD_REQUEST,
      ErrorCode.BAD_REQUEST,
    );
  }
  const body = req.body as DepositBody;
  const key = assertIdempotency(req);

  const { wallet, transaction } = await walletService.deposit({
    userId: req.user.id,
    amount: body.amount,
    currency: body.currency,
    idempotencyKey: key,
    reference: body.reference ?? null,
    description: body.description ?? null,
    metadata: body.metadata ?? {},
    req,
  });

  return sendCreated(res, {
    wallet,
    transaction: {
      id: String(transaction._id),
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      reference: transaction.reference,
      createdAt: transaction.createdAt,
    },
  });
});

export const withdrawController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const body = req.body as WithdrawBody;
  const key = assertIdempotency(req);

  const { wallet, transaction } = await walletService.withdraw({
    userId: req.user.id,
    amount: body.amount,
    currency: body.currency,
    idempotencyKey: key,
    description: body.description ?? null,
    metadata: body.metadata ?? {},
    req,
  });

  return sendCreated(res, {
    wallet,
    transaction: {
      id: String(transaction._id),
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      createdAt: transaction.createdAt,
    },
  });
});

export const listMyTransactionsController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const query = req.query as unknown as HistoryQuery;

  const pagination = parsePagination(query);
  const { items, meta } = await walletTransactionRepository.listForUser(
    req.user.id,
    {
      type: query.type,
      status: query.status,
      from: query.from,
      to: query.to,
    },
    pagination,
  );

  return sendSuccess(
    res,
    items.map((t) => ({
      id: String(t._id),
      type: t.type,
      status: t.status,
      amount: t.amount,
      currency: t.currency,
      description: t.description,
      reference: t.reference,
      referenceType: t.referenceType,
      balanceAfter: t.balanceAfter,
      metadata: t.metadata,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      reversedById: t.reversedById ? String(t.reversedById) : null,
      reversesId: t.reversesId ? String(t.reversesId) : null,
    })),
    { meta },
  );
});

export const getMyTransactionController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const { transactionId } = req.params as { transactionId: string };

  const txn = await walletTransactionRepository.findById(transactionId);
  if (!txn || String(txn.userId) !== req.user.id) {
    throw new AppError(
      'Transaction not found',
      HttpStatus.NOT_FOUND,
      ErrorCode.TRANSACTION_NOT_FOUND,
    );
  }
  const ledger = await transactionLedgerRepository.listForTransaction(txn._id);

  return sendSuccess(res, {
    transaction: {
      id: String(txn._id),
      type: txn.type,
      status: txn.status,
      amount: txn.amount,
      currency: txn.currency,
      description: txn.description,
      reference: txn.reference,
      referenceType: txn.referenceType,
      balanceBefore: txn.balanceBefore,
      balanceAfter: txn.balanceAfter,
      metadata: txn.metadata,
      createdAt: txn.createdAt,
      completedAt: txn.completedAt,
      reversedById: txn.reversedById ? String(txn.reversedById) : null,
      reversesId: txn.reversesId ? String(txn.reversesId) : null,
    },
    ledger: ledger.map((row) => ({
      id: String(row._id),
      direction: row.direction,
      bucket: row.bucket,
      amount: row.amount,
      sequence: row.sequence,
      bucketBalanceBefore: row.bucketBalanceBefore,
      bucketBalanceAfter: row.bucketBalanceAfter,
    })),
  });
});

export const summaryController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const [wallet, breakdown] = await Promise.all([
    walletService.getWalletSnapshot(req.user.id),
    walletTransactionRepository.summaryForUser(req.user.id),
  ]);
  return sendSuccess(res, { wallet, breakdown });
});
