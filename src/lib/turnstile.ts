/**
 * Cloudflare Turnstile 验证共享工具
 */

// 失败次数阈值，超过后需要 Turnstile 验证
export const FAILURE_THRESHOLD = 3;
// 失败计数过期时间（秒）
export const FAILURE_TTL = 60 * 15; // 15 分钟

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
	ip: string
): Promise<boolean> {
	if (!token || !secretKey) {
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
			body: formData
		});

		if (!response.ok) {
			console.error('Turnstile verification request failed:', response.status);
			return false;
		}

		const result = (await response.json()) as { success: boolean };
		return result.success;
	} catch (error) {
		console.error('Turnstile verification error:', error);
		return false;
	}
}

/**
 * 失败计数管理器
 */
export class FailureCounter {
	constructor(
		private kv: KVNamespace | undefined,
		private keyPrefix: string
	) {}

	/**
	 * 获取失败计数的 KV key
	 */
	private getKey(identifier: string): string {
		return `${this.keyPrefix}:${identifier}`;
	}

	/**
	 * 获取当前失败次数
	 */
	async getCount(identifier: string): Promise<number> {
		if (!this.kv) {
			return 0;
		}

		try {
			const stored = await this.kv.get(this.getKey(identifier));
			return stored ? parseInt(stored, 10) : 0;
		} catch (error) {
			console.error('Failed to get failure count:', error);
			return 0;
		}
	}

	/**
	 * 增加失败次数
	 */
	async increment(identifier: string): Promise<number> {
		if (!this.kv) {
			return 0;
		}

		try {
			const currentCount = await this.getCount(identifier);
			const newCount = currentCount + 1;
			await this.kv.put(this.getKey(identifier), newCount.toString(), {
				expirationTtl: FAILURE_TTL
			});
			return newCount;
		} catch (error) {
			console.error('Failed to increment failure count:', error);
			return 0;
		}
	}

	/**
	 * 清除失败次数
	 */
	async clear(identifier: string): Promise<void> {
		if (!this.kv) {
			return;
		}

		try {
			await this.kv.delete(this.getKey(identifier));
		} catch (error) {
			console.error('Failed to clear failure count:', error);
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
	return (
		request.headers.get('CF-Connecting-IP') ||
		request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
		'unknown'
	);
}

/**
 * Turnstile 验证状态
 */
export interface TurnstileStatus {
	required: boolean;
	siteKey: string;
	failureCount: number;
}

/**
 * 获取 Turnstile 验证状态
 */
export async function getTurnstileStatus(
	counter: FailureCounter,
	identifier: string,
	siteKey: string
): Promise<TurnstileStatus> {
	const failureCount = await counter.getCount(identifier);
	const required = failureCount >= FAILURE_THRESHOLD;

	return {
		required,
		siteKey: required ? siteKey : '',
		failureCount
	};
}
