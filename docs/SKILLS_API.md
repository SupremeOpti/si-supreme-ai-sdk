# Skills API

Detailed contract for the Skills JWT endpoints consumed by `@supreme-ai/si-sdk`.

A "skill" is a SKILL.md document (Claude Code skill) the platform publishes to child apps so their devs / AI agents can install or reference it. The SDK is **read-only** against this surface.

## Visibility model

| Value | Returned to |
|-------|-------------|
| `private` | Never returned by these endpoints. Hidden from the SDK entirely. |
| `internal` | Authenticated callers whose selected organization matches the skill's `organization_id`. |
| `public` | Any authenticated caller, regardless of organization. |

Server enforces all three rules. The SDK does no client-side filtering — what the server returns is what the caller is allowed to see.

`internal` skills always have a non-null `organization_id`. `public` skills may have either a `null` `organization_id` (platform-wide) or one set to the publishing org's id (org-authored, but globally visible).

## Authentication

Standard SDK JWT auth: send `Authorization: Bearer <access_token>` from the SDK's `AuthManager`. No additional headers required.

## Endpoints

### `GET {skillsApiBaseUrl}/list`

List non-private skills visible to the caller.

**Query parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `organization_id` | string\|number | SDK-selected org | Scopes `internal` skills. Caller must be a member; server returns 403 otherwise. |
| `category` | string | — | Filter by category slug. |
| `visibility` | `internal` \| `public` | — | Narrow to one band. `private` is rejected (400). |
| `cursor` | string | — | Opaque pagination cursor from a prior response. |
| `per_page` | number | 25 | Max 100. |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "skills": [
      {
        "id": 7,
        "organization_id": null,
        "name": "supreme-ai-sdk",
        "description": "Install, configure, and integrate @supreme-ai/si-sdk",
        "category": "integration",
        "version": "1.0.0",
        "visibility": "public",
        "created_at": "2026-05-22T10:00:00Z",
        "updated_at": "2026-05-22T10:00:00Z"
      }
    ],
    "next_cursor": null
  }
}
```

The SDK normalizes this to `{ success: true, skills: [...], nextCursor: null }`.

List responses do **not** include the `body` field. Use `GET /{id}` to fetch the SKILL.md content.

### `GET {skillsApiBaseUrl}/{id}`

Fetch one skill including its full SKILL.md `body`.

**Path parameters:**

| Param | Type | Notes |
|-------|------|-------|
| `id` | number | Skill id. |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "skill": {
      "id": 7,
      "organization_id": null,
      "name": "supreme-ai-sdk",
      "description": "Install, configure, and integrate @supreme-ai/si-sdk",
      "category": "integration",
      "version": "1.0.0",
      "visibility": "public",
      "created_at": "2026-05-22T10:00:00Z",
      "updated_at": "2026-05-22T10:00:00Z",
      "body": "---\nname: supreme-ai-sdk\ndescription: ...\n---\n\n# Supreme AI SDK integration skill\n..."
    }
  }
}
```

**Response (404):**

Returned when the skill does not exist **or** the caller is not entitled to read it. Private skills and internal skills outside the caller's org both yield 404 — the endpoint does not leak existence.

```json
{ "success": false, "message": "Skill not found" }
```

## Embedded mode bridge

In embedded mode the child app can avoid the HTTP round-trip by asking the parent frame to serve skills it has already curated for that origin.

**Child → parent:**

```json
{ "type": "REQUEST_USER_SKILLS", "origin": "https://child.example", "timestamp": 1716415200000 }
```

**Parent → child:**

```json
{
  "type": "RESPONSE_USER_SKILLS",
  "skills": [ /* SkillSummary[] — non-private only */ ],
  "count": 3,
  "timestamp": 1716415200500
}
```

The parent **must** strip `private` skills before responding. The SDK trusts the parent to enforce this.

## Error shape

All non-2xx responses use the SDK's standard envelope:

```json
{ "success": false, "message": "Human-readable reason" }
```

The SDK surfaces these as `{ success: false, error: message }`.

## Stability

The endpoint shape above is the contract the SDK calls. Backward-compatible changes the SDK already handles:

- A bare array (`[ ...skills ]`) in place of `{ skills, next_cursor }` is accepted on `/list` for forward compatibility, but new deployments should use the object form.
- Either `next_cursor` (snake) or `nextCursor` (camel) is accepted on the response. Prefer snake_case to match the rest of the platform.

Breaking changes here require an SDK version bump and a corresponding README + changelog entry per [CLAUDE.md](../CLAUDE.md).
