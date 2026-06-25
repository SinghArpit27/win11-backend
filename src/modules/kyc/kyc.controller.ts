import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { asyncHandler, sendCreated, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { kycService } from './kyc.service';

export const getMyKycController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const profile = await kycService.getOrCreateProfile(req.user.id);
  const documents = await kycService.listDocuments(req.user.id);
  return sendSuccess(res, { profile, documents });
});

export const submitKycController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const profile = await kycService.submitProfile(req.user.id, req.body);
  return sendSuccess(res, { profile });
});

export const uploadKycDocumentController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const doc = await kycService.uploadDocument(req.user.id, req.body);
  return sendCreated(res, { document: doc });
});

export const adminListPendingKycController = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req.query as { page?: string; limit?: string });
  const result = await kycService.listPending(pagination);
  return sendSuccess(res, result.items, { meta: result.meta });
});

export const adminApproveKycController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const { profileId } = req.params as { profileId: string };
  const profile = await kycService.approve(profileId, req.user.id);
  return sendSuccess(res, { profile });
});

export const adminRejectKycController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  const { profileId } = req.params as { profileId: string };
  const { reason } = req.body as { reason: string };
  const profile = await kycService.reject(profileId, req.user.id, reason);
  return sendSuccess(res, { profile });
});
