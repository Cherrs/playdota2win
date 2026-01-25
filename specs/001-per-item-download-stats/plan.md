# Implementation Plan: Per-Item Download Statistics

**Branch**: `001-per-item-download-stats` | **Date**: 2026-01-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-per-item-download-stats/spec.md`

## Summary

Add per-item download count tracking to enable administrators to view individual download statistics for each item in the admin panel, while maintaining the existing aggregate total count display on the public download page. This feature extends the existing `DownloadItem` type to include a `downloadCount` field and modifies KV update logic to atomically increment counts per item.

**Technical Approach**: Extend the existing Cloudflare KV-based storage architecture to store per-item download counts within each `DownloadItem` object. Modify the `/api/downloads/link` endpoint to increment the specific item's count atomically, update the admin and public API responses to include/calculate appropriate counts, and enhance the admin UI to display per-item statistics.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict mode) with Svelte 5.45  
**Primary Dependencies**: SvelteKit 2.49, @sveltejs/adapter-cloudflare 7.2, Wrangler 4.59  
**Storage**: Cloudflare KV (APP_KV binding) for download metadata; R2 (UPLOADS_BUCKET) for file storage  
**Testing**: svelte-check for type safety, ESLint + Prettier for code quality (no unit test framework configured)  
**Target Platform**: Cloudflare Workers (deployed via Wrangler)  
**Project Type**: Web application (SvelteKit SSR + API endpoints)  
**Performance Goals**: Admin panel loads statistics within 1 second (SC-001); count updates within 5 seconds of download (SC-002)  
**Constraints**: Atomic KV updates required for concurrency (SC-003); support 10,000+ items without degradation (SC-005)  
**Scale/Scope**: Small feature extension affecting 2 API endpoints, 1 type definition, 2 UI components

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Verify compliance with constitution principles (see `.specify/memory/constitution.md`):

### Initial Check (Before Phase 0)

- [x] **Svelte 5 First**: All components use `$state()`, `$props()`, `{@render}`, `onclick=` syntax (no new components planned, only UI updates to existing Svelte 5 components)
- [x] **Type Safety**: Strict TypeScript enabled; all exports have explicit return types (will extend `DownloadItem` interface with explicit `downloadCount: number` type)
- [x] **Cloudflare Runtime**: No Node.js APIs; platform bindings guarded with `if (!binding)` (existing KV guards in place; will follow same pattern)
- [x] **Security by Default**: Auth validation present; input sanitization; path traversal checks (no new auth/input handling; reuses existing download link validation)
- [x] **UI/UX Consistency**: Design tokens followed (colors, typography, motion patterns) (admin panel display will use existing card/table styles with consistent typography)

**Initial Violations**: None

### Post-Design Check (After Phase 1)

- [x] **Svelte 5 First**: Confirmed - UI changes only modify existing Svelte 5 components (`DownloadList.svelte`); no legacy syntax introduced
- [x] **Type Safety**: Confirmed - `downloadCount?: number` added to `DownloadItem` interface with optional type; all API handlers maintain explicit return types (`Promise<Response>`)
- [x] **Cloudflare Runtime**: Confirmed - All KV operations wrapped in existing `try/catch` blocks with `if (!kv)` guards; no Node.js APIs used
- [x] **Security by Default**: Confirmed - No new auth/validation logic needed; count increments happen after existing password/Turnstile verification; `downloadCount` is system-managed (not user-editable)
- [x] **UI/UX Consistency**: Confirmed - Design uses existing color palette (`#6B4C9A`, `#FF6B9D`), `Nunito` font, and consistent spacing/styling patterns from current components

**Post-Design Violations**: None

**Design Validation Notes**:

- Type safety verified in `data-model.md` - optional field with runtime defaults handles backward compatibility
- UI mockup in `quickstart.md` follows existing card layout patterns with consistent iconography
- API contracts in `contracts/api-updates.yaml` maintain existing `ApiResponse<T>` type patterns
- No infrastructure changes required beyond existing KV/R2 bindings

## Project Structure

### Documentation (this feature)

```text
specs/001-per-item-download-stats/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature specification (already created)
├── research.md          # Phase 0 output (to be created)
├── data-model.md        # Phase 1 output (to be created)
├── quickstart.md        # Phase 1 output (to be created)
├── contracts/           # Phase 1 output (to be created)
│   └── api-updates.yaml # OpenAPI spec for modified endpoints
└── checklists/
    └── requirements.md  # Quality checklist (already created)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── types.ts                        # Type definitions (MODIFY: add downloadCount to DownloadItem)
│   └── components/
│       ├── AdminHeader.svelte          # Admin header stats (MODIFY: display per-item counts)
│       └── DownloadList.svelte         # Admin download list (MODIFY: show individual counts)
├── routes/
│   ├── admin/
│   │   └── +page.svelte                # Admin page (MODIFY: pass/display counts)
│   ├── download/
│   │   └── +page.svelte                # Public download page (NO CHANGE: already uses total)
│   └── api/
│       ├── admin/
│       │   └── +server.ts              # Admin API (MODIFY: return items with counts)
│       ├── downloads/
│       │   └── +server.ts              # Public downloads API (MODIFY: calculate total from items)
│       └── downloads/link/
│           └── +server.ts              # Download link generation (MODIFY: increment per-item count)
```

**Structure Decision**: This is a single SvelteKit project with standard routes and API structure. The feature primarily modifies existing files rather than creating new modules, following the established pattern of KV-backed API endpoints and Svelte 5 component updates.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations detected - table not needed.
