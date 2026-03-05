# 公告系统设计文档

**日期：** 2026-03-05
**状态：** 已批准

## 概述

为 playdota2win 下载站添加公告/通知系统。管理员可在后台发布 Markdown 格式的公告，公告以卡片形式展示在公开下载页和认证后的下载页面，下载列表上方。

## 需求

- 支持多条公告同时展示
- 公告支持 Markdown 格式（复用现有 `src/lib/utils/markdown.ts`）
- 公告可手动切换显示/隐藏（无过期时间机制）
- 支持置顶，置顶公告排在前面
- 在公开页和认证后下载页均可见
- 管理员可在后台进行增删改查

## 数据结构

KV Key：`announcements`，存储 `AnnouncementList`。

```ts
interface Announcement {
  id: string;        // nanoid 生成
  title: string;     // 公告标题
  content: string;   // Markdown 正文
  visible: boolean;  // 是否显示（false 则对用户隐藏）
  pinned: boolean;   // 是否置顶
  createdAt: string; // ISO 时间戳
  updatedAt: string;
}

interface AnnouncementList {
  items: Announcement[];
  lastUpdated: string;
}
```

**排序规则：** 置顶公告优先，其次按 `createdAt` 降序。

## API 路由

### 公开接口（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/announcements` | 返回 `visible: true` 的公告列表（已排序） |

### 管理接口（需 Admin JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/announcements` | 获取全部公告（含隐藏） |
| POST | `/api/admin/announcements` | 创建公告 |
| PUT | `/api/admin/announcements` | 更新公告（body 含 id） |
| DELETE | `/api/admin/announcements?id=xxx` | 删除公告 |

复用现有 `requireAdminAuth()` 鉴权，结构与 `/api/admin/categories` 一致。

## 前端组件

### 新增组件

- **`AnnouncementCard.svelte`** — 单条公告卡片，渲染 Markdown 正文，置顶公告显示 📌 标记
- **`AnnouncementList.svelte`** — 公告列表容器，在 `download/+page.svelte` 下载卡片上方渲染
- **`AnnouncementForm.svelte`** — 管理后台新增/编辑表单（标题、正文、visible、pinned）

### 现有文件改动

- **`src/lib/types.ts`** — 新增 `Announcement`、`AnnouncementList` 类型
- **`src/routes/download/+page.svelte`** — 在下载列表前插入 `AnnouncementList`
- **`src/routes/admin/+page.svelte`** — 新增「公告管理」Tab，嵌入公告的增删改查 UI
- **`src/routes/api/announcements/+server.ts`** — 公开 GET 接口
- **`src/routes/api/admin/announcements/+server.ts`** — 管理 CRUD 接口

### 样式

沿用项目 anime-cute 风格（圆角 20px、渐变背景、0.3s 过渡动画），公告卡片采用淡黄/淡橙色调（`#FFFBF0` → `#FFF0E0`）与下载卡片的紫蓝色调区分。

## 文件结构

```
src/
├── routes/
│   ├── api/
│   │   ├── announcements/
│   │   │   └── +server.ts          # 公开 GET
│   │   └── admin/
│   │       └── announcements/
│   │           └── +server.ts      # 管理 CRUD
│   └── download/+page.svelte       # 插入 AnnouncementList
├── lib/
│   ├── types.ts                    # 新增类型
│   └── components/
│       ├── AnnouncementCard.svelte
│       ├── AnnouncementList.svelte
│       └── AnnouncementForm.svelte
```
