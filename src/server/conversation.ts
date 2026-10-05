import type { HeadersLike } from './runtime';
import type { ConversationKeyOptions } from './types';

/** Header-ish input: a Fetch `Headers`, or a plain object (Node `IncomingHttpHeaders`, etc.). */
export type HeadersInput = HeadersLike | Record<string, string | string[] | undefined | null>;

export interface ConversationKeySource {
  /** The HTTP request headers of the MCP call. */
  headers?: HeadersInput | null;
  /** The tool call's `params._meta`. */
  meta?: Record<string, unknown> | null;
}

export const DEFAULT_CODEX_HEADERS = ['x-codex-conversation-id', 'x-codex-session-id'];
export const DEFAULT_SI_HEADER = 'x-si-conversation';
const MAX_KEY_LENGTH = 512;

function clean(value: unknown): string | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > MAX_KEY_LENGTH) return null;
  return v;
}

function readHeader(headers: HeadersInput, name: string): string | null {
  if (typeof (headers as HeadersLike).get === 'function') return clean((headers as HeadersLike).get(name));
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === lower) return clean(v);
  }
  return null;
}

/**
 * Best available per-conversation key, in priority order:
 * `_meta["openai/session"]` (ChatGPT) → Codex conversation header →
 * `X-SI-Conversation` (Claude Code `headersHelper`, SI's own agents) → `null`.
 *
 * Never reads `Mcp-Session-Id`: Claude shares one MCP session across every
 * conversation, and MCP `2026-07-28` removes sessions. The key is a guard
 * against model confusion, **never** an authorization input.
 */
export function conversationKey(source: ConversationKeySource | null | undefined, options: ConversationKeyOptions = {}): string | null {
  if (!source) return null;
  const fromMeta = clean(source.meta?.['openai/session']);
  if (fromMeta) return fromMeta;

  const headers = source.headers;
  if (!headers) return null;
  for (const name of options.codexHeaders ?? DEFAULT_CODEX_HEADERS) {
    const v = readHeader(headers, name);
    if (v) return v;
  }
  return readHeader(headers, options.siHeader ?? DEFAULT_SI_HEADER);
}

/** SHA-256 hex of a conversation key. Only the hash is stored or forwarded. */
export async function hashConversationKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
