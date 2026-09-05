/** Environment fields consumed by framework-independent shared helpers. */
export interface RuntimeEnvironment {
	DOWNLOAD_PASSWORD?: string;
	MUMBLE_PROXY_WS_URL?: string;
	MUMBLE_PROXY_HEALTH_URL?: string;
}

export interface RuntimePlatform {
	env?: RuntimeEnvironment;
}
