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
  | 'invalid_argument';

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

  constructor(reason: SiUnavailableReason, detail?: string, status?: number) {
    super(
      'si_unavailable',
      `SI membership check unavailable (${reason}${status ? `, HTTP ${status}` : ''})${detail ? `: ${detail}` : ''}`,
      'Supreme Intelligence could not confirm your access right now. Try again in a moment.'
    );
    this.reason = reason;
    this.status = status;
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

export function isSiServerError(err: unknown): err is SiServerError {
  return err instanceof SiServerError;
}
