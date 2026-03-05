# 公告系统实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为下载站添加公告/通知系统，支持管理员在后台发布 Markdown 公告，以卡片形式展示在公开下载页的下载列表上方。

**Architecture:** 公告数据独立存储于 KV（key: `announcements`），结构与现有 categories/downloads 一致。公开 GET 接口返回 visible 公告，管理 CRUD 接口需 Admin JWT 鉴权。前端新增三个 Svelte 5 组件，管理后台新增公告管理 Tab。

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes)、TypeScript、Cloudflare KV、现有 `markdown.ts` 解析工具、现有 `requireAdminAuth()` 鉴权

---

### Task 1: 添加 TypeScript 类型

**Files:**

- Modify: `src/lib/types.ts`

**Step 1: 在 `src/lib/types.ts` 末尾追加以下类型**

```ts
/**
 * 公告
 */
export interface Announcement {
	id: string;
	title: string;
	content: string; // Markdown 正文
	visible: boolean; // false 则对用户隐藏
	pinned: boolean; // 置顶（排在前面）
	createdAt: number; // Date.now()
	updatedAt: number;
}

/**
 * 公告列表
 */
export interface AnnouncementList {
	items: Announcement[];
	lastUpdated: number;
}

/**
 * 公告表单数据
 */
export interface AnnouncementFormData {
	title: string;
	content: string;
	visible?: boolean;
	pinned?: boolean;
}
```

**Step 2: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 3: 提交**

```bash
git add src/lib/types.ts
git commit -m "feat: 添加公告系统 TypeScript 类型"
```

---

### Task 2: 创建公开 GET API

**Files:**

- Create: `src/routes/api/announcements/+server.ts`

**Step 1: 创建文件**

```ts
import { json, type RequestHandler } from '@sveltejs/kit';
import type { AnnouncementList, ApiResponse } from '$lib/types';

const KV_KEY = 'announcements';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			// 开发环境返回示例数据
			return json({
				success: true,
				data: {
					items: [
						{
							id: 'demo-1',
							title: '欢迎使用下载站',
							content: '这里是**示例公告**，支持 Markdown 格式。',
							visible: true,
							pinned: true,
							createdAt: Date.now(),
							updatedAt: Date.now()
						}
					],
					lastUpdated: Date.now()
				}
			} satisfies ApiResponse<AnnouncementList>);
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const allItems = stored?.items || [];

		// 只返回 visible 公告，置顶优先，其次按 createdAt 降序
		const visibleItems = allItems
			.filter((a) => a.visible)
			.sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return b.createdAt - a.createdAt;
			});

		return json({
			success: true,
			data: { items: visibleItems, lastUpdated: stored?.lastUpdated ?? Date.now() }
		} satisfies ApiResponse<AnnouncementList>);
	} catch (error) {
		console.error('Error fetching announcements:', error);
		return json({ success: false, error: '获取公告失败' } satisfies ApiResponse, { status: 500 });
	}
};
```

**Step 2: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 3: 提交**

```bash
git add src/routes/api/announcements/+server.ts
git commit -m "feat: 添加公告公开 GET API"
```

---

### Task 3: 创建管理员 CRUD API

**Files:**

- Create: `src/routes/api/admin/announcements/+server.ts`

**Step 1: 创建文件**

```ts
import { json, type RequestHandler } from '@sveltejs/kit';
import type { Announcement, AnnouncementList, AnnouncementFormData, ApiResponse } from '$lib/types';
import { requireAdminAuth } from '$lib/admin-auth';

const KV_KEY = 'announcements';

function sortAnnouncements(items: Announcement[]): Announcement[] {
	return [...items].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.createdAt - a.createdAt;
	});
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env.ADMIN_JWT_SECRET,
		platform?.env.APP_KV
	);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({
				success: true,
				data: { items: [], lastUpdated: Date.now() }
			} satisfies ApiResponse<AnnouncementList>);
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = sortAnnouncements(stored?.items || []);

		return json({
			success: true,
			data: { items, lastUpdated: stored?.lastUpdated ?? Date.now() }
		} satisfies ApiResponse<AnnouncementList>);
	} catch (e) {
		console.error('Failed to get announcements:', e);
		return json({ success: false, error: '获取公告列表失败' } satisfies ApiResponse, {
			status: 500
		});
	}
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env.ADMIN_JWT_SECRET,
		platform?.env.APP_KV
	);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, {
				status: 500
			});
		}

		const body = (await request.json()) as AnnouncementFormData;
		if (!body.title?.trim()) {
			return json({ success: false, error: '公告标题不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (!body.content?.trim()) {
			return json({ success: false, error: '公告内容不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = stored?.items || [];

		const now = Date.now();
		const newItem: Announcement = {
			id: `ann_${now}_${Math.random().toString(36).substring(2, 9)}`,
			title: body.title.trim(),
			content: body.content.trim(),
			visible: body.visible ?? true,
			pinned: body.pinned ?? false,
			createdAt: now,
			updatedAt: now
		};

		const newList: AnnouncementList = {
			items: [...items, newItem],
			lastUpdated: now
		};
		await kv.put(KV_KEY, JSON.stringify(newList));

		return json({ success: true, data: newItem } satisfies ApiResponse<Announcement>);
	} catch (e) {
		console.error('Failed to create announcement:', e);
		return json({ success: false, error: '创建公告失败' } satisfies ApiResponse, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env.ADMIN_JWT_SECRET,
		platform?.env.APP_KV
	);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, {
				status: 500
			});
		}

		const body = (await request.json()) as { id: string } & Partial<AnnouncementFormData>;
		if (!body.id) {
			return json({ success: false, error: '缺少公告 ID' } satisfies ApiResponse, { status: 400 });
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = stored?.items || [];
		const index = items.findIndex((a) => a.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '公告不存在' } satisfies ApiResponse, { status: 404 });
		}

		const now = Date.now();
		const updated: Announcement = {
			...items[index],
			...(body.title !== undefined && { title: body.title.trim() }),
			...(body.content !== undefined && { content: body.content.trim() }),
			...(body.visible !== undefined && { visible: body.visible }),
			...(body.pinned !== undefined && { pinned: body.pinned }),
			updatedAt: now
		};
		items[index] = updated;

		await kv.put(KV_KEY, JSON.stringify({ items, lastUpdated: now }));

		return json({ success: true, data: updated } satisfies ApiResponse<Announcement>);
	} catch (e) {
		console.error('Failed to update announcement:', e);
		return json({ success: false, error: '更新公告失败' } satisfies ApiResponse, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env.ADMIN_JWT_SECRET,
		platform?.env.APP_KV
	);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, {
				status: 500
			});
		}

		const body = (await request.json()) as { id: string };
		if (!body.id) {
			return json({ success: false, error: '缺少公告 ID' } satisfies ApiResponse, { status: 400 });
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = stored?.items || [];
		const index = items.findIndex((a) => a.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '公告不存在' } satisfies ApiResponse, { status: 404 });
		}

		items.splice(index, 1);
		const now = Date.now();
		await kv.put(KV_KEY, JSON.stringify({ items, lastUpdated: now }));

		return json({ success: true } satisfies ApiResponse);
	} catch (e) {
		console.error('Failed to delete announcement:', e);
		return json({ success: false, error: '删除公告失败' } satisfies ApiResponse, { status: 500 });
	}
};
```

**Step 2: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 3: 提交**

```bash
git add src/routes/api/admin/announcements/+server.ts
git commit -m "feat: 添加公告管理员 CRUD API"
```

---

### Task 4: 创建 AnnouncementCard 组件

**Files:**

- Create: `src/lib/components/AnnouncementCard.svelte`

项目已有 `src/lib/utils/markdown.ts`，使用其中的解析函数渲染 Markdown。先读取该文件确认导出的函数名。

**Step 1: 读取 markdown 工具**

```bash
# 查看 src/lib/utils/markdown.ts 的导出
```

用 Read 工具读取 `src/lib/utils/markdown.ts`，确认渲染函数名称（通常是 `parseMarkdown` 或 `renderMarkdown`）。

**Step 2: 创建组件**

根据确认的函数名（以下以 `parseMarkdown` 为例）：

```svelte
<script lang="ts">
	import type { Announcement } from '$lib/types';
	import { parseMarkdown } from '$lib/utils/markdown';

	interface Props {
		announcement: Announcement;
	}

	let { announcement }: Props = $props();

	let htmlContent = $derived(parseMarkdown(announcement.content));
</script>

<div class="announcement-card" class:pinned={announcement.pinned}>
	<div class="card-header">
		{#if announcement.pinned}
			<span class="pin-icon">📌</span>
		{/if}
		<h3 class="card-title">{announcement.title}</h3>
	</div>
	<div class="card-content markdown-body">
		{@html htmlContent}
	</div>
</div>

<style>
	.announcement-card {
		background: linear-gradient(135deg, #fffbf0, #fff0e0);
		border: 1px solid rgba(255, 180, 80, 0.3);
		border-radius: 20px;
		padding: 1.25rem 1.5rem;
		transition: box-shadow 0.3s ease;
	}

	.announcement-card.pinned {
		border-color: rgba(255, 140, 40, 0.5);
		box-shadow: 0 2px 12px rgba(255, 160, 60, 0.15);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.pin-icon {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.card-title {
		font-family: 'Fredoka', 'Nunito', sans-serif;
		font-size: 1.1rem;
		font-weight: 600;
		color: #8b5e1a;
		margin: 0;
	}

	.card-content {
		font-size: 0.9rem;
		color: #6b4c2a;
		line-height: 1.6;
	}

	.card-content :global(a) {
		color: #c07020;
		text-decoration: underline;
	}

	.card-content :global(strong) {
		font-weight: 700;
	}

	.card-content :global(ul),
	.card-content :global(ol) {
		padding-left: 1.25rem;
		margin: 0.5rem 0;
	}

	.card-content :global(p) {
		margin: 0.25rem 0;
	}
</style>
```

**Step 3: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 4: 提交**

```bash
git add src/lib/components/AnnouncementCard.svelte
git commit -m "feat: 添加 AnnouncementCard 组件"
```

---

### Task 5: 创建 AnnouncementList 组件

**Files:**

- Create: `src/lib/components/AnnouncementList.svelte`

**Step 1: 创建文件**

```svelte
<script lang="ts">
	import type {
		Announcement,
		AnnouncementList as AnnouncementListData,
		ApiResponse
	} from '$lib/types';
	import AnnouncementCard from './AnnouncementCard.svelte';

	let announcements = $state<Announcement[]>([]);
	let loading = $state(true);

	async function loadAnnouncements() {
		try {
			const res = await fetch('/api/announcements');
			const data: ApiResponse<AnnouncementListData> = await res.json();
			if (data.success && data.data) {
				announcements = data.data.items;
			}
		} catch (e) {
			console.error('Failed to load announcements:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadAnnouncements();
	});
</script>

{#if !loading && announcements.length > 0}
	<section class="announcement-section">
		<div class="section-header">
			<span class="section-icon">📢</span>
			<h2 class="section-title">公告</h2>
		</div>
		<div class="announcement-list">
			{#each announcements as announcement (announcement.id)}
				<AnnouncementCard {announcement} />
			{/each}
		</div>
	</section>
{/if}

<style>
	.announcement-section {
		margin-bottom: 2rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.section-icon {
		font-size: 1.25rem;
	}

	.section-title {
		font-family: 'Fredoka', 'Nunito', sans-serif;
		font-size: 1.25rem;
		font-weight: 600;
		color: #6b4c9a;
		margin: 0;
	}

	.announcement-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
</style>
```

**Step 2: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 3: 提交**

```bash
git add src/lib/components/AnnouncementList.svelte
git commit -m "feat: 添加 AnnouncementList 组件"
```

---

### Task 6: 将 AnnouncementList 嵌入下载页

**Files:**

- Modify: `src/routes/download/+page.svelte`

**Step 1: 在 script 导入区追加 AnnouncementList 导入**

在现有 import 列表末尾（`import { isGuideVerified... }` 之后）添加：

```ts
import AnnouncementList from '$lib/components/AnnouncementList.svelte';
```

**Step 2: 在模板中找到下载卡片列表渲染位置**

读取 `src/routes/download/+page.svelte` 找到渲染下载卡片的外层容器（含 `DownloadCard` 的那段）。在该容器**上方**插入：

```svelte
<AnnouncementList />
```

具体位置：在渲染 `CategoryTabs` 或下载卡片网格的父元素之前，同层级插入。

**Step 3: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 4: 本地预览验证**

```bash
npm run dev
```

打开 `http://localhost:5173/download`，确认公告卡片出现在下载卡片列表上方（开发模式下应显示示例公告）。

**Step 5: 提交**

```bash
git add src/routes/download/+page.svelte
git commit -m "feat: 在下载页嵌入公告列表"
```

---

### Task 7: 创建 AnnouncementForm 管理组件

**Files:**

- Create: `src/lib/components/AnnouncementForm.svelte`

该组件供管理后台使用，接受 token prop，支持新增、编辑、删除、切换 visible/pinned。

**Step 1: 创建文件**

```svelte
<script lang="ts">
	import type {
		Announcement,
		AnnouncementList,
		AnnouncementFormData,
		ApiResponse
	} from '$lib/types';

	interface Props {
		token: string;
	}

	let { token }: Props = $props();

	let announcements = $state<Announcement[]>([]);
	let loading = $state(true);
	let error = $state('');
	let success = $state('');

	// 表单状态
	let editingId = $state<string | null>(null);
	let formTitle = $state('');
	let formContent = $state('');
	let formVisible = $state(true);
	let formPinned = $state(false);
	let submitting = $state(false);

	const authHeaders = $derived({
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json'
	});

	async function loadAnnouncements() {
		loading = true;
		try {
			const res = await fetch('/api/admin/announcements', {
				headers: { Authorization: `Bearer ${token}` }
			});
			const data: ApiResponse<AnnouncementList> = await res.json();
			if (data.success && data.data) {
				announcements = data.data.items;
			} else {
				error = data.error || '加载失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			loading = false;
		}
	}

	function startEdit(item: Announcement) {
		editingId = item.id;
		formTitle = item.title;
		formContent = item.content;
		formVisible = item.visible;
		formPinned = item.pinned;
	}

	function cancelEdit() {
		editingId = null;
		formTitle = '';
		formContent = '';
		formVisible = true;
		formPinned = false;
	}

	async function handleSubmit() {
		if (!formTitle.trim() || !formContent.trim()) {
			error = '标题和内容不能为空';
			return;
		}
		submitting = true;
		error = '';
		success = '';
		try {
			const body: AnnouncementFormData & { id?: string } = {
				title: formTitle,
				content: formContent,
				visible: formVisible,
				pinned: formPinned,
				...(editingId && { id: editingId })
			};
			const method = editingId ? 'PUT' : 'POST';
			const res = await fetch('/api/admin/announcements', {
				method,
				headers: authHeaders,
				body: JSON.stringify(body)
			});
			const data: ApiResponse<Announcement> = await res.json();
			if (data.success) {
				success = editingId ? '更新成功' : '创建成功';
				cancelEdit();
				await loadAnnouncements();
			} else {
				error = data.error || '操作失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			submitting = false;
		}
	}

	async function toggleVisible(item: Announcement) {
		try {
			const res = await fetch('/api/admin/announcements', {
				method: 'PUT',
				headers: authHeaders,
				body: JSON.stringify({ id: item.id, visible: !item.visible })
			});
			const data: ApiResponse = await res.json();
			if (data.success) {
				await loadAnnouncements();
			}
		} catch {
			error = '操作失败';
		}
	}

	async function togglePinned(item: Announcement) {
		try {
			const res = await fetch('/api/admin/announcements', {
				method: 'PUT',
				headers: authHeaders,
				body: JSON.stringify({ id: item.id, pinned: !item.pinned })
			});
			const data: ApiResponse = await res.json();
			if (data.success) {
				await loadAnnouncements();
			}
		} catch {
			error = '操作失败';
		}
	}

	async function deleteAnnouncement(id: string) {
		if (!confirm('确定删除这条公告吗？')) return;
		try {
			const res = await fetch('/api/admin/announcements', {
				method: 'DELETE',
				headers: authHeaders,
				body: JSON.stringify({ id })
			});
			const data: ApiResponse = await res.json();
			if (data.success) {
				success = '删除成功';
				await loadAnnouncements();
			} else {
				error = data.error || '删除失败';
			}
		} catch {
			error = '网络错误';
		}
	}

	$effect(() => {
		if (token) loadAnnouncements();
	});
</script>

<div class="announcement-manager">
	<h3 class="section-title">公告管理</h3>

	{#if error}
		<div class="alert alert-error">{error}</div>
	{/if}
	{#if success}
		<div class="alert alert-success">{success}</div>
	{/if}

	<!-- 新增/编辑表单 -->
	<div class="form-card">
		<h4 class="form-title">{editingId ? '编辑公告' : '新增公告'}</h4>
		<div class="form-field">
			<label for="ann-title">标题</label>
			<input
				id="ann-title"
				type="text"
				bind:value={formTitle}
				placeholder="公告标题"
				class="form-input"
			/>
		</div>
		<div class="form-field">
			<label for="ann-content">内容（Markdown）</label>
			<textarea
				id="ann-content"
				bind:value={formContent}
				placeholder="支持 **加粗**、[链接](url)、- 列表等 Markdown 格式"
				class="form-textarea"
				rows="5"
			></textarea>
		</div>
		<div class="form-row">
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={formVisible} />
				<span>显示</span>
			</label>
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={formPinned} />
				<span>置顶</span>
			</label>
		</div>
		<div class="form-actions">
			<button class="btn btn-primary" onclick={handleSubmit} disabled={submitting}>
				{submitting ? '提交中...' : editingId ? '保存修改' : '发布公告'}
			</button>
			{#if editingId}
				<button class="btn btn-outline" onclick={cancelEdit} type="button">取消</button>
			{/if}
		</div>
	</div>

	<!-- 公告列表 -->
	{#if loading}
		<p class="loading-text">加载中...</p>
	{:else if announcements.length === 0}
		<p class="empty-text">暂无公告</p>
	{:else}
		<div class="list">
			{#each announcements as item (item.id)}
				<div class="list-item">
					<div class="item-info">
						<span class="item-title">{item.pinned ? '📌 ' : ''}{item.title}</span>
						<span class="item-status" class:hidden={!item.visible}
							>{item.visible ? '显示' : '隐藏'}</span
						>
					</div>
					<div class="item-actions">
						<button class="btn-sm" onclick={() => togglePinned(item)} type="button">
							{item.pinned ? '取消置顶' : '置顶'}
						</button>
						<button class="btn-sm" onclick={() => toggleVisible(item)} type="button">
							{item.visible ? '隐藏' : '显示'}
						</button>
						<button class="btn-sm" onclick={() => startEdit(item)} type="button">编辑</button>
						<button
							class="btn-sm btn-danger"
							onclick={() => deleteAnnouncement(item.id)}
							type="button">删除</button
						>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.announcement-manager {
		padding: 1rem 0;
	}

	.section-title {
		font-family: 'Fredoka', 'Nunito', sans-serif;
		font-size: 1.2rem;
		color: #6b4c9a;
		margin: 0 0 1rem;
	}

	.alert {
		padding: 0.75rem 1rem;
		border-radius: 12px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.alert-error {
		background: #fff0f0;
		color: #c0392b;
		border: 1px solid #fcc;
	}

	.alert-success {
		background: #f0fff4;
		color: #27ae60;
		border: 1px solid #aed6b8;
	}

	.form-card {
		background: rgba(255, 255, 255, 0.8);
		border: 1px solid rgba(107, 76, 154, 0.2);
		border-radius: 20px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.form-title {
		font-size: 1rem;
		font-weight: 600;
		color: #6b4c9a;
		margin: 0 0 1rem;
	}

	.form-field {
		margin-bottom: 0.75rem;
	}

	.form-field label {
		display: block;
		font-size: 0.85rem;
		color: #555;
		margin-bottom: 0.35rem;
	}

	.form-input,
	.form-textarea {
		width: 100%;
		padding: 0.6rem 0.8rem;
		border: 1px solid rgba(107, 76, 154, 0.3);
		border-radius: 12px;
		font-size: 0.9rem;
		font-family: 'Nunito', sans-serif;
		box-sizing: border-box;
		resize: vertical;
	}

	.form-row {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.form-actions {
		display: flex;
		gap: 0.75rem;
	}

	.btn {
		padding: 0.5rem 1.25rem;
		border-radius: 12px;
		border: none;
		font-size: 0.9rem;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-primary {
		background: linear-gradient(135deg, #6b4c9a, #ff6b9d);
		color: white;
	}

	.btn-outline {
		background: transparent;
		border: 1px solid #6b4c9a;
		color: #6b4c9a;
	}

	.loading-text,
	.empty-text {
		color: #999;
		font-size: 0.9rem;
		text-align: center;
		padding: 1rem;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.list-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: rgba(255, 255, 255, 0.7);
		border: 1px solid rgba(107, 76, 154, 0.15);
		border-radius: 14px;
		padding: 0.75rem 1rem;
		gap: 1rem;
	}

	.item-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-size: 0.9rem;
		color: #333;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-status {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 8px;
		background: #e8f5e9;
		color: #27ae60;
		flex-shrink: 0;
	}

	.item-status.hidden {
		background: #f5f5f5;
		color: #999;
	}

	.item-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.btn-sm {
		padding: 0.3rem 0.65rem;
		border-radius: 8px;
		border: 1px solid rgba(107, 76, 154, 0.3);
		background: transparent;
		color: #6b4c9a;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.btn-sm:hover {
		background: rgba(107, 76, 154, 0.08);
	}

	.btn-sm.btn-danger {
		border-color: rgba(192, 57, 43, 0.3);
		color: #c0392b;
	}

	.btn-sm.btn-danger:hover {
		background: rgba(192, 57, 43, 0.08);
	}
</style>
```

**Step 2: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 3: 提交**

```bash
git add src/lib/components/AnnouncementForm.svelte
git commit -m "feat: 添加 AnnouncementForm 管理组件"
```

---

### Task 8: 将公告管理嵌入后台管理页

**Files:**

- Modify: `src/routes/admin/+page.svelte`

**Step 1: 读取 admin 页面完整内容**

用 Read 工具读取 `src/routes/admin/+page.svelte` 全文，找到：

1. script 顶部 import 区域
2. 渲染 `CategoryManager` 的位置（这里要新增 Tab 切换）

**Step 2: 添加 import**

在现有 import 末尾添加：

```ts
import AnnouncementForm from '$lib/components/AnnouncementForm.svelte';
```

**Step 3: 添加 Tab 状态变量**

在 script 中，现有状态变量区添加：

```ts
let adminTab = $state<'downloads' | 'categories' | 'announcements'>('downloads');
```

**Step 4: 在模板中添加 Tab 导航和公告 Tab 内容**

找到渲染 `CategoryManager` 和下载管理区域的父容器，在其上方添加 Tab 导航：

```svelte
<div class="admin-tabs">
	<button
		class="tab-btn"
		class:active={adminTab === 'downloads'}
		onclick={() => (adminTab = 'downloads')}
		type="button"
	>
		下载管理
	</button>
	<button
		class="tab-btn"
		class:active={adminTab === 'categories'}
		onclick={() => (adminTab = 'categories')}
		type="button"
	>
		分类管理
	</button>
	<button
		class="tab-btn"
		class:active={adminTab === 'announcements'}
		onclick={() => (adminTab = 'announcements')}
		type="button"
	>
		公告管理
	</button>
</div>
```

将下载管理相关的 JSX 包裹在 `{#if adminTab === 'downloads'}` 内，CategoryManager 包裹在 `{#if adminTab === 'categories'}` 内，并新增：

```svelte
{#if adminTab === 'announcements'}
	<AnnouncementForm token={localStorage.getItem('admin_token') ?? ''} />
{/if}
```

在 `<style>` 中追加：

```css
.admin-tabs {
	display: flex;
	gap: 0.5rem;
	margin-bottom: 1.5rem;
	border-bottom: 2px solid rgba(107, 76, 154, 0.15);
	padding-bottom: 0.5rem;
}

.tab-btn {
	padding: 0.5rem 1rem;
	border: none;
	background: transparent;
	border-radius: 12px 12px 0 0;
	font-size: 0.9rem;
	color: #888;
	cursor: pointer;
	transition: all 0.2s;
}

.tab-btn.active {
	background: rgba(107, 76, 154, 0.1);
	color: #6b4c9a;
	font-weight: 600;
}
```

**Step 5: 运行类型检查**

```bash
npm run check
```

预期：无报错。

**Step 6: 本地预览验证**

```bash
npm run dev
```

访问 `http://localhost:5173/admin`，登录后确认：

- 顶部出现三个 Tab：下载管理 / 分类管理 / 公告管理
- 点击「公告管理」Tab 显示公告表单和列表
- 可创建、编辑、删除、切换显示/置顶

**Step 7: 提交**

```bash
git add src/routes/admin/+page.svelte
git commit -m "feat: 在管理后台添加公告管理 Tab"
```

---

### Task 9: 最终集成验证

**Step 1: 完整类型检查**

```bash
npm run check
```

预期：无任何报错。

**Step 2: Lint 检查**

```bash
npm run lint
```

预期：无报错（若有格式问题先运行 `npm run format`）。

**Step 3: 端到端功能验证**

```bash
npm run dev
```

验证清单：

- [ ] `/download` 页面：公告卡片出现在下载列表上方，示例公告正确渲染 Markdown
- [ ] `/admin` 页面：登录后「公告管理」Tab 可见
- [ ] 新增公告：填写标题+Markdown内容，点击「发布公告」，列表刷新
- [ ] 编辑公告：点击「编辑」，表单填充，修改后保存
- [ ] 切换显示：点击「隐藏」/「显示」，下载页对应公告出现/消失
- [ ] 置顶：置顶公告显示 📌 并排在最前
- [ ] 删除公告：确认后删除，列表更新

**Step 4: 构建验证**

```bash
npm run build
```

预期：构建成功，无 TypeScript 错误。

**Step 5: 最终提交（如有未提交变更）**

```bash
git add -A
git commit -m "feat: 完成公告系统集成验证"
```
