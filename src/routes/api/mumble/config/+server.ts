import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, MumbleProxyConfig } from '$lib/types';
import { getMumbleProxyConfig, getMumbleProxyHealthUrl } from '$lib/server/mumble/config';

export const GET: RequestHandler = async ({ platform, url }) => {
	const config = await getMumbleProxyConfig(platform, url);
	if (!config) {
		return json(
			{
				success: false,
				error: 'Mumble 代理地址尚未配置'
			} satisfies ApiResponse<MumbleProxyConfig>,
			{
				status: 503,
				headers: { 'Cache-Control': 'no-store' }
			}
		);
	}

	return json(
		{
			success: true,
			data: { ...config, healthUrl: getMumbleProxyHealthUrl(platform, url) }
		} satisfies ApiResponse<MumbleProxyConfig>,
		{
			headers: { 'Cache-Control': 'no-store' }
		}
	);
};
