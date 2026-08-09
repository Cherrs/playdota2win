# Repository Guidelines

## Project Structure & Module Organization

This React 19 application uses Vite and deploys as a Cloudflare Worker with SPA assets. Route
composition lives in `src/router.ts`, pages in `src/pages/`, and reusable UI in
`src/components/`. HTTP endpoints live in `worker/routes/` and are dispatched by
`worker/index.ts`. Shared helpers remain in `src/lib/utils/`, Worker-only logic in
`src/lib/server/`, and the framework-neutral voice client in `src/lib/mumble/`. Keep tests beside
their implementation as `*.test.ts`; script tests use `scripts/*.test.js`. Static files are in
`static/`, CLIs in `scripts/`, and product/design notes in `docs/`. Do not edit generated
`.wrangler/`, `dist/`, or `src/worker-configuration.d.ts` files manually.

## Build, Test, and Development Commands

- `npm ci`: install the locked dependency set (CI uses Node 24).
- `npm run dev`: start the Vite development server.
- `npm run preview`: build and preview the production Worker and Vite assets locally.
- `npm test`: run all TypeScript and JavaScript tests.
- `npm run lint`: run ESLint and check Prettier formatting.
- `npm run check`: run strict TypeScript checks for the React client and Worker.
- `npm run verify`: run Cloudflare type checks, linting, TypeScript checks, tests, and the production build. Use this before opening a PR.

Use `npm run seed` only to initialize local metadata. After changing Worker bindings, run `npm run cf-typegen` and commit the regenerated declaration.

## Coding Style & Naming Conventions

TypeScript is strict. Prettier enforces tabs, single quotes, no trailing commas, and a 100-column
limit. Use PascalCase for React components and exported types, camelCase for functions and fields,
SCREAMING_SNAKE_CASE for constants, and kebab-case for multiword utility modules. Keep
Cloudflare-only APIs out of browser components, prefer `$lib` imports for shared code, use CSS
Modules for component-scoped styles, and use React external stores for non-React state machines.

## Testing Guidelines

Tests use Node's `node:test` and `node:assert/strict`. Write behavior-focused names and cover success, failure, and validation paths. Run one file with `node --experimental-transform-types --test src/lib/auth.test.ts`. No coverage threshold is configured; add focused regression tests for changed behavior.

## Commit & Pull Request Guidelines

Follow the prevailing `type: short imperative summary` style, such as `fix: avoid duplicate voice replay on reconnect`; common types include `feat`, `fix`, `test`, `docs`, and `chore`. Keep commits focused. PRs should explain user-visible, API, storage, or configuration effects; link relevant issues or design notes; list validation performed; and include screenshots for UI changes. CI must pass `npm run verify`.

## Security & Configuration

Never commit credentials or local `.env`/`.dev.vars` files. Store deployed secrets with `npx wrangler secret put <NAME>`. Treat `seed:remote` and metadata migrations as controlled operations and follow the safeguards in `README.md` before running them.
