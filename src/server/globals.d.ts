/**
 * Minimal ambient declarations for the server entry.
 *
 * The server entry compiles with `lib: ["ES2022"]` and no `DOM` or Node types
 * (see tsconfig.server.json), so a browser or Node API slipping in fails the
 * build. Only the web-standard globals every target runtime has (Node 18+,
 * Deno, Supabase edge, Next.js Edge, Workers) are declared here, and only the
 * members the SDK uses.
 */

interface SiAbortController {
  readonly signal: { readonly aborted: boolean };
  abort(): void;
}

declare function fetch(input: string, init?: import('./runtime').FetchInit): Promise<import('./runtime').FetchResponse>;

declare var AbortController: { new (): SiAbortController };

declare var URL: {
  new (url: string, base?: string): {
    readonly protocol: string;
    readonly hostname: string;
    readonly origin: string;
    readonly pathname: string;
    toString(): string;
  };
};

declare var TextEncoder: { new (): { encode(input: string): Uint8Array } };

declare var crypto: {
  readonly subtle: {
    digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
  };
};

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(id: unknown): void;

declare var console: {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
