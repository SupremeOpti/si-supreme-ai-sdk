/**
 * Error classes for the server entry. Every class carries a stable `code`
 * string; the org-related codes match SI's MCP error codes (SI-379).
 *
 * `message` may contain operator detail (status codes, reasons) and is meant
 * for logs. `publicMessage` is safe to show to an MCP client or end user.
 */

export type SiServerErrorCode =
  | 'org_access_denied'
  | 'org_locked'
  | 'user_not_found'
  | 'si_unavailable'
  | 'misconfigured_key'
  | 'app_inactive'
  | 'lock_store_unavailable'
  | 'invalid_argument'
  | 'invalid_token'
  | 'insufficient_scope'
  | 'validation_failed';

export class SiServerError extends Error {
  readonly code: SiServerErrorCode;
  readonly publicMessage: string;

  constructor(code: SiServerErrorCode, message: string, publicMessage: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.publicMessage = publicMessage;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The user can't use the requested organization in this app (or it doesn't exist). */
export class OrgAccessDeniedError extends SiServerError {
  readonly organization: string;

  constructor(organization: string | number) {
    const org = String(organization);
    super(
      'org_access_denied',
      `Access to organization "${org}" denied`,
      `You don't have access to organization "${org}" in this app, or it doesn't exist. Call list_organizations to see the organizations you can use.`
    );
    this.organization = org;
  }
}

export interface LockedOrganization {
  id: number;
  slug?: string;
  name?: string;
}

/** The conversation is bound to another organization. */
export class OrgLockedError extends SiServerError {
  readonly lockedOrganization: LockedOrganization;
  readonly requestedOrganization: LockedOrganization;

  constructor(locked: LockedOrganization, requested: LockedOrganization) {
    const label = (o: LockedOrganization) => (o.name ? `${o.name} (${o.slug ?? o.id})` : `organization ${o.id}`);
    super(
      'org_locked',
      `Conversation is locked to organization ${locked.id}; requested ${requested.id}`,
      `This conversation is already working in ${label(locked)}. Start a new conversation to work in ${label(requested)}.`
    );
    this.lockedOrganization = locked;
    this.requestedOrganization = requested;
  }
}

/** SI answered `404 user_not_found`. The app should revoke the user's connection. */
export class UserGoneError extends SiServerError {
  readonly userId: string;

  constructor(userId: string | number) {
    super(
      'user_not_found',
      `SI user ${userId} not found`,
      'Your Supreme Intelligence account no longer exists. Reconnect this app.'
    );
    this.userId = String(userId);
  }
}

export type SiUnavailableReason =
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'rate_limited'
  | 'malformed_response'
  | 'unexpected_status';

/** SI couldn't give a usable answer. Always a deny. */
export class SiUnavailableError extends SiServerError {
  readonly reason: SiUnavailableReason;
  readonly status?: number;
  /** From SI's `Retry-After` on a `429`, when present. */
  readonly retryAfterSeconds?: number;

  constructor(reason: SiUnavailableReason, detail?: string, status?: number, retryAfterSeconds?: number) {
    super(
      'si_unavailable',
      `SI check unavailable (${reason}${status ? `, HTTP ${status}` : ''})${detail ? `: ${detail}` : ''}`,
      'Supreme Intelligence could not confirm your access right now. Try again in a moment.'
    );
    this.reason = reason;
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The membership key is missing, rejected (`401`) or not linked to an app (`500 misconfigured_key`). */
export class MisconfiguredKeyError extends SiServerError {
  readonly status?: number;

  constructor(detail: string, status?: number) {
    super(
      'misconfigured_key',
      `SI membership key misconfigured: ${detail}`,
      "This app's connection to Supreme Intelligence is misconfigured. Contact your administrator."
    );
    this.status = status;
  }
}

/** SI answered `403 app_inactive`: the app is switched off on the SI side. */
export class AppInactiveError extends SiServerError {
  constructor() {
    super('app_inactive', 'The SI app linked to this membership key is inactive', 'This app is currently disabled in Supreme Intelligence.');
  }
}

/** The lock store failed while a conversation key was present. Fails closed. */
export class LockStoreUnavailableError extends SiServerError {
  constructor(detail: string) {
    super(
      'lock_store_unavailable',
      `Conversation lock store unavailable: ${detail}`,
      'This app could not check which organization this conversation is working in. Try again in a moment.'
    );
  }
}

/** A caller passed an unusable argument (bad user id, empty organization, ...). */
export class InvalidArgumentError extends SiServerError {
  constructor(detail: string) {
    super('invalid_argument', detail, detail);
  }
}

export type InvalidTokenReason =
  /** No bearer token on the request. */
  | 'missing'
  /** SI answered `{"active": false}`. */
  | 'inactive'
  /** SI said active, but `aud` isn't this app's resource. */
  | 'audience_mismatch'
  /** `exp` is in the past by the local clock. */
  | 'expired';

/**
 * The bearer token can't be used here. Answer the MCP client `401` with
 * `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="…"`
 * (`si.auth.challenge(err)` builds it).
 */
export class InvalidTokenError extends SiServerError {
  readonly reason: InvalidTokenReason;

  constructor(reason: InvalidTokenReason) {
    super(
      'invalid_token',
      `Access token rejected (${reason})`,
      reason === 'missing' ? 'This request needs a Supreme Intelligence access token.' : 'The access token is invalid or expired. Reconnect this app.'
    );
    this.reason = reason;
  }
}

/**
 * The token is valid but lacks a scope the operation needs. Answer `403`
 * with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"`,
 * listing **every** scope the operation needs so the client can step up.
 */
export class InsufficientScopeError extends SiServerError {
  /** Every scope the operation needs (what goes in the challenge's `scope`). */
  readonly requiredScopes: string[];
  /** The required scopes the token doesn't have. */
  readonly missingScopes: string[];

  constructor(requiredScopes: string[], missingScopes: string[]) {
    super(
      'insufficient_scope',
      `Token lacks required scopes: ${missingScopes.join(' ')}`,
      `This action needs more access than you granted this app (${missingScopes.join(', ')}). Reconnect and allow it.`
    );
    this.requiredScopes = [...requiredScopes];
    this.missingScopes = [...missingScopes];
  }
}

/** SI answered `422 validation_failed`: the SDK sent a request SI rejects. Always a deny. */
export class SiValidationError extends SiServerError {
  readonly errors: Record<string, unknown>;

  constructor(errors: Record<string, unknown> = {}) {
    super('validation_failed', `SI rejected the request (422 validation_failed): ${JSON.stringify(errors)}`, 'The request to Supreme Intelligence was rejected. Contact your administrator.');
    this.errors = errors;
  }
}

export function isSiServerError(err: unknown): err is SiServerError {
  return err instanceof SiServerError;
}
