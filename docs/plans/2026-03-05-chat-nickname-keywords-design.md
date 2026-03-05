# Chat Nickname Keywords Design

## Problem

当前聊天昵称为 `游客` + 随机4位数字（如"游客3847"），缺乏个性和趣味性。

## Approach

管理员在后台配置关键字（如"大飞"），前端硬编码 Dota 2 主题修饰词，客户端拉取关键字后本地随机组合生成昵称（如"超神的大飞"、"青铜大飞"）。

## Design

### Data Storage

**KV key: `chat_nickname_keywords`**

```typescript
interface NicknameKeywordList {
  keywords: string[];      // ["大飞", "小明", "老王"]
  lastUpdated: number;
}
```

### Dota 2 Modifiers (Hardcoded in Frontend)

```typescript
const NICKNAME_MODIFIERS = {
  战绩: ['超神', '暴走', '团灭', '送一血', 'MVP', '如鱼得水', '主宰比赛', '无人能挡', '大杀特杀'],
  段位: ['青铜', '传奇', '万古流河', '冠绝一世', '不朽', '先知'],
  位置: ['带飞', '打野', '辅助', '中单', 'Carry', '游走', '工具人'],
  风格: ['莽夫', '快乐', '逆风翻盘', '偷塔', '挂机', '速推', '猥琐发育'],
};

const NICKNAME_TEMPLATES = [
  '{modifier}{keyword}',
  '{modifier}的{keyword}',
  '{keyword}{modifier}',
];
```

### API Endpoints

**Admin (requires auth):**
- `GET /api/admin/chat/nicknames` — 获取关键字列表
- `PUT /api/admin/chat/nicknames` — 更新关键字列表

**Public:**
- `GET /api/chat/nicknames` — 客户端获取关键字列表

### Admin UI

在 `ChatManager.svelte` 顶部添加「昵称关键字」配置区：
- 文本输入框 + "添加"按钮
- 关键字以 tag 形式展示，可点击 × 删除
- "保存"按钮提交

### Frontend Nickname Generation

1. `ChatWidget.svelte` 加载时请求 `GET /api/chat/nicknames`
2. `generateGuestNickname()` 改为从关键字+修饰词+模板随机组合
3. 结果存入 `localStorage`，后续访问不再重新生成
4. 昵称输入框旁增加 🎲 按钮，点击重新随机生成

### Fallback

若管理员未配置关键字或 API 失败，回退到现有的 `游客{随机4位数}` 模式。

### Files to Modify

1. `src/lib/types.ts` — 新增 `NicknameKeywordList` 类型
2. `src/lib/nickname.ts` — 新建，包含修饰词、模板和生成逻辑
3. `src/routes/api/admin/chat/nicknames/+server.ts` — Admin CRUD API
4. `src/routes/api/chat/nicknames/+server.ts` — Public read API
5. `src/lib/components/ChatManager.svelte` — 添加关键字管理 UI
6. `src/lib/components/ChatWidget.svelte` — 修改昵称生成 + 添加随机按钮
