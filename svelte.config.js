import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'base-uri': ['self'],
				'object-src': ['none'],
				'frame-ancestors': ['none'],
				'form-action': ['self'],
				'script-src': ['self', 'https://challenges.cloudflare.com'],
				// Svelte 的动态 style 属性和 transition 需要 inline style；脚本仍使用 nonce/hash。
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'worker-src': ['self', 'blob:'],
				'connect-src': [
					'self',
					// 管理页需要把文件直接 PUT 到用户提供的 HTTPS S3 预签名地址。
					'https:',
					'https://challenges.cloudflare.com',
					'wss://voice.playdota2.win'
				],
				'frame-src': ['https://challenges.cloudflare.com']
			}
		}
	}
};

export default config;
