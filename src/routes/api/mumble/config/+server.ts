import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, MumbleProxyConfig } from '$lib/types';
import { getMumbleProxyConfig } from '$lib/server/mumble/config';

export const GET: RequestHandler = async ({ platform }) => {
	const config = getMumbleProxyConfig(platform);
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
			data: config
		} satisfies ApiResponse<MumbleProxyConfig>,
		{
			headers: { 'Cache-Control': 'no-store' }
		}
	);
};
