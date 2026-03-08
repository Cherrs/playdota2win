# Mumble 自动连语音与本地静音状态设计

## 背景

当前 `MumbleWidget` 会在页面加载时自动建立文字/WebSocket 连接，但语音仍需要用户手动点击“启用语音”。同时，`createMumbleClient` 当前会在收到服务端 `user_state` 后，用服务端回调更新当前用户的 `muted` / `deafened`，导致“麦克风静音”和“仅听文字”按钮依赖 WS 回写，而不是由前端内置状态机主导。

## 目标

1. 页面打开后自动进入语音连接流程。
2. 首次进入页面时默认麦克风静音，并提供醒目的“当前未开麦”提示。
3. “麦克风静音”和“仅听文字”由客户端本地状态机驱动，UI 不依赖 WS `user_state` 回写才能更新。
4. 断线重连后保留本地的静音/仅听文字选择，并在重连完成后自动重新应用。
5. 刷新页面后恢复默认状态：自动连语音、默认静音、非仅听文字。

## 非目标

- 不把静音/仅听文字状态持久化到 `localStorage`。
- 不重做整个 Mumble 连接架构。
- 不改变其他用户状态显示逻辑。

## 方案概览

在 `createMumbleClient` 内引入一层“本地语音意图状态”，把当前页面对语音的主观意图保存在客户端内部，而不是把服务端对当前用户的 `user_state` 当作按钮状态来源。

建议新增或收敛的本地状态含义如下：

- `voiceRequested`: 当前会话是否应自动申请并维护本地语音链路。
- `muted`: 当前页面对本地麦克风的意图状态，首次默认为 `true`。
- `deafened`: 当前页面对远端播放的意图状态，首次默认为 `false`。
- `voiceAvailable` / `voiceConnected` / `voiceFailed`: 继续表示本地采集、WebRTC 建链和失败状态。

其中 `muted` / `deafened` 在当前页面生命周期内由前端直接维护；服务端 `user_state` 对当前用户只提供事实性补充（例如频道、昵称），不再覆盖本地控制按钮状态。

## 架构与职责

### `src/lib/mumble/client.ts`

客户端内部成为语音状态机的单一来源，负责：

1. 初始化默认意图：`voiceRequested=true`、`muted=true`、`deafened=false`。
2. 在 `connect()` / `reconnect()` / `connected` 生命周期里，根据本地意图决定是否申请麦克风、是否创建 `RTCPeerConnection`、以及是否发送 `mute` / `deafen` 指令。
3. 在 `setMuted()` / `setDeafened()` 中先更新本地状态，再同步到音轨、音频元素和 WebSocket。
4. 在断线重连后重新播放本地意图，而不是等待服务端回写修正按钮状态。

### `src/lib/components/MumbleWidget.svelte`

组件保持轻量：

1. 页面加载时创建 interactive client，并直接走自动连语音流程。
2. UI 根据 `clientState` 展示状态文案；新增更醒目的“已连语音，当前未开麦”提醒。
3. 静音/仅听文字按钮只调用 client API，不自己维护第二套语音状态。

## 数据流

### 首次加载

1. `MumbleWidget` 在 `onMount` 获取配置并创建 client。
2. client 初始化为自动请求语音，默认麦克风静音。
3. `connect()` 建立 WebSocket 并发送 `connect`。
4. 收到服务端 `connected` 后，client 自动执行 `ensureVoice()`。
5. `ensureVoice()` 获取本地麦克风后，立即把音轨应用为 `track.enabled = false`，确保用户虽已加入语音链路，但仍处于静音。
6. 成功建立 WebRTC 后，UI 显示“语音已连接，当前未开麦”类提示。

### 用户点击“麦克风静音”

1. `setMuted(next)` 立即更新 store。
2. 立即更新本地音轨 `enabled`。
3. 如果 WS 已连接，则发送 `mute` 指令。
4. 即使服务端后续发来 `user_state`，也不拿它覆盖当前用户的按钮状态。

### 用户点击“仅听文字”

1. `setDeafened(next)` 立即更新 store。
2. 立即更新远端音频元素 `audio.muted`。
3. 如果从 `true -> false`，主动尝试 `resumeAudioPlayback()`。
4. 如果 WS 已连接，则发送 `deafen` 指令。

### 断线重连

1. 连接断开时保留 `muted` / `deafened` / `voiceRequested`。
2. 重连成功后再次按本地意图自动申请麦克风并重建 peer connection。
3. 建链成功后重新发送/应用本地 `mute`、`deafen` 结果，无需等待服务端 `user_state` 才恢复 UI。

## 服务端事件处理约束

- `user_state` 对其他用户保持原有更新逻辑。
- `user_state` 对当前用户仍可更新频道、昵称等事实字段。
- `user_state` 对当前用户的 `mute` / `deaf` / `self_mute` / `self_deaf` 不再作为本地控制按钮的真值来源。

如果后续需要展示“服务端强制静音”等能力，应新增单独的展示字段，而不是重新让控制按钮依赖 WS 回写。

## 错误处理

1. **麦克风权限拒绝**：保留文字连接，显示“无法访问麦克风，可重试授权”的提示，不回退成手动连接模式。
2. **自动播放被拦截**：继续沿用 `playbackBlocked` 和“恢复声音播放”按钮。
3. **WebRTC 建链失败**：保留文字连接和本地意图，允许用户稍后重试语音。
4. **重连失败**：沿用现有重连上限与错误文案，但不清空本地 mute/deafen 意图。

## 验证方案

在 `src/lib/mumble/client.test.ts` 增加以下测试：

1. **自动连语音默认静音**：interactive client 首次连接后会申请本地音频并创建 peer connection，但本地音轨默认 `enabled=false`。
2. **本地静音状态不被 `user_state` 覆盖**：调用 `setMuted()` / `setDeafened()` 后，即使收到针对当前用户的 `user_state`，store 中按钮状态仍保持本地值。
3. **重连保留本地意图**：断线重连后，client 会继续按之前的 `muted` / `deafened` / `voiceRequested` 恢复。

同时使用仓库现有校验命令验证：

- `npm run check`
- `npm run build`

## 影响范围

- `src/lib/mumble/client.ts`
- `src/lib/components/MumbleWidget.svelte`
- `src/lib/mumble/client.test.ts`

## 结论

本方案把“页面自动连语音 + 默认静音 + 本地静音/仅听文字状态机”收敛到 `createMumbleClient` 内部，既满足自动连接的用户体验，也能避免 UI 依赖 WS 回写才能稳定更新。后续实现应优先保证“本地意图先更新、连接生命周期自动重放、服务端事件只做补充”这三条约束。
