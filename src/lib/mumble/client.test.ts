import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createMumbleClient } from './client.ts';

class FakeAudio {
	srcObject: MediaStream | null = null;
	autoplay = false;
	muted = false;

	pause(): void {}

	play(): Promise<void> {
		return Promise.resolve();
	}

	setAttribute(): void {}
}

class FakeMediaStreamTrack {
	enabled = true;
	stopCalls = 0;

	stop(): void {
		this.stopCalls += 1;
	}

	addEventListener(): void {}
}

class FakeMediaStream {
	private readonly tracks: FakeMediaStreamTrack[];

	constructor(tracks: FakeMediaStreamTrack[]) {
		this.tracks = tracks;
	}

	getTracks(): FakeMediaStreamTrack[] {
		return this.tracks;
	}

	getAudioTracks(): FakeMediaStreamTrack[] {
		return this.tracks;
	}
}

class FakeRTCPeerConnection {
	static instances: FakeRTCPeerConnection[] = [];

	ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
	onicecandidate:
		| ((event: {
				candidate: {
					candidate: string;
					sdpMid: string | null;
					sdpMLineIndex: number | null;
				} | null;
		  }) => void)
		| null = null;
	oniceconnectionstatechange: (() => void) | null = null;
	iceConnectionState: RTCIceConnectionState = 'new';

	config: RTCConfiguration;
	remoteDescription: RTCSessionDescriptionInit | null = null;
	candidates: RTCIceCandidateInit[] = [];
	calls: string[] = [];

	setConfiguration(config: RTCConfiguration): void {
		this.config = config;
	}
	setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
		this.remoteDescription = description;
		this.calls.push('remote');
		return Promise.resolve();
	}
	addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		assert.ok(this.remoteDescription, 'candidate arrived before SDP');
		this.candidates.push(candidate);
		this.calls.push('candidate');
		return Promise.resolve();
	}
	createAnswer(): Promise<RTCSessionDescriptionInit> {
		this.calls.push('answer');
		return Promise.resolve({ type: 'answer', sdp: 'fake-answer-sdp' });
	}

	constructor(config: RTCConfiguration) {
		this.config = config;
		FakeRTCPeerConnection.instances.push(this);
	}

	addTrack(): void {}

	getTransceivers(): Array<{ setCodecPreferences: (codecs: Array<{ mimeType: string }>) => void }> {
		return [{ setCodecPreferences: () => {} }];
	}

	createOffer(): Promise<RTCSessionDescriptionInit> {
		return Promise.resolve({ type: 'offer', sdp: 'fake-offer-sdp' });
	}

	setLocalDescription(): Promise<void> {
		return Promise.resolve();
	}

	close(): void {}
}

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	sent: string[] = [];
	readonly url: string;

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	send(payload: string): void {
		this.sent.push(payload);
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.();
	}

	close(): void {
		this.readyState = FakeWebSocket.CLOSING;
	}

	receive(payload: unknown): void {
		this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
	}

	completeClose(reason = ''): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.({ reason } as CloseEvent);
	}
}

async function flushAsyncWork(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

test('interactive connect waits for explicit voice enable before creating a peer connection', async () => {
	const originalWebSocket = globalThis.WebSocket;
	const originalRTCPeerConnection = globalThis.RTCPeerConnection;
	const originalRTCRtpReceiver = globalThis.RTCRtpReceiver;
	const originalAudio = globalThis.Audio;
	const originalNavigator = globalThis.navigator;

	FakeWebSocket.instances = [];
	FakeRTCPeerConnection.instances = [];

	const track = new FakeMediaStreamTrack();
	const localStream = new FakeMediaStream([track]);
	let getUserMediaCalls = 0;

	Object.defineProperty(globalThis, 'WebSocket', {
		configurable: true,
		value: FakeWebSocket
	});
	Object.defineProperty(globalThis, 'RTCPeerConnection', {
		configurable: true,
		value: FakeRTCPeerConnection
	});
	Object.defineProperty(globalThis, 'RTCRtpReceiver', {
		configurable: true,
		value: {
			getCapabilities: () => ({
				codecs: [{ mimeType: 'audio/opus' }]
			})
		}
	});
	Object.defineProperty(globalThis, 'Audio', {
		configurable: true,
		value: FakeAudio
	});
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			mediaDevices: {
				getUserMedia: async () => {
					getUserMediaCalls += 1;
					return localStream;
				}
			}
		}
	});

	try {
		const client = createMumbleClient({
			config: {
				wsUrl: 'ws://127.0.0.1:8080/ws',
				iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
				healthUrl: null
			},
			nickname: 'TestUser',
			mode: 'interactive'
		});

		client.connect();
		assert.equal(FakeWebSocket.instances.length, 1);

		const socket = FakeWebSocket.instances[0];
		socket.open();
		socket.receive({
			type: 'connected',
			data: {
				session_id: 1,
				channels: [{ id: 0, name: 'Root', parent_id: 0, description: '' }],
				users: [
					{
						session_id: 1,
						name: 'TestUser',
						channel_id: 0,
						mute: false,
						deaf: false,
						self_mute: false,
						self_deaf: false
					}
				]
			}
		});
		await flushAsyncWork();

		assert.equal(getUserMediaCalls, 0);
		assert.equal(FakeRTCPeerConnection.instances.length, 0);

		client.destroy();
	} finally {
		Object.defineProperty(globalThis, 'WebSocket', {
			configurable: true,
			value: originalWebSocket
		});
		Object.defineProperty(globalThis, 'RTCPeerConnection', {
			configurable: true,
			value: originalRTCPeerConnection
		});
		Object.defineProperty(globalThis, 'RTCRtpReceiver', {
			configurable: true,
			value: originalRTCRtpReceiver
		});
		Object.defineProperty(globalThis, 'Audio', {
			configurable: true,
			value: originalAudio
		});
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: originalNavigator
		});
	}
});

test('reconnect waits for the previous socket to close before opening a new session', async () => {
	const originalWebSocket = globalThis.WebSocket;
	const originalRTCPeerConnection = globalThis.RTCPeerConnection;
	const originalRTCRtpReceiver = globalThis.RTCRtpReceiver;
	const originalAudio = globalThis.Audio;
	const originalNavigator = globalThis.navigator;

	FakeWebSocket.instances = [];
	FakeRTCPeerConnection.instances = [];

	const track = new FakeMediaStreamTrack();
	const localStream = new FakeMediaStream([track]);

	Object.defineProperty(globalThis, 'WebSocket', {
		configurable: true,
		value: FakeWebSocket
	});
	Object.defineProperty(globalThis, 'RTCPeerConnection', {
		configurable: true,
		value: FakeRTCPeerConnection
	});
	Object.defineProperty(globalThis, 'RTCRtpReceiver', {
		configurable: true,
		value: {
			getCapabilities: () => ({
				codecs: [{ mimeType: 'audio/opus' }]
			})
		}
	});
	Object.defineProperty(globalThis, 'Audio', {
		configurable: true,
		value: FakeAudio
	});
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			mediaDevices: {
				getUserMedia: async () => localStream
			}
		}
	});

	try {
		const client = createMumbleClient({
			config: {
				wsUrl: 'ws://127.0.0.1:8080/ws',
				iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
				healthUrl: null
			},
			nickname: 'TestUser',
			mode: 'interactive'
		});

		client.connect({ requestVoice: true });
		assert.equal(FakeWebSocket.instances.length, 1);

		const firstSocket = FakeWebSocket.instances[0];
		firstSocket.open();
		firstSocket.receive({
			type: 'connected',
			data: {
				session_id: 1,
				channels: [{ id: 0, name: 'Root', parent_id: 0, description: '' }],
				users: [
					{
						session_id: 1,
						name: 'TestUser',
						channel_id: 0,
						mute: false,
						deaf: false,
						self_mute: false,
						self_deaf: false
					}
				]
			}
		});
		await flushAsyncWork();

		assert.equal(FakeRTCPeerConnection.instances.length, 1);

		client.reconnect({ requestVoice: true });

		assert.equal(firstSocket.readyState, FakeWebSocket.CLOSING);
		assert.equal(FakeWebSocket.instances.length, 1);
		assert.equal(track.stopCalls, 0);

		firstSocket.completeClose('manual reconnect');
		await flushAsyncWork();

		assert.equal(FakeWebSocket.instances.length, 2);
		assert.equal(FakeWebSocket.instances[1].url, 'ws://127.0.0.1:8080/ws');

		client.destroy();
	} finally {
		Object.defineProperty(globalThis, 'WebSocket', {
			configurable: true,
			value: originalWebSocket
		});
		Object.defineProperty(globalThis, 'RTCPeerConnection', {
			configurable: true,
			value: originalRTCPeerConnection
		});
		Object.defineProperty(globalThis, 'RTCRtpReceiver', {
			configurable: true,
			value: originalRTCRtpReceiver
		});
		Object.defineProperty(globalThis, 'Audio', {
			configurable: true,
			value: originalAudio
		});
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: originalNavigator
		});
	}
});

test('external-store subscribers receive immutable snapshots and can unsubscribe', () => {
	const client = createMumbleClient({
		config: {
			wsUrl: 'ws://127.0.0.1:8080/ws',
			iceServers: [],
			healthUrl: null
		},
		nickname: 'StoreUser',
		mode: 'interactive'
	});
	const initialSnapshot = client.getSnapshot();
	let notifications = 0;
	const observedSnapshots: boolean[] = [];
	const unsubscribeState = client.state.subscribe((snapshot) => {
		observedSnapshots.push(snapshot.muted);
	});
	const unsubscribe = client.subscribe(() => {
		notifications += 1;
	});

	client.setMuted(true);

	assert.equal(notifications, 1);
	assert.notEqual(client.getSnapshot(), initialSnapshot);
	assert.equal(client.getSnapshot().muted, true);
	assert.deepEqual(observedSnapshots, [false, true]);

	unsubscribe();
	unsubscribeState();
	client.setMuted(false);
	assert.equal(notifications, 1);
	client.destroy();
});

test('destroy stops a microphone stream that resolves after the client is gone', async () => {
	const originalNavigator = globalThis.navigator;
	const track = new FakeMediaStreamTrack();
	const localStream = new FakeMediaStream([track]);
	let resolveUserMedia!: (stream: MediaStream) => void;
	const userMediaPromise = new Promise<MediaStream>((resolve) => {
		resolveUserMedia = resolve;
	});

	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			mediaDevices: {
				getUserMedia: () => userMediaPromise
			}
		}
	});

	try {
		const client = createMumbleClient({
			config: {
				wsUrl: 'ws://127.0.0.1:8080/ws',
				iceServers: [],
				healthUrl: null
			},
			nickname: 'LatePermissionUser',
			mode: 'interactive'
		});

		const voiceRequest = client.ensureVoice();
		client.destroy();
		resolveUserMedia(localStream as unknown as MediaStream);
		await voiceRequest;

		assert.equal(track.stopCalls, 1);
		assert.equal(client.getSnapshot().voiceAvailable, false);
		assert.equal(client.getSnapshot().voiceConnected, false);
	} finally {
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: originalNavigator
		});
	}
});

function setupV2Client(t: TestContext) {
	const keys = ['WebSocket', 'RTCPeerConnection', 'Audio', 'navigator'] as const;
	const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
	const track = new FakeMediaStreamTrack();
	FakeWebSocket.instances = [];
	FakeRTCPeerConnection.instances = [];
	const values = [
		FakeWebSocket,
		FakeRTCPeerConnection,
		FakeAudio,
		{
			mediaDevices: { getUserMedia: async () => new FakeMediaStream([track]) }
		}
	];
	keys.forEach((key, index) =>
		Object.defineProperty(globalThis, key, { configurable: true, value: values[index] })
	);
	const client = createMumbleClient({
		config: { wsUrl: 'wss://voice.example.com/ws', iceServers: [], healthUrl: null },
		nickname: 'v2',
		autoReconnect: false
	});
	t.after(() => {
		client.destroy();
		keys.forEach((key, index) => {
			const original = originals[index];
			if (original) Object.defineProperty(globalThis, key, original);
			else Reflect.deleteProperty(globalThis, key);
		});
	});
	client.connect({ requestVoice: true });
	const socket = FakeWebSocket.instances[0];
	socket.open();
	const ice = {
		ice_servers: [
			{
				urls: 'turn:voice.example.com:3478?transport=udp',
				username: 'session-user',
				credential: 'session-secret'
			}
		],
		expires_at: Math.floor(Date.now() / 1000) + 300
	};
	socket.receive({
		type: 'connected',
		data: { protocol_version: 2, ice, session_id: 1, users: [], channels: [] }
	});
	return { client, socket, ice, track };
}

test('v2 uses session credentials and answers server offers after queued candidates', async (t) => {
	const { socket, ice } = setupV2Client(t);
	await flushAsyncWork();
	const peer = FakeRTCPeerConnection.instances[0];
	assert.deepEqual(peer.config.iceServers, ice.ice_servers);
	assert.deepEqual(
		socket.sent.map((message) => JSON.parse(message).type),
		['connect', 'start_voice']
	);
	socket.receive({
		type: 'ice_candidate',
		data: { candidate: 'early', sdp_mid: '0', sdp_mline_index: 0 }
	});
	socket.receive({ type: 'offer', data: { sdp: 'server-offer' } });
	socket.receive({
		type: 'ice_candidate',
		data: { candidate: 'late', sdp_mid: '0', sdp_mline_index: 0 }
	});
	await flushAsyncWork();
	assert.deepEqual(peer.calls, ['remote', 'candidate', 'answer', 'candidate']);
	assert.equal(JSON.parse(socket.sent.at(-1)!).type, 'answer');
});

test('upstream failure clears connected state even if WebSocket stays open', async (t) => {
	const { client, socket, track } = setupV2Client(t);
	await flushAsyncWork();
	assert.equal(client.getSnapshot().connected, true);
	socket.receive({
		type: 'error',
		data: { code: 'mumble_disconnected', message: 'upstream closed' }
	});
	await flushAsyncWork();
	assert.equal(client.getSnapshot().connected, false);
	assert.equal(client.getSnapshot().status, 'disconnected');
	assert.equal(client.getSnapshot().sessionId, null);
	assert.equal(socket.readyState, FakeWebSocket.CLOSING);
	assert.equal(track.stopCalls, 0);
});

test('failed ICE refreshes credentials and restarts before reconnecting on timeout', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const { socket, client, ice } = setupV2Client(t);
	await flushAsyncWork();
	const peer = FakeRTCPeerConnection.instances[0];
	peer.iceConnectionState = 'failed';
	peer.oniceconnectionstatechange?.();
	t.mock.timers.tick(1);
	assert.equal(JSON.parse(socket.sent.at(-1)!).type, 'ice_refresh');
	socket.receive({ type: 'ice_config', data: ice });
	await flushAsyncWork();
	assert.equal(JSON.parse(socket.sent.at(-1)!).type, 'ice_restart');
	socket.receive({
		type: 'error',
		data: { code: 'webrtc_disconnected', message: 'same ICE failure reported by server' }
	});
	await flushAsyncWork();
	t.mock.timers.tick(3000);
	assert.equal(
		client.getSnapshot().connected,
		true,
		'duplicate failure must not interrupt an ongoing restart'
	);
	t.mock.timers.tick(12000);
	assert.equal(client.getSnapshot().connected, false);
	assert.match(client.getSnapshot().errorMessage, /超时/);
});

test('credentials refresh before expiry and install rotated credentials for restart', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
	const { socket, ice } = setupV2Client(t);
	await flushAsyncWork();
	const peer = FakeRTCPeerConnection.instances[0];
	peer.iceConnectionState = 'connected';
	peer.oniceconnectionstatechange?.();
	t.mock.timers.tick(240000);
	assert.equal(JSON.parse(socket.sent.at(-1)!).type, 'ice_refresh');
	const rotated = {
		ice_servers: [{ ...ice.ice_servers[0], username: 'rotated', credential: 'new-secret' }],
		expires_at: 1540
	};
	socket.receive({ type: 'ice_config', data: rotated });
	await flushAsyncWork();
	assert.deepEqual(peer.config.iceServers, rotated.ice_servers);
	assert.equal(JSON.parse(socket.sent.at(-1)!).type, 'ice_restart');
});

test('a WebSocket that never finishes connecting times out', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const original = globalThis.WebSocket;
	Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket });
	const client = createMumbleClient({
		config: { wsUrl: 'wss://voice.example.com/ws', iceServers: [], healthUrl: null },
		nickname: 'timeout',
		autoReconnect: false
	});
	t.after(() => {
		client.destroy();
		Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: original });
	});
	client.connect();
	t.mock.timers.tick(15000);
	assert.equal(client.getSnapshot().status, 'disconnected');
	assert.match(client.getSnapshot().errorMessage, /超时/);
});
