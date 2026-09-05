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
import type { IceServer, MumbleIceConfig } from '$lib/types';
import { dedupeChannels } from './utils.ts';
import { readNetworkStats, type MumbleNetworkStats } from './stats.ts';

export type MumbleClientMode = 'interactive' | 'monitor';
export type MumbleAudioPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';
export type MumbleConnectionStatus =
	'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

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
	network: MumbleNetworkStats | null;
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

export interface MumbleClientStateStore {
	/** Observe state values and receive the current snapshot immediately. */
	subscribe: (listener: (snapshot: MumbleClientSnapshot) => void) => () => void;
	getSnapshot: () => MumbleClientSnapshot;
}

export interface MumbleClient {
	state: MumbleClientStateStore;
	/** Notify external-store consumers after each state change. */
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => MumbleClientSnapshot;
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
		muted: false,
		deafened: false,
		voiceRequested: false,
		voiceAvailable: false,
		voiceConnected: false,
		voiceFailed: false,
		audioPermission: 'unknown',
		playbackBlocked: false,
		network: null
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
	'offer',
	'ice_config',
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

export function createMumbleClient(options: CreateMumbleClientOptions): MumbleClient {
	const mode = options.mode ?? 'interactive';
	const autoReconnect = options.autoReconnect ?? true;
	const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
	const maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
	let snapshot = createInitialMumbleClientSnapshot();
	const listeners = new Set<() => void>();

	let nickname = options.nickname;
	let destroyed = false;
	let shouldReconnect = true;
	let reconnectAttempts = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let socket: WebSocket | null = null;
	let peerConnection: RTCPeerConnection | null = null;
	let peerConnectionGeneration = 0;
	let localStream: MediaStream | null = null;
	let voiceRequestGeneration = 0;
	let voiceRequest: Promise<void> | null = null;
	let pendingVoiceRequest = false;
	let protocolVersion = 1;
	let iceServers: IceServer[] = options.config.iceServers;
	let iceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
	let negotiationTimer: ReturnType<typeof setTimeout> | null = null;
	let statsTimer: ReturnType<typeof setInterval> | null = null;
	let connectionTimer: ReturnType<typeof setTimeout> | null = null;
	let recoveryAttempts = 0;
	let pendingCandidates: RTCIceCandidateInit[] = [];
	let incomingMessages = Promise.resolve();
	const remoteAudioElements = new Map<string, HTMLAudioElement>();

	function getSnapshot(): MumbleClientSnapshot {
		return snapshot;
	}

	function subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function subscribeWithSnapshot(
		listener: (nextSnapshot: MumbleClientSnapshot) => void
	): () => void {
		const unsubscribe = subscribe(() => listener(snapshot));
		listener(snapshot);
		return unsubscribe;
	}

	function patch(partial: Partial<MumbleClientSnapshot>): void {
		snapshot = { ...snapshot, ...partial };
		for (const listener of [...listeners]) {
			listener();
		}
	}

	function updateUsers(users: MumbleUser[]): void {
		const self =
			snapshot.sessionId !== null
				? (users.find((user) => user.sessionId === snapshot.sessionId) ?? null)
				: null;

		patch({
			users,
			onlineCount: users.length,
			currentChannelId: self?.channelId ?? snapshot.currentChannelId,
			muted: self?.muted ?? snapshot.muted,
			deafened: self?.deafened ?? snapshot.deafened
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

		try {
			socket.send(JSON.stringify(event));
		} catch (error) {
			patch({
				errorMessage: `发送 Mumble 消息失败: ${error instanceof Error ? error.message : String(error)}`
			});
		}
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

	function clearSessionTimers(): void {
		if (connectionTimer) clearTimeout(connectionTimer);
		if (iceRefreshTimer) clearTimeout(iceRefreshTimer);
		connectionTimer = iceRefreshTimer = null;
	}

	function failConnection(reason: string): void {
		resetSocketWithoutReconnect('connection recovery');
		handleSocketClose(reason);
		patch({ errorMessage: reason });
	}

	function armNegotiationTimeout(): void {
		if (negotiationTimer) clearTimeout(negotiationTimer);
		negotiationTimer = setTimeout(() => {
			negotiationTimer = null;
			failConnection('语音连接超时，正在重新连接。');
		}, 15000);
	}

	function applyIceConfig(config: MumbleIceConfig): void {
		iceServers = config.ice_servers;
		peerConnection?.setConfiguration({ iceServers });
		if (iceRefreshTimer) clearTimeout(iceRefreshTimer);
		iceRefreshTimer = null;
		if (config.expires_at !== null) {
			iceRefreshTimer = setTimeout(
				() => {
					iceRefreshTimer = null;
					sendEvent({ type: 'ice_refresh' });
					// A lost refresh response must not leave an apparently healthy
					// voice session using credentials that have expired.
					if (peerConnection) armNegotiationTimeout();
				},
				Math.max(1000, config.expires_at * 1000 - Date.now() - 60000)
			);
		}
	}

	function recoverVoice(delay = 0): void {
		if (recoveryTimer || !peerConnection || !snapshot.connected) return;
		if (recoveryAttempts > 0 && negotiationTimer) return;
		recoveryTimer = setTimeout(() => {
			recoveryTimer = null;
			if (!peerConnection || !snapshot.connected) return;
			if (protocolVersion < 2 || recoveryAttempts >= 1) {
				failConnection('语音连接中断，正在重新连接。');
				return;
			}
			recoveryAttempts += 1;
			// Refresh first, then request a server offer using the new ICE
			// configuration. Only the server creates v2 offers (no glare).
			sendEvent({ type: 'ice_refresh' });
			armNegotiationTimeout();
		}, delay);
	}

	async function updateNetworkStats(connection: RTCPeerConnection): Promise<void> {
		if (typeof connection.getStats !== 'function') return;
		try {
			const network = readNetworkStats(await connection.getStats());
			if (!destroyed && peerConnection === connection) patch({ network });
		} catch {
			// Stats can be unavailable while a connection is closing.
		}
	}

	async function flushCandidates(connection: RTCPeerConnection): Promise<void> {
		if (peerConnection !== connection) return;
		for (const candidate of pendingCandidates.splice(0)) {
			if (peerConnection !== connection) return;
			await connection.addIceCandidate(candidate);
		}
	}

	function cleanupPeerConnection(stopLocalStream: boolean): void {
		peerConnectionGeneration += 1;
		if (recoveryTimer) clearTimeout(recoveryTimer);
		if (negotiationTimer) clearTimeout(negotiationTimer);
		if (statsTimer) clearInterval(statsTimer);
		recoveryTimer = negotiationTimer = null;
		statsTimer = null;
		recoveryAttempts = 0;
		pendingCandidates = [];
		if (peerConnection) {
			peerConnection.ontrack = null;
			peerConnection.onicecandidate = null;
			peerConnection.oniceconnectionstatechange = null;
			peerConnection.close();
			peerConnection = null;
		}

		for (const streamId of remoteAudioElements.keys()) {
			removeRemoteAudio(streamId);
		}

		if (stopLocalStream) {
			voiceRequestGeneration += 1;
			voiceRequest = null;
			if (localStream) {
				for (const track of localStream.getTracks()) {
					track.stop();
				}
				localStream = null;
			}
		}

		patch({
			voiceConnected: false,
			voiceFailed: false,
			playbackBlocked: false,
			voiceAvailable: localStream !== null,
			network: null
		});
	}

	async function resumeAudioPlayback(): Promise<void> {
		if (destroyed) return;
		const generation = peerConnectionGeneration;
		const results = await Promise.allSettled(
			Array.from(remoteAudioElements.values()).map((audio) => {
				audio.muted = snapshot.deafened;
				return audio.play();
			})
		);
		if (destroyed || generation !== peerConnectionGeneration) return;
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

		let connection: RTCPeerConnection;
		try {
			connection = new RTCPeerConnection({
				iceServers
			});
		} catch (error) {
			patch({
				voiceConnected: false,
				voiceFailed: true,
				errorMessage: `无法创建 WebRTC 连接: ${error instanceof Error ? error.message : String(error)}`
			});
			return;
		}
		peerConnection = connection;
		const generation = ++peerConnectionGeneration;
		const isCurrent = () =>
			!destroyed &&
			generation === peerConnectionGeneration &&
			peerConnection === connection &&
			localStream !== null;

		for (const track of localStream.getTracks()) {
			connection.addTrack(track, localStream);
		}

		const [audioTransceiver] = connection.getTransceivers();
		const audioCapabilities =
			typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function'
				? RTCRtpReceiver.getCapabilities('audio')
				: null;
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
			if (!isCurrent()) return;
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
				track.addEventListener('ended', () => {
					if (remoteAudioElements.get(stream.id) === audio) removeRemoteAudio(stream.id);
				});
			}

			void audio.play().then(
				() => {
					if (isCurrent()) patch({ playbackBlocked: false });
				},
				() => {
					if (isCurrent()) patch({ playbackBlocked: true });
				}
			);
		};

		connection.onicecandidate = ({ candidate }) => {
			if (!isCurrent() || !candidate) {
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
			if (!isCurrent()) return;
			if (
				connection.iceConnectionState === 'connected' ||
				connection.iceConnectionState === 'completed'
			) {
				if (recoveryTimer) clearTimeout(recoveryTimer);
				if (negotiationTimer) clearTimeout(negotiationTimer);
				recoveryTimer = negotiationTimer = null;
				recoveryAttempts = 0;
				patch({ voiceConnected: true, voiceFailed: false, errorMessage: '' });
				void updateNetworkStats(connection);
				if (!statsTimer) statsTimer = setInterval(() => void updateNetworkStats(connection), 5000);
				return;
			}

			if (connection.iceConnectionState === 'failed') {
				patch({ voiceConnected: false, voiceFailed: true });
				recoverVoice();
				return;
			}

			if (
				connection.iceConnectionState === 'closed' ||
				connection.iceConnectionState === 'disconnected'
			) {
				patch({ voiceConnected: false });
				if (connection.iceConnectionState === 'disconnected') recoverVoice(3000);
			}
		};

		armNegotiationTimeout();
		if (protocolVersion >= 2) {
			sendEvent({ type: 'start_voice' });
			return;
		}
		try {
			const offer = await connection.createOffer();
			if (!isCurrent()) return;
			await connection.setLocalDescription(offer);
			if (!isCurrent()) return;
			if (!offer.sdp) {
				cleanupPeerConnection(false);
				patch({
					voiceFailed: true,
					errorMessage: 'WebRTC offer 创建失败 (无 SDP)'
				});
				return;
			}

			sendEvent({ type: 'offer', data: { sdp: offer.sdp } });
		} catch (error) {
			if (!isCurrent()) return;
			console.error('WebRTC offer/SDP negotiation failed:', error);
			cleanupPeerConnection(false);
			patch({
				voiceFailed: true,
				errorMessage: `语音通道建立失败: ${error instanceof Error ? error.message : String(error)}`
			});
		}
	}

	async function performVoiceRequest(generation: number): Promise<void> {
		if (mode !== 'interactive' || destroyed) {
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
			let acquiredStream: MediaStream;
			try {
				acquiredStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
						sampleRate: 48000,
						channelCount: 1
					}
				});
			} catch (error) {
				if (destroyed || generation !== voiceRequestGeneration) return;
				patch({
					voiceAvailable: false,
					voiceConnected: false,
					audioPermission: getAudioPermission(error),
					errorMessage: getMediaErrorMessage(error)
				});
				return;
			}

			if (destroyed || generation !== voiceRequestGeneration) {
				if (acquiredStream !== localStream) {
					for (const track of acquiredStream.getTracks()) track.stop();
				}
				return;
			}
			localStream = acquiredStream;
		}

		if (destroyed || generation !== voiceRequestGeneration || !localStream) return;

		for (const track of localStream.getAudioTracks()) {
			track.enabled = !snapshot.muted;
		}

		patch({
			voiceAvailable: true,
			audioPermission: 'granted',
			errorMessage: ''
		});

		if (snapshot.connected) {
			try {
				if (peerConnection && snapshot.voiceFailed) recoverVoice();
				else await ensurePeerConnection();
			} catch (error) {
				if (destroyed || generation !== voiceRequestGeneration) return;
				console.error('Failed to initialize WebRTC voice:', error);
				cleanupPeerConnection(false);
				patch({
					voiceFailed: true,
					errorMessage: '语音通道建立失败，请稍后重试。'
				});
			}
		}
	}

	function ensureVoice(): Promise<void> {
		if (mode !== 'interactive' || destroyed) return Promise.resolve();
		if (voiceRequest) return voiceRequest;

		const generation = ++voiceRequestGeneration;
		const request = performVoiceRequest(generation);
		voiceRequest = request;
		void request.then(
			() => {
				if (voiceRequest === request) voiceRequest = null;
			},
			() => {
				if (voiceRequest === request) voiceRequest = null;
			}
		);
		return request;
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
		clearSessionTimers();
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

	async function handleSocketMessage(
		event: MessageEvent<string>,
		sourceSocket: WebSocket
	): Promise<void> {
		if (destroyed || socket !== sourceSocket) return;
		const parsed = parseServerEvent(event.data);
		if (!parsed) {
			return;
		}

		switch (parsed.type) {
			case 'connected': {
				if (connectionTimer) clearTimeout(connectionTimer);
				connectionTimer = null;
				protocolVersion = parsed.data.protocol_version ?? 1;
				if (parsed.data.ice) applyIceConfig(parsed.data.ice);
				else iceServers = options.config.iceServers;
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
				} else if (pendingVoiceRequest) {
					pendingVoiceRequest = false;
					await ensureVoice();
				} else if (localStream) {
					await ensurePeerConnection();
				}
				return;
			}
			case 'ice_config':
				applyIceConfig(parsed.data);
				if (peerConnection) {
					recoveryAttempts = Math.max(recoveryAttempts, 1);
					sendEvent({ type: 'ice_restart' });
					armNegotiationTimeout();
				}
				return;
			case 'offer': {
				const connection = peerConnection;
				if (!connection) return;
				try {
					await connection.setRemoteDescription({ type: 'offer', sdp: parsed.data.sdp });
					await flushCandidates(connection);
					const answer = await connection.createAnswer();
					if (destroyed || socket !== sourceSocket || peerConnection !== connection) return;
					await connection.setLocalDescription(answer);
					if (destroyed || socket !== sourceSocket || peerConnection !== connection) return;
					if (!answer.sdp) throw new Error('empty answer');
					sendEvent({ type: 'answer', data: { sdp: answer.sdp } });
					// Track changes can renegotiate an already connected transport.
					if (snapshot.voiceConnected && recoveryAttempts === 0 && negotiationTimer) {
						clearTimeout(negotiationTimer);
						negotiationTimer = null;
					}
				} catch {
					if (destroyed || socket !== sourceSocket || peerConnection !== connection) return;
					failConnection('语音协商失败，正在重新连接。');
				}
				return;
			}

			case 'answer':
				if (!peerConnection) {
					return;
				}

				{
					const connection = peerConnection;
					try {
						await connection.setRemoteDescription({
							type: 'answer',
							sdp: parsed.data.sdp
						});
						await flushCandidates(connection);
					} catch (error) {
						if (destroyed || socket !== sourceSocket || peerConnection !== connection) return;
						console.error('Failed to set remote description:', error);
						cleanupPeerConnection(false);
						patch({
							voiceFailed: true,
							errorMessage: '语音协商失败，请重试'
						});
					}
				}
				return;
			case 'ice_candidate':
				if (!peerConnection) {
					return;
				}

				{
					const connection = peerConnection;
					try {
						const candidate = {
							candidate: parsed.data.candidate,
							sdpMid: parsed.data.sdp_mid,
							sdpMLineIndex: parsed.data.sdp_mline_index
						};
						if (!connection.remoteDescription) {
							if (pendingCandidates.length >= 128) throw new Error('too many candidates');
							pendingCandidates.push(candidate);
						} else await connection.addIceCandidate(candidate);
					} catch (error) {
						if (destroyed || socket !== sourceSocket || peerConnection !== connection) return;
						console.error('Failed to add ICE candidate:', error);
					}
				}
				return;
			case 'channel_updated':
				patch({ channels: dedupeChannels(parsed.data.channels.map(normalizeChannel)) });
				return;
			case 'user_joined':
				updateUsers([...snapshot.users, normalizeUser(parsed.data)]);
				return;
			case 'user_left':
				removeRemoteAudio(`mumble-stream-${parsed.data.session_id}`);
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
				const nextUsers = snapshot.users.map((user) =>
					user.sessionId === parsed.data.session_id
						? {
								...user,
								...(parsed.data.channel_id != null && { channelId: parsed.data.channel_id }),
								...(parsed.data.name != null && { name: sanitizeString(parsed.data.name, 32) }),
								...(parsed.data.mute != null && { muted: parsed.data.mute }),
								...(parsed.data.deaf != null && { deafened: parsed.data.deaf }),
								...(parsed.data.self_mute != null && { selfMuted: parsed.data.self_mute }),
								...(parsed.data.self_deaf != null && { selfDeafened: parsed.data.self_deaf })
							}
						: user
				);
				updateUsers(nextUsers);
				return;
			}
			case 'error':
				if (
					parsed.data.code === 'mumble_disconnected' ||
					parsed.data.code === 'connect_failed' ||
					parsed.data.code === 'voice_error'
				) {
					failConnection(parsed.data.message);
				} else if (parsed.data.code === 'upgrade_required') {
					shouldReconnect = false;
					failConnection('语音服务已升级，请刷新网页。');
				} else {
					patch({ errorMessage: parsed.data.message });
					if (parsed.data.code === 'webrtc_disconnected') {
						patch({ voiceConnected: false, voiceFailed: true });
						recoverVoice(3000);
					}
				}
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
		pendingVoiceRequest = connectOptions?.requestVoice === true && mode === 'interactive';

		patch({
			status: reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
			reconnecting: reconnectAttempts > 0,
			errorMessage: ''
		});

		let nextSocket: WebSocket;
		try {
			nextSocket = new WebSocket(options.config.wsUrl);
		} catch (error) {
			const reason = error instanceof Error ? error.message : '无法创建 Mumble WebSocket 连接';
			patch({ errorMessage: reason });
			scheduleReconnect(reason);
			return;
		}
		socket = nextSocket;
		incomingMessages = Promise.resolve();
		clearSessionTimers();
		connectionTimer = setTimeout(() => {
			if (socket === nextSocket) failConnection('连接 Mumble 服务超时，正在重试。');
		}, 15000);

		nextSocket.onopen = () => {
			if (destroyed || socket !== nextSocket) return;
			sendEvent({ type: 'connect', data: { username: nickname } });
		};

		nextSocket.onmessage = (event) => {
			if (typeof event.data === 'string') {
				incomingMessages = incomingMessages
					.then(() => handleSocketMessage(event, nextSocket))
					.catch(() => {
						if (socket === nextSocket) failConnection('语音服务返回了无效消息，正在重试。');
					});
			}
		};

		nextSocket.onerror = () => {
			if (destroyed || socket !== nextSocket) return;
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

		shouldReconnect = true;
		reconnectAttempts = 0;
		clearReconnectTimer();
		clearSessionTimers();
		cleanupPeerConnection(false);
		patch({
			status: 'reconnecting',
			reconnecting: true,
			errorMessage: '',
			disconnectReason: ''
		});

		const existingSocket = socket;
		const nextConnectOptions = {
			requestVoice:
				connectOptions?.requestVoice ?? (mode === 'interactive' && snapshot.voiceRequested)
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
		clearSessionTimers();
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
		if (destroyed) {
			return;
		}
		destroyed = true;
		disconnect();
		listeners.clear();
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
		state: { subscribe: subscribeWithSnapshot, getSnapshot },
		subscribe,
		getSnapshot,
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
