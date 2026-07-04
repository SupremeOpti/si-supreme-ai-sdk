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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CreditSystemClient: () => CreditSystemClient,
  CreditSystemProvider: () => CreditSystemProvider,
  ParentIntegrator: () => ParentIntegrator,
  PersonasClient: () => PersonasClient,
  ReportsClient: () => ReportsClient,
  SkillsClient: () => SkillsClient,
  default: () => index_default,
  useCreditContext: () => useCreditContext,
  useCreditSystem: () => useCreditSystem,
  useSwitchOrganization: () => useSwitchOrganization
});
module.exports = __toCommonJS(index_exports);

// src/utils/EventEmitter.ts
var EventEmitter = class {
  constructor() {
    this.events = /* @__PURE__ */ new Map();
    this.debug = false;
  }
  /**
   * Subscribe to an event
   */
  on(event, listener) {
    if (!this.events.has(event)) {
      this.events.set(event, /* @__PURE__ */ new Set());
    }
    this.events.get(event).add(listener);
    return this;
  }
  /**
   * Subscribe to an event once
   */
  once(event, listener) {
    const onceWrapper = (data) => {
      listener(data);
      this.off(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }
  /**
   * Unsubscribe from an event
   */
  off(event, listener) {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }
  /**
   * Emit an event
   */
  emit(event, data) {
    const listeners = this.events.get(event);
    if (!listeners || listeners.size === 0) return false;
    listeners.forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        if (this.debug) {
          console.error(`Error in event listener for "${String(event)}":`, error);
        }
      }
    });
    return true;
  }
  /**
   * Remove all listeners for an event or all events
   */
  removeAllListeners(event) {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }
  /**
   * Get listener count for an event
   */
  listenerCount(event) {
    const listeners = this.events.get(event);
    return listeners ? listeners.size : 0;
  }
};

// src/utils/MessageBridge.ts
var MessageBridge = class extends EventEmitter {
  constructor(allowedOrigins = [], debug = false) {
    super();
    this.allowedOrigins = allowedOrigins;
    this.debug = debug;
    this.isIframe = window !== window.parent;
    this.setupMessageListener();
  }
  /**
   * Set up message listener
   */
  setupMessageListener() {
    this.messageHandler = (event) => {
      if (this.debug) {
        console.log("[SDK MessageBridge] Received postMessage:", {
          origin: event.origin,
          type: event.data?.type,
          allowedOrigins: this.allowedOrigins,
          isValid: this.isValidOrigin(event.origin)
        });
      }
      if (!this.isValidOrigin(event.origin)) {
        if (this.debug) {
          console.warn("[SDK MessageBridge] \u274C Message from untrusted origin:", {
            receivedOrigin: event.origin,
            allowedOrigins: this.allowedOrigins,
            messageType: event.data?.type
          });
        }
        return;
      }
      if (event.data && event.data.type) {
        if (this.debug) {
          console.log("[SDK MessageBridge] \u2705 Message accepted:", event.data);
        }
        this.emit(event.data.type, event.data);
        this.emit("message", event.data);
      }
    };
    window.addEventListener("message", this.messageHandler);
  }
  /**
   * Validate message origin
   */
  isValidOrigin(origin) {
    if (origin === window.location.origin) {
      return true;
    }
    if (this.allowedOrigins.length === 0) {
      return true;
    }
    return this.allowedOrigins.includes(origin);
  }
  /**
   * Send message to parent window
   */
  sendToParent(type, data = {}) {
    if (!this.isIframe) {
      if (this.debug) {
        console.warn("Not in iframe, cannot send to parent");
      }
      return false;
    }
    const message = {
      type,
      ...data,
      timestamp: Date.now()
    };
    if (this.debug) {
      console.log("Sending to parent:", message);
    }
    window.parent.postMessage(message, "*");
    return true;
  }
  /**
   * Send message to iframe
   */
  sendToIframe(iframe, type, data = {}) {
    if (!iframe || !iframe.contentWindow) {
      if (this.debug) {
        console.warn("Invalid iframe element");
      }
      return false;
    }
    const message = {
      type,
      ...data,
      timestamp: Date.now()
    };
    if (this.debug) {
      console.log("Sending to iframe:", message);
    }
    iframe.contentWindow.postMessage(message, "*");
    return true;
  }
  /**
   * Add allowed origin
   */
  addAllowedOrigin(origin) {
    if (!this.allowedOrigins.includes(origin)) {
      this.allowedOrigins.push(origin);
    }
  }
  /**
   * Remove allowed origin
   */
  removeAllowedOrigin(origin) {
    const index = this.allowedOrigins.indexOf(origin);
    if (index > -1) {
      this.allowedOrigins.splice(index, 1);
    }
  }
  /**
   * Destroy the message bridge
   */
  destroy() {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
    }
    this.removeAllListeners();
  }
};

// src/utils/jwt.ts
function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}
function tokenHasRemainingLife(token, bufferSeconds = 30) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp * 1e3 - Date.now() > bufferSeconds * 1e3;
}

// src/utils/AuthManager.ts
var AuthManager = class {
  constructor(authUrl, debug = false) {
    this.authUrl = authUrl;
    this.debug = debug;
  }
  /**
   * Login with credentials
   */
  async login(email, password) {
    try {
      const response = await fetch(`${this.authUrl}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (response.ok && data.success && data.data) {
        if (this.debug) {
          console.log("Login successful");
        }
        return {
          success: true,
          tokens: data.data.tokens,
          user: data.data.user
        };
      } else {
        return {
          success: false,
          message: data.message || "Login failed"
        };
      }
    } catch (error) {
      if (this.debug) {
        console.error("Login error:", error);
      }
      return {
        success: false,
        message: error.message || "Network error"
      };
    }
  }
  /**
   * Validate JWT token
   */
  async validateToken(token) {
    try {
      const response = await fetch(`${this.authUrl}/validate`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });
      if (response.status === 429) {
        if (this.debug) {
          console.warn("[AuthManager] validate rate-limited (429) \u2014 falling back to local expiry check");
        }
        return tokenHasRemainingLife(token);
      }
      const data = await response.json();
      return response.ok && data.success;
    } catch (error) {
      if (this.debug) {
        console.error("Token validation error:", error);
      }
      return false;
    }
  }
  /**
   * Refresh JWT token
   *
   * On failure, `transient: true` marks outcomes that do NOT mean the
   * session is over (rate limiting, server errors, network loss) — callers
   * must retry later instead of treating them like an expired refresh
   * token. `retryAfterSeconds` carries the server's Retry-After when sent.
   */
  async refreshToken(refreshToken) {
    if (this.debug) {
      console.log("[AuthManager] \u{1F4E4} Sending token refresh request to server");
      console.log("[AuthManager] \u{1F510} Using refresh token (length):", refreshToken?.length || 0);
    }
    try {
      const response = await fetch(`${this.authUrl}/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      const data = await response.json();
      if (this.debug) {
        console.log("[AuthManager] \u{1F4E5} Server response status:", response.status);
        console.log("[AuthManager] \u{1F4E6} RAW Server response:", JSON.stringify(data, null, 2));
        console.log("[AuthManager] \u{1F4E6} Parsed response:", {
          success: data.success,
          hasData: !!data.data,
          hasTokensObject: !!data.data?.tokens,
          hasAccessToken: !!data.data?.access_token,
          hasRefreshToken: !!(data.data?.tokens?.refresh_token || data.data?.access_token)
        });
      }
      if (response.ok && data.success && data.data) {
        const hasNewRefreshToken = !!data.data.tokens?.refresh_token;
        const tokens = data.data.tokens || {
          access_token: data.data.access_token,
          refresh_token: void 0
          // Will be preserved by CreditSystemClient
        };
        if (this.debug) {
          console.log("[AuthManager] \u2705 Token refresh successful");
          console.log("[AuthManager] \u{1F39F}\uFE0F Received new access_token:", tokens.access_token?.substring(0, 20) + "...");
          if (hasNewRefreshToken) {
            console.log("[AuthManager] \u{1F504} Received NEW refresh_token:", tokens.refresh_token?.substring(0, 20) + "...");
          } else {
            console.log("[AuthManager] \u26A0\uFE0F Server did NOT return new refresh_token");
            console.log("[AuthManager] \u{1F4A1} CreditSystemClient will preserve existing refresh_token");
          }
        }
        return {
          success: true,
          tokens
        };
      } else {
        if (this.debug) {
          console.error("[AuthManager] \u274C Token refresh failed:", data.message);
        }
        const transient = response.status === 429 || response.status >= 500;
        const retryAfterHeader = response.headers.get("Retry-After");
        return {
          success: false,
          message: data.message || "Token refresh failed",
          transient,
          ...transient && retryAfterHeader ? { retryAfterSeconds: parseInt(retryAfterHeader, 10) || void 0 } : {}
        };
      }
    } catch (error) {
      if (this.debug) {
        console.error("[AuthManager] \u274C Token refresh network error:", error.message);
      }
      return {
        success: false,
        message: error.message || "Network error",
        // Network failure says nothing about the session — retry later.
        transient: true
      };
    }
  }
  /**
   * Logout
   */
  async logout(token) {
    try {
      const response = await fetch(`${this.authUrl}/logout`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });
      const data = await response.json();
      return response.ok && data.success;
    } catch (error) {
      if (this.debug) {
        console.error("Logout error:", error);
      }
      return false;
    }
  }
};

// src/utils/ApiClient.ts
var ApiClient = class {
  constructor(baseUrl, getToken, debug = false) {
    this.baseUrl = baseUrl;
    this.getToken = getToken;
    this.debug = debug;
  }
  /**
   * Make a GET request
   */
  async get(endpoint, params) {
    return this.request("GET", endpoint, void 0, params);
  }
  /**
   * Make a POST request
   */
  async post(endpoint, body) {
    return this.request("POST", endpoint, body);
  }
  /**
   * Make a PUT request
   */
  async put(endpoint, body) {
    return this.request("PUT", endpoint, body);
  }
  /**
   * Make a DELETE request
   */
  async delete(endpoint) {
    return this.request("DELETE", endpoint);
  }
  /**
   * Make a request
   */
  async request(method, endpoint, body, params) {
    const token = this.getToken();
    if (!token) {
      return {
        success: false,
        error: "No authentication token available"
      };
    }
    try {
      let url = `${this.baseUrl}${endpoint}`;
      if (params && Object.keys(params).length > 0) {
        const queryString = new URLSearchParams(params).toString();
        url += `?${queryString}`;
      }
      const headers = {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      };
      const options = {
        method,
        headers
      };
      if (body && (method === "POST" || method === "PUT")) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      if (this.debug) {
        console.log(`[ApiClient] ${method} ${url}`, body || "");
      }
      const response = await fetch(url, options);
      const data = await response.json();
      if (response.ok && data.success) {
        return {
          success: true,
          data: data.data,
          message: data.message
        };
      } else {
        if (response.status === 401) {
          return {
            success: false,
            error: "Authentication failed",
            message: data.message || "Unauthorized"
          };
        } else if (response.status === 403) {
          return {
            success: false,
            error: "Access denied",
            message: data.message || "Forbidden"
          };
        } else {
          return {
            success: false,
            error: data.error || "Request failed",
            message: data.message || `Request failed with status ${response.status}`
          };
        }
      }
    } catch (error) {
      if (this.debug) {
        console.error("[ApiClient] Request error:", error);
      }
      return {
        success: false,
        error: error.message || "Network error",
        message: "Failed to connect to the server"
      };
    }
  }
  /**
   * Set the token (for dynamic updates)
   */
  setToken(getToken) {
    this.getToken = getToken;
  }
};

// src/utils/StorageManager.ts
var StorageManager = class {
  constructor(prefix = "", debug = false) {
    this.prefix = prefix;
    this.debug = debug;
  }
  /**
   * Get an item from storage
   */
  get(key) {
    try {
      const item = sessionStorage.getItem(this.prefix + key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      if (this.debug) {
        console.error("Storage get error:", error);
      }
      return null;
    }
  }
  /**
   * Set an item in storage
   */
  set(key, value) {
    try {
      sessionStorage.setItem(this.prefix + key, JSON.stringify(value));
      return true;
    } catch (error) {
      if (this.debug) {
        console.error("Storage set error:", error);
      }
      return false;
    }
  }
  /**
   * Remove an item from storage
   */
  remove(key) {
    try {
      sessionStorage.removeItem(this.prefix + key);
      return true;
    } catch (error) {
      if (this.debug) {
        console.error("Storage remove error:", error);
      }
      return false;
    }
  }
  /**
   * Clear all items with the prefix
   */
  clear() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => sessionStorage.removeItem(key));
      return true;
    } catch (error) {
      if (this.debug) {
        console.error("Storage clear error:", error);
      }
      return false;
    }
  }
  /**
   * Check if an item exists
   */
  has(key) {
    return sessionStorage.getItem(this.prefix + key) !== null;
  }
};

// src/core/PersonasClient.ts
var PersonasClient = class {
  constructor(config) {
    this.apiBaseUrl = config.apiBaseUrl;
    this.getAuthToken = config.getAuthToken;
    this.debug = config.debug || false;
  }
  /**
   * Log messages if debug mode is enabled
   */
  log(...args) {
    if (this.debug) {
      console.log("[PersonasClient]", ...args);
    }
  }
  /**
   * Make authenticated API request
   */
  async makeRequest(endpoint, options = {}) {
    const token = this.getAuthToken();
    if (!token) {
      this.log("\u274C No authentication token available");
      return {
        success: false,
        error: "Authentication required"
      };
    }
    try {
      this.log(`\u{1F4E1} Making request to: ${this.apiBaseUrl}${endpoint}`);
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
        ...options,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          ...options.headers
        }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        this.log(`\u2705 Request successful: ${endpoint}`);
        return {
          success: true,
          data: data.data,
          message: data.message
        };
      } else {
        this.log(`\u274C Request failed: ${data.message || "Unknown error"}`);
        return {
          success: false,
          error: data.message || "Request failed"
        };
      }
    } catch (error) {
      this.log(`\u274C Network error: ${error.message}`);
      return {
        success: false,
        error: error.message || "Network error"
      };
    }
  }
  /**
   * Get all personas
   * @param organizationId - Optional organization ID to filter personas
   * @param roleId - Optional role ID to filter personas
   */
  async getPersonas(organizationId, roleId) {
    this.log("\u{1F3AD} Fetching all personas...");
    const token = this.getAuthToken();
    if (!token) {
      this.log("\u274C No authentication token available");
      return {
        success: false,
        error: "Authentication required"
      };
    }
    const hasOrgId = organizationId !== void 0 && organizationId !== null && organizationId !== "";
    const hasRoleId = roleId !== void 0 && roleId !== null && roleId !== "";
    if (hasOrgId || hasRoleId) {
      if (!hasOrgId) {
        this.log("\u274C organization_id is required when passing manual parameters");
        return {
          success: false,
          error: "organization_id is required when passing manual parameters"
        };
      }
      if (!hasRoleId) {
        this.log("\u274C role_id is required when passing manual parameters");
        return {
          success: false,
          error: "role_id is required when passing manual parameters"
        };
      }
    }
    try {
      const params = new URLSearchParams();
      if (hasOrgId && hasRoleId) {
        params.append("organization_id", String(organizationId));
        params.append("role_id", String(roleId));
        this.log(`\u{1F4CB} Manual filtering - organization_id: ${organizationId}, role_id: ${roleId}`);
      } else {
        this.log("\u{1F4CB} Auto filtering - using JWT token data");
      }
      const queryString = params.toString();
      const url = `${this.apiBaseUrl}/personas/jwt/list${queryString ? `?${queryString}` : ""}`;
      this.log(`\u{1F4E1} Making request to: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      });
      if (!response.ok) {
        this.log(`\u274C HTTP error: ${response.status}`);
        return {
          success: false,
          error: `HTTP error: ${response.status}`
        };
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        this.log(`\u2705 Fetched ${data.length} personas`);
        return {
          success: true,
          personas: data
        };
      }
      if (data.success && data.data) {
        this.log(`\u2705 Fetched ${data.data.length} personas`);
        return {
          success: true,
          personas: data.data
        };
      }
      this.log(`\u274C Unexpected response format`);
      return {
        success: false,
        error: "Unexpected response format"
      };
    } catch (error) {
      this.log(`\u274C Error fetching personas: ${error.message}`);
      return {
        success: false,
        error: error.message || "Unknown error"
      };
    }
  }
  /**
   * Get a specific persona by ID
   */
  async getPersonaById(id) {
    this.log(`\u{1F3AD} Fetching persona with ID: ${id}`);
    try {
      const response = await this.makeRequest(`/get-persona/${id}`);
      if (response.success && response.data) {
        this.log(`\u2705 Fetched persona: ${response.data.name || "Unknown"}`);
        return {
          success: true,
          persona: response.data
        };
      } else {
        return {
          success: false,
          error: response.error || "Failed to fetch persona"
        };
      }
    } catch (error) {
      this.log(`\u274C Error fetching persona: ${error.message}`);
      return {
        success: false,
        error: error.message || "Unknown error"
      };
    }
  }
};

// src/core/ReportsClient.ts
var ReportsClient = class {
  constructor(config) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, "");
    this.getAuthToken = config.getAuthToken;
    this.getDefaultOrganizationId = config.getDefaultOrganizationId;
    this.debug = !!config.debug;
  }
  log(...args) {
    if (this.debug) {
      console.log("[ReportsClient]", ...args);
    }
  }
  resolveOrgId(explicit) {
    if (explicit !== void 0 && explicit !== null && explicit !== "") {
      return String(explicit);
    }
    const fallback = this.getDefaultOrganizationId?.();
    if (fallback !== void 0 && fallback !== null && fallback !== "") {
      return String(fallback);
    }
    return void 0;
  }
  async request(method, path, options = {}) {
    const token = this.getAuthToken();
    if (!token) {
      return { ok: false, status: 401, data: { error: "Authentication required" } };
    }
    let url = `${this.apiBaseUrl}${path}`;
    if (options.params && Object.keys(options.params).length > 0) {
      const qs = new URLSearchParams(options.params).toString();
      url += `?${qs}`;
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    };
    const init = { method, headers };
    if (options.body !== void 0 && (method === "POST" || method === "PATCH")) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    this.log(`\u{1F4E1} ${method} ${url}`);
    try {
      const response = await fetch(url, init);
      let data = null;
      try {
        data = await response.json();
      } catch {
      }
      this.log(`\u21A9\uFE0F  ${response.status} ${response.ok ? "OK" : "ERROR"}`);
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      this.log(`\u274C Network error: ${error?.message || error}`);
      return {
        ok: false,
        status: 0,
        data: { error: error?.message || "Network error" }
      };
    }
  }
  errorFrom(raw, fallback) {
    if (raw.data && typeof raw.data === "object") {
      if (typeof raw.data.error === "string") return raw.data.error;
      if (typeof raw.data.message === "string") return raw.data.message;
    }
    if (raw.status) return `${fallback} (${raw.status})`;
    return fallback;
  }
  /**
   * List the authenticated user's reports. Cursor-paginated.
   */
  async listReports(params = {}) {
    const orgId = this.resolveOrgId(params.organizationId);
    const query = {};
    if (orgId) query.organization_id = orgId;
    if (params.folderId !== void 0 && params.folderId !== null && params.folderId !== "") {
      query.folder_id = String(params.folderId);
    }
    if (params.cursor) query.cursor = params.cursor;
    if (params.perPage !== void 0 && params.perPage !== null) {
      query.per_page = String(params.perPage);
    }
    const raw = await this.request("GET", "", { params: query });
    if (raw.ok && raw.data?.success) {
      return {
        success: true,
        reports: Array.isArray(raw.data.reports) ? raw.data.reports : [],
        nextCursor: raw.data.next_cursor ?? null
      };
    }
    return {
      success: false,
      error: this.errorFrom(raw, "Failed to list reports"),
      reports: []
    };
  }
  /**
   * Fetch a single report (including its HTML body).
   */
  async getReport(id, options = {}) {
    const orgId = this.resolveOrgId(options.organizationId);
    const query = {};
    if (orgId) query.organization_id = orgId;
    const raw = await this.request("GET", `/${encodeURIComponent(String(id))}`, { params: query });
    if (raw.ok && raw.data?.success && raw.data.report) {
      return { success: true, report: raw.data.report };
    }
    return {
      success: false,
      error: this.errorFrom(raw, "Failed to fetch report"),
      validationErrors: raw.data?.errors
    };
  }
  /**
   * Create a report owned by the authenticated user.
   */
  async createReport(params) {
    const orgId = this.resolveOrgId(params.organizationId);
    const body = {
      title: params.title,
      body: params.body,
      visibility: params.visibility
    };
    if (orgId !== void 0) body.organization_id = Number(orgId) || orgId;
    if (params.folderId !== void 0 && params.folderId !== null) body.folder_id = params.folderId;
    if (params.pinned !== void 0) body.pinned = params.pinned;
    if (params.includeBody !== void 0) body.include_body = params.includeBody;
    const raw = await this.request("POST", "", { body });
    if (raw.ok && raw.data?.success && raw.data.report) {
      return { success: true, report: raw.data.report };
    }
    return {
      success: false,
      error: this.errorFrom(raw, "Failed to create report"),
      validationErrors: raw.data?.errors
    };
  }
  /**
   * Partially update a report. Only the authenticated user's own reports can
   * be updated (server-enforced); other reports return 403.
   */
  async updateReport(id, params) {
    const orgId = this.resolveOrgId(params.organizationId);
    const body = {};
    if (params.title !== void 0) body.title = params.title;
    if (params.body !== void 0) body.body = params.body;
    if (params.visibility !== void 0) body.visibility = params.visibility;
    if (params.folderId !== void 0) body.folder_id = params.folderId;
    if (params.pinned !== void 0) body.pinned = params.pinned;
    if (params.includeBody !== void 0) body.include_body = params.includeBody;
    if (orgId !== void 0) body.organization_id = Number(orgId) || orgId;
    const raw = await this.request("PATCH", `/${encodeURIComponent(String(id))}`, { body });
    if (raw.ok && raw.data?.success && raw.data.report) {
      return { success: true, report: raw.data.report };
    }
    return {
      success: false,
      error: this.errorFrom(raw, "Failed to update report"),
      validationErrors: raw.data?.errors
    };
  }
};

// src/core/SkillsClient.ts
var SkillsClient = class {
  constructor(config) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, "");
    this.getAuthToken = config.getAuthToken;
    this.getDefaultOrganizationId = config.getDefaultOrganizationId;
    this.debug = config.debug || false;
  }
  log(...args) {
    if (this.debug) {
      console.log("[SkillsClient]", ...args);
    }
  }
  buildHeaders() {
    const token = this.getAuthToken();
    if (!token) {
      this.log("No authentication token available");
      return null;
    }
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    };
  }
  /**
   * List non-private skills the caller can see. Returns summaries only — no
   * SKILL.md `content`. Call `getSkillById` to fetch the packaged body for a
   * specific skill.
   */
  async listSkills(params = {}) {
    const headers = this.buildHeaders();
    if (!headers) {
      return { success: false, error: "Authentication required" };
    }
    const query = new URLSearchParams();
    const orgId = params.organizationId ?? this.getDefaultOrganizationId?.();
    if (orgId !== void 0 && orgId !== null && orgId !== "") {
      query.append("organization_id", String(orgId));
    }
    if (params.cursor) query.append("cursor", params.cursor);
    if (params.perPage) query.append("per_page", String(params.perPage));
    const qs = query.toString();
    const url = `${this.apiBaseUrl}/list${qs ? `?${qs}` : ""}`;
    try {
      this.log("GET", url);
      const response = await fetch(url, { method: "GET", headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.log("HTTP error", response.status);
        return {
          success: false,
          error: data?.message || `HTTP ${response.status}`
        };
      }
      const payload = data?.data ?? data;
      const skills = Array.isArray(payload?.skills) ? payload.skills : Array.isArray(payload) ? payload : [];
      const nextCursor = payload?.next_cursor ?? payload?.nextCursor ?? null;
      this.log(`Listed ${skills.length} skills (nextCursor: ${nextCursor ?? "null"})`);
      return { success: true, skills, nextCursor };
    } catch (err) {
      this.log("Network error", err?.message);
      return { success: false, error: err?.message || "Network error" };
    }
  }
  /**
   * Fetch a single skill including its packaged SKILL.md `content`. The
   * server returns 404 for skills the caller is not entitled to read
   * (including all private skills), so this method never leaks existence.
   */
  async getSkillById(id) {
    const headers = this.buildHeaders();
    if (!headers) {
      return { success: false, error: "Authentication required" };
    }
    const url = `${this.apiBaseUrl}/${encodeURIComponent(String(id))}`;
    try {
      this.log("GET", url);
      const response = await fetch(url, { method: "GET", headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.log("HTTP error", response.status);
        return {
          success: false,
          error: data?.message || `HTTP ${response.status}`
        };
      }
      const payload = data?.data ?? data;
      const skill = payload?.skill ?? payload;
      if (!skill || typeof skill !== "object" || !("id" in skill)) {
        return { success: false, error: "Unexpected response format" };
      }
      this.log(`Fetched skill: ${skill.title}`);
      return { success: true, skill };
    } catch (err) {
      this.log("Network error", err?.message);
      return { success: false, error: err?.message || "Network error" };
    }
  }
};

// src/core/CreditSystemClient.ts
var CreditSystemClient = class extends EventEmitter {
  constructor(config = {}) {
    super();
    this.lastTokenRefreshAt = 0;
    this.lastBalanceCheckAt = 0;
    this.parentResponseReceived = false;
    // Deep linking / route watcher state
    this.lastPath = "";
    this.debug = config.debug || false;
    const apiBaseUrl = config.apiBaseUrl || "/api/secure-credits/jwt";
    const reportsApiBaseUrl = config.reportsApiBaseUrl || `${apiBaseUrl.replace("/secure-credits/jwt", "")}/reports/jwt`;
    const skillsApiBaseUrl = config.skillsApiBaseUrl || `${apiBaseUrl.replace("/secure-credits/jwt", "")}/skills/jwt`;
    this.config = {
      apiBaseUrl,
      agentsApiBaseUrl: config.agentsApiBaseUrl || "/api/ai-agents/jwt",
      reportsApiBaseUrl,
      skillsApiBaseUrl,
      authUrl: config.authUrl || "/api/jwt",
      parentTimeout: config.parentTimeout || 3e3,
      tokenRefreshInterval: config.tokenRefreshInterval || 6e5,
      // 10 minutes
      balanceRefreshInterval: config.balanceRefreshInterval || 3e4,
      // 30 seconds
      allowedOrigins: config.allowedOrigins || [window.location.origin],
      autoInit: config.autoInit !== false,
      debug: config.debug || false,
      storagePrefix: config.storagePrefix || "creditSystem_",
      mode: config.mode || "auto",
      features: {
        credits: config.features?.credits !== false,
        // Default true
        personas: config.features?.personas !== false,
        // Default true
        reports: config.features?.reports !== false,
        // Default true
        skills: config.features?.skills !== false
        // Default true
      },
      deepLinking: config.deepLinking || false,
      onAuthRequired: config.onAuthRequired || (() => {
      }),
      onTokenExpired: config.onTokenExpired || (() => {
      })
    };
    this.state = {
      mode: null,
      isInIframe: window !== window.parent,
      isInitialized: false,
      isAuthenticated: false,
      isSuperAdmin: false,
      user: null,
      balance: 0,
      personas: [],
      accessToken: null,
      refreshToken: null,
      organizations: [],
      selectedOrganization: null
    };
    this.storage = new StorageManager(this.config.storagePrefix, this.config.debug);
    this.messageBridge = new MessageBridge(this.config.allowedOrigins, this.config.debug);
    this.authManager = new AuthManager(this.config.authUrl, this.config.debug);
    this.apiClient = new ApiClient(this.config.apiBaseUrl, () => this.getAuthToken(), this.config.debug);
    this.agentsApiClient = new ApiClient(this.config.agentsApiBaseUrl, () => this.getAuthToken(), this.config.debug);
    const personasBaseUrl = this.config.apiBaseUrl.replace("/secure-credits/jwt", "");
    this.personasClient = new PersonasClient({
      apiBaseUrl: personasBaseUrl,
      getAuthToken: () => this.getAuthToken(),
      debug: this.config.debug
    });
    this.reportsClient = new ReportsClient({
      apiBaseUrl: this.config.reportsApiBaseUrl,
      getAuthToken: () => this.getAuthToken(),
      getDefaultOrganizationId: () => this.state.selectedOrganization?.id ?? this.getOrganizationIdFromCookie(),
      debug: this.config.debug
    });
    this.skillsClient = new SkillsClient({
      apiBaseUrl: this.config.skillsApiBaseUrl,
      getAuthToken: () => this.getAuthToken(),
      getDefaultOrganizationId: () => this.state.selectedOrganization?.id ?? this.getOrganizationIdFromCookie(),
      debug: this.config.debug
    });
    this.setupEventHandlers();
    if (this.config.autoInit) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          setTimeout(() => this.initialize(), 0);
        });
      } else {
        setTimeout(() => this.initialize(), 0);
      }
    }
  }
  /**
   * Initialize the credit system
   */
  async initialize() {
    if (this.state.isInitialized) {
      this.log("Credit system already initialized");
      return;
    }
    this.log("Initializing Credit System...");
    if (this.config.mode === "auto") {
      this.state.mode = this.state.isInIframe ? "embedded" : "standalone";
    } else {
      this.state.mode = this.config.mode;
    }
    this.log(`Operating in ${this.state.mode.toUpperCase()} mode`);
    this.emit("modeDetected", { mode: this.state.mode });
    if (this.state.mode === "embedded") {
      await this.initializeEmbeddedMode();
    } else {
      await this.initializeStandaloneMode();
    }
  }
  /**
   * Initialize embedded mode (iframe)
   */
  async initializeEmbeddedMode() {
    this.log("\u{1F3AC} Initializing embedded mode (iframe)...");
    this.log(`\u23F1\uFE0F Parent timeout set to ${this.config.parentTimeout}ms`);
    this.messageBridge.on("JWT_TOKEN_RESPONSE", (data) => {
      this.log("\u{1F4E8} Received JWT_TOKEN_RESPONSE from parent");
      this.log("\u{1F4E8} Received data from parent", data);
      this.handleParentTokenResponse(data);
    });
    this.messageBridge.on("RESPONSE_CURRENT_USER_STATE", (data) => {
      this.log("\u{1F4E8} Received RESPONSE_CURRENT_USER_STATE from parent");
      this.log("\u{1F464} User State Data:", data.userState);
    });
    this.log("\u{1F511} Requesting JWT token from parent...");
    this.log(`\u{1F4CD} Iframe origin: ${window.location.origin}`);
    this.messageBridge.sendToParent("REQUEST_JWT_TOKEN", {
      origin: window.location.origin,
      timestamp: Date.now()
    });
    this.emit("waitingForParent");
    this.log("\u23F3 Waiting for parent response...");
    setTimeout(() => {
      if (!this.parentResponseReceived) {
        this.log(`\u23F0 Timeout! No response from parent after ${this.config.parentTimeout}ms`);
        this.log("\u{1F504} Switching to standalone mode");
        this.emit("parentTimeout");
        this.initializeStandaloneMode();
      }
    }, this.config.parentTimeout);
  }
  /**
   * Handle JWT token response from parent
   */
  handleParentTokenResponse(data) {
    this.parentResponseReceived = true;
    this.log("\u2705 Parent response received!");
    if (data.token) {
      this.log("\u{1F39F}\uFE0F JWT token received from parent");
      this.log(`\u{1F464} User: ${data.user?.email || "Unknown"}`);
      this.log(`\u{1F510} Token length: ${data.token?.length || 0} characters`);
      const isSuperAdmin = data.isSuperAdmin ?? data.user?.is_superadmin ?? false;
      const enrichedUser = data.user ? {
        ...data.user,
        is_superadmin: isSuperAdmin,
        userRoleIds: data.organization?.userRoleIds,
        organizations: data.organizations || data.user.organizations,
        // Include organizations array
        personas: data.personas || data.user.personas
        // Include personas array
      } : data.user;
      this.storage.set("auth", {
        token: data.token,
        refreshToken: data.refreshToken,
        user: enrichedUser
      });
      this.log("\u{1F4BE} Tokens saved to storage");
      if (data.personas) {
        this.state.personas = data.personas;
        this.log(`\u{1F4CB} Personas received in JWT: ${data.personas.length}`);
      }
      if (data.organizations) {
        this.log(`\u{1F3E2} Organizations received in JWT: ${data.organizations.length}`);
        const selectedOrg = data.organizations.find((org) => org.selectedStatus === true);
        if (selectedOrg) {
          this.log(`\u2705 Selected Organization: ${selectedOrg.name} (ID: ${selectedOrg.id})`);
        }
      }
      if (data.organization) {
        this.log(`\u{1F3E2} Current Organization: ${data.organization.organizationName} (ID: ${data.organization.organizationId})`);
        const orgId = data.organization.organizationId;
        if (orgId) {
          const expires = /* @__PURE__ */ new Date();
          expires.setDate(expires.getDate() + 30);
          document.cookie = `user-selected-org-id=${orgId};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
          this.log(`\u{1F36A} Set organization cookie: user-selected-org-id=${orgId}`);
        }
      }
      this.state.user = enrichedUser || null;
      this.state.isAuthenticated = true;
      this.state.isSuperAdmin = isSuperAdmin;
      this.state.accessToken = data.token || null;
      this.state.refreshToken = data.refreshToken || null;
      const orgs = data.organizations || enrichedUser?.organizations;
      if (orgs && Array.isArray(orgs)) {
        const normalizedOrgs = orgs.map((org, index) => {
          const selected = org.isSelected ?? org.selectedStatus ?? index === 0;
          const userRoleIds = org.user_role_ids ?? (org.roles ? Object.keys(org.roles).map(Number) : void 0);
          return {
            ...org,
            selectedStatus: selected,
            isSelected: selected,
            ...userRoleIds ? { user_role_ids: userRoleIds } : {}
          };
        });
        this.state.organizations = normalizedOrgs;
        this.state.selectedOrganization = normalizedOrgs.find((o) => o.selectedStatus) || normalizedOrgs[0] || null;
        this.emit("organizationsUpdated", { organizations: normalizedOrgs });
      }
      this.emit("tokensUpdated", {
        accessToken: data.token,
        refreshToken: data.refreshToken
      });
      this.log("\u{1F680} Initializing with token...");
      this.initializeWithToken();
      this.log("\u{1F4E4} Sending CREDIT_SYSTEM_READY to parent");
      this.messageBridge.sendToParent("CREDIT_SYSTEM_READY", {
        user: this.state.user,
        mode: "embedded"
      });
      this.log("\u2728 Embedded mode initialization complete!");
    } else if (data.error) {
      this.log(`\u274C Parent authentication error: ${data.error}`);
      this.emit("parentAuthRequired", { error: data.error });
      this.log("\u{1F504} Falling back to standalone mode");
      this.initializeStandaloneMode();
    }
  }
  /**
   * Initialize standalone mode
   */
  async initializeStandaloneMode() {
    this.state.mode = "standalone";
    this.log("\u{1F5A5}\uFE0F Initializing standalone mode...");
    const savedAuth = this.storage.get("auth");
    if (savedAuth && savedAuth.token) {
      this.log("\u{1F50D} Found saved JWT tokens, checking expiry locally...");
      this.log(`\u{1F464} Saved user: ${savedAuth.user?.email || "Unknown"}`);
      const isValid = tokenHasRemainingLife(savedAuth.token);
      if (isValid) {
        this.log("\u2705 Token is valid!");
        this.state.user = savedAuth.user;
        this.state.isAuthenticated = true;
        this.state.isSuperAdmin = savedAuth.user?.is_superadmin ?? false;
        this.state.accessToken = savedAuth.token;
        this.state.refreshToken = savedAuth.refreshToken || null;
        if (savedAuth.user?.organizations && Array.isArray(savedAuth.user.organizations)) {
          this.state.organizations = savedAuth.user.organizations;
          this.state.selectedOrganization = savedAuth.user.organizations.find(
            (o) => o.selectedStatus || o.isSelected
          ) || savedAuth.user.organizations[0] || null;
        }
        this.log("\u{1F680} Initializing with valid token...");
        this.initializeWithToken();
      } else {
        this.log("\u274C Token validation failed");
        if (savedAuth.refreshToken) {
          this.log("\u{1F504} Attempting token refresh...");
          const refreshed = await this.refreshToken();
          if (!refreshed) {
            this.log("\u274C Token refresh failed - authentication required");
            this.emit("authRequired");
            this.config.onAuthRequired();
          }
        } else {
          this.log("\u274C No refresh token available - authentication required");
          this.emit("authRequired");
          this.config.onAuthRequired();
        }
      }
    } else {
      this.log("\u2139\uFE0F No saved tokens found - authentication required");
      this.emit("authRequired");
      this.config.onAuthRequired();
    }
  }
  /**
   * Initialize with valid JWT token
   */
  initializeWithToken() {
    this.state.isInitialized = true;
    this.startTokenRefreshTimer();
    this.setupVisibilityCatchUp();
    if (this.config.features.credits) {
      this.checkBalance();
      if (this.config.balanceRefreshInterval > 0) {
        this.startBalanceRefreshTimer();
      }
    }
    if (this.config.features.personas) {
      this.loadPersonas();
    }
    if (this.config.deepLinking && this.state.mode === "embedded") {
      this.startRouteWatcher();
    }
    this.emit("ready", {
      user: this.state.user,
      mode: this.state.mode
    });
  }
  /**
   * Get current auth token
   */
  getAuthToken() {
    const auth = this.storage.get("auth");
    return auth?.token || null;
  }
  /**
   * Login with credentials (standalone mode)
   */
  async login(email, password) {
    if (this.state.mode === "embedded") {
      this.log("\u26A0\uFE0F Login attempt blocked: Not available in embedded mode");
      return {
        success: false,
        error: "Login not available in embedded mode"
      };
    }
    this.log("\u{1F510} Login attempt started...");
    this.log(`\u{1F4E7} Email: ${email}`);
    this.emit("loginStart");
    try {
      const result = await this.authManager.login(email, password);
      if (result.success && result.tokens && result.user) {
        this.log("\u2705 Login successful!");
        this.log(`\u{1F464} User: ${result.user.email}`);
        this.log(`\u{1F510} Token length: ${result.tokens.access_token?.length || 0} characters`);
        this.storage.set("auth", {
          token: result.tokens.access_token,
          refreshToken: result.tokens.refresh_token,
          user: result.user
        });
        this.log("\u{1F4BE} Tokens saved to storage");
        this.state.user = result.user;
        this.state.isAuthenticated = true;
        this.state.isSuperAdmin = result.user.is_superadmin ?? false;
        this.state.accessToken = result.tokens.access_token;
        this.state.refreshToken = result.tokens.refresh_token;
        if (result.user.organizations && Array.isArray(result.user.organizations)) {
          this.log("\u{1F4E6} Raw orgs from API:", result.user.organizations.map((o) => ({
            id: o.id,
            name: o.name,
            hasAgents: !!o.agents,
            hasRoles: !!o.roles,
            isSelected: o.isSelected
          })));
          const orgs = result.user.organizations.map((org, index) => {
            const selected = org.isSelected ?? org.selectedStatus ?? index === 0;
            const userRoleIds = org.user_role_ids ?? (org.roles ? Object.keys(org.roles).map(Number) : void 0);
            return {
              ...org,
              selectedStatus: selected,
              isSelected: selected,
              ...userRoleIds ? { user_role_ids: userRoleIds } : {}
            };
          });
          this.state.organizations = orgs;
          this.state.selectedOrganization = orgs.find((o) => o.selectedStatus) || orgs[0] || null;
          this.emit("organizationsUpdated", { organizations: orgs });
          this.log(`\u{1F3E2} Stored ${orgs.length} organizations. Selected: ${this.state.selectedOrganization?.name} (ID: ${this.state.selectedOrganization?.id})`);
          if (this.state.selectedOrganization?.agents?.all) {
            this.log(`\u{1F916} Selected org has ${this.state.selectedOrganization.agents.all.length} agents`);
          }
        }
        this.emit("tokensUpdated", {
          accessToken: result.tokens.access_token,
          refreshToken: result.tokens.refresh_token
        });
        this.log("\u{1F680} Initializing with token...");
        this.initializeWithToken();
        this.emit("loginSuccess", { user: result.user });
        return { success: true, user: result.user, tokens: result.tokens };
      } else {
        const error = result.message || "Login failed";
        this.log(`\u274C Login failed: ${error}`);
        this.emit("loginError", { error });
        return { success: false, error };
      }
    } catch (error) {
      const errorMsg = error.message || "Network error";
      this.log(`\u274C Login error: ${errorMsg}`);
      this.emit("loginError", { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }
  /**
   * Logout
   */
  async logout() {
    this.emit("logoutStart");
    try {
      const token = this.getAuthToken();
      if (token) {
        await this.authManager.logout(token);
      }
    } catch (error) {
      this.log("Logout API error:", error);
    }
    this.state.user = null;
    this.state.balance = 0;
    this.state.isInitialized = false;
    this.state.isAuthenticated = false;
    this.state.isSuperAdmin = false;
    this.state.accessToken = null;
    this.state.refreshToken = null;
    this.state.organizations = [];
    this.state.selectedOrganization = null;
    this.storage.remove("auth");
    this.clearTimers();
    if (this.state.mode === "embedded") {
      this.messageBridge.sendToParent("LOGOUT", {
        timestamp: Date.now()
      });
    }
    this.emit("logoutSuccess");
  }
  /**
   * Check current credit balance
   */
  async checkBalance() {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F Balance check blocked: Not authenticated");
      return { success: false, error: "Not authenticated" };
    }
    this.lastBalanceCheckAt = Date.now();
    this.log("\u{1F4B0} Fetching current balance...");
    this.log(`\u{1F464} User: ${this.state.user?.email} (ID: ${this.state.user?.id})`);
    try {
      const params = {};
      const organizationId = this.state.selectedOrganization?.id || this.getOrganizationIdFromCookie();
      this.log(`\u{1F50D} Organization ID (selected org or cookie): ${organizationId} (type: ${typeof organizationId})`);
      if (organizationId) {
        params.organization_id = String(organizationId);
        this.log(`\u{1F3E2} Including organization_id in balance request: ${params.organization_id}`);
      } else {
        this.log("\u26A0\uFE0F WARNING: No organization_id available from state or cookie!");
      }
      this.log(`\u{1F4E4} Balance request params:`, params);
      const result = await this.apiClient.get("/balance", params);
      if (!result.success && result.error === "Authentication failed") {
        this.log("\u26A0\uFE0F Balance fetch got 401 - attempting token refresh...");
        const refreshed = await this.refreshToken();
        if (refreshed) {
          this.log("\u2705 Token refreshed, retrying balance fetch...");
          const retryResult = await this.apiClient.get("/balance", params);
          if (retryResult.success && retryResult.data) {
            const previousBalance = this.state.balance;
            this.state.balance = retryResult.data.balance;
            this.log(`\u2705 Balance fetched after retry: ${this.state.balance} credits`);
            if (previousBalance !== this.state.balance) {
              this.log(`\u{1F4CA} Balance changed: ${previousBalance} \u2192 ${this.state.balance}`);
            }
            this.emit("balanceUpdate", { balance: this.state.balance });
            if (this.state.mode === "embedded") {
              this.messageBridge.sendToParent("BALANCE_UPDATE", {
                balance: this.state.balance,
                timestamp: Date.now()
              });
            }
            return { success: true, balance: this.state.balance };
          }
        }
        const error = result.message || "Failed to get balance";
        this.log(`\u274C Balance fetch failed after refresh attempt: ${error}`);
        return { success: false, error };
      }
      if (result.success && result.data) {
        const previousBalance = this.state.balance;
        this.state.balance = result.data.balance;
        this.log(`\u2705 Balance fetched: ${this.state.balance} credits`);
        if (previousBalance !== this.state.balance) {
          this.log(`\u{1F4CA} Balance changed: ${previousBalance} \u2192 ${this.state.balance}`);
        }
        this.emit("balanceUpdate", { balance: this.state.balance });
        if (this.state.mode === "embedded") {
          this.log("\u{1F4E4} Sending BALANCE_UPDATE to parent");
          this.messageBridge.sendToParent("BALANCE_UPDATE", {
            balance: this.state.balance,
            timestamp: Date.now()
          });
        }
        return { success: true, balance: this.state.balance };
      } else {
        const error = result.message || "Failed to get balance";
        this.log(`\u274C Balance fetch failed: ${error}`);
        return { success: false, error };
      }
    } catch (error) {
      this.log(`\u274C Balance fetch error: ${error.message}`);
      this.emit("error", { type: "balance", error: error.message });
      return { success: false, error: error.message };
    }
  }
  /**
   * Spend credits
   */
  async spendCredits(amount, description, referenceId) {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F Spend credits blocked: Not authenticated");
      return { success: false, error: "Not authenticated" };
    }
    if (amount <= 0) {
      this.log(`\u26A0\uFE0F Spend credits blocked: Invalid amount (${amount})`);
      return { success: false, error: "Invalid amount" };
    }
    if (amount > this.state.balance) {
      this.log(`\u26A0\uFE0F Spend credits blocked: Insufficient credits (need ${amount}, have ${this.state.balance})`);
      return { success: false, error: "Insufficient credits" };
    }
    if (this.config.debug) this.log(`\u{1F464} User: ${this.state.user?.email} (ID: ${this.state.user?.id})`);
    const userId = this.state.user?.id;
    if (!userId) {
      this.log("\u26A0\uFE0F Spend credits blocked: User ID not found");
      return { success: false, error: "User ID not found" };
    }
    const organizationId = this.state.selectedOrganization?.id || this.getOrganizationIdFromCookie();
    if (this.config.debug) this.log("organizationId", organizationId);
    if (!organizationId) {
      this.log("\u26A0\uFE0F Spend credits blocked: No selected organization found");
      return { success: false, error: "No selected organization found" };
    }
    const userRoleId = this.state.selectedOrganization?.user_role_ids?.[0];
    this.log(`\u{1F4B3} Spending ${amount} credits...`);
    this.log(`\u{1F464} User ID: ${userId}`);
    this.log(`\u{1F3E2} Organization ID: ${organizationId} (${this.state.selectedOrganization?.name || "from cookie"})`);
    if (userRoleId) this.log(`\u{1F511} User Role ID: ${userRoleId}`);
    if (description) this.log(`\u{1F4DD} Description: ${description}`);
    if (referenceId) this.log(`\u{1F517} Reference ID: ${referenceId}`);
    try {
      const requestBody = {
        user_id: userId,
        organization_id: organizationId,
        amount,
        description,
        reference_id: referenceId
      };
      if (userRoleId) {
        requestBody.user_role_id = userRoleId;
      }
      this.log("\u{1F4E4} Request payload:", requestBody);
      const result = await this.apiClient.post("/spend", requestBody);
      if (result.success && result.data) {
        const previousBalance = this.state.balance;
        this.state.balance = result.data.new_balance;
        this.log(`\u2705 Credits spent successfully!`);
        this.log(`\u{1F4CA} Balance: ${previousBalance} \u2192 ${this.state.balance} (spent ${amount})`);
        this.emit("creditsSpent", {
          amount,
          description,
          previousBalance,
          newBalance: this.state.balance,
          transaction: result.data.transaction
        });
        if (this.state.mode === "embedded") {
          this.log("\u{1F4E4} Sending CREDITS_SPENT to parent");
          this.messageBridge.sendToParent("CREDITS_SPENT", {
            amount,
            description,
            newBalance: this.state.balance,
            timestamp: Date.now()
          });
        }
        return {
          success: true,
          newBalance: this.state.balance,
          transaction: result.data.transaction
        };
      } else {
        const error = result.message || "Failed to spend credits";
        this.log(`\u274C Spend credits failed: ${error}`);
        return { success: false, error };
      }
    } catch (error) {
      this.log(`\u274C Spend credits error: ${error.message}`);
      this.emit("error", { type: "spend", error: error.message });
      return { success: false, error: error.message };
    }
  }
  /**
   * Add credits
   */
  async addCredits(amount, type = "purchase", description) {
    if (!this.state.isAuthenticated) {
      return { success: false, error: "Not authenticated" };
    }
    if (amount <= 0) {
      return { success: false, error: "Invalid amount" };
    }
    const userId = this.state.user?.id;
    if (!userId) {
      this.log("\u26A0\uFE0F Add credits blocked: User ID not found");
      return { success: false, error: "User ID not found" };
    }
    const organizationId = this.state.selectedOrganization?.id || this.getOrganizationIdFromCookie();
    if (!organizationId) {
      this.log("\u26A0\uFE0F Add credits blocked: No selected organization found");
      return { success: false, error: "No selected organization found" };
    }
    const userRoleId = this.state.selectedOrganization?.user_role_ids?.[0];
    this.log(`\u2795 Adding ${amount} credits...`);
    this.log(`\u{1F464} User ID: ${userId}`);
    this.log(`\u{1F3E2} Organization ID: ${organizationId} (${this.state.selectedOrganization?.name || "from cookie"})`);
    if (userRoleId) this.log(`\u{1F511} User Role ID: ${userRoleId}`);
    if (description) this.log(`\u{1F4DD} Description: ${description}`);
    this.log(`\u{1F3F7}\uFE0F Type: ${type}`);
    try {
      const requestBody = {
        user_id: userId,
        organization_id: organizationId,
        amount,
        type,
        description
      };
      if (userRoleId) {
        requestBody.user_role_id = userRoleId;
      }
      this.log("\u{1F4E4} Request payload:", requestBody);
      const result = await this.apiClient.post("/add", requestBody);
      if (result.success && result.data) {
        const previousBalance = this.state.balance;
        this.state.balance = result.data.new_balance;
        this.emit("creditsAdded", {
          amount,
          type,
          description,
          previousBalance,
          newBalance: this.state.balance,
          transaction: result.data.transaction
        });
        if (this.state.mode === "embedded") {
          this.messageBridge.sendToParent("CREDITS_ADDED", {
            amount,
            type,
            description,
            newBalance: this.state.balance,
            timestamp: Date.now()
          });
        }
        return {
          success: true,
          newBalance: this.state.balance,
          transaction: result.data.transaction
        };
      } else {
        return { success: false, error: result.message || "Failed to add credits" };
      }
    } catch (error) {
      this.emit("error", { type: "add", error: error.message });
      return { success: false, error: error.message };
    }
  }
  /**
   * Get transaction history
   */
  async getHistory(page = 1, limit = 10) {
    if (!this.state.isAuthenticated) {
      return { success: false, error: "Not authenticated" };
    }
    const organizationId = this.state.selectedOrganization?.id || this.getOrganizationIdFromCookie();
    if (!organizationId) {
      this.log("\u26A0\uFE0F Get history blocked: No selected organization found");
      return { success: false, error: "No organization selected" };
    }
    const offset = (page - 1) * limit;
    this.log(`\u{1F4DC} Fetching transaction history (page ${page}, limit ${limit}, offset ${offset})...`);
    try {
      const result = await this.apiClient.get(`/history?organization_id=${organizationId}&limit=${limit}&offset=${offset}`);
      if (result.success && result.data) {
        const pagination = result.data.pagination || {};
        const total = pagination.total || 0;
        const totalPages = Math.ceil(total / limit);
        const transactions = (result.data.transactions || []).map((tx) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description || "",
          reference_id: tx.reference_id,
          created_at: tx.created_at,
          balance_after: tx.balance_after || 0,
          // Default to 0 if not provided by API
          user_id: tx.user_id
        }));
        this.log(`\u2705 Loaded ${transactions.length} transactions (total: ${total})`);
        return {
          success: true,
          transactions,
          total,
          page,
          pages: totalPages
        };
      } else {
        return { success: false, error: result.message || "Failed to get history" };
      }
    } catch (error) {
      this.log(`\u274C Failed to get history: ${error.message}`);
      this.emit("error", { type: "history", error: error.message });
      return { success: false, error: error.message };
    }
  }
  /**
   * Get AI agents
   * @param all - If true, fetches all agents for the organization. If false/undefined, fetches agents filtered by user's role IDs.
   */
  async getAgents(all = false) {
    if (!this.state.isAuthenticated) {
      return { success: false, error: "Not authenticated" };
    }
    const organizationId = this.state.selectedOrganization?.id || this.getOrganizationIdFromCookie();
    this.log(`\u{1F50D} Organization ID (selected org or cookie): ${organizationId} (type: ${typeof organizationId})`);
    if (!organizationId) {
      this.log("\u26A0\uFE0F Get agents blocked: No selected organization found");
      return { success: false, error: "No organization selected" };
    }
    let queryParams = `organization_id=${organizationId}`;
    if (all) {
      queryParams += "&all=true";
      this.log(`\u{1F916} Fetching all AI agents for organization ${organizationId}...`);
    } else {
      const roleIds = this.state.selectedOrganization?.user_role_ids || this.state.user?.userRoleIds;
      if (!roleIds || roleIds.length === 0) {
        this.log("\u26A0\uFE0F Get agents blocked: No role IDs found for user in selected organization");
        return { success: false, error: "No role IDs found for user" };
      }
      queryParams += `&role_ids=${roleIds.join(",")}`;
      this.log(`\u{1F916} Fetching AI agents for organization ${organizationId} with role_ids: ${roleIds.join(",")}...`);
    }
    try {
      const result = await this.agentsApiClient.get(`?${queryParams}`);
      if (result.success && result.data) {
        let agents = [];
        let roleGrouped = {};
        if (Array.isArray(result.data)) {
          agents = result.data;
        } else if (result.data.agents) {
          if (Array.isArray(result.data.agents.all)) {
            agents = result.data.agents.all;
          } else if (Array.isArray(result.data.agents)) {
            agents = result.data.agents;
          } else if (typeof result.data.agents === "object") {
            const agentObj = result.data.agents;
            Object.keys(agentObj).forEach((key) => {
              if (key === "all") return;
              const roleData = agentObj[key];
              if (roleData && typeof roleData === "object") {
                if (roleData.role_name && Array.isArray(roleData.agents)) {
                  roleGrouped[key] = {
                    role_name: roleData.role_name,
                    agents: roleData.agents
                  };
                  agents = agents.concat(roleData.agents);
                } else if (Array.isArray(roleData)) {
                  agents = agents.concat(roleData);
                }
              }
            });
          }
        } else if (Array.isArray(result.data.data)) {
          agents = result.data.data;
        }
        const total = result.data.total || agents.length;
        const roleCount = Object.keys(roleGrouped).length;
        if (roleCount > 0) {
          this.log(`\u2705 Loaded ${agents.length} AI agents across ${roleCount} roles (total: ${total})`);
        } else {
          this.log(`\u2705 Loaded ${agents.length} AI agents (total: ${total})`);
        }
        return {
          success: true,
          agents,
          roleGrouped: roleCount > 0 ? roleGrouped : void 0,
          total
        };
      } else {
        return { success: false, error: result.message || "Failed to get agents", agents: [] };
      }
    } catch (error) {
      this.log(`\u274C Failed to get agents: ${error.message}`);
      this.emit("error", { type: "agents", error: error.message });
      return { success: false, error: error.message, agents: [] };
    }
  }
  // ===================================================================
  // DEEP LINKING METHODS
  // ===================================================================
  /**
   * Get the current full path (pathname + search + hash)
   */
  getCurrentPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }
  /**
   * Start watching for route changes in the embedded app.
   * Detects pushState, replaceState, and popstate (back/forward) navigation.
   */
  startRouteWatcher() {
    this.lastPath = this.getCurrentPath();
    this.log("\u{1F517} Deep linking enabled \u2014 starting route watcher");
    this.popstateHandler = () => this.checkRouteChange();
    window.addEventListener("popstate", this.popstateHandler);
    this.hashchangeHandler = () => this.checkRouteChange();
    window.addEventListener("hashchange", this.hashchangeHandler);
    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);
    const self = this;
    history.pushState = function(...args) {
      self.originalPushState(...args);
      self.checkRouteChange();
    };
    history.replaceState = function(...args) {
      self.originalReplaceState(...args);
      self.checkRouteChange();
    };
    this.notifyRouteChanged(this.lastPath);
  }
  /**
   * Stop the route watcher and restore original history methods.
   */
  stopRouteWatcher() {
    if (this.popstateHandler) {
      window.removeEventListener("popstate", this.popstateHandler);
      this.popstateHandler = void 0;
    }
    if (this.hashchangeHandler) {
      window.removeEventListener("hashchange", this.hashchangeHandler);
      this.hashchangeHandler = void 0;
    }
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = void 0;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = void 0;
    }
    this.log("\u{1F517} Deep linking route watcher stopped");
  }
  /**
   * Check if the route has changed and notify the parent if so.
   */
  checkRouteChange() {
    const currentPath = this.getCurrentPath();
    if (currentPath !== this.lastPath) {
      this.lastPath = currentPath;
      this.notifyRouteChanged(currentPath);
    }
  }
  /**
   * Notify the parent frame that the route has changed.
   * Called automatically when deep linking is enabled, but can also be called manually.
   * @param path - The path to send. Defaults to the current window path (pathname + search + hash).
   */
  notifyRouteChanged(path) {
    const resolvedPath = path ?? this.getCurrentPath();
    this.log(`\u{1F517} Route changed: ${resolvedPath}`);
    this.emit("routeChanged", { path: resolvedPath });
    if (this.state.mode === "embedded") {
      this.messageBridge.sendToParent("ROUTE_CHANGED", { path: resolvedPath });
    }
  }
  // ===================================================================
  // PERSONAS METHODS
  // ===================================================================
  /**
   * Read personas from cookie
   */
  getOrganizationIdFromCookie() {
    try {
      const cookies = document.cookie.split(";");
      const orgCookie = cookies.find((c) => c.trim().startsWith("user-selected-org-id="));
      if (orgCookie) {
        const value = orgCookie.split("=")[1];
        this.log(`\u{1F36A} Found organization ID in cookie: ${value}`);
        return value;
      }
    } catch (error) {
      this.log(`\u26A0\uFE0F Error reading organization ID from cookie: ${error.message}`);
    }
    return null;
  }
  getPersonasFromCookie() {
    try {
      const cookies = document.cookie.split(";");
      const personasCookie = cookies.find((c) => c.trim().startsWith("user-personas="));
      if (personasCookie) {
        const value = personasCookie.split("=")[1];
        const decoded = decodeURIComponent(value);
        const personas = JSON.parse(decoded);
        this.log(`\u{1F36A} Found ${personas.length} personas in cookie`);
        return personas;
      }
    } catch (error) {
      this.log(`\u26A0\uFE0F Error reading personas from cookie: ${error.message}`);
    }
    return [];
  }
  /**
   * Load personas for authenticated user
   * First tries to load from cookie, falls back to API if cookie is empty
   */
  async loadPersonas() {
    this.log("\u{1F3AD} Loading personas...");
    const cookiePersonas = this.getPersonasFromCookie();
    if (cookiePersonas.length > 0) {
      this.log(`\u2705 Using ${cookiePersonas.length} personas from cookie (skipping API call)`);
      this.state.personas = cookiePersonas;
      this.emit("personasLoaded", { personas: cookiePersonas });
      if (this.state.mode === "embedded") {
        this.log("\u{1F4E4} Sending PERSONAS_LOADED to parent");
        this.messageBridge.sendToParent("PERSONAS_LOADED", {
          personas: cookiePersonas,
          timestamp: Date.now()
        });
      }
      return;
    }
    this.log("\u{1F36A} No personas in cookie, fetching from API...");
    try {
      const result = await this.personasClient.getPersonas();
      if (result.success && result.personas) {
        this.state.personas = result.personas;
        this.log(`\u2705 Loaded ${result.personas.length} personas from API`);
        this.emit("personasLoaded", { personas: result.personas });
        if (this.state.mode === "embedded") {
          this.log("\u{1F4E4} Sending PERSONAS_LOADED to parent");
          this.messageBridge.sendToParent("PERSONAS_LOADED", {
            personas: result.personas,
            timestamp: Date.now()
          });
        }
      } else {
        this.log(`\u274C Failed to load personas: ${result.error}`);
        this.emit("personasFailed", { error: result.error || "Failed to load personas" });
      }
    } catch (error) {
      this.log(`\u274C Error loading personas: ${error.message}`);
      this.emit("personasFailed", { error: error.message });
    }
  }
  /**
   * Get all personas for authenticated user
   * If no filters (organizationId/roleId) are provided, returns personas from cookie
   * Otherwise fetches from API with filters
   * @param organizationId - Optional organization ID to filter personas
   * @param roleId - Optional role ID to filter personas
   */
  async getPersonas(organizationId, roleId) {
    if (!this.state.isAuthenticated) {
      return { success: false, error: "Not authenticated" };
    }
    this.log("\u{1F3AD} Fetching personas...");
    if (!organizationId && !roleId) {
      const cookiePersonas = this.getPersonasFromCookie();
      if (cookiePersonas.length > 0) {
        this.log(`\u2705 Returning ${cookiePersonas.length} personas from cookie`);
        this.state.personas = cookiePersonas;
        return { success: true, personas: cookiePersonas };
      }
      this.log("\u{1F36A} No personas in cookie, fetching from API...");
    } else {
      this.log("\u{1F50D} Filters provided, fetching from API...");
    }
    const result = await this.personasClient.getPersonas(organizationId, roleId);
    if (result.success && result.personas) {
      this.state.personas = result.personas;
      this.emit("personasLoaded", { personas: result.personas });
    }
    return result;
  }
  /**
   * Get specific persona by ID
   */
  async getPersonaById(id) {
    if (!this.state.isAuthenticated) {
      return { success: false, error: "Not authenticated" };
    }
    this.log(`\u{1F3AD} Fetching persona ID: ${id}`);
    return await this.personasClient.getPersonaById(id);
  }
  // ===================================================================
  // REPORTS METHODS
  //
  // Strict creator-only: every call is scoped to the authenticated user
  // via the JWT bearer token. The server rejects any attempt to read or
  // edit a report created by someone else. The SDK never exposes a
  // creator/user ID parameter — there is no way for a caller to operate
  // on another user's reports through this surface.
  // ===================================================================
  /**
   * List the authenticated user's reports (cursor-paginated).
   * Defaults `organization_id` to the SDK's currently selected organization.
   */
  async listReports(params = {}) {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F listReports blocked: Not authenticated");
      return { success: false, error: "Not authenticated", reports: [] };
    }
    this.log("\u{1F4C4} Listing reports...", params);
    const result = await this.reportsClient.listReports(params);
    if (result.success) {
      this.log(`\u2705 Listed ${result.reports?.length ?? 0} reports (nextCursor: ${result.nextCursor ?? "null"})`);
    } else {
      this.log(`\u274C listReports failed: ${result.error}`);
      this.emit("error", { type: "reports", error: result.error || "Failed to list reports" });
    }
    return result;
  }
  /**
   * Fetch one of the authenticated user's reports (including the HTML body).
   */
  async getReport(id, organizationId) {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F getReport blocked: Not authenticated");
      return { success: false, error: "Not authenticated" };
    }
    this.log(`\u{1F4C4} Fetching report ${id}`);
    const result = await this.reportsClient.getReport(id, { organizationId });
    if (result.success) {
      this.log(`\u2705 Fetched report ${id}: "${result.report?.title}"`);
    } else {
      this.log(`\u274C getReport(${id}) failed: ${result.error}`);
      this.emit("error", { type: "reports", error: result.error || "Failed to fetch report" });
    }
    return result;
  }
  /**
   * Create a report owned by the authenticated user. The server stamps
   * `created_by` from the JWT — the caller cannot impersonate anyone else.
   */
  async createReport(params) {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F createReport blocked: Not authenticated");
      return { success: false, error: "Not authenticated" };
    }
    this.log(`\u{1F4C4} Creating report "${params.title}" (visibility: ${params.visibility})`);
    const result = await this.reportsClient.createReport(params);
    if (result.success) {
      this.log(`\u2705 Created report ${result.report?.id}`);
    } else {
      this.log(`\u274C createReport failed: ${result.error}`);
      this.emit("error", { type: "reports", error: result.error || "Failed to create report" });
    }
    return result;
  }
  /**
   * Partial update — any subset of `{title, body, visibility, folderId, pinned}`.
   * Server returns 403 if the report exists but was created by someone else.
   */
  async updateReport(id, params) {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F updateReport blocked: Not authenticated");
      return { success: false, error: "Not authenticated" };
    }
    this.log(`\u{1F4C4} Updating report ${id}`, Object.keys(params));
    const result = await this.reportsClient.updateReport(id, params);
    if (result.success) {
      this.log(`\u2705 Updated report ${id}`);
    } else {
      this.log(`\u274C updateReport(${id}) failed: ${result.error}`);
      this.emit("error", { type: "reports", error: result.error || "Failed to update report" });
    }
    return result;
  }
  // ===================================================================
  // SKILLS METHODS
  //
  // Read-only access to SKILL.md docs the platform publishes to child apps.
  // The server filters out `visibility: 'private'` server-side; the SDK
  // never exposes a way to fetch private skills.
  // ===================================================================
  /**
   * List non-private skills visible to the authenticated caller.
   * Defaults `organization_id` to the SDK's currently selected organization.
   */
  async getSkills(params = {}) {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F getSkills blocked: Not authenticated");
      return { success: false, error: "Not authenticated" };
    }
    if (!this.config.features.skills) {
      this.log("\u26A0\uFE0F getSkills blocked: skills feature disabled");
      return { success: false, error: "Skills feature is disabled" };
    }
    this.log("\u{1F9E9} Listing skills...", params);
    const result = await this.skillsClient.listSkills(params);
    if (!result.success) {
      this.log(`\u274C getSkills failed: ${result.error}`);
      this.emit("error", { type: "skills", error: result.error || "Failed to list skills" });
    }
    return result;
  }
  /**
   * Fetch a single skill including its SKILL.md body.
   */
  async getSkillById(id) {
    if (!this.state.isAuthenticated) {
      this.log("\u26A0\uFE0F getSkillById blocked: Not authenticated");
      return { success: false, error: "Not authenticated" };
    }
    if (!this.config.features.skills) {
      this.log("\u26A0\uFE0F getSkillById blocked: skills feature disabled");
      return { success: false, error: "Skills feature is disabled" };
    }
    this.log(`\u{1F9E9} Fetching skill ${id}`);
    const result = await this.skillsClient.getSkillById(id);
    if (!result.success) {
      this.log(`\u274C getSkillById(${id}) failed: ${result.error}`);
      this.emit("error", { type: "skills", error: result.error || "Failed to fetch skill" });
    }
    return result;
  }
  // ===================================================================
  // USER STATE METHODS
  // ===================================================================
  /**
   * Request current user state from parent page (embedded mode only)
   */
  async requestCurrentUserState() {
    if (this.state.mode !== "embedded") {
      this.log("\u26A0\uFE0F requestCurrentUserState blocked: Only available in embedded mode");
      return {
        success: false,
        error: "requestCurrentUserState is only available in embedded mode"
      };
    }
    this.log("\u{1F464} Requesting current user state from parent...");
    return new Promise((resolve) => {
      const responseHandler = (data) => {
        this.log("\u2705 User state response received from parent");
        console.log("\u{1F464} RESPONSE_CURRENT_USER_STATE:", data.userState);
        if (data.userState) {
          this.log(`\u{1F3E2} Organization: ${data.userState.orgName} (ID: ${data.userState.orgId})`);
          if (data.userState.orgSlug) {
            this.log(`\u{1F517} Organization Slug: ${data.userState.orgSlug}`);
          }
          if (data.userState.orgDomain) {
            this.log(`\u{1F310} Organization Domain: ${data.userState.orgDomain}`);
          }
          if (data.userState.driveFolderId) {
            this.log(`\u{1F4C1} Drive Folder ID: ${data.userState.driveFolderId}`);
          }
          this.log(`\u{1F464} User ID: ${data.userState.userId}`);
          this.log(`\u{1F3AD} User Role: ${data.userState.userRole}`);
          if (data.userState.userRoleIds) {
            this.log(`\u{1F3AD} User Role IDs: [${data.userState.userRoleIds.join(", ")}]`);
          }
          if (data.userState.personas) {
            this.log(`\u{1F4CB} Personas Count: ${data.userState.personas.length}`);
          }
          const auth = this.storage.get("auth");
          if (auth && auth.user) {
            let updatedOrganizations = auth.user.organizations || [];
            if (data.userState?.orgId) {
              updatedOrganizations = updatedOrganizations.map((org) => ({
                ...org,
                selectedStatus: false
              }));
              const orgIndex = updatedOrganizations.findIndex((org) => org.id === data.userState?.orgId);
              if (orgIndex >= 0) {
                updatedOrganizations[orgIndex] = {
                  ...updatedOrganizations[orgIndex],
                  id: data.userState.orgId,
                  name: data.userState.orgName,
                  slug: data.userState.orgSlug,
                  domain: data.userState.orgDomain,
                  drive_folder_id: data.userState.driveFolderId,
                  ...data.userState.orgLogoUrl !== void 0 && { logo_url: data.userState.orgLogoUrl },
                  ...data.userState.orgIcon !== void 0 && { org_icon: data.userState.orgIcon },
                  selectedStatus: true,
                  user_role_ids: data.userState.userRoleIds || updatedOrganizations[orgIndex].user_role_ids
                };
              } else {
                updatedOrganizations.push({
                  id: data.userState.orgId,
                  name: data.userState.orgName,
                  slug: data.userState.orgSlug,
                  domain: data.userState.orgDomain,
                  drive_folder_id: data.userState.driveFolderId,
                  logo_url: data.userState.orgLogoUrl,
                  org_icon: data.userState.orgIcon,
                  selectedStatus: true,
                  user_role_ids: data.userState.userRoleIds
                });
              }
            }
            const updatedUser = {
              ...auth.user,
              organizations: updatedOrganizations,
              userId: data.userState.userId,
              userRole: data.userState.userRole,
              // Also update userRoleIds if provided (for consistency with JWT token response)
              ...data.userState.userRoleIds && { userRoleIds: data.userState.userRoleIds },
              // Update superadmin flag if provided
              ...data.userState.isSuperAdmin !== void 0 && { is_superadmin: data.userState.isSuperAdmin },
              // Update profile image if provided
              ...data.userState.profileImage !== void 0 && { profile_image: data.userState.profileImage }
            };
            if (data.userState.isSuperAdmin !== void 0) {
              this.state.isSuperAdmin = data.userState.isSuperAdmin;
            }
            this.storage.set("auth", {
              ...auth,
              user: updatedUser
            });
            this.state.user = updatedUser;
            this.state.organizations = updatedOrganizations;
            this.state.selectedOrganization = updatedOrganizations.find(
              (org) => org.selectedStatus
            ) || null;
            this.emit("organizationsUpdated", { organizations: updatedOrganizations });
            if (data.userState.personas) {
              this.state.personas = data.userState.personas;
            }
            this.log("\u{1F4BE} User state saved and overridden in storage");
            const selectedOrg = updatedOrganizations.find((org) => org.selectedStatus);
            this.log("\u{1F4CA} Updated user fields:", {
              selectedOrganization: selectedOrg ? `${selectedOrg.name} (ID: ${selectedOrg.id})` : "none",
              totalOrganizations: updatedOrganizations.length,
              userId: updatedUser.userId,
              userRole: updatedUser.userRole,
              userRoleIds: updatedUser.userRoleIds
            });
          }
          resolve({
            success: true,
            userState: data.userState
          });
        } else if (data.error) {
          this.log(`\u274C User state request error: ${data.error}`);
          resolve({
            success: false,
            error: data.error
          });
        } else {
          this.log("\u274C Invalid user state response from parent");
          resolve({
            success: false,
            error: "Invalid response from parent"
          });
        }
        this.messageBridge.off("RESPONSE_CURRENT_USER_STATE", responseHandler);
      };
      this.messageBridge.on("RESPONSE_CURRENT_USER_STATE", responseHandler);
      this.messageBridge.sendToParent("REQUEST_CURRENT_USER_STATE", {
        origin: window.location.origin,
        timestamp: Date.now()
      });
      setTimeout(() => {
        this.log("\u23F0 User state request timeout - no response from parent");
        this.messageBridge.off("RESPONSE_CURRENT_USER_STATE", responseHandler);
        resolve({
          success: false,
          error: "Timeout waiting for parent response"
        });
      }, 5e3);
    });
  }
  /**
   * Request user organizations from parent page (embedded mode only)
   */
  async requestUserOrganizations() {
    if (this.state.mode !== "embedded") {
      this.log("\u26A0\uFE0F requestUserOrganizations blocked: Only available in embedded mode");
      return {
        success: false,
        error: "requestUserOrganizations is only available in embedded mode"
      };
    }
    this.log("\u{1F3E2} Requesting user organizations from parent...");
    return new Promise((resolve) => {
      const responseHandler = (data) => {
        this.log("\u2705 User organizations response received from parent");
        console.log("\u{1F3E2} RESPONSE_USER_ORGS:", data);
        if (data.organizations) {
          this.log(`\u{1F4CB} Organizations Count: ${data.organizations.length}`);
          const selectedOrg = data.organizations.find((org) => org.selectedStatus === true);
          if (selectedOrg) {
            this.log(`\u2705 Selected Organization: ${selectedOrg.name} (ID: ${selectedOrg.id})`);
          }
          resolve({
            success: true,
            organizations: data.organizations,
            count: data.count || data.organizations.length
          });
        } else if (data.error) {
          this.log(`\u274C User organizations request error: ${data.error}`);
          resolve({
            success: false,
            error: data.error
          });
        } else {
          this.log("\u274C Invalid user organizations response from parent");
          resolve({
            success: false,
            error: "Invalid response from parent"
          });
        }
        this.messageBridge.off("RESPONSE_USER_ORGS", responseHandler);
      };
      this.messageBridge.on("RESPONSE_USER_ORGS", responseHandler);
      this.messageBridge.sendToParent("REQUEST_USER_ORGS", {
        origin: window.location.origin,
        timestamp: Date.now()
      });
      setTimeout(() => {
        this.log("\u23F0 User organizations request timeout - no response from parent");
        this.messageBridge.off("RESPONSE_USER_ORGS", responseHandler);
        resolve({
          success: false,
          error: "Timeout waiting for parent response"
        });
      }, 5e3);
    });
  }
  /**
   * Request user personas from parent page (embedded mode only)
   */
  async requestUserPersonas() {
    if (this.state.mode !== "embedded") {
      this.log("\u26A0\uFE0F requestUserPersonas blocked: Only available in embedded mode");
      return {
        success: false,
        error: "requestUserPersonas is only available in embedded mode"
      };
    }
    this.log("\u{1F465} Requesting user personas from parent...");
    return new Promise((resolve) => {
      const responseHandler = (data) => {
        this.log("\u2705 User personas response received from parent");
        console.log("\u{1F465} RESPONSE_USER_PERSONAS:", data);
        if (data.personas) {
          this.log(`\u{1F4CB} Personas Count: ${data.personas.length}`);
          if (data.personas.length > 0) {
            this.log(`\u{1F4DD} Personas: ${data.personas.map((p) => p.name).join(", ")}`);
          }
          resolve({
            success: true,
            personas: data.personas,
            count: data.count || data.personas.length
          });
        } else if (data.error) {
          this.log(`\u274C User personas request error: ${data.error}`);
          resolve({
            success: false,
            error: data.error
          });
        } else {
          this.log("\u274C Invalid user personas response from parent");
          resolve({
            success: false,
            error: "Invalid response from parent"
          });
        }
        this.messageBridge.off("RESPONSE_USER_PERSONAS", responseHandler);
      };
      this.messageBridge.on("RESPONSE_USER_PERSONAS", responseHandler);
      this.messageBridge.sendToParent("REQUEST_USER_PERSONAS", {
        origin: window.location.origin,
        timestamp: Date.now()
      });
      setTimeout(() => {
        this.log("\u23F0 User personas request timeout - no response from parent");
        this.messageBridge.off("RESPONSE_USER_PERSONAS", responseHandler);
        resolve({
          success: false,
          error: "Timeout waiting for parent response"
        });
      }, 5e3);
    });
  }
  /**
   * Request non-private skills from the parent frame (embedded mode only).
   * The parent decides which non-private skills to serve based on the child's
   * origin and the user's org membership.
   */
  async requestUserSkills() {
    if (this.state.mode !== "embedded") {
      this.log("\u26A0\uFE0F requestUserSkills blocked: Only available in embedded mode");
      return {
        success: false,
        error: "requestUserSkills is only available in embedded mode"
      };
    }
    if (!this.config.features.skills) {
      this.log("\u26A0\uFE0F requestUserSkills blocked: skills feature disabled");
      return { success: false, error: "Skills feature is disabled" };
    }
    this.log("\u{1F9E9} Requesting user skills from parent...");
    return new Promise((resolve) => {
      const responseHandler = (data) => {
        this.log("\u2705 User skills response received from parent");
        if (data.skills) {
          this.log(`\u{1F4CB} Skills count: ${data.skills.length}`);
          resolve({
            success: true,
            skills: data.skills,
            count: data.count ?? data.skills.length
          });
        } else if (data.error) {
          this.log(`\u274C User skills request error: ${data.error}`);
          resolve({ success: false, error: data.error });
        } else {
          this.log("\u274C Invalid user skills response from parent");
          resolve({ success: false, error: "Invalid response from parent" });
        }
        this.messageBridge.off("RESPONSE_USER_SKILLS", responseHandler);
      };
      this.messageBridge.on("RESPONSE_USER_SKILLS", responseHandler);
      this.messageBridge.sendToParent("REQUEST_USER_SKILLS", {
        origin: window.location.origin,
        timestamp: Date.now()
      });
      setTimeout(() => {
        this.log("\u23F0 User skills request timeout - no response from parent");
        this.messageBridge.off("RESPONSE_USER_SKILLS", responseHandler);
        resolve({
          success: false,
          error: "Timeout waiting for parent response"
        });
      }, 5e3);
    });
  }
  /**
   * Refresh JWT token
   *
   * Single-flight: concurrent callers (timer tick + 401 retry + visibility
   * catch-up) share one server request instead of racing.
   */
  async refreshToken() {
    if (this.refreshInFlight) {
      this.log("\u{1F504} Refresh already in flight \u2014 reusing pending request");
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefreshToken().finally(() => {
      this.refreshInFlight = void 0;
    });
    return this.refreshInFlight;
  }
  async doRefreshToken() {
    const auth = this.storage.get("auth");
    this.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    this.log("\u{1F504} TOKEN REFRESH CYCLE STARTED");
    this.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    if (!auth?.refreshToken) {
      this.log("\u274C CRITICAL: No refresh token found in storage!");
      this.log("   Cannot proceed with token refresh");
      return false;
    }
    this.log("\u2705 Refresh token found in storage");
    this.log(`   Length: ${auth.refreshToken?.length || 0} characters`);
    this.log(`   Preview: ${auth.refreshToken?.substring(0, 30)}...`);
    try {
      this.log("\u{1F4E4} Initiating token refresh request...");
      const result = await this.authManager.refreshToken(auth.refreshToken);
      if (result.success && result.tokens) {
        this.log("");
        this.log("\u2705 TOKEN REFRESH SUCCESSFUL!");
        this.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
        const hasNewRefreshToken = !!result.tokens.refresh_token;
        const oldRefreshToken = auth.refreshToken;
        const newRefreshToken = result.tokens.refresh_token || oldRefreshToken;
        this.log("\u{1F4CA} Token Status:");
        this.log(`   \u2713 New Access Token:  ${result.tokens.access_token?.substring(0, 30)}...`);
        this.log(`   \u2713 Access Token Length: ${result.tokens.access_token?.length || 0} chars`);
        if (hasNewRefreshToken) {
          this.log(`   \u2713 New Refresh Token: ${result.tokens.refresh_token?.substring(0, 30)}...`);
          this.log("   \u2139\uFE0F Server returned NEW refresh token - will use this for next cycle");
        } else {
          this.log("   \u26A0\uFE0F Server did NOT return new refresh token");
          this.log(`   \u2713 Preserving OLD refresh token: ${oldRefreshToken?.substring(0, 30)}...`);
          this.log("   \u2139\uFE0F Will reuse same refresh token for next cycle");
        }
        this.storage.set("auth", {
          ...auth,
          token: result.tokens.access_token,
          refreshToken: newRefreshToken
        });
        this.log("");
        this.log("\u{1F4BE} Storage Updated Successfully:");
        this.log(`   \u2022 Access Token:  UPDATED \u2713`);
        this.log(`   \u2022 Refresh Token: ${hasNewRefreshToken ? "UPDATED \u2713" : "PRESERVED \u2713"}`);
        this.log(`   \u2022 User Data:     PRESERVED \u2713`);
        this.state.accessToken = result.tokens.access_token;
        if (hasNewRefreshToken) {
          this.state.refreshToken = result.tokens.refresh_token;
        }
        this.lastTokenRefreshAt = Date.now();
        this.emit("tokenRefreshed");
        this.emit("tokensUpdated", {
          accessToken: result.tokens.access_token,
          refreshToken: newRefreshToken
        });
        if (this.state.mode === "embedded") {
          this.log("\u{1F4E4} Sending JWT_TOKEN_REFRESHED to parent");
          this.messageBridge.sendToParent("JWT_TOKEN_REFRESHED", {
            token: result.tokens.access_token,
            timestamp: Date.now()
          });
        }
        this.log("");
        this.log("\u2728 TOKEN REFRESH CYCLE COMPLETED SUCCESSFULLY");
        this.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        return true;
      } else if (result.transient) {
        const delaySeconds = Math.max(5, result.retryAfterSeconds ?? 60);
        this.log(`\u23F3 TOKEN REFRESH DEFERRED (transient failure) \u2014 retrying in ${delaySeconds}s`);
        this.scheduleRefreshRetry(delaySeconds * 1e3);
        return false;
      } else {
        this.log("");
        this.log("\u274C TOKEN REFRESH FAILED: Invalid response from server");
        this.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
      }
    } catch (error) {
      this.log("");
      this.log("\u274C TOKEN REFRESH ERROR:", error);
      this.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    }
    if (this.state.mode === "embedded") {
      this.log("\u{1F501} Refresh token rejected \u2014 attempting silent re-auth via parent...");
      const reminted = await this.requestTokenFromParent();
      if (reminted) {
        this.log("\u2705 Parent re-minted tokens \u2014 session continues");
        return true;
      }
      this.log("\u274C Parent could not re-mint (session gone or no response)");
    }
    this.log("\u26A0\uFE0F Token expired - authentication required");
    this.emit("tokenExpired");
    this.config.onTokenExpired();
    return false;
  }
  /**
   * Ask the parent page for fresh tokens and wait for the (persistent)
   * JWT_TOKEN_RESPONSE listener to process the reply. Resolves true when
   * a new access token landed in state before the timeout.
   */
  async requestTokenFromParent(timeoutMs = 5e3) {
    if (!this.state.isInIframe) {
      return false;
    }
    const tokenBefore = this.state.accessToken;
    this.messageBridge.sendToParent("REQUEST_JWT_TOKEN", {
      origin: window.location.origin,
      timestamp: Date.now()
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.state.accessToken && this.state.accessToken !== tokenBefore) {
        return true;
      }
    }
    return false;
  }
  scheduleRefreshRetry(delayMs) {
    if (this.refreshRetryTimer) {
      clearTimeout(this.refreshRetryTimer);
    }
    this.refreshRetryTimer = setTimeout(() => {
      this.refreshRetryTimer = void 0;
      this.refreshToken();
    }, delayMs);
  }
  /**
   * Start token refresh timer
   *
   * Ticks are skipped while the tab is hidden — a backgrounded tab has no
   * one to serve, and fleets of idle tabs were generating thousands of
   * refresh calls a day. The visibilitychange handler catches up the
   * moment the tab is foregrounded, so the user never sees a stale token.
   */
  startTokenRefreshTimer() {
    this.clearTokenTimer();
    this.lastTokenRefreshAt = Date.now();
    this.tokenTimer = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      await this.refreshToken();
    }, this.config.tokenRefreshInterval);
  }
  /**
   * Start balance refresh timer (also idle while hidden — see above)
   */
  startBalanceRefreshTimer() {
    this.clearBalanceTimer();
    this.balanceTimer = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      await this.checkBalance();
    }, this.config.balanceRefreshInterval);
  }
  /**
   * When the tab becomes visible again, immediately refresh anything the
   * hidden-tab timer skips: the token first (it may be past its refresh
   * point, or expired outright), then the balance. This is the guarantee
   * that a tab left open for hours resumes without a visible auth hiccup.
   */
  setupVisibilityCatchUp() {
    if (typeof document === "undefined" || this.visibilityHandler) {
      return;
    }
    this.visibilityHandler = async () => {
      if (document.hidden || !this.state.isAuthenticated) {
        return;
      }
      if (this.getAuthToken() && Date.now() - this.lastTokenRefreshAt >= this.config.tokenRefreshInterval) {
        this.log("\u{1F441}\uFE0F Tab visible again \u2014 catching up token refresh");
        await this.refreshToken();
      }
      if (this.config.features.credits && this.config.balanceRefreshInterval > 0 && Date.now() - this.lastBalanceCheckAt >= this.config.balanceRefreshInterval) {
        this.checkBalance();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }
  /**
   * Clear all timers
   */
  clearTimers() {
    this.clearTokenTimer();
    this.clearBalanceTimer();
    if (this.refreshRetryTimer) {
      clearTimeout(this.refreshRetryTimer);
      this.refreshRetryTimer = void 0;
    }
  }
  clearTokenTimer() {
    if (this.tokenTimer) {
      clearInterval(this.tokenTimer);
      this.tokenTimer = void 0;
    }
  }
  clearBalanceTimer() {
    if (this.balanceTimer) {
      clearInterval(this.balanceTimer);
      this.balanceTimer = void 0;
    }
  }
  /**
   * Set up internal event handlers
   */
  setupEventHandlers() {
    if (this.state.isInIframe) {
      this.messageBridge.on("REFRESH_BALANCE", () => {
        this.checkBalance();
      });
      this.messageBridge.on("GET_STATUS", () => {
        this.messageBridge.sendToParent("STATUS_RESPONSE", {
          initialized: this.state.isInitialized,
          mode: this.state.mode,
          user: this.state.user,
          balance: this.state.balance,
          timestamp: Date.now()
        });
      });
      this.messageBridge.on("CLEAR_STORAGE", () => {
        this.logout();
      });
    }
  }
  /**
   * Switch to a different organization
   */
  async switchOrganization(orgId) {
    this.log(`\u{1F504} switchOrganization called with orgId: ${orgId} (type: ${typeof orgId})`);
    if (!this.state.isAuthenticated || !this.state.user) {
      this.log("\u274C switchOrganization: User not authenticated");
      return { success: false, error: "User not authenticated" };
    }
    this.log(`\u{1F4CB} SDK has ${this.state.organizations.length} organizations in state`);
    if (this.state.organizations.length > 0) {
      this.log("\u{1F4CB} Organization IDs in SDK state:", this.state.organizations.map((o) => `${o.id} (type: ${typeof o.id}, selectedStatus: ${o.selectedStatus})`));
    }
    if (this.state.organizations.length === 0) {
      this.log("\u274C switchOrganization: No organizations in SDK state");
      return { success: false, error: "No organizations found for user" };
    }
    const targetOrg = this.state.organizations.find((org) => String(org.id) === String(orgId));
    if (!targetOrg) {
      this.log(`\u274C switchOrganization: Organization with ID ${orgId} not found. Available IDs: ${this.state.organizations.map((o) => o.id).join(", ")}`);
      return { success: false, error: `Organization with ID ${orgId} not found` };
    }
    const previousOrg = this.state.selectedOrganization;
    if (String(previousOrg?.id) === String(orgId)) {
      this.log(`\u2139\uFE0F switchOrganization: Already on org ${orgId}, no change needed`);
      return { success: true, previousOrgId: String(orgId), newOrgId: String(orgId) };
    }
    const isMatch = (org) => String(org.id) === String(orgId);
    const updatedOrgs = this.state.organizations.map((org) => ({
      ...org,
      selectedStatus: isMatch(org),
      isSelected: isMatch(org)
    }));
    this.state.organizations = updatedOrgs;
    this.state.selectedOrganization = updatedOrgs.find((o) => o.selectedStatus) || null;
    if (this.state.user) {
      this.state.user = {
        ...this.state.user,
        organizations: updatedOrgs
      };
    }
    const auth = this.storage.get("auth");
    if (auth) {
      this.storage.set("auth", {
        ...auth,
        user: { ...auth.user, organizations: updatedOrgs }
      });
    }
    const expires = /* @__PURE__ */ new Date();
    expires.setDate(expires.getDate() + 30);
    document.cookie = `user-selected-org-id=${orgId};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
    this.log(`\u{1F3E2} Organization switched: ${previousOrg?.name} -> ${targetOrg.name}`);
    this.log("\u{1F4CB} Updated organizations:", updatedOrgs.map((o) => `${o.name}: selectedStatus=${o.selectedStatus}`));
    this.emit("organizationSwitched", {
      previousOrgId: previousOrg?.id,
      newOrgId: orgId,
      organization: this.state.selectedOrganization
    });
    this.emit("organizationsUpdated", { organizations: updatedOrgs });
    if (this.state.mode === "standalone") {
      const result = {
        success: true,
        previousOrgId: previousOrg?.id,
        newOrgId: orgId,
        organizations: updatedOrgs,
        refreshErrors: {}
      };
      try {
        const br = await this.checkBalance();
        if (br.success) result.balance = br.balance;
        else result.refreshErrors.balance = br.error || "Failed";
      } catch (e) {
        result.refreshErrors.balance = e.message;
      }
      try {
        const hr = await this.getHistory(1, 10);
        if (hr.success) {
          result.history = {
            transactions: hr.transactions || [],
            total: hr.total || 0,
            page: hr.page || 1,
            pages: hr.pages || 1
          };
        } else result.refreshErrors.history = hr.error || "Failed";
      } catch (e) {
        result.refreshErrors.history = e.message;
      }
      try {
        const [allRes, filtRes] = await Promise.all([
          this.getAgents(true),
          this.getAgents(false)
        ]);
        result.agents = {
          all: allRes.success && allRes.agents ? allRes.agents : [],
          filtered: filtRes.success && filtRes.agents ? filtRes.agents : [],
          roleGrouped: filtRes.success && filtRes.roleGrouped ? filtRes.roleGrouped : {}
        };
        if (!allRes.success) result.refreshErrors.agents = allRes.error;
        if (!filtRes.success) result.refreshErrors.agents = (result.refreshErrors.agents || "") + "; " + filtRes.error;
      } catch (e) {
        result.refreshErrors.agents = e.message;
        result.agents = { all: [], filtered: [], roleGrouped: {} };
      }
      if (Object.keys(result.refreshErrors).length === 0) delete result.refreshErrors;
      return result;
    }
    return {
      success: true,
      previousOrgId: previousOrg?.id,
      newOrgId: orgId
    };
  }
  /**
   * Get current state
   */
  getState() {
    return { ...this.state };
  }
  /**
   * Debug logging
   */
  log(...args) {
    if (this.config.debug) {
      console.log("[CreditSystem]", ...args);
    }
  }
  /**
   * Destroy the client
   */
  destroy() {
    this.clearTimers();
    this.stopRouteWatcher();
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = void 0;
    }
    this.messageBridge.destroy();
    this.removeAllListeners();
    this.state.isInitialized = false;
  }
};

// src/react/useCreditSystem.tsx
var import_react = require("react");
function useCreditSystem(config) {
  const clientRef = (0, import_react.useRef)(null);
  const [isInitialized, setIsInitialized] = (0, import_react.useState)(false);
  const [isAuthenticated, setIsAuthenticated] = (0, import_react.useState)(false);
  const [isSuperAdmin, setIsSuperAdmin] = (0, import_react.useState)(false);
  const [mode, setMode] = (0, import_react.useState)(null);
  const [user, setUser] = (0, import_react.useState)(null);
  const [balance, setBalance] = (0, import_react.useState)(null);
  const [personas, setPersonas] = (0, import_react.useState)([]);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [error, setError] = (0, import_react.useState)(null);
  const [accessToken, setAccessToken] = (0, import_react.useState)(null);
  const [refreshToken, setRefreshToken] = (0, import_react.useState)(null);
  const [organizations, setOrganizations] = (0, import_react.useState)([]);
  const [selectedOrganization, setSelectedOrganization] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const client = new CreditSystemClient({
      ...config,
      autoInit: true
    });
    clientRef.current = client;
    client.on("ready", (data) => {
      if (data) {
        setIsInitialized(true);
        setIsAuthenticated(true);
        setIsSuperAdmin(data.user?.is_superadmin ?? false);
        setUser(data.user);
        setMode(data.mode);
        setLoading(false);
        const state = client.getState();
        setAccessToken(state.accessToken);
        setRefreshToken(state.refreshToken);
        setOrganizations(state.organizations);
        setSelectedOrganization(state.selectedOrganization);
      }
    });
    client.on("modeDetected", (data) => {
      if (data) {
        setMode(data.mode);
      }
    });
    client.on("authRequired", () => {
      setIsAuthenticated(false);
      setLoading(false);
    });
    client.on("loginSuccess", (data) => {
      if (data) {
        setIsAuthenticated(true);
        setIsSuperAdmin(data.user?.is_superadmin ?? false);
        setUser(data.user);
        setError(null);
        const state = client.getState();
        setAccessToken(state.accessToken);
        setRefreshToken(state.refreshToken);
        setOrganizations(state.organizations);
        setSelectedOrganization(state.selectedOrganization);
      }
    });
    client.on("loginError", (data) => {
      if (data) {
        setError(data.error);
      }
    });
    client.on("logoutSuccess", () => {
      setIsAuthenticated(false);
      setIsSuperAdmin(false);
      setUser(null);
      setBalance(null);
      setAccessToken(null);
      setRefreshToken(null);
      setOrganizations([]);
      setSelectedOrganization(null);
    });
    client.on("balanceUpdate", (data) => {
      if (data) {
        setBalance(data.balance);
      }
    });
    client.on("personasLoaded", (data) => {
      if (data) {
        setPersonas(data.personas);
      }
    });
    client.on("personasFailed", (data) => {
      if (data) {
        console.error("Failed to load personas:", data.error);
      }
    });
    client.on("error", (data) => {
      if (data) {
        setError(`${data.type}: ${data.error}`);
      }
    });
    client.on("tokenRefreshed", () => {
      if (config?.debug) {
        console.log("[useCreditSystem] Token refreshed - user remains authenticated");
      }
    });
    client.on("tokenExpired", () => {
      setIsAuthenticated(false);
      setError("Session expired. Please login again.");
    });
    client.on("tokensUpdated", (data) => {
      if (data) {
        setAccessToken(data.accessToken);
        if (data.refreshToken) {
          setRefreshToken(data.refreshToken);
        }
      }
    });
    client.on("organizationsUpdated", (data) => {
      if (data) {
        setOrganizations(data.organizations);
        const selected = data.organizations.find((o) => o.selectedStatus || o.isSelected) || null;
        setSelectedOrganization(selected);
      }
    });
    client.on("organizationSwitched", (data) => {
      if (data) {
        setSelectedOrganization(data.organization);
        const state = client.getState();
        setOrganizations(state.organizations);
      }
    });
    return () => {
      client.destroy();
    };
  }, []);
  const login = (0, import_react.useCallback)(async (email, password) => {
    setLoading(true);
    setError(null);
    if (!clientRef.current) {
      setLoading(false);
      return { success: false, error: "Client not initialized" };
    }
    const result = await clientRef.current.login(email, password);
    setLoading(false);
    return result;
  }, []);
  const logout = (0, import_react.useCallback)(async () => {
    if (!clientRef.current) return;
    await clientRef.current.logout();
  }, []);
  const checkBalance = (0, import_react.useCallback)(async () => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.checkBalance();
  }, []);
  const spendCredits = (0, import_react.useCallback)(async (amount, description, referenceId) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.spendCredits(amount, description, referenceId);
  }, []);
  const addCredits = (0, import_react.useCallback)(async (amount, type, description) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.addCredits(amount, type, description);
  }, []);
  const getHistory = (0, import_react.useCallback)(async (page, limit) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.getHistory(page, limit);
  }, []);
  const getAgents = (0, import_react.useCallback)(async (all) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.getAgents(all);
  }, []);
  const getPersonas = (0, import_react.useCallback)(async (organizationId, roleId) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.getPersonas(organizationId, roleId);
  }, []);
  const getPersonaById = (0, import_react.useCallback)(async (id) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.getPersonaById(id);
  }, []);
  const requestCurrentUserState = (0, import_react.useCallback)(async () => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.requestCurrentUserState();
  }, []);
  const requestUserOrganizations = (0, import_react.useCallback)(async () => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.requestUserOrganizations();
  }, []);
  const requestUserPersonas = (0, import_react.useCallback)(async () => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.requestUserPersonas();
  }, []);
  const switchOrganization = (0, import_react.useCallback)(async (orgId) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.switchOrganization(orgId);
  }, []);
  const listReports = (0, import_react.useCallback)(async (params) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized", reports: [] };
    }
    return await clientRef.current.listReports(params);
  }, []);
  const getReport = (0, import_react.useCallback)(async (id, organizationId) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.getReport(id, organizationId);
  }, []);
  const createReport = (0, import_react.useCallback)(async (params) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.createReport(params);
  }, []);
  const updateReport = (0, import_react.useCallback)(async (id, params) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.updateReport(id, params);
  }, []);
  const getSkills = (0, import_react.useCallback)(async (params) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.getSkills(params);
  }, []);
  const getSkillById = (0, import_react.useCallback)(async (id) => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.getSkillById(id);
  }, []);
  const requestUserSkills = (0, import_react.useCallback)(async () => {
    if (!clientRef.current) {
      return { success: false, error: "Client not initialized" };
    }
    return await clientRef.current.requestUserSkills();
  }, []);
  return {
    isInitialized,
    isAuthenticated,
    isSuperAdmin,
    mode,
    user,
    balance,
    personas,
    loading,
    error,
    accessToken,
    refreshToken,
    organizations,
    selectedOrganization,
    login,
    logout,
    checkBalance,
    spendCredits,
    addCredits,
    getHistory,
    getAgents,
    getPersonas,
    getPersonaById,
    requestCurrentUserState,
    requestUserOrganizations,
    requestUserPersonas,
    switchOrganization,
    listReports,
    getReport,
    createReport,
    updateReport,
    getSkills,
    getSkillById,
    requestUserSkills
  };
}

// src/react/CreditSystemProvider.tsx
var import_react2 = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var CreditSystemContext = (0, import_react2.createContext)(void 0);
function CreditSystemProvider({ children, config }) {
  const creditSystem = useCreditSystem(config);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CreditSystemContext.Provider, { value: creditSystem, children });
}
function useCreditContext() {
  const context = (0, import_react2.useContext)(CreditSystemContext);
  if (!context) {
    throw new Error("useCreditContext must be used within a CreditSystemProvider");
  }
  return context;
}

// src/react/useSwitchOrganization.tsx
var import_react3 = require("react");
function useSwitchOrganization() {
  const creditSystem = useCreditContext();
  const switchOrganization = (0, import_react3.useCallback)(
    async (orgId) => {
      return creditSystem.switchOrganization(orgId);
    },
    [creditSystem]
  );
  return {
    switchOrganization
  };
}

// src/parent/ParentIntegrator.ts
var TOKEN_REUSE_MS = 6e4;
var TOKEN_EXPIRY_BUFFER_MS = 12e4;
var FETCH_FAILURE_BACKOFF_MS = 5e3;
var ParentIntegrator = class {
  constructor(config) {
    this.iframe = null;
    this.tokenFetchedAt = 0;
    this.lastFetchFailedAt = 0;
    this.config = config;
    this.setupMessageListener();
  }
  /**
   * Attach to an iframe element
   */
  attachToIframe(iframe) {
    this.iframe = iframe;
    iframe.addEventListener("load", () => {
      if (this.config.debug) {
        console.log("[ParentIntegrator] Iframe loaded");
      }
    });
  }
  /**
   * Set up message listener for iframe communication
   */
  setupMessageListener() {
    this.messageHandler = async (event) => {
      if (!this.isValidOrigin(event.origin)) {
        if (this.config.debug) {
          console.warn("[ParentIntegrator] Invalid origin:", event.origin);
        }
        return;
      }
      if (!event.data || !event.data.type) return;
      if (this.config.debug) {
        console.log("[ParentIntegrator] Received message:", event.data.type, event.data);
      }
      switch (event.data.type) {
        case "REQUEST_JWT_TOKEN":
          await this.handleTokenRequest();
          break;
        case "REQUEST_CURRENT_USER_STATE":
          await this.handleUserStateRequest();
          break;
        case "CREDIT_SYSTEM_READY":
          this.handleIframeReady(event.data);
          break;
        case "BALANCE_UPDATE":
          this.handleBalanceUpdate(event.data);
          break;
        case "CREDITS_SPENT":
          this.handleCreditsSpent(event.data);
          break;
        case "CREDITS_ADDED":
          this.handleCreditsAdded(event.data);
          break;
        case "JWT_TOKEN_REFRESHED":
          this.handleTokenRefreshed(event.data);
          break;
        case "LOGOUT":
          this.handleLogout();
          break;
        case "ERROR":
          this.handleError(event.data);
          break;
        case "STATUS_RESPONSE":
          this.handleStatusResponse(event.data);
          break;
        default:
          if (this.config.debug) {
            console.log("[ParentIntegrator] Unhandled message type:", event.data.type);
          }
      }
    };
    window.addEventListener("message", this.messageHandler);
  }
  /**
   * Handle JWT token request from iframe
   */
  async handleTokenRequest() {
    if (this.config.debug) {
      console.log("[ParentIntegrator] Iframe requesting JWT token");
    }
    if (this.hasReusableToken()) {
      if (this.config.debug) {
        console.log("[ParentIntegrator] Serving JWT token from cache");
      }
      this.sendTokenResponse(this.cachedToken);
      return;
    }
    if (this.lastFetchFailedAt && Date.now() - this.lastFetchFailedAt < FETCH_FAILURE_BACKOFF_MS) {
      if (this.config.debug) {
        console.log("[ParentIntegrator] Token fetch in failure backoff, not retrying yet");
      }
      this.sendToIframe("JWT_TOKEN_RESPONSE", {
        token: null,
        error: "Token fetch temporarily unavailable",
        timestamp: Date.now()
      });
      return;
    }
    try {
      if (!this.tokenFetchPromise) {
        this.tokenFetchPromise = this.config.getJWTToken().finally(() => {
          this.tokenFetchPromise = void 0;
        });
      }
      const tokenData = await this.tokenFetchPromise;
      if (tokenData) {
        this.cachedToken = tokenData;
        this.tokenFetchedAt = Date.now();
        this.lastFetchFailedAt = 0;
        this.sendTokenResponse(tokenData);
        if (this.config.debug) {
          console.log("[ParentIntegrator] JWT token sent to iframe");
        }
      } else {
        this.lastFetchFailedAt = Date.now();
        this.sendToIframe("JWT_TOKEN_RESPONSE", {
          token: null,
          error: "Authentication required",
          timestamp: Date.now()
        });
        if (this.config.debug) {
          console.log("[ParentIntegrator] No JWT token available");
        }
      }
    } catch (error) {
      if (this.config.debug) {
        console.error("[ParentIntegrator] Error getting JWT token:", error);
      }
      this.lastFetchFailedAt = Date.now();
      this.sendToIframe("JWT_TOKEN_RESPONSE", {
        token: null,
        error: error.message || "Failed to get token",
        timestamp: Date.now()
      });
    }
  }
  sendTokenResponse(tokenData) {
    this.sendToIframe("JWT_TOKEN_RESPONSE", {
      token: tokenData.token,
      refreshToken: tokenData.refreshToken,
      user: tokenData.user,
      isSuperAdmin: tokenData.user?.is_superadmin ?? false,
      timestamp: Date.now()
    });
  }
  hasReusableToken() {
    if (!this.cachedToken || !this.tokenFetchedAt) {
      return false;
    }
    if (Date.now() - this.tokenFetchedAt < TOKEN_REUSE_MS) {
      return true;
    }
    return typeof document !== "undefined" && document.hidden && tokenHasRemainingLife(this.cachedToken.token, TOKEN_EXPIRY_BUFFER_MS / 1e3);
  }
  /**
   * Handle user state request from iframe
   */
  async handleUserStateRequest() {
    if (this.config.debug) {
      console.log("[ParentIntegrator] Iframe requesting current user state");
    }
    try {
      if (this.config.getCurrentUserState) {
        const userState = await this.config.getCurrentUserState();
        if (userState) {
          this.sendToIframe("RESPONSE_CURRENT_USER_STATE", {
            userState,
            timestamp: Date.now()
          });
          if (this.config.debug) {
            console.log("[ParentIntegrator] User state sent to iframe:", userState);
          }
        } else {
          this.sendToIframe("RESPONSE_CURRENT_USER_STATE", {
            userState: null,
            error: "User state not available",
            timestamp: Date.now()
          });
          if (this.config.debug) {
            console.log("[ParentIntegrator] No user state available");
          }
        }
      } else {
        this.sendToIframe("RESPONSE_CURRENT_USER_STATE", {
          userState: null,
          error: "getCurrentUserState callback not configured",
          timestamp: Date.now()
        });
        if (this.config.debug) {
          console.log("[ParentIntegrator] getCurrentUserState callback not configured in ParentConfig");
        }
      }
    } catch (error) {
      if (this.config.debug) {
        console.error("[ParentIntegrator] Error getting user state:", error);
      }
      this.sendToIframe("RESPONSE_CURRENT_USER_STATE", {
        userState: null,
        error: error.message || "Failed to get user state",
        timestamp: Date.now()
      });
    }
  }
  /**
   * Handle iframe ready event
   */
  handleIframeReady(data) {
    if (this.config.debug) {
      console.log("[ParentIntegrator] Credit system ready:", data);
    }
    if (this.config.onIframeReady) {
      this.config.onIframeReady();
    }
  }
  /**
   * Handle balance update
   */
  handleBalanceUpdate(data) {
    if (this.config.onBalanceUpdate) {
      this.config.onBalanceUpdate(data.balance);
    }
  }
  /**
   * Handle credits spent
   */
  handleCreditsSpent(data) {
    if (this.config.onCreditsSpent) {
      this.config.onCreditsSpent(data.amount, data.newBalance);
    }
  }
  /**
   * Handle credits added
   */
  handleCreditsAdded(data) {
    if (this.config.onCreditsAdded) {
      this.config.onCreditsAdded(data.amount, data.newBalance);
    }
  }
  /**
   * Handle token refreshed
   */
  handleTokenRefreshed(data) {
    if (data.token && this.cachedToken) {
      this.cachedToken.token = data.token;
    }
  }
  /**
   * Handle logout
   */
  handleLogout() {
    this.cachedToken = void 0;
    this.tokenFetchedAt = 0;
    if (this.config.onLogout) {
      this.config.onLogout();
    }
  }
  /**
   * Handle error
   */
  handleError(data) {
    if (this.config.onError) {
      this.config.onError(data.message || "Unknown error");
    }
  }
  /**
   * Handle status response
   */
  handleStatusResponse(data) {
    if (this.config.debug) {
      console.log("[ParentIntegrator] Status:", data);
    }
  }
  /**
   * Send message to iframe
   */
  sendToIframe(type, data = {}) {
    if (!this.iframe || !this.iframe.contentWindow) {
      if (this.config.debug) {
        console.warn("[ParentIntegrator] Iframe not ready");
      }
      return false;
    }
    const message = {
      type,
      ...data,
      timestamp: Date.now()
    };
    if (this.config.debug) {
      console.log("[ParentIntegrator] Sending to iframe:", message);
    }
    this.iframe.contentWindow.postMessage(message, "*");
    return true;
  }
  /**
   * Validate message origin
   */
  isValidOrigin(origin) {
    if (origin === window.location.origin) {
      return true;
    }
    if (this.config.allowedOrigins && this.config.allowedOrigins.length > 0) {
      return this.config.allowedOrigins.includes(origin);
    }
    return true;
  }
  /**
   * Request balance refresh from iframe
   */
  refreshBalance() {
    this.sendToIframe("REFRESH_BALANCE");
  }
  /**
   * Request status from iframe
   */
  getStatus() {
    this.sendToIframe("GET_STATUS");
  }
  /**
   * Clear iframe storage
   */
  clearStorage() {
    this.sendToIframe("CLEAR_STORAGE");
  }
  /**
   * Send custom message to iframe
   */
  sendCustomMessage(message, data) {
    this.sendToIframe("CUSTOM_MESSAGE", { message, ...data });
  }
  /**
   * Destroy the integrator
   */
  destroy() {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
    }
    this.iframe = null;
    this.cachedToken = void 0;
    this.tokenFetchedAt = 0;
  }
};

// src/index.ts
var index_default = CreditSystemClient;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CreditSystemClient,
  CreditSystemProvider,
  ParentIntegrator,
  PersonasClient,
  ReportsClient,
  SkillsClient,
  useCreditContext,
  useCreditSystem,
  useSwitchOrganization
});
