import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { asyncHandler, sendCreated, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { withdrawalService } from './withdrawal.service';
import type { WithdrawalRequestBody } from './withdrawal.validators';

const assertIdempotency = (req: Request): string => {
  if (!req.idempotencyKey) {
    throw new AppError('Idempotency-Key required', HttpStatus.BAD_REQUEST, ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
  }
  return req.idempotencyKey;
};

export const requestWithdrawalController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const body = req.body as WithdrawalRequestBody;
  const withdrawal = await withdrawalService.requestWithdrawal({
    userId: req.user.id,
    amount: body.amount,
    currency: body.currency,
    idempotencyKey: assertIdempotency(req),
    bankAccountRef: body.bankAccountRef,
    upiId: body.upiId,
    req,
  });
  return sendCreated(res, { withdrawal });
});

export const listMyWithdrawalsController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const pagination = parsePagination(req.query as { page?: string; limit?: string });
  const result = await withdrawalService.listForUser(req.user.id, pagination);
  return sendSuccess(res, result.items, { meta: result.meta });
});

export const adminListPendingWithdrawalsController = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query as { page?: string; limit?: string });
  const result = await withdrawalService.listPending(pagination);
  return sendSuccess(res, result.items, { meta: result.meta });
});

export const adminApproveWithdrawalController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const { withdrawalId } = req.params as { withdrawalId: string };
  const withdrawal = await withdrawalService.approve(withdrawalId, req.user.id);
  return sendSuccess(res, { withdrawal });
});

export const adminRejectWithdrawalController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const { withdrawalId } = req.params as { withdrawalId: string };
  const { reason } = req.body as { reason: string };
  const withdrawal = await withdrawalService.reject(withdrawalId, req.user.id, reason);
  return sendSuccess(res, { withdrawal });
});
