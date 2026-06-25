import {
  AuditAction,
  KycDocumentType,
  KycStatus,
  NotificationType,
  TransactionAuditAction,
} from '@common/enums';
import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { notificationService } from '@modules/notification';
import { transactionAuditService } from '@modules/transaction-audit';

import { KycDocument } from './kyc-document.model';
import { KycProfile } from './kyc-profile.model';

class KycService {
  async getOrCreateProfile(userId: string) {
    let profile = await KycProfile.findOne({ userId });
    if (!profile) {
      profile = await KycProfile.create({ userId, status: KycStatus.PENDING });
    }
    return profile;
  }

  async assertApproved(userId: string): Promise<void> {
    const profile = await KycProfile.findOne({ userId });
    if (!profile || profile.status !== KycStatus.APPROVED) {
      throw new AppError('KYC verification required', HttpStatus.FORBIDDEN, ErrorCode.KYC_REQUIRED);
    }
  }

  async submitProfile(
    userId: string,
    input: {
      fullName: string;
      panNumber?: string;
      aadhaarLast4?: string;
      bankAccountRef?: string;
    },
  ) {
    const profile = await this.getOrCreateProfile(userId);
    profile.fullName = input.fullName;
    profile.panNumber = input.panNumber ?? null;
    profile.aadhaarLast4 = input.aadhaarLast4 ?? null;
    profile.bankAccountRef = input.bankAccountRef ?? null;
    profile.status = KycStatus.UNDER_REVIEW;
    profile.submittedAt = new Date();
    await profile.save();

    await transactionAuditService.record({
      action: TransactionAuditAction.KYC_SUBMITTED,
      userId,
      referenceType: 'kyc_profile',
      referenceId: String(profile._id),
    });

    return profile;
  }

  async uploadDocument(
    userId: string,
    input: { type: KycDocumentType; fileUrl: string; fileName: string; mimeType?: string },
  ) {
    const profile = await this.getOrCreateProfile(userId);
    return KycDocument.create({
      userId,
      profileId: profile._id,
      type: input.type,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
    });
  }

  async approve(profileId: string, adminId: string) {
    const profile = await KycProfile.findById(profileId);
    if (!profile) {
      throw new AppError('KYC profile not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    profile.status = KycStatus.APPROVED;
    profile.reviewedBy = adminId as unknown as typeof profile.reviewedBy;
    profile.reviewedAt = new Date();
    profile.rejectionReason = null;
    await profile.save();

    await auditLogger.success({
      actorId: adminId,
      action: AuditAction.KYC_APPROVED,
      resource: 'kyc_profile',
      resourceId: profileId,
    });

    const { realtimePublisher } = await import('@events/realtime.publisher');
    void realtimePublisher.kycApproved({ userId: String(profile.userId), profileId });

    void notificationService.enqueue({
      userId: String(profile.userId),
      type: NotificationType.SYSTEM,
      title: 'KYC approved',
      body: 'Your identity verification is complete',
      data: { profileId },
    });

    return profile;
  }

  async reject(profileId: string, adminId: string, reason: string) {
    const profile = await KycProfile.findById(profileId);
    if (!profile) {
      throw new AppError('KYC profile not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
    }
    profile.status = KycStatus.REJECTED;
    profile.reviewedBy = adminId as unknown as typeof profile.reviewedBy;
    profile.reviewedAt = new Date();
    profile.rejectionReason = reason;
    await profile.save();

    const { realtimePublisher } = await import('@events/realtime.publisher');
    void realtimePublisher.kycRejected({ userId: String(profile.userId), profileId, reason });

    void notificationService.enqueue({
      userId: String(profile.userId),
      type: NotificationType.SYSTEM,
      title: 'KYC rejected',
      body: reason,
      data: { profileId },
    });

    return profile;
  }

  async listPending(pagination: { page: number; limit: number }) {
    const skip = (pagination.page - 1) * pagination.limit;
    const query = { status: KycStatus.UNDER_REVIEW };
    const [items, total] = await Promise.all([
      KycProfile.find(query).sort({ submittedAt: 1 }).skip(skip).limit(pagination.limit).exec(),
      KycProfile.countDocuments(query),
    ]);
    return {
      items,
      meta: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) || 1 },
    };
  }

  async listDocuments(userId: string) {
    return KycDocument.find({ userId }).sort({ createdAt: -1 }).exec();
  }
}

export const kycService = new KycService();
