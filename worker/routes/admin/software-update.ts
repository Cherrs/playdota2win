import { json, type RequestHandler } from '../../http';
import { requireAdminAuth } from '$lib/admin-auth';
import { updateManagedSoftware, type SoftwareUpdateSummary } from '$lib/server/software-update';
import { DownloadListConflictError } from '$lib/server/download-list-store';
import type { ApiResponse } from '$lib/types';

export const POST: RequestHandler = async ({ request, platform, fetch }) => {
	const kv = platform?.env?.APP_KV;
	const r2 = platform?.env?.UPLOADS_BUCKET;
	if (!r2) {
		return json(
			{
				success: false,
				error: 'R2 software update storage is not available'
			} satisfies ApiResponse,
			{ status: 500 }
		);
	}

	const authed = await requireAdminAuth(request, platform?.env?.ADMIN_JWT_SECRET, kv);
	if (!authed) {
		return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const summary = await updateManagedSoftware({
			kv,
			r2,
			fetchImpl: fetch,
			primaryDownloadHostname: platform?.env?.PRIMARY_DOWNLOAD_HOSTNAME
		});
		return json({ success: true, data: summary } satisfies ApiResponse<SoftwareUpdateSummary>);
	} catch (error) {
		const conflict = error instanceof DownloadListConflictError;
		console.error({
			component: 'software_update',
			event_name: 'software_update_failed',
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: error instanceof Error ? error.message : String(error)
		});
		return json(
			{
				success: false,
				error: conflict
					? '下载列表已被其他操作修改，请重新检查更新'
					: 'Failed to complete software update'
			} satisfies ApiResponse,
			{ status: conflict ? 409 : 500 }
		);
	}
};
