import { describe, expect, it } from '@jest/globals';
import { conversationKey, hashConversationKey } from '../../src/server';

describe('conversationKey', () => {
  const all = {
    meta: { 'openai/session': 'oa-1' },
    headers: { 'x-codex-conversation-id': 'cx-1', 'x-si-conversation': 'si-1' },
  };

  it('prefers _meta["openai/session"]', () => {
    expect(conversationKey(all)).toBe('oa-1');
  });

  it('falls back to the Codex header, then X-SI-Conversation', () => {
    expect(conversationKey({ headers: all.headers })).toBe('cx-1');
    expect(conversationKey({ headers: { 'x-codex-session-id': 'cx-2', 'x-si-conversation': 'si-1' } })).toBe('cx-2');
    expect(conversationKey({ meta: {}, headers: { 'X-SI-Conversation': 'si-1' } })).toBe('si-1');
  });

  it('returns null when no source is present', () => {
    expect(conversationKey({})).toBeNull();
    expect(conversationKey(null)).toBeNull();
    expect(conversationKey({ meta: null, headers: null })).toBeNull();
  });

  it('never reads Mcp-Session-Id or other headers', () => {
    expect(conversationKey({ headers: { 'mcp-session-id': 'shared', traceparent: 'x' } })).toBeNull();
    expect(conversationKey({ headers: new Headers({ 'Mcp-Session-Id': 'shared' }) })).toBeNull();
  });

  it('works with Fetch Headers and case-insensitive plain objects', () => {
    expect(conversationKey({ headers: new Headers({ 'X-SI-Conversation': 'si-9' }) })).toBe('si-9');
    expect(conversationKey({ headers: { 'X-Codex-Conversation-Id': ['cx-a', 'cx-b'] } })).toBe('cx-a');
  });

  it('ignores empty, non-string and oversized values', () => {
    expect(conversationKey({ meta: { 'openai/session': '  ' }, headers: { 'x-si-conversation': 'si-1' } })).toBe('si-1');
    expect(conversationKey({ meta: { 'openai/session': 42 } })).toBeNull();
    expect(conversationKey({ headers: { 'x-si-conversation': 'x'.repeat(513) } })).toBeNull();
  });

  it('honours custom header names', () => {
    const opts = { codexHeaders: ['x-my-codex'], siHeader: 'x-my-si' };
    expect(conversationKey({ headers: { 'x-codex-conversation-id': 'cx', 'x-my-si': 's' } }, opts)).toBe('s');
    expect(conversationKey({ headers: { 'x-my-codex': 'c', 'x-my-si': 's' } }, opts)).toBe('c');
  });
});

describe('hashConversationKey', () => {
  it('is SHA-256 hex', async () => {
    await expect(hashConversationKey('abc')).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
