// Resolved through the `browser` export condition of `@supreme-ai/si-sdk/server`.
// The server entry holds a secret membership key and must never reach a client bundle.
throw new Error(
  '@supreme-ai/si-sdk/server is server-only: it holds a secret SI key and must not be imported from browser code. Import "@supreme-ai/si-sdk" instead.'
);

export {};
