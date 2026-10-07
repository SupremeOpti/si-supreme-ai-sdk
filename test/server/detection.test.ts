import { describe, expect, it } from '@jest/globals';
import { memoryCache } from '../../src/server';
import { createDetection } from '../../src/server/detection';
import { clock } from './helpers';

const A = { id: 2, slug: 'kadiko', name: 'Kadiko' };
const B = { id: 29, slug: 'supreme-group', name: 'Supreme Group' };

function setup(windowSeconds = 900, enabled = true) {
  const c = clock();
  const d = createDetection({ cache: memoryCache({ now: c.now }), now: c.now, windowSeconds, enabled });
  return { d, c };
}

describe('detection', () => {
  it('warns on a write to B after a read of A within the window', async () => {
    const { d, c } = setup();
    await d.recordRead('u', 'claude', A);
    c.advance(4 * 60);
    const w = await d.checkWrite('u', 'claude', B);
    expect(w).toBe(
      'Warning: this connection read Kadiko (kadiko) 4 min ago. Confirm nothing from Kadiko is in this write to Supreme Group (supreme-group).'
    );
  });

  it('says "less than a minute ago" for fresh reads', async () => {
    const { d } = setup();
    await d.recordRead('u', 'claude', A);
    expect(await d.checkWrite('u', 'claude', B)).toContain('less than a minute ago');
  });

  it('no warning outside the window', async () => {
    const { d, c } = setup();
    await d.recordRead('u', 'claude', A);
    c.advance(15 * 60 + 1);
    expect(await d.checkWrite('u', 'claude', B)).toBeNull();
  });

  it('no warning for the same org', async () => {
    const { d } = setup();
    await d.recordRead('u', 'claude', A);
    expect(await d.checkWrite('u', 'claude', A)).toBeNull();
  });

  it('is scoped per principal and client', async () => {
    const { d } = setup();
    await d.recordRead('u', 'claude', A);
    expect(await d.checkWrite('u', 'chatgpt', B)).toBeNull();
    expect(await d.checkWrite('v', 'claude', B)).toBeNull();
  });

  it('reports the most recent other-org read', async () => {
    const { d, c } = setup();
    await d.recordRead('u', 'claude', { id: 7, slug: 'acme', name: 'Acme' });
    c.advance(60);
    await d.recordRead('u', 'claude', A);
    c.advance(120);
    expect(await d.checkWrite('u', 'claude', B)).toContain('Kadiko (kadiko) 2 min ago');
  });

  it('never throws when the cache fails', async () => {
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      delete: async () => undefined,
    };
    const d = createDetection({ cache: broken, now: Date.now, windowSeconds: 900, enabled: true });
    await expect(d.recordRead('u', 'c', A)).resolves.toBeUndefined();
    await expect(d.checkWrite('u', 'c', B)).resolves.toBeNull();
  });

  it('ignores corrupt cache contents', async () => {
    const cache = { get: async () => [{ id: 'x' }, null, 5], set: async () => undefined, delete: async () => undefined };
    const d = createDetection({ cache, now: Date.now, windowSeconds: 900, enabled: true });
    await expect(d.checkWrite('u', 'c', B)).resolves.toBeNull();
  });

  it('does nothing when disabled', async () => {
    const { d } = setup(900, false);
    await d.recordRead('u', 'claude', A);
    expect(await d.checkWrite('u', 'claude', B)).toBeNull();
  });
});
