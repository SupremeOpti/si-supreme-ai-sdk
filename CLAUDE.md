# CLAUDE.md

Agent instructions for working in this repo (`@supreme-ai/si-sdk`).

## Project shape

- TypeScript SDK published from GitHub (`github:SupremeOpti/si-supreme-ai-sdk`).
- Source lives under [src/](src/) and is split into:
  - [src/core/](src/core/) — imperative clients (`CreditSystemClient`, `ReportsClient`, `PersonasClient`).
  - [src/react/](src/react/) — hooks and provider.
  - [src/parent/](src/parent/) — `ParentIntegrator` for embedded/iframe parents.
  - [src/utils/](src/utils/) — `ApiClient`, `AuthManager`, `MessageBridge`, `StorageManager`, `EventEmitter`.
  - [src/types/](src/types/) — public types.
- Public surface is re-exported from [src/index.ts](src/index.ts).

## Documentation rules (must follow)

When you change anything that affects the public SDK surface or HTTP behavior, update the docs **in the same change**. The README is the source of truth consumers read.

You MUST update documentation when you:

1. **Add, remove, or rename an HTTP endpoint** the SDK calls (path, method, query, or request body).
2. **Add, remove, or rename an SDK method** on `useCreditSystem`, `CreditSystemClient`, `ReportsClient`, `PersonasClient`, or `ParentIntegrator`.
3. **Change a method signature** (params, defaults, return shape).
4. **Change `CreditSDKConfig`** (new field, renamed field, default change).
5. **Change a postMessage contract** between embedded child and parent (message `type`, payload shape).
6. **Change an environment variable** or how a base URL is derived.
7. **Change auth/refresh behavior** (token storage keys, retry rules, 401 handling).
8. **Change a feature flag default** in `features` (`credits`, `personas`, `reports`, …).

For each of the above, update [README.md](README.md):

- The relevant section under **API reference** (HTTP row, request/response examples).
- The **SDK method index** table.
- The **Configuration reference** block if `CreditSDKConfig` changed.
- The **Environment variables** table if env vars changed.
- The **Exports** table if a new public export was added or removed.
- The endpoint-specific doc under [docs/](docs/) if one exists (e.g. [docs/GET_AGENTS_API.md](docs/GET_AGENTS_API.md)). Create a new file there for substantial new endpoint groups.

Keep examples realistic. Response examples should match what the SDK actually returns (the normalized `{ success: true, ... }` shape), not the raw upstream HTTP body, unless the section is explicitly documenting HTTP.

If a change is purely internal (refactor inside `utils/`, no behavior change), you do **not** need to update the README — but you still must add a changelog entry (see below).

## Changelog rule (must follow)

The README ends with a `## Changelog` section. **Add a new entry on every change**, no exceptions — including internal refactors, doc-only edits, and dependency bumps.

Format:

```markdown
### YYYY-MM-DD

- One-line description of the change. Reference touched files with markdown links, e.g. [ReportsClient.ts](src/core/ReportsClient.ts).
```

Rules:

- Newest entry goes **at the top** of the Changelog section (under the `## Changelog` heading).
- Use today's date (`YYYY-MM-DD`). If multiple changes land the same day, append bullets under the same date heading rather than creating a new date.
- One bullet per logical change. Keep bullets short — the diff is the detail.
- Mention the affected API/method/file so a reader can locate the change without `git log`.
- Do **not** rewrite or reorder historical entries.

If a change touches both code and docs, that's still one bullet — describe the change, not the file count.

## Workflow checklist

Before reporting a task complete, verify:

- [ ] If the public surface or HTTP behavior changed, the relevant README sections are updated.
- [ ] A new Changelog entry exists at the top of the Changelog section with today's date.
- [ ] Examples in the README still compile / match the new types.
- [ ] No stale references to renamed/removed methods, endpoints, or config fields.

## Style notes

- Match existing README tone: terse tables, short code blocks, no marketing language.
- Don't add emojis to docs or code.
- Don't introduce new docs files for trivial additions — extend the README first.
