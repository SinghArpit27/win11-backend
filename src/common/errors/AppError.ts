import { ErrorCode, ErrorCodeValue, HttpStatus, HttpStatusCode } from '@common/constants';

/**
 * `AppError` is the single base class for every domain / operational error.
 *
 * Why:
 *  - Centralises status + machine-readable error code.
 *  - Distinguishes operational errors (expected) from programmer errors
 *    via `isOperational` — the global handler uses this to decide whether
 *    to expose the message to the client.
 *  - Allows attaching structured `details` (e.g. Zod field errors) without
 *    leaking server internals.
 */
export class AppError extends Error {
  public readonly statusCode: HttpStatusCode;
  public readonly errorCode: ErrorCodeValue;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: HttpStatusCode = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: ErrorCodeValue = ErrorCode.INTERNAL_ERROR,
    options: { details?: unknown; isOperational?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, { details });
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', errorCode: ErrorCodeValue = ErrorCode.UNAUTHORIZED) {
    super(message, HttpStatus.UNAUTHORIZED, errorCode);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, HttpStatus.CONFLICT, ErrorCode.CONFLICT, { details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable') {
    super(message, HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE);
  }
}
