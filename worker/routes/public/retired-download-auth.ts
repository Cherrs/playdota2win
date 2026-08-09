import { json, type RequestHandler } from '../../http';
import type { ApiResponse } from '$lib/types';

const gone = () =>
	json({ success: false, error: '该接口已停用，请使用下载链接接口' } satisfies ApiResponse, {
		status: 410,
		headers: { 'Cache-Control': 'no-store' }
	});

// 无状态下载 token 必须和完整 R2 对象路径一起验证，不提供 token oracle。
export const GET: RequestHandler = async () => gone();

// 旧版密码接口会绕过失败计数和 Turnstile，禁止继续签发未绑定文件的 token。
// 下载认证统一由 POST /api/downloads/link 完成。
export const POST: RequestHandler = async () => gone();
