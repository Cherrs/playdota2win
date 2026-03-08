import assert from 'node:assert/strict';
import test from 'node:test';
import { get } from 'svelte/store';

import { createMumbleClient, type MumbleClientSnapshot } from './client.ts';

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

	readonly config: RTCConfiguration;

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

test('interactive connect auto-requests voice and starts muted by default', async () => {
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

		assert.equal(getUserMediaCalls, 1);
		assert.equal(FakeRTCPeerConnection.instances.length, 1);
		assert.equal(track.enabled, false);

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

test('reconnect preserves local mute and text-only intent', async () => {
	const originalWebSocket = globalThis.WebSocket;
	const originalRTCPeerConnection = globalThis.RTCPeerConnection;
	const originalRTCRtpReceiver = globalThis.RTCRtpReceiver;
	const originalAudio = globalThis.Audio;
	const originalNavigator = globalThis.navigator;

	FakeWebSocket.instances = [];
	FakeRTCPeerConnection.instances = [];

	const track = new FakeMediaStreamTrack();
	const localStream = new FakeMediaStream([track]);
	const connectedPayload = {
		type: 'connected' as const,
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
	};

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
		const snapshots: MumbleClientSnapshot[] = [];
		const unsubscribe = client.state.subscribe((value) => snapshots.push(value));

		client.connect();
		assert.equal(FakeWebSocket.instances.length, 1);

		const firstSocket = FakeWebSocket.instances[0];
		firstSocket.open();
		firstSocket.receive(connectedPayload);
		await flushAsyncWork();

		client.setMuted(false);
		client.setDeafened(true);
		client.reconnect();
		firstSocket.completeClose('manual reconnect');
		await flushAsyncWork();

		assert.equal(FakeWebSocket.instances.length, 2);

		const secondSocket = FakeWebSocket.instances[1];
		secondSocket.open();
		secondSocket.receive(connectedPayload);
		await flushAsyncWork();

		const lastSnapshot = snapshots.at(-1);
		assert.equal(track.enabled, true);
		assert.equal(lastSnapshot?.muted, false);
		assert.equal(lastSnapshot?.deafened, true);
		assert.equal(
			secondSocket.sent.some((payload) => /"type":"mute"/.test(payload)),
			true
		);
		assert.equal(
			secondSocket.sent.some((payload) => /"type":"deafen"/.test(payload)),
			true
		);

		unsubscribe();
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

test('auto reconnect preserves local mute and text-only intent', async () => {
	const originalWebSocket = globalThis.WebSocket;
	const originalRTCPeerConnection = globalThis.RTCPeerConnection;
	const originalRTCRtpReceiver = globalThis.RTCRtpReceiver;
	const originalAudio = globalThis.Audio;
	const originalNavigator = globalThis.navigator;
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;

	FakeWebSocket.instances = [];
	FakeRTCPeerConnection.instances = [];

	const track = new FakeMediaStreamTrack();
	const localStream = new FakeMediaStream([track]);
	const connectedPayload = {
		type: 'connected' as const,
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
	};
	let nextTimerId = 0;
	const pendingTimers = new Map<number, () => void>();

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
	Object.defineProperty(globalThis, 'setTimeout', {
		configurable: true,
		value: ((callback: () => void) => {
			const timerId = ++nextTimerId;
			pendingTimers.set(timerId, callback);
			queueMicrotask(() => {
				const pending = pendingTimers.get(timerId);
				if (pending) {
					pendingTimers.delete(timerId);
					pending();
				}
			});
			return timerId as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout
	});
	Object.defineProperty(globalThis, 'clearTimeout', {
		configurable: true,
		value: ((timerId: ReturnType<typeof setTimeout>) => {
			pendingTimers.delete(Number(timerId));
		}) as typeof clearTimeout
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
		const snapshots: MumbleClientSnapshot[] = [];
		const unsubscribe = client.state.subscribe((value) => snapshots.push(value));

		client.connect();
		assert.equal(FakeWebSocket.instances.length, 1);

		const firstSocket = FakeWebSocket.instances[0];
		firstSocket.open();
		firstSocket.receive(connectedPayload);
		await flushAsyncWork();

		client.setMuted(false);
		client.setDeafened(true);
		firstSocket.completeClose('proxy reset');
		await flushAsyncWork();

		assert.equal(FakeWebSocket.instances.length, 2);

		const reconnectSnapshot = snapshots.at(-1);
		assert.equal(reconnectSnapshot?.status, 'reconnecting');
		assert.equal(reconnectSnapshot?.muted, false);
		assert.equal(reconnectSnapshot?.deafened, true);

		const secondSocket = FakeWebSocket.instances[1];
		secondSocket.open();
		secondSocket.receive(connectedPayload);
		await flushAsyncWork();

		const lastSnapshot = snapshots.at(-1);
		assert.equal(track.enabled, true);
		assert.equal(lastSnapshot?.muted, false);
		assert.equal(lastSnapshot?.deafened, true);
		assert.equal(
			secondSocket.sent.some((payload) => /"type":"mute"/.test(payload)),
			true
		);
		assert.equal(
			secondSocket.sent.some((payload) => /"type":"deafen"/.test(payload)),
			true
		);

		unsubscribe();
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
		Object.defineProperty(globalThis, 'setTimeout', {
			configurable: true,
			value: originalSetTimeout
		});
		Object.defineProperty(globalThis, 'clearTimeout', {
			configurable: true,
			value: originalClearTimeout
		});
	}
});

test('local mute and deafen are not overwritten by self user_state events', async () => {
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
		const snapshots: MumbleClientSnapshot[] = [];
		const unsubscribe = client.state.subscribe((value) => snapshots.push(value));

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

		client.setMuted(false);
		client.setDeafened(true);
		socket.receive({
			type: 'user_state',
			data: {
				session_id: 1,
				mute: true,
				deaf: false,
				self_mute: true,
				self_deaf: false
			}
		});

		const lastSnapshot = snapshots.at(-1);
		assert.equal(lastSnapshot?.muted, false);
		assert.equal(lastSnapshot?.deafened, true);
		assert.deepEqual(lastSnapshot?.users[0], {
			sessionId: 1,
			name: 'TestUser',
			channelId: 0,
			muted: true,
			deafened: false,
			selfMuted: true,
			selfDeafened: false
		});

		unsubscribe();
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

test('explicit voice opt-out persists across reconnects', async () => {
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

		client.connect({ requestVoice: false });
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

		assert.equal(getUserMediaCalls, 0);
		assert.equal(FakeRTCPeerConnection.instances.length, 0);

		client.reconnect();
		firstSocket.completeClose('manual reconnect');
		await flushAsyncWork();

		assert.equal(FakeWebSocket.instances.length, 2);

		const secondSocket = FakeWebSocket.instances[1];
		secondSocket.open();
		secondSocket.receive({
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

test('explicit voice opt-out does not recreate voice on warmed reconnect', async () => {
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

		assert.equal(getUserMediaCalls, 1);
		assert.equal(FakeRTCPeerConnection.instances.length, 1);
		assert.equal(track.stopCalls, 0);

		client.reconnect({ requestVoice: false });
		firstSocket.completeClose('manual reconnect');
		await flushAsyncWork();

		assert.equal(FakeWebSocket.instances.length, 2);
		assert.equal(track.stopCalls, 1);
		assert.equal(get(client.state).voiceRequested, false);
		assert.equal(get(client.state).voiceAvailable, false);

		const secondSocket = FakeWebSocket.instances[1];
		secondSocket.open();
		secondSocket.receive({
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

		assert.equal(getUserMediaCalls, 1);
		assert.equal(FakeRTCPeerConnection.instances.length, 1);
		assert.equal(track.stopCalls, 1);
		assert.equal(get(client.state).voiceRequested, false);
		assert.equal(get(client.state).voiceAvailable, false);

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
