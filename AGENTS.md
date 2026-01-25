# AGENTS.md

Purpose

- Guidance for agentic coding in this repository.
- Applies to SvelteKit + Cloudflare Workers code.

Repository overview

- SvelteKit 2 + Svelte 5 with adapter-cloudflare.
- Deployed via Wrangler; worker entry in `.svelte-kit/cloudflare/_worker.js`.
- Routes live in `src/routes`; shared code in `src/lib` via `$lib` alias.

Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Preview (Workers local): `npm run preview`
- Deploy: `npm run deploy`
- Type check: `npm run check`
- Type check watch: `npm run check:watch`
- Lint: `npm run lint`
- Format (write): `npm run format`
- Cloudflare types: `npm run cf-typegen`

Tests

- No unit/integration test runner configured.
- Use `npm run check` for type safety and `npm run lint` for style enforcement.
- Single test run: not applicable (no test framework configured).

Project structure

- `src/routes/+layout.svelte`: root layout (Svelte 5 syntax).
- `src/routes/+page.svelte`: root page, imports Download page.
- `src/routes/download/+page.svelte`: main public download page.
- `src/routes/admin/+page.svelte`: admin UI.
- `src/routes/api/**/+server.ts`: API endpoints.
- `src/lib/*`: shared helpers and types.

Svelte 5 conventions (from Copilot rules)

- Use `$state()` for reactive state.
- Use `$props()` to receive props.
- Use `{@render children()}` for slots.
- Use `onclick={handler}` instead of `on:click={handler}`.

Code style

- Language: TypeScript in Svelte and API files.
- Module system: ESM, `type: module` in `package.json`.
- Formatting: Prettier with Svelte plugin; run `npm run format`.
- Linting: ESLint with Svelte and TypeScript configs.
- Indentation: tabs (consistent with existing files).
- Line width: follow Prettier output; do not hand-wrap.

Imports

- Prefer `$lib/*` for shared modules.
- Order: external packages, SvelteKit imports, `$lib` imports, relative imports.
- Use `type` imports for types where possible (`import type { ... }`).
- Avoid unused imports; keep imports minimal.

Naming conventions

- Files: SvelteKit conventions (`+page.svelte`, `+server.ts`).
- Types/interfaces: PascalCase (`DownloadItem`).
- Functions/vars: camelCase (`verifyDownloadToken`).
- Constants: UPPER_SNAKE_CASE for shared constants.
- Booleans: prefer `is*/has*/should*` prefixes.

TypeScript and typing

- Keep `strict` TypeScript behavior.
- Prefer explicit return types for exported functions.
- Use `satisfies` for API response typing where appropriate.
- Use narrow types and union literals for enums (`'link' | 'r2' | 's3'`).

API handlers

- SvelteKit endpoints under `src/routes/api/**/+server.ts`.
- Use `json` from `@sveltejs/kit` for JSON responses.
- Return typed payloads using `satisfies ApiResponse<...>`.
- Validate inputs early; return 4xx for client issues.
- Wrap handler bodies in `try/catch` and log errors.

Error handling

- Use `try/catch` around async operations (KV, R2, fetch).
- Return user-safe error messages, log details to `console.error`.
- Avoid throwing from handlers; return a Response instead.

Cloudflare runtime

- Env access via `platform?.env` in handlers.
- KV and R2 bindings are optional in dev; guard when missing.
- Secrets: `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET`, `ADMIN_SIGNING_SECRET`, `DOWNLOAD_PASSWORD`, `TURNSTILE_*`.
- Do not hardcode secrets; keep fallback values dev-only.

Security and auth patterns

- Admin auth uses JWT in `Authorization: Bearer <token>`.
- Download auth uses short-lived tokens stored in KV.
- Validate path segments for R2 relay; reject `..`, `/`, `\`.

UI/UX rules from Copilot instructions

- Visual direction is cute/anime inspired.
- Colors: soft pink/purple gradient; primary accent `#6B4C9A`, highlight `#FF6B9D`.
- Typography: `Fredoka` for headings, `Nunito` for body; include CN fallbacks.
- Motion: floating stars/clouds, hover lift, subtle bounce.
- Buttons: gradient backgrounds, rounded corners, hover lift.
- Cards: translucent white, mild blur, soft shadow.

CSS and styling

- Use component `<style>` blocks (scoped by default).
- For global styles use `:global(...)`.
- Avoid CSS `inset` shorthand; use `top/right/bottom/left`.
- Use `transform` for hover effects, not layout changes.
- Add `cursor: pointer` on interactive elements.

Data and storage

- Download items stored in KV under `downloads_list`.
- Keep `downloadCount` and `lastUpdated` updated on writes.
- When generating signed URLs, do not persist `signedUrl`.

Formatting patterns

- Use `const` by default; `let` only when reassigned.
- Use early returns for validation failures.
- Prefer `async/await` over `.then()`.
- Prefer template literals for string composition.

Common pitfalls

- Svelte 5 event syntax: do not use `on:click`.
- Ensure Turnstile scripts are loaded only once and cleaned up.
- KV/R2 are not available in dev; guard with `if (!kv)`.

When adding new files

- Match existing directory patterns under `src/routes` and `src/lib`.
- Keep names in ASCII and use kebab-case for folders.
- Avoid adding new docs unless requested.

Agent workflow suggestions

- Run `npm run lint` and `npm run check` before finalizing.
- Use `npm run format` after structural changes.
- Do not modify `wrangler.jsonc` unless needed for deployment.

Cursor/Copilot rules

- Cursor rules: none found in `.cursor/rules/` or `.cursorrules`.
- Copilot rules: see `.github/copilot-instructions.md` for Svelte 5 and UI guidance.

## Active Technologies
- TypeScript 5.9 (strict mode) with Svelte 5.45 + SvelteKit 2.49, @sveltejs/adapter-cloudflare 7.2, Wrangler 4.59 (001-per-item-download-stats)
- Cloudflare KV (APP_KV binding) for download metadata; R2 (UPLOADS_BUCKET) for file storage (001-per-item-download-stats)

## Recent Changes
- 001-per-item-download-stats: Added TypeScript 5.9 (strict mode) with Svelte 5.45 + SvelteKit 2.49, @sveltejs/adapter-cloudflare 7.2, Wrangler 4.59
