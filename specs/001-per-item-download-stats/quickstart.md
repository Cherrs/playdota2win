# Quickstart: Per-Item Download Statistics

**Feature**: 001-per-item-download-stats  
**For**: Developers implementing this feature  
**Prerequisites**: Node.js 18+, Wrangler CLI installed, KV and R2 bindings configured

---

## Overview

This feature adds per-item download count tracking to the existing download management system. The core change is adding a `downloadCount` field to each `DownloadItem` and modifying the download link endpoint to increment counts atomically.

**Estimated Implementation Time**: 2-3 hours

---

## Quick Setup

### 1. Clone and Install

```bash
git checkout 001-per-item-download-stats
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:5173` to see the app.

### 3. Preview with Workers Runtime

```bash
npm run preview
```

This builds the app and runs it with Wrangler's local Workers environment (access KV/R2 bindings).

---

## Implementation Checklist

### Phase 1: Type Definitions (5 minutes)

- [ ] Open `src/lib/types.ts`
- [ ] Add `downloadCount?: number` to `DownloadItem` interface (line ~69, after `enabled`)
- [ ] Run `npm run check` to verify TypeScript compilation

**Code Change**:

```typescript
export interface DownloadItem {
	// ... existing fields ...
	enabled: boolean;
	downloadCount?: number; // NEW: Per-item download count
}
```

---

### Phase 2: API Endpoint Updates (30 minutes)

#### 2a. Update Download Link Generation

**File**: `src/routes/api/downloads/link/+server.ts`

**Location**: Inside `POST` handler, after finding the item (line ~126)

**Current Code** (line 152):

```typescript
list.downloadCount = (list.downloadCount || 0) + 1;
await kv.put(KV_KEY, JSON.stringify(list));
```

**New Code**:

```typescript
// Increment both item count and total count
item.downloadCount = (item.downloadCount || 0) + 1;
list.downloadCount = (list.downloadCount || 0) + 1;
await kv.put(KV_KEY, JSON.stringify(list));
```

**Why**: This atomically increments both the specific item's count and the global total in a single KV write.

---

#### 2b. Initialize Count for New Items

**File**: `src/routes/api/admin/+server.ts`

**Location**: Inside `POST` handler, when creating new item (line ~188)

**Current Code**:

```typescript
const item: DownloadItem = {
	id: crypto.randomUUID(),
	// ... other fields ...
	enabled: true
};
```

**New Code**:

```typescript
const item: DownloadItem = {
	id: crypto.randomUUID(),
	// ... other fields ...
	enabled: true,
	downloadCount: 0 // NEW: Initialize count
};
```

**Why**: New items start with 0 downloads explicitly (rather than relying on undefined default).

---

### Phase 3: Admin UI Updates (45 minutes)

#### 3a. Display Count in Download List Component

**File**: `src/lib/components/DownloadList.svelte`

**Location**: Inside the item card/row rendering (find existing metadata display)

**Add Display Element**:

```svelte
<div class="download-count">
	<span class="count-icon">📊</span>
	<span class="count-value">{(item.downloadCount || 0).toLocaleString('zh-CN')}</span>
	<span class="count-label">下载</span>
</div>
```

**Styling** (add to `<style>` block):

```css
.download-count {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.9rem;
	color: #6b4c9a;
	margin-top: 0.5rem;
}

.count-icon {
	font-size: 1rem;
}

.count-value {
	font-weight: 700;
	color: #ff6b9d;
}

.count-label {
	color: #8b7ba8;
	font-weight: 500;
}
```

**Why**: Displays per-item counts with thousand separators (e.g., "1,234") in the cute/anime style.

---

#### 3b. Update Admin Header (Optional)

**File**: `src/lib/components/AdminHeader.svelte`

**Current**: Shows total download count only

**Enhancement** (optional for MVP): Show "X items, Y total downloads" instead of just "Y downloads"

**Example**:

```svelte
<div class="stats">
	<span>共 {itemCount} 个下载项</span>
	<span>总计 {downloadCount.toLocaleString('zh-CN')} 次下载</span>
</div>
```

---

### Phase 4: Testing (30 minutes)

#### 4a. Type Checking

```bash
npm run check
```

**Expected**: No TypeScript errors. Verify `downloadCount` is recognized on `DownloadItem`.

#### 4b. Linting & Formatting

```bash
npm run lint
npm run format
```

#### 4c. Manual Testing

1. **Create a new download item** via admin panel:
   - Verify `downloadCount` initializes to `0` in KV storage
   - Check browser DevTools > Network > Fetch/XHR > POST /api/admin response

2. **Download an item** from public page:
   - Enter password, click download
   - Refresh admin panel
   - Verify item's `downloadCount` increased by 1
   - Verify total count also increased by 1

3. **Legacy item handling**:
   - Use Wrangler CLI to inspect KV: `wrangler kv:key get --binding=APP_KV "downloads_list"`
   - Manually remove `downloadCount` from one item
   - Refresh admin panel
   - Verify item displays "0 下载" (defaults to 0)

4. **Large number formatting**:
   - Use Wrangler CLI to set a large count: `item.downloadCount = 123456`
   - Verify admin displays "123,456"

---

### Phase 5: Deployment (15 minutes)

#### 5a. Pre-Deployment Checks

```bash
npm run build      # Must succeed
npm run preview    # Test in Workers environment
```

#### 5b. Deploy to Production

```bash
npm run deploy
```

**Post-Deploy Verification**:

1. Visit admin panel in production
2. Check that existing items show counts (may be 0 for old items)
3. Test download flow end-to-end
4. Monitor KV read/write metrics in Cloudflare dashboard

---

## Troubleshooting

### Issue: TypeScript errors on `downloadCount`

**Symptom**: `Property 'downloadCount' does not exist on type 'DownloadItem'`

**Fix**: Ensure you added `downloadCount?: number` to the interface in `src/lib/types.ts` and ran `npm run check`.

---

### Issue: Counts not updating after download

**Symptom**: Public page shows download succeeded, but admin count unchanged

**Possible Causes**:

1. **KV write failed**: Check Wrangler logs for errors
2. **Wrong item ID**: Verify `itemId` in POST body matches existing item
3. **Caching**: Refresh admin page with hard reload (Ctrl+Shift+R)

**Debug**:

```typescript
// Add logging in /api/downloads/link POST handler
console.log('Before increment:', item.downloadCount, list.downloadCount);
item.downloadCount = (item.downloadCount || 0) + 1;
list.downloadCount = (list.downloadCount || 0) + 1;
console.log('After increment:', item.downloadCount, list.downloadCount);
```

---

### Issue: Count displays as "NaN" or undefined

**Symptom**: UI shows "NaN 下载" or blank count

**Fix**: Ensure you're using nullish coalescing or logical OR:

```svelte
<!-- WRONG -->
{item.downloadCount.toLocaleString()}

<!-- RIGHT -->
{(item.downloadCount || 0).toLocaleString()}
```

---

### Issue: Race condition causing lost counts

**Symptom**: Multiple rapid downloads result in count < expected

**Expected Behavior**: This is a known limitation (see `research.md`). Cloudflare KV is eventually consistent; rare race conditions may lose ~0.1% of counts.

**Mitigation**: Acceptable per spec; can be monitored by comparing `sum(item.downloadCount)` vs. `list.downloadCount`.

---

## Development Commands Reference

| Command               | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Start Vite dev server (fast refresh, no KV/R2) |
| `npm run build`       | Build for production (check for errors)        |
| `npm run preview`     | Build + run with Wrangler (test KV/R2 locally) |
| `npm run check`       | TypeScript type checking                       |
| `npm run check:watch` | Type checking in watch mode                    |
| `npm run lint`        | ESLint + Prettier validation                   |
| `npm run format`      | Auto-format code with Prettier                 |
| `npm run deploy`      | Build + deploy to Cloudflare Workers           |
| `npm run cf-typegen`  | Generate TypeScript types for Worker bindings  |

---

## File Modification Summary

| File                                       | Change Type              | Lines Changed |
| ------------------------------------------ | ------------------------ | ------------- |
| `src/lib/types.ts`                         | Add field                | +1 line       |
| `src/routes/api/downloads/link/+server.ts` | Increment logic          | ~3 lines      |
| `src/routes/api/admin/+server.ts`          | Initialize field         | +1 line       |
| `src/lib/components/DownloadList.svelte`   | Display count            | ~10 lines     |
| `src/lib/components/AdminHeader.svelte`    | (Optional) Stats display | ~2 lines      |

**Total**: ~17 lines of code changes (excluding styles/comments)

---

## Next Steps

After completing this feature:

1. **Monitor production metrics**: Check Cloudflare Analytics for KV read/write patterns
2. **Gather user feedback**: Ask admins if download count display is useful
3. **Optional enhancements**:
   - Add sort by download count (P3 feature from spec)
   - Add historical download graphs
   - Add export functionality for download statistics

---

## References

- [Feature Spec](./spec.md) - Full requirements and user stories
- [Research Notes](./research.md) - Technical decisions and trade-offs
- [Data Model](./data-model.md) - Type definitions and validation rules
- [API Contract](./contracts/api-updates.yaml) - OpenAPI specification
- [Constitution](./.specify/memory/constitution.md) - Project coding standards

---

## Support

**Questions?** Check the spec documents above or review existing code patterns in:

- `src/routes/api/admin/+server.ts` (KV read/write patterns)
- `src/lib/components/DownloadList.svelte` (Svelte 5 component structure)
- `AGENTS.md` (Project conventions and best practices)
