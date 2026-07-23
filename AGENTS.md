# Repository Guidelines

## Project Structure & Module Organization

This Svelte 5/SvelteKit application deploys to Cloudflare Workers. Pages and API handlers live in `src/routes/`; HTTP endpoints use SvelteKit's `+server.ts` convention. Reusable UI belongs in `src/lib/components/`, helpers in `src/lib/utils/`, Worker-only logic in `src/lib/server/`, and voice integration in `src/lib/mumble/`. Keep tests beside their implementation as `*.test.ts`; script tests use `scripts/*.test.js`. Static files are in `static/`, CLIs in `scripts/`, and product/design notes in `docs/`. Do not edit generated `.svelte-kit/`, `.wrangler/`, or `src/worker-configuration.d.ts` files manually.

## Build, Test, and Development Commands

- `npm ci`: install the locked dependency set (CI uses Node 24).
- `npm run dev`: start the Vite development server.
- `npm run preview`: build and run the app through local Wrangler.
- `npm test`: run all TypeScript and JavaScript tests.
- `npm run lint`: run ESLint and check Prettier formatting.
- `npm run check`: synchronize SvelteKit and run `svelte-check`.
- `npm run verify`: run Cloudflare type checks, linting, Svelte checks, tests, and the production build. Use this before opening a PR.

Use `npm run seed` only to initialize local metadata. After changing Worker bindings, run `npm run cf-typegen` and commit the regenerated declaration.

## Coding Style & Naming Conventions

TypeScript is strict. Prettier enforces tabs, single quotes, no trailing commas, a 100-column limit, and Svelte formatting. Use PascalCase for components and exported types, camelCase for functions and fields, SCREAMING_SNAKE_CASE for constants, and kebab-case for multiword utility modules. Keep Cloudflare-only APIs out of browser components and prefer `$lib` imports for shared code.

## Testing Guidelines

Tests use Node's `node:test` and `node:assert/strict`. Write behavior-focused names and cover success, failure, and validation paths. Run one file with `node --experimental-transform-types --test src/lib/auth.test.ts`. No coverage threshold is configured; add focused regression tests for changed behavior.

## Commit & Pull Request Guidelines

Follow the prevailing `type: short imperative summary` style, such as `fix: avoid duplicate voice replay on reconnect`; common types include `feat`, `fix`, `test`, `docs`, and `chore`. Keep commits focused. PRs should explain user-visible, API, storage, or configuration effects; link relevant issues or design notes; list validation performed; and include screenshots for UI changes. CI must pass `npm run verify`.

## Security & Configuration

Never commit credentials or local `.env`/`.dev.vars` files. Store deployed secrets with `npx wrangler secret put <NAME>`. Treat `seed:remote` and metadata migrations as controlled operations and follow the safeguards in `README.md` before running them.
