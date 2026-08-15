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
 * RustDesk 客户端公开配置
 */
export interface RustDeskConfig {
	/** 是否作为 RustDesk 配置接口的数据源 */
	enabled: boolean;
	/** RustDesk ID 服务器 */
	idServer: string;
	/** RustDesk key */
	key: string;
}

export type R2BackupSourceType = 'origin' | 'official-release';

/**
 * 外部下载链接在 R2 中的备份状态。
 *
 * 状态单独存储在 R2 JSON 对象中，仅在管理员读取下载列表时合并到下载项，
 * 避免后台同步任务改写整份下载列表。
 */
export interface R2BackupState {
	status: 'pending' | 'syncing' | 'ready' | 'failed';
	/** 本次备份对应的源地址，用来避免 URL 修改后误用旧备份 */
	sourceUrl: string;
	/** R2 对象中实际文件的名称，用于与原始链接按文件名比较版本 */
	filename?: string;
	/** 从实际文件名中提取的纯数字版本号 */
	version?: string;
	/** 官方发布更新可以与仍保留的原始链接使用不同 URL */
	sourceType?: R2BackupSourceType;
	/** 区分重复/并发同步，防止旧任务覆盖较新的状态 */
	operationId: string;
	/** 当前同步任务写入的 R2 对象键 */
	objectKey?: string;
	/** 新备份就绪后清理；同源刷新失败时可继续作为有效兜底 */
	previousBackup?: {
		objectKey: string;
		sourceUrl: string;
		filename?: string;
		version?: string;
		sourceType?: R2BackupSourceType;
		syncedAt?: number;
		size?: number;
	};
	updatedAt: number;
	syncedAt?: number;
	size?: number;
	error?: string;
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
	/** RustDesk 公开配置（仅 RustDesk 下载项使用） */
	rustdeskConfig?: RustDeskConfig;
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
	/** R2 外链备份状态（仅管理员接口临时合并，不写入下载列表） */
	r2Backup?: R2BackupState;
}

/**
 * 匿名下载列表只能读取的展示字段。
 * 真实 URL、配置指引和存储配置必须在密码验证成功后单独返回。
 */
export type PublicDownloadItem = Pick<
	DownloadItem,
	| 'id'
	| 'platform'
	| 'categoryId'
	| 'title'
	| 'description'
	| 'filename'
	| 'version'
	| 'size'
	| 'storageType'
	| 'enabled'
> & {
	/** 独立 KV key 中保存的下载次数 */
	downloadCount: number;
};

export interface PublicDownloadList {
	items: PublicDownloadItem[];
	/** 所有已启用下载项的下载次数之和 */
	downloadCount: number;
	lastUpdated: number;
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
	rustdeskConfig?: RustDeskConfig;
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
 * WebRTC ICE 服务器配置
 */
export interface IceServer {
	urls: string;
	username?: string;
	credential?: string;
}

/**
 * 浏览器可公开读取的 Mumble 代理配置
 */
export interface MumbleProxyConfig {
	wsUrl: string;
	iceServers: IceServer[];
	healthUrl: string | null;
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
	selfMuted: boolean;
	selfDeafened: boolean;
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
	mute: boolean;
	deaf: boolean;
	self_mute: boolean;
	self_deaf: boolean;
}

/**
 * 浏览器 -> Mumble 代理消息
 */
export type MumbleProxyClientEvent =
	| { type: 'connect'; data: { username: string } }
	| { type: 'disconnect' }
	| { type: 'offer'; data: { sdp: string } }
	| {
			type: 'ice_candidate';
			data: { candidate: string; sdp_mid: string | null; sdp_mline_index: number | null };
	  }
	| { type: 'channel_join'; data: { channel_id: number } }
	| { type: 'chat_send'; data: { channel_id: number; message: string } }
	| { type: 'mute'; data: { muted: boolean } }
	| { type: 'deafen'; data: { deafened: boolean } };

/**
 * Mumble 代理 -> 浏览器消息
 */
export type MumbleProxyServerEvent =
	| {
			type: 'connected';
			data: {
				session_id: number;
				channels: MumbleProxyChannelPayload[];
				users: MumbleProxyUserPayload[];
			};
	  }
	| { type: 'answer'; data: { sdp: string } }
	| {
			type: 'ice_candidate';
			data: { candidate: string; sdp_mid: string | null; sdp_mline_index: number | null };
	  }
	| { type: 'channel_updated'; data: { channels: MumbleProxyChannelPayload[] } }
	| { type: 'user_joined'; data: MumbleProxyUserPayload }
	| { type: 'user_left'; data: { session_id: number } }
	| {
			type: 'user_state';
			data: {
				session_id: number;
				channel_id: number | null;
				name: string | null;
				mute: boolean | null;
				deaf: boolean | null;
				self_mute: boolean | null;
				self_deaf: boolean | null;
			};
	  }
	| {
			type: 'chat_received';
			data: {
				sender_session: number;
				sender_name: string;
				message: string;
				channel_id: number;
				timestamp: number;
			};
	  }
	| { type: 'error'; data: { message: string; code?: string } };
