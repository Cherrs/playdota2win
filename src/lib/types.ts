/**
 * 下载项的存储类型
 */
export type StorageType = 'link' | 'r2' | 's3';

/**
 * 平台类型
 */
export type Platform = 'windows' | 'macos' | 'linux';

/**
 * 分类（大类）
 */
export interface Category {
	id: string;
	name: string;
	/** 显示图标（emoji 或 SVG 路径） */
	icon?: string;
	/** 分类颜色（十六进制） */
	color?: string;
	/** 分类描述 */
	description?: string;
	/** 排序顺序 */
	order: number;
	/** 创建时间 */
	createdAt: number;
	/** 更新时间 */
	updatedAt: number;
}

/**
 * 分类列表
 */
export interface CategoryList {
	items: Category[];
	lastUpdated: number;
}

/**
 * 下载项
 */
export interface DownloadItem {
	id: string;
	platform: Platform;
	/** 所属分类 ID */
	categoryId?: string;
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
	/** 下载次数（可选，默认为 0） */
	downloadCount?: number;
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
	categoryId?: string;
}

/**
 * 分类表单数据
 */
export interface CategoryFormData {
	name: string;
	icon?: string;
	color?: string;
	description?: string;
	order?: number;
}

/**
 * 公告
 */
export interface Announcement {
	id: string;
	title: string;
	content: string;      // Markdown 正文
	visible: boolean;     // false 则对用户隐藏
	pinned: boolean;      // 置顶（排在前面）
	createdAt: number;    // Date.now()
	updatedAt: number;
}

/**
 * 公告列表
 */
export interface AnnouncementList {
	items: Announcement[];
	lastUpdated: number;
}

/**
 * 公告表单数据
 */
export interface AnnouncementFormData {
	title: string;
	content: string;
	visible?: boolean;
	pinned?: boolean;
}
