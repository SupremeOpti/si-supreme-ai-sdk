import type { CacheAdapter } from './adapters/types';

export const DEFAULT_DETECTION_WINDOW_SECONDS = 15 * 60;
const MAX_ENTRIES = 20;

export interface DetectionOrg {
  id: number;
  slug: string;
  name: string;
}

interface ReadEntry {
  id: number;
  slug: string;
  name: string;
  at: number;
}

export interface DetectionApi {
  /** Remember an org-scoped read. Never throws. */
  recordRead(principalId: string, clientId: string, org: DetectionOrg): Promise<void>;
  /**
   * Warning text when the same principal + client read another org within
   * the window, else null. Never throws, never blocks.
   */
  checkWrite(principalId: string, clientId: string, org: DetectionOrg): Promise<string | null>;
}

export interface DetectionDeps {
  cache: CacheAdapter;
  now: () => number;
  windowSeconds: number;
  enabled: boolean;
}

function isEntry(v: unknown): v is ReadEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'number' && typeof e.slug === 'string' && typeof e.name === 'string' && typeof e.at === 'number';
}

function ago(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'less than a minute ago';
  return min === 1 ? '1 min ago' : `${min} min ago`;
}

export function createDetection(deps: DetectionDeps): DetectionApi {
  const key = (p: string, c: string) => `si:d:${encodeURIComponent(p)}:${encodeURIComponent(c)}`;
  const windowMs = deps.windowSeconds * 1000;

  const load = async (k: string): Promise<ReadEntry[]> => {
    try {
      const v = await deps.cache.get(k);
      if (!Array.isArray(v)) return [];
      const cutoff = deps.now() - windowMs;
      return v.filter(isEntry).filter((e) => e.at > cutoff);
    } catch {
      return [];
    }
  };

  return {
    async recordRead(principalId, clientId, org) {
      if (!deps.enabled || deps.windowSeconds <= 0) return;
      try {
        const k = key(principalId, clientId);
        const entries = (await load(k)).filter((e) => e.id !== org.id);
        entries.unshift({ id: org.id, slug: org.slug, name: org.name, at: deps.now() });
        await deps.cache.set(k, entries.slice(0, MAX_ENTRIES), deps.windowSeconds);
      } catch {
        // best effort
      }
    },
    async checkWrite(principalId, clientId, org) {
      if (!deps.enabled || deps.windowSeconds <= 0) return null;
      try {
        const other = (await load(key(principalId, clientId)))
          .filter((e) => e.id !== org.id)
          .sort((a, b) => b.at - a.at)[0];
        if (!other) return null;
        return (
          `Warning: this connection read ${other.name} (${other.slug}) ${ago(deps.now() - other.at)}. ` +
          `Confirm nothing from ${other.name} is in this write to ${org.name} (${org.slug}).`
        );
      } catch {
        return null;
      }
    },
  };
}
