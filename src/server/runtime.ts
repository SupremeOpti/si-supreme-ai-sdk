/**
 * Structural types for the web-standard APIs the server entry uses. Public
 * signatures use these (not DOM or Node types), so the real `fetch`,
 * `Headers` and `Response` of any runtime fit without extra type packages.
 */

export interface HeadersLike {
  get(name: string): string | null;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  // `any` so the runtime's real `fetch` (whose init takes an AbortSignal) is assignable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal?: any;
}

export interface FetchResponse {
  readonly status: number;
  readonly headers: HeadersLike;
  text(): Promise<string>;
}

export type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponse>;
