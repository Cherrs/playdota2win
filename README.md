# playdota2win

SvelteKit application deployed on Cloudflare Workers, with KV metadata, R2 downloads,
Turnstile-protected forms, and a WebRTC/Mumble proxy.

## Local development

```sh
npm ci
npm run dev
```

Run all repository checks before deploying:

```bash
npm run verify
```

Initialize local development metadata with:

```bash
npm run seed
```

The local seed writes both the KV migration mirror and the canonical R2 metadata objects. It
uses the real `categories_list` key and keeps the compatibility-only list counter at zero.

Live download statistics use the existing `APP_KV` binding and one key per download item:
`download_count:<item-id>`. The public total is calculated from the enabled items' independent
counters. If a counter key does not exist yet, the item's legacy `downloadCount` is used once as
its migration baseline; the first successful download writes the independent key. KV counters are
eventually consistent, so totals can briefly differ between regions and concurrent updates to the
same item can occasionally be coalesced.

### One-time KV to R2 metadata migration

Production metadata migration is explicit. First enter a single-operator maintenance window and
stop metadata writes for at least 60 seconds so legacy KV replicas can converge, then preview the
snapshots (`downloads_list`, `categories_list`, and `announcements`):

```bash
npm run migrate:metadata -- --remote
```

Verify every item count and SHA-256 printed by the command. Then rerun the printed command with
`--apply`, the exact `--confirm-source-sha256` value, and
`--confirm-single-operator-window`. The migration creates only missing R2 objects and aborts if
an object already exists or appears during the preflight. Wrangler 4.110 does not expose an R2
conditional-put flag, so keep the maintenance window in place until all post-write hash checks
finish.

If a legacy installation never created the optional `categories_list` or `announcements` KV key,
review that no data exists and explicitly add
`--initialize-missing-empty categories,announcements` (or only the missing target) to both the
preview and apply commands. `downloads_list` is never allowed to initialize empty.

`npm run seed:remote` is intentionally blocked by default. It is only a destructive reset for a
disposable remote test environment; it requires the exact `RESET_REMOTE_TEST_DATA` confirmation
and the current SHA-256 (or `missing`) for all three canonical objects. Never use it as a production
migration.

## Required secrets

Configure the Worker secrets with `npx wrangler secret put <NAME>`:

- `ADMIN_PASSWORD`
- `ADMIN_SIGNING_SECRET`
- `ADMIN_JWT_SECRET`
- `DOWNLOAD_PASSWORD`
- `TURNSTILE_SECRET_KEY`
- `MUMBLE_PROXY_TURN_USERNAME`
- `MUMBLE_PROXY_TURN_CREDENTIAL`

`TURNSTILE_SITE_KEY` is public and can be configured as a normal Worker variable (an existing
secret-text binding also works). `wrangler.jsonc` sets `keep_vars: true` so deploys do not remove
dashboard-managed variables; verify that the binding exists before deploying or authentication
will fail closed after three errors.

RustDesk clients can call the public `GET /api/rustdesk` endpoint without authorization. The
endpoint returns `404` until an enabled download item is configured as its RustDesk data source.

## Production deployment gate

Do not deploy this version until all of the following are complete, in this order:

1. Enter the metadata maintenance window, run the remote migration preview and apply command, and
   verify the post-write SHA-256 for all three canonical R2 objects.
2. Confirm the `UPLOADS_BUCKET` R2 binding, every required secret, and the dashboard-managed
   `TURNSTILE_SITE_KEY`. The Turnstile widget hostname allowlist must include `playdota2.win` (and
   each explicitly supported preview hostname).
3. Apply and list the prefix-scoped R2 lifecycle rules documented below.
4. Deploy, then smoke-test `/`, `/download`, and `/admin`. On both password flows, confirm that the
   page preloads one Turnstile script, the first two wrong passwords do not show a widget, the third
   wrong password shows it immediately, and a valid password clears the gate.
5. Only after the smoke test succeeds, restore admin metadata writes and end the maintenance window.

The runtime intentionally fails closed when a canonical metadata object or the R2 failure-counter
binding is missing; it never silently falls back to stale KV state in production.

## Download upload and backup limits

Admin R2 files use a two-stage flow: the browser sends the raw file body to
`PUT /api/admin/uploads`, then sends only JSON metadata to `POST /api/admin`. The raw upload is
limited to 90 MiB so it remains below the 100 MB request-body ceiling on Cloudflare Free and Pro
zones. The upload endpoint requires the authenticated admin cookie and a valid `Content-Length`;
it also counts streamed bytes and removes the object if the stream or declared size is invalid.

Custom S3 files do not pass through the Worker. The browser sends the file directly to the
configured presigned `PUT` URL, so the S3 bucket must allow the application's origin, the `PUT`
method, and the `Content-Type` header in its CORS policy. Only the public download URL is sent to
the metadata API; presigned URLs are never persisted by this application. Both URLs must be
absolute public HTTPS addresses without URL user-info credentials.

External-link R2 mirrors are limited to 200 MiB. A declared oversized `Content-Length` is rejected
before upload. Sources without a declared length use a counted 10 MiB multipart stream, which is
aborted and cleaned up as soon as it crosses the limit. Configure an R2 lifecycle rule to remove
incomplete multipart uploads as a final safeguard against runtime termination during a sync.

### Required R2 lifecycle rules

Turnstile failure counters are stored as one strongly consistent R2 object per hashed client
identifier. Their 15-minute TTL controls authentication behavior, but does not physically delete
expired objects. Before deployment, inspect the current rules and add a one-day expiry scoped only
to the counter prefix. Also shorten cleanup of interrupted mirror multipart uploads to one day:

```bash
npx wrangler r2 bucket lifecycle list downloads
npx wrangler r2 bucket lifecycle add downloads turnstile-failure-counters \
  .security/failure-counters/ --expire-days 1
npx wrangler r2 bucket lifecycle add downloads abort-mirror-multipart \
  mirrors/ --abort-multipart-days 1
```

Do not apply an unscoped object-expiry rule to this bucket: it also contains canonical metadata and
download files.

## TURN deployment

`mumble.yaml` uses coturn's long-term credential mechanism. The browser (through the Worker),
coturn, and the mumdota WebRTC proxy must all use the same username and credential. Keep both
values outside the repository; the manifest accepts only non-empty ASCII letters, digits, `.`,
`_`, `~`, and `-`:

```bash
umask 077
printf '%s' 'playdota2win' > /secure/path/turn-username
openssl rand -hex 32 | tr -d '\n' > /secure/path/turn-credential
kubectl create namespace mumdota --dry-run=client -o yaml | kubectl apply -f -
kubectl -n mumdota create secret generic mumdota-secrets \
  --from-file=turn-username=/secure/path/turn-username \
  --from-file=turn-credential=/secure/path/turn-credential \
  --dry-run=client -o yaml | kubectl apply -f -
npx wrangler secret put MUMBLE_PROXY_TURN_USERNAME < /secure/path/turn-username
npx wrangler secret put MUMBLE_PROXY_TURN_CREDENTIAL < /secure/path/turn-credential
kubectl apply -f mumble.yaml
kubectl -n mumdota rollout restart deployment/coturn deployment/mumdota
kubectl -n mumdota rollout status deployment/coturn
kubectl -n mumdota rollout status deployment/mumdota
```

Also create `coturn-tls-secret` with a certificate valid for `turn.playdota2.win`. Rotate
any credential that was previously committed before applying the new manifest.

Apply the Kubernetes Secret and manifest before deploying the Worker. The
`MUMBLE_PROXY_TURN_SHARED_SECRET` and `MUMBLE_PROXY_TURN_TTL_SECONDS` settings are no longer used.
The current manifest keeps `accept_invalid_certs = true` for compatibility with the deployed
Mumble endpoint. Replace its certificate and switch this setting to `false` when possible.
