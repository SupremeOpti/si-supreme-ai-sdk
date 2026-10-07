/**
 * Checks on the built artifacts in dist/. Run `npm run build` first.
 */
import { describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const dist = (f: string) => readFileSync(join(root, 'dist', f), 'utf8');

describe('dist/server.mjs', () => {
  const code = dist('server.mjs');

  it('has no browser globals', () => {
    for (const name of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator']) {
      expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('has no runtime imports or requires', () => {
    expect(code).not.toMatch(/^\s*import\s[^(]/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/from\s+['"]/);
  });

  it('never references Mcp-Session-Id', () => {
    expect(code.toLowerCase()).not.toContain('mcp-session-id');
  });

  it('imports cleanly as plain ESM in Node', () => {
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "const m = await import('./dist/server.mjs'); console.log(typeof m.createSiServerClient, m.SERVER_SDK_VERSION)"],
      { cwd: root, encoding: 'utf8' }
    );
    expect(out.trim()).toBe('function 1.2.1');
  });

  it('CJS build loads too', () => {
    const out = execFileSync(process.execPath, ['-e', "console.log(typeof require('./dist/server.js').createSiServerClient)"], { cwd: root, encoding: 'utf8' });
    expect(out.trim()).toBe('function');
  });
});

describe('browser stub', () => {
  it('throws on import', () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./dist/server-browser-stub.mjs')"], { cwd: root, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('@supreme-ai/si-sdk/server is server-only');
  });

  it('is wired through the browser export condition, ahead of import/require', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const server = pkg.exports['./server'];
    const keys = Object.keys(server);
    expect(server.browser).toBe('./dist/server-browser-stub.mjs');
    expect(keys.indexOf('browser')).toBeLessThan(keys.indexOf('import'));
    expect(keys.indexOf('browser')).toBeLessThan(keys.indexOf('require'));
    // Server-like runtimes that also match "browser" get the real build first.
    for (const cond of ['deno', 'workerd', 'worker', 'edge-light']) {
      expect(keys.indexOf(cond)).toBeLessThan(keys.indexOf('browser'));
      expect(server[cond].default).toBe('./dist/server.mjs');
    }
  });

  it('the browser entry does not re-export the server entry', () => {
    expect(dist('index.mjs')).not.toContain('createSiServerClient');
    expect(dist('index.mjs')).not.toContain('membership_api');
  });
});

describe('tsconfig.server.json', () => {
  it('rejects browser and Node APIs in server sources', () => {
    const dir = mkdtempSync(join(root, 'src', 'server', 'tmp-typecheck-'));
    try {
      writeFileSync(join(dir, 'bad.ts'), "export const a = window.location.href;\nexport const b = localStorage.getItem('x');\nexport const c = process.env.X;\n");
      const r = spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.server.json'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(r.status).not.toBe(0);
      expect(r.stdout).toMatch(/Cannot find name 'window'/);
      expect(r.stdout).toMatch(/Cannot find name 'localStorage'/);
      expect(r.stdout).toMatch(/Cannot find name 'process'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
