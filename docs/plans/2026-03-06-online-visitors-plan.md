# Online Visitors Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display real-time online visitors (IP + browser) in the admin panel by extending the ChatRoom Durable Object.

**Architecture:** Page visitors silently connect to the existing `/api/chat/ws` WebSocket on page load. The ChatRoom DO captures IP/User-Agent from each WebSocket handshake request and stores them in session state. A new admin API endpoint proxies the online visitor list from the DO to the admin panel, which polls every 5 seconds.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Cloudflare Durable Objects, TypeScript

---

### Task 1: Add `OnlineVisitor` type

**Files:**
- Modify: `src/lib/types.ts` (append at end of file)

**Step 1: Add the type**

Append this block to the end of `src/lib/types.ts`:

```ts
/**
 * 在线访客信息（用于管理后台展示）
 */
export interface OnlineVisitor {
	ip: string;
	userAgent: string;
	connectedAt: number;
	/** 若访客未设置昵称则为 '游客' */
	nickname: string;
}
```

**Step 2: Verify types**

```bash
npm run check
```

Expected: no new errors.

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add OnlineVisitor type"
```

---

### Task 2: Extend ChatRoom DO to capture and expose visitor info

**Files:**
- Modify: `src/lib/server/chat/chat-room.ts`

**Step 1: Extend `SessionState` interface**

Replace:
```ts
interface SessionState {
	nickname: string;
	sentTimestamps: number[];
}
```
With:
```ts
interface SessionState {
	nickname: string;
	sentTimestamps: number[];
	ip: string;
	userAgent: string;
	connectedAt: number;
}
```

**Step 2: Extract IP/UA helper at top of file (after imports)**

Add this helper function after the existing `SOCKET_OPEN` constant:

```ts
function extractClientInfo(request: Request): { ip: string; userAgent: string } {
	const ip =
		request.headers.get('CF-Connecting-IP') ||
		request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
		'unknown';
	const userAgent = request.headers.get('User-Agent') || 'unknown';
	return { ip, userAgent };
}
```

**Step 3: Pass IP/UA when creating a session in `fetch()`**

Find this block inside `fetch()`:
```ts
server.accept();
this.sessions.set(server, {
    nickname: DEFAULT_CHAT_NICKNAME,
    sentTimestamps: []
});
```

Replace it with:
```ts
server.accept();
const { ip, userAgent } = extractClientInfo(request);
this.sessions.set(server, {
    nickname: DEFAULT_CHAT_NICKNAME,
    sentTimestamps: [],
    ip,
    userAgent,
    connectedAt: Date.now()
});
```

**Step 4: Add admin `/admin/online` HTTP handler**

In the `fetch()` method, add this route **before** the existing `if (request.method !== 'GET')` check:

```ts
// Admin API: list online visitors
if (url.pathname === '/admin/online' && request.method === 'GET') {
    return this.handleAdminOnline();
}
```

Add the handler method to the class (after `handleAdminClearAll()`):

```ts
private handleAdminOnline(): Response {
    const visitors: Array<{
        ip: string;
        userAgent: string;
        connectedAt: number;
        nickname: string;
    }> = [];
    for (const session of this.sessions.values()) {
        visitors.push({
            ip: session.ip,
            userAgent: session.userAgent,
            connectedAt: session.connectedAt,
            nickname: session.nickname
        });
    }
    return new Response(JSON.stringify({ visitors, total: visitors.length }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
```

**Step 5: Verify types**

```bash
npm run check
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/lib/server/chat/chat-room.ts
git commit -m "feat: capture IP/UA in ChatRoom DO, add /admin/online endpoint"
```

---

### Task 3: Add admin API route `/api/admin/online`

**Files:**
- Create: `src/routes/api/admin/online/+server.ts`

**Step 1: Create the file**

```ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdminAuth } from '$lib/admin-auth';

const CHAT_ROOM_NAME = 'global-chat-room';

function getChatRoom(platform: App.Platform | undefined) {
	const ns = platform?.env.CHAT_ROOM;
	if (!ns) return null;
	const id = ns.idFromName(CHAT_ROOM_NAME);
	return ns.get(id);
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed) return json({ success: false, error: '未授权' }, { status: 401 });

	const room = getChatRoom(platform);
	if (!room) return json({ success: false, error: '聊天服务不可用' }, { status: 500 });

	const res = await room.fetch('http://do/admin/online');
	if (!res.ok) return json({ success: false, error: '获取在线用户失败' }, { status: 502 });

	const data = await res.json();
	return json({ success: true, data });
};
```

**Step 2: Verify types**

```bash
npm run check
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/routes/api/admin/online/+server.ts
git commit -m "feat: add /api/admin/online endpoint"
```

---

### Task 4: Silent visitor WebSocket on download page

**Files:**
- Modify: `src/routes/download/+page.svelte`

**Step 1: Add visitor presence connection**

In the `<script lang="ts">` block, add this import at the top:
```ts
import { onDestroy } from 'svelte';
```

Then add a visitor WebSocket connection block after the existing state declarations (after line with `let loading = $state(true);`):

```ts
// 访客在线状态（静默 WebSocket，仅用于管理端统计在线人数）
let visitorWs: WebSocket | null = null;

function connectVisitorPresence() {
    if (typeof window === 'undefined') return;
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        visitorWs = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws`);
        visitorWs.addEventListener('error', () => {
            // silent – visitor presence is best-effort
        });
    } catch {
        // silent
    }
}

onDestroy(() => {
    visitorWs?.close();
});
```

**Step 2: Call `connectVisitorPresence()` inside the existing `$effect` at the bottom of the script block**

Find the existing `$effect` block:
```ts
$effect(() => {
    loadDownloads();
    ...
```

If there's no `$effect`, add one. If there already is one (check the bottom of the script), append inside it. Or simply add a new `$effect`:

```ts
$effect(() => {
    connectVisitorPresence();
});
```

> Note: Check `src/routes/download/+page.svelte` for any existing `$effect` at the bottom first. Append the `connectVisitorPresence()` call there, or add a new `$effect` block.

**Step 3: Verify types**

```bash
npm run check
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/routes/download/+page.svelte
git commit -m "feat: connect visitor presence WebSocket on download page"
```

---

### Task 5: Create `OnlineVisitors.svelte` component

**Files:**
- Create: `src/lib/components/OnlineVisitors.svelte`

**Step 1: Create the component**

```svelte
<script lang="ts">
	import type { OnlineVisitor, ApiResponse } from '$lib/types';
	import { onDestroy } from 'svelte';

	interface Props {
		token: string;
	}

	let { token }: Props = $props();

	let visitors = $state<OnlineVisitor[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let error = $state('');
	let intervalId: ReturnType<typeof setInterval> | null = null;

	function authHeaders() {
		return { Authorization: `Bearer ${token}` };
	}

	async function loadVisitors() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/admin/online', { headers: authHeaders() });
			const data: ApiResponse<{ visitors: OnlineVisitor[]; total: number }> = await res.json();
			if (data.success && data.data) {
				visitors = data.data.visitors;
				total = data.data.total;
			} else {
				error = data.error || '加载失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			loading = false;
		}
	}

	/** 将 User-Agent 字符串简化为可读的浏览器/设备信息 */
	function parseUA(ua: string): string {
		if (ua === 'unknown') return '未知';
		if (/iPhone|iPad|iPod/i.test(ua)) return '📱 iOS';
		if (/Android/i.test(ua)) return '📱 Android';
		if (/Edg\//i.test(ua)) return '🌐 Edge';
		if (/Chrome\//i.test(ua)) return '🌐 Chrome';
		if (/Firefox\//i.test(ua)) return '🦊 Firefox';
		if (/Safari\//i.test(ua)) return '🍎 Safari';
		if (/curl|bot|spider/i.test(ua)) return '🤖 Bot';
		return '🌐 浏览器';
	}

	function formatDuration(connectedAt: number): string {
		const seconds = Math.floor((Date.now() - connectedAt) / 1000);
		if (seconds < 60) return `${seconds}秒`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}分钟`;
		return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
	}

	$effect(() => {
		loadVisitors();
		intervalId = setInterval(loadVisitors, 5000);
		return () => {
			if (intervalId !== null) clearInterval(intervalId);
		};
	});

	onDestroy(() => {
		if (intervalId !== null) clearInterval(intervalId);
	});
</script>

<div class="online-visitors">
	<div class="section-header">
		<h2>👥 在线用户</h2>
		<span class="online-badge">{total} 人在线</span>
		{#if loading}
			<span class="refreshing">刷新中…</span>
		{/if}
	</div>

	{#if error}
		<div class="error-msg">❌ {error}</div>
	{/if}

	{#if visitors.length === 0 && !loading && !error}
		<div class="empty-msg">🌸 暂无在线用户</div>
	{:else}
		<div class="table-wrap">
			<table class="visitors-table">
				<thead>
					<tr>
						<th>#</th>
						<th>IP 地址</th>
						<th>浏览器</th>
						<th>昵称</th>
						<th>在线时长</th>
					</tr>
				</thead>
				<tbody>
					{#each visitors as visitor, i}
						<tr>
							<td class="num">{i + 1}</td>
							<td class="ip">{visitor.ip}</td>
							<td class="browser">{parseUA(visitor.userAgent)}</td>
							<td class="nickname">{visitor.nickname}</td>
							<td class="duration">{formatDuration(visitor.connectedAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.online-visitors {
		max-width: 1000px;
		margin: 0 auto;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		font-size: 1.5rem;
		color: #6b4c9a;
	}

	.online-badge {
		background: linear-gradient(135deg, #ff6b9d, #6b4c9a);
		color: white;
		padding: 0.3rem 0.8rem;
		border-radius: 20px;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.refreshing {
		font-size: 0.8rem;
		color: #aaa;
		font-style: italic;
	}

	.error-msg {
		background: rgba(255, 107, 107, 0.15);
		color: #c8556b;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		margin-bottom: 1rem;
	}

	.empty-msg {
		text-align: center;
		color: #aaa;
		padding: 3rem;
		font-size: 1.1rem;
	}

	.table-wrap {
		overflow-x: auto;
		border-radius: 16px;
		box-shadow: 0 4px 20px rgba(107, 76, 154, 0.1);
	}

	.visitors-table {
		width: 100%;
		border-collapse: collapse;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(10px);
	}

	.visitors-table thead tr {
		background: linear-gradient(135deg, rgba(107, 76, 154, 0.08), rgba(255, 107, 157, 0.08));
	}

	.visitors-table th {
		padding: 0.8rem 1rem;
		text-align: left;
		font-size: 0.85rem;
		color: #6b4c9a;
		font-weight: 600;
		border-bottom: 1px solid rgba(107, 76, 154, 0.1);
	}

	.visitors-table td {
		padding: 0.75rem 1rem;
		font-size: 0.9rem;
		color: #444;
		border-bottom: 1px solid rgba(107, 76, 154, 0.06);
	}

	.visitors-table tbody tr:hover {
		background: rgba(107, 76, 154, 0.04);
	}

	.visitors-table tbody tr:last-child td {
		border-bottom: none;
	}

	.num {
		color: #aaa;
		font-size: 0.8rem;
		width: 2rem;
	}

	.ip {
		font-family: monospace;
		font-size: 0.85rem;
		color: #6b4c9a;
	}

	.browser {
		min-width: 100px;
	}

	.nickname {
		color: #ff6b9d;
		font-weight: 500;
	}

	.duration {
		color: #888;
		font-size: 0.85rem;
	}
</style>
```

**Step 2: Verify types**

```bash
npm run check
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/components/OnlineVisitors.svelte
git commit -m "feat: add OnlineVisitors component"
```

---

### Task 6: Add "在线用户" tab to admin panel

**Files:**
- Modify: `src/routes/admin/+page.svelte`

**Step 1: Import the component**

Add to the imports at the top of the `<script>` block:
```ts
import OnlineVisitors from '$lib/components/OnlineVisitors.svelte';
```

**Step 2: Extend the tab union type**

Find:
```ts
let adminTab = $state<'downloads' | 'categories' | 'announcements' | 'chat'>('downloads');
```

Replace with:
```ts
let adminTab = $state<'downloads' | 'categories' | 'announcements' | 'chat' | 'visitors'>('downloads');
```

**Step 3: Add tab button**

In the `.admin-tabs` section, after the existing "聊天管理" button, add:
```svelte
<button
    class="tab-btn"
    class:active={adminTab === 'visitors'}
    onclick={() => (adminTab = 'visitors')}
    type="button"
>
    👥 在线用户
</button>
```

**Step 4: Add tab content panel**

After the `{#if adminTab === 'chat'}` block (but before the closing `{/if}`), add:
```svelte
{#if adminTab === 'visitors'}
    <OnlineVisitors token={adminToken} />
{/if}
```

**Step 5: Verify types and lint**

```bash
npm run check && npm run lint
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/routes/admin/+page.svelte
git commit -m "feat: add online visitors tab to admin panel"
```

---

### Task 7: Build and verify

**Step 1: Run full build**

```bash
npm run build
```

Expected: build succeeds with no TypeScript or Svelte errors.

**Step 2: Final commit if any generated files changed**

```bash
git status
# If clean, nothing to do. If svelte-kit sync changed .svelte-kit files, that's fine.
```

---

## Summary of files changed

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `OnlineVisitor` interface |
| `src/lib/server/chat/chat-room.ts` | Extend `SessionState`, capture IP/UA, add `/admin/online` handler |
| `src/routes/api/admin/online/+server.ts` | New — admin API proxy to DO |
| `src/routes/download/+page.svelte` | Add silent visitor presence WebSocket |
| `src/lib/components/OnlineVisitors.svelte` | New — admin component |
| `src/routes/admin/+page.svelte` | Add "在线用户" tab |
