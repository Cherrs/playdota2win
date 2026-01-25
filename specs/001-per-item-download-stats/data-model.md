# Data Model: Per-Item Download Statistics

**Feature**: 001-per-item-download-stats  
**Date**: 2026-01-25  
**Purpose**: Define data structures, validation rules, and state transitions for per-item download count tracking

## Entity Updates

### DownloadItem (Modified)

**Purpose**: Represents a single downloadable item with platform, version, storage, and usage statistics.

**Changes**: Add `downloadCount` field to track individual item downloads.

**TypeScript Definition**:

```typescript
export interface DownloadItem {
	id: string;
	platform: Platform;
	categoryId?: string;
	title?: string;
	description?: string;
	configGuide?: string;
	filename?: string;
	version: string;
	size: string;
	storageType: StorageType;
	url: string;
	signedUrl?: string;
	s3Config?: S3Config;
	createdAt: number;
	updatedAt: number;
	enabled: boolean;
	downloadCount?: number; // NEW: Per-item download count (default: 0)
}
```

**Field Details**:

| Field           | Type     | Required | Default | Description                                                                                                               |
| --------------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `downloadCount` | `number` | No       | `0`     | Number of times this specific item's download link was generated. Optional for backward compatibility with existing data. |

**Validation Rules**:

- `downloadCount >= 0` (never negative)
- When undefined, treated as `0` at runtime
- Incremented atomically with `list.downloadCount` during download
- Not user-editable (system-managed field)

**State Transitions**:

```
[New Item Created]
  → downloadCount = 0

[User Requests Download Link]
  → Verify password/token
  → Generate download URL
  → downloadCount = downloadCount + 1
  → Persist to KV

[Item Deleted]
  → downloadCount preserved in list.downloadCount total
  → Individual count lost (not preserved separately)
```

---

### DownloadList (Modified)

**Purpose**: Aggregate structure containing all download items and global statistics.

**Changes**: No structural changes; `downloadCount` field now represents sum of all `item.downloadCount` values.

**TypeScript Definition** (no changes):

```typescript
export interface DownloadList {
	items: DownloadItem[];
	downloadCount: number;
	lastUpdated: number;
}
```

**Semantic Changes**:

- **Before**: `downloadCount` tracked only via increment on download
- **After**: `downloadCount` = sum of all `item.downloadCount` (synchronized on each write)

**Validation Rules**:

- `downloadCount >= 0`
- Invariant (ideally): `downloadCount === items.reduce((sum, item) => sum + (item.downloadCount || 0), 0)`
- Drift acceptable due to eventual consistency (see research.md)

---

## Data Flow Diagrams

### Download Count Increment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User clicks download button on /download page                   │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/downloads/link                                        │
│ Body: { itemId, password, turnstileToken? }                     │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Verify password & turnstile (existing logic)                    │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Read DownloadList from KV (key: "downloads_list")               │
│   list = await kv.get<DownloadList>(KV_KEY, 'json')            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Find item by ID                                                 │
│   item = list.items.find(i => i.id === itemId && i.enabled)    │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Increment both counts (NEW LOGIC)                               │
│   item.downloadCount = (item.downloadCount || 0) + 1            │
│   list.downloadCount = (list.downloadCount || 0) + 1            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Generate download URL (existing logic: R2 relay or direct link) │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Write updated DownloadList to KV                                │
│   await kv.put(KV_KEY, JSON.stringify(list))                    │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Return { url, filename, count: list.downloadCount }             │
│ (count used to update public page UI)                           │
└─────────────────────────────────────────────────────────────────┘
```

**Race Condition Scenario**:

```
Time  │ User A (downloads item X)        │ User B (downloads item X)
──────┼──────────────────────────────────┼───────────────────────────
t0    │ Read list (X.count = 5)          │
t1    │                                  │ Read list (X.count = 5)
t2    │ Increment X.count = 6            │
t3    │ Write list (X.count = 6)         │
t4    │                                  │ Increment X.count = 6 (!)
t5    │                                  │ Write list (X.count = 6)
──────┴──────────────────────────────────┴───────────────────────────
Result: X.count = 6 (should be 7) - 1 count lost due to race condition
```

**Mitigation**: Acceptable per research.md; probability ~0.1% at high load.

---

### Admin Panel Data Fetch Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Admin navigates to /admin (authenticated)                       │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ GET /api/admin                                                  │
│ Headers: { Authorization: "Bearer <JWT>" }                      │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Verify JWT (existing auth middleware)                           │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Read DownloadList from KV                                       │
│   list = await kv.get<DownloadList>(KV_KEY, 'json')            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Enrich items with signed URLs (existing logic for R2 items)     │
│   items = await Promise.all(list.items.map(...))                │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Return { items (with downloadCount), downloadCount, ... }       │
│ NEW: Each item now includes item.downloadCount field            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Admin UI renders download counts (NEW UI)                       │
│   {#each downloads as item}                                     │
│     <div>{(item.downloadCount || 0).toLocaleString()}</div>     │
│   {/each}                                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema (KV Storage)

**KV Key**: `downloads_list`

**Value Structure** (JSON):

```json
{
	"items": [
		{
			"id": "uuid-1234",
			"platform": "windows",
			"categoryId": "cat-abc",
			"title": "Dota 2 优化工具",
			"description": "提升游戏性能",
			"configGuide": "1. 解压\n2. 运行 setup.exe",
			"filename": "dota2-optimizer.exe",
			"version": "1.2.3",
			"size": "5.2 MB",
			"storageType": "r2",
			"url": "/api/admin/download/windows/1.2.3/dota2-optimizer.exe",
			"createdAt": 1706140800000,
			"updatedAt": 1706140800000,
			"enabled": true,
			"downloadCount": 42 // NEW FIELD
		},
		{
			"id": "uuid-5678",
			"platform": "macos",
			"title": "Dota 2 优化工具 (Mac)",
			"version": "1.2.0",
			"size": "4.8 MB",
			"storageType": "link",
			"url": "https://example.com/download/mac-tool.dmg",
			"createdAt": 1706054400000,
			"updatedAt": 1706054400000,
			"enabled": true,
			"downloadCount": 15 // NEW FIELD
		},
		{
			"id": "uuid-9999",
			"platform": "linux",
			"version": "1.0.0",
			"size": "3.1 MB",
			"storageType": "link",
			"url": "https://example.com/download/linux-tool.tar.gz",
			"createdAt": 1705968000000,
			"updatedAt": 1705968000000,
			"enabled": false
			// downloadCount missing (old item) - treated as 0 at runtime
		}
	],
	"downloadCount": 57, // Total: 42 + 15 + 0 = 57
	"lastUpdated": 1706140800000
}
```

**Storage Constraints**:

- KV value size limit: 25 MB (current payload ~1-2 KB per item)
- Estimated capacity: ~10,000 items before approaching limit
- No indexing or querying capabilities (full list read required)

---

## Migration Strategy

### Backward Compatibility

**Scenario 1: Existing items without `downloadCount`**

```typescript
// Type safety with optional field
interface DownloadItem {
	downloadCount?: number;
}

// Runtime access with default
const count = item.downloadCount ?? 0;

// Display with fallback
{
	item.downloadCount || 0;
}
```

**Scenario 2: New items created after deployment**

```typescript
// In POST /api/admin handler
const item: DownloadItem = {
	// ... existing fields ...
	downloadCount: 0 // Explicitly initialize
};
```

**Scenario 3: Historical global count**

- Existing `list.downloadCount` (e.g., 12,580) remains unchanged
- New downloads increment both item and global counts
- Over time, `sum(item.downloadCount)` approaches `list.downloadCount`
- Acceptable drift documented in research.md

### No Data Migration Required

- Deploy code changes without KV writes
- System automatically handles `undefined` via defaults
- No downtime or deployment coordination needed

---

## Validation Examples

### Valid Operations

```typescript
// Creating new item
const item: DownloadItem = {
	id: crypto.randomUUID(),
	platform: 'windows',
	version: '1.0.0',
	size: '10 MB',
	storageType: 'link',
	url: 'https://example.com/file.exe',
	createdAt: Date.now(),
	updatedAt: Date.now(),
	enabled: true,
	downloadCount: 0 // ✅ Valid
};

// Incrementing count
item.downloadCount = (item.downloadCount || 0) + 1; // ✅ Valid

// Handling legacy item
const legacyItem: DownloadItem = {
	/* ... */
}; // downloadCount undefined
const displayCount = legacyItem.downloadCount ?? 0; // ✅ Valid (0)
```

### Invalid Operations (Type Errors)

```typescript
// Negative count
item.downloadCount = -1; // ⚠️ Violates validation rule (but TypeScript allows)

// Non-integer
item.downloadCount = 3.14; // ⚠️ Semantically invalid (use Math.floor or integer type)

// Manual user edit
// Should NOT allow admins to directly edit downloadCount field in UI
```

**Runtime Validation** (optional enhancement):

```typescript
function validateDownloadItem(item: DownloadItem): string | null {
	if (item.downloadCount !== undefined && item.downloadCount < 0) {
		return 'downloadCount must be non-negative';
	}
	if (item.downloadCount !== undefined && !Number.isInteger(item.downloadCount)) {
		return 'downloadCount must be an integer';
	}
	return null;
}
```

---

## Performance Characteristics

### Read Performance

- **Admin panel**: 1 KV read for all items (~20ms average)
- **Public page**: 1 KV read for all items (~20ms average)
- **No change** from current architecture

### Write Performance

- **Download link generation**: 1 KV write (read → modify → write)
- **Latency**: ~30-50ms (read: 20ms, write: 20ms, CPU: <10ms)
- **Meets SC-002**: Count updates <5 seconds (actual: <100ms)

### Storage Growth

- **Per item overhead**: +8 bytes for `"downloadCount": 999,`
- **10,000 items**: +80 KB total
- **Well within** 25 MB KV value limit

---

## References

- [TypeScript Handbook: Optional Properties](https://www.typescriptlang.org/docs/handbook/2/objects.html#optional-properties)
- [Cloudflare KV Limits](https://developers.cloudflare.com/kv/platform/limits/)
- Existing type definitions: `src/lib/types.ts`
