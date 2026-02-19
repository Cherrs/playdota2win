# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A SvelteKit download management application deployed on Cloudflare Workers with R2 storage. Users can browse and download files through a cute anime-styled interface, while admins manage downloads through a protected admin panel.

**Tech Stack:**

- SvelteKit 2.x with Svelte 5 (runes syntax)
- Cloudflare Workers + KV + R2
- TypeScript 5.x
- Vite 7.x
- Wrangler 4.x for deployment

## Development Commands

```bash
# Development
npm run dev                # Start Vite dev server
npm run preview            # Build + preview with wrangler dev

# Code Quality
npm run check              # TypeScript + Svelte type checking
npm run check:watch        # Type check in watch mode
npm run lint               # ESLint + Prettier check
npm run format             # Format code with Prettier

# Deployment
npm run build              # Build for production
npm run deploy             # Build + deploy to Cloudflare Workers
npm run cf-typegen         # Generate Cloudflare Worker type definitions
```

## Architecture

### Request Flow

1. **Public downloads**: `/` → `+page.svelte` → `/api/downloads` (public API) → KV read
2. **Download links**: Password-protected via `/api/downloads/link` → R2 signed URLs or relay
3. **Admin panel**: `/admin` → JWT authentication → `/api/admin/*` → KV/R2 writes

### Data Storage

- **KV Namespace** (`APP_KV`): Stores download metadata and categories
  - Key `downloads_list`: `DownloadList` (items, downloadCount, lastUpdated)
  - Key `categories`: `CategoryList` (items, lastUpdated)
  - Key `admin_auth_token:*`: Admin JWT tokens
  - Key `download_auth_token:*`: Download access tokens (7-day TTL)

- **R2 Bucket** (`UPLOADS_BUCKET`): Binary file storage
  - Path pattern: `{platform}/{version}/{filename}`
  - Access via signed URLs (5-minute TTL)

### Authentication

**Admin Auth** (src/lib/admin-auth.ts):

- JWT-based with HS256 signing
- 1-hour token expiry
- Bearer token in `Authorization` header
- Protected endpoints: `/api/admin/*`

**Download Auth** (src/lib/auth.ts):

- Password-based access control
- Tokens stored in KV with 7-day expiry
- Protects file downloads from R2

**Signed URLs** (src/lib/admin-auth.ts):

- HMAC-SHA256 signatures for R2 downloads
- 5-minute expiry by default
- Query params: `?expires=<timestamp>&sig=<hex>`

### Environment Variables (App.Platform.env)

Required secrets in Cloudflare Workers:

- `ADMIN_PASSWORD`: Admin panel password
- `ADMIN_JWT_SECRET`: JWT signing secret
- `ADMIN_SIGNING_SECRET`: URL signing secret (fallback to ADMIN_PASSWORD)
- `DOWNLOAD_PASSWORD`: Public download password
- `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile verification
- `TURNSTILE_SITE_KEY`: Turnstile client key

Bindings:

- `ASSETS`: Static assets binding
- `APP_KV`: KV namespace
- `UPLOADS_BUCKET`: R2 bucket

## Key Patterns

### Svelte 5 Runes

- Use `$state()` for reactive state (not `let` with `$:`)
- Use `$props()` to receive component props
- Use `{@render children()}` instead of `<slot />`
- Event handlers: `onclick={handler}` not `on:click={handler}`

### API Endpoints

All API routes are in `src/routes/api/**/*+server.ts`:

- Export `RequestHandler` functions: `GET`, `POST`, `PUT`, `DELETE`
- Return `json()` responses with `ApiResponse<T>` type
- Access Cloudflare bindings via `platform.env.*`
- Check auth with `requireAdminAuth()` for protected routes

### Type Safety

Primary types in `src/lib/types.ts`:

- `DownloadItem`: Single download with metadata
- `DownloadList`: Collection with items + downloadCount
- `Category`: Download category with icon/color
- `StorageType`: 'link' | 'r2' | 's3'
- `Platform`: 'windows' | 'macos' | 'linux'

### File Uploads

Three storage modes:

1. **Link** (`storageType: 'link'`): External URL reference
2. **R2** (`storageType: 'r2'`): Upload to Cloudflare R2
3. **S3** (`storageType: 's3'`): Upload to custom S3 via presigned URL

Admin upload flow (src/routes/api/admin/+server.ts):

- Parse `multipart/form-data`
- Upload file to R2/S3 if needed
- Store metadata in KV
- Return `DownloadItem` with generated ID

## UI/UX Design Guidelines

### Styling Conventions

**Anime-cute aesthetic**:

- Gradients: Pink-purple-blue (`#FFF5F7` → `#F0E6FF` → `#E6F0FF`)
- Primary colors: Purple `#6B4C9A`, Pink `#FF6B9D`
- Fonts: Fredoka (titles), Nunito (body), with Chinese fallbacks
- Border radius: 20px for cards/buttons
- Animations: Float, drift, bounce (0.3s transitions)

**CSS constraints**:

- Avoid `inset` shorthand (not supported everywhere) → use `top/right/bottom/left`
- Use scoped `<style>` in components
- Global styles require `:global()` selector
- Backdrop filters for glassmorphism: `backdrop-filter: blur(10px)`

### Responsive Design

Mobile breakpoint `< 600px`:

- Title font size: 3rem → 2rem
- Feature cards: Grid → single column
- Icons align horizontally with text

## Common Workflows

### Adding a Download Item

1. Admin logs in at `/admin`
2. Fills form in `DownloadForm.svelte`
3. Uploads file or provides URL
4. `POST /api/admin` creates item in KV
5. If R2 upload: file stored at `{platform}/{version}/{filename}`

### Updating Metadata

Edit modal (`DownloadEditModal.svelte`) sends `PUT /api/admin`:

- Only modifies specified fields
- Empty strings for optional fields become `undefined`
- `updatedAt` timestamp refreshed

### Download Flow

1. User enters password → `POST /api/downloads/auth`
2. Token stored in KV (7-day TTL) + localStorage
3. Click download → `POST /api/downloads/link` with token
4. Returns signed URL (R2) or relay path
5. `GET /api/downloads/relay/[...path]` proxies R2 download
6. Download count incremented in KV

### Category Management

Categories control grouping/filtering:

- CRUD via `/api/admin/categories`
- Each has `id`, `name`, `icon` (emoji), `color`, `order`
- Downloads reference `categoryId`
- Tab navigation in `CategoryTabs.svelte`

## File Structure Notes

```
src/
├── routes/
│   ├── +page.svelte              # Home (renders download page)
│   ├── +layout.svelte            # Root layout (Svelte 5 syntax)
│   ├── download/+page.svelte     # Main download UI
│   ├── admin/+page.svelte        # Admin panel
│   └── api/
│       ├── downloads/
│       │   ├── +server.ts        # Public download list
│       │   ├── auth/+server.ts   # Download password auth
│       │   ├── link/+server.ts   # Generate download links
│       │   └── relay/[...path]/+server.ts  # Proxy R2 downloads
│       ├── admin/
│       │   ├── +server.ts        # CRUD downloads
│       │   ├── auth/+server.ts   # Admin JWT login
│       │   ├── categories/+server.ts  # CRUD categories
│       │   └── download/[...path]/+server.ts  # Serve R2 files
│       └── categories/+server.ts # Public categories
├── lib/
│   ├── types.ts                  # Core TypeScript types
│   ├── auth.ts                   # Download password auth
│   ├── admin-auth.ts             # Admin JWT + URL signing
│   ├── jwt.ts                    # JWT sign/verify (HS256)
│   ├── turnstile.ts              # Cloudflare Turnstile integration
│   ├── utils/
│   │   ├── markdown.ts           # Markdown parsing
│   │   ├── turnstile-client.ts   # Client-side Turnstile
│   │   └── parseFilename.ts      # Extract version/platform from URLs
│   └── components/
│       ├── AdminLogin.svelte     # Admin login form
│       ├── AdminHeader.svelte    # Admin navigation
│       ├── CategoryManager.svelte # Category CRUD UI
│       ├── CategoryTabs.svelte   # Category filter tabs
│       ├── DownloadForm.svelte   # Add download form
│       ├── DownloadList.svelte   # Admin downloads table
│       ├── DownloadCard.svelte   # Public download card
│       ├── DownloadEditModal.svelte # Edit download modal
│       ├── GuideModal.svelte     # Config guide display
│       ├── GuidePanel.svelte     # Guide preview panel
│       ├── PasswordModal.svelte  # Download password prompt
│       ├── MascotAnimation.svelte # Cute character animation
│       ├── BackgroundDecorations.svelte # Floating stars/clouds
│       ├── ColorPicker.svelte    # Color input component
│       ├── EmojiPicker.svelte    # Emoji selector
│       └── DraggableList.svelte  # Sortable list component
└── app.d.ts                      # Platform types
```

## Deployment Configuration

**wrangler.jsonc**:

- Main entry: `.svelte-kit/cloudflare/_worker.js`
- Assets directory: `.svelte-kit/cloudflare`
- Compatibility date: `2025-09-27`
- Flags: `nodejs_als`, `nodejs_compat`
- Custom domain: `playdota2.win`

**svelte.config.js**:

- Adapter: `@sveltejs/adapter-cloudflare`
- Preprocessor: `vitePreprocess()`

**Key Build Outputs**:

- SvelteKit builds Worker code → `.svelte-kit/cloudflare/_worker.js`
- Wrangler deploys Worker + assets binding
- Static files served via `ASSETS` binding
