import type { HttpClient } from './http';
import type { AuditEvent, AuditForwardingConfig, Logger } from './types';

export const AUDIT_EVENTS_PATH = '/api/membership/audit-events';

export interface AuditApi {
  /** Run the `onAudit` hook and queue the event for SI if forwarding is on. Never throws. */
  emit(event: AuditEvent): void;
  /**
   * Send queued events now. Never rejects. On edge runtimes, pass it to
   * `waitUntil` so the batch isn't lost when the isolate freezes.
   */
  flush(): Promise<void>;
  /** Whether forwarding to SI is enabled. */
  readonly forwarding: boolean;
}

export interface AuditDeps {
  http: HttpClient;
  logger: Logger;
  onAudit?: (event: AuditEvent) => void | Promise<void>;
  forwarding?: AuditForwardingConfig;
}

/** Wire format for `POST /api/membership/audit-events`. */
export function toWireEvent(e: AuditEvent) {
  return {
    principal_id: e.principalId,
    client_id: e.clientId,
    mode: e.mode,
    key_hash: e.keyHash,
    organization_id: e.organizationId,
    tool: e.tool,
    kind: e.kind,
    outcome: e.outcome,
    occurred_at: e.occurredAt,
  };
}

export function createAudit(deps: AuditDeps): AuditApi {
  const cfg = deps.forwarding ?? {};
  const enabled = cfg.enabled === true;
  const batchSize = Math.max(1, Math.min(500, Math.floor(cfg.batchSize ?? 50)));
  const flushIntervalMs = Math.max(0, cfg.flushIntervalMs ?? 5000);

  const queue: AuditEvent[] = [];
  let timer: unknown = null;

  const send = async (batch: AuditEvent[]): Promise<void> => {
    try {
      const result = await deps.http({
        method: 'POST',
        path: AUDIT_EVENTS_PATH,
        body: { events: batch.map(toWireEvent) },
        retry: false,
      });
      if (result.status !== 202 && result.status !== 200) {
        deps.logger.warn(`[si-sdk/server] audit forwarding: SI answered ${result.status}; dropped ${batch.length} events`);
      }
    } catch (err) {
      deps.logger.warn(`[si-sdk/server] audit forwarding failed; dropped ${batch.length} events`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const sends: Promise<void>[] = [];
    while (queue.length > 0) sends.push(send(queue.splice(0, batchSize)));
    await Promise.all(sends);
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushIntervalMs);
    // Don't keep a Node process alive just for audit.
    (timer as { unref?: () => void } | null)?.unref?.();
  };

  return {
    forwarding: enabled,
    emit(event) {
      if (deps.onAudit) {
        try {
          const r = deps.onAudit(event);
          if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
        } catch {
          // hooks never break a tool call
        }
      }
      if (!enabled) return;
      try {
        // flush() drains synchronously, so the queue never exceeds batchSize.
        queue.push(event);
        if (queue.length >= batchSize) void flush();
        else schedule();
      } catch {
        // never throw into the caller
      }
    },
    flush,
  };
}
