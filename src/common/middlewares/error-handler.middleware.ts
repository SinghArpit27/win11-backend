import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';

import { isProduction } from '@config/env.config';
import { logger } from '@config/logger.config';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { sendFailure } from '@common/utils/api-response.util';

/**
 * Global error handler.
 *
 * Maps every known error type into the canonical API failure envelope:
 *  - AppError                 -> use its status + code as-is
 *  - ZodError                 -> 422 VALIDATION_ERROR + field details
 *  - mongoose.ValidationError -> 422 VALIDATION_ERROR
 *  - mongoose.CastError       -> 400 BAD_REQUEST (invalid id)
 *  - Duplicate key (E11000)   -> 409 CONFLICT
 *  - Anything else            -> 500 INTERNAL_ERROR (message hidden in prod)
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err, requestId: req.id }, 'Non-operational AppError');
    } else {
      logger.warn({ err: { name: err.name, message: err.message }, requestId: req.id }, err.name);
    }
    return sendFailure(res, {
      statusCode: err.statusCode,
      code: err.errorCode,
      message: err.message,
      details: err.details,
    });
  }

  if (err instanceof ZodError) {
    return sendFailure(res, {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: err.flatten(),
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return sendFailure(res, {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: err.errors,
    });
  }

  if (err instanceof mongoose.Error.CastError) {
    return sendFailure(res, {
      statusCode: HttpStatus.BAD_REQUEST,
      code: ErrorCode.BAD_REQUEST,
      message: `Invalid value for ${err.path}`,
    });
  }

  const mongoErr = err as {
    code?: number;
    keyValue?: Record<string, unknown>;
    name?: string;
  };

  if (
    mongoErr?.name === 'MongoNetworkError' ||
    mongoErr?.name === 'MongoServerSelectionError' ||
    mongoErr?.name === 'MongoTimeoutError'
  ) {
    logger.error({ err, requestId: req.id }, 'MongoDB unavailable');
    return sendFailure(res, {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Database temporarily unavailable',
    });
  }

  // Duplicate-key error from Mongo: signature is { code: 11000, keyValue: {...} }.
  if (mongoErr && mongoErr.code === 11000) {
    return sendFailure(res, {
      statusCode: HttpStatus.CONFLICT,
      code: ErrorCode.CONFLICT,
      message: 'Duplicate resource',
      details: mongoErr.keyValue,
    });
  }

  logger.error({ err, requestId: req.id }, 'Unhandled error');
  return sendFailure(res, {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    message: isProduction ? 'Internal server error' : String((err as Error)?.message ?? err),
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  sendFailure(res, {
    statusCode: HttpStatus.NOT_FOUND,
    code: ErrorCode.NOT_FOUND,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};
