# Feature Specification: Per-Item Download Statistics

**Feature Branch**: `001-per-item-download-stats`  
**Created**: 2026-01-25  
**Status**: Draft  
**Input**: User description: "下载量统计按下载项区分。只在admin里面区分，下载页面是总和"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin Views Individual Download Item Statistics (Priority: P1)

管理员登录后台，需要查看每个下载项的独立下载次数统计，以便了解哪些资源最受欢迎，从而做出数据驱动的决策（如优先更新热门资源、下架冷门资源）。

**Why this priority**: This is the core requirement - administrators need per-item visibility to make informed decisions about resource management. Without this, they cannot identify which downloads are most valuable to users.

**Independent Test**: Admin can log into the admin panel, view the download list, and see each item's individual download count displayed alongside its other metadata. This delivers immediate value by providing usage insights.

**Acceptance Scenarios**:

1. **Given** admin is logged into the admin panel, **When** viewing the download list, **Then** each download item displays its individual download count
2. **Given** a download item has been downloaded 5 times, **When** admin views that item in the list, **Then** the count shows "5 downloads"
3. **Given** multiple download items exist with different download counts, **When** admin views the list, **Then** each item shows its own distinct count
4. **Given** a new download item has just been added, **When** admin views it, **Then** its download count shows "0 downloads"

---

### User Story 2 - Download Count Updates After User Downloads (Priority: P1)

当用户成功下载某个资源后，系统自动增加该下载项的统计计数，管理员刷新后台即可看到最新数据。

**Why this priority**: This is critical for data accuracy. Statistics are worthless if they don't update in real-time. This must be part of the MVP to ensure the feature functions correctly.

**Independent Test**: Trigger a download from the public download page, then refresh the admin panel - the specific item's count should increment by 1 while other items' counts remain unchanged.

**Acceptance Scenarios**:

1. **Given** a download item has 10 downloads, **When** a user successfully downloads it, **Then** the item's count increases to 11
2. **Given** multiple users download the same item concurrently, **When** all downloads complete, **Then** the count accurately reflects all downloads (no race conditions)
3. **Given** a user initiates but cancels a download, **When** the download is not completed, **Then** the count does not increment
4. **Given** admin views the download list after users have downloaded items, **When** admin refreshes the page, **Then** updated counts are displayed

---

### User Story 3 - Total Download Count on Public Page (Priority: P2)

公开下载页面继续显示所有下载项的总下载次数（不区分具体项），向普通用户展示整体受欢迎程度，营造社区氛围。

**Why this priority**: This maintains existing user-facing functionality and trust. While not the core feature, it's important for user experience and social proof.

**Independent Test**: Check the public download page - it should display a single aggregate count of all downloads across all items, regardless of how many individual items exist.

**Acceptance Scenarios**:

1. **Given** three download items with counts of 5, 10, and 15, **When** user views the public page, **Then** the total shows "30 downloads"
2. **Given** a user downloads any item, **When** the public page is refreshed, **Then** the total count increases by 1
3. **Given** new download items are added with 0 downloads, **When** user views the public page, **Then** the total count remains unchanged
4. **Given** a download item is disabled in admin, **When** user views the public page, **Then** the total count still includes that item's historical downloads

---

### User Story 4 - Optional: Admin Sorts by Download Count (Priority: P3)

管理员可以按下载次数对列表进行排序（降序或升序），快速识别最受欢迎或最冷门的资源。

**Why this priority**: This is a nice-to-have enhancement that improves admin efficiency but isn't critical for the core statistics feature.

**Independent Test**: In admin panel, click a "Sort by downloads" button/header - the list reorders with highest (or lowest) download counts first.

**Acceptance Scenarios**:

1. **Given** admin views the download list, **When** clicking "sort by downloads descending", **Then** items are ordered from highest to lowest count
2. **Given** admin has sorted by downloads, **When** clicking again to toggle, **Then** the sort order reverses to ascending
3. **Given** items have equal download counts, **When** sorting by downloads, **Then** those items maintain their original relative order (stable sort)

---

### Edge Cases

- What happens when download count reaches very large numbers (>1,000,000)? System should display formatted numbers (e.g., "1.2M downloads") for readability.
- How does the system handle concurrent downloads of the same item? Count increments must be atomic to prevent race conditions.
- What happens to an item's download count when the item is deleted? Count data should be preserved in historical records or explicitly reset.
- How are counts tracked across different storage types (link, R2, S3)? All storage types should increment the same counter consistently.
- What happens if the storage backend is temporarily unavailable when incrementing count? System should retry the increment or queue it for later.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST track download count separately for each download item (identified by item ID)
- **FR-002**: System MUST increment a download item's count each time a user successfully obtains a download link for that item
- **FR-003**: System MUST display each download item's individual count in the admin panel alongside other item metadata
- **FR-004**: System MUST calculate and display the sum of all download items' counts on the public download page
- **FR-005**: System MUST persist per-item download counts across system restarts and updates
- **FR-006**: Admin panel MUST show accurate counts after refreshing the page (no stale data)
- **FR-007**: System MUST handle concurrent downloads without count discrepancies (atomic increments)
- **FR-008**: When a new download item is created, its count MUST initialize to 0
- **FR-009**: Public download page MUST continue to display the aggregate total count in the existing "已有 X 位小伙伴下载" display format
- **FR-010**: Admin panel count display MUST format large numbers with thousand separators for readability (e.g., "1,234 downloads")

### Key Entities

- **DownloadItem**: Each item now includes a `downloadCount` property (integer, default 0) tracking how many times this specific item has been downloaded
- **DownloadList**: The aggregate structure includes both the `items` array (each with individual counts) and the total `downloadCount` (sum of all items' counts) for backward compatibility
- **Download Event**: Implicit entity representing a successful download action that triggers a count increment for a specific item

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Administrators can view per-item download statistics within 1 second of loading the admin panel
- **SC-002**: Download counts update within 5 seconds of a user completing a download action
- **SC-003**: System accurately tracks concurrent downloads with 100% accuracy (no lost or duplicate counts)
- **SC-004**: Public download page displays aggregate totals that match the sum of all individual item counts
- **SC-005**: Admin panel displays download counts for at least 10,000 items without performance degradation
- **SC-006**: 95% of administrators can understand which items are most popular without additional explanation or training

## Assumptions

- Download counts are considered incremented at the point when the system generates/returns a download link, not when the user completes the file download (since file download completion is difficult to track reliably across different storage types)
- Existing `DownloadList.downloadCount` field currently represents a global total; this will be retained and calculated as the sum of individual item counts
- The admin panel already displays download items in a list/table format where additional metadata (like individual counts) can be added
- Count data will be stored in the same KV store as other download item metadata
- Historical downloads (before this feature is implemented) will be reflected in the existing global count but individual items will start at 0 unless historical data migration is explicitly requested

## Technical Considerations (Non-Normative)

These are informational notes to assist with planning, not requirements:

- Current architecture stores download data in Cloudflare KV as `DownloadList` structure
- The existing `/api/downloads/link` endpoint is responsible for generating download links and currently increments the global count
- Admin panel fetches data via `/api/admin` which returns the full `DownloadList`
- Public page fetches via `/api/downloads` which also returns `DownloadList`
- Care should be taken to ensure atomic updates when incrementing counts in KV storage
