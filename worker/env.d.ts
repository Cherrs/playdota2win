interface Env {
	ADMIN_PASSWORD?: string;
	ADMIN_SIGNING_SECRET?: string;
	ADMIN_JWT_SECRET?: string;
	TURNSTILE_SECRET_KEY?: string;
	TURNSTILE_SITE_KEY?: string;
	DOWNLOAD_PASSWORD?: string;
	MUMBLE_PROXY_TURN_USERNAME?: string;
	MUMBLE_PROXY_TURN_CREDENTIAL?: string;
}

declare namespace Cloudflare {
	interface Env {
		ADMIN_PASSWORD?: string;
		ADMIN_SIGNING_SECRET?: string;
		ADMIN_JWT_SECRET?: string;
		TURNSTILE_SECRET_KEY?: string;
		TURNSTILE_SITE_KEY?: string;
		DOWNLOAD_PASSWORD?: string;
		MUMBLE_PROXY_TURN_USERNAME?: string;
		MUMBLE_PROXY_TURN_CREDENTIAL?: string;
	}
}
