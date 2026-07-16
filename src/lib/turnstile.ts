/**
 * Cloudflare Turnstile 验证共享工具
 */

import { getTurnstileGateState } from './utils/turnstile-gate.ts';

// 失败次数阈值，超过后需要 Turnstile 验证
export const FAILURE_THRESHOLD = 3;
// 失败计数过期时间（秒）
export const FAILURE_TTL = 60 * 15; // 15 分钟
const TURNSTILE_VERIFY_TIMEOUT_MS = 10_000;
export const TURNSTILE_ACTION = 'turnstile-spin-v1';
export type TurnstileFlow = 'admin-auth' | 'download-auth';

interface TurnstileSiteverifyResult {
	success?: boolean;
	hostname?: string;
	action?: string;
	cdata?: string;
	'error-codes'?: string[];
}

interface FailureCounterRecord {
	count: number;
	expiresAt: number;
}

interface FailureCounterSnapshot {
	count: number;
	version: string | null;
}

export class FailureCounterUnavailableError extends Error {
	constructor(message = 'Failure counter unavailable', options?: ErrorOptions) {
		super(message, options);
		this.name = 'FailureCounterUnavailableError';
	}
}

export function isExpectedTurnstileResult(
	result: TurnstileSiteverifyResult,
	flow: TurnstileFlow,
	expectedHostname: string
): boolean {
	return (
		result.success === true &&
		result.action === TURNSTILE_ACTION &&
		result.cdata === flow &&
		Boolean(expectedHostname) &&
		result.hostname?.toLowerCase() === expectedHostname.toLowerCase()
	);
}

/**
 * 验证 Turnstile token
 * @param token Turnstile token
 * @param secretKey Turnstile secret key
 * @param ip 客户端 IP 地址
 * @returns 验证是否成功
 */
export async function verifyTurnstile(
	token: string,
	secretKey: string,
	ip: string,
	flow: TurnstileFlow,
	expectedHostname: string
): Promise<boolean> {
	if (!token || token.length > 4096 || !secretKey || !expectedHostname) {
		return false;
	}

	try {
		const formData = new URLSearchParams();
		formData.append('secret', secretKey);
		formData.append('response', token);
		formData.append('remoteip', ip);

		const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: formData,
			signal: AbortSignal.timeout(TURNSTILE_VERIFY_TIMEOUT_MS)
		});

		if (!response.ok) {
			console.error('Turnstile verification request failed:', response.status);
			return false;
		}

		const result = (await response.json()) as TurnstileSiteverifyResult;
		const valid = isExpectedTurnstileResult(result, flow, expectedHostname);
		if (!valid) {
			console.warn({
				component: flow === 'admin-auth' ? 'admin_auth' : 'download_auth',
				event_name: 'turnstile_verification_rejected',
				success: result.success === true,
				action_matches: result.action === TURNSTILE_ACTION,
				flow_matches: result.cdata === flow,
				hostname_matches: result.hostname?.toLowerCase() === expectedHostname.toLowerCase(),
				error_codes: result['error-codes'] ?? []
			});
		}
		return valid;
	} catch (error) {
		console.error('Turnstile verification error:', error);
		return false;
	}
}

/**
 * 失败计数管理器
 */
export class FailureCounter {
	private r2Snapshots = new Map<string, FailureCounterSnapshot>();

	constructor(
		private kv: KVNamespace | undefined,
		private keyPrefix: string,
		private r2?: R2Bucket,
		private allowKvOnlyForLocalDevelopment = false
	) {}

	private assertStorageMode(): void {
		if (!this.r2 && !this.allowKvOnlyForLocalDevelopment) {
			throw new FailureCounterUnavailableError(
				'R2 failure-counter binding is required outside explicit local development'
			);
		}
	}

	/**
	 * 获取失败计数的 KV key
	 */
	private getKey(identifier: string): string {
		return `${this.keyPrefix}:${identifier}`;
	}

	private async getR2Key(identifier: string): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identifier));
		const hash = Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		return `.security/failure-counters/${this.keyPrefix.replace(/[^a-z0-9_-]/gi, '_')}/${hash}.json`;
	}

	private async readR2Snapshot(identifier: string): Promise<FailureCounterSnapshot> {
		if (!this.r2) return { count: 0, version: null };
		const object = await this.r2.get(await this.getR2Key(identifier));
		if (!object) {
			const snapshot = { count: 0, version: null };
			this.r2Snapshots.set(identifier, snapshot);
			return snapshot;
		}

		let value: unknown;
		try {
			value = await object.json<unknown>();
		} catch {
			value = undefined;
		}
		const record = value as Partial<FailureCounterRecord> | undefined;
		const valid =
			record !== undefined &&
			Number.isSafeInteger(record.count) &&
			(record.count ?? -1) >= 0 &&
			Number.isSafeInteger(record.expiresAt) &&
			(record.expiresAt ?? -1) >= 0;
		const count = !valid
			? FAILURE_THRESHOLD
			: (record.expiresAt ?? 0) <= Date.now()
				? 0
				: Math.min(record.count ?? FAILURE_THRESHOLD, FAILURE_THRESHOLD);
		const snapshot = { count, version: object.etag };
		this.r2Snapshots.set(identifier, snapshot);
		return snapshot;
	}

	/**
	 * 获取当前失败次数
	 */
	async getCount(identifier: string): Promise<number> {
		this.assertStorageMode();
		if (this.r2) {
			try {
				return (await this.readR2Snapshot(identifier)).count;
			} catch (error) {
				console.error('Failed to get R2 failure count:', error);
				throw new FailureCounterUnavailableError(undefined, { cause: error });
			}
		}
		if (!this.kv) {
			return 0;
		}

		try {
			const stored = await this.kv.get(this.getKey(identifier));
			if (!stored) return 0;
			const parsed = Number.parseInt(stored, 10);
			return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : FAILURE_THRESHOLD;
		} catch (error) {
			console.error('Failed to get failure count:', error);
			throw new FailureCounterUnavailableError(undefined, { cause: error });
		}
	}

	/**
	 * 增加失败次数
	 */
	async increment(identifier: string, currentCount?: number): Promise<number> {
		this.assertStorageMode();
		if (this.r2) {
			try {
				let snapshot = this.r2Snapshots.get(identifier);
				if (!snapshot || (currentCount !== undefined && snapshot.count !== currentCount)) {
					snapshot = await this.readR2Snapshot(identifier);
				}
				for (let attempt = 0; attempt < 5; attempt += 1) {
					if (snapshot.count >= FAILURE_THRESHOLD) return FAILURE_THRESHOLD;
					const nextCount = snapshot.count + 1;
					const stored = await this.r2.put(
						await this.getR2Key(identifier),
						JSON.stringify({
							count: nextCount,
							expiresAt: Date.now() + FAILURE_TTL * 1000
						} satisfies FailureCounterRecord),
						{
							onlyIf: snapshot.version
								? { etagMatches: snapshot.version }
								: { etagDoesNotMatch: '*' },
							httpMetadata: { contentType: 'application/json; charset=utf-8' }
						}
					);
					if (stored) {
						this.r2Snapshots.set(identifier, { count: nextCount, version: stored.etag });
						return nextCount;
					}
					snapshot = await this.readR2Snapshot(identifier);
				}
				throw new Error('Failure counter update conflicted repeatedly');
			} catch (error) {
				console.error('Failed to increment R2 failure count:', error);
				throw new FailureCounterUnavailableError(undefined, { cause: error });
			}
		}
		if (!this.kv) {
			return 0;
		}

		try {
			const storedCount = currentCount ?? (await this.getCount(identifier));
			const newCount = Math.min(storedCount + 1, Number.MAX_SAFE_INTEGER);
			await this.kv.put(this.getKey(identifier), newCount.toString(), {
				expirationTtl: FAILURE_TTL
			});
			return newCount;
		} catch (error) {
			console.error('Failed to increment failure count:', error);
			throw new FailureCounterUnavailableError(undefined, { cause: error });
		}
	}

	/**
	 * 清除失败次数
	 */
	async clear(identifier: string): Promise<void> {
		this.assertStorageMode();
		if (this.r2) {
			try {
				const snapshot =
					this.r2Snapshots.get(identifier) ?? (await this.readR2Snapshot(identifier));
				if (!snapshot.version) return;
				const stored = await this.r2.put(
					await this.getR2Key(identifier),
					JSON.stringify({ count: 0, expiresAt: Date.now() } satisfies FailureCounterRecord),
					{
						onlyIf: { etagMatches: snapshot.version },
						httpMetadata: { contentType: 'application/json; charset=utf-8' }
					}
				);
				if (stored) this.r2Snapshots.set(identifier, { count: 0, version: stored.etag });
				return;
			} catch (error) {
				console.error('Failed to clear R2 failure count:', error);
				throw new FailureCounterUnavailableError(undefined, { cause: error });
			}
		}
		if (!this.kv) {
			return;
		}

		try {
			await this.kv.delete(this.getKey(identifier));
		} catch (error) {
			console.error('Failed to clear failure count:', error);
			throw new FailureCounterUnavailableError(undefined, { cause: error });
		}
	}

	/**
	 * 检查是否需要 Turnstile 验证
	 */
	async requiresTurnstile(identifier: string): Promise<boolean> {
		const count = await this.getCount(identifier);
		return count >= FAILURE_THRESHOLD;
	}
}

/**
 * 从请求头获取客户端 IP
 */
export function getClientIp(request: Request): string {
	const connectingIp = request.headers.get('CF-Connecting-IP')?.trim();
	if (connectingIp && connectingIp.length <= 64) return connectingIp;

	// X-Forwarded-For 在公网上可以由客户端伪造，只在本地开发时使用。
	try {
		const hostname = new URL(request.url).hostname;
		if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
			const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0].trim();
			if (forwarded && forwarded.length <= 64) return forwarded;
			return '127.0.0.1';
		}
	} catch {
		// 如果 URL 异常，使用受限的共享 key 并让验证门槛保持失效关闭。
	}
	return 'missing-cloudflare-ip';
}

/**
 * Turnstile 验证状态
 */
export interface TurnstileStatus {
	required: boolean;
	siteKey: string;
	failureCount: number;
	/** 已达到验证阈值，但环境缺少 Site Key 或 Secret Key。 */
	unavailable: boolean;
}

/**
 * 获取 Turnstile 验证状态
 */
export async function getTurnstileStatus(
	counter: FailureCounter,
	identifier: string,
	siteKey: string,
	secretKey: string
): Promise<TurnstileStatus> {
	const failureCount = await counter.getCount(identifier);
	const gate = getTurnstileGateState(failureCount, FAILURE_THRESHOLD, siteKey, secretKey);

	return {
		required: gate.required,
		siteKey: gate.required ? siteKey : '',
		failureCount,
		unavailable: gate.unavailable
	};
}

export function logTurnstileConfigurationError(
	component: 'download_auth' | 'admin_auth',
	siteKey: string,
	secretKey: string,
	failureCount: number
): void {
	console.error({
		component,
		event_name: 'turnstile_configuration_missing',
		message: 'Turnstile is required but not fully configured',
		failure_count: failureCount,
		site_key_configured: Boolean(siteKey),
		secret_key_configured: Boolean(secretKey)
	});
}
