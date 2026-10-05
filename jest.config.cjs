/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Type checking runs separately (`npm run typecheck:server`); the
        // server sources declare their own minimal globals.
        isolatedModules: true,
        tsconfig: { module: 'commonjs', target: 'ES2022', esModuleInterop: true },
      },
    ],
  },
};
