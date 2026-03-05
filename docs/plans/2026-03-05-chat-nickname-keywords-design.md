# Chat Nickname Keywords Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace random `游客XXXX` nicknames with Dota 2 themed random nicknames based on admin-configured keywords.

**Architecture:** Admin configures keywords (stored in KV as `chat_nickname_keywords`). Frontend hardcodes Dota 2 modifiers + templates. Client fetches keywords on mount, randomly combines modifier+keyword+template to generate nicknames. Fallback to `游客{number}` if no keywords configured.

**Tech Stack:** SvelteKit, Cloudflare KV, TypeScript, Svelte 5 runes

---

### Task 1: Add NicknameKeywordList type

**Files:**
- Modify: `src/lib/types.ts` (append after `AnnouncementFormData`)

**Step 1: Add the type**

Add at end of `src/lib/types.ts` before the chat types section:

```typescript
/**
 * 聊天昵称关键字列表
 */
export interface NicknameKeywordList {
	keywords: string[];
	lastUpdated: number;
}
```

**Step 2: Verify types**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add NicknameKeywordList type"
```

---

### Task 2: Create nickname generation module

**Files:**
- Create: `src/lib/nickname.ts`

**Step 1: Create the module**

```typescript
/**
 * Dota 2 themed nickname generation.
 * Modifiers are hardcoded; keywords come from admin config via KV.
 */

export const NICKNAME_MODIFIERS: Record<string, string[]> = {
	战绩: ['超神', '暴走', '团灭', '送一血', 'MVP', '如鱼得水', '主宰比赛', '无人能挡', '大杀特杀', 'godlike'],
	段位: ['青铜', '传奇', '万古流河', '冠绝一世', '不朽', '先知', '卫士', '统帅'],
	位置: ['带飞', '打野', '辅助', '中单', 'Carry', '游走', '工具人', '混子'],
	风格: ['莽夫', '快乐', '逆风翻盘', '偷塔', '挂机', '速推', '猥琐发育', '敢死队'],
};

type TemplateFunction = (modifier: string, keyword: string) => string;

const NICKNAME_TEMPLATES: TemplateFunction[] = [
	(m, k) => `${m}${k}`,
	(m, k) => `${m}的${k}`,
	(m, k) => `${k}${m}`,
];

function randomItem<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRandomNickname(keywords: string[]): string {
	if (keywords.length === 0) {
		return `游客${Math.floor(Math.random() * 9000 + 1000)}`;
	}
	const keyword = randomItem(keywords);
	const categoryKeys = Object.keys(NICKNAME_MODIFIERS);
	const category = randomItem(categoryKeys);
	const modifier = randomItem(NICKNAME_MODIFIERS[category]);
	const template = randomItem(NICKNAME_TEMPLATES);
	const result = template(modifier, keyword);
	// Enforce max nickname length (24 chars from protocol)
	return result.slice(0, 24);
}
```

**Step 2: Verify types**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/nickname.ts
git commit -m "feat: add Dota 2 themed nickname generation module"
```

---

### Task 3: Create admin API for nickname keywords

**Files:**
- Create: `src/routes/api/admin/chat/nicknames/+server.ts`

**Step 1: Create the endpoint**

Follow the pattern from `src/routes/api/admin/chat/+server.ts` and `src/routes/api/categories/+server.ts`.

```typescript
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdminAuth } from '$lib/admin-auth';
import type { ApiResponse, NicknameKeywordList } from '$lib/types';

const KV_KEY = 'chat_nickname_keywords';

export const GET: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed) return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });

	const kv = platform?.env.APP_KV;
	if (!kv) return json({ success: true, data: { keywords: [], lastUpdated: Date.now() } } satisfies ApiResponse<NicknameKeywordList>);

	const stored = await kv.get<NicknameKeywordList>(KV_KEY, 'json');
	return json({ success: true, data: stored ?? { keywords: [], lastUpdated: Date.now() } } satisfies ApiResponse<NicknameKeywordList>);
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed) return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });

	const kv = platform?.env.APP_KV;
	if (!kv) return json({ success: false, error: 'KV 不可用' } satisfies ApiResponse, { status: 500 });

	const body = await request.json() as { keywords?: string[] };
	if (!Array.isArray(body.keywords)) {
		return json({ success: false, error: 'keywords 必须是字符串数组' } satisfies ApiResponse, { status: 400 });
	}

	const keywords = body.keywords
		.map((k: string) => (typeof k === 'string' ? k.trim() : ''))
		.filter((k: string) => k.length > 0);

	const data: NicknameKeywordList = { keywords, lastUpdated: Date.now() };
	await kv.put(KV_KEY, JSON.stringify(data));
	return json({ success: true, data } satisfies ApiResponse<NicknameKeywordList>);
};
```

**Step 2: Verify types**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/routes/api/admin/chat/nicknames/+server.ts
git commit -m "feat: add admin API for nickname keywords CRUD"
```

---

### Task 4: Create public API for nickname keywords

**Files:**
- Create: `src/routes/api/chat/nicknames/+server.ts`

**Step 1: Create the public endpoint**

Follow the pattern from `src/routes/api/categories/+server.ts`.

```typescript
import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, NicknameKeywordList } from '$lib/types';

const KV_KEY = 'chat_nickname_keywords';

export const GET: RequestHandler = async ({ platform }) => {
	const kv = platform?.env.APP_KV;
	if (!kv) {
		return json({ success: true, data: { keywords: [], lastUpdated: Date.now() } } satisfies ApiResponse<NicknameKeywordList>);
	}

	const stored = await kv.get<NicknameKeywordList>(KV_KEY, 'json');
	return json({ success: true, data: stored ?? { keywords: [], lastUpdated: Date.now() } } satisfies ApiResponse<NicknameKeywordList>);
};
```

**Step 2: Verify types**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/routes/api/chat/nicknames/+server.ts
git commit -m "feat: add public API for nickname keywords"
```

---

### Task 5: Add keyword config UI to ChatManager

**Files:**
- Modify: `src/lib/components/ChatManager.svelte`

**Step 1: Add keyword management section**

Add imports for `ApiResponse` and `NicknameKeywordList` (already has `ApiResponse`). Add state variables and functions for keyword management. Insert a keyword config section above the `💬 聊天记录管理` header.

Key changes:
1. Add `NicknameKeywordList` to type import
2. Add state: `keywords`, `newKeyword`, `keywordsLoading`, `keywordsSaving`
3. Add functions: `loadKeywords()`, `saveKeywords()`, `addKeyword()`, `removeKeyword(index)`
4. Add `$effect` to call `loadKeywords()` on mount
5. Add HTML section with tag-style keyword display + input + add/save buttons
6. Add scoped CSS for the keyword tags and config section

**Step 2: Verify types**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/components/ChatManager.svelte
git commit -m "feat: add nickname keyword config UI to ChatManager"
```

---

### Task 6: Update ChatWidget nickname generation

**Files:**
- Modify: `src/lib/components/ChatWidget.svelte`

**Step 1: Modify nickname generation**

Key changes:
1. Import `generateRandomNickname` from `$lib/nickname`
2. Remove old `generateGuestNickname()` function
3. Add state for `nicknameKeywords: string[]`
4. Add `fetchNicknameKeywords()` that calls `GET /api/chat/nicknames`
5. In `onMount`: fetch keywords first, then generate nickname if no saved one (using `generateRandomNickname(keywords)`)
6. Add `randomizeNickname()` function that generates new random nickname + saves to localStorage + sends rename event
7. In the `nickname-row` section (non-editing state), add a 🎲 button next to the 修改 button

**Step 2: Verify types**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/components/ChatWidget.svelte
git commit -m "feat: use Dota 2 themed random nicknames in chat widget"
```

---

### Task 7: Final verification

**Step 1: Full type check**

Run: `npm run check`
Expected: No errors

**Step 2: Full lint**

Run: `npm run lint`
Expected: No errors (or only pre-existing ones)

**Step 3: Build test**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit all changes**

```bash
git add -A
git commit -m "feat: complete Dota 2 themed nickname system with admin keyword config"
```
