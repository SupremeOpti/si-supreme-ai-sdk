"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/index.ts
var server_exports = {};
__export(server_exports, {
  AUDIT_EVENTS_PATH: () => AUDIT_EVENTS_PATH,
  AppInactiveError: () => AppInactiveError,
  DEFAULT_CODEX_HEADERS: () => DEFAULT_CODEX_HEADERS,
  DEFAULT_DETECTION_WINDOW_SECONDS: () => DEFAULT_DETECTION_WINDOW_SECONDS,
  DEFAULT_LOCK_TTL_SECONDS: () => DEFAULT_LOCK_TTL_SECONDS,
  DEFAULT_SI_HEADER: () => DEFAULT_SI_HEADER,
  GRANT_STATUS_CHUNK_SIZE: () => GRANT_STATUS_CHUNK_SIZE,
  GRANT_STATUS_PATH: () => GRANT_STATUS_PATH,
  INTROSPECT_PATH: () => INTROSPECT_PATH,
  InsufficientScopeError: () => InsufficientScopeError,
  InvalidArgumentError: () => InvalidArgumentError,
  InvalidTokenError: () => InvalidTokenError,
  LockStoreUnavailableError: () => LockStoreUnavailableError,
  MAX_ALLOW_TTL_SECONDS: () => MAX_ALLOW_TTL_SECONDS,
  MAX_DECLARED_SCOPES: () => MAX_DECLARED_SCOPES,
  MAX_DENY_TTL_SECONDS: () => MAX_DENY_TTL_SECONDS,
  MAX_GRANT_STATUS_TTL_SECONDS: () => MAX_GRANT_STATUS_TTL_SECONDS,
  MAX_INTROSPECTION_TTL_SECONDS: () => MAX_INTROSPECTION_TTL_SECONDS,
  MAX_SCOPE_MANIFEST_BYTES: () => MAX_SCOPE_MANIFEST_BYTES,
  MisconfiguredKeyError: () => MisconfiguredKeyError,
  OrgAccessDeniedError: () => OrgAccessDeniedError,
  OrgLockedError: () => OrgLockedError,
  PROTECTED_RESOURCE_METADATA_PATH: () => PROTECTED_RESOURCE_METADATA_PATH,
  SCOPE_MANIFEST_PATH: () => SCOPE_MANIFEST_PATH,
  SCOPE_MANIFEST_VERSION: () => SCOPE_MANIFEST_VERSION,
  SERVER_SDK_VERSION: () => SERVER_SDK_VERSION,
  SI_ACTIONS_MANIFEST_PATH: () => SI_ACTIONS_MANIFEST_PATH,
  SI_ACTIONS_VERSION: () => SI_ACTIONS_VERSION,
  SUPABASE_LOCK_STORE_SQL: () => SUPABASE_LOCK_STORE_SQL,
  SiActionError: () => SiActionError,
  SiServerError: () => SiServerError,
  SiUnavailableError: () => SiUnavailableError,
  SiValidationError: () => SiValidationError,
  UserGoneError: () => UserGoneError,
  acceptSiAction: () => acceptSiAction,
  annotations: () => annotations,
  audienceList: () => audienceList,
  bearerChallenge: () => bearerChallenge,
  bearerToken: () => bearerToken,
  canonicalResourceUri: () => canonicalResourceUri,
  conversationKey: () => conversationKey,
  createSiActions: () => createSiActions,
  createSiServerClient: () => createSiServerClient,
  errorResult: () => errorResult,
  hashConversationKey: () => hashConversationKey,
  isSiServerError: () => isSiServerError,
  isVerifiedPrincipal: () => isVerifiedPrincipal,
  labelResult: () => labelResult,
  memoryCache: () => memoryCache,
  memoryLockStore: () => memoryLockStore,
  orgBanner: () => orgBanner,
  requireScope: () => requireScope,
  scopeManifest: () => scopeManifest,
  supabaseLockStore: () => supabaseLockStore,
  validateJsonSchema: () => validate
});
module.exports = __toCommonJS(server_exports);

// src/server/adapters/memory.ts
function memoryCache(options = {}) {
  const now = options.now ?? Date.now;
  const store = /* @__PURE__ */ new Map();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return void 0;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return void 0;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds <= 0) {
        store.delete(key);
        return;
      }
      store.set(key, { value, expiresAt: now() + ttlSeconds * 1e3 });
    },
    async delete(key) {
      store.delete(key);
    }
  };
}
function memoryLockStore(options = {}) {
  const now = options.now ?? Date.now;
  const store = /* @__PURE__ */ new Map();
  const live = (key) => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= now()) {
      store.delete(key);
      return void 0;
    }
    return entry;
  };
  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async setIfAbsent(key, value, ttlSeconds) {
      const existing = live(key);
      if (existing) return { created: false, value: existing.value };
      store.set(key, { value, expiresAt: now() + ttlSeconds * 1e3 });
      return { created: true, value };
    },
    async touch(key, ttlSeconds) {
      const existing = live(key);
      if (!existing) return false;
      existing.expiresAt = now() + ttlSeconds * 1e3;
      return true;
    },
    async delete(key) {
      store.delete(key);
    }
  };
}

// src/server/audit.ts
var AUDIT_EVENTS_PATH = "/api/membership/audit-events";
function toWireEvent(e) {
  return {
    principal_id: e.principalId,
    client_id: e.clientId,
    mode: e.mode,
    key_hash: e.keyHash,
    organization_id: e.organizationId,
    tool: e.tool,
    kind: e.kind,
    outcome: e.outcome,
    occurred_at: e.occurredAt
  };
}
function createAudit(deps) {
  const cfg = deps.forwarding ?? {};
  const enabled = cfg.enabled === true;
  const batchSize = Math.max(1, Math.min(500, Math.floor(cfg.batchSize ?? 50)));
  const flushIntervalMs = Math.max(0, cfg.flushIntervalMs ?? 5e3);
  const queue = [];
  let timer = null;
  const send = async (batch) => {
    try {
      const result = await deps.http({
        method: "POST",
        path: AUDIT_EVENTS_PATH,
        body: { events: batch.map(toWireEvent) },
        retry: false
      });
      if (result.status !== 202 && result.status !== 200) {
        deps.logger.warn(`[si-sdk/server] audit forwarding: SI answered ${result.status}; dropped ${batch.length} events`);
      }
    } catch (err) {
      deps.logger.warn(`[si-sdk/server] audit forwarding failed; dropped ${batch.length} events`, {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };
  const flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const sends = [];
    while (queue.length > 0) sends.push(send(queue.splice(0, batchSize)));
    await Promise.all(sends);
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushIntervalMs);
    timer?.unref?.();
  };
  return {
    forwarding: enabled,
    emit(event) {
      if (deps.onAudit) {
        try {
          const r = deps.onAudit(event);
          if (r && typeof r.catch === "function") r.catch(() => void 0);
        } catch {
        }
      }
      if (!enabled) return;
      try {
        queue.push(event);
        if (queue.length >= batchSize) void flush();
        else schedule();
      } catch {
      }
    },
    flush
  };
}

// src/server/conversation.ts
var DEFAULT_CODEX_HEADERS = ["x-codex-conversation-id", "x-codex-session-id"];
var DEFAULT_SI_HEADER = "x-si-conversation";
var MAX_KEY_LENGTH = 512;
function clean(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > MAX_KEY_LENGTH) return null;
  return v;
}
function readHeader(headers, name) {
  if (typeof headers.get === "function") return clean(headers.get(name));
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return clean(v);
  }
  return null;
}
function conversationKey(source, options = {}) {
  if (!source) return null;
  const fromMeta = clean(source.meta?.["openai/session"]);
  if (fromMeta) return fromMeta;
  const headers = source.headers;
  if (!headers) return null;
  for (const name of options.codexHeaders ?? DEFAULT_CODEX_HEADERS) {
    const v = readHeader(headers, name);
    if (v) return v;
  }
  return readHeader(headers, options.siHeader ?? DEFAULT_SI_HEADER);
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashConversationKey(key) {
  return sha256Hex(key);
}

// src/server/errors.ts
var SiServerError = class extends Error {
  code;
  publicMessage;
  constructor(code, message, publicMessage) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.publicMessage = publicMessage;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var OrgAccessDeniedError = class extends SiServerError {
  organization;
  constructor(organization) {
    const org = String(organization);
    super(
      "org_access_denied",
      `Access to organization "${org}" denied`,
      `You don't have access to organization "${org}" in this app, or it doesn't exist. Call list_organizations to see the organizations you can use.`
    );
    this.organization = org;
  }
};
var OrgLockedError = class extends SiServerError {
  lockedOrganization;
  requestedOrganization;
  constructor(locked, requested) {
    const label = (o) => o.name ? `${o.name} (${o.slug ?? o.id})` : `organization ${o.id}`;
    super(
      "org_locked",
      `Conversation is locked to organization ${locked.id}; requested ${requested.id}`,
      `This conversation is already working in ${label(locked)}. Start a new conversation to work in ${label(requested)}.`
    );
    this.lockedOrganization = locked;
    this.requestedOrganization = requested;
  }
};
var UserGoneError = class extends SiServerError {
  userId;
  constructor(userId) {
    super(
      "user_not_found",
      `SI user ${userId} not found`,
      "Your Supreme Intelligence account no longer exists. Reconnect this app."
    );
    this.userId = String(userId);
  }
};
var SiUnavailableError = class extends SiServerError {
  reason;
  status;
  /** From SI's `Retry-After` on a `429`, when present. */
  retryAfterSeconds;
  constructor(reason, detail, status, retryAfterSeconds2) {
    super(
      "si_unavailable",
      `SI check unavailable (${reason}${status ? `, HTTP ${status}` : ""})${detail ? `: ${detail}` : ""}`,
      "Supreme Intelligence could not confirm your access right now. Try again in a moment."
    );
    this.reason = reason;
    this.status = status;
    if (retryAfterSeconds2 !== void 0) this.retryAfterSeconds = retryAfterSeconds2;
  }
};
var MisconfiguredKeyError = class extends SiServerError {
  status;
  constructor(detail, status) {
    super(
      "misconfigured_key",
      `SI membership key misconfigured: ${detail}`,
      "This app's connection to Supreme Intelligence is misconfigured. Contact your administrator."
    );
    this.status = status;
  }
};
var AppInactiveError = class extends SiServerError {
  constructor() {
    super("app_inactive", "The SI app linked to this membership key is inactive", "This app is currently disabled in Supreme Intelligence.");
  }
};
var LockStoreUnavailableError = class extends SiServerError {
  constructor(detail) {
    super(
      "lock_store_unavailable",
      `Conversation lock store unavailable: ${detail}`,
      "This app could not check which organization this conversation is working in. Try again in a moment."
    );
  }
};
var InvalidArgumentError = class extends SiServerError {
  constructor(detail) {
    super("invalid_argument", detail, detail);
  }
};
var InvalidTokenError = class extends SiServerError {
  reason;
  constructor(reason) {
    super(
      "invalid_token",
      `Access token rejected (${reason})`,
      reason === "missing" ? "This request needs a Supreme Intelligence access token." : "The access token is invalid or expired. Reconnect this app."
    );
    this.reason = reason;
  }
};
var InsufficientScopeError = class extends SiServerError {
  /** Every scope the operation needs (what goes in the challenge's `scope`). */
  requiredScopes;
  /** The required scopes the token doesn't have. */
  missingScopes;
  constructor(requiredScopes, missingScopes) {
    super(
      "insufficient_scope",
      `Token lacks required scopes: ${missingScopes.join(" ")}`,
      `This action needs more access than you granted this app (${missingScopes.join(", ")}). Reconnect and allow it.`
    );
    this.requiredScopes = [...requiredScopes];
    this.missingScopes = [...missingScopes];
  }
};
var SiValidationError = class extends SiServerError {
  errors;
  constructor(errors = {}) {
    super("validation_failed", `SI rejected the request (422 validation_failed): ${JSON.stringify(errors)}`, "The request to Supreme Intelligence was rejected. Contact your administrator.");
    this.errors = errors;
  }
};
function isSiServerError(err) {
  return err instanceof SiServerError;
}

// src/server/http.ts
var SERVER_SDK_VERSION = "1.5.0";
var defaultSleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1e3;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}
function compareVersions(a, b) {
  const pa = a.split("-")[0].split(".").map((n) => Number(n) || 0);
  const pb = b.split("-")[0].split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
function createHttp(options) {
  const sleep2 = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 1e3;
  const base = options.baseUrl.replace(/\/+$/, "");
  let minVersionWarned = false;
  const checkMinVersion = (headers) => {
    const min = headers.get("x-si-min-server-sdk");
    if (!min || minVersionWarned) return;
    if (compareVersions(SERVER_SDK_VERSION, min) < 0) {
      minVersionWarned = true;
      options.logger.warn(
        `[si-sdk/server] SI requires @supreme-ai/si-sdk/server >= ${min}; this is ${SERVER_SDK_VERSION}. Upgrade: it may contain security fixes.`
      );
    }
  };
  const attempt = async (req) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    try {
      const headers = {
        Authorization: `Bearer ${options.bearer}`,
        Accept: "application/json"
      };
      if (req.body !== void 0) headers["Content-Type"] = "application/json";
      let response;
      try {
        response = await options.fetch(`${base}${req.path}`, {
          method: req.method ?? "GET",
          headers,
          body: req.body === void 0 ? void 0 : JSON.stringify(req.body),
          signal: controller.signal
        });
      } catch (err) {
        if (timedOut) throw new SiUnavailableError("timeout", `no response within ${options.timeoutMs} ms`);
        throw new SiUnavailableError("network", err instanceof Error ? err.message : String(err));
      }
      let text = "";
      try {
        text = await response.text();
      } catch (err) {
        if (timedOut) throw new SiUnavailableError("timeout", `body not received within ${options.timeoutMs} ms`);
        throw new SiUnavailableError("network", "failed to read response body");
      }
      let body2;
      if (text) {
        try {
          body2 = JSON.parse(text);
        } catch {
          body2 = void 0;
        }
      }
      checkMinVersion(response.headers);
      return { status: response.status, body: body2, headers: response.headers };
    } finally {
      clearTimeout(timer);
    }
  };
  return async function request(req) {
    const retry = req.retry !== false;
    let first;
    try {
      first = await attempt(req);
    } catch (err) {
      if (!retry) throw err;
      await sleep2(jitter(random));
      return attempt(req);
    }
    if (first.status < 500 || !retry || req.noRetryOn?.(first)) return first;
    const retryAfter = parseRetryAfter(first.headers.get("retry-after"));
    if (retryAfter !== null && retryAfter > maxRetryDelayMs) return first;
    await sleep2(retryAfter ?? jitter(random));
    return attempt(req);
  };
}
function jitter(random) {
  return 100 + Math.floor(random() * 200);
}

// src/server/membership.ts
var MAX_ALLOW_TTL_SECONDS = 300;
var MAX_DENY_TTL_SECONDS = 30;
function clampTtl(value, cap) {
  if (value === void 0 || !Number.isFinite(value)) return cap;
  return Math.max(0, Math.min(cap, Math.floor(value)));
}
function normalizeUserId(userId) {
  const s = typeof userId === "number" ? String(userId) : typeof userId === "string" ? userId.trim() : "";
  if (!/^[1-9]\d{0,18}$/.test(s)) throw new InvalidArgumentError("userId must be a positive integer SI user id");
  return s;
}
var isInt = (v) => typeof v === "number" && Number.isInteger(v);
var isStr = (v) => typeof v === "string";
function parseOrganizations(value) {
  if (!Array.isArray(value)) return null;
  const organizations = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw;
    if (!isInt(o.id) || !isStr(o.slug) || !isStr(o.name) || !isStr(o.app_grant)) return null;
    if (!Array.isArray(o.roles) || !o.roles.every(isStr)) return null;
    organizations.push({ id: o.id, slug: o.slug, name: o.name, roles: [...o.roles], appGrant: o.app_grant });
  }
  return organizations;
}
function parseMembershipBody(body2) {
  if (!body2 || typeof body2 !== "object") return null;
  const data = body2.data;
  if (!data || typeof data !== "object") return null;
  const d = data;
  const user = d.user;
  const app = d.app;
  if (!user || !isInt(user.id)) return null;
  if (!app || !isInt(app.id) || !isStr(app.name)) return null;
  if (typeof d.is_superadmin !== "boolean") return null;
  const organizations = parseOrganizations(d.organizations);
  if (!organizations) return null;
  const meta = body2.meta;
  return {
    user: { id: user.id },
    app: { id: app.id, name: app.name },
    isSuperadmin: d.is_superadmin,
    organizations,
    generatedAt: meta && isStr(meta.generated_at) ? meta.generated_at : ""
  };
}
function retryAfterSeconds(result, now) {
  const ms = parseRetryAfter(result.headers.get("retry-after"), now);
  return ms === null ? void 0 : Math.ceil(ms / 1e3);
}
function errorCode(result) {
  const body2 = result.body;
  return body2 && typeof body2 === "object" && isStr(body2.error) ? body2.error : void 0;
}
function isCacheEntry(v) {
  if (!v || typeof v !== "object") return false;
  const e = v;
  if (e.v !== 1 || typeof e.at !== "number") return false;
  if (e.kind === "user_not_found") return true;
  return e.kind === "allow" && !!e.data && typeof e.data === "object" && Array.isArray(e.data.organizations);
}
function createMembership(deps) {
  const inflight = /* @__PURE__ */ new Map();
  const cacheKey = (id) => `si:m:${id}`;
  const readCache = async (id) => {
    try {
      const v = await deps.cache.get(cacheKey(id));
      return isCacheEntry(v) ? v : void 0;
    } catch {
      return void 0;
    }
  };
  const writeCache = async (id, entry) => {
    const ttl = entry.kind === "allow" && entry.data.organizations.length > 0 ? deps.allowTtlSeconds : deps.denyTtlSeconds;
    try {
      if (ttl > 0) await deps.cache.set(cacheKey(id), entry, ttl);
      else await deps.cache.delete(cacheKey(id));
    } catch {
    }
  };
  const fetchEntry = async (id) => {
    const result = await deps.http({
      path: `/api/membership/users/${encodeURIComponent(id)}/organizations`,
      noRetryOn: (r) => errorCode(r) === "misconfigured_key"
    });
    const code = errorCode(result);
    switch (result.status) {
      case 200: {
        const data = parseMembershipBody(result.body);
        if (!data) throw new SiUnavailableError("malformed_response", "membership body did not match the contract", 200);
        if (String(data.user.id) !== id) {
          throw new SiUnavailableError("malformed_response", "membership answer is for another user", 200);
        }
        return { v: 1, kind: "allow", at: deps.now(), data };
      }
      case 401:
        throw new MisconfiguredKeyError("SI rejected the membership key (401)", 401);
      case 403:
        if (code === "app_inactive") throw new AppInactiveError();
        throw new SiUnavailableError("unexpected_status", code, 403);
      case 404:
        if (code === "user_not_found") return { v: 1, kind: "user_not_found", at: deps.now() };
        throw new SiUnavailableError("unexpected_status", code ?? "unknown 404", 404);
      case 429:
        throw new SiUnavailableError("rate_limited", void 0, 429, retryAfterSeconds(result));
      default:
        if (result.status === 500 && code === "misconfigured_key") {
          throw new MisconfiguredKeyError("the key is not linked to an SI app (500 misconfigured_key)", 500);
        }
        if (result.status >= 500) throw new SiUnavailableError("server_error", code, result.status);
        throw new SiUnavailableError("unexpected_status", code, result.status);
    }
  };
  const refresh = (id) => {
    const pending = inflight.get(id);
    if (pending) return pending;
    const p = fetchEntry(id).then(async (entry) => {
      await writeCache(id, entry);
      return entry;
    }).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  };
  const toMembership = (id, entry, fromCache) => {
    if (entry.kind === "user_not_found") throw new UserGoneError(id);
    return { ...entry.data, organizations: entry.data.organizations.map((o) => ({ ...o, roles: [...o.roles] })), fromCache };
  };
  const get = async (userId) => {
    const id = normalizeUserId(userId);
    const cached = await readCache(id);
    if (cached) return toMembership(id, cached, true);
    return toMembership(id, await refresh(id), false);
  };
  const findOrganization = async (userId, match) => {
    const id = normalizeUserId(userId);
    const cached = await readCache(id);
    if (cached) {
      const membership2 = toMembership(id, cached, true);
      const organization = membership2.organizations.find(match) ?? null;
      if (organization || deps.now() - cached.at < deps.denyTtlSeconds * 1e3) return { organization, membership: membership2 };
      try {
        const fresh = toMembership(id, await refresh(id), false);
        return { organization: fresh.organizations.find(match) ?? null, membership: fresh };
      } catch (err) {
        if (err instanceof SiUnavailableError && err.reason === "rate_limited") return { organization, membership: membership2 };
        throw err;
      }
    }
    const membership = toMembership(id, await refresh(id), false);
    return { organization: membership.organizations.find(match) ?? null, membership };
  };
  return {
    get,
    findOrganization,
    async requireOrg(userId, organizationId) {
      const s = String(organizationId).trim();
      if (!/^\d+$/.test(s)) throw new InvalidArgumentError("organizationId must be a numeric org id");
      const orgId = Number(s);
      const { organization } = await findOrganization(userId, (o) => o.id === orgId);
      if (!organization) throw new OrgAccessDeniedError(s);
      return organization;
    },
    async invalidate(userId) {
      try {
        await deps.cache.delete(cacheKey(normalizeUserId(userId)));
      } catch {
      }
    }
  };
}

// src/server/resource.ts
function canonicalResourceUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) throw new InvalidArgumentError("resource must be an absolute URI");
  if (uri.includes("#")) throw new InvalidArgumentError("resource must not have a fragment");
  let url;
  try {
    url = new URL(uri.trim());
  } catch {
    throw new InvalidArgumentError("resource must be an absolute URI");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new InvalidArgumentError("resource must use https (http is allowed for localhost only)");
  }
  const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

// src/server/scopes.ts
var SCOPE_MANIFEST_PATH = "/.well-known/si-mcp-scopes.json";
var SCOPE_MANIFEST_VERSION = 1;
var MAX_DECLARED_SCOPES = 50;
var MAX_SCOPE_MANIFEST_BYTES = 64 * 1024;
var MAX_LABEL_LENGTH = 80;
var MAX_DESCRIPTION_LENGTH = 500;
var SLUG = /^[a-z0-9][a-z0-9_-]*$/;
var CONTROL = /[\u0000-\u001f\u007f]/;
var KINDS = ["required", "default", "optional"];
var quoted = (value) => typeof value === "string" ? `"${value}"` : String(value);
var isPlainText = (value, max) => typeof value === "string" && value.length <= max && !CONTROL.test(value);
function scopeManifest(input) {
  if (!input || typeof input !== "object") throw new InvalidArgumentError("scopeManifest needs { resource, resourceSlug, scopes }");
  const { resource, resourceSlug, scopes } = input;
  if (scopes === void 0) throw new InvalidArgumentError("no scopes declared: set auth.scopes to serve the SI scope manifest");
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > MAX_DECLARED_SCOPES) {
    throw new InvalidArgumentError(`auth.scopes must be an array of 1 to ${MAX_DECLARED_SCOPES} scope declarations`);
  }
  if (resource === void 0) throw new InvalidArgumentError("auth.resource is required when auth.scopes is set (the canonical MCP resource URI)");
  const canonical = canonicalResourceUri(resource);
  if (resourceSlug === void 0) throw new InvalidArgumentError('auth.resourceSlug is required when auth.scopes is set (the SI resource slug, e.g. "canva")');
  if (typeof resourceSlug !== "string" || !SLUG.test(resourceSlug)) {
    throw new InvalidArgumentError(`auth.resourceSlug ${quoted(resourceSlug)} must be the SI resource slug (lowercase letters, digits, "_" or "-", e.g. "canva")`);
  }
  const namePattern = new RegExp(`^mcp:${resourceSlug.replace(/[-]/g, "\\$&")}:[a-z0-9_]+$`);
  const seen = /* @__PURE__ */ new Set();
  let hasRequired = false;
  const out = scopes.map((raw, i) => {
    const at = `auth.scopes[${i}]`;
    if (!raw || typeof raw !== "object") throw new InvalidArgumentError(`${at} must be an object { name, label, description?, kind }`);
    const s = raw;
    if ("status" in s) throw new InvalidArgumentError(`${at} must not set status: SI owns scope status (active, pending, deprecated)`);
    if (typeof s.name !== "string" || !namePattern.test(s.name)) {
      throw new InvalidArgumentError(`${at}.name ${quoted(s.name)} must match mcp:${resourceSlug}:<verb> (${namePattern.source})`);
    }
    if (seen.has(s.name)) throw new InvalidArgumentError(`${at}.name "${s.name}" is declared twice`);
    seen.add(s.name);
    const label = isPlainText(s.label, MAX_LABEL_LENGTH) ? s.label.trim() : "";
    if (!label) throw new InvalidArgumentError(`${at}.label must be plain text of 1 to ${MAX_LABEL_LENGTH} characters`);
    let description;
    if (s.description !== void 0) {
      if (!isPlainText(s.description, MAX_DESCRIPTION_LENGTH)) {
        throw new InvalidArgumentError(`${at}.description must be plain text of at most ${MAX_DESCRIPTION_LENGTH} characters`);
      }
      description = s.description.trim() || void 0;
    }
    if (!KINDS.includes(s.kind)) throw new InvalidArgumentError(`${at}.kind must be "required", "default" or "optional"`);
    const kind = s.kind;
    if (kind === "required") hasRequired = true;
    return description === void 0 ? { name: s.name, label, kind } : { name: s.name, label, description, kind };
  });
  if (!hasRequired) throw new InvalidArgumentError('auth.scopes must declare at least one "required" scope');
  const manifest = { version: SCOPE_MANIFEST_VERSION, resource: canonical, scopes: out };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest)).length;
  if (bytes > MAX_SCOPE_MANIFEST_BYTES) {
    throw new InvalidArgumentError(`auth.scopes: the manifest is ${bytes} bytes; the SI contract allows at most ${MAX_SCOPE_MANIFEST_BYTES}`);
  }
  return manifest;
}

// src/server/auth.ts
var INTROSPECT_PATH = "/api/oauth/introspect";
var GRANT_STATUS_PATH = "/api/oauth/grants/status";
var PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
var MAX_INTROSPECTION_TTL_SECONDS = 60;
var MAX_GRANT_STATUS_TTL_SECONDS = 60;
var GRANT_STATUS_CHUNK_SIZE = 100;
var MAX_BACKOFF_SECONDS = 60;
var GRANT_STATUSES = ["active", "revoked", "expired", "unknown"];
var verified = /* @__PURE__ */ new WeakSet();
function isVerifiedPrincipal(value) {
  return typeof value === "object" && value !== null && verified.has(value);
}
var quote = (v) => `"${v.replace(/["\\]/g, (c) => `\\${c}`)}"`;
function bearerChallenge(params) {
  const parts = [];
  if (params.realm) parts.push(`realm=${quote(params.realm)}`);
  if (params.error) parts.push(`error=${quote(params.error)}`);
  if (params.errorDescription) parts.push(`error_description=${quote(params.errorDescription)}`);
  const scope = typeof params.scope === "string" ? params.scope : params.scope?.join(" ");
  if (scope) parts.push(`scope=${quote(scope)}`);
  if (params.resourceMetadata) parts.push(`resource_metadata=${quote(params.resourceMetadata)}`);
  return parts.length ? `Bearer ${parts.join(", ")}` : "Bearer";
}
function bearerToken(headers) {
  if (!headers) return null;
  const value = readHeader(headers, "authorization");
  const match = value ? /^Bearer\s+(\S+)$/i.exec(value) : null;
  return match ? match[1] : null;
}
function requireScope(principal, scope) {
  const required = (typeof scope === "string" ? [scope] : [...scope]).map((s) => s.trim()).filter(Boolean);
  if (required.length === 0) throw new InvalidArgumentError("requireScope needs at least one scope");
  const granted = new Set(Array.isArray(principal?.scope) ? principal.scope : []);
  const missing = required.filter((s) => !granted.has(s));
  if (missing.length) throw new InsufficientScopeError(required, missing);
}
var isStr2 = (v) => typeof v === "string";
var isInt2 = (v) => typeof v === "number" && Number.isInteger(v);
function parseActiveIntrospection(body2) {
  if (!body2 || typeof body2 !== "object") return null;
  const b = body2;
  if (b.active !== true) return null;
  if (!isStr2(b.sub) || !/^[1-9]\d{0,18}$/.test(b.sub)) return null;
  if (!isStr2(b.aud) || !isStr2(b.iss) || !isStr2(b.client_id) || !b.client_id) return null;
  if (!(b.client_name === null || isStr2(b.client_name))) return null;
  if (!isStr2(b.scope) || !isStr2(b.grant_id) || !b.grant_id || !isStr2(b.requested_resource)) return null;
  if (!isInt2(b.exp) || !isInt2(b.iat) || typeof b.is_superadmin !== "boolean") return null;
  if (b.email !== void 0 && b.email !== null && !isStr2(b.email)) return null;
  if (b.name !== void 0 && b.name !== null && !isStr2(b.name)) return null;
  const organizations = parseOrganizations(b.organizations);
  if (!organizations) return null;
  const principal = {
    sub: b.sub,
    aud: b.aud,
    scope: b.scope.split(/\s+/).filter(Boolean),
    clientId: b.client_id,
    clientName: b.client_name,
    grantId: b.grant_id,
    requestedResource: b.requested_resource,
    isSuperadmin: b.is_superadmin,
    organizations,
    exp: b.exp,
    iat: b.iat,
    iss: b.iss
  };
  if (isStr2(b.email)) principal.email = b.email;
  if (isStr2(b.name)) principal.name = b.name;
  return principal;
}
function freezePrincipal(data, fromCache) {
  const principal = Object.freeze({
    ...data,
    scope: Object.freeze([...data.scope]),
    organizations: Object.freeze(data.organizations.map((o) => Object.freeze({ ...o, roles: Object.freeze([...o.roles]) }))),
    fromCache
  });
  verified.add(principal);
  return principal;
}
function createAuth(deps) {
  const cfg = deps.config ?? {};
  const introspectionTtl = clampTtl(cfg.introspectionTtlSeconds, MAX_INTROSPECTION_TTL_SECONDS);
  const grantTtl = cfg.grantStatusTtlSeconds === void 0 ? 0 : clampTtl(cfg.grantStatusTtlSeconds, MAX_GRANT_STATUS_TTL_SECONDS);
  const defaultResource = cfg.resource === void 0 ? void 0 : canonicalResourceUri(cfg.resource);
  const issuer = cfg.issuer ?? deps.baseUrl;
  const declaration = cfg.scopes === void 0 ? void 0 : scopeManifest(cfg);
  const declaredNames = declaration === void 0 ? void 0 : new Set(declaration.scopes.map((s) => s.name));
  if (declaredNames && cfg.scopesSupported) {
    const undeclared = cfg.scopesSupported.filter((s) => !declaredNames.has(s));
    if (undeclared.length) {
      throw new InvalidArgumentError(`auth.scopesSupported must be a subset of the declared auth.scopes (undeclared: ${undeclared.join(", ")})`);
    }
  }
  const scopesSupported = cfg.scopesSupported?.length ? [...cfg.scopesSupported] : declaration?.scopes.map((s) => s.name);
  const inflight = /* @__PURE__ */ new Map();
  let blockedUntil = 0;
  const resourceFor = (override) => {
    if (override !== void 0) return canonicalResourceUri(override);
    if (defaultResource === void 0) {
      throw new InvalidArgumentError("no resource configured: set auth.resource or pass { resource } (your canonical MCP resource URI)");
    }
    return defaultResource;
  };
  const checkBackoff = () => {
    const remaining = blockedUntil - deps.now();
    if (remaining > 0) {
      throw new SiUnavailableError("rate_limited", "backing off after 429 (Retry-After)", 429, Math.ceil(remaining / 1e3));
    }
  };
  const fail = (result) => {
    const code = errorCode(result);
    switch (result.status) {
      case 401:
        throw new MisconfiguredKeyError("SI rejected the membership key (401)", 401);
      case 403:
        if (code === "app_inactive") throw new AppInactiveError();
        throw new SiUnavailableError("unexpected_status", code, 403);
      case 422: {
        const errors = result.body?.errors;
        throw new SiValidationError(errors && typeof errors === "object" ? errors : {});
      }
      case 429: {
        const retryAfter = retryAfterSeconds(result, deps.now());
        if (retryAfter !== void 0 && retryAfter > 0) {
          blockedUntil = Math.max(blockedUntil, deps.now() + Math.min(retryAfter, MAX_BACKOFF_SECONDS) * 1e3);
        }
        throw new SiUnavailableError("rate_limited", void 0, 429, retryAfter);
      }
      default: {
        if (result.status === 500 && code === "misconfigured_key") {
          const message = result.body?.message;
          throw new MisconfiguredKeyError(`500 misconfigured_key${isStr2(message) ? `: ${message}` : ""}`, 500);
        }
        if (result.status >= 500) throw new SiUnavailableError("server_error", code, result.status);
        throw new SiUnavailableError("unexpected_status", code, result.status);
      }
    }
  };
  const accept = (data, resource) => {
    let aud;
    try {
      aud = canonicalResourceUri(data.aud);
    } catch {
      throw new InvalidTokenError("audience_mismatch");
    }
    if (aud !== resource) {
      deps.logger.warn("[si-sdk/server] introspection: SI answered active for another audience; rejected", { aud: data.aud, expected: resource });
      throw new InvalidTokenError("audience_mismatch");
    }
    if (data.exp * 1e3 <= deps.now()) throw new InvalidTokenError("expired");
  };
  const readCached = async (key) => {
    try {
      const v = await deps.cache.get(key);
      if (!v || typeof v !== "object" || v.v !== 1 || typeof v.at !== "number" || typeof v.ttlMs !== "number") return null;
      const age = deps.now() - v.at;
      if (age < 0 || age >= Math.min(v.ttlMs, introspectionTtl * 1e3)) return null;
      return parseActiveIntrospection(v.body);
    } catch {
      return null;
    }
  };
  const fetchActive = async (token, key) => {
    checkBackoff();
    const result = await deps.http({
      method: "POST",
      path: INTROSPECT_PATH,
      body: { token },
      noRetryOn: (r) => errorCode(r) === "misconfigured_key"
    });
    if (result.status !== 200) return fail(result);
    const body2 = result.body;
    if (body2 && typeof body2 === "object" && body2.active === false) throw new InvalidTokenError("inactive");
    const data = parseActiveIntrospection(body2);
    if (!data) throw new SiUnavailableError("malformed_response", "introspection body did not match the contract", 200);
    const ttlSeconds = Math.min(introspectionTtl, Math.floor((data.exp * 1e3 - deps.now()) / 1e3));
    if (ttlSeconds > 0) {
      const entry = { v: 1, at: deps.now(), ttlMs: ttlSeconds * 1e3, body: body2 };
      try {
        await deps.cache.set(key, entry, ttlSeconds);
      } catch {
      }
    }
    return data;
  };
  const introspect = async (bearer, options = {}) => {
    const raw = typeof bearer === "string" ? bearer.trim().replace(/^Bearer(\s+|$)/i, "").trim() : "";
    if (!raw) throw new InvalidTokenError("missing");
    const resource = resourceFor(options.resource);
    const key = `si:i:${await sha256Hex(raw)}`;
    const cached = await readCached(key);
    if (cached) {
      accept(cached, resource);
      return freezePrincipal(cached, true);
    }
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchActive(raw, key).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const data = await pending;
    accept(data, resource);
    return freezePrincipal(data, false);
  };
  const grantStatus = async (grantIds) => {
    if (!Array.isArray(grantIds)) throw new InvalidArgumentError("grantIds must be an array of grant ids");
    const ids = [];
    const seen = /* @__PURE__ */ new Set();
    for (const id of grantIds) {
      if (typeof id !== "string" || !id || id.length > 64) throw new InvalidArgumentError("each grant id must be a non-empty string of at most 64 characters");
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    const out = /* @__PURE__ */ new Map();
    const pending = [];
    for (const id of ids) {
      if (grantTtl > 0) {
        try {
          const v = await deps.cache.get(`si:g:${id}`);
          const age = v && v.v === 1 && v.status === "active" ? deps.now() - v.at : -1;
          if (v && age >= 0 && age < Math.min(v.ttlMs, grantTtl * 1e3)) {
            out.set(id, "active");
            continue;
          }
        } catch {
        }
      }
      pending.push(id);
    }
    for (let i = 0; i < pending.length; i += GRANT_STATUS_CHUNK_SIZE) {
      const chunk = pending.slice(i, i + GRANT_STATUS_CHUNK_SIZE);
      checkBackoff();
      const result = await deps.http({
        method: "POST",
        path: GRANT_STATUS_PATH,
        body: { grant_ids: chunk },
        noRetryOn: (r) => errorCode(r) === "misconfigured_key"
      });
      if (result.status !== 200) fail(result);
      const body2 = result.body;
      if (!body2 || typeof body2 !== "object" || Array.isArray(body2)) {
        throw new SiUnavailableError("malformed_response", "grant status body is not an object", 200);
      }
      for (const id of chunk) {
        const status = Object.prototype.hasOwnProperty.call(body2, id) ? body2[id] : void 0;
        if (!GRANT_STATUSES.includes(status)) {
          throw new SiUnavailableError("malformed_response", "grant status missing or unknown for a requested id", 200);
        }
        out.set(id, status);
        if (status === "active" && grantTtl > 0) {
          const entry = { v: 1, at: deps.now(), ttlMs: grantTtl * 1e3, status: "active" };
          try {
            await deps.cache.set(`si:g:${id}`, entry, grantTtl);
          } catch {
          }
        }
      }
    }
    return Object.fromEntries(ids.map((id) => [id, out.get(id)]));
  };
  const queryOf = (requestUrl) => {
    if (requestUrl === void 0) return "";
    try {
      return new URL(requestUrl).search;
    } catch {
      throw new InvalidArgumentError("requestUrl must be an absolute URL");
    }
  };
  const baseResource = () => {
    const r = new URL(resourceFor());
    return { origin: `${r.protocol}//${r.host}`, path: r.pathname === "/" ? "" : r.pathname, query: r.search };
  };
  const protectedResourceMetadata = (requestUrl) => {
    const { origin: origin2, path, query } = baseResource();
    const resource = `${origin2}${path}${queryOf(requestUrl) || query}`;
    const doc = {
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"]
    };
    if (scopesSupported?.length) doc.scopes_supported = [...scopesSupported];
    if (cfg.resourceName) doc.resource_name = cfg.resourceName;
    if (cfg.resourceDocumentation) doc.resource_documentation = cfg.resourceDocumentation;
    if (cfg.logoUri) doc.logo_uri = cfg.logoUri;
    return doc;
  };
  const declared = () => {
    if (declaration === void 0) throw new InvalidArgumentError("no scopes declared: set auth.scopes to serve the SI scope manifest");
    return declaration;
  };
  const scopeManifest2 = () => {
    const m = declared();
    return { version: SCOPE_MANIFEST_VERSION, resource: m.resource, scopes: m.scopes.map((s) => ({ ...s })) };
  };
  const scopeManifestResponse = () => ({
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    body: JSON.stringify(declared())
  });
  const requireDeclaredScope = (principal, scope) => {
    if (declaredNames) {
      for (const s of (typeof scope === "string" ? [scope] : [...scope]).map((v) => v.trim()).filter(Boolean)) {
        if (!declaredNames.has(s)) throw new InvalidArgumentError(`requireScope: "${s}" is not a declared scope (auth.scopes)`);
      }
    }
    requireScope(principal, scope);
  };
  const resourceMetadataUrl = (requestUrl) => {
    const { origin: origin2, path, query } = baseResource();
    return `${origin2}${PROTECTED_RESOURCE_METADATA_PATH}${path}${queryOf(requestUrl) || query}`;
  };
  const challenge = (err, options = {}) => {
    const json2 = { "Content-Type": "application/json" };
    const metadata = () => options.resourceMetadataUrl ?? resourceMetadataUrl(options.requestUrl);
    if (err instanceof InvalidTokenError) {
      const error = err.reason === "missing" ? void 0 : "invalid_token";
      return {
        status: 401,
        headers: { ...json2, "WWW-Authenticate": bearerChallenge({ error, resourceMetadata: metadata() }) },
        body: { error: error ?? "unauthorized", error_description: err.publicMessage }
      };
    }
    if (err instanceof InsufficientScopeError) {
      return {
        status: 403,
        headers: {
          ...json2,
          "WWW-Authenticate": bearerChallenge({ error: "insufficient_scope", scope: err.requiredScopes, resourceMetadata: metadata() })
        },
        body: { error: "insufficient_scope", error_description: err.publicMessage }
      };
    }
    if (isSiServerError(err)) {
      const headers = { ...json2 };
      if (err instanceof SiUnavailableError && err.retryAfterSeconds !== void 0) headers["Retry-After"] = String(err.retryAfterSeconds);
      return { status: 503, headers, body: { error: "temporarily_unavailable", error_description: err.publicMessage } };
    }
    return { status: 500, headers: json2, body: { error: "server_error", error_description: "Unexpected error." } };
  };
  return {
    introspect,
    grantStatus,
    requireScope: requireDeclaredScope,
    protectedResourceMetadata,
    scopeManifest: scopeManifest2,
    scopeManifestResponse,
    resourceMetadataUrl,
    challenge,
    bearerToken
  };
}

// src/server/detection.ts
var DEFAULT_DETECTION_WINDOW_SECONDS = 15 * 60;
var MAX_ENTRIES = 20;
function isEntry(v) {
  if (!v || typeof v !== "object") return false;
  const e = v;
  return typeof e.id === "number" && typeof e.slug === "string" && typeof e.name === "string" && typeof e.at === "number";
}
function ago(ms) {
  const min = Math.floor(ms / 6e4);
  if (min < 1) return "less than a minute ago";
  return min === 1 ? "1 min ago" : `${min} min ago`;
}
function createDetection(deps) {
  const key = (p, c) => `si:d:${encodeURIComponent(p)}:${encodeURIComponent(c)}`;
  const windowMs = deps.windowSeconds * 1e3;
  const load = async (k) => {
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
      }
    },
    async checkWrite(principalId, clientId, org) {
      if (!deps.enabled || deps.windowSeconds <= 0) return null;
      try {
        const other = (await load(key(principalId, clientId))).filter((e) => e.id !== org.id).sort((a, b) => b.at - a.at)[0];
        if (!other) return null;
        return `Warning: this connection read ${other.name} (${other.slug}) ${ago(deps.now() - other.at)}. Confirm nothing from ${other.name} is in this write to ${org.name} (${org.slug}).`;
      } catch {
        return null;
      }
    }
  };
}

// src/server/locks.ts
var DEFAULT_LOCK_TTL_SECONDS = 24 * 60 * 60;
function lockKey(principalId, clientId, keyHash) {
  return `si:lock:${encodeURIComponent(principalId)}:${encodeURIComponent(clientId)}:${keyHash}`;
}
function createLocks(store, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS) {
  const guard = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      throw new LockStoreUnavailableError(err instanceof Error ? err.message : String(err));
    }
  };
  const parse = (value) => {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new LockStoreUnavailableError("lock store returned a non-numeric org id");
    return n;
  };
  return {
    async bindOrg({ principalId, clientId, keyHash, organizationId }) {
      if (keyHash === null) return { mode: "soft", created: false };
      const key = lockKey(principalId, clientId, keyHash);
      const wanted = String(organizationId);
      const existing = await guard(() => store.get(key));
      if (existing !== null) {
        const lockedId = parse(existing);
        if (lockedId !== organizationId) throw new OrgLockedError({ id: lockedId }, { id: organizationId });
        const touched = await guard(() => store.touch(key, ttlSeconds));
        if (touched) return { mode: "locked", created: false };
      }
      const result = await guard(() => store.setIfAbsent(key, wanted, ttlSeconds));
      const winner = parse(result.value);
      if (winner !== organizationId) throw new OrgLockedError({ id: winner }, { id: organizationId });
      return { mode: "locked", created: result.created };
    },
    async release({ principalId, clientId, keyHash }) {
      if (keyHash === null) return;
      await guard(() => store.delete(lockKey(principalId, clientId, keyHash)));
    }
  };
}

// src/server/mcp.ts
var annotations = Object.freeze({
  read: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
  write: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }),
  destructive: Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false })
});
function orgBanner(org) {
  return `[Org: ${org.name} (${org.slug})]`;
}
function labelResult(result, scope) {
  const label = [{ type: "text", text: orgBanner(scope.organization) }];
  if (scope.warning) label.push({ type: "text", text: scope.warning });
  const content = Array.isArray(result.content) ? result.content.map((b) => ({ ...b })) : [];
  return { ...result, content: [...label, ...content] };
}
function errorResult(err) {
  const code = isSiServerError(err) ? err.code : "internal_error";
  const message = isSiServerError(err) ? err.publicMessage : "The tool failed unexpectedly. Try again in a moment.";
  return { isError: true, content: [{ type: "text", text: `Error (${code}): ${message}` }] };
}
function createMcp(deps) {
  const scopeToolCall = async (input) => {
    const principal = input.principal;
    const userId = principal !== void 0 && input.userId === void 0 && isVerifiedPrincipal(principal) ? principal.sub : input.userId;
    const rawClientId = input.clientId ?? (principal !== void 0 && isVerifiedPrincipal(principal) ? principal.clientId : void 0);
    const clientId = typeof rawClientId === "string" ? rawClientId.trim() : "";
    const tool = typeof input.tool === "string" ? input.tool.trim() : "";
    const principalId = (input.principalId ?? String(userId)).trim();
    const kind = input.kind === "read" ? "read" : "write";
    const key = typeof input.conversationKey === "string" && input.conversationKey.trim() ? input.conversationKey.trim() : null;
    const mode = key ? "locked" : "soft";
    let keyHash = null;
    let organizationId = null;
    const audit = (outcome) => deps.audit.emit({
      principalId: principalId || String(userId),
      clientId,
      mode,
      keyHash,
      organizationId,
      tool: tool || "unknown",
      kind,
      outcome,
      occurredAt: new Date(deps.now()).toISOString()
    });
    try {
      if (principal !== void 0) {
        if (!isVerifiedPrincipal(principal)) throw new InvalidArgumentError("principal must be the object returned by si.auth.introspect");
        if (input.userId !== void 0 && String(input.userId).trim() !== principal.sub) {
          throw new InvalidArgumentError("userId does not match principal.sub");
        }
        if (principal.exp * 1e3 <= deps.now()) throw new InvalidTokenError("expired");
      } else if (userId === void 0) {
        throw new InvalidArgumentError("userId or principal is required");
      }
      if (!clientId) throw new InvalidArgumentError("clientId is required");
      if (!tool) throw new InvalidArgumentError("tool is required");
      if (!principalId) throw new InvalidArgumentError("principalId must not be empty");
      if (key) keyHash = await hashConversationKey(key);
      const org = await deps.organizations.resolve(principal ?? userId, input.organization);
      organizationId = org.id;
      try {
        await deps.locks.bindOrg({ principalId, clientId, keyHash, organizationId: org.id });
      } catch (err) {
        if (err instanceof OrgLockedError) {
          const lockedId = err.lockedOrganization.id;
          let locked = { id: lockedId };
          try {
            const orgs = principal ? principal.organizations : (await deps.membership.get(userId)).organizations;
            const o = orgs.find((x) => x.id === lockedId);
            if (o) locked = { id: o.id, slug: o.slug, name: o.name };
          } catch {
          }
          throw new OrgLockedError(locked, { id: org.id, slug: org.slug, name: org.name });
        }
        throw err;
      }
      const label = { id: org.id, slug: org.slug, name: org.name };
      let warning = null;
      if (kind === "read") await deps.detection.recordRead(principalId, clientId, label);
      else warning = await deps.detection.checkWrite(principalId, clientId, label);
      audit("allowed");
      return {
        organization: label,
        roles: [...org.roles],
        appGrant: org.appGrant,
        mode,
        keyHash,
        warning,
        userId: String(userId),
        principalId,
        clientId,
        tool,
        kind
      };
    } catch (err) {
      audit(isSiServerError(err) ? err.code : "internal_error");
      throw err;
    }
  };
  const listOrganizationsTool = () => ({
    definition: {
      name: "list_organizations",
      title: "Organizations \u2014 List",
      description: "List the organizations (also called tenants, clients, or accounts) the user can use in this app, with each org's `organization_id`, `slug`, `name`, `roles` and `app_grant`. Call it first when you need to resolve which organization the user means, then pass the org `slug` as the `organization` argument of other tools.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: annotations.read
    },
    async handler({ userId, principal }) {
      try {
        let organizations;
        if (principal !== void 0) {
          if (!isVerifiedPrincipal(principal)) throw new InvalidArgumentError("principal must be the object returned by si.auth.introspect");
          if (principal.exp * 1e3 <= deps.now()) throw new InvalidTokenError("expired");
          organizations = principal.organizations;
        } else if (userId !== void 0) {
          organizations = (await deps.membership.get(userId)).organizations;
        } else {
          throw new InvalidArgumentError("userId or principal is required");
        }
        const payload = {
          data: organizations.map((o) => ({
            organization_id: o.id,
            slug: o.slug,
            name: o.name,
            roles: [...o.roles],
            app_grant: o.appGrant
          })),
          meta: { count: organizations.length }
        };
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  });
  return {
    conversationKey: (source) => conversationKey(source, deps.conversation),
    scopeToolCall,
    labelResult,
    errorResult,
    listOrganizationsTool,
    annotations
  };
}

// src/server/organizations.ts
function organizationMatcher(organization) {
  const raw = typeof organization === "number" ? String(organization) : typeof organization === "string" ? organization.trim() : "";
  if (!raw || raw.length > 200) throw new InvalidArgumentError("organization must be an org slug or numeric id");
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    return { raw, match: (o) => o.id === id };
  }
  const slug = raw.toLowerCase();
  return { raw, match: (o) => o.slug.toLowerCase() === slug };
}
function createOrganizations(membership) {
  return {
    async resolve(user, organization) {
      const { raw, match } = organizationMatcher(organization);
      if (typeof user === "object" && user !== null) {
        if (!isVerifiedPrincipal(user)) throw new InvalidArgumentError("principal must be the object returned by si.auth.introspect");
        const org2 = user.organizations.find(match);
        if (!org2) throw new OrgAccessDeniedError(raw);
        return { ...org2, roles: [...org2.roles] };
      }
      const { organization: org } = await membership.findOrganization(user, match);
      if (!org) throw new OrgAccessDeniedError(raw);
      return org;
    }
  };
}

// src/server/client.ts
var consoleLogger = {
  warn: (message, context) => context ? console.warn(message, context) : console.warn(message),
  error: (message, context) => context ? console.error(message, context) : console.error(message)
};
function validateBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new InvalidArgumentError("baseUrl must be an absolute URL");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new InvalidArgumentError("baseUrl must use https (http is allowed for localhost only)");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}
function createSiServerClient(config) {
  if (!config || typeof config !== "object") throw new InvalidArgumentError("config is required");
  if (typeof config.membershipKey !== "string" || !config.membershipKey.trim()) {
    throw new MisconfiguredKeyError("membershipKey is empty (set SI_MEMBERSHIP_KEY)");
  }
  const baseUrl = validateBaseUrl(config.baseUrl);
  const logger = config.logger ?? consoleLogger;
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  const cache = config.cache ?? memoryCache({ now });
  let lockStore = config.locks;
  if (!lockStore) {
    lockStore = memoryLockStore({ now });
    logger.warn(
      "[si-sdk/server] no lock store configured: using memoryLockStore(), which is per-process. Pass `locks` (e.g. supabaseLockStore) in production."
    );
  }
  const http = createHttp({
    baseUrl,
    bearer: config.membershipKey.trim(),
    fetch: fetchImpl,
    timeoutMs: config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : 3e3,
    logger
  });
  const membership = createMembership({
    http,
    cache,
    logger,
    now,
    allowTtlSeconds: clampTtl(config.membership?.allowTtlSeconds, MAX_ALLOW_TTL_SECONDS),
    denyTtlSeconds: clampTtl(config.membership?.denyTtlSeconds, MAX_DENY_TTL_SECONDS)
  });
  const organizations = createOrganizations(membership);
  const auth = createAuth({
    http,
    logger,
    now,
    baseUrl,
    config: config.auth,
    // Separate by default: principals carry email, so they stay in process unless the app opts in.
    cache: config.auth?.cache ?? memoryCache({ now })
  });
  const locks = createLocks(lockStore, config.lockTtlSeconds && config.lockTtlSeconds > 0 ? config.lockTtlSeconds : DEFAULT_LOCK_TTL_SECONDS);
  const detection = createDetection({
    cache,
    now,
    enabled: config.detection?.enabled !== false,
    windowSeconds: config.detection?.windowSeconds ?? DEFAULT_DETECTION_WINDOW_SECONDS
  });
  const audit = createAudit({ http, logger, onAudit: config.onAudit, forwarding: config.auditForwarding });
  const mcp = createMcp({ membership, organizations, locks, detection, audit, logger, now, conversation: config.conversation });
  return { auth, membership, organizations, locks, detection, audit, mcp };
}

// src/server/adapters/supabase.ts
var SUPABASE_LOCK_STORE_SQL = `-- @supreme-ai/si-sdk/server: conversation-key lock store
create table if not exists public.si_conversation_locks (
  key        text primary key,
  value      text not null,
  expires_at timestamptz not null
);

-- No policies: only the service role (which bypasses RLS) may touch it.
alter table public.si_conversation_locks enable row level security;

create index if not exists si_conversation_locks_expires_at_idx
  on public.si_conversation_locks (expires_at);

create or replace function public.si_lock_get(p_key text)
returns text
language sql
as $$
  select value from public.si_conversation_locks
  where key = p_key and expires_at > now();
$$;

create or replace function public.si_lock_set_if_absent(p_key text, p_value text, p_ttl_seconds integer)
returns table (created boolean, value text)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_value text;
begin
  insert into public.si_conversation_locks as l (key, value, expires_at)
  values (p_key, p_value, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update
    set value = excluded.value, expires_at = excluded.expires_at
    where l.expires_at <= now()
  returning l.value into v_value;

  if found then
    -- Retention: each new bind purges up to 100 rows expired over a day ago.
    delete from public.si_conversation_locks
     where key in (select g.key from public.si_conversation_locks g
                    where g.expires_at < now() - interval '1 day'
                    order by g.expires_at
                    limit 100
                    for update skip locked);
    return query select true, v_value;
    return;
  end if;

  select l.value into v_value from public.si_conversation_locks l where l.key = p_key;
  return query select false, v_value;
end;
$$;

create or replace function public.si_lock_touch(p_key text, p_ttl_seconds integer)
returns boolean
language plpgsql
as $$
begin
  update public.si_conversation_locks
     set expires_at = now() + make_interval(secs => p_ttl_seconds)
   where key = p_key and expires_at > now();
  return found;
end;
$$;

create or replace function public.si_lock_delete(p_key text)
returns void
language sql
as $$
  delete from public.si_conversation_locks where key = p_key;
$$;

revoke all on table public.si_conversation_locks from public, anon, authenticated;
grant select, insert, update, delete on table public.si_conversation_locks to service_role;
revoke execute on function public.si_lock_get(text) from public, anon, authenticated;
revoke execute on function public.si_lock_set_if_absent(text, text, integer) from public, anon, authenticated;
revoke execute on function public.si_lock_touch(text, integer) from public, anon, authenticated;
revoke execute on function public.si_lock_delete(text) from public, anon, authenticated;
grant execute on function public.si_lock_get(text) to service_role;
grant execute on function public.si_lock_set_if_absent(text, text, integer) to service_role;
grant execute on function public.si_lock_touch(text, integer) to service_role;
grant execute on function public.si_lock_delete(text) to service_role;
`;
function supabaseLockStore(client, options = {}) {
  const prefix = options.functionPrefix ?? "si_lock";
  const call = async (fn, args) => {
    const { data, error } = await client.rpc(`${prefix}_${fn}`, args);
    if (error) {
      const message = typeof error === "object" && error && "message" in error ? String(error.message) : String(error);
      throw new Error(`${prefix}_${fn} failed: ${message}`);
    }
    return data;
  };
  return {
    async get(key) {
      const data = await call("get", { p_key: key });
      if (data === null || data === void 0) return null;
      if (typeof data !== "string") throw new Error(`${prefix}_get returned ${typeof data}`);
      return data;
    },
    async setIfAbsent(key, value, ttlSeconds) {
      const data = await call("set_if_absent", { p_key: key, p_value: value, p_ttl_seconds: Math.ceil(ttlSeconds) });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object") throw new Error(`${prefix}_set_if_absent returned no row`);
      const { created, value: stored } = row;
      if (typeof created !== "boolean" || typeof stored !== "string") {
        throw new Error(`${prefix}_set_if_absent returned a malformed row`);
      }
      return { created, value: stored };
    },
    async touch(key, ttlSeconds) {
      const data = await call("touch", { p_key: key, p_ttl_seconds: Math.ceil(ttlSeconds) });
      return data === true;
    },
    async delete(key) {
      await call("delete", { p_key: key });
    }
  };
}

// src/server/actions/errors.ts
var STATUS = {
  bad_request: 400,
  unauthenticated: 401,
  org_not_authorized: 403,
  unknown_action: 404,
  unknown_job: 404,
  validation_failed: 422,
  internal_error: 500,
  upstream_unavailable: 503
};
var SiActionError = class extends Error {
  code;
  status;
  retryable;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "SiActionError";
    this.code = code;
    this.status = STATUS[code];
    this.retryable = code === "upstream_unavailable" || code === "internal_error";
    this.details = details;
  }
};

// src/server/actions/schema.ts
function validate(value, schema, path = "input") {
  const errors = [];
  const types = schema.type === void 0 ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.some((t) => matchesType(value, t))) {
    return [`${path}: must be ${types.join(" or ")}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path}: must be at least ${schema.minLength} characters`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path}: must be at most ${schema.maxLength} characters`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (value[name] === void 0) errors.push(`${path}.${name}: is required`);
    }
    for (const [name, child] of Object.entries(value)) {
      if (properties[name]) {
        errors.push(...validate(child, properties[name], `${path}.${name}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${name}: is not allowed`);
      }
    }
  }
  return errors;
}
function matchesType(value, type) {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/server/actions/auth.ts
function audienceList(aud) {
  if (typeof aud === "string") return [aud];
  return Array.isArray(aud) ? aud.filter((a) => typeof a === "string") : [];
}
function decodePayload(token) {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - part.length % 4) % 4);
    const payload = JSON.parse(atob(b64));
    return isObject(payload) ? payload : null;
  } catch {
    return null;
  }
}
function checkClaims(claims, opts) {
  if (claims.type !== "service") return "not a service token";
  if (claims.iss !== opts.issuer) return "wrong issuer";
  const aud = audienceList(claims.aud);
  if (!aud.includes(opts.audience)) return "wrong audience";
  const scoped = aud.filter((a) => a.startsWith(`${opts.audience}:`));
  if (scoped.length > 0 && !scoped.includes(`${opts.audience}:${opts.app}`)) return "token was issued for another app";
  if (typeof claims.exp !== "number" || claims.exp <= opts.nowSeconds) return "expired";
  if (!Number.isInteger(Number(claims.org_id)) || !Number.isInteger(Number(claims.user_id ?? claims.sub))) return "missing org or user";
  return null;
}
async function verifyServiceToken(authorization, opts) {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) throw new SiActionError("unauthenticated", "Missing bearer token.");
  const token = match[1].trim();
  const local = decodePayload(token);
  const localProblem = local ? checkClaims(local, opts) : "malformed token";
  if (local === null || localProblem) throw new SiActionError("unauthenticated", `Invalid service token: ${localProblem}.`);
  let status;
  let body2;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await opts.fetch(`${opts.hubUrl}/api/verify-session-jwt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token }),
      redirect: "manual",
      signal: controller.signal
    });
    status = res.status;
    body2 = JSON.parse(await res.text() || "null");
  } catch {
    throw new SiActionError("upstream_unavailable", "Could not reach the SI hub to verify the token.");
  } finally {
    clearTimeout(timer);
  }
  if (status === 400 || status === 401) throw new SiActionError("unauthenticated", "The SI hub rejected the token.");
  if (status !== 200 || !isObject(body2) || body2.valid !== true || !isObject(body2.claims)) {
    throw new SiActionError("upstream_unavailable", `The SI hub verifier answered HTTP ${status}.`);
  }
  const claims = body2.claims;
  const same = (k) => String(claims[k]) === String(local[k]);
  if (!same("type") || !same("iss") || !same("org_id") || String(claims.user_id ?? claims.sub) !== String(local.user_id ?? local.sub)) {
    throw new SiActionError("unauthenticated", "Verified claims do not match the presented token.");
  }
  return { claims: local, organizationId: Number(local.org_id), userId: Number(local.user_id ?? local.sub) };
}

// src/server/actions/callback.ts
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
var HUB_DOMAIN = "supremegroup.ai";
function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}
function checkCallbackUrl(url, hubUrl) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new InvalidArgumentError("callback url must be an absolute URL");
  }
  const host = u.hostname.toLowerCase();
  const localHub = isLoopbackHost(new URL(hubUrl).hostname);
  const local = localHub && isLoopbackHost(host) && (u.protocol === "https:" || u.protocol === "http:");
  const hub = (host === HUB_DOMAIN || host.endsWith(`.${HUB_DOMAIN}`)) && u.protocol === "https:";
  if (!local && !hub) {
    throw new InvalidArgumentError(
      localHub ? `callback url must be https on ${HUB_DOMAIN} or a loopback URL` : `callback url must be https on ${HUB_DOMAIN}`
    );
  }
  return u.toString();
}
function body(result) {
  const job = typeof result.jobId === "string" && result.jobId !== "" ? { job_id: result.jobId } : {};
  if (result.status === "completed") return JSON.stringify({ status: "completed", ...job, output: result.output });
  const e = result.error ?? { code: "app_failed", message: "The job failed." };
  return JSON.stringify({
    status: "failed",
    ...job,
    error: {
      code: String(e.code || "app_failed").slice(0, 64),
      message: String(e.message || "The job failed.").slice(0, 2e3),
      retryable: e.retryable === true
    }
  });
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var retryable = (status) => status === 0 || status === 429 || status >= 500;
async function completeCallback(callback, result, fetchImpl, hubUrl, options = {}) {
  if (!callback || typeof callback.token !== "string" || callback.token === "") throw new InvalidArgumentError("callback token is required");
  if (result?.status !== "completed" && result?.status !== "failed") throw new InvalidArgumentError("result status must be 'completed' or 'failed'");
  if (result.status === "completed" && !isObject(result.output)) throw new InvalidArgumentError("completed output must be an object");
  const url = checkCallbackUrl(callback.url, hubUrl);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 1e4);
  const retries = Math.max(0, Math.min(10, options.retries ?? 3));
  const payload = body(result);
  let last = { delivered: false, accepted: false, status: 0, code: "upstream_unavailable" };
  let retryAfterMs = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1));
    retryAfterMs = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${callback.token}` },
        body: payload,
        // Never follow a redirect: it could carry the bearer token to another host.
        redirect: "manual",
        signal: controller.signal
      });
      if (res.status >= 300 && res.status < 400) {
        return { delivered: false, accepted: false, status: res.status, code: "redirect_refused" };
      }
      let parsed = null;
      try {
        parsed = JSON.parse(await res.text() || "null");
      } catch {
        parsed = null;
      }
      if (res.status >= 200 && res.status < 300) {
        const ok = isObject(parsed) ? parsed : {};
        const accepted = ok.accepted !== false;
        return {
          delivered: true,
          accepted,
          status: res.status,
          ...accepted ? {} : { code: typeof ok.reason === "string" ? ok.reason : "invalid_output" },
          ...Array.isArray(ok.errors) ? { errors: ok.errors.map(String) } : {}
        };
      }
      const err = isObject(parsed) && isObject(parsed.error) ? parsed.error : null;
      const validation = isObject(parsed) && isObject(parsed.errors) ? Object.values(parsed.errors).flat().map(String) : void 0;
      last = {
        delivered: false,
        accepted: false,
        status: res.status,
        code: typeof err?.code === "string" ? err.code : res.status === 422 ? "validation_failed" : `http_${res.status}`,
        ...validation ? { errors: validation } : {}
      };
      if (!retryable(res.status)) return last;
      const after = Number(res.headers.get("retry-after"));
      if (res.status === 429 && Number.isFinite(after) && after >= 0) retryAfterMs = Math.min(after, 60) * 1e3;
    } catch {
      last = { delivered: false, accepted: false, status: 0, code: "upstream_unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

// src/server/actions/index.ts
var SI_ACTIONS_VERSION = "1";
var SI_ACTIONS_MANIFEST_PATH = "/.well-known/si-actions.json";
var ID_PATTERN = /^[a-z0-9_]{1,48}$/;
var JOB_ROUTE = /\/si\/actions\/([^/]+)\/jobs\/([^/]+)$/;
function acceptSiAction(options = {}) {
  const { jobId } = options;
  if (jobId !== void 0 && (typeof jobId !== "string" || jobId === "" || jobId.length > 255)) {
    throw new InvalidArgumentError("jobId must be a non-empty string of at most 255 characters");
  }
  return Object.freeze({ __siAccepted: true, jobId, pollUrl: options.pollUrl, estimatedSeconds: options.estimatedSeconds });
}
function isAccepted(value) {
  return isObject(value) && value.__siAccepted === true;
}
var consoleLogger2 = {
  warn: (message, context) => context ? console.warn(message, context) : console.warn(message),
  error: (message, context) => context ? console.error(message, context) : console.error(message)
};
function json(status, body2, extra = {}) {
  return { status, headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body2) };
}
function errorResponse(e) {
  return json(e.status, { error: { code: e.code, message: e.message, retryable: e.retryable, ...e.details ? { details: e.details } : {} } });
}
function origin(url, name) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    throw new InvalidArgumentError(`${name} must be an absolute URL`);
  }
}
function isAsync(a) {
  return a.execution?.mode === "async";
}
function int(value) {
  const n = Number(value);
  return value !== void 0 && value !== null && Number.isInteger(n) ? n : null;
}
function createSiActions(config) {
  if (!config || typeof config !== "object") throw new InvalidArgumentError("config is required");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.app ?? "")) throw new InvalidArgumentError("app must be the lowercase app slug");
  const baseUrl = origin(config.baseUrl, "baseUrl");
  const hubUrl = origin(config.hubUrl, "hubUrl");
  if (!hubUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hubUrl)) {
    throw new InvalidArgumentError("hubUrl must use https (http is allowed for localhost only)");
  }
  const logger = config.logger ?? consoleLogger2;
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  const issuer = config.issuer ?? "supreme-intelligence";
  const audience = config.audience ?? "si-actions";
  const verifyTimeoutMs = Math.max(1, config.verifyTimeoutMs ?? 5e3);
  const actions = /* @__PURE__ */ new Map();
  for (const a of config.actions ?? []) {
    if (!ID_PATTERN.test(a.id)) throw new InvalidArgumentError(`action id '${a.id}' must match ${ID_PATTERN}`);
    if (actions.has(a.id)) throw new InvalidArgumentError(`duplicate action id '${a.id}'`);
    if (a.inputSchema?.type !== "object" || a.outputSchema?.type !== "object") {
      throw new InvalidArgumentError(`action '${a.id}' schemas must be of type object`);
    }
    if (a.getJob && a.execution?.mode !== "async") throw new InvalidArgumentError(`action '${a.id}' has getJob but is not async`);
    actions.set(a.id, a);
  }
  const manifest = () => ({
    si_actions_version: SI_ACTIONS_VERSION,
    app: config.app,
    base_url: baseUrl,
    actions: [...actions.values()].map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      input_schema: a.inputSchema,
      output_schema: a.outputSchema,
      read_only: a.annotations?.readOnlyHint === true,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true, ...a.annotations ?? {} },
      execution: isAsync(a) ? { mode: "async", typical_seconds: a.execution?.typicalSeconds ?? 60, max_seconds: a.execution?.maxSeconds ?? 900 } : { mode: "sync", typical_seconds: a.execution?.typicalSeconds ?? 10, max_seconds: a.execution?.maxSeconds ?? 120 },
      examples: a.examples ?? []
    }))
  });
  const verify = (request) => verifyServiceToken(request.headers.get("authorization"), {
    issuer,
    audience,
    app: config.app,
    hubUrl,
    fetch: fetchImpl,
    nowSeconds: Math.floor(now() / 1e3),
    timeoutMs: verifyTimeoutMs
  });
  function contextFrom(service, request, callback) {
    const claims = service.claims;
    return {
      organizationId: service.organizationId,
      organizationSlug: typeof claims.org_slug === "string" ? claims.org_slug : null,
      userId: service.userId,
      workflowId: int(claims.workflow_id),
      runId: int(claims.run_id),
      nodeId: typeof claims.node_id === "string" ? claims.node_id : null,
      attempt: int(claims.attempt) ?? 1,
      idempotencyKey: request.headers.get("x-si-idempotency-key") || null,
      callback
    };
  }
  function checkOutput(action, output) {
    if (!isObject(output)) throw new SiActionError("internal_error", "The action returned a non-object output.");
    const problems = validate(output, action.outputSchema, "output");
    if (problems.length > 0) {
      logger.error?.("[si-sdk/actions] output does not match output_schema", { action: action.id, errors: problems });
      throw new SiActionError("internal_error", "The action produced output that does not match its schema.");
    }
    return output;
  }
  function acceptedResponse(action, accepted) {
    if (!isAsync(action)) {
      logger.error?.("[si-sdk/actions] a sync action returned acceptSiAction()", { action: action.id });
      throw new SiActionError("internal_error", "The action failed.");
    }
    const base = new URL(baseUrl);
    let pollUrl;
    const raw = accepted.pollUrl ?? (action.getJob && accepted.jobId ? `/si/actions/${action.id}/jobs/${encodeURIComponent(accepted.jobId)}` : void 0);
    if (raw !== void 0) {
      let u = null;
      try {
        u = new URL(raw, base.origin);
      } catch {
        u = null;
      }
      if (u !== null && u.host === base.host) pollUrl = u.toString();
      else logger.warn?.("[si-sdk/actions] poll_url dropped: invalid or not on baseUrl's host", { action: action.id });
    }
    const est = accepted.estimatedSeconds;
    return json(202, {
      status: "accepted",
      ...accepted.jobId ? { job_id: accepted.jobId } : {},
      ...pollUrl ? { poll_url: pollUrl } : {},
      ...typeof est === "number" && Number.isFinite(est) && est > 0 ? { estimated_seconds: Math.ceil(est) } : {}
    });
  }
  async function execute(actionId, request) {
    const action = actions.get(actionId);
    if (!action) throw new SiActionError("unknown_action", `Unknown action '${actionId}'.`);
    const service = await verify(request);
    let body2;
    try {
      body2 = JSON.parse(await request.text() || "{}");
    } catch {
      throw new SiActionError("bad_request", "Body must be JSON.");
    }
    if (!isObject(body2)) throw new SiActionError("bad_request", "Body must be a JSON object.");
    if (body2.action_id !== void 0 && body2.action_id !== actionId) throw new SiActionError("bad_request", "action_id does not match the path.");
    const input = body2.input === void 0 ? {} : body2.input;
    const problems = validate(input, action.inputSchema);
    if (problems.length > 0) throw new SiActionError("validation_failed", problems[0], { errors: problems });
    const bodyContext = isObject(body2.context) ? body2.context : {};
    const callback = typeof bodyContext.callback_url === "string" && typeof bodyContext.callback_token === "string" && bodyContext.callback_token !== "" ? { url: bodyContext.callback_url, token: bodyContext.callback_token } : null;
    const context = contextFrom(service, request, callback);
    const result = await action.handler(input, context);
    if (isAccepted(result)) return acceptedResponse(action, result);
    return json(200, { status: "completed", output: checkOutput(action, result) });
  }
  async function job(actionId, jobId, request) {
    const action = actions.get(actionId);
    if (!action) throw new SiActionError("unknown_action", `Unknown action '${actionId}'.`);
    if (!action.getJob) throw new SiActionError("unknown_job", "This action has no pollable jobs.");
    const context = contextFrom(await verify(request), request, null);
    const state = await action.getJob(jobId, context);
    if (!state) throw new SiActionError("unknown_job", "Unknown job.");
    if (state.status === "completed") return json(200, { status: "completed", job_id: jobId, output: checkOutput(action, state.output) });
    if (state.status === "failed") return json(200, { status: "failed", job_id: jobId, error: state.error });
    return json(200, { status: "running", job_id: jobId, ...typeof state.progress === "number" ? { progress: state.progress } : {} });
  }
  const completeJob = async (actionId, callback, result, options) => {
    const action = actions.get(actionId);
    if (!action) throw new InvalidArgumentError(`unknown action '${actionId}'`);
    if (result?.status === "completed") {
      try {
        checkOutput(action, result.output);
      } catch {
        return completeCallback(callback, { jobId: result.jobId, status: "failed", error: { code: "internal_error", message: "The action produced output that does not match its schema.", retryable: false } }, fetchImpl, hubUrl, options);
      }
    }
    return completeCallback(callback, result, fetchImpl, hubUrl, options);
  };
  async function handle(request) {
    let path;
    try {
      path = new URL(request.url).pathname.replace(/\/+$/, "");
    } catch {
      return errorResponse(new SiActionError("bad_request", "Invalid request URL."));
    }
    try {
      if (request.method === "GET" && path === SI_ACTIONS_MANIFEST_PATH) {
        return json(200, manifest(), { "Cache-Control": "public, max-age=300" });
      }
      const m = /\/si\/actions\/([^/]+)$/.exec(path);
      if (request.method === "POST" && m) return await execute(decodeURIComponent(m[1]), request);
      const j = JOB_ROUTE.exec(path);
      if (request.method === "GET" && j) return await job(decodeURIComponent(j[1]), decodeURIComponent(j[2]), request);
      if (j) throw new SiActionError("unknown_job", "Unknown job.");
      throw new SiActionError("unknown_action", "Not an SI Actions route.");
    } catch (e) {
      if (e instanceof SiActionError) return errorResponse(e);
      logger.error?.("[si-sdk/actions] action threw", { error: e instanceof Error ? e.name : typeof e });
      return errorResponse(new SiActionError("internal_error", "The action failed."));
    }
  }
  return { manifest, handle, completeJob };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUDIT_EVENTS_PATH,
  AppInactiveError,
  DEFAULT_CODEX_HEADERS,
  DEFAULT_DETECTION_WINDOW_SECONDS,
  DEFAULT_LOCK_TTL_SECONDS,
  DEFAULT_SI_HEADER,
  GRANT_STATUS_CHUNK_SIZE,
  GRANT_STATUS_PATH,
  INTROSPECT_PATH,
  InsufficientScopeError,
  InvalidArgumentError,
  InvalidTokenError,
  LockStoreUnavailableError,
  MAX_ALLOW_TTL_SECONDS,
  MAX_DECLARED_SCOPES,
  MAX_DENY_TTL_SECONDS,
  MAX_GRANT_STATUS_TTL_SECONDS,
  MAX_INTROSPECTION_TTL_SECONDS,
  MAX_SCOPE_MANIFEST_BYTES,
  MisconfiguredKeyError,
  OrgAccessDeniedError,
  OrgLockedError,
  PROTECTED_RESOURCE_METADATA_PATH,
  SCOPE_MANIFEST_PATH,
  SCOPE_MANIFEST_VERSION,
  SERVER_SDK_VERSION,
  SI_ACTIONS_MANIFEST_PATH,
  SI_ACTIONS_VERSION,
  SUPABASE_LOCK_STORE_SQL,
  SiActionError,
  SiServerError,
  SiUnavailableError,
  SiValidationError,
  UserGoneError,
  acceptSiAction,
  annotations,
  audienceList,
  bearerChallenge,
  bearerToken,
  canonicalResourceUri,
  conversationKey,
  createSiActions,
  createSiServerClient,
  errorResult,
  hashConversationKey,
  isSiServerError,
  isVerifiedPrincipal,
  labelResult,
  memoryCache,
  memoryLockStore,
  orgBanner,
  requireScope,
  scopeManifest,
  supabaseLockStore,
  validateJsonSchema
});
