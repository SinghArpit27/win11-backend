import type { Response } from 'express';

import { HttpStatus, HttpStatusCode, ErrorCode, ErrorCodeValue } from '@common/constants';
import type { ApiFailure, ApiResponseMeta, ApiSuccess } from '@common/types/api-response.types';

/**
 * Generic, reusable response formatter.
 * Controllers MUST use these helpers — never `res.json` directly.
 */

const nowIso = (): string => new Date().toISOString();

export const sendSuccess = <T>(
  res: Response,
  data: T,
  options: {
    statusCode?: HttpStatusCode;
    meta?: ApiResponseMeta;
  } = {},
): Response<ApiSuccess<T>> => {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    meta: options.meta,
    requestId: res.req.id,
    timestamp: nowIso(),
  };
  return res.status(options.statusCode ?? HttpStatus.OK).json(body);
};

export const sendCreated = <T>(
  res: Response,
  data: T,
  meta?: ApiResponseMeta,
): Response<ApiSuccess<T>> => sendSuccess(res, data, { statusCode: HttpStatus.CREATED, meta });

export const sendNoContent = (res: Response): Response => res.status(HttpStatus.NO_CONTENT).send();

export const sendFailure = (
  res: Response,
  options: {
    statusCode: HttpStatusCode;
    code: ErrorCodeValue;
    message: string;
    details?: unknown;
  },
): Response<ApiFailure> => {
  const body: ApiFailure = {
    success: false,
    error: {
      code: options.code,
      message: options.message,
      details: options.details,
    },
    requestId: res.req.id,
    timestamp: nowIso(),
  };
  return res.status(options.statusCode).json(body);
};

export const sendInternalError = (res: Response, message = 'Internal server error') =>
  sendFailure(res, {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    message,
  });
