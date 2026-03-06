<script lang="ts">
	import { onMount } from 'svelte';
	import type { ChatMessage, ChatServerEvent, ApiResponse, NicknameKeywordList } from '$lib/types';
	import { generateRandomNickname } from '$lib/nickname';

	const NICKNAME_STORAGE_KEY = 'playdota2win_chat_nickname';
	const MAX_MESSAGE_LENGTH = 500;
	const MAX_NICKNAME_LENGTH = 24;

	let expanded = $state(false);
	let connected = $state(false);
	let reconnecting = $state(false);
	let onlineCount = $state(0);
	let messages = $state<ChatMessage[]>([]);
	let pendingMessage = $state('');
	let nickname = $state('');
	let nicknameDraft = $state('');
	let editingNickname = $state(false);
	let statusMessage = $state('未连接');
	let errorMessage = $state('');
	let messagesRef = $state<HTMLDivElement | null>(null);
	let nicknameKeywords = $state<string[]>([]);

	// Notification state
	let unreadCount = $state(0);
	let animateToggle = $state(false);
	let newMsgPreview = $state<{ nickname: string; text: string } | null>(null);
	let showScrollToBottom = $state(false);
	let newMsgIds = $state<Set<string>>(new Set());

	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectAttempts = 0;
	let shouldReconnect = true;
	let previewTimer: ReturnType<typeof setTimeout> | null = null;
	let animateTimer: ReturnType<typeof setTimeout> | null = null;

	async function fetchNicknameKeywords(): Promise<string[]> {
		try {
			const res = await fetch('/api/chat/nicknames');
			const data: ApiResponse<NicknameKeywordList> = await res.json();
			if (data.success && data.data) {
				return data.data.keywords;
			}
		} catch {
			// Fallback to empty keywords (will generate 游客+number)
		}
		return [];
	}

	function normalizeClientInput(value: string): string {
		return value.replace(/\s+/g, ' ').trim();
	}

	function getSocketUrl(): string {
		const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
		return `${protocol}://${window.location.host}/api/chat/ws`;
	}

	function parseServerEvent(raw: string): ChatServerEvent | null {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
				return null;
			}
			return parsed as ChatServerEvent;
		} catch (error) {
			console.error('Failed to parse chat server event:', error);
			return null;
		}
	}

	function sendEvent(
		event: { type: 'join' | 'rename'; nickname: string } | { type: 'message'; text: string }
	) {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(JSON.stringify(event));
	}

	function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
		const merged = [...existing, ...incoming].sort((a, b) => a.timestamp - b.timestamp);
		const deduped: ChatMessage[] = [];
		const seen: Record<string, true> = {};
		for (const message of merged) {
			if (seen[message.id]) {
				continue;
			}
			seen[message.id] = true;
			deduped.push(message);
		}
		return deduped;
	}

	function triggerNewMessageNotification(msg: ChatMessage): void {
		// Mark as new for entrance animation
		newMsgIds = new Set([...newMsgIds, msg.id]);
		setTimeout(() => {
			newMsgIds = new Set([...newMsgIds].filter((id) => id !== msg.id));
		}, 800);

		if (!expanded) {
			// Increment unread badge
			unreadCount += 1;

			// Trigger toggle shake
			animateToggle = false;
			if (animateTimer) clearTimeout(animateTimer);
			requestAnimationFrame(() => {
				animateToggle = true;
				animateTimer = setTimeout(() => {
					animateToggle = false;
				}, 600);
			});

			// Show preview toast
			newMsgPreview = { nickname: msg.nickname, text: msg.text };
			if (previewTimer) clearTimeout(previewTimer);
			previewTimer = setTimeout(() => {
				newMsgPreview = null;
			}, 4000);
		} else {
			// In open chat: show scroll-to-bottom pill if user scrolled up
			if (messagesRef) {
				const el = messagesRef;
				const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
				if (!isAtBottom) {
					showScrollToBottom = true;
				}
			}
		}
	}

	function applyServerEvent(event: ChatServerEvent): void {
		switch (event.type) {
			case 'history':
				messages = mergeMessages(messages, event.messages);
				break;
			case 'message': {
				const isNew = !messages.some((m) => m.id === event.message.id);
				messages = mergeMessages(messages, [event.message]);
				if (isNew) {
					triggerNewMessageNotification(event.message);
				}
				break;
			}
			case 'presence':
				onlineCount = event.online;
				break;
			case 'error':
				errorMessage = event.message;
				break;
		}
	}

	function connect(): void {
		if (
			socket &&
			(socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
		) {
			return;
		}

		statusMessage = reconnecting ? '重连中...' : '连接中...';
		const ws = new WebSocket(getSocketUrl());
		socket = ws;

		ws.onopen = () => {
			connected = true;
			reconnecting = false;
			reconnectAttempts = 0;
			statusMessage = '已连接';
			errorMessage = '';
			sendEvent({ type: 'join', nickname });
		};

		ws.onmessage = (event) => {
			if (typeof event.data !== 'string') {
				return;
			}
			const parsed = parseServerEvent(event.data);
			if (!parsed) {
				return;
			}
			applyServerEvent(parsed);
		};

		ws.onerror = () => {
			errorMessage = '连接发生错误，正在尝试恢复';
		};

		ws.onclose = () => {
			connected = false;
			socket = null;
			statusMessage = '连接已断开';
			if (!shouldReconnect) {
				return;
			}
			reconnecting = true;
			const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
			reconnectAttempts += 1;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, delay);
		};
	}

	function startNicknameEdit(): void {
		nicknameDraft = nickname;
		editingNickname = true;
	}

	function saveNickname(): void {
		const normalizedNickname = normalizeClientInput(nicknameDraft).slice(0, MAX_NICKNAME_LENGTH);
		if (!normalizedNickname) {
			errorMessage = '昵称不能为空';
			return;
		}
		nickname = normalizedNickname;
		nicknameDraft = normalizedNickname;
		editingNickname = false;
		errorMessage = '';
		localStorage.setItem(NICKNAME_STORAGE_KEY, normalizedNickname);
		sendEvent({ type: 'rename', nickname: normalizedNickname });
	}

	function cancelNicknameEdit(): void {
		nicknameDraft = nickname;
		editingNickname = false;
	}

	function randomizeNickname(): void {
		const newNickname = generateRandomNickname(nicknameKeywords);
		nickname = newNickname;
		nicknameDraft = newNickname;
		localStorage.setItem(NICKNAME_STORAGE_KEY, newNickname);
		if (connected) {
			sendEvent({ type: 'rename', nickname: newNickname });
		}
	}

	function submitMessage(): void {
		const text = normalizeClientInput(pendingMessage);
		if (!text) {
			return;
		}
		if (text.length > MAX_MESSAGE_LENGTH) {
			errorMessage = `消息不能超过 ${MAX_MESSAGE_LENGTH} 字`;
			return;
		}
		if (!connected) {
			errorMessage = '当前未连接，暂时无法发送';
			return;
		}

		sendEvent({ type: 'message', text });
		pendingMessage = '';
		errorMessage = '';
	}

	function formatTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString('zh-CN', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleMessageScroll(): void {
		if (!messagesRef) return;
		const el = messagesRef;
		const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
		if (isAtBottom) showScrollToBottom = false;
	}

	function scrollToLatest(): void {
		messagesRef?.scrollTo({ top: messagesRef.scrollHeight, behavior: 'smooth' });
		showScrollToBottom = false;
	}

	// Clear unread + preview when chat opens
	$effect(() => {
		if (expanded) {
			unreadCount = 0;
			newMsgPreview = null;
			if (previewTimer) {
				clearTimeout(previewTimer);
				previewTimer = null;
			}
		}
	});

	$effect(() => {
		void messages.length;
		void expanded;
		if (!expanded || !messagesRef) {
			return;
		}
		queueMicrotask(() => {
			if (!showScrollToBottom) {
				messagesRef?.scrollTo({
					top: messagesRef.scrollHeight,
					behavior: 'smooth'
				});
			}
		});
	});

	onMount(() => {
		(async () => {
			nicknameKeywords = await fetchNicknameKeywords();

			const savedNickname = localStorage.getItem(NICKNAME_STORAGE_KEY);
			const normalizedNickname = normalizeClientInput(savedNickname || '').slice(
				0,
				MAX_NICKNAME_LENGTH
			);
			nickname = normalizedNickname || generateRandomNickname(nicknameKeywords);
			nicknameDraft = nickname;
			localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);

			shouldReconnect = true;
			connect();
		})();

		return () => {
			shouldReconnect = false;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			if (previewTimer) {
				clearTimeout(previewTimer);
				previewTimer = null;
			}
			if (animateTimer) {
				clearTimeout(animateTimer);
				animateTimer = null;
			}
			if (socket) {
				socket.close(1000, 'chat widget unmounted');
				socket = null;
			}
		};
	});
</script>

<div class="chat-widget">
	{#if expanded}
		<section class="chat-panel">
			<header class="chat-header">
				<div class="chat-title-wrap">
					<h2 class="chat-title">在线聊天</h2>
					<span class="chat-online">在线 {onlineCount}</span>
				</div>
				<button
					class="icon-btn"
					type="button"
					aria-label="收起聊天窗口"
					onclick={() => (expanded = false)}
				>
					−
				</button>
			</header>

			<div class="nickname-row">
				{#if editingNickname}
					<input
						type="text"
						class="nickname-input"
						maxlength={MAX_NICKNAME_LENGTH}
						bind:value={nicknameDraft}
						onkeydown={(event) => {
							if (event.key === 'Enter') {
								saveNickname();
							}
						}}
					/>
					<button class="small-btn" type="button" onclick={saveNickname}>保存</button>
					<button class="small-btn ghost" type="button" onclick={cancelNicknameEdit}>取消</button>
				{:else}
					<span class="nickname-label">昵称：{nickname}</span>
					<button class="small-btn ghost" type="button" onclick={randomizeNickname} title="随机昵称"
						>🎲</button
					>
					<button class="small-btn ghost" type="button" onclick={startNicknameEdit}>修改</button>
				{/if}
			</div>

			<div class="status-row">
				<span class="status-dot" class:active={connected}></span>
				<span>{reconnecting ? '重连中…' : statusMessage}</span>
			</div>

			{#if errorMessage}
				<p class="error-text">{errorMessage}</p>
			{/if}

			<div class="message-list" bind:this={messagesRef} onscroll={handleMessageScroll}>
				{#if messages.length === 0}
					<p class="empty-text">还没有留言，发一条试试吧～</p>
				{/if}
				{#each messages as message (message.id)}
					<article class="message-item" class:msg-new={newMsgIds.has(message.id)}>
						<div class="message-meta">
							<strong>{message.nickname}</strong>
							<time>{formatTime(message.timestamp)}</time>
						</div>
						<p>{message.text}</p>
					</article>
				{/each}
			</div>

			{#if showScrollToBottom}
				<button class="scroll-to-bottom" type="button" onclick={scrollToLatest} aria-live="polite">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
					新消息
				</button>
			{/if}

			<div class="input-row">
				<input
					type="text"
					class="message-input"
					placeholder="说点什么..."
					maxlength={MAX_MESSAGE_LENGTH}
					bind:value={pendingMessage}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							submitMessage();
						}
					}}
				/>
				<button class="send-btn" type="button" onclick={submitMessage} disabled={!connected}
					>发送</button
				>
			</div>
		</section>
	{:else}
		{#if newMsgPreview}
			<div class="msg-preview" role="status" aria-live="polite">
				<span class="preview-nick">{newMsgPreview.nickname}</span>
				<span class="preview-text">{newMsgPreview.text.slice(0, 48)}{newMsgPreview.text.length > 48 ? '…' : ''}</span>
			</div>
		{/if}
		<button
			class="chat-toggle"
			class:toggle-shake={animateToggle}
			type="button"
			onclick={() => (expanded = true)}
			aria-label="打开聊天窗口"
		>
			<svg class="toggle-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
			</svg>
			<span class="toggle-text">在线聊天</span>
			<span class="toggle-online">在线 {onlineCount}</span>
			{#if unreadCount > 0}
				<span class="unread-badge" class:badge-pop={animateToggle}>{unreadCount > 99 ? '99+' : unreadCount}</span>
			{/if}
		</button>
	{/if}
</div>

<style>
	.chat-widget {
		position: fixed;
		right: 1.2rem;
		bottom: 1.2rem;
		z-index: 30;
	}

	.chat-toggle {
		border: none;
		background: linear-gradient(135deg, #ff9ec4 0%, #c8b2ff 100%);
		color: #2d1b4e;
		padding: 0.8rem 1rem;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 10px 22px rgba(107, 76, 154, 0.28);
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
		position: relative;
	}

	.chat-toggle:hover {
		transform: translateY(-2px);
		box-shadow: 0 14px 28px rgba(107, 76, 154, 0.33);
	}

	.toggle-icon-svg {
		flex-shrink: 0;
	}

	.toggle-online {
		font-size: 0.78rem;
		background: rgba(255, 255, 255, 0.45);
		border-radius: 999px;
		padding: 0.2rem 0.55rem;
	}

	.chat-panel {
		width: min(360px, calc(100vw - 1.2rem));
		max-height: min(560px, calc(100vh - 2.4rem));
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(10px);
		border-radius: 20px;
		box-shadow: 0 20px 40px rgba(107, 76, 154, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.7);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 0.95rem;
		background: linear-gradient(
			135deg,
			rgba(255, 158, 196, 0.35) 0%,
			rgba(200, 178, 255, 0.35) 100%
		);
	}

	.chat-title-wrap {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.chat-title {
		margin: 0;
		font-size: 1rem;
		color: #5a3e87;
	}

	.chat-online {
		font-size: 0.78rem;
		color: #7d5ca8;
		background: rgba(255, 255, 255, 0.5);
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
	}

	.icon-btn {
		border: none;
		background: rgba(255, 255, 255, 0.65);
		width: 28px;
		height: 28px;
		border-radius: 999px;
		cursor: pointer;
		color: #5a3e87;
		font-size: 1rem;
	}

	.nickname-row {
		padding: 0.7rem 0.95rem 0.4rem;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.nickname-label {
		font-size: 0.86rem;
		color: #6b4c9a;
		font-weight: 600;
	}

	.nickname-input {
		flex: 1;
		min-width: 140px;
		padding: 0.4rem 0.55rem;
		border: 2px solid #eadbff;
		border-radius: 10px;
		font-size: 0.85rem;
		outline: none;
	}

	.nickname-input:focus {
		border-color: #c8b2ff;
	}

	.small-btn {
		border: none;
		background: #6b4c9a;
		color: #fff;
		padding: 0.35rem 0.55rem;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.76rem;
	}

	.small-btn.ghost {
		background: rgba(107, 76, 154, 0.14);
		color: #6b4c9a;
	}

	.status-row {
		padding: 0 0.95rem 0.45rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		color: #8c79ab;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ffc857;
	}

	.status-dot.active {
		background: #4caf50;
	}

	.error-text {
		margin: 0 0.95rem 0.5rem;
		padding: 0.45rem 0.55rem;
		border-radius: 10px;
		font-size: 0.78rem;
		background: rgba(255, 107, 157, 0.12);
		color: #9f2f60;
	}

	.message-list {
		flex: 1;
		min-height: 180px;
		max-height: 280px;
		overflow-y: auto;
		padding: 0 0.95rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.empty-text {
		margin: 0.45rem 0 0;
		font-size: 0.82rem;
		color: #9787b8;
	}

	.message-item {
		background: rgba(244, 239, 255, 0.95);
		border-radius: 12px;
		padding: 0.55rem 0.65rem;
	}

	.message-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.74rem;
		color: #7b65a1;
		margin-bottom: 0.25rem;
	}

	.message-item p {
		margin: 0;
		font-size: 0.82rem;
		color: #4d3a70;
		word-break: break-word;
	}

	.input-row {
		padding: 0.75rem 0.95rem 0.95rem;
		display: flex;
		gap: 0.5rem;
	}

	.message-input {
		flex: 1;
		border: 2px solid #eadbff;
		border-radius: 12px;
		padding: 0.52rem 0.65rem;
		font-size: 0.84rem;
		outline: none;
	}

	.message-input:focus {
		border-color: #c8b2ff;
	}

	.send-btn {
		border: none;
		border-radius: 12px;
		padding: 0.52rem 0.82rem;
		background: linear-gradient(135deg, #ff8fbe 0%, #bfa5ff 100%);
		color: #2f1a52;
		font-weight: 700;
		cursor: pointer;
	}

	.send-btn:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	@media (max-width: 600px) {
		.chat-widget {
			right: 0.7rem;
			bottom: 0.7rem;
		}

		.chat-panel {
			width: min(350px, calc(100vw - 1.4rem));
			max-height: min(540px, calc(100vh - 1.4rem));
		}
	}

	/* ─────────────────────────────────────────────
	   NOTIFICATION ANIMATIONS
	   ───────────────────────────────────────────── */

	/* Unread badge */
	.unread-badge {
		position: absolute;
		top: -6px;
		right: -6px;
		min-width: 20px;
		height: 20px;
		padding: 0 5px;
		border-radius: 999px;
		background: #f43f5e;
		color: #fff;
		font-size: 0.7rem;
		font-weight: 800;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow:
			0 0 0 2px #fff,
			0 0 8px rgba(244, 63, 94, 0.7);
		animation: neon-pulse 1.8s ease-in-out infinite;
	}

	.badge-pop {
		animation:
			badge-pop 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both,
			neon-pulse 1.8s ease-in-out 0.45s infinite;
	}

	/* Toggle shake when new message arrives */
	.toggle-shake {
		animation: toggle-shake 0.55s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
	}

	/* Message preview toast */
	.msg-preview {
		position: absolute;
		bottom: calc(100% + 10px);
		right: 0;
		width: min(280px, calc(100vw - 2.4rem));
		background: rgba(255, 255, 255, 0.96);
		backdrop-filter: blur(12px);
		border-radius: 16px;
		padding: 0.65rem 0.85rem;
		box-shadow:
			0 8px 24px rgba(107, 76, 154, 0.22),
			0 0 0 1.5px rgba(200, 178, 255, 0.55),
			0 0 16px rgba(200, 178, 255, 0.3);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		animation: preview-slide-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
		cursor: pointer;
	}

	.msg-preview::before {
		content: '';
		position: absolute;
		bottom: -6px;
		right: 20px;
		width: 12px;
		height: 12px;
		background: rgba(255, 255, 255, 0.96);
		transform: rotate(45deg);
		box-shadow: 2px 2px 4px rgba(107, 76, 154, 0.1);
	}

	.preview-nick {
		font-size: 0.76rem;
		font-weight: 700;
		color: #6b4c9a;
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.preview-nick::before {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f43f5e;
		box-shadow: 0 0 6px rgba(244, 63, 94, 0.8);
		flex-shrink: 0;
	}

	.preview-text {
		font-size: 0.82rem;
		color: #4d3a70;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Scroll-to-bottom pill */
	.scroll-to-bottom {
		position: absolute;
		bottom: 68px;
		left: 50%;
		transform: translateX(-50%);
		background: linear-gradient(135deg, #ff8fbe 0%, #a78bfa 100%);
		color: #fff;
		border: none;
		border-radius: 999px;
		padding: 0.35rem 0.85rem;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		box-shadow:
			0 4px 14px rgba(167, 139, 250, 0.5),
			0 0 0 1.5px rgba(255, 255, 255, 0.4);
		animation: scroll-btn-enter 0.25s cubic-bezier(0.22, 1, 0.36, 1) both;
		z-index: 5;
		white-space: nowrap;
	}

	.scroll-to-bottom:hover {
		box-shadow:
			0 6px 18px rgba(167, 139, 250, 0.65),
			0 0 12px rgba(255, 143, 190, 0.5);
	}

	/* New message entrance in list */
	.msg-new {
		animation: msg-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	/* chat-panel needs relative for scroll-to-bottom pill positioning */
	.chat-panel {
		position: relative;
	}

	/* ─── Keyframes ─── */

	@keyframes neon-pulse {
		0%,
		100% {
			box-shadow:
				0 0 0 2px #fff,
				0 0 8px rgba(244, 63, 94, 0.7);
		}
		50% {
			box-shadow:
				0 0 0 2px #fff,
				0 0 16px rgba(244, 63, 94, 0.95),
				0 0 28px rgba(244, 63, 94, 0.45);
		}
	}

	@keyframes badge-pop {
		0% {
			transform: scale(1);
		}
		30% {
			transform: scale(1.55);
		}
		55% {
			transform: scale(0.88);
		}
		75% {
			transform: scale(1.18);
		}
		100% {
			transform: scale(1);
		}
	}

	@keyframes toggle-shake {
		0% {
			transform: translateY(-2px) rotate(0deg);
		}
		15% {
			transform: translateY(-4px) rotate(-6deg);
		}
		30% {
			transform: translateY(-4px) rotate(5deg);
		}
		45% {
			transform: translateY(-3px) rotate(-4deg);
		}
		60% {
			transform: translateY(-2px) rotate(3deg);
		}
		75% {
			transform: translateY(-2px) rotate(-2deg);
		}
		100% {
			transform: translateY(-2px) rotate(0deg);
		}
	}

	@keyframes preview-slide-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes scroll-btn-enter {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(8px) scale(0.9);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0) scale(1);
		}
	}

	@keyframes msg-enter {
		from {
			opacity: 0;
			transform: translateX(18px);
			box-shadow: 0 0 0 2px rgba(200, 178, 255, 0);
		}
		40% {
			box-shadow:
				0 0 0 2px rgba(200, 178, 255, 0.6),
				0 0 16px rgba(200, 178, 255, 0.4);
		}
		to {
			opacity: 1;
			transform: translateX(0);
			box-shadow: 0 0 0 2px rgba(200, 178, 255, 0);
		}
	}

	/* Respect prefers-reduced-motion */
	@media (prefers-reduced-motion: reduce) {
		.unread-badge,
		.badge-pop,
		.toggle-shake,
		.msg-preview,
		.scroll-to-bottom,
		.msg-new {
			animation: none;
		}

		.toggle-shake {
			transform: translateY(-2px);
		}
	}
</style>
