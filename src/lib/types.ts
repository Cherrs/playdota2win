/**
 * 下载项的存储类型
 */
export type StorageType = 'link' | 'r2' | 's3';

/**
 * 平台类型
 */
export type Platform = 'windows' | 'macos' | 'linux';

/**
 * 下载项
 */
export interface DownloadItem {
	id: string;
	platform: Platform;
	/** 标题（用于展示） */
	title?: string;
	/** 描述（用于展示） */
	description?: string;
	/** 配置指引（多行文本） */
	configGuide?: string;
	/** 文件名（可选） */
	filename?: string;
	version: string;
	size: string;
	storageType: StorageType;
	/** 存储URL或路径 */
	url: string;
	/** 短期签名下载链接（仅用于展示，不持久化） */
	signedUrl?: string;
	/** S3自定义配置（仅当 storageType 为 s3 时使用） */
	s3Config?: S3Config;
	/** 创建时间 */
	createdAt: number;
	/** 更新时间 */
	updatedAt: number;
	/** 是否启用 */
	enabled: boolean;
}

/**
 * S3 自定义配置
 */
export interface S3Config {
	endpoint?: string;
	bucket?: string;
	region?: string;
	/** 预签名上传 URL（短期有效） */
	presignedUrl?: string;
	/** 公开下载 URL（用于展示/下载） */
	publicUrl?: string;
}

/**
 * 下载列表
 */
export interface DownloadList {
	items: DownloadItem[];
	downloadCount: number;
	lastUpdated: number;
}

/**
 * Admin API 响应
 */
export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * 上传表单数据
 */
export interface UploadFormData {
	platform: Platform;
	title?: string;
	description?: string;
	configGuide?: string;
	filename?: string;
	version: string;
	size: string;
	storageType: StorageType;
	url?: string;
	file?: File;
	s3Config?: S3Config;
}
