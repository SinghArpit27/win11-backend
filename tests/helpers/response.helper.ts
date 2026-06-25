import type { ApiResponseMeta, ApiSuccess } from '@common/types/api-response.types';

export interface ParsedApiSuccess<T> {
  status: number;
  body: ApiSuccess<T>;
  data: T;
  meta?: ApiResponseMeta;
}

export interface ParsedApiFailure {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Assert a Supertest response is a success envelope and return typed data. */
export const expectSuccess = <T>(
  res: { status: number; body: unknown },
  expectedStatus = 200,
): ParsedApiSuccess<T> => {
  const body = res.body as ApiSuccess<T> & { success?: boolean; error?: { code: string } };

  if (res.status !== expectedStatus) {
    throw new Error(
      `Expected HTTP ${expectedStatus} but got ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  if (!body.success) {
    throw new Error(`Expected success response: ${JSON.stringify(body)}`);
  }

  return { status: res.status, body, data: body.data, meta: body.meta };
};

/** Assert a Supertest response is a failure envelope. */
export const expectFailure = (
  res: { status: number; body: unknown },
  expectedStatus: number,
  expectedCode?: string,
): ParsedApiFailure => {
  const body = res.body as {
    success: false;
    error: { code: string; message: string; details?: unknown };
  };

  if (res.status !== expectedStatus) {
    throw new Error(
      `Expected HTTP ${expectedStatus} but got ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  if (body.success !== false) {
    throw new Error(`Expected failure response: ${JSON.stringify(body)}`);
  }
  if (expectedCode && body.error.code !== expectedCode) {
    throw new Error(
      `Expected error code ${expectedCode} but got ${body.error.code}: ${body.error.message}`,
    );
  }

  return {
    status: res.status,
    code: body.error.code,
    message: body.error.message,
    details: body.error.details,
  };
};
