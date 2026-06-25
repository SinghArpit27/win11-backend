import { z } from 'zod';

import { AppConstants } from '@common/constants';

export const withdrawalRequestBodySchema = z.object({
  amount: z
    .number()
    .positive()
    .transform((v) => Math.round(v * AppConstants.MONEY.MINOR_UNITS_PER_MAJOR))
    .refine((v) => Number.isInteger(v) && v > 0),
  currency: z.string().length(3).default('INR'),
  bankAccountRef: z.string().optional(),
  upiId: z.string().optional(),
});

export const withdrawalRejectBodySchema = z.object({
  reason: z.string().min(3).max(500),
});

export const withdrawalParamsSchema = z.object({
  withdrawalId: z.string().min(1),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type WithdrawalRequestBody = z.infer<typeof withdrawalRequestBodySchema>;
