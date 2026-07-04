/**
 * ParentIntegrator - Helper for parent pages to integrate with iframe credit system
 */

import type { User, AuthTokens } from '../types';
import { tokenHasRemainingLife } from '../utils/jwt';

export interface ParentConfig {
  getJWTToken: () => Promise<{
    token: string;
    refreshToken: string;
    user: User;
  } | null>;
  getCurrentUserState?: () => Promise<{
    orgId: string;
    orgName: string;
    orgSlug?: string;
    orgDomain?: string;
    driveFolderId?: string | null;
    orgLogoUrl?: string | null;
    orgIcon?: string | null;
    userRole: string;
    userId: string;
    userRoleIds?: number[];
    isSuperAdmin?: boolean;
    profileImage?: string | null;
    personas?: any[];
  } | null>;
  allowedOrigins?: string[];
  debug?: boolean;
  onIframeReady?: () => void;
  onBalanceUpdate?: (balance: number) => void;
  onCreditsSpent?: (amount: number, newBalance: number) => void;
  onCreditsAdded?: (amount: number, newBalance: number) => void;
  onLogout?: () => void;
  onError?: (error: string) => void;
}

// Token reuse policy for handleTokenRequest. Without it, every
// REQUEST_JWT_TOKEN from the child triggered a fresh getJWTToken() call
// (typically a server-side mint) — a child re-requesting on a timer turned
// each open tab into a steady stream of mints. A token fetched less than
// TOKEN_REUSE_MS ago is always answered from cache; in a hidden tab any
// token whose exp claim is more than TOKEN_EXPIRY_BUFFER_MS away is reused.
// The child is never denied a token — a stale cache still fetches live.
const TOKEN_REUSE_MS = 60000;
const TOKEN_EXPIRY_BUFFER_MS = 120000;
const FETCH_FAILURE_BACKOFF_MS = 5000;

export class ParentIntegrator {
  private config: ParentConfig;
  private iframe: HTMLIFrameElement | null = null;
  private messageHandler?: (event: MessageEvent) => void;
  private cachedToken?: { token: string; refreshToken: string; user: User };
  private tokenFetchedAt = 0;
  private tokenFetchPromise?: Promise<{ token: string; refreshToken: string; user: User } | null>;
  private lastFetchFailedAt = 0;

  constructor(config: ParentConfig) {
    this.config = config;
    this.setupMessageListener();
  }

  /**
   * Attach to an iframe element
   */
  attachToIframe(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;

    // Listen for iframe load event
    iframe.addEventListener('load', () => {
      if (this.config.debug) {
        console.log('[ParentIntegrator] Iframe loaded');
      }
    });
  }

  /**
   * Set up message listener for iframe communication
   */
  private setupMessageListener(): void {
    this.messageHandler = async (event: MessageEvent) => {
      // Validate origin
      if (!this.isValidOrigin(event.origin)) {
        if (this.config.debug) {
          console.warn('[ParentIntegrator] Invalid origin:', event.origin);
        }
        return;
      }

      if (!event.data || !event.data.type) return;

      if (this.config.debug) {
        console.log('[ParentIntegrator] Received message:', event.data.type, event.data);
      }

      // Handle different message types
      switch (event.data.type) {
        case 'REQUEST_JWT_TOKEN':
          await this.handleTokenRequest();
          break;

        case 'REQUEST_CURRENT_USER_STATE':
          await this.handleUserStateRequest();
          break;

        case 'CREDIT_SYSTEM_READY':
          this.handleIframeReady(event.data);
          break;

        case 'BALANCE_UPDATE':
          this.handleBalanceUpdate(event.data);
          break;

        case 'CREDITS_SPENT':
          this.handleCreditsSpent(event.data);
          break;

        case 'CREDITS_ADDED':
          this.handleCreditsAdded(event.data);
          break;

        case 'JWT_TOKEN_REFRESHED':
          this.handleTokenRefreshed(event.data);
          break;

        case 'LOGOUT':
          this.handleLogout();
          break;

        case 'ERROR':
          this.handleError(event.data);
          break;

        case 'STATUS_RESPONSE':
          this.handleStatusResponse(event.data);
          break;

        default:
          if (this.config.debug) {
            console.log('[ParentIntegrator] Unhandled message type:', event.data.type);
          }
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  /**
   * Handle JWT token request from iframe
   */
  private async handleTokenRequest(): Promise<void> {
    if (this.config.debug) {
      console.log('[ParentIntegrator] Iframe requesting JWT token');
    }

    // Serve from cache when the last mint is still fresh (or, in a hidden
    // tab, whenever the cached token has comfortable life left).
    if (this.hasReusableToken()) {
      if (this.config.debug) {
        console.log('[ParentIntegrator] Serving JWT token from cache');
      }
      this.sendTokenResponse(this.cachedToken!);
      return;
    }

    // Back off after a failed fetch so a child retry loop can't hammer
    // the token endpoint; the child gets the same error it just got.
    if (this.lastFetchFailedAt && Date.now() - this.lastFetchFailedAt < FETCH_FAILURE_BACKOFF_MS) {
      if (this.config.debug) {
        console.log('[ParentIntegrator] Token fetch in failure backoff, not retrying yet');
      }
      this.sendToIframe('JWT_TOKEN_RESPONSE', {
        token: null,
        error: 'Token fetch temporarily unavailable',
        timestamp: Date.now()
      });
      return;
    }

    try {
      // Get JWT token from parent implementation. Concurrent requests
      // (several REQUEST_JWT_TOKEN messages during iframe boot) collapse
      // into a single getJWTToken() call.
      if (!this.tokenFetchPromise) {
        this.tokenFetchPromise = this.config.getJWTToken().finally(() => {
          this.tokenFetchPromise = undefined;
        });
      }
      const tokenData = await this.tokenFetchPromise;

      if (tokenData) {
        this.cachedToken = tokenData;
        this.tokenFetchedAt = Date.now();
        this.lastFetchFailedAt = 0;

        this.sendTokenResponse(tokenData);

        if (this.config.debug) {
          console.log('[ParentIntegrator] JWT token sent to iframe');
        }
      } else {
        // Send failure response
        this.lastFetchFailedAt = Date.now();
        this.sendToIframe('JWT_TOKEN_RESPONSE', {
          token: null,
          error: 'Authentication required',
          timestamp: Date.now()
        });

        if (this.config.debug) {
          console.log('[ParentIntegrator] No JWT token available');
        }
      }
    } catch (error: any) {
      if (this.config.debug) {
        console.error('[ParentIntegrator] Error getting JWT token:', error);
      }

      this.lastFetchFailedAt = Date.now();
      this.sendToIframe('JWT_TOKEN_RESPONSE', {
        token: null,
        error: error.message || 'Failed to get token',
        timestamp: Date.now()
      });
    }
  }

  private sendTokenResponse(tokenData: { token: string; refreshToken: string; user: User }): void {
    this.sendToIframe('JWT_TOKEN_RESPONSE', {
      token: tokenData.token,
      refreshToken: tokenData.refreshToken,
      user: tokenData.user,
      isSuperAdmin: tokenData.user?.is_superadmin ?? false,
      timestamp: Date.now()
    });
  }

  private hasReusableToken(): boolean {
    if (!this.cachedToken || !this.tokenFetchedAt) {
      return false;
    }

    if (Date.now() - this.tokenFetchedAt < TOKEN_REUSE_MS) {
      return true;
    }

    // Hidden tab: any token that hasn't neared expiry is good enough —
    // no one is interacting, so a freshly minted window buys nothing.
    return (
      typeof document !== 'undefined' &&
      document.hidden &&
      tokenHasRemainingLife(this.cachedToken.token, TOKEN_EXPIRY_BUFFER_MS / 1000)
    );
  }

  /**
   * Handle user state request from iframe
   */
  private async handleUserStateRequest(): Promise<void> {
    if (this.config.debug) {
      console.log('[ParentIntegrator] Iframe requesting current user state');
    }

    try {
      // Get user state from parent implementation (if provided)
      if (this.config.getCurrentUserState) {
        const userState = await this.config.getCurrentUserState();

        if (userState) {
          // Send user state to iframe
          this.sendToIframe('RESPONSE_CURRENT_USER_STATE', {
            userState: userState,
            timestamp: Date.now()
          });

          if (this.config.debug) {
            console.log('[ParentIntegrator] User state sent to iframe:', userState);
          }
        } else {
          // Send failure response
          this.sendToIframe('RESPONSE_CURRENT_USER_STATE', {
            userState: null,
            error: 'User state not available',
            timestamp: Date.now()
          });

          if (this.config.debug) {
            console.log('[ParentIntegrator] No user state available');
          }
        }
      } else {
        // getCurrentUserState callback not configured
        this.sendToIframe('RESPONSE_CURRENT_USER_STATE', {
          userState: null,
          error: 'getCurrentUserState callback not configured',
          timestamp: Date.now()
        });

        if (this.config.debug) {
          console.log('[ParentIntegrator] getCurrentUserState callback not configured in ParentConfig');
        }
      }
    } catch (error: any) {
      if (this.config.debug) {
        console.error('[ParentIntegrator] Error getting user state:', error);
      }

      this.sendToIframe('RESPONSE_CURRENT_USER_STATE', {
        userState: null,
        error: error.message || 'Failed to get user state',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle iframe ready event
   */
  private handleIframeReady(data: any): void {
    if (this.config.debug) {
      console.log('[ParentIntegrator] Credit system ready:', data);
    }

    if (this.config.onIframeReady) {
      this.config.onIframeReady();
    }
  }

  /**
   * Handle balance update
   */
  private handleBalanceUpdate(data: any): void {
    if (this.config.onBalanceUpdate) {
      this.config.onBalanceUpdate(data.balance);
    }
  }

  /**
   * Handle credits spent
   */
  private handleCreditsSpent(data: any): void {
    if (this.config.onCreditsSpent) {
      this.config.onCreditsSpent(data.amount, data.newBalance);
    }
  }

  /**
   * Handle credits added
   */
  private handleCreditsAdded(data: any): void {
    if (this.config.onCreditsAdded) {
      this.config.onCreditsAdded(data.amount, data.newBalance);
    }
  }

  /**
   * Handle token refreshed
   */
  private handleTokenRefreshed(data: any): void {
    if (data.token && this.cachedToken) {
      this.cachedToken.token = data.token;
    }
  }

  /**
   * Handle logout
   */
  private handleLogout(): void {
    this.cachedToken = undefined;
    this.tokenFetchedAt = 0;

    if (this.config.onLogout) {
      this.config.onLogout();
    }
  }

  /**
   * Handle error
   */
  private handleError(data: any): void {
    if (this.config.onError) {
      this.config.onError(data.message || 'Unknown error');
    }
  }

  /**
   * Handle status response
   */
  private handleStatusResponse(data: any): void {
    if (this.config.debug) {
      console.log('[ParentIntegrator] Status:', data);
    }
  }

  /**
   * Send message to iframe
   */
  sendToIframe(type: string, data: Record<string, any> = {}): boolean {
    if (!this.iframe || !this.iframe.contentWindow) {
      if (this.config.debug) {
        console.warn('[ParentIntegrator] Iframe not ready');
      }
      return false;
    }

    const message = {
      type,
      ...data,
      timestamp: Date.now()
    };

    if (this.config.debug) {
      console.log('[ParentIntegrator] Sending to iframe:', message);
    }

    this.iframe.contentWindow.postMessage(message, '*');
    return true;
  }

  /**
   * Validate message origin
   */
  private isValidOrigin(origin: string): boolean {
    // Always allow same origin
    if (origin === window.location.origin) {
      return true;
    }

    // Check against allowed origins if configured
    if (this.config.allowedOrigins && this.config.allowedOrigins.length > 0) {
      return this.config.allowedOrigins.includes(origin);
    }

    // Default to allowing all origins (use with caution)
    return true;
  }

  /**
   * Request balance refresh from iframe
   */
  refreshBalance(): void {
    this.sendToIframe('REFRESH_BALANCE');
  }

  /**
   * Request status from iframe
   */
  getStatus(): void {
    this.sendToIframe('GET_STATUS');
  }

  /**
   * Clear iframe storage
   */
  clearStorage(): void {
    this.sendToIframe('CLEAR_STORAGE');
  }

  /**
   * Send custom message to iframe
   */
  sendCustomMessage(message: string, data?: any): void {
    this.sendToIframe('CUSTOM_MESSAGE', { message, ...data });
  }

  /**
   * Destroy the integrator
   */
  destroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }
    this.iframe = null;
    this.cachedToken = undefined;
    this.tokenFetchedAt = 0;
  }
}