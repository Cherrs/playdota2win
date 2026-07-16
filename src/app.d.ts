// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env?: Cloudflare.Env & {
				ASSETS: Fetcher;
				APP_KV: KVNamespace;
				UPLOADS_BUCKET: R2Bucket;
				ADMIN_PASSWORD: string;
				ADMIN_SIGNING_SECRET: string;
				ADMIN_JWT_SECRET: string;
				TURNSTILE_SECRET_KEY: string;
				TURNSTILE_SITE_KEY: string;
				DOWNLOAD_PASSWORD: string;
				MUMBLE_PROXY_WS_URL?: string;
				MUMBLE_PROXY_HEALTH_URL?: string;
				MUMBLE_PROXY_STUN_SERVERS?: string;
				MUMBLE_PROXY_TURN_USERNAME?: string;
				MUMBLE_PROXY_TURN_CREDENTIAL?: string;
			};
			cf?: CfProperties;
			ctx?: ExecutionContext;
		}
	}
}

export {};
