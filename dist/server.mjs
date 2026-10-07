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
  constructor(reason, detail, status) {
    super(
      "si_unavailable",
      `SI membership check unavailable (${reason}${status ? `, HTTP ${status}` : ""})${detail ? `: ${detail}` : ""}`,
      "Supreme Intelligence could not confirm your access right now. Try again in a moment."
    );
    this.reason = reason;
    this.status = status;
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
function isSiServerError(err) {
  return err instanceof SiServerError;
}

// src/server/http.ts
var SERVER_SDK_VERSION = "1.2.1";
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
  const sleep = options.sleep ?? defaultSleep;
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
      let body;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = void 0;
        }
      }
      checkMinVersion(response.headers);
      return { status: response.status, body, headers: response.headers };
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
      await sleep(jitter(random));
      return attempt(req);
    }
    if (first.status < 500 || !retry || req.noRetryOn?.(first)) return first;
    const retryAfter = parseRetryAfter(first.headers.get("retry-after"));
    if (retryAfter !== null && retryAfter > maxRetryDelayMs) return first;
    await sleep(retryAfter ?? jitter(random));
    return attempt(req);
  };
}
function jitter(random) {
  return 100 + Math.floor(random() * 200);
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
function parseMembershipBody(body) {
  if (!body || typeof body !== "object") return null;
  const data = body.data;
  if (!data || typeof data !== "object") return null;
  const d = data;
  const user = d.user;
  const app = d.app;
  if (!user || !isInt(user.id)) return null;
  if (!app || !isInt(app.id) || !isStr(app.name)) return null;
  if (typeof d.is_superadmin !== "boolean") return null;
  if (!Array.isArray(d.organizations)) return null;
  const organizations = [];
  for (const raw of d.organizations) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw;
    if (!isInt(o.id) || !isStr(o.slug) || !isStr(o.name) || !isStr(o.app_grant)) return null;
    if (!Array.isArray(o.roles) || !o.roles.every(isStr)) return null;
    organizations.push({ id: o.id, slug: o.slug, name: o.name, roles: [...o.roles], appGrant: o.app_grant });
  }
  const meta = body.meta;
  return {
    user: { id: user.id },
    app: { id: app.id, name: app.name },
    isSuperadmin: d.is_superadmin,
    organizations,
    generatedAt: meta && isStr(meta.generated_at) ? meta.generated_at : ""
  };
}
function errorCode(result) {
  const body = result.body;
  return body && typeof body === "object" && isStr(body.error) ? body.error : void 0;
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
        throw new SiUnavailableError("rate_limited", void 0, 429);
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
async function hashConversationKey(key) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
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
    const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
    const tool = typeof input.tool === "string" ? input.tool.trim() : "";
    const principalId = (input.principalId ?? String(input.userId)).trim();
    const kind = input.kind === "read" ? "read" : "write";
    const key = typeof input.conversationKey === "string" && input.conversationKey.trim() ? input.conversationKey.trim() : null;
    const mode = key ? "locked" : "soft";
    let keyHash = null;
    let organizationId = null;
    const audit = (outcome) => deps.audit.emit({
      principalId: principalId || String(input.userId),
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
      if (!clientId) throw new InvalidArgumentError("clientId is required");
      if (!tool) throw new InvalidArgumentError("tool is required");
      if (!principalId) throw new InvalidArgumentError("principalId must not be empty");
      if (key) keyHash = await hashConversationKey(key);
      const org = await deps.organizations.resolve(input.userId, input.organization);
      organizationId = org.id;
      try {
        await deps.locks.bindOrg({ principalId, clientId, keyHash, organizationId: org.id });
      } catch (err) {
        if (err instanceof OrgLockedError) {
          const lockedId = err.lockedOrganization.id;
          let locked = { id: lockedId };
          try {
            const m = await deps.membership.get(input.userId);
            const o = m.organizations.find((x) => x.id === lockedId);
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
        userId: String(input.userId),
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
    async handler({ userId }) {
      try {
        const m = await deps.membership.get(userId);
        const payload = {
          data: m.organizations.map((o) => ({
            organization_id: o.id,
            slug: o.slug,
            name: o.name,
            roles: [...o.roles],
            app_grant: o.appGrant
          })),
          meta: { count: m.organizations.length }
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
function createOrganizations(membership) {
  return {
    async resolve(userId, organization) {
      const raw = typeof organization === "number" ? String(organization) : typeof organization === "string" ? organization.trim() : "";
      if (!raw || raw.length > 200) throw new InvalidArgumentError("organization must be an org slug or numeric id");
      const match = /^\d+$/.test(raw) ? (() => {
        const id = Number(raw);
        return (o) => o.id === id;
      })() : (() => {
        const slug = raw.toLowerCase();
        return (o) => o.slug.toLowerCase() === slug;
      })();
      const { organization: org } = await membership.findOrganization(userId, match);
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
  const locks = createLocks(lockStore, config.lockTtlSeconds && config.lockTtlSeconds > 0 ? config.lockTtlSeconds : DEFAULT_LOCK_TTL_SECONDS);
  const detection = createDetection({
    cache,
    now,
    enabled: config.detection?.enabled !== false,
    windowSeconds: config.detection?.windowSeconds ?? DEFAULT_DETECTION_WINDOW_SECONDS
  });
  const audit = createAudit({ http, logger, onAudit: config.onAudit, forwarding: config.auditForwarding });
  const mcp = createMcp({ membership, organizations, locks, detection, audit, logger, now, conversation: config.conversation });
  return { membership, organizations, locks, detection, audit, mcp };
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
export {
  AUDIT_EVENTS_PATH,
  AppInactiveError,
  DEFAULT_CODEX_HEADERS,
  DEFAULT_DETECTION_WINDOW_SECONDS,
  DEFAULT_LOCK_TTL_SECONDS,
  DEFAULT_SI_HEADER,
  InvalidArgumentError,
  LockStoreUnavailableError,
  MAX_ALLOW_TTL_SECONDS,
  MAX_DENY_TTL_SECONDS,
  MisconfiguredKeyError,
  OrgAccessDeniedError,
  OrgLockedError,
  SERVER_SDK_VERSION,
  SUPABASE_LOCK_STORE_SQL,
  SiServerError,
  SiUnavailableError,
  UserGoneError,
  annotations,
  conversationKey,
  createSiServerClient,
  errorResult,
  hashConversationKey,
  isSiServerError,
  labelResult,
  memoryCache,
  memoryLockStore,
  orgBanner,
  supabaseLockStore
};
