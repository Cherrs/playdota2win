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
	/** Markdown 正文 */
	content: string;
	/** false 则对用户隐藏 */
	visible: boolean;
	/** 置顶（排在前面） */
	pinned: boolean;
	/** 创建时间 */
	createdAt: number;
	/** 更新时间 */
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

/**
 * 聊天昵称关键字列表
 */
export interface NicknameKeywordList {
	keywords: string[];
	lastUpdated: number;
}

/**
 * 浏览器可公开读取的 Mumble 代理配置
 */
export interface MumbleProxyConfig {
	wsUrl: string;
	stunServers: string[];
}

/**
 * Mumble 代理健康检查结果
 */
export interface MumbleProxyHealth {
	healthy: boolean;
	status: number | null;
	message: string;
	checkedAt: number;
	url: string;
}

/**
 * Mumble 频道（前端展示用）
 */
export interface MumbleChannel {
	id: number;
	name: string;
	parentId: number;
	description: string;
}

/**
 * Mumble 在线用户（前端展示用）
 */
export interface MumbleUser {
	sessionId: number;
	name: string;
	channelId: number;
	muted: boolean;
	deafened: boolean;
}

/**
 * Mumble 文本消息（浏览器会补充本地 ID 和时间戳）
 */
export interface MumbleTextMessage {
	id: string;
	sender: string;
	message: string;
	channelId: number;
	timestamp: number;
}

/**
 * Mumble 代理返回的原始频道数据
 */
export interface MumbleProxyChannelPayload {
	id: number;
	name: string;
	parent_id: number;
	description: string;
}

/**
 * Mumble 代理返回的原始用户数据
 */
export interface MumbleProxyUserPayload {
	session_id: number;
	name: string;
	channel_id: number;
	muted: boolean;
	deafened: boolean;
}

/**
 * 浏览器 -> Mumble 代理消息
 */
export type MumbleProxyClientEvent =
	| { type: 'Connect'; nickname: string }
	| { type: 'Disconnect' }
	| { type: 'SdpOffer'; sdp: string }
	| {
			type: 'IceCandidate';
			candidate: string;
			sdp_mid: string | null;
			sdp_mline_index: number | null;
	  }
	| { type: 'SwitchChannel'; channel_id: number }
	| { type: 'SendChat'; channel_id: number; message: string }
	| { type: 'SetMute'; muted: boolean }
	| { type: 'SetDeaf'; deafened: boolean };

/**
 * Mumble 代理 -> 浏览器消息
 */
export type MumbleProxyServerEvent =
	| { type: 'Connected'; session_id: number; username: string; channel_id: number }
	| { type: 'Disconnected'; reason?: string }
	| { type: 'SdpAnswer'; sdp: string }
	| {
			type: 'IceCandidate';
			candidate: string;
			sdp_mid: string | null;
			sdp_mline_index: number | null;
	  }
	| { type: 'ChannelList'; channels: MumbleProxyChannelPayload[] }
	| { type: 'UserList'; users: MumbleProxyUserPayload[] }
	| { type: 'ChatMessage'; sender: string; message: string; channel_id: number }
	| {
			type: 'UserStateChanged';
			session_id: number;
			channel_id: number;
			muted: boolean;
			deafened: boolean;
	  }
	| { type: 'Error'; message: string };
