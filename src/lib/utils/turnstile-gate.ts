export interface TurnstileGateState {
	required: boolean;
	unavailable: boolean;
}

/** 根据失败次数和密钥配置决定是否要求或阻断 Turnstile。 */
export function getTurnstileGateState(
	failureCount: number,
	failureThreshold: number,
	siteKey: string,
	secretKey: string
): TurnstileGateState {
	const thresholdReached = failureCount >= failureThreshold;
	const configured = Boolean(siteKey && secretKey);
	return {
		required: thresholdReached && configured,
		unavailable: thresholdReached && !configured
	};
}
