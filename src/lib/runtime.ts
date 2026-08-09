/** Environment fields consumed by framework-independent shared helpers. */
export interface RuntimeEnvironment {
	DOWNLOAD_PASSWORD?: string;
	MUMBLE_PROXY_WS_URL?: string;
	MUMBLE_PROXY_HEALTH_URL?: string;
	MUMBLE_PROXY_STUN_SERVERS?: string;
	MUMBLE_PROXY_TURN_USERNAME?: string;
	MUMBLE_PROXY_TURN_CREDENTIAL?: string;
}

export interface RuntimePlatform {
	env?: RuntimeEnvironment;
}
