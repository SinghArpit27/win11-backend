import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { asyncHandler, sendCreated, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { paymentService } from './payment.service';
import type { CreateOrderBody, VerifyPaymentBody } from './payment.validators';

const assertIdempotency = (req: Request): string => {
  if (!req.idempotencyKey) {
    throw new AppError('Idempotency-Key required', HttpStatus.BAD_REQUEST, ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
  }
  return req.idempotencyKey;
};

export const createOrderController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const body = req.body as CreateOrderBody;
  const order = await paymentService.createOrder({
    userId: req.user.id,
    amount: body.amount,
    currency: body.currency,
    channel: body.channel,
    upiApp: body.upiApp,
    idempotencyKey: assertIdempotency(req),
    req,
  });
  return sendCreated(res, order);
});

export const verifyPaymentController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const body = req.body as VerifyPaymentBody;
  const result = await paymentService.verifyClientPayment({
    userId: req.user.id,
    ...body,
  });
  return sendSuccess(res, result);
});

export const listMyPaymentsController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const pagination = parsePagination(req.query as { page?: string; limit?: string });
  const result = await paymentService.listForUser(req.user.id, pagination);
  return sendSuccess(res, result.items, { meta: result.meta });
});

export const razorpayWebhookController = asyncHandler(async (req: Request, res: Response) => {
  const signature = (req.headers['x-razorpay-signature'] as string) ?? '';
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body);
  const result = await paymentService.handleWebhook(rawBody, signature, req);
  return sendSuccess(res, result);
});

export const stripeWebhookController = asyncHandler(async (req: Request, res: Response) => {
  const signature = (req.headers['stripe-signature'] as string) ?? '';
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body);
  const result = await paymentService.handleWebhook(rawBody, signature, req);
  return sendSuccess(res, result);
});

export const completeUpiPaymentController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const { paymentId, upiApp } = req.body as { paymentId: string; upiApp: string };
  const result = await paymentService.completeUpiPayment(paymentId, req.user.id, upiApp, req);
  return sendSuccess(res, result);
});

export const mockCompletePaymentController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const { paymentId } = req.body as { paymentId: string };
  const result = await paymentService.completeMockPayment(paymentId, req.user.id);
  return sendSuccess(res, result);
});

export const adminListPaymentsController = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query as { page?: string; limit?: string });
  const { Payment } = await import('./payment.model');
  const skip = (pagination.page - 1) * pagination.limit;
  const [items, total] = await Promise.all([
    Payment.find().sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).exec(),
    Payment.countDocuments(),
  ]);
  return sendSuccess(res, items, {
    meta: { ...pagination, total, totalPages: Math.ceil(total / pagination.limit) || 1 },
  });
});
