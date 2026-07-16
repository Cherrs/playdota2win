import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdminAuth } from '$lib/admin-auth';
import type { ApiResponse, MumbleProxyHealth } from '$lib/types';
import { getMumbleProxyHealthUrl } from '$lib/server/mumble/config';

export const GET: RequestHandler = async ({ request, fetch, platform, url }) => {
	const authed = await requireAdminAuth(request, platform?.env?.ADMIN_JWT_SECRET);
	if (!authed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	const healthUrl = getMumbleProxyHealthUrl(platform, url);
	if (!healthUrl) {
		return json(
			{
				success: false,
				error: 'Mumble 代理健康检查地址尚未配置'
			} satisfies ApiResponse<MumbleProxyHealth>,
			{ status: 503 }
		);
	}

	const checkedAt = Date.now();

	try {
		const response = await fetch(healthUrl, {
			headers: { Accept: 'text/plain' }
		});
		const message = (await response.text()).trim() || response.statusText || 'unknown';

		return json({
			success: true,
			data: {
				healthy: response.ok && message.toLowerCase() === 'ok',
				status: response.status,
				message,
				checkedAt,
				url: healthUrl
			}
		} satisfies ApiResponse<MumbleProxyHealth>);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'health request failed';
		return json({
			success: false,
			error: message
		} satisfies ApiResponse<MumbleProxyHealth>);
	}
};
