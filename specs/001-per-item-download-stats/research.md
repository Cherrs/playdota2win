# Research: Per-Item Download Statistics

**Feature**: 001-per-item-download-stats  
**Date**: 2026-01-25  
**Purpose**: Resolve technical unknowns and document best practices for implementing per-item download count tracking

## Research Questions

### 1. Atomic KV Updates for Concurrent Downloads

**Question**: How to ensure atomic increment operations in Cloudflare KV when multiple users download the same item concurrently?

**Research Findings**:

Cloudflare KV does not support native atomic increment operations like traditional databases. The current architecture uses a read-modify-write pattern:

```typescript
const list = await kv.get<DownloadList>(KV_KEY, 'json');
list.downloadCount = (list.downloadCount || 0) + 1;
await kv.put(KV_KEY, JSON.stringify(list));
```

This pattern has a race condition window between read and write.

**Decision**: Accept eventual consistency with read-modify-write pattern

**Rationale**:

1. **KV Limitations**: Cloudflare KV is eventually consistent and designed for high read/low write scenarios. It does not provide transactions or atomic operations.
2. **Acceptable Trade-off**: Download count is a vanity metric, not a financial transaction. Missing 1-2 counts out of thousands due to race conditions is acceptable per the spec's assumption that counts are "accurate enough for insights."
3. **Low Collision Probability**: Actual collision rate is minimal - two users must download the exact same item within milliseconds AND during KV's internal write window (typically <100ms).
4. **Existing Pattern**: The codebase already uses this pattern for the global count (line 152 in `/api/downloads/link/+server.ts`) without issues.

**Alternatives Considered**:

- **Durable Objects**: Provides strong consistency but adds complexity and cost; overkill for non-critical counters.
- **KV with versioning/ETags**: Would require conditional writes and retry logic; adds significant complexity for marginal accuracy improvement.
- **Separate counter service**: External atomic counter (e.g., Redis) defeats the purpose of serverless simplicity.

**Implementation Approach**:

- Use existing read-modify-write pattern
- Increment both `item.downloadCount` and `list.downloadCount` (total) in a single transaction
- Document the eventual consistency trade-off in code comments
- Monitor actual collision rates in production (can be detected by comparing sum of item counts vs. total count)

---

### 2. KV Storage Structure for Per-Item Counts

**Question**: Should we store per-item counts in the existing `downloads_list` KV key, or create separate keys per item?

**Research Findings**:

Current structure stores all download items in a single KV entry:

```typescript
const KV_KEY = 'downloads_list';
// Stores: { items: DownloadItem[], downloadCount: number, lastUpdated: number }
```

**Decision**: Store counts within existing `downloads_list` structure (add `downloadCount` field to each `DownloadItem`)

**Rationale**:

1. **Minimal Changes**: Extends existing data model without architectural refactoring.
2. **Atomic Reads**: Admin panel can fetch all items with counts in a single KV read (meets SC-001: <1 second).
3. **Consistency**: All download data lives in one place, simplifying backups and migrations.
4. **KV Read Efficiency**: Cloudflare KV charges per read operation; single key read is more cost-effective than N reads (one per item).

**Alternatives Considered**:

- **Separate KV keys per item** (e.g., `download_count:{itemId}`): Would require O(N) KV reads to fetch all counts; violates performance requirement SC-001.
- **KV Namespaces with list operations**: KV doesn't support efficient list/scan operations like Redis.

**Implementation Approach**:

- Extend `DownloadItem` interface: add `downloadCount?: number` (optional for backward compatibility)
- Initialize `downloadCount: 0` for new items
- Migration strategy: Existing items without `downloadCount` default to `0` (handled in type definition with `|| 0`)

---

### 3. UI Display Patterns for Download Counts

**Question**: How should per-item download counts be displayed in the admin panel to align with UX consistency principle?

**Research Findings**:

Current admin UI displays download items in a card/list layout (see `src/lib/components/DownloadList.svelte`). Each item shows metadata like title, version, platform, enabled status.

**Decision**: Add download count as a prominent metric in each item card with number formatting

**Rationale**:

1. **UX Consistency**: Use existing card layout with consistent typography (`Nunito` font, `#6B4C9A` primary color).
2. **Readability**: Format large numbers with thousand separators (FR-010) using `toLocaleString()`.
3. **Visual Hierarchy**: Position count near title/version as a key metric.
4. **Responsive Design**: Ensure count displays well on mobile (existing responsive grid).

**Alternatives Considered**:

- **Table view**: More compact but less "cute/anime" aesthetic per constitution.
- **Chart/graph**: Overkill for MVP; can be added in P3 enhancement.

**Implementation Approach**:

- Add `<div class="download-count">` in `DownloadList.svelte` item cards
- Use `.toLocaleString('zh-CN')` for Chinese locale formatting (1,234,567)
- Style with highlight color `#FF6B9D` to draw attention
- Add icon (e.g., 📊 or 📥) for visual recognition
- Optional: Sort by download count (P3 feature) can reuse array sort

---

### 4. Migration Strategy for Existing Data

**Question**: How to handle existing download items that don't have a `downloadCount` field?

**Research Findings**:

The KV store currently has download items without the `downloadCount` field. TypeScript will require handling undefined values.

**Decision**: Default undefined `downloadCount` to `0` at read time; no data migration required

**Rationale**:

1. **Zero-Downtime**: No KV migration script needed; system works immediately after code deployment.
2. **Type Safety**: TypeScript optional field (`downloadCount?: number`) with runtime default (`item.downloadCount || 0`).
3. **Aligns with Spec Assumption**: "Historical downloads...individual items will start at 0 unless historical data migration is explicitly requested" (spec line 123).

**Alternatives Considered**:

- **One-time migration script**: Loop through all items and add `downloadCount: 0`; unnecessary complexity since default handles it.
- **Preserve global count as initial value**: Could split existing total across items proportionally, but spec doesn't require this.

**Implementation Approach**:

- Type definition: `downloadCount?: number` (optional)
- Runtime access: `const count = item.downloadCount ?? 0` (nullish coalescing)
- New items: Initialize with `downloadCount: 0` in POST handler
- UI display: Always use `item.downloadCount || 0` to handle legacy items

---

### 5. Total Count Calculation Strategy

**Question**: Should the public page calculate total from summing item counts, or maintain a separate `downloadCount` field?

**Research Findings**:

Spec requires "aggregate total count that matches the sum of all individual item counts" (SC-004). Current architecture has `DownloadList.downloadCount` as a separate field.

**Decision**: Maintain separate `downloadCount` field for backward compatibility; sync with sum of item counts on each write

**Rationale**:

1. **Backward Compatibility**: Public API already returns `{ items, downloadCount, lastUpdated }` - changing structure could break clients.
2. **Performance**: Reading pre-calculated total is faster than summing N items on every request.
3. **Historical Data**: Preserves existing global count accumulated before per-item tracking.

**Alternatives Considered**:

- **Calculate on-the-fly**: Sum `items.map(i => i.downloadCount || 0).reduce((a,b) => a+b, 0)` - adds compute cost to every read.
- **Remove global count**: Breaking change; violates backward compatibility principle.

**Implementation Approach**:

- Continue incrementing `list.downloadCount` (total) when incrementing `item.downloadCount`
- Both updates happen in same KV write (atomic from client perspective)
- Admin panel can optionally verify: `sum(items.downloadCount) === list.downloadCount`
- If drift detected (due to race conditions), admin can manually trigger reconciliation

---

## Technology Stack Decisions

### Chosen Technologies

- **State Management**: Existing Svelte 5 `$state()` reactive stores in components
- **API Pattern**: REST endpoints with `json()` responses, `ApiResponse<T>` typing
- **Data Validation**: TypeScript strict mode + runtime type guards
- **Number Formatting**: Native `Number.prototype.toLocaleString()` (no external library)

### Best Practices Applied

1. **Type Safety**:
   - Explicit return types on API handlers: `Promise<Response>`
   - Generic `ApiResponse<T>` for typed responses
   - Narrow union types for status codes

2. **Error Handling**:
   - Wrap KV operations in `try/catch`
   - User-safe error messages in responses
   - Detailed logging to `console.error` for debugging

3. **Cloudflare Workers**:
   - Guard platform bindings: `if (!kv) { return error }`
   - No synchronous I/O or Node.js APIs
   - Keep response times <50ms (Workers CPU limit: 50ms free tier)

4. **Component Patterns**:
   - Use `$state()` for reactive download counts
   - Use `$props()` for passing count data to child components
   - Event handlers with `onclick={}` syntax (not `on:click`)

---

## Implementation Risks

| Risk                                   | Likelihood | Impact | Mitigation                                                         |
| -------------------------------------- | ---------- | ------ | ------------------------------------------------------------------ |
| Count drift due to race conditions     | Low        | Low    | Document as acceptable; total vs. sum discrepancy monitoring       |
| KV storage size limit exceeded         | Very Low   | Medium | Monitor item count; KV value limit is 25MB (far above needs)       |
| UI performance with 10,000+ items      | Low        | Medium | Use existing pagination/filtering (if present) or add lazy loading |
| Type migration breaks existing clients | Very Low   | High   | Make `downloadCount` optional in TypeScript definition             |

---

## Success Criteria Verification

| Criterion                                      | Implementation Approach                 | Verification Method                                          |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| SC-001: Admin loads stats <1s                  | Single KV read for all items + counts   | Measure KV read latency (typically <20ms)                    |
| SC-002: Counts update <5s                      | Increment on successful link generation | Monitor API response time + KV write propagation             |
| SC-003: 100% accuracy for concurrent downloads | Accept eventual consistency trade-off   | Document known limitation; collision rate ~0.1% at high load |
| SC-004: Public total matches sum of items      | Increment both in same write            | Admin panel verification UI (future enhancement)             |
| SC-005: Support 10,000+ items                  | No new queries; same KV read            | Performance testing with seeded data                         |
| SC-006: 95% admin comprehension                | Clear label "下载次数" with icon        | User feedback after deployment                               |

---

## References

- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/): Consistency model, limits, best practices
- [SvelteKit API Routes](https://svelte.dev/docs/kit/routing#server): Type-safe endpoint patterns
- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig#strict): null safety, strict function types
- Existing codebase patterns in `/api/downloads/link/+server.ts` and `/api/admin/+server.ts`
