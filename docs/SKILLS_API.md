# Skills API

Detailed contract for the Skills JWT endpoints consumed by `@supreme-ai/si-sdk`.

A "skill" is a SKILL.md document the platform publishes to child apps so their devs / AI agents can install or reference it. The SDK is **read-only** against this surface.

## Two-step shape

| Endpoint | Returns | `content` |
|----------|---------|-----------|
| `GET /list` | `SkillSummary[]` | omitted |
| `GET /{id}` | `Skill` (extends `SkillSummary`) | packaged on demand |

Rationale: SKILL.md bodies can be many KB each, and the backend packages them on demand. Returning `content` on every list entry would balloon payloads and force the backend to package skills the caller never opens. Same approach the SDK already uses for reports.

## Visibility

Private skills are filtered out server-side before the response is built. The response payload does not include a `visibility` field — the contract is "what you receive is what you are entitled to see." Any non-private skill the authenticated user can read may appear in these endpoints.

`is_owner` on each returned skill indicates whether the authenticated caller is the creator.

## Authentication

Standard SDK JWT auth: send `Authorization: Bearer <access_token>` from the SDK's `AuthManager`. No additional headers required.

## Shapes

```ts
interface SkillCreator {
  id: number;
  name: string;
  email?: string | null;
}

interface SkillSummary {
  id: number;
  title: string;
  description: string;
  template: string | null;
  creator: SkillCreator;
  is_owner: boolean;
  created_at: string;
  updated_at: string;
}

interface Skill extends SkillSummary {
  /** Packaged SKILL.md frontmatter + markdown body. `null` until authored. */
  content: string | null;
}
```

## Endpoints

### `GET {skillsApiBaseUrl}/list`

List non-private skills visible to the caller. Summary shape only — no `content`.

**Query parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `organization_id` | string\|number | SDK-selected org | Scopes the listing to skills in this organization where applicable. |
| `cursor` | string | — | Opaque pagination cursor from a prior response. |
| `per_page` | number | 25 | Max 100. |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "skills": [
      {
        "id": 5,
        "title": "Prestige Presenter",
        "description": "Build polished client presentations from raw notes",
        "template": null,
        "creator": { "id": 525, "name": "Aileen O'Connell", "email": null },
        "is_owner": false,
        "created_at": "2026-05-18T20:55:43.000000Z",
        "updated_at": "2026-05-18T20:55:43.000000Z"
      }
    ],
    "next_cursor": null
  }
}
```

The SDK normalizes this to `{ success: true, skills: [...], nextCursor: null }`.

The backend **must not** include `content` on list entries. If it does, the SDK will pass it through (no client-side stripping), defeating the size-control purpose of the two-step shape.

### `GET {skillsApiBaseUrl}/{id}`

Fetch one skill including its packaged SKILL.md `content`. The backend packages content on demand for this call.

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
      "id": 5,
      "title": "Prestige Presenter",
      "description": "Build polished client presentations from raw notes",
      "content": "---\nname: prestige-presenter\ndescription: ...\n---\n\n# Prestige Presenter\n...",
      "template": null,
      "creator": { "id": 525, "name": "Aileen O'Connell", "email": null },
      "is_owner": false,
      "created_at": "2026-05-18T20:55:43.000000Z",
      "updated_at": "2026-05-18T20:55:43.000000Z"
    }
  }
}
```

`content` may be `null` when no SKILL.md body has been authored for the skill yet — the record exists but there's nothing to package.

**Response (404):**

Returned when the skill does not exist **or** the caller is not entitled to read it. Private skills and skills outside the caller's scope both yield 404 — the endpoint does not leak existence.

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
  "skills": [ /* SkillSummary[] — non-private only, no content */ ],
  "count": 3,
  "timestamp": 1716415200500
}
```

The parent **must** strip private skills before responding. The SDK trusts the parent to enforce this. The parent should also omit `content` from the postMessage payload — child apps fetch the body via `getSkillById` when a skill is actually selected.

## Error shape

All non-2xx responses use the SDK's standard envelope:

```json
{ "success": false, "message": "Human-readable reason" }
```

The SDK surfaces these as `{ success: false, error: message }`.

## Stability

Backward-compatible response shapes the SDK already handles:

- A bare array (`[ ...skills ]`) in place of `{ skills, next_cursor }` is accepted on `/list` for forward compatibility, but new deployments should use the object form.
- Either `next_cursor` (snake) or `nextCursor` (camel) is accepted on the response. Prefer snake_case to match the rest of the platform.
- The single-skill endpoint may return either `{ data: { skill: {...} } }` or `{ data: {...} }` (skill at the data root). Both are normalized to `{ skill: ... }` by the SDK.

Breaking changes here require an SDK version bump and a corresponding README + changelog entry per [CLAUDE.md](../CLAUDE.md).

## Known data issues (2026-05-27 snapshot)

- Several skill `description` fields contain the literal characters `">"` or `"|"` — these are YAML block-scalar indicators, suggesting the SKILL.md ingestion step is reading the scalar marker token instead of the value that follows it. Worth fixing before the next bulk import.
