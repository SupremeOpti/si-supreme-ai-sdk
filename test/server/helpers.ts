import { jest } from '@jest/globals';
import type { FetchInit, FetchResponse } from '../../src/server/runtime';

export interface Call {
  url: string;
  init: FetchInit;
}

export type Reply = { status: number; body?: unknown; raw?: string; headers?: Record<string, string> } | Error | 'hang';

export function response(r: Exclude<Reply, Error | 'hang'>): FetchResponse {
  const headers = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const text = r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body));
  return {
    status: r.status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => text,
  };
}

/** Fake fetch answering from a queue (last reply repeats). */
export function fakeFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = jest.fn(async (url: string, init: FetchInit = {}): Promise<FetchResponse> => {
    calls.push({ url, init });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    if (r === 'hang') {
      return new Promise((_, reject) => {
        const timer = setInterval(() => {
          if (init.signal?.aborted) {
            clearInterval(timer);
            reject(new Error('aborted'));
          }
        }, 5);
      });
    }
    return response(r);
  });
  return Object.assign(fn, { calls });
}

export const ORGS = [
  { id: 2, slug: 'kadiko', name: 'Kadiko', roles: ['client'], app_grant: 'organization' },
  { id: 29, slug: 'supreme-group', name: 'Supreme Group', roles: ['orgadmin'], app_grant: 'role' },
];

export function membershipBody(userId = 456, organizations: unknown[] = ORGS) {
  return {
    data: {
      user: { id: userId },
      app: { id: 12, name: 'Studio Canvas' },
      is_superadmin: false,
      organizations,
    },
    meta: { count: organizations.length, generated_at: '2026-10-02T15:04:05Z' },
  };
}

export const ok = (userId = 456, orgs: unknown[] = ORGS): Reply => ({ status: 200, body: membershipBody(userId, orgs) });

export function clock(start = Date.UTC(2026, 9, 5, 12, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    advance: (seconds: number) => {
      t += seconds * 1000;
    },
  };
}

export const silentLogger = () => {
  const warn = jest.fn();
  return { warn, error: jest.fn() };
};
