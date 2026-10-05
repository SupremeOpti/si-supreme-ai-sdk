import type { AuditApi } from './audit';
import { conversationKey, hashConversationKey, type ConversationKeySource } from './conversation';
import type { DetectionApi } from './detection';
import { InvalidArgumentError, isSiServerError, OrgLockedError, type SiServerErrorCode } from './errors';
import type { LocksApi } from './locks';
import type { MembershipApi } from './membership';
import type { OrganizationsApi } from './organizations';
import type { AppGrant, ConversationKeyOptions, Logger, ScopeMode, ToolKind } from './types';

/** Minimal MCP `CallToolResult` shape. Extra fields pass through untouched. */
export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/**
 * Annotation presets. Correct hints make clients auto-run reads and put a
 * human in front of writes.
 */
export const annotations: Readonly<{ read: McpToolAnnotations; write: McpToolAnnotations; destructive: McpToolAnnotations }> =
  Object.freeze({
    read: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
    write: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }),
    destructive: Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }),
  });

export interface ScopeToolCallInput {
  /** SI user id (the Supreme JWT `sub` captured at consent). */
  userId: number | string;
  /** The app's principal id for lock/detection/audit keys. Default `String(userId)`. */
  principalId?: string;
  /** OAuth client id or MCP client name: separates ChatGPT from Claude for the same user. */
  clientId: string;
  /** From `si.mcp.conversationKey(...)`. `null` → soft mode. */
  conversationKey: string | null;
  /** The tool's `organization` argument: slug (preferred) or numeric id. */
  organization: string | number;
  /** Tool name, for audit. */
  tool: string;
  kind: ToolKind;
}

export interface ToolScope {
  organization: { id: number; slug: string; name: string };
  roles: string[];
  appGrant: AppGrant;
  mode: ScopeMode;
  /** SHA-256 hex of the conversation key, or null in soft mode. */
  keyHash: string | null;
  /** Cross-org detection warning for writes, else null. */
  warning: string | null;
  userId: string;
  principalId: string;
  clientId: string;
  tool: string;
  kind: ToolKind;
}

export interface ListOrganizationsTool {
  definition: {
    name: 'list_organizations';
    title: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, never>; additionalProperties: false };
    annotations: McpToolAnnotations;
  };
  /** Lists the user's orgs for this app, same shape as SI's `list_organizations`. */
  handler(input: { userId: number | string }): Promise<McpToolResult>;
}

export interface McpApi {
  conversationKey(source: ConversationKeySource | null | undefined): string | null;
  scopeToolCall(input: ScopeToolCallInput): Promise<ToolScope>;
  labelResult(result: McpToolResult, scope: Pick<ToolScope, 'organization' | 'warning'>): McpToolResult;
  errorResult(err: unknown): McpToolResult;
  listOrganizationsTool(): ListOrganizationsTool;
  readonly annotations: typeof annotations;
}

export interface McpDeps {
  membership: MembershipApi;
  organizations: OrganizationsApi;
  locks: LocksApi;
  detection: DetectionApi;
  audit: AuditApi;
  logger: Logger;
  now: () => number;
  conversation?: ConversationKeyOptions;
}

/** First line of every org-scoped result, e.g. `[Org: Kadiko (kadiko)]`. */
export function orgBanner(org: { slug: string; name: string }): string {
  return `[Org: ${org.name} (${org.slug})]`;
}

/**
 * Label a tool result with its org: `structuredContent.organization` plus a
 * banner (and the detection warning, if any) as the first lines of the first
 * text block. Returns a new object; the input is not mutated.
 */
export function labelResult(result: McpToolResult, scope: Pick<ToolScope, 'organization' | 'warning'>): McpToolResult {
  const org = { id: scope.organization.id, slug: scope.organization.slug, name: scope.organization.name };
  const prefix = [orgBanner(org), ...(scope.warning ? [scope.warning] : [])].join('\n');
  const content = Array.isArray(result.content) ? result.content.map((b) => ({ ...b })) : [];
  const idx = content.findIndex((b) => b.type === 'text' && typeof b.text === 'string');
  if (idx >= 0) content[idx] = { ...content[idx], text: content[idx].text ? `${prefix}\n${content[idx].text}` : prefix };
  else content.unshift({ type: 'text', text: prefix });

  return {
    ...result,
    content,
    structuredContent: { ...(result.structuredContent ?? {}), organization: org },
  };
}

/**
 * Standard MCP error result. SDK errors keep their stable `code` and public
 * message; anything else becomes `internal_error` without leaking detail.
 */
export function errorResult(err: unknown): McpToolResult {
  const code: SiServerErrorCode | 'internal_error' = isSiServerError(err) ? err.code : 'internal_error';
  const message = isSiServerError(err) ? err.publicMessage : 'The tool failed unexpectedly. Try again in a moment.';
  const error: Record<string, unknown> = { code, message };
  if (err instanceof OrgLockedError) {
    error.locked_organization = err.lockedOrganization;
    error.requested_organization = err.requestedOrganization;
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `Error (${code}): ${message}` }],
    structuredContent: { error },
  };
}

export function createMcp(deps: McpDeps): McpApi {
  const scopeToolCall = async (input: ScopeToolCallInput): Promise<ToolScope> => {
    const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
    const tool = typeof input.tool === 'string' ? input.tool.trim() : '';
    const principalId = (input.principalId ?? String(input.userId)).trim();
    const kind: ToolKind = input.kind === 'read' ? 'read' : 'write';
    const key = typeof input.conversationKey === 'string' && input.conversationKey.trim() ? input.conversationKey.trim() : null;
    const mode: ScopeMode = key ? 'locked' : 'soft';

    let keyHash: string | null = null;
    let organizationId: number | null = null;
    const audit = (outcome: string) =>
      deps.audit.emit({
        principalId: principalId || String(input.userId),
        clientId,
        mode,
        keyHash,
        organizationId,
        tool: tool || 'unknown',
        kind,
        outcome,
        occurredAt: new Date(deps.now()).toISOString(),
      });

    try {
      if (!clientId) throw new InvalidArgumentError('clientId is required');
      if (!tool) throw new InvalidArgumentError('tool is required');
      if (!principalId) throw new InvalidArgumentError('principalId must not be empty');
      if (key) keyHash = await hashConversationKey(key);

      const org = await deps.organizations.resolve(input.userId, input.organization);
      organizationId = org.id;

      try {
        await deps.locks.bindOrg({ principalId, clientId, keyHash, organizationId: org.id });
      } catch (err) {
        if (err instanceof OrgLockedError) {
          // Name the locked org when the user can still see it, so the message is actionable.
          const lockedId = err.lockedOrganization.id;
          let locked: { id: number; slug?: string; name?: string } = { id: lockedId };
          try {
            const m = await deps.membership.get(input.userId);
            const o = m.organizations.find((x) => x.id === lockedId);
            if (o) locked = { id: o.id, slug: o.slug, name: o.name };
          } catch {
            // keep the bare id
          }
          throw new OrgLockedError(locked, { id: org.id, slug: org.slug, name: org.name });
        }
        throw err;
      }

      const label = { id: org.id, slug: org.slug, name: org.name };
      let warning: string | null = null;
      if (kind === 'read') await deps.detection.recordRead(principalId, clientId, label);
      else warning = await deps.detection.checkWrite(principalId, clientId, label);

      audit('allowed');
      return {
        organization: label,
        roles: [...org.roles],
        appGrant: org.appGrant,
        mode,
        keyHash,
        warning,
        userId: String(input.userId),
        principalId,
        clientId,
        tool,
        kind,
      };
    } catch (err) {
      audit(isSiServerError(err) ? err.code : 'internal_error');
      throw err;
    }
  };

  const listOrganizationsTool = (): ListOrganizationsTool => ({
    definition: {
      name: 'list_organizations',
      title: 'Organizations — List',
      description:
        'List the organizations (also called tenants, clients, or accounts) the user can use in this app, with each org\'s `organization_id`, `slug`, `name`, `roles` and `app_grant`. Call it first when you need to resolve which organization the user means, then pass the org `slug` as the `organization` argument of other tools.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: annotations.read,
    },
    async handler({ userId }) {
      try {
        const m = await deps.membership.get(userId);
        const payload = {
          data: m.organizations.map((o) => ({
            organization_id: o.id,
            slug: o.slug,
            name: o.name,
            roles: [...o.roles],
            app_grant: o.appGrant,
          })),
          meta: { count: m.organizations.length },
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
      } catch (err) {
        return errorResult(err);
      }
    },
  });

  return {
    conversationKey: (source) => conversationKey(source, deps.conversation),
    scopeToolCall,
    labelResult,
    errorResult,
    listOrganizationsTool,
    annotations,
  };
}
