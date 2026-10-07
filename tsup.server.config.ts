import { defineConfig } from 'tsup';

// Server entry (@supreme-ai/si-sdk/server). Compiled against tsconfig.server.json
// (ES2022 lib, no DOM, no Node types) so browser or Node APIs fail the build.
export default defineConfig([
  {
    entry: { server: 'src/server/index.ts' },
    format: ['cjs', 'esm'],
    target: 'es2022',
    dts: true,
    tsconfig: 'tsconfig.server.json',
    clean: false,
    splitting: false,
    sourcemap: false,
  },
  {
    entry: { 'server-browser-stub': 'src/server/browser-stub.ts' },
    format: ['esm'],
    target: 'es2022',
    dts: false,
    tsconfig: 'tsconfig.server.json',
    clean: false,
  },
]);
