import { writable, type Readable } from 'svelte/store';
import type {
	MumbleChannel,
	MumbleProxyChannelPayload,
	MumbleProxyClientEvent,
	MumbleProxyConfig,
	MumbleProxyServerEvent,
	MumbleProxyUserPayload,
	MumbleTextMessage,
	MumbleUser
} from '$lib/types';
import { dedupeChannels } from './utils.ts';

export type MumbleClientMode = 'interactive' | 'monitor';
export type MumbleAudioPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';
export type MumbleConnectionStatus =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'disconnected';

export interface MumbleClientSnapshot {
	status: MumbleConnectionStatus;
	connected: boolean;
	reconnecting: boolean;
	errorMessage: string;
	disconnectReason: string;
	username: string;
	sessionId: number | null;
	currentChannelId: number | null;
	channels: MumbleChannel[];
	users: MumbleUser[];
	messages: MumbleTextMessage[];
	onlineCount: number;
	muted: boolean;
	deafened: boolean;
	voiceRequested: boolean;
	voiceAvailable: boolean;
	voiceConnected: boolean;
	voiceFailed: boolean;
	audioPermission: MumbleAudioPermission;
	playbackBlocked: boolean;
}

export interface CreateMumbleClientOptions {
	config: MumbleProxyConfig;
	nickname: string;
	mode?: MumbleClientMode;
	autoReconnect?: boolean;
	maxMessages?: number;
	maxReconnectAttempts?: number;
}

interface ConnectOptions {
	requestVoice?: boolean;
}

const SOCKET_OPEN = 1;
const DEFAULT_MAX_MESSAGES = 80;

export function createInitialMumbleClientSnapshot(): MumbleClientSnapshot {
	return {
		status: 'idle',
		connected: false,
		reconnecting: false,
		errorMessage: '',
		disconnectReason: '',
		username: '',
		sessionId: null,
		currentChannelId: null,
		channels: [],
		users: [],
		messages: [],
		onlineCount: 0,
		muted: true,
		deafened: false,
		voiceRequested: true,
		voiceAvailable: false,
		voiceConnected: false,
		voiceFailed: false,
		audioPermission: 'unknown',
		playbackBlocked: false
	};
}

function normalizeChannel(channel: MumbleProxyChannelPayload): MumbleChannel {
	return {
		id: channel.id,
		name: channel.name,
		parentId: channel.parent_id,
		description: channel.description ?? ''
	};
}

function sanitizeString(s: string, maxLen: number): string {
	return s.slice(0, maxLen).replace(/[\p{Cc}\p{Cf}]/gu, '');
}

function normalizeUser(user: MumbleProxyUserPayload): MumbleUser {
	return {
		sessionId: user.session_id,
		name: sanitizeString(user.name, 32),
		channelId: user.channel_id,
		muted: user.mute,
		deafened: user.deaf,
		selfMuted: user.self_mute,
		selfDeafened: user.self_deaf
	};
}

const KNOWN_SERVER_EVENT_TYPES = new Set([
	'connected',
	'answer',
	'ice_candidate',
	'channel_updated',
	'user_joined',
	'user_left',
	'user_state',
	'chat_received',
	'error'
]);

function parseServerEvent(raw: string): MumbleProxyServerEvent | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
			return null;
		}
		if (!KNOWN_SERVER_EVENT_TYPES.has((parsed as { type: string }).type)) {
			return null;
		}

		return parsed as MumbleProxyServerEvent;
	} catch (error) {
		console.error('Failed to parse Mumble proxy event:', error);
		return null;
	}
}

function createMessageId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `mumble-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMediaErrorMessage(error: unknown): string {
	if (error instanceof DOMException) {
		switch (error.name) {
			case 'NotAllowedError':
			case 'PermissionDeniedError':
				return '浏览器阻止了麦克风访问，请点击“启用语音”重试。';
			case 'NotFoundError':
			case 'DevicesNotFoundError':
				return '没有检测到可用的麦克风设备。';
			default:
				return '启用语音时发生错误，请稍后重试。';
		}
	}

	return '启用语音时发生错误，请稍后重试。';
}

function getAudioPermission(error: unknown): MumbleAudioPermission {
	if (error instanceof DOMException) {
		switch (error.name) {
			case 'NotAllowedError':
			case 'PermissionDeniedError':
				return 'denied';
			default:
				return 'unknown';
		}
	}

	return 'unknown';
}

export function createMumbleClient(options: CreateMumbleClientOptions): {
	state: Readable<MumbleClientSnapshot>;
	connect: (connectOptions?: ConnectOptions) => void;
	reconnect: (connectOptions?: ConnectOptions) => void;
	disconnect: () => void;
	destroy: () => void;
	rename: (nickname: string) => void;
	sendChat: (message: string) => void;
	switchChannel: (channelId: number) => void;
	setMuted: (muted: boolean) => void;
	setDeafened: (deafened: boolean) => void;
	ensureVoice: () => Promise<void>;
	resumeAudioPlayback: () => Promise<void>;
} {
	const mode = options.mode ?? 'interactive';
	const autoReconnect = options.autoReconnect ?? true;
	const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
	const maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
	const store = writable<MumbleClientSnapshot>(createInitialMumbleClientSnapshot());

	let snapshot = createInitialMumbleClientSnapshot();
	const unsubscribe = store.subscribe((value) => {
		snapshot = value;
	});

	let nickname = options.nickname;
	let destroyed = false;
	let shouldReconnect = true;
	let reconnectAttempts = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let socket: WebSocket | null = null;
	let peerConnection: RTCPeerConnection | null = null;
	let localStream: MediaStream | null = null;
	let pendingVoiceRequest = false;
	const remoteAudioElements = new Map<string, HTMLAudioElement>();

	function patch(partial: Partial<MumbleClientSnapshot>): void {
		store.update((current) => ({ ...current, ...partial }));
	}

	function updateUsers(users: MumbleUser[]): void {
		const self = snapshot.sessionId
			? (users.find((user) => user.sessionId === snapshot.sessionId) ?? null)
			: null;

		patch({
			users,
			onlineCount: users.length,
			currentChannelId: self?.channelId ?? snapshot.currentChannelId
		});
	}

	function clearReconnectTimer(): void {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function sendEvent(event: MumbleProxyClientEvent): void {
		if (!socket || socket.readyState !== SOCKET_OPEN) {
			return;
		}

		socket.send(JSON.stringify(event));
	}

	function removeRemoteAudio(streamId: string): void {
		const audio = remoteAudioElements.get(streamId);
		if (!audio) {
			return;
		}

		audio.pause();
		audio.srcObject = null;
		remoteAudioElements.delete(streamId);
	}

	function cleanupPeerConnection(stopLocalStream: boolean): void {
		if (peerConnection) {
			peerConnection.close();
			peerConnection = null;
		}

		for (const streamId of remoteAudioElements.keys()) {
			removeRemoteAudio(streamId);
		}

		if (stopLocalStream && localStream) {
			for (const track of localStream.getTracks()) {
				track.stop();
			}
			localStream = null;
		}

		patch({
			voiceConnected: false,
			voiceFailed: false,
			playbackBlocked: false,
			voiceAvailable: localStream !== null
		});
	}

	async function resumeAudioPlayback(): Promise<void> {
		const results = await Promise.allSettled(
			Array.from(remoteAudioElements.values()).map((audio) => {
				audio.muted = snapshot.deafened;
				return audio.play();
			})
		);
		patch({
			playbackBlocked: results.some((result) => result.status === 'rejected')
		});
	}

	async function ensurePeerConnection(): Promise<void> {
		if (
			mode !== 'interactive' ||
			peerConnection ||
			!localStream ||
			!socket ||
			socket.readyState !== SOCKET_OPEN
		) {
			return;
		}

		const connection = new RTCPeerConnection({
			iceServers: options.config.iceServers
		});
		peerConnection = connection;

		for (const track of localStream.getTracks()) {
			connection.addTrack(track, localStream);
		}

		const [audioTransceiver] = connection.getTransceivers();
		const audioCapabilities = RTCRtpReceiver.getCapabilities('audio');
		const opusCodecs =
			audioCapabilities?.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'audio/opus') ??
			[];
		if (
			audioTransceiver &&
			typeof audioTransceiver.setCodecPreferences === 'function' &&
			opusCodecs.length > 0
		) {
			audioTransceiver.setCodecPreferences(opusCodecs);
		}

		connection.ontrack = ({ streams }) => {
			const [stream] = streams;
			if (!stream || remoteAudioElements.has(stream.id)) {
				return;
			}

			const audio = new Audio();
			audio.autoplay = true;
			audio.muted = snapshot.deafened;
			audio.srcObject = stream;
			audio.setAttribute('playsinline', 'true');
			remoteAudioElements.set(stream.id, audio);

			for (const track of stream.getTracks()) {
				track.addEventListener('ended', () => removeRemoteAudio(stream.id));
			}

			void audio.play().then(
				() => {
					patch({ playbackBlocked: false });
				},
				() => {
					patch({ playbackBlocked: true });
				}
			);
		};

		connection.onicecandidate = ({ candidate }) => {
			if (!candidate) {
				return;
			}

			sendEvent({
				type: 'ice_candidate',
				data: {
					candidate: candidate.candidate,
					sdp_mid: candidate.sdpMid,
					sdp_mline_index: candidate.sdpMLineIndex
				}
			});
		};

		connection.oniceconnectionstatechange = () => {
			if (
				connection.iceConnectionState === 'connected' ||
				connection.iceConnectionState === 'completed'
			) {
				patch({ voiceConnected: true, voiceFailed: false });
				return;
			}

			if (connection.iceConnectionState === 'failed') {
				patch({ voiceConnected: false, voiceFailed: true });
				return;
			}

			if (
				connection.iceConnectionState === 'closed' ||
				connection.iceConnectionState === 'disconnected'
			) {
				patch({ voiceConnected: false });
			}
		};

		const offer = await connection.createOffer();
		await connection.setLocalDescription(offer);
		if (!offer.sdp) {
			throw new Error('Missing SDP offer payload');
		}

		sendEvent({ type: 'offer', data: { sdp: offer.sdp } });
	}

	async function ensureVoice(): Promise<void> {
		if (mode !== 'interactive') {
			return;
		}

		if (!navigator.mediaDevices?.getUserMedia) {
			patch({
				voiceAvailable: false,
				audioPermission: 'unsupported',
				errorMessage: '当前浏览器不支持麦克风访问。'
			});
			return;
		}

		patch({ voiceRequested: true });

		if (!localStream) {
			try {
				localStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
						sampleRate: 48000,
						channelCount: 1
					}
				});
			} catch (error) {
				patch({
					voiceAvailable: false,
					voiceConnected: false,
					audioPermission: getAudioPermission(error),
					errorMessage: getMediaErrorMessage(error)
				});
				return;
			}
		}

		for (const track of localStream.getAudioTracks()) {
			track.enabled = !snapshot.muted;
		}

		patch({
			voiceAvailable: true,
			audioPermission: 'granted',
			errorMessage: ''
		});

		if (snapshot.connected) {
			await ensurePeerConnection();
		}
	}

	function scheduleReconnect(reason: string): void {
		if (
			!shouldReconnect ||
			destroyed ||
			!autoReconnect ||
			reconnectAttempts >= maxReconnectAttempts
		) {
			patch({
				status: 'disconnected',
				reconnecting: false,
				disconnectReason:
					reconnectAttempts >= maxReconnectAttempts ? `${reason} (已达最大重连次数)` : reason
			});
			return;
		}

		const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
		reconnectAttempts += 1;
		clearReconnectTimer();
		patch({
			status: 'reconnecting',
			reconnecting: true,
			disconnectReason: reason
		});
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect({ requestVoice: mode === 'interactive' && snapshot.voiceRequested });
		}, delay);
	}

	function handleSocketClose(reason: string): void {
		socket = null;
		cleanupPeerConnection(false);
		patch({
			connected: false,
			sessionId: null,
			currentChannelId: null,
			users: [],
			onlineCount: 0
		});
		scheduleReconnect(reason);
	}

	async function handleSocketMessage(event: MessageEvent<string>): Promise<void> {
		const parsed = parseServerEvent(event.data);
		if (!parsed) {
			return;
		}

		switch (parsed.type) {
			case 'connected': {
				reconnectAttempts = 0;
				const normalizedUsers = parsed.data.users.map(normalizeUser);
				const normalizedChannels = dedupeChannels(parsed.data.channels.map(normalizeChannel));
				const selfUser = normalizedUsers.find((u) => u.sessionId === parsed.data.session_id);
				patch({
					status: 'connected',
					connected: true,
					reconnecting: false,
					errorMessage: '',
					username: selfUser?.name ?? nickname,
					sessionId: parsed.data.session_id,
					currentChannelId: selfUser?.channelId ?? null,
					users: normalizedUsers,
					onlineCount: normalizedUsers.length,
					channels: normalizedChannels
				});

				if (mode === 'monitor') {
					sendEvent({ type: 'deafen', data: { deafened: true } });
					patch({ deafened: true });
				} else if (mode === 'interactive' && pendingVoiceRequest) {
					pendingVoiceRequest = false;
					await ensureVoice();
				} else if (mode === 'interactive' && localStream && snapshot.voiceRequested) {
					await ensurePeerConnection();
				}
				return;
			}
			case 'answer':
				if (!peerConnection) {
					return;
				}

				await peerConnection.setRemoteDescription({
					type: 'answer',
					sdp: parsed.data.sdp
				});
				return;
			case 'ice_candidate':
				if (!peerConnection) {
					return;
				}

				await peerConnection.addIceCandidate({
					candidate: parsed.data.candidate,
					sdpMid: parsed.data.sdp_mid,
					sdpMLineIndex: parsed.data.sdp_mline_index
				});
				return;
			case 'channel_updated':
				patch({ channels: dedupeChannels(parsed.data.channels.map(normalizeChannel)) });
				return;
			case 'user_joined':
				updateUsers([...snapshot.users, normalizeUser(parsed.data)]);
				return;
			case 'user_left':
				updateUsers(snapshot.users.filter((u) => u.sessionId !== parsed.data.session_id));
				return;
			case 'chat_received': {
				const nextMessages = [
					...snapshot.messages,
					{
						id: createMessageId(),
						sender: sanitizeString(parsed.data.sender_name, 32),
						message: sanitizeString(parsed.data.message, 2000),
						channelId: parsed.data.channel_id,
						timestamp: parsed.data.timestamp
					}
				].slice(-maxMessages);
				patch({ messages: nextMessages });
				return;
			}
			case 'user_state': {
				const isSelf = parsed.data.session_id === snapshot.sessionId;
				const nextUsers = snapshot.users.map((user) =>
					user.sessionId === parsed.data.session_id
						? {
								...user,
								...(parsed.data.channel_id != null && { channelId: parsed.data.channel_id }),
								...(parsed.data.name != null && { name: sanitizeString(parsed.data.name, 32) }),
								...(!isSelf && parsed.data.mute != null && { muted: parsed.data.mute }),
								...(!isSelf && parsed.data.deaf != null && { deafened: parsed.data.deaf }),
								...(!isSelf &&
									parsed.data.self_mute != null && { selfMuted: parsed.data.self_mute }),
								...(!isSelf &&
									parsed.data.self_deaf != null && { selfDeafened: parsed.data.self_deaf })
							}
						: user
				);
				updateUsers(nextUsers);
				return;
			}
			case 'error':
				patch({ errorMessage: parsed.data.message });
				return;
		}
	}

	function connect(connectOptions?: ConnectOptions): void {
		if (destroyed) {
			return;
		}

		if (
			socket &&
			(socket.readyState === WebSocket.CONNECTING || socket.readyState === SOCKET_OPEN)
		) {
			return;
		}

		shouldReconnect = true;
		clearReconnectTimer();
		const requestedVoice =
			mode === 'interactive' && (connectOptions?.requestVoice ?? snapshot.voiceRequested);
		if (mode === 'interactive' && connectOptions?.requestVoice !== undefined) {
			patch({ voiceRequested: requestedVoice });
		}
		pendingVoiceRequest = requestedVoice;

		patch({
			status: reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
			reconnecting: reconnectAttempts > 0,
			errorMessage: ''
		});

		const nextSocket = new WebSocket(options.config.wsUrl);
		socket = nextSocket;

		nextSocket.onopen = () => {
			sendEvent({ type: 'connect', data: { username: nickname } });
		};

		nextSocket.onmessage = (event) => {
			if (typeof event.data === 'string') {
				void handleSocketMessage(event);
			}
		};

		nextSocket.onerror = () => {
			patch({
				errorMessage: snapshot.connected ? snapshot.errorMessage : '连接 Mumble 代理时发生错误。'
			});
		};

		nextSocket.onclose = (event) => {
			if (socket !== nextSocket) {
				return;
			}

			handleSocketClose(event.reason || '与 Mumble 代理的连接已关闭');
		};
	}

	function reconnect(connectOptions?: ConnectOptions): void {
		if (destroyed) {
			return;
		}

		const requestedVoice =
			connectOptions?.requestVoice ?? (mode === 'interactive' && snapshot.voiceRequested);
		const stopLocalStream = mode === 'interactive' && connectOptions?.requestVoice === false;

		shouldReconnect = true;
		reconnectAttempts = 0;
		clearReconnectTimer();
		cleanupPeerConnection(stopLocalStream);
		if (mode === 'interactive' && connectOptions?.requestVoice !== undefined) {
			patch({ voiceRequested: requestedVoice });
		}
		patch({
			status: 'reconnecting',
			reconnecting: true,
			errorMessage: '',
			disconnectReason: ''
		});

		const existingSocket = socket;
		const nextConnectOptions = {
			requestVoice: requestedVoice
		} satisfies ConnectOptions;

		if (!existingSocket || existingSocket.readyState === WebSocket.CLOSED) {
			socket = null;
			connect(nextConnectOptions);
			return;
		}

		existingSocket.onopen = null;
		existingSocket.onmessage = null;
		existingSocket.onerror = null;
		existingSocket.onclose = () => {
			if (socket !== existingSocket) {
				return;
			}

			socket = null;
			patch({
				connected: false,
				sessionId: null,
				currentChannelId: null,
				users: [],
				onlineCount: 0
			});
			connect(nextConnectOptions);
		};

		if (existingSocket.readyState === SOCKET_OPEN) {
			try {
				existingSocket.send(
					JSON.stringify({ type: 'disconnect' } satisfies MumbleProxyClientEvent)
				);
			} catch {
				// Ignore close-time send failures.
			}
		}

		existingSocket.close(1000, 'manual reconnect');
	}

	function resetSocketWithoutReconnect(reason: string): void {
		clearReconnectTimer();
		const existingSocket = socket;
		socket = null;
		if (existingSocket) {
			existingSocket.onopen = null;
			existingSocket.onmessage = null;
			existingSocket.onerror = null;
			existingSocket.onclose = null;
			try {
				existingSocket.send(
					JSON.stringify({ type: 'disconnect' } satisfies MumbleProxyClientEvent)
				);
			} catch {
				// Ignore close-time send failures.
			}
			existingSocket.close(1000, reason);
		}
	}

	function disconnect(): void {
		shouldReconnect = false;
		reconnectAttempts = 0;
		resetSocketWithoutReconnect('manual disconnect');
		cleanupPeerConnection(true);
		patch({
			status: 'disconnected',
			connected: false,
			reconnecting: false,
			disconnectReason: '已断开连接',
			sessionId: null,
			currentChannelId: null,
			users: [],
			channels: [],
			onlineCount: 0,
			username: nickname
		});
	}

	function destroy(): void {
		destroyed = true;
		disconnect();
		unsubscribe();
	}

	function rename(nextNickname: string): void {
		nickname = nextNickname;
		patch({ username: nextNickname });

		if (
			socket &&
			(socket.readyState === WebSocket.CONNECTING || socket.readyState === SOCKET_OPEN)
		) {
			resetSocketWithoutReconnect('rename reconnect');
			cleanupPeerConnection(false);
			reconnectAttempts = 0;
			connect({ requestVoice: mode === 'interactive' && snapshot.voiceRequested });
		}
	}

	function sendChat(message: string): void {
		sendEvent({
			type: 'chat_send',
			data: { channel_id: snapshot.currentChannelId ?? 0, message }
		});
	}

	function switchChannel(channelId: number): void {
		sendEvent({
			type: 'channel_join',
			data: { channel_id: channelId }
		});
	}

	function setMuted(muted: boolean): void {
		if (localStream) {
			for (const track of localStream.getAudioTracks()) {
				track.enabled = !muted;
			}
		}

		patch({ muted });
		sendEvent({ type: 'mute', data: { muted } });
	}

	function setDeafened(deafened: boolean): void {
		for (const audio of remoteAudioElements.values()) {
			audio.muted = deafened;
		}

		patch({ deafened });
		sendEvent({ type: 'deafen', data: { deafened } });

		if (!deafened) {
			void resumeAudioPlayback();
		}
	}

	return {
		state: { subscribe: store.subscribe },
		connect,
		reconnect,
		disconnect,
		destroy,
		rename,
		sendChat,
		switchChannel,
		setMuted,
		setDeafened,
		ensureVoice,
		resumeAudioPlayback
	};
}
