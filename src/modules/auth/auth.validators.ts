import { z } from 'zod';

import { OtpChannel, OtpPurpose } from '@common/enums';

/**
 * Zod request schemas for every auth endpoint. These double as the
 * DTOs — controllers consume `z.infer<typeof X>` so types and runtime
 * validation never drift.
 */

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .refine((v) => /[a-z]/.test(v), { message: 'Must include a lowercase letter' })
  .refine((v) => /[A-Z]/.test(v), { message: 'Must include an uppercase letter' })
  .refine((v) => /\d/.test(v), { message: 'Must include a digit' })
  .refine((v) => /[^A-Za-z0-9]/.test(v), { message: 'Must include a symbol' });

export const emailSchema = z.string().email().toLowerCase();
export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be in E.164 format');

const identifierSchema = z.union([emailSchema, phoneSchema]);

export const signupBodySchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    displayName: z.string().min(1).max(64).optional(),
    username: z
      .string()
      .regex(/^[a-zA-Z0-9_]{3,20}$/)
      .optional(),
  })
  .refine((v) => !!v.email || !!v.phone, {
    message: 'Either email or phone is required',
    path: ['email'],
  });
export type SignupBody = z.infer<typeof signupBodySchema>;

export const loginBodySchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20).optional(),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const logoutBodySchema = z.object({
  allDevices: z.boolean().optional().default(false),
});
export type LogoutBody = z.infer<typeof logoutBodySchema>;

export const requestOtpBodySchema = z.object({
  identifier: identifierSchema,
  channel: z.nativeEnum(OtpChannel),
  purpose: z.nativeEnum(OtpPurpose),
});
export type RequestOtpBody = z.infer<typeof requestOtpBodySchema>;

export const verifyOtpBodySchema = z.object({
  identifier: identifierSchema,
  channel: z.nativeEnum(OtpChannel),
  purpose: z.nativeEnum(OtpPurpose),
  code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});
export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>;

export const forgotPasswordBodySchema = z.object({
  identifier: identifierSchema,
});
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z.object({
  identifier: identifierSchema,
  code: z.string().regex(/^\d{6}$/),
  newPassword: passwordSchema,
});
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

export const verifyEmailBodySchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyEmailBody = z.infer<typeof verifyEmailBodySchema>;

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

/** Indian-friendly phone input — normalised to E.164 server-side. */
export const indianPhoneInputSchema = z
  .string()
  .min(10, 'Enter a valid mobile number')
  .max(16, 'Phone number too long')
  .regex(/^(\+?\d[\d\s-]{8,14}\d)$/, 'Enter a valid mobile number');

export const phoneSendOtpBodySchema = z.object({
  phone: indianPhoneInputSchema,
});
export type PhoneSendOtpBody = z.infer<typeof phoneSendOtpBodySchema>;

export const phoneVerifyOtpBodySchema = z.object({
  phone: indianPhoneInputSchema,
  code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});
export type PhoneVerifyOtpBody = z.infer<typeof phoneVerifyOtpBodySchema>;
