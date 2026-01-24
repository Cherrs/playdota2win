import { json, type RequestHandler } from '@sveltejs/kit';
import type { DownloadList, DownloadItem, ApiResponse, S3Config } from '$lib/types';
import { requireAdminAuth, signDownloadPath } from '$lib/admin-auth';

const KV_KEY = 'downloads_list';

// 辅助函数：获取下载列表
async function getDownloadList(kv: KVNamespace): Promise<DownloadList> {
	const data = await kv.get<DownloadList>(KV_KEY, 'json');
	return data || { items: [], downloadCount: 12580, lastUpdated: Date.now() };
}

// 辅助函数：保存下载列表
async function saveDownloadList(kv: KVNamespace, list: DownloadList): Promise<void> {
	list.lastUpdated = Date.now();
	await kv.put(KV_KEY, JSON.stringify(list));
}

// 辅助函数：上传到 R2
async function uploadToR2(
	r2: R2Bucket,
	key: string,
	data: ArrayBuffer,
	contentType: string
): Promise<string> {
	await r2.put(key, data, {
		httpMetadata: { contentType }
	});
	return `/api/admin/download/${key}`;
}

function getFilenameFromUrl(url: string): string {
	try {
		const parsed = new URL(url, 'http://local');
		const name = parsed.pathname.split('/').pop();
		return name || 'download';
	} catch {
		return 'download';
	}
}

// 辅助函数：上传到自定义 S3（使用预签名 URL）
async function uploadToS3(
	config: S3Config,
	data: ArrayBuffer,
	contentType: string
): Promise<string> {
	const presignedUrl = config.presignedUrl;
	const publicUrl = config.publicUrl;

	if (!presignedUrl || !publicUrl) {
		throw new Error('S3 presigned URL and public URL are required');
	}

	const response = await fetch(presignedUrl, {
		method: 'PUT',
		headers: {
			'Content-Type': contentType
		},
		body: data
	});

	if (!response.ok) {
		throw new Error(`S3 upload failed: ${response.status}`);
	}

	return publicUrl;
}

// GET: 获取下载列表
export const GET: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		const list = await getDownloadList(kv);
		const signingSecret =
			platform?.env.ADMIN_SIGNING_SECRET || platform?.env.ADMIN_PASSWORD || 'dev-secret';
		const items = await Promise.all(
			list.items.map(async (item) => {
				if (item.storageType === 'r2' && item.url.startsWith('/api/admin/download/')) {
					const signedUrl = await signDownloadPath(item.url, signingSecret);
					return { ...item, signedUrl };
				}
				return item;
			})
		);
		return json({ success: true, data: { ...list, items } } satisfies ApiResponse<DownloadList>);
	} catch (error) {
		console.error('Error fetching downloads:', error);
		return json({ success: false, error: 'Failed to fetch downloads' } satisfies ApiResponse, {
			status: 500
		});
	}
};

// POST: 添加新下载项
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		const r2 = platform?.env.UPLOADS_BUCKET;

		if (!kv) {
			return json({ success: false, error: 'KV not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		const formData = await request.formData();
		const platform_type = formData.get('platform') as string;
		const title = (formData.get('title') as string) || '';
		const description = (formData.get('description') as string) || '';
		const configGuide = (formData.get('configGuide') as string) || '';
		const filename = (formData.get('filename') as string) || '';
		const version = formData.get('version') as string;
		const size = formData.get('size') as string;
		const storageType = formData.get('storageType') as 'link' | 'r2' | 's3';
		const categoryId = (formData.get('categoryId') as string) || undefined;

		let url = '';
		let s3Config: S3Config | undefined;
		let uploadFilename: string | undefined;

		if (storageType === 'link') {
			url = formData.get('url') as string;
			if (!url) {
				return json(
					{ success: false, error: 'URL is required for link storage' } satisfies ApiResponse,
					{ status: 400 }
				);
			}
		} else if (storageType === 'r2') {
			if (!r2) {
				return json({ success: false, error: 'R2 not available' } satisfies ApiResponse, {
					status: 500
				});
			}
			const file = formData.get('file') as File;
			if (!file) {
				return json(
					{ success: false, error: 'File is required for R2 storage' } satisfies ApiResponse,
					{ status: 400 }
				);
			}
			uploadFilename = file.name;
			const key = `${platform_type}/${version}/${file.name}`;
			const buffer = await file.arrayBuffer();
			url = await uploadToR2(r2, key, buffer, file.type || 'application/octet-stream');
		} else if (storageType === 's3') {
			const file = formData.get('file') as File;
			const s3ConfigStr = formData.get('s3Config') as string;

			if (!file || !s3ConfigStr) {
				return json(
					{ success: false, error: 'File and S3 config are required' } satisfies ApiResponse,
					{ status: 400 }
				);
			}

			s3Config = JSON.parse(s3ConfigStr) as S3Config;
			uploadFilename = file.name;
			const buffer = await file.arrayBuffer();
			url = await uploadToS3(s3Config, buffer, file.type || 'application/octet-stream');
		}

		const resolvedFilename =
			filename ||
			uploadFilename ||
			(storageType === 'link' ? getFilenameFromUrl(url) : undefined) ||
			undefined;

		const item: DownloadItem = {
			id: crypto.randomUUID(),
			platform: platform_type as 'windows' | 'macos' | 'linux',
			categoryId,
			title: title || undefined,
			description: description || undefined,
			configGuide: configGuide || undefined,
			filename: resolvedFilename,
			version,
			size,
			storageType,
			url,
			s3Config: undefined,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			enabled: true
		};

		const list = await getDownloadList(kv);
		list.items.push(item);
		await saveDownloadList(kv, list);

		return json({ success: true, data: item } satisfies ApiResponse<DownloadItem>);
	} catch (error) {
		console.error('Error adding download:', error);
		return json({ success: false, error: 'Failed to add download' } satisfies ApiResponse, {
			status: 500
		});
	}
};

// PUT: 更新下载项
export const PUT: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			console.error('PUT /api/admin: KV not available');
			return json({ success: false, error: 'KV not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			console.error('PUT /api/admin: Unauthorized');
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		const body = (await request.json()) as { id: string; [key: string]: unknown };
		console.log('PUT /api/admin: Received body:', body);

		const { id, ...updates } = body;
		if (!id) {
			console.error('PUT /api/admin: ID is required');
			return json({ success: false, error: 'ID is required' } satisfies ApiResponse, {
				status: 400
			});
		}

		const normalizedUpdates = { ...updates } as Record<string, unknown>;
		// 将空字符串转换为 undefined 的可选字段
		const optionalFields = ['categoryId', 'title', 'description', 'configGuide', 'filename'];
		for (const field of optionalFields) {
			if (Object.prototype.hasOwnProperty.call(normalizedUpdates, field)) {
				const value = normalizedUpdates[field];
				if (value === null || value === '') {
					normalizedUpdates[field] = undefined;
				}
			}
		}

		const list = await getDownloadList(kv);
		const index = list.items.findIndex((item) => item.id === id);

		if (index === -1) {
			console.error('PUT /api/admin: Item not found, id:', id);
			return json({ success: false, error: 'Item not found' } satisfies ApiResponse, {
				status: 404
			});
		}

		console.log('PUT /api/admin: Found item at index', index);
		console.log('PUT /api/admin: Current item:', list.items[index]);
		console.log('PUT /api/admin: Updates:', normalizedUpdates);

		list.items[index] = {
			...list.items[index],
			...normalizedUpdates,
			updatedAt: Date.now()
		};

		console.log('PUT /api/admin: Updated item:', list.items[index]);

		await saveDownloadList(kv, list);
		console.log('PUT /api/admin: Saved to KV successfully');

		return json({ success: true, data: list.items[index] } satisfies ApiResponse<DownloadItem>);
	} catch (error) {
		console.error('PUT /api/admin: Error updating download:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to update download'
			} satisfies ApiResponse,
			{
				status: 500
			}
		);
	}
};

// DELETE: 删除下载项
export const DELETE: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		const r2 = platform?.env.UPLOADS_BUCKET;

		if (!kv) {
			return json({ success: false, error: 'KV not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		const { id } = (await request.json()) as { id: string };
		if (!id) {
			return json({ success: false, error: 'ID is required' } satisfies ApiResponse, {
				status: 400
			});
		}

		const list = await getDownloadList(kv);
		const item = list.items.find((item) => item.id === id);

		if (!item) {
			return json({ success: false, error: 'Item not found' } satisfies ApiResponse, {
				status: 404
			});
		}

		// 如果是 R2 存储，删除文件
		if (item.storageType === 'r2' && r2 && item.url.startsWith('/api/admin/download/')) {
			const key = item.url.replace('/api/admin/download/', '');
			await r2.delete(key);
		}

		list.items = list.items.filter((item) => item.id !== id);
		await saveDownloadList(kv, list);

		return json({ success: true } satisfies ApiResponse);
	} catch (error) {
		console.error('Error deleting download:', error);
		return json({ success: false, error: 'Failed to delete download' } satisfies ApiResponse, {
			status: 500
		});
	}
};
