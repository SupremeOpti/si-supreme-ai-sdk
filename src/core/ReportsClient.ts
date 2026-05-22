/**
 * ReportsClient — JWT-authenticated REST client for `/api/reports/jwt/*`.
 *
 * Strict creator-only: the server gates every request on the authenticated
 * user (the JWT subject), so all reads/writes from this client are implicitly
 * scoped to "reports the current user created". The client does NOT accept a
 * creator/user ID — there is no way to operate on another user's reports via
 * this surface, by design.
 */

import type {
  CreateReportParams,
  ListReportsParams,
  ReportResult,
  ReportsResult,
  UpdateReportParams
} from '../types';

export interface ReportsClientConfig {
  /** Base URL for the reports API, e.g. `/api/reports/jwt`. Trailing slash is tolerated. */
  apiBaseUrl: string;
  getAuthToken: () => string | null;
  /** Resolver for the default organization_id when callers don't pass one explicitly. */
  getDefaultOrganizationId?: () => string | number | null | undefined;
  debug?: boolean;
}

interface RawResponse {
  ok: boolean;
  status: number;
  data: any;
}

export class ReportsClient {
  private apiBaseUrl: string;
  private getAuthToken: () => string | null;
  private getDefaultOrganizationId?: () => string | number | null | undefined;
  private debug: boolean;

  constructor(config: ReportsClientConfig) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
    this.getAuthToken = config.getAuthToken;
    this.getDefaultOrganizationId = config.getDefaultOrganizationId;
    this.debug = !!config.debug;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[ReportsClient]', ...args);
    }
  }

  private resolveOrgId(explicit?: string | number | null): string | undefined {
    if (explicit !== undefined && explicit !== null && explicit !== '') {
      return String(explicit);
    }
    const fallback = this.getDefaultOrganizationId?.();
    if (fallback !== undefined && fallback !== null && fallback !== '') {
      return String(fallback);
    }
    return undefined;
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: { params?: Record<string, string>; body?: any } = {}
  ): Promise<RawResponse> {
    const token = this.getAuthToken();
    if (!token) {
      return { ok: false, status: 401, data: { error: 'Authentication required' } };
    }

    let url = `${this.apiBaseUrl}${path}`;
    if (options.params && Object.keys(options.params).length > 0) {
      const qs = new URLSearchParams(options.params).toString();
      url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    };

    const init: RequestInit = { method, headers };

    if (options.body !== undefined && (method === 'POST' || method === 'PATCH')) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    this.log(`📡 ${method} ${url}`);

    try {
      const response = await fetch(url, init);
      let data: any = null;
      try {
        data = await response.json();
      } catch {
        // Non-JSON / empty body
      }
      this.log(`↩️  ${response.status} ${response.ok ? 'OK' : 'ERROR'}`);
      return { ok: response.ok, status: response.status, data };
    } catch (error: any) {
      this.log(`❌ Network error: ${error?.message || error}`);
      return {
        ok: false,
        status: 0,
        data: { error: error?.message || 'Network error' }
      };
    }
  }

  private errorFrom(raw: RawResponse, fallback: string): string {
    if (raw.data && typeof raw.data === 'object') {
      if (typeof raw.data.error === 'string') return raw.data.error;
      if (typeof raw.data.message === 'string') return raw.data.message;
    }
    if (raw.status) return `${fallback} (${raw.status})`;
    return fallback;
  }

  /**
   * List the authenticated user's reports. Cursor-paginated.
   */
  async listReports(params: ListReportsParams = {}): Promise<ReportsResult> {
    const orgId = this.resolveOrgId(params.organizationId);
    const query: Record<string, string> = {};
    if (orgId) query.organization_id = orgId;
    if (params.folderId !== undefined && params.folderId !== null && params.folderId !== '') {
      query.folder_id = String(params.folderId);
    }
    if (params.cursor) query.cursor = params.cursor;
    if (params.perPage !== undefined && params.perPage !== null) {
      query.per_page = String(params.perPage);
    }

    const raw = await this.request('GET', '', { params: query });

    if (raw.ok && raw.data?.success) {
      return {
        success: true,
        reports: Array.isArray(raw.data.reports) ? raw.data.reports : [],
        nextCursor: raw.data.next_cursor ?? null
      };
    }

    return {
      success: false,
      error: this.errorFrom(raw, 'Failed to list reports'),
      reports: []
    };
  }

  /**
   * Fetch a single report (including its HTML body).
   */
  async getReport(
    id: number | string,
    options: { organizationId?: string | number } = {}
  ): Promise<ReportResult> {
    const orgId = this.resolveOrgId(options.organizationId);
    const query: Record<string, string> = {};
    if (orgId) query.organization_id = orgId;

    const raw = await this.request('GET', `/${encodeURIComponent(String(id))}`, { params: query });

    if (raw.ok && raw.data?.success && raw.data.report) {
      return { success: true, report: raw.data.report };
    }

    return {
      success: false,
      error: this.errorFrom(raw, 'Failed to fetch report'),
      validationErrors: raw.data?.errors
    };
  }

  /**
   * Create a report owned by the authenticated user.
   */
  async createReport(params: CreateReportParams): Promise<ReportResult> {
    const orgId = this.resolveOrgId(params.organizationId);

    const body: Record<string, any> = {
      title: params.title,
      body: params.body,
      visibility: params.visibility
    };
    if (orgId !== undefined) body.organization_id = Number(orgId) || orgId;
    if (params.folderId !== undefined && params.folderId !== null) body.folder_id = params.folderId;
    if (params.pinned !== undefined) body.pinned = params.pinned;
    if (params.includeBody !== undefined) body.include_body = params.includeBody;

    const raw = await this.request('POST', '', { body });

    if (raw.ok && raw.data?.success && raw.data.report) {
      return { success: true, report: raw.data.report };
    }

    return {
      success: false,
      error: this.errorFrom(raw, 'Failed to create report'),
      validationErrors: raw.data?.errors
    };
  }

  /**
   * Partially update a report. Only the authenticated user's own reports can
   * be updated (server-enforced); other reports return 403.
   */
  async updateReport(id: number | string, params: UpdateReportParams): Promise<ReportResult> {
    const orgId = this.resolveOrgId(params.organizationId);

    const body: Record<string, any> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.body !== undefined) body.body = params.body;
    if (params.visibility !== undefined) body.visibility = params.visibility;
    if (params.folderId !== undefined) body.folder_id = params.folderId;
    if (params.pinned !== undefined) body.pinned = params.pinned;
    if (params.includeBody !== undefined) body.include_body = params.includeBody;
    if (orgId !== undefined) body.organization_id = Number(orgId) || orgId;

    const raw = await this.request('PATCH', `/${encodeURIComponent(String(id))}`, { body });

    if (raw.ok && raw.data?.success && raw.data.report) {
      return { success: true, report: raw.data.report };
    }

    return {
      success: false,
      error: this.errorFrom(raw, 'Failed to update report'),
      validationErrors: raw.data?.errors
    };
  }
}
