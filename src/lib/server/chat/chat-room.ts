import { DurableObject } from 'cloudflare:workers';
import type { ChatClientEvent, ChatMessage, ChatServerEvent } from '../../types';
import {
	CHAT_MESSAGE_KEY_PREFIX,
	CHAT_RATE_LIMIT_MAX_MESSAGES,
	CHAT_RATE_LIMIT_WINDOW_MS,
	DEFAULT_CHAT_NICKNAME,
	MAX_CHAT_MESSAGE_LENGTH,
	normalizeNickname,
	normalizeText
} from './protocol';

interface SessionState {
	nickname: string;
	sentTimestamps: number[];
}

const SOCKET_OPEN = 1;
const HISTORY_MESSAGE_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseClientEvent(raw: string): ChatClientEvent | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed) || typeof parsed.type !== 'string') {
			return null;
		}

		if (
			(parsed.type === 'join' || parsed.type === 'rename') &&
			typeof parsed.nickname === 'string'
		) {
			return {
				type: parsed.type,
				nickname: parsed.nickname
			};
		}

		if (parsed.type === 'message' && typeof parsed.text === 'string') {
			return {
				type: 'message',
				text: parsed.text
			};
		}

		return null;
	} catch (error) {
		console.error('Failed to parse chat client event:', error);
		return null;
	}
}

export class ChatRoom extends DurableObject<App.Platform['env']> {
	private sessions = new Map<WebSocket, SessionState>();

	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'GET') {
			return new Response('Method not allowed', { status: 405 });
		}
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected websocket', { status: 426 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		server.accept();
		this.sessions.set(server, {
			nickname: DEFAULT_CHAT_NICKNAME,
			sentTimestamps: []
		});
		this.bindSocket(server);

		this.ctx.waitUntil(this.sendHistory(server));
		this.broadcastPresence();

		return new Response(null, { status: 101, webSocket: client });
	}

	private bindSocket(ws: WebSocket): void {
		ws.addEventListener('message', (event) => {
			this.ctx.waitUntil(this.handleSocketMessage(ws, event.data));
		});

		const closeHandler = () => {
			this.handleSocketClose(ws);
		};

		ws.addEventListener('close', closeHandler);
		ws.addEventListener('error', closeHandler);
	}

	private async handleSocketMessage(ws: WebSocket, payload: string | ArrayBuffer): Promise<void> {
		if (typeof payload !== 'string') {
			this.sendEvent(ws, { type: 'error', message: '只支持文本消息' });
			return;
		}

		const event = parseClientEvent(payload);
		if (!event) {
			this.sendEvent(ws, { type: 'error', message: '消息格式不正确' });
			return;
		}

		const session = this.sessions.get(ws);
		if (!session) {
			this.sendEvent(ws, { type: 'error', message: '会话不存在，请刷新重试' });
			return;
		}

		switch (event.type) {
			case 'join':
			case 'rename': {
				const nickname = normalizeNickname(event.nickname);
				if (!nickname) {
					this.sendEvent(ws, { type: 'error', message: '昵称不能为空' });
					return;
				}
				session.nickname = nickname;
				return;
			}
			case 'message': {
				const text = normalizeText(event.text);
				if (!text) {
					this.sendEvent(ws, { type: 'error', message: '消息不能为空' });
					return;
				}
				if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
					this.sendEvent(ws, {
						type: 'error',
						message: `消息不能超过 ${MAX_CHAT_MESSAGE_LENGTH} 字`
					});
					return;
				}

				const now = Date.now();
				session.sentTimestamps = session.sentTimestamps.filter(
					(timestamp) => now - timestamp < CHAT_RATE_LIMIT_WINDOW_MS
				);
				if (session.sentTimestamps.length >= CHAT_RATE_LIMIT_MAX_MESSAGES) {
					this.sendEvent(ws, { type: 'error', message: '发送过快，请稍后再试' });
					return;
				}
				session.sentTimestamps.push(now);

				const chatMessage: ChatMessage = {
					id: crypto.randomUUID(),
					nickname: session.nickname,
					text,
					timestamp: now
				};
				await this.appendMessage(chatMessage);
				this.broadcast({
					type: 'message',
					message: chatMessage
				});
				return;
			}
		}
	}

	private async sendHistory(ws: WebSocket): Promise<void> {
		const messages = await this.getRecentMessages();
		this.sendEvent(ws, {
			type: 'history',
			messages
		});
	}

	private async appendMessage(message: ChatMessage): Promise<void> {
		const key = `${CHAT_MESSAGE_KEY_PREFIX}${message.timestamp}:${message.id}`;
		await this.ctx.storage.put(key, message);
	}

	private async getRecentMessages(): Promise<ChatMessage[]> {
		const result = await this.ctx.storage.list<ChatMessage>({
			prefix: CHAT_MESSAGE_KEY_PREFIX,
			reverse: true,
			limit: HISTORY_MESSAGE_LIMIT
		});
		const messages = Array.from(result.values());
		messages.sort((a, b) => a.timestamp - b.timestamp);
		return messages;
	}

	private handleSocketClose(ws: WebSocket): void {
		if (!this.sessions.delete(ws)) {
			return;
		}
		this.broadcastPresence();
	}

	private broadcastPresence(): void {
		this.broadcast({ type: 'presence', online: this.sessions.size });
	}

	private sendEvent(ws: WebSocket, event: ChatServerEvent): void {
		if (ws.readyState !== SOCKET_OPEN) {
			return;
		}
		try {
			ws.send(JSON.stringify(event));
		} catch (error) {
			console.error('Failed to send chat event:', error);
			this.handleSocketClose(ws);
		}
	}

	private broadcast(event: ChatServerEvent): void {
		const serialized = JSON.stringify(event);
		for (const ws of this.sessions.keys()) {
			if (ws.readyState !== SOCKET_OPEN) {
				this.handleSocketClose(ws);
				continue;
			}
			try {
				ws.send(serialized);
			} catch (error) {
				console.error('Failed to broadcast chat event:', error);
				this.handleSocketClose(ws);
			}
		}
	}
}
