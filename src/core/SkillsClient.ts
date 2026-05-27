/**
 * SkillsClient - Read-only access to platform-published SKILL.md docs.
 *
 * The server filters out private skills before responding. The SDK surface
 * intentionally has no creator/owner parameter — what the caller receives is
 * what they are allowed to see.
 *
 * `getSkills` returns lightweight summaries without `content`; the backend
 * only packages SKILL.md bodies when `getSkillById` is called for a specific
 * skill.
 */

import type {
  ListSkillsParams,
  SkillsResult,
  SkillResult,
  Skill,
  SkillSummary
} from '../types';

export interface SkillsClientConfig {
  apiBaseUrl: string;
  getAuthToken: () => string | null;
  getDefaultOrganizationId?: () => string | number | null | undefined;
  debug?: boolean;
}

export class SkillsClient {
  private apiBaseUrl: string;
  private getAuthToken: () => string | null;
  private getDefaultOrganizationId?: () => string | number | null | undefined;
  private debug: boolean;

  constructor(config: SkillsClientConfig) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, '');
    this.getAuthToken = config.getAuthToken;
    this.getDefaultOrganizationId = config.getDefaultOrganizationId;
    this.debug = config.debug || false;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[SkillsClient]', ...args);
    }
  }

  private buildHeaders(): HeadersInit | null {
    const token = this.getAuthToken();
    if (!token) {
      this.log('No authentication token available');
      return null;
    }
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  /**
   * List non-private skills the caller can see. Returns summaries only — no
   * SKILL.md `content`. Call `getSkillById` to fetch the packaged body for a
   * specific skill.
   */
  async listSkills(params: ListSkillsParams = {}): Promise<SkillsResult> {
    const headers = this.buildHeaders();
    if (!headers) {
      return { success: false, error: 'Authentication required' };
    }

    const query = new URLSearchParams();
    const orgId =
      params.organizationId ?? this.getDefaultOrganizationId?.();
    if (orgId !== undefined && orgId !== null && orgId !== '') {
      query.append('organization_id', String(orgId));
    }
    if (params.cursor) query.append('cursor', params.cursor);
    if (params.perPage) query.append('per_page', String(params.perPage));

    const qs = query.toString();
    const url = `${this.apiBaseUrl}/list${qs ? `?${qs}` : ''}`;

    try {
      this.log('GET', url);
      const response = await fetch(url, { method: 'GET', headers });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        this.log('HTTP error', response.status);
        return {
          success: false,
          error: data?.message || `HTTP ${response.status}`
        };
      }

      // Accept both `{ success, data: { skills, next_cursor } }` and a bare
      // shape `{ skills, next_cursor }` for forward compatibility.
      const payload = data?.data ?? data;
      const skills: SkillSummary[] = Array.isArray(payload?.skills)
        ? payload.skills
        : Array.isArray(payload)
        ? payload
        : [];
      const nextCursor: string | null =
        payload?.next_cursor ?? payload?.nextCursor ?? null;

      this.log(`Listed ${skills.length} skills (nextCursor: ${nextCursor ?? 'null'})`);
      return { success: true, skills, nextCursor };
    } catch (err: any) {
      this.log('Network error', err?.message);
      return { success: false, error: err?.message || 'Network error' };
    }
  }

  /**
   * Fetch a single skill including its packaged SKILL.md `content`. The
   * server returns 404 for skills the caller is not entitled to read
   * (including all private skills), so this method never leaks existence.
   */
  async getSkillById(id: number | string): Promise<SkillResult> {
    const headers = this.buildHeaders();
    if (!headers) {
      return { success: false, error: 'Authentication required' };
    }

    const url = `${this.apiBaseUrl}/${encodeURIComponent(String(id))}`;

    try {
      this.log('GET', url);
      const response = await fetch(url, { method: 'GET', headers });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        this.log('HTTP error', response.status);
        return {
          success: false,
          error: data?.message || `HTTP ${response.status}`
        };
      }

      const payload = data?.data ?? data;
      const skill: Skill | undefined = payload?.skill ?? payload;
      if (!skill || typeof skill !== 'object' || !('id' in skill)) {
        return { success: false, error: 'Unexpected response format' };
      }

      this.log(`Fetched skill: ${skill.title}`);
      return { success: true, skill };
    } catch (err: any) {
      this.log('Network error', err?.message);
      return { success: false, error: err?.message || 'Network error' };
    }
  }
}
