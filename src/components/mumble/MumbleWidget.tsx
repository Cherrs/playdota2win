import {
	type KeyboardEvent,
	type UIEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState
} from 'react';

import { useMumbleClientSnapshot } from '../../hooks/mumble-client';
import {
	createMumbleClient,
	type MumbleClient,
	type MumbleClientSnapshot
} from '../../lib/mumble/client';
import { buildChannelOptions } from '../../lib/mumble/utils';
import { MUMBLE_WIDGET_OPEN_EVENT } from '../../lib/mumble/events';
import { generateRandomNickname } from '../../lib/nickname';
import type {
	ApiResponse,
	MumbleProxyConfig,
	MumbleTextMessage,
	NicknameKeywordList
} from '../../lib/types';
import MascotIcon from '../public/MascotIcon';
import styles from './MumbleWidget.module.css';

const NICKNAME_STORAGE_KEY = 'playdota2win_mumble_nickname';
const MAX_MESSAGE_LENGTH = 500;
const MAX_NICKNAME_LENGTH = 24;

function classNames(...names: Array<string | false | null | undefined>): string {
	return names
		.filter((name): name is string => typeof name === 'string')
		.map((name) => styles[name])
		.join(' ');
}

function normalizeClientInput(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString('zh-CN', {
		hour: '2-digit',
		minute: '2-digit'
	});
}

function formatDateTime(timestamp: number): string | undefined {
	const date = new Date(timestamp);
	return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function persistNickname(nickname: string): void {
	try {
		localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
	} catch {
		// A blocked storage API must not prevent chat from working for this session.
	}
}

function ShuffleIcon() {
	return (
		<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<path d="M3 5h2.2c3.8 0 3.8 8 7.6 8H15" />
			<path d="m12.5 10.5 2.5 2.5-2.5 2.5M3 13h2.2c1.1 0 1.9-.7 2.6-1.7M10.2 6.7c.7-1 1.5-1.7 2.6-1.7H15" />
			<path d="M12.5 2.5 15 5l-2.5 2.5" />
		</svg>
	);
}

function SpeakerIcon() {
	return (
		<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<path d="M3 7h3l4-3v10l-4-3H3Z" />
			<path d="M12.5 6.5a4 4 0 0 1 0 5M14.5 4.5a6.8 6.8 0 0 1 0 9" />
		</svg>
	);
}

function MicrophoneIcon() {
	return (
		<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<rect x="6" y="2" width="6" height="9" rx="3" />
			<path d="M3.8 8.5a5.2 5.2 0 0 0 10.4 0M9 13.8V16M6.5 16h5" />
		</svg>
	);
}

function ChatIcon() {
	return (
		<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<path d="M3 3.5h12v9H8l-3.5 2.5.7-2.5H3Z" />
			<path d="M6 7h6M6 9.5h4" />
		</svg>
	);
}

export default function MumbleWidget() {
	const [expanded, setExpanded] = useState(false);
	const [pendingMessage, setPendingMessage] = useState('');
	const [nickname, setNickname] = useState('');
	const [nicknameDraft, setNicknameDraft] = useState('');
	const [editingNickname, setEditingNickname] = useState(false);
	const [loadingConfig, setLoadingConfig] = useState(false);
	const [configError, setConfigError] = useState('');
	const [nicknameKeywords, setNicknameKeywords] = useState<string[]>([]);
	const [client, setClient] = useState<MumbleClient | null>(null);
	const [unreadCount, setUnreadCount] = useState(0);
	const [animateToggle, setAnimateToggle] = useState(false);
	const [newMessagePreview, setNewMessagePreview] = useState<{
		sender: string;
		message: string;
	} | null>(null);
	const [showScrollToBottom, setShowScrollToBottom] = useState(false);
	const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());
	const [statusCollapsed, setStatusCollapsed] = useState(false);
	const [channelCollapsed, setChannelCollapsed] = useState(false);

	const clientState = useMumbleClientSnapshot(client);
	const clientRef = useRef<MumbleClient | null>(null);
	const notificationUnsubscribeRef = useRef<(() => void) | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);
	const nicknameRef = useRef('');
	const expandedRef = useRef(expanded);
	const mountedRef = useRef(true);
	const initializationRef = useRef<Promise<void> | null>(null);
	const initializationControllerRef = useRef<AbortController | null>(null);
	const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const animateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const newMessageTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
	const panelId = useId();
	const statusBodyId = useId();
	const channelBodyId = useId();

	const triggerNewMessageNotification = useCallback((message: MumbleTextMessage): void => {
		setNewMessageIds((current) => new Set([...current, message.id]));
		const highlightTimer = setTimeout(() => {
			newMessageTimersRef.current.delete(highlightTimer);
			if (!mountedRef.current) return;
			setNewMessageIds((current) => {
				const next = new Set(current);
				next.delete(message.id);
				return next;
			});
		}, 800);
		newMessageTimersRef.current.add(highlightTimer);

		if (!expandedRef.current) {
			setUnreadCount((count) => count + 1);
			setAnimateToggle(false);
			if (animateTimerRef.current) clearTimeout(animateTimerRef.current);
			if (animationFrameRef.current !== null) {
				cancelAnimationFrame(animationFrameRef.current);
			}
			animationFrameRef.current = requestAnimationFrame(() => {
				animationFrameRef.current = null;
				if (!mountedRef.current) return;
				setAnimateToggle(true);
				animateTimerRef.current = setTimeout(() => {
					animateTimerRef.current = null;
					if (mountedRef.current) setAnimateToggle(false);
				}, 600);
			});

			setNewMessagePreview({ sender: message.sender, message: message.message });
			if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
			previewTimerRef.current = setTimeout(() => {
				previewTimerRef.current = null;
				if (mountedRef.current) setNewMessagePreview(null);
			}, 4000);
			return;
		}

		const messages = messagesRef.current;
		if (!messages) return;
		const isAtBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;
		if (!isAtBottom) setShowScrollToBottom(true);
	}, []);

	const initializeClient = useCallback(async (): Promise<void> => {
		if (clientRef.current || initializationRef.current) {
			return initializationRef.current ?? Promise.resolve();
		}

		const controller = new AbortController();
		initializationControllerRef.current = controller;
		const task = (async () => {
			setLoadingConfig(true);
			setConfigError('');

			let preparedNickname = nicknameRef.current;
			if (!preparedNickname) {
				let savedNickname = '';
				try {
					savedNickname = localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '';
				} catch {
					// Use a generated nickname when persistent browser storage is unavailable.
				}
				preparedNickname =
					normalizeClientInput(savedNickname).slice(0, MAX_NICKNAME_LENGTH) ||
					generateRandomNickname([]);
				nicknameRef.current = preparedNickname;
				setNickname(preparedNickname);
				setNicknameDraft(preparedNickname);
				persistNickname(preparedNickname);
			}

			const keywordsRequest = fetch('/api/chat/nicknames', { signal: controller.signal })
				.then(async (response): Promise<string[]> => {
					const data: ApiResponse<NicknameKeywordList> = await response.json();
					return response.ok && data.success && data.data ? data.data.keywords : [];
				})
				.catch((error: unknown) => {
					if (isAbortError(error)) throw error;
					return [];
				});
			const configRequest = fetch('/api/mumble/config', { signal: controller.signal }).then(
				async (response): Promise<MumbleProxyConfig | null> => {
					const data: ApiResponse<MumbleProxyConfig> = await response.json();
					if (response.ok && data.success && data.data) return data.data;
					throw new Error(data.error || 'Mumble 代理暂不可用');
				}
			);

			try {
				const [keywords, config] = await Promise.all([keywordsRequest, configRequest]);
				if (!mountedRef.current || controller.signal.aborted || !config) return;
				setNicknameKeywords(keywords);

				const nextClient = createMumbleClient({
					config,
					nickname: preparedNickname,
					mode: 'interactive'
				});
				clientRef.current = nextClient;
				let previousMessageIds = new Set<string>();
				notificationUnsubscribeRef.current = nextClient.state.subscribe(
					(nextState: MumbleClientSnapshot) => {
						for (const message of nextState.messages) {
							if (!previousMessageIds.has(message.id)) {
								triggerNewMessageNotification(message);
							}
						}
						previousMessageIds = new Set(nextState.messages.map((message) => message.id));
					}
				);
				setClient(nextClient);
				nextClient.connect();
			} catch (error) {
				if (!isAbortError(error) && mountedRef.current) {
					setConfigError(error instanceof Error ? error.message : '无法读取 Mumble 代理配置');
				}
			} finally {
				if (initializationControllerRef.current === controller) {
					initializationControllerRef.current = null;
				}
				if (mountedRef.current) setLoadingConfig(false);
			}
		})();

		initializationRef.current = task;
		try {
			await task;
		} finally {
			if (initializationRef.current === task) initializationRef.current = null;
		}
	}, [triggerNewMessageNotification]);

	const expandWidget = useCallback(() => {
		expandedRef.current = true;
		setExpanded(true);
		setUnreadCount(0);
		setNewMessagePreview(null);
		if (previewTimerRef.current) {
			clearTimeout(previewTimerRef.current);
			previewTimerRef.current = null;
		}
		void initializeClient();
	}, [initializeClient]);

	useEffect(() => {
		mountedRef.current = true;
		const newMessageTimers = newMessageTimersRef.current;
		const handleOpenRequest = () => expandWidget();
		window.addEventListener(MUMBLE_WIDGET_OPEN_EVENT, handleOpenRequest);
		const startupTimer = expandedRef.current
			? window.setTimeout(() => void initializeClient(), 0)
			: null;
		return () => {
			mountedRef.current = false;
			window.removeEventListener(MUMBLE_WIDGET_OPEN_EVENT, handleOpenRequest);
			if (startupTimer !== null) window.clearTimeout(startupTimer);
			initializationControllerRef.current?.abort();
			initializationControllerRef.current = null;
			notificationUnsubscribeRef.current?.();
			notificationUnsubscribeRef.current = null;
			clientRef.current?.destroy();
			clientRef.current = null;
			if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
			if (animateTimerRef.current) clearTimeout(animateTimerRef.current);
			if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
			for (const timer of newMessageTimers) clearTimeout(timer);
			newMessageTimers.clear();
		};
	}, [expandWidget, initializeClient]);

	useEffect(() => {
		if (!expanded || !messagesRef.current) return;
		let cancelled = false;
		queueMicrotask(() => {
			if (cancelled || !mountedRef.current || showScrollToBottom) return;
			const messages = messagesRef.current;
			messages?.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
		});
		return () => {
			cancelled = true;
		};
	}, [clientState.messages.length, expanded, showScrollToBottom]);

	const channelOptions = buildChannelOptions(clientState.channels);
	const currentChannelUsers =
		clientState.currentChannelId === null
			? []
			: clientState.users.filter((user) => user.channelId === clientState.currentChannelId);
	let statusText = '未连接';
	if (loadingConfig) statusText = '正在读取代理配置...';
	else if (configError) statusText = configError;
	else if (clientState.reconnecting) statusText = '正在重连 Mumble...';
	else if (clientState.status === 'connecting') statusText = '正在连接 Mumble...';
	else if (clientState.connected && clientState.voiceConnected) statusText = '文字和语音已连接';
	else if (clientState.connected && clientState.voiceAvailable && clientState.voiceFailed) {
		statusText = '文字已连接，语音建立失败';
	} else if (clientState.connected && clientState.voiceAvailable) {
		statusText = '文字已连接，正在建立语音...';
	} else if (clientState.connected) statusText = '文字已连接，等待语音可用';
	else if (clientState.disconnectReason) statusText = clientState.disconnectReason;

	function handleCollapse(): void {
		expandedRef.current = false;
		setExpanded(false);
	}

	function startNicknameEdit(): void {
		setNicknameDraft(nicknameRef.current);
		setEditingNickname(true);
	}

	function saveNickname(): void {
		const nextNickname = normalizeClientInput(nicknameDraft).slice(0, MAX_NICKNAME_LENGTH);
		if (!nextNickname) return;
		nicknameRef.current = nextNickname;
		setNickname(nextNickname);
		setNicknameDraft(nextNickname);
		setEditingNickname(false);
		persistNickname(nextNickname);
		clientRef.current?.rename(nextNickname);
	}

	function randomizeNickname(): void {
		const nextNickname = generateRandomNickname(nicknameKeywords);
		nicknameRef.current = nextNickname;
		setNickname(nextNickname);
		setNicknameDraft(nextNickname);
		persistNickname(nextNickname);
		clientRef.current?.rename(nextNickname);
	}

	function submitMessage(): void {
		const text = normalizeClientInput(pendingMessage);
		if (!text || text.length > MAX_MESSAGE_LENGTH || !clientState.connected) return;
		clientRef.current?.sendChat(text);
		setPendingMessage('');
	}

	function handleReconnect(): void {
		if (clientRef.current) clientRef.current.reconnect();
		else void initializeClient();
	}

	function handleMessageScroll(event: UIEvent<HTMLDivElement>): void {
		const messages = event.currentTarget;
		const isAtBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;
		if (isAtBottom) setShowScrollToBottom(false);
	}

	function scrollToLatest(): void {
		const messages = messagesRef.current;
		messages?.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
		setShowScrollToBottom(false);
	}

	function handleMessageKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitMessage();
	}

	return (
		<div className={classNames('mumble-widget')}>
			{expanded ? (
				<section
					id={panelId}
					className={classNames('mumble-panel')}
					aria-label="Mumble 语音房"
					aria-busy={loadingConfig}
				>
					<header className={classNames('mumble-header')}>
						<div className={classNames('title-group')}>
							<span className={classNames('panel-logo')} aria-hidden="true">
								<MascotIcon className={classNames('panel-mascot')} />
							</span>
							<h2>Mumble 语音房</h2>
							<span className={classNames('online-pill')}>
								<span
									className={classNames('online-dot', clientState.connected && 'active')}
									aria-hidden="true"
								/>
								{loadingConfig
									? '连接准备中'
									: clientState.connected
										? `在线 ${clientState.onlineCount}`
										: '未连接'}
							</span>
						</div>

						<div className={classNames('header-actions')}>
							<button
								className={classNames('icon-btn')}
								type="button"
								onClick={handleCollapse}
								title="收起"
								aria-label="收起 Mumble 窗口"
							>
								−
							</button>
							{clientState.connected ||
							clientState.reconnecting ||
							clientState.status === 'connecting' ? (
								<button
									className={classNames('icon-btn')}
									type="button"
									onClick={() => clientRef.current?.disconnect()}
									title="断开连接"
									aria-label="断开 Mumble 连接"
								>
									×
								</button>
							) : (
								<button
									className={classNames('icon-btn')}
									type="button"
									onClick={handleReconnect}
									title="连接"
									aria-label="连接 Mumble"
								>
									⟳
								</button>
							)}
						</div>
					</header>

					<div className={classNames('session-controls')}>
						<div className={classNames('nickname-row')}>
							{editingNickname ? (
								<>
									<input
										type="text"
										className={classNames('nickname-input')}
										maxLength={MAX_NICKNAME_LENGTH}
										value={nicknameDraft}
										onChange={(event) => setNicknameDraft(event.currentTarget.value)}
										aria-label="Mumble 昵称"
										onKeyDown={(event) => {
											if (event.key === 'Enter' && !event.nativeEvent.isComposing) saveNickname();
										}}
									/>
									<button className={classNames('small-btn')} type="button" onClick={saveNickname}>
										保存
									</button>
									<button
										className={classNames('small-btn', 'ghost')}
										type="button"
										onClick={() => {
											setNicknameDraft(nicknameRef.current);
											setEditingNickname(false);
										}}
									>
										取消
									</button>
								</>
							) : (
								<>
									<span className={classNames('nickname-prefix')}>昵称：</span>
									<strong className={classNames('nickname-label')}>{nickname || '准备中'}</strong>
									<button
										className={classNames('small-btn', 'ghost', 'icon-only')}
										type="button"
										onClick={randomizeNickname}
										title="随机昵称"
										aria-label="生成随机昵称"
									>
										<ShuffleIcon />
									</button>
									<button
										className={classNames('small-btn', 'ghost')}
										type="button"
										onClick={startNicknameEdit}
									>
										改名
									</button>
								</>
							)}
						</div>

						<div className={classNames('status-card')}>
							<button
								className={classNames('card-header')}
								type="button"
								onClick={() => setStatusCollapsed((collapsed) => !collapsed)}
								aria-expanded={!statusCollapsed}
								aria-controls={statusBodyId}
							>
								<span
									className={classNames(
										'status-dot',
										clientState.connected && 'active',
										clientState.voiceFailed && 'failed'
									)}
									aria-hidden="true"
								/>
								<span className={classNames('card-header-title')}>连接信息</span>
								<span
									className={classNames('collapse-arrow', statusCollapsed && 'collapsed')}
									aria-hidden="true"
								>
									▾
								</span>
							</button>
							{!statusCollapsed && (
								<div className={classNames('card-body')} id={statusBodyId}>
									<div className={classNames('status-main')} role="status" aria-live="polite">
										<span>{statusText}</span>
									</div>
									{clientState.errorMessage && (
										<p className={classNames('status-error')} role="alert">
											{clientState.errorMessage}
										</p>
									)}
								</div>
							)}
						</div>

						<div className={classNames('channel-card')}>
							<button
								className={classNames('card-header')}
								type="button"
								onClick={() => setChannelCollapsed((collapsed) => !collapsed)}
								aria-expanded={!channelCollapsed}
								aria-controls={channelBodyId}
							>
								<span className={classNames('card-header-title')}>当前频道</span>
								{channelCollapsed && (
									<span className={classNames('channel-name-pill')}>
										{channelOptions.find((option) => option.id === clientState.currentChannelId)
											?.label ?? '—'}
									</span>
								)}
								<span
									className={classNames('collapse-arrow', channelCollapsed && 'collapsed')}
									aria-hidden="true"
								>
									▾
								</span>
							</button>
							{!channelCollapsed && (
								<div className={classNames('card-body')} id={channelBodyId}>
									<select
										id="mumble-channel-select"
										className={classNames('channel-select')}
										aria-label="选择 Mumble 频道"
										value={clientState.currentChannelId ?? ''}
										disabled={!clientState.connected || channelOptions.length === 0}
										onChange={(event) => {
											const value = Number(event.currentTarget.value);
											if (!Number.isNaN(value)) clientRef.current?.switchChannel(value);
										}}
									>
										{channelOptions.length === 0 ? (
											<option value="">等待频道列表...</option>
										) : (
											channelOptions.map((option) => (
												<option key={option.id} value={option.id}>
													{option.label}
												</option>
											))
										)}
									</select>

									<div className={classNames('user-chips')}>
										{currentChannelUsers.filter((user) => user.sessionId === clientState.sessionId)
											.length === 0 ? (
											<span className={classNames('hint-chip')}>当前频道暂无成员</span>
										) : (
											currentChannelUsers
												.filter((user) => user.sessionId === clientState.sessionId)
												.map((user) => (
													<span
														className={classNames('user-chip', 'self')}
														key={`${user.sessionId}-${user.name}`}
													>
														{user.name}
													</span>
												))
										)}
									</div>
								</div>
							)}
						</div>

						<section className={classNames('members-section')} aria-label="当前频道成员">
							<h3>
								成员 <span>({currentChannelUsers.length})</span>
							</h3>
							<div className={classNames('member-list')}>
								{currentChannelUsers.length === 0 ? (
									<p className={classNames('members-empty')}>等待成员加入频道</p>
								) : (
									currentChannelUsers.map((user) => (
										<div className={classNames('member-row')} key={user.sessionId}>
											<span className={classNames('member-dot')} aria-hidden="true" />
											<span className={classNames('member-name')}>
												{user.name}
												{user.sessionId === clientState.sessionId ? ' (我)' : ''}
											</span>
											<span className={classNames('member-audio')}>
												<SpeakerIcon />
											</span>
										</div>
									))
								)}
							</div>
						</section>

						<div className={classNames('voice-controls')}>
							<button
								className={classNames('voice-btn', clientState.voiceConnected && 'active')}
								type="button"
								onClick={() => void clientRef.current?.ensureVoice()}
								disabled={loadingConfig || Boolean(configError)}
								aria-pressed={clientState.voiceConnected}
							>
								<SpeakerIcon />
								{clientState.voiceConnected ? '语音已启用' : '启用语音'}
							</button>
							<button
								className={classNames('voice-btn', 'ghost', clientState.muted && 'active')}
								type="button"
								onClick={() => clientRef.current?.setMuted(!clientState.muted)}
								disabled={!clientState.connected}
								aria-pressed={clientState.muted}
							>
								<MicrophoneIcon />
								{clientState.muted ? '取消静音' : '麦克风静音'}
							</button>
							<button
								className={classNames('voice-btn', 'ghost', clientState.deafened && 'active')}
								type="button"
								onClick={() => clientRef.current?.setDeafened(!clientState.deafened)}
								disabled={!clientState.connected}
								aria-pressed={clientState.deafened}
							>
								<ChatIcon />
								{clientState.deafened ? '取消耳聋' : '仅听文字'}
							</button>
						</div>

						{clientState.network && (
							<details className={classNames('hint-card')}>
								<summary>连接质量</summary>
								<p>
									{clientState.network.route === 'relay'
										? 'MumDota TURN 中继'
										: clientState.network.route === 'direct'
											? '直连 MumDota'
											: '正在检测链路'}
									{clientState.network.protocol &&
										` · ${clientState.network.protocol.toUpperCase()}`}
									{clientState.network.rttMs !== null &&
										` · 往返 ${Math.round(clientState.network.rttMs)} ms`}
									{clientState.network.jitterMs !== null &&
										` · 抖动 ${Math.round(clientState.network.jitterMs)} ms`}
									{clientState.network.packetLossPercent !== null &&
										` · 接收丢包 ${clientState.network.packetLossPercent.toFixed(1)}%`}
								</p>
							</details>
						)}

						{(clientState.audioPermission === 'denied' || clientState.playbackBlocked) && (
							<div className={classNames('hint-card')}>
								<p>
									{clientState.audioPermission === 'denied'
										? '浏览器阻止了麦克风访问，可以稍后手动重新授权。'
										: '浏览器拦截了自动播放，点击下面按钮恢复远端声音。'}
								</p>
								<div className={classNames('hint-actions')}>
									{clientState.audioPermission === 'denied' && (
										<button
											className={classNames('small-btn')}
											type="button"
											onClick={() => void clientRef.current?.ensureVoice()}
										>
											重新请求麦克风
										</button>
									)}
									{clientState.playbackBlocked && (
										<button
											className={classNames('small-btn', 'ghost')}
											type="button"
											onClick={() => void clientRef.current?.resumeAudioPlayback()}
										>
											恢复声音播放
										</button>
									)}
								</div>
							</div>
						)}
					</div>

					<div
						className={classNames('message-list')}
						ref={messagesRef}
						onScroll={handleMessageScroll}
						role="log"
						aria-label="Mumble 文字消息"
						aria-live="polite"
						aria-relevant="additions text"
					>
						{clientState.messages.length === 0 && (
							<p className={classNames('empty-text')}>
								连接成功后，这里会显示当前会话收到的文字消息。
							</p>
						)}
						{clientState.messages.map((message) => (
							<article
								className={classNames('message-item', newMessageIds.has(message.id) && 'msg-new')}
								key={message.id}
							>
								<div className={classNames('message-meta')}>
									<strong>{message.sender}</strong>
									<time dateTime={formatDateTime(message.timestamp)}>
										{formatTime(message.timestamp)}
									</time>
								</div>
								<p>{message.message}</p>
							</article>
						))}
					</div>

					{showScrollToBottom && (
						<button
							className={classNames('scroll-to-bottom')}
							type="button"
							onClick={scrollToLatest}
						>
							<span aria-hidden="true">↓</span>
							新消息
						</button>
					)}

					<div className={classNames('input-row')}>
						<input
							type="text"
							className={classNames('message-input')}
							placeholder={clientState.connected ? '发送频道文字消息...' : '等待连接完成...'}
							maxLength={MAX_MESSAGE_LENGTH}
							value={pendingMessage}
							onChange={(event) => setPendingMessage(event.currentTarget.value)}
							aria-label="Mumble 消息"
							disabled={!clientState.connected}
							onKeyDown={handleMessageKeyDown}
						/>
						<button
							className={classNames('send-btn')}
							type="button"
							onClick={submitMessage}
							disabled={!clientState.connected}
						>
							发送
						</button>
					</div>
				</section>
			) : (
				<>
					{newMessagePreview && (
						<div className={classNames('msg-preview')} role="status" aria-live="polite">
							<span className={classNames('preview-sender')}>{newMessagePreview.sender}</span>
							<span className={classNames('preview-text')}>
								{newMessagePreview.message.slice(0, 48)}
								{newMessagePreview.message.length > 48 ? '…' : ''}
							</span>
						</div>
					)}

					<button
						className={classNames('mumble-toggle', animateToggle && 'toggle-shake')}
						type="button"
						onClick={expandWidget}
						aria-expanded="false"
						aria-controls={panelId}
						aria-label={`打开 Mumble 聊天窗口，${client ? `在线 ${clientState.onlineCount}` : '按需连接'}${unreadCount > 0 ? `，${unreadCount > 99 ? '99 条以上' : `${unreadCount} 条`}未读消息` : ''}`}
					>
						<span className={classNames('toggle-text')}>Mumble 语音</span>
						<span className={classNames('toggle-online')}>
							{client ? `在线 ${clientState.onlineCount}` : '按需连接'}
						</span>
						{unreadCount > 0 && (
							<span className={classNames('unread-badge')}>
								{unreadCount > 99 ? '99+' : unreadCount}
							</span>
						)}
					</button>
				</>
			)}
		</div>
	);
}
