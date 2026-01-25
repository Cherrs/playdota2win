# Tasks: Per-Item Download Statistics

**Input**: Design documents from `/mnt/e/dev/TZZ/playdota2win/specs/001-per-item-download-stats/`  
**Prerequisites**: plan.md (✓), spec.md (✓), research.md (✓), data-model.md (✓), contracts/ (✓)

**Tests**: No unit test framework configured. Testing via type checking (`npm run check`), linting (`npm run lint`), and manual validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

This is a single SvelteKit project with standard structure:

- Source code: `src/lib/` and `src/routes/`
- Type definitions: `src/lib/types.ts`
- Components: `src/lib/components/`
- API endpoints: `src/routes/api/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Minimal setup - this feature extends existing infrastructure

**Note**: No new project setup required; feature modifies existing codebase.

- [ ] T001 Verify development environment (Node.js 18+, npm, wrangler CLI installed)
- [ ] T002 Checkout feature branch `001-per-item-download-stats`
- [ ] T003 Run `npm install` to ensure all dependencies are current
- [ ] T004 Run `npm run check` to verify TypeScript baseline (should pass before changes)

**Checkpoint**: Environment verified - ready to begin implementation

---

## Phase 2: Foundational (Type Definitions)

**Purpose**: Update core type definitions that ALL user stories depend on

**⚠️ CRITICAL**: This phase MUST be complete before any user story work begins

- [ ] T005 Add `downloadCount?: number` field to `DownloadItem` interface in `src/lib/types.ts` (after `enabled` property, line ~69)
- [ ] T006 Run `npm run check` to verify TypeScript compilation passes with new field

**Checkpoint**: Type definitions updated - user story implementation can now begin

---

## Phase 3: User Story 1 - Admin Views Individual Download Item Statistics (Priority: P1) 🎯 MVP

**Goal**: Enable administrators to view per-item download counts in the admin panel

**Independent Test**: Admin logs into `/admin`, views download list, sees each item's individual download count displayed alongside metadata

**Acceptance Criteria**:

1. Each download item displays its individual `downloadCount`
2. Items with 0 downloads show "0"
3. Multiple items show distinct counts
4. New items show "0 downloads"

### Implementation for User Story 1

- [ ] T007 [P] [US1] Update admin API endpoint to return items with `downloadCount` in `src/routes/api/admin/+server.ts` (GET handler already returns items - no code change needed, just verify field is present)
- [ ] T008 [P] [US1] Add download count display UI in `src/lib/components/DownloadList.svelte` (add `<div class="download-count">` with icon, value, label)
- [ ] T009 [P] [US1] Add CSS styles for download count display in `src/lib/components/DownloadList.svelte` (`.download-count`, `.count-icon`, `.count-value`, `.count-label` classes)
- [ ] T010 [US1] Test download count formatting with `.toLocaleString('zh-CN')` for thousand separators in `src/lib/components/DownloadList.svelte`
- [ ] T011 [US1] Handle legacy items (undefined `downloadCount`) with `|| 0` fallback in display logic in `src/lib/components/DownloadList.svelte`

### Validation for User Story 1

- [ ] T012 [US1] Run `npm run check` to verify TypeScript type safety for download count display
- [ ] T013 [US1] Run `npm run lint` to verify code style compliance
- [ ] T014 [US1] Manual test: Start dev server (`npm run dev`), navigate to `/admin`, verify each item shows download count (default 0 for existing items)
- [ ] T015 [US1] Manual test: Verify large numbers display with thousand separators (e.g., modify KV data to set `downloadCount: 123456`, check displays as "123,456")

**Checkpoint**: User Story 1 complete - admin panel displays per-item counts

---

## Phase 4: User Story 2 - Download Count Updates After User Downloads (Priority: P1)

**Goal**: Automatically increment per-item download count when users successfully download items

**Independent Test**: Trigger download from `/download` page, refresh admin panel, verify specific item's count incremented by 1

**Acceptance Criteria**:

1. Item count increases after successful download
2. Concurrent downloads tracked accurately (eventual consistency acceptable)
3. Canceled downloads don't increment count
4. Admin panel shows updated counts after refresh

### Implementation for User Story 2

- [ ] T016 [US2] Initialize `downloadCount: 0` for new items in `src/routes/api/admin/+server.ts` POST handler (line ~204, add to `item` object creation)
- [ ] T017 [US2] Implement per-item count increment in `src/routes/api/downloads/link/+server.ts` POST handler (line ~152, add `item.downloadCount = (item.downloadCount || 0) + 1` before existing `list.downloadCount` increment)
- [ ] T018 [US2] Ensure both item and total counts are incremented atomically in same KV write in `src/routes/api/downloads/link/+server.ts` (verify both increments happen before `await kv.put()`)

### Validation for User Story 2

- [ ] T019 [US2] Run `npm run check` to verify type safety for count increment logic
- [ ] T020 [US2] Run `npm run preview` to test with Workers runtime and KV bindings
- [ ] T021 [US2] Manual test: Create new download item via admin, verify `downloadCount: 0` in KV storage (use `wrangler kv:key get --binding=APP_KV "downloads_list"`)
- [ ] T022 [US2] Manual test: Download an item from public page, verify item's count incremented in admin panel
- [ ] T023 [US2] Manual test: Verify total count (`list.downloadCount`) also incremented by 1
- [ ] T024 [US2] Manual test: Download different items, verify each tracks independently

**Checkpoint**: User Story 2 complete - download counts update automatically

---

## Phase 5: User Story 3 - Total Download Count on Public Page (Priority: P2)

**Goal**: Maintain existing aggregate download count display on public page

**Independent Test**: View `/download` page, verify total count matches sum of all item counts

**Acceptance Criteria**:

1. Public page shows single aggregate count
2. Total increases after any item download
3. Total includes disabled items' historical counts
4. Display format unchanged ("已有 X 位小伙伴下载")

### Implementation for User Story 3

- [ ] T025 [US3] Verify public API endpoint returns total `downloadCount` in `src/routes/api/downloads/+server.ts` GET handler (no code change needed - already returns `list.downloadCount`)
- [ ] T026 [US3] Verify public page displays aggregate total in `src/routes/download/+page.svelte` (line ~227, already uses `downloadCount.toLocaleString()`)

### Validation for User Story 3

- [ ] T027 [US3] Manual test: View public page, verify total count displayed
- [ ] T028 [US3] Manual test: Verify total equals sum of all items (create items with known counts: 5, 10, 15; verify total shows 30)
- [ ] T029 [US3] Manual test: Download any item, refresh public page, verify total increased by 1
- [ ] T030 [US3] Manual test: Disable an item in admin, verify public page total still includes its historical count

**Checkpoint**: User Story 3 complete - public page maintains aggregate count display

---

## Phase 6: User Story 4 - Optional: Admin Sorts by Download Count (Priority: P3)

**Goal**: Enable administrators to sort download list by count (descending/ascending)

**Independent Test**: Click sort button/header in admin panel, verify list reorders by download count

**Acceptance Criteria**:

1. Items can be sorted by download count (highest first)
2. Toggle sort order between descending/ascending
3. Stable sort for equal counts
4. Sort persists during session

**Note**: This is an OPTIONAL enhancement (P3). Can be deferred to post-MVP.

### Implementation for User Story 4 (Optional)

- [ ] T031 [P] [US4] Add sort state to admin page in `src/routes/admin/+page.svelte` using `$state()` (e.g., `let sortBy = $state<'downloads' | null>(null)`, `let sortOrder = $state<'asc' | 'desc'>('desc')`)
- [ ] T032 [P] [US4] Add sort button/header in download list component in `src/lib/components/DownloadList.svelte`
- [ ] T033 [US4] Implement sort logic in admin page: `downloads.sort((a, b) => sortOrder === 'desc' ? (b.downloadCount || 0) - (a.downloadCount || 0) : (a.downloadCount || 0) - (b.downloadCount || 0))` in `src/routes/admin/+page.svelte`
- [ ] T034 [US4] Add visual indicator for active sort (arrow icon, color change) in `src/lib/components/DownloadList.svelte`
- [ ] T035 [US4] Test toggle functionality (click once = desc, click again = asc, click third time = reset) in `src/routes/admin/+page.svelte`

### Validation for User Story 4 (Optional)

- [ ] T036 [US4] Run `npm run check` to verify TypeScript compilation
- [ ] T037 [US4] Manual test: Click sort button, verify items reorder by download count
- [ ] T038 [US4] Manual test: Click again, verify sort order reverses
- [ ] T039 [US4] Manual test: Items with equal counts maintain their relative order (stable sort)

**Checkpoint**: User Story 4 complete (optional) - admin can sort by download count

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and ensure production readiness

- [ ] T040 [P] Optional: Update AdminHeader to show "X items, Y total downloads" in `src/lib/components/AdminHeader.svelte` (enhance stats display)
- [ ] T041 [P] Add code comments documenting eventual consistency trade-off in `src/routes/api/downloads/link/+server.ts` (line ~152, explain race condition is acceptable per research.md)
- [ ] T042 [P] Verify backward compatibility: test with KV data lacking `downloadCount` fields (manually remove field from one item, verify UI defaults to 0)
- [ ] T043 Constitution compliance review: verify Svelte 5 syntax (`$state()`, `onclick={}`, no legacy patterns)
- [ ] T044 Run `npm run check` for final type safety validation
- [ ] T045 Run `npm run lint` for final code style validation
- [ ] T046 Run `npm run format` to auto-format all modified files
- [ ] T047 Manual testing: Complete quickstart.md validation scenarios (sections 4a-4c)
- [ ] T048 Build for production: `npm run build` (verify no errors)
- [ ] T049 Test with Workers runtime: `npm run preview` (verify KV operations work)
- [ ] T050 Performance validation: measure admin panel load time (should be <1 second per SC-001)

**Checkpoint**: All quality gates passed - ready for deployment

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) - Independent of US1 but logically follows it
- **User Story 3 (Phase 5)**: Depends on US2 (needs count increment logic working) - Validates total calculation
- **User Story 4 (Phase 6)**: Depends on US1 (needs count display working) - Optional enhancement
- **Polish (Phase 7)**: Depends on completion of US1, US2, US3 (minimum for MVP)

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - **MVP CORE**
- **User Story 2 (P1)**: Should follow US1 (logically builds on it) - **MVP CORE**
- **User Story 3 (P2)**: Depends on US2 (validates increment logic) - **MVP CORE**
- **User Story 4 (P3)**: Depends on US1 (optional enhancement) - **POST-MVP**

### Within Each User Story

**User Story 1**:

- T007, T008, T009 can run in parallel [P] (different concerns)
- T010, T011 depend on T008 (need UI structure first)
- T012-T015 are sequential validation steps

**User Story 2**:

- T016, T017 can be done in sequence (same file concerns)
- T018 verifies both T016 and T017
- T019-T024 are sequential validation steps

**User Story 3**:

- T025, T026 are verification tasks (no code changes expected)
- T027-T030 are sequential validation steps

**User Story 4** (optional):

- T031, T032 can run in parallel [P] (different files)
- T033 depends on T031 (needs state defined)
- T034, T035 enhance T032, T033
- T036-T039 are sequential validation steps

### Parallel Opportunities

- **Phase 1 (Setup)**: All tasks can run sequentially (quick verification steps)
- **Phase 2 (Foundational)**: T005 and T006 are sequential (type check depends on type definition)
- **Phase 3 (US1)**: T007, T008, T009 can run in parallel (different files/concerns)
- **Phase 4 (US2)**: Sequential (same file modifications)
- **Phase 5 (US3)**: Sequential (verification tasks)
- **Phase 6 (US4)**: T031 and T032 can run in parallel
- **Phase 7 (Polish)**: T040, T041, T042 can run in parallel (different files)

**If multiple developers available**:

- After Phase 2: One dev can work on US1 (admin UI) while another preps US2 (API logic)
- US4 (sorting) can be developed in parallel with US3 (validation) if desired

---

## Parallel Example: User Story 1

```bash
# Launch parallel tasks for User Story 1 (T007, T008, T009):

# Terminal 1: Verify admin API (T007)
Task: "Review src/routes/api/admin/+server.ts GET handler - confirm downloadCount field passes through"

# Terminal 2: Add count display UI (T008)
Task: "Add download count display markup in src/lib/components/DownloadList.svelte"

# Terminal 3: Add CSS styles (T009)
Task: "Add download count styles in src/lib/components/DownloadList.svelte <style> block"

# Then sequentially: T010, T011, T012-T015
```

---

## Implementation Strategy

### MVP First (User Stories 1, 2, 3 Only)

**Recommended approach for fastest time-to-value**:

1. **Complete Phase 1: Setup** (~5 minutes)
   - Verify environment, checkout branch, install dependencies
2. **Complete Phase 2: Foundational** (~5 minutes)
   - Add `downloadCount` field to types, verify compilation
3. **Complete Phase 3: User Story 1** (~45 minutes)
   - Admin panel displays per-item counts
   - **STOP and VALIDATE**: Test admin can see counts
4. **Complete Phase 4: User Story 2** (~30 minutes)
   - Download increments item count
   - **STOP and VALIDATE**: Test download → count increases
5. **Complete Phase 5: User Story 3** (~15 minutes)
   - Public page shows aggregate total
   - **STOP and VALIDATE**: Test public total matches sum
6. **Complete Phase 7: Polish** (~30 minutes)
   - Code cleanup, validation, build verification

**Total MVP time: ~2.5 hours** (matches quickstart.md estimate)

**Deploy MVP**: At this point, core feature is complete and production-ready.

### Incremental Delivery

1. **Foundation** (Setup + Foundational) → Type safety established
2. **MVP v1** (+ User Story 1) → Admin sees counts (immediate value!)
3. **MVP v2** (+ User Story 2) → Counts update automatically (feature complete)
4. **MVP v3** (+ User Story 3) → Public page validated (backward compatible)
5. **Enhancement** (+ User Story 4) → Sorting added (nice-to-have)

Each increment is independently deployable and adds value.

### Parallel Team Strategy

**If 2 developers available**:

1. Both complete Setup + Foundational together (~10 minutes)
2. Split work:
   - **Developer A**: User Story 1 (admin UI display) → T007-T015
   - **Developer B**: User Story 2 (count increment logic) → T016-T024
3. Integrate and test together
4. Together: User Story 3 validation → T025-T030
5. Developer A (if time): User Story 4 (sorting) → T031-T039

**If 1 developer**:

- Follow MVP First strategy sequentially
- Estimate: 2-3 hours total (per quickstart.md)

---

## Notes

- **[P] tasks**: Different files/concerns, no dependencies within phase
- **[Story] labels**: Map tasks to user stories for traceability
- **No tests**: Project has no test framework; rely on TypeScript checking and manual validation
- **Validation steps**: Included in each user story phase (type check → lint → manual tests)
- **Commit strategy**: Commit after each user story phase completion (T015, T024, T030, T039, T050)
- **Stop at checkpoints**: Each user story should be independently verifiable before proceeding
- **MVP scope**: User Stories 1, 2, 3 (P1-P2 priorities) = complete feature
- **Post-MVP**: User Story 4 (P3 priority) = optional enhancement

---

## Task Count Summary

- **Phase 1 (Setup)**: 4 tasks
- **Phase 2 (Foundational)**: 2 tasks
- **Phase 3 (User Story 1 - P1)**: 9 tasks (T007-T015) 🎯
- **Phase 4 (User Story 2 - P1)**: 9 tasks (T016-T024) 🎯
- **Phase 5 (User Story 3 - P2)**: 6 tasks (T025-T030) 🎯
- **Phase 6 (User Story 4 - P3)**: 9 tasks (T031-T039) ⭐ Optional
- **Phase 7 (Polish)**: 11 tasks (T040-T050)

**Total**: 50 tasks  
**MVP Core** (US1+US2+US3): 30 tasks (Setup + Foundational + US1 + US2 + US3 + Polish)  
**Optional Enhancement** (US4): 9 tasks

**Parallel Opportunities**:

- Phase 3: 3 parallel tasks (T007, T008, T009)
- Phase 6: 2 parallel tasks (T031, T032)
- Phase 7: 3 parallel tasks (T040, T041, T042)

**Suggested MVP Scope**: Complete Phases 1-5 and 7 (skip Phase 6/US4) for fastest time-to-value.
