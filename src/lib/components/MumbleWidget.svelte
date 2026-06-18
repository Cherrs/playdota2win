<script lang="ts">
	import { onMount } from 'svelte';
	import { generateRandomNickname } from '$lib/nickname';
	import {
		createInitialMumbleClientSnapshot,
		createMumbleClient,
		type MumbleClientSnapshot
	} from '$lib/mumble/client';
	import { buildChannelOptions } from '$lib/mumble/utils';
	import type {
		ApiResponse,
		MumbleProxyConfig,
		NicknameKeywordList,
		MumbleTextMessage
	} from '$lib/types';

	const NICKNAME_STORAGE_KEY = 'playdota2win_mumble_nickname';
	const MAX_MESSAGE_LENGTH = 500;
	const MAX_NICKNAME_LENGTH = 24;

	let expanded = $state(false);
	let pendingMessage = $state('');
	let nickname = $state('');
	let nicknameDraft = $state('');
	let editingNickname = $state(false);
	let loadingConfig = $state(true);
	let configError = $state('');
	let nicknameKeywords = $state<string[]>([]);
	let clientState = $state<MumbleClientSnapshot>(createInitialMumbleClientSnapshot());
	let messagesRef = $state<HTMLDivElement | null>(null);

	let unreadCount = $state(0);
	let animateToggle = $state(false);
	let newMsgPreview = $state<{ sender: string; message: string } | null>(null);
	let showScrollToBottom = $state(false);
	let newMsgIds = $state<Set<string>>(new Set());
	let statusCollapsed = $state(false);
	let channelCollapsed = $state(false);

	let client: ReturnType<typeof createMumbleClient> | null = null;
	let unsubscribeClient: (() => void) | null = null;
	let previewTimer: ReturnType<typeof setTimeout> | null = null;
	let animateTimer: ReturnType<typeof setTimeout> | null = null;

	const channelOptions = $derived(buildChannelOptions(clientState.channels));
	const currentChannelUsers = $derived(
		clientState.currentChannelId === null
			? []
			: clientState.users.filter((user) => user.channelId === clientState.currentChannelId)
	);
	const statusText = $derived.by(() => {
		if (loadingConfig) {
			return '正在读取代理配置...';
		}
		if (configError) {
			return configError;
		}
		if (clientState.reconnecting) {
			return '正在重连 Mumble...';
		}
		if (clientState.status === 'connecting') {
			return '正在连接 Mumble...';
		}
		if (clientState.connected && clientState.voiceConnected) {
			return '文字和语音已连接';
		}
		if (clientState.connected && clientState.voiceAvailable && clientState.voiceFailed) {
			return '文字已连接，语音建立失败';
		}
		if (clientState.connected && clientState.voiceAvailable) {
			return '文字已连接，正在建立语音...';
		}
		if (clientState.connected) {
			return '文字已连接，等待语音可用';
		}
		if (clientState.disconnectReason) {
			return clientState.disconnectReason;
		}
		return '未连接';
	});

	async function fetchNicknameKeywords(): Promise<string[]> {
		try {
			const res = await fetch('/api/chat/nicknames');
			const data: ApiResponse<NicknameKeywordList> = await res.json();
			if (data.success && data.data) {
				return data.data.keywords;
			}
		} catch {
			// Fall back to default nickname generation.
		}
		return [];
	}

	async function fetchMumbleConfig(): Promise<MumbleProxyConfig | null> {
		try {
			const res = await fetch('/api/mumble/config');
			const data: ApiResponse<MumbleProxyConfig> = await res.json();
			if (data.success && data.data) {
				return data.data;
			}
			configError = data.error || 'Mumble 代理暂不可用';
		} catch {
			configError = '无法读取 Mumble 代理配置';
		} finally {
			loadingConfig = false;
		}
		return null;
	}

	function normalizeClientInput(value: string): string {
		return value.replace(/\s+/g, ' ').trim();
	}

	function triggerNewMessageNotification(message: MumbleTextMessage): void {
		newMsgIds = new Set([...newMsgIds, message.id]);
		setTimeout(() => {
			newMsgIds = new Set([...newMsgIds].filter((id) => id !== message.id));
		}, 800);

		if (!expanded) {
			unreadCount += 1;

			animateToggle = false;
			if (animateTimer) {
				clearTimeout(animateTimer);
			}

			requestAnimationFrame(() => {
				animateToggle = true;
				animateTimer = setTimeout(() => {
					animateToggle = false;
				}, 600);
			});

			newMsgPreview = {
				sender: message.sender,
				message: message.message
			};
			if (previewTimer) {
				clearTimeout(previewTimer);
			}
			previewTimer = setTimeout(() => {
				newMsgPreview = null;
			}, 4000);
			return;
		}

		if (messagesRef) {
			const isAtBottom =
				messagesRef.scrollHeight - messagesRef.scrollTop - messagesRef.clientHeight < 60;
			if (!isAtBottom) {
				showScrollToBottom = true;
			}
		}
	}

	function handleSnapshot(nextState: MumbleClientSnapshot): void {
		const previousMessageIds = new Set(clientState.messages.map((message) => message.id));
		clientState = nextState;

		for (const message of nextState.messages) {
			if (!previousMessageIds.has(message.id)) {
				triggerNewMessageNotification(message);
			}
		}
	}

	function startNicknameEdit(): void {
		nicknameDraft = nickname;
		editingNickname = true;
	}

	function saveNickname(): void {
		const nextNickname = normalizeClientInput(nicknameDraft).slice(0, MAX_NICKNAME_LENGTH);
		if (!nextNickname) {
			return;
		}

		nickname = nextNickname;
		nicknameDraft = nextNickname;
		editingNickname = false;
		localStorage.setItem(NICKNAME_STORAGE_KEY, nextNickname);
		client?.rename(nextNickname);
	}

	function cancelNicknameEdit(): void {
		nicknameDraft = nickname;
		editingNickname = false;
	}

	function randomizeNickname(): void {
		const nextNickname = generateRandomNickname(nicknameKeywords);
		nickname = nextNickname;
		nicknameDraft = nextNickname;
		localStorage.setItem(NICKNAME_STORAGE_KEY, nextNickname);
		client?.rename(nextNickname);
	}

	function submitMessage(): void {
		const text = normalizeClientInput(pendingMessage);
		if (!text || text.length > MAX_MESSAGE_LENGTH || !clientState.connected) {
			return;
		}

		client?.sendChat(text);
		pendingMessage = '';
	}

	function handleReconnect(): void {
		client?.reconnect();
	}

	function handleMessageScroll(): void {
		if (!messagesRef) {
			return;
		}

		const isAtBottom =
			messagesRef.scrollHeight - messagesRef.scrollTop - messagesRef.clientHeight < 60;
		if (isAtBottom) {
			showScrollToBottom = false;
		}
	}

	function scrollToLatest(): void {
		messagesRef?.scrollTo({ top: messagesRef.scrollHeight, behavior: 'smooth' });
		showScrollToBottom = false;
	}

	function formatTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString('zh-CN', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

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
		void clientState.messages.length;
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
		let cancelled = false;

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

			const config = await fetchMumbleConfig();
			if (!config || cancelled) {
				return;
			}

			client = createMumbleClient({
				config,
				nickname,
				mode: 'interactive'
			});
			unsubscribeClient = client.state.subscribe(handleSnapshot);
			client.connect();
		})();

		return () => {
			cancelled = true;
			unsubscribeClient?.();
			client?.destroy();
			if (previewTimer) {
				clearTimeout(previewTimer);
			}
			if (animateTimer) {
				clearTimeout(animateTimer);
			}
		};
	});
</script>

<div class="mumble-widget">
	{#if expanded}
		<section class="mumble-panel">
			<header class="mumble-header">
				<div class="title-group">
					<h2>Mumble 语音房</h2>
					<span class="online-pill">在线 {clientState.onlineCount}</span>
				</div>

				<div class="header-actions">
					{#if clientState.connected || clientState.reconnecting || clientState.status === 'connecting'}
						<button class="icon-btn ghost" type="button" onclick={handleReconnect} title="重新连接">
							↻
						</button>
						<button
							class="icon-btn"
							type="button"
							onclick={() => client?.disconnect()}
							title="断开连接"
						>
							×
						</button>
					{:else}
						<button class="icon-btn" type="button" onclick={handleReconnect} title="连接">
							⟳
						</button>
					{/if}
					<button class="icon-btn" type="button" onclick={() => (expanded = false)} title="收起">
						−
					</button>
				</div>
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
					<button class="small-btn ghost" type="button" onclick={startNicknameEdit}>改名</button>
				{/if}
			</div>

			<div class="status-card">
				<button
					class="card-header"
					type="button"
					onclick={() => (statusCollapsed = !statusCollapsed)}
				>
					<span class="status-dot" class:active={clientState.connected} class:failed={clientState.voiceFailed}></span>
					<span class="card-header-title">连接信息</span>
					<span class="collapse-arrow" class:collapsed={statusCollapsed}>▾</span>
				</button>
				{#if !statusCollapsed}
					<div class="card-body">
						<div class="status-main">
							<span>{statusText}</span>
						</div>
						{#if clientState.errorMessage}
							<p class="status-error">{clientState.errorMessage}</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="channel-card">
				<button
					class="card-header"
					type="button"
					onclick={() => (channelCollapsed = !channelCollapsed)}
				>
					<span class="card-header-title">当前频道</span>
					{#if channelCollapsed}
						<span class="channel-name-pill">
							{channelOptions.find((o) => o.id === clientState.currentChannelId)?.label ?? '—'}
						</span>
					{/if}
					<span class="collapse-arrow" class:collapsed={channelCollapsed}>▾</span>
				</button>
				{#if !channelCollapsed}
					<div class="card-body">
						<select
							id="mumble-channel-select"
							class="channel-select"
							value={clientState.currentChannelId ?? ''}
							disabled={!clientState.connected || channelOptions.length === 0}
							onchange={(event) => {
								const value = Number((event.currentTarget as HTMLSelectElement).value);
								if (!Number.isNaN(value)) {
									client?.switchChannel(value);
								}
							}}
						>
							{#if channelOptions.length === 0}
								<option value="">等待频道列表...</option>
							{:else}
								{#each channelOptions as option (option.id)}
									<option value={option.id}>{option.label}</option>
								{/each}
							{/if}
						</select>

						<div class="user-chips">
							{#if currentChannelUsers.length === 0}
								<span class="hint-chip">当前频道暂无成员</span>
							{:else}
								{#each currentChannelUsers as user (`${user.sessionId}-${user.name}`)}
									<span class="user-chip" class:self={user.sessionId === clientState.sessionId}>
										{user.name}
									</span>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<div class="voice-controls">
				<button
					class="voice-btn"
					class:active={clientState.voiceConnected}
					type="button"
					onclick={() => void client?.ensureVoice()}
					disabled={loadingConfig || !!configError}
				>
					{clientState.voiceConnected ? '语音已启用' : '启用语音'}
				</button>
				<button
					class="voice-btn ghost"
					class:active={clientState.muted}
					type="button"
					onclick={() => client?.setMuted(!clientState.muted)}
					disabled={!clientState.connected}
				>
					{clientState.muted ? '取消静音' : '麦克风静音'}
				</button>
				<button
					class="voice-btn ghost"
					class:active={clientState.deafened}
					type="button"
					onclick={() => client?.setDeafened(!clientState.deafened)}
					disabled={!clientState.connected}
				>
					{clientState.deafened ? '取消耳聋' : '仅听文字'}
				</button>
			</div>

			{#if clientState.audioPermission === 'denied' || clientState.playbackBlocked}
				<div class="hint-card">
					<p>
						{#if clientState.audioPermission === 'denied'}
							浏览器阻止了麦克风访问，可以稍后手动重新授权。
						{:else}
							浏览器拦截了自动播放，点击下面按钮恢复远端声音。
						{/if}
					</p>
					<div class="hint-actions">
						{#if clientState.audioPermission === 'denied'}
							<button class="small-btn" type="button" onclick={() => void client?.ensureVoice()}>
								重新请求麦克风
							</button>
						{/if}
						{#if clientState.playbackBlocked}
							<button
								class="small-btn ghost"
								type="button"
								onclick={() => void client?.resumeAudioPlayback()}
							>
								恢复声音播放
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<div class="message-list" bind:this={messagesRef} onscroll={handleMessageScroll}>
				{#if clientState.messages.length === 0}
					<p class="empty-text">连接成功后，这里会显示当前会话收到的文字消息。</p>
				{/if}
				{#each clientState.messages as message (message.id)}
					<article class="message-item" class:msg-new={newMsgIds.has(message.id)}>
						<div class="message-meta">
							<strong>{message.sender}</strong>
							<time>{formatTime(message.timestamp)}</time>
						</div>
						<p>{message.message}</p>
					</article>
				{/each}
			</div>

			{#if showScrollToBottom}
				<button class="scroll-to-bottom" type="button" onclick={scrollToLatest}>
					<span>↓</span>
					新消息
				</button>
			{/if}

			<div class="input-row">
				<input
					type="text"
					class="message-input"
					placeholder={clientState.connected ? '发送频道文字消息...' : '等待连接完成...'}
					maxlength={MAX_MESSAGE_LENGTH}
					bind:value={pendingMessage}
					disabled={!clientState.connected}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							submitMessage();
						}
					}}
				/>
				<button
					class="send-btn"
					type="button"
					onclick={submitMessage}
					disabled={!clientState.connected}
				>
					发送
				</button>
			</div>
		</section>
	{:else}
		{#if newMsgPreview}
			<div class="msg-preview" role="status" aria-live="polite">
				<span class="preview-sender">{newMsgPreview.sender}</span>
				<span class="preview-text">
					{newMsgPreview.message.slice(0, 48)}{newMsgPreview.message.length > 48 ? '…' : ''}
				</span>
			</div>
		{/if}

		<button
			class="mumble-toggle"
			class:toggle-shake={animateToggle}
			type="button"
			onclick={() => (expanded = true)}
			aria-label="打开 Mumble 聊天窗口"
		>
			<span class="toggle-emoji">🎧</span>
			<span class="toggle-text">Mumble 语音</span>
			<span class="toggle-online">在线 {clientState.onlineCount}</span>
			{#if unreadCount > 0}
				<span class="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
			{/if}
		</button>
	{/if}
</div>

<style>
	.mumble-widget {
		position: fixed;
		right: 1.2rem;
		bottom: 1.2rem;
		z-index: 30;
	}

	.mumble-toggle {
		border: none;
		background: linear-gradient(135deg, #ff9ec4 0%, #c8b2ff 100%);
		color: #2d1b4e;
		padding: 0.85rem 1rem;
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

	.mumble-toggle:hover {
		transform: translateY(-2px);
		box-shadow: 0 14px 28px rgba(107, 76, 154, 0.33);
	}

	.toggle-emoji {
		font-size: 1rem;
	}

	.toggle-online {
		font-size: 0.78rem;
		background: rgba(255, 255, 255, 0.45);
		border-radius: 999px;
		padding: 0.2rem 0.55rem;
	}

	.mumble-panel {
		width: min(380px, calc(100vw - 1.2rem));
		max-height: min(620px, calc(100vh - 2.4rem));
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(10px);
		border-radius: 20px;
		box-shadow: 0 20px 40px rgba(107, 76, 154, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.7);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}

	.mumble-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1rem;
		background: linear-gradient(
			135deg,
			rgba(255, 158, 196, 0.35) 0%,
			rgba(200, 178, 255, 0.35) 100%
		);
	}

	.title-group {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.title-group h2 {
		margin: 0;
		font-size: 1rem;
		color: #5a3e87;
	}

	.online-pill {
		font-size: 0.78rem;
		color: #7d5ca8;
		background: rgba(255, 255, 255, 0.5);
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
	}

	.header-actions {
		display: flex;
		gap: 0.35rem;
	}

	.icon-btn {
		border: none;
		background: rgba(255, 255, 255, 0.75);
		width: 30px;
		height: 30px;
		border-radius: 999px;
		cursor: pointer;
		color: #5a3e87;
		font-size: 0.95rem;
	}

	.icon-btn.ghost {
		background: rgba(107, 76, 154, 0.12);
	}

	.nickname-row,
	.voice-controls,
	.input-row {
		padding-left: 1rem;
		padding-right: 1rem;
	}

	.nickname-row {
		padding-top: 0.8rem;
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

	.nickname-input,
	.channel-select,
	.message-input {
		width: 100%;
		border: 2px solid #eadbff;
		border-radius: 12px;
		padding: 0.52rem 0.65rem;
		font-size: 0.84rem;
		outline: none;
		box-sizing: border-box;
	}

	.nickname-input:focus,
	.channel-select:focus,
	.message-input:focus {
		border-color: #c8b2ff;
	}

	.small-btn,
	.voice-btn,
	.send-btn {
		border: none;
		cursor: pointer;
		font-weight: 700;
	}

	.small-btn {
		background: #6b4c9a;
		color: #fff;
		padding: 0.35rem 0.6rem;
		border-radius: 8px;
		font-size: 0.76rem;
	}

	.small-btn.ghost,
	.voice-btn.ghost {
		background: rgba(107, 76, 154, 0.14);
		color: #6b4c9a;
	}

	.status-card,
	.channel-card,
	.hint-card {
		margin: 0.8rem 1rem 0;
		padding: 0.8rem 0.9rem;
		border-radius: 16px;
		background: rgba(244, 239, 255, 0.88);
	}

	.status-main {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.82rem;
		color: #6b4c9a;
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

	.status-dot.failed {
		background: #f43f5e;
	}

	.status-error,
	.hint-card p {
		margin: 0.45rem 0 0;
		font-size: 0.78rem;
		color: #8a5686;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		text-align: left;
		color: #6b4c9a;
	}

	.card-header-title {
		flex: 1;
		font-size: 0.78rem;
		font-weight: 700;
		color: #6b4c9a;
	}

	.channel-name-pill {
		font-size: 0.75rem;
		color: #7d5ca8;
		background: rgba(255, 255, 255, 0.55);
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		max-width: 120px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.collapse-arrow {
		font-size: 0.85rem;
		color: #9787b8;
		transition: transform 0.2s ease;
		line-height: 1;
	}

	.collapse-arrow.collapsed {
		transform: rotate(-90deg);
	}

	.card-body {
		margin-top: 0.5rem;
	}

	.user-chips {
		margin-top: 0.7rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.user-chip,
	.hint-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.7);
		color: #6b4c9a;
	}

	.user-chip.self {
		background: linear-gradient(135deg, rgba(255, 143, 190, 0.3), rgba(167, 139, 250, 0.3));
	}

	.voice-controls {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.85rem;
		flex-wrap: wrap;
	}

	.voice-btn {
		padding: 0.5rem 0.85rem;
		border-radius: 999px;
		background: linear-gradient(135deg, #ff8fbe 0%, #bfa5ff 100%);
		color: #2f1a52;
		font-size: 0.78rem;
	}

	.voice-btn.active {
		box-shadow: inset 0 0 0 2px rgba(90, 62, 135, 0.18);
	}

	.hint-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}

	.message-list {
		flex: 1;
		min-height: 180px;
		max-height: 280px;
		overflow-y: auto;
		margin: 0.85rem 1rem 0;
		padding-bottom: 0.75rem;
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
		padding-top: 0.8rem;
		padding-bottom: 1rem;
		display: flex;
		gap: 0.5rem;
	}

	.send-btn {
		border-radius: 12px;
		padding: 0.52rem 0.9rem;
		background: linear-gradient(135deg, #ff8fbe 0%, #bfa5ff 100%);
		color: #2f1a52;
	}

	.send-btn:disabled,
	.voice-btn:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

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
	}

	.preview-sender {
		font-size: 0.76rem;
		font-weight: 700;
		color: #6b4c9a;
	}

	.preview-text {
		font-size: 0.82rem;
		color: #4d3a70;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

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
	}

	.scroll-to-bottom {
		position: absolute;
		bottom: 70px;
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
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		box-shadow: 0 4px 14px rgba(167, 139, 250, 0.5);
	}

	.msg-new {
		animation: pop-in 0.45s ease;
	}

	.toggle-shake {
		animation: toggle-shake 0.55s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
	}

	@keyframes pop-in {
		from {
			transform: translateY(8px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@keyframes toggle-shake {
		10%,
		90% {
			transform: translate3d(-1px, 0, 0);
		}
		20%,
		80% {
			transform: translate3d(2px, 0, 0);
		}
		30%,
		50%,
		70% {
			transform: translate3d(-3px, 0, 0);
		}
		40%,
		60% {
			transform: translate3d(3px, 0, 0);
		}
	}

	@media (max-width: 600px) {
		.mumble-widget {
			right: 0.7rem;
			bottom: 0.7rem;
		}

		.mumble-panel {
			width: min(360px, calc(100vw - 1.4rem));
			max-height: min(600px, calc(100vh - 1.4rem));
		}

		.voice-controls {
			flex-direction: column;
		}

		.voice-btn {
			width: 100%;
		}
	}
</style>
