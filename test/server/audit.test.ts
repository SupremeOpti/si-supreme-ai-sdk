import { describe, expect, it } from '@jest/globals';
import { AUDIT_EVENTS_PATH, createSiServerClient, memoryLockStore, type AuditEvent, type SiServerConfig } from '../../src/server';
import { fakeFetch, ok, silentLogger, type Reply } from './helpers';

const event = (i = 0): AuditEvent => ({
  principalId: '456',
  clientId: 'chatgpt',
  mode: 'locked',
  keyHash: 'a'.repeat(64),
  organizationId: 2,
  tool: `tool_${i}`,
  kind: 'write',
  outcome: 'allowed',
  occurredAt: '2026-10-05T12:00:00.000Z',
});

function setup(replies: Reply[], extra: Partial<SiServerConfig> = {}) {
  const fetch = fakeFetch(...replies);
  const logger = silentLogger();
  const si = createSiServerClient({ baseUrl: 'https://si.example.com', membershipKey: 'si-key', fetch, logger, locks: memoryLockStore(), ...extra });
  return { si, fetch, logger };
}

const auditCalls = (fetch: ReturnType<typeof fakeFetch>) => fetch.calls.filter((c) => c.url.endsWith(AUDIT_EVENTS_PATH));

describe('audit forwarding', () => {
  it('is off by default: scopeToolCall never calls the audit endpoint', async () => {
    const { si, fetch } = setup([ok()]);
    expect(si.audit.forwarding).toBe(false);
    await si.mcp.scopeToolCall({ userId: 456, clientId: 'c', conversationKey: 'k', organization: 'kadiko', tool: 't', kind: 'write' });
    si.audit.emit(event());
    await si.audit.flush();
    expect(auditCalls(fetch)).toHaveLength(0);
  });

  it('when enabled, posts batched snake_case events with the membership key', async () => {
    const { si, fetch } = setup([{ status: 202 }], { auditForwarding: { enabled: true, flushIntervalMs: 60000 } });
    si.audit.emit(event(1));
    si.audit.emit(event(2));
    await si.audit.flush();
    const calls = auditCalls(fetch);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://si.example.com/api/membership/audit-events');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer si-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(calls[0].init.body!)).toEqual({
      events: [1, 2].map((i) => ({
        principal_id: '456',
        client_id: 'chatgpt',
        mode: 'locked',
        key_hash: 'a'.repeat(64),
        organization_id: 2,
        tool: `tool_${i}`,
        kind: 'write',
        outcome: 'allowed',
        occurred_at: '2026-10-05T12:00:00.000Z',
      })),
    });
  });

  it('flushes automatically at batch size, and splits large queues', async () => {
    const { si, fetch } = setup([{ status: 202 }], { auditForwarding: { enabled: true, batchSize: 2, flushIntervalMs: 60000 } });
    si.audit.emit(event(1));
    expect(auditCalls(fetch)).toHaveLength(0);
    si.audit.emit(event(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(auditCalls(fetch)).toHaveLength(1);
  });

  it('flushes on the timer', async () => {
    const { si, fetch } = setup([{ status: 202 }], { auditForwarding: { enabled: true, flushIntervalMs: 10 } });
    si.audit.emit(event());
    await new Promise((r) => setTimeout(r, 50));
    expect(auditCalls(fetch)).toHaveLength(1);
  });

  it('never throws or rejects when SI is down, and does not retry', async () => {
    const { si, fetch, logger } = setup([new Error('ECONNREFUSED')], { auditForwarding: { enabled: true, flushIntervalMs: 60000 } });
    expect(() => si.audit.emit(event())).not.toThrow();
    await expect(si.audit.flush()).resolves.toBeUndefined();
    expect(auditCalls(fetch)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs and drops on a non-2xx answer (endpoint not live yet)', async () => {
    const { si, logger } = setup([{ status: 404 }], { auditForwarding: { enabled: true, flushIntervalMs: 60000 } });
    si.audit.emit(event());
    await expect(si.audit.flush()).resolves.toBeUndefined();
    expect(String(logger.warn.mock.calls.at(-1)![0])).toContain('404');
  });

  it('a rejecting onAudit hook never surfaces', async () => {
    const { si } = setup([ok()], { onAudit: () => Promise.reject(new Error('hook down')) });
    expect(() => si.audit.emit(event())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
