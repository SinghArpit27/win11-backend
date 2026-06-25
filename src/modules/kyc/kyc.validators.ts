import { z } from 'zod';

import { KycDocumentType } from '@common/enums';

export const kycSubmitBodySchema = z.object({
  fullName: z.string().min(2).max(120),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  aadhaarLast4: z.string().regex(/^\d{4}$/).optional(),
  bankAccountRef: z.string().min(4).max(64).optional(),
});

export const kycDocumentBodySchema = z.object({
  type: z.nativeEnum(KycDocumentType),
  fileUrl: z.string().url(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().optional(),
});

export const kycRejectBodySchema = z.object({
  reason: z.string().min(3).max(500),
});

export const kycParamsSchema = z.object({
  profileId: z.string().min(1),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
