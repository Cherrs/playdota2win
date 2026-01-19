# Copilot instructions

## 项目概览

- 这是一个 SvelteKit + Cloudflare Workers 应用，适配器为 `@sveltejs/adapter-cloudflare`（见 `svelte.config.js`）。构建产物入口在 `.svelte-kit/cloudflare/_worker.js`，由 Wrangler 部署。
- 路由位于 `src/routes`，根布局 `src/routes/+layout.svelte` 使用 Svelte 5 的 `$props()` 与 `{@render children()}` 渲染方式。
- 共享资源通过 `$lib` 别名导入，位置在 `src/lib`（例如 `src/lib/assets/favicon.svg`）。

## 项目结构

```
src/
├── routes/
│   ├── +layout.svelte      # 根布局（Svelte 5 语法）
│   ├── +page.svelte        # 主页（引用 download 组件）
│   ├── download/
│   │   └── +page.svelte    # 下载页面（二次元可爱风格）
│   └── api/
│       └── gettime/
│           └── +server.ts  # API 接口示例
├── lib/
│   ├── index.ts            # 共享模块导出
│   └── assets/             # 静态资源
├── app.html                # HTML 模板
├── app.d.ts                # 全局类型定义
└── worker-configuration.d.ts  # Cloudflare Worker 类型（自动生成）
```

## 关键工作流

| 命令                 | 说明                                          |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | 启动 Vite 开发服务器                          |
| `npm run build`      | 构建生产版本                                  |
| `npm run preview`    | 本地预览 Workers 环境（build + wrangler dev） |
| `npm run deploy`     | 部署到 Cloudflare Workers                     |
| `npm run check`      | TypeScript + Svelte 类型检查                  |
| `npm run lint`       | ESLint + Prettier 检查                        |
| `npm run format`     | Prettier 格式化代码                           |
| `npm run cf-typegen` | 生成 Cloudflare Worker 类型定义               |

## 约定与模式

### Svelte 5 语法

- 使用 `$state()` 声明响应式状态
- 使用 `$props()` 接收组件属性
- 使用 `{@render children()}` 渲染插槽内容
- 事件处理使用 `onclick={handler}` 而非 `on:click={handler}`

### API 路由

- 后端接口放在 `src/routes/**/+server.ts`
- 使用 `@sveltejs/kit` 导入 `json`、`RequestHandler` 等
- 示例：`src/routes/api/gettime/+server.ts`

### 样式约定

- 组件内使用 `<style>` 标签，默认 scoped
- 全局样式使用 `:global()` 选择器
- 避免使用 `inset` 等部分浏览器不支持的 CSS 简写，改用 `top/right/bottom/left`

### Cloudflare 配置

- 配置文件：`wrangler.jsonc`
- 包含 `assets` 绑定（`ASSETS`）、`compatibility_date` 和 `nodejs_als` 标志
- 部署/预览时以此为准

## 集成点

- **Cloudflare Workers**：运行时由 Wrangler 管理（本地 `wrangler dev`、线上 `wrangler deploy`）
- **静态资源**：Worker 资产目录为 `.svelte-kit/cloudflare`，通过 Wrangler 的 `assets` 绑定提供
- **Vite**：配置仅启用 `@sveltejs/kit/vite` 插件，如需新增插件请保持最小化修改

## 技术栈版本

- Svelte 5.x
- SvelteKit 2.x
- Vite 7.x
- TypeScript 5.x
- Wrangler 4.x

## UI/UX 设计规范

### 整体风格

- **二次元可爱风格**：简洁、温柔、有活力
- **配色方案**：粉紫色渐变（`#FFF5F7` → `#F0E6FF` → `#E6F0FF`）
- **主色调**：紫色系 `#6B4C9A`（标题）、`#8B7BA8`（副标题）、`#FF6B9D`（强调）

### 字体

- **标题字体**：Fredoka（圆润可爱）
- **正文字体**：Nunito（清晰易读）
- **中文回退**：PingFang SC、Microsoft YaHei
- **Google Fonts 导入**：
  ```html
  <link
  	href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@300;400;500;600;700&display=swap"
  	rel="stylesheet"
  />
  ```

### 动画效果

- **漂浮动画**：星星、云朵等装饰元素使用 `float` 和 `drift` 动画
- **悬停反馈**：按钮上浮 + 阴影加深（`translateY(-3px) scale(1.02)`）
- **弹跳效果**：吉祥物悬停时触发 `bounce` 动画
- **过渡时长**：统一使用 `0.3s ease`

### 组件设计

#### 下载按钮

- 渐变背景 + 圆角 20px
- 光泽滑过动画（`::before` 伪元素）
- Windows：紫色渐变（`#667eea` → `#764ba2`）
- macOS：绿色渐变（`#11998e` → `#38ef7d`）

#### 特性卡片

- 半透明白色背景（`rgba(255, 255, 255, 0.8)`）
- 毛玻璃效果（`backdrop-filter: blur(10px)`）
- 圆角 20px
- 悬停上浮 5px

#### 吉祥物

- SVG 绘制的猫耳角色
- 粉色身体 + 红晕 + 大眼睛
- 悬停显示闪烁星星（✨💫）

### 响应式设计

- 移动端（< 600px）：
  - 标题缩小至 2rem
  - 特性卡片改为单列横向布局
  - 图标与文字水平排列

### CSS 注意事项

- 避免使用 `inset` 简写，改用 `top/right/bottom/left`
- 使用 `cursor: pointer` 于所有可点击元素
- 悬停状态使用 `transform` 而非改变尺寸属性
