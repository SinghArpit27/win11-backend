import { z } from 'zod';

import { AppConstants } from '@common/constants';

import { UPI_APPS } from './upi.utils';

export const createOrderBodySchema = z.object({
  amount: z
    .number()
    .positive()
    .transform((v) => Math.round(v * AppConstants.MONEY.MINOR_UNITS_PER_MAJOR))
    .refine((v) => Number.isInteger(v) && v >= AppConstants.MONEY.DEPOSIT_MIN_MAJOR * AppConstants.MONEY.MINOR_UNITS_PER_MAJOR, {
      message: `Minimum deposit is ${AppConstants.MONEY.DEPOSIT_MIN_MAJOR} major units`,
    }),
  currency: z.string().length(3).default('INR'),
  channel: z.enum(['card', 'upi']).default('card'),
  upiApp: z.enum(UPI_APPS).optional(),
});

export const completeUpiBodySchema = z.object({
  paymentId: z.string().min(1),
  upiApp: z.enum(UPI_APPS),
});

export const verifyPaymentBodySchema = z.object({
  paymentId: z.string().min(1),
  providerOrderId: z.string().min(1),
  providerPaymentId: z.string().optional().default(''),
  signature: z.string().optional().default(''),
});

export const paymentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;
export type VerifyPaymentBody = z.infer<typeof verifyPaymentBodySchema>;
