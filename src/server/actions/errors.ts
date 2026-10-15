import type { SiActionErrorCode } from './types';

const STATUS: Record<SiActionErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  org_not_authorized: 403,
  unknown_action: 404,
  unknown_job: 404,
  validation_failed: 422,
  internal_error: 500,
  upstream_unavailable: 503,
};

/** Throw from a handler to answer with a contract error instead of a 500. */
export class SiActionError extends Error {
  readonly code: SiActionErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: SiActionErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SiActionError';
    this.code = code;
    this.status = STATUS[code];
    this.retryable = code === 'upstream_unavailable' || code === 'internal_error';
    this.details = details;
  }
}
