import { useCallback, useEffect, useRef, useState } from 'react';

import { useMumbleClientSnapshot } from '../../hooks/mumble-client';
import { createMumbleClient, type MumbleClient } from '../../lib/mumble/client';
import { createChannelNameMap, countUsersByChannel } from '../../lib/mumble/utils';
import type { ApiResponse, MumbleProxyConfig, MumbleProxyHealth } from '../../lib/types';
import styles from './MumbleStatusPanel.module.css';

const HEALTH_REFRESH_INTERVAL_MS = 15_000;

function classNames(...names: Array<string | false | null | undefined>): string {
	return names
		.filter((name): name is string => typeof name === 'string')
		.map((name) => styles[name])
		.join(' ');
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString('zh-CN', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

function formatDateTime(timestamp: number): string | undefined {
	const date = new Date(timestamp);
	return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function formatHealthEndpoint(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export default function MumbleStatusPanel() {
	const [loading, setLoading] = useState(true);
	const [configError, setConfigError] = useState('');
	const [healthError, setHealthError] = useState('');
	const [refreshingHealth, setRefreshingHealth] = useState(false);
	const [proxyHealth, setProxyHealth] = useState<MumbleProxyHealth | null>(null);
	const [client, setClient] = useState<MumbleClient | null>(null);
	const clientState = useMumbleClientSnapshot(client);

	const mountedRef = useRef(false);
	const clientRef = useRef<MumbleClient | null>(null);
	const configControllerRef = useRef<AbortController | null>(null);
	const healthControllerRef = useRef<AbortController | null>(null);
	const healthRequestRef = useRef<Promise<void> | null>(null);
	const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const performHealthRefresh = useCallback(async (): Promise<void> => {
		if (mountedRef.current) {
			setRefreshingHealth(true);
			setHealthError('');
		}
		const controller = new AbortController();
		healthControllerRef.current = controller;

		try {
			const response = await fetch('/api/admin/mumble/health', {
				headers: { Accept: 'application/json' },
				signal: controller.signal
			});
			const data: ApiResponse<MumbleProxyHealth> = await response.json();
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.error || `健康检查失败（HTTP ${response.status}）`);
			}
			if (mountedRef.current && !controller.signal.aborted) setProxyHealth(data.data);
		} catch (error) {
			if (!isAbortError(error) && mountedRef.current) {
				setHealthError(error instanceof Error ? error.message : '获取代理健康状态失败');
			}
		} finally {
			if (healthControllerRef.current === controller) {
				healthControllerRef.current = null;
				if (mountedRef.current) setRefreshingHealth(false);
			}
		}
	}, []);

	const refreshHealth = useCallback(async (): Promise<void> => {
		if (healthRequestRef.current) return healthRequestRef.current;
		const request = performHealthRefresh();
		healthRequestRef.current = request;
		try {
			await request;
		} finally {
			if (healthRequestRef.current === request) healthRequestRef.current = null;
		}
	}, [performHealthRefresh]);

	const scheduleHealthRefresh = useCallback(
		function scheduleHealthRefresh(): void {
			if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
			if (!mountedRef.current) return;
			healthTimerRef.current = setTimeout(() => {
				healthTimerRef.current = null;
				void refreshHealth().finally(() => {
					if (mountedRef.current) scheduleHealthRefresh();
				});
			}, HEALTH_REFRESH_INTERVAL_MS);
		},
		[refreshHealth]
	);

	useEffect(() => {
		let cancelled = false;
		mountedRef.current = true;
		const configController = new AbortController();
		configControllerRef.current = configController;

		void (async () => {
			const healthRefresh = refreshHealth();
			let config: MumbleProxyConfig | null = null;
			try {
				const response = await fetch('/api/mumble/config', {
					signal: configController.signal
				});
				const data: ApiResponse<MumbleProxyConfig> = await response.json();
				if (response.ok && data.success && data.data) {
					config = data.data;
				} else if (!cancelled && mountedRef.current) {
					setConfigError(data.error || 'Mumble 代理配置不可用');
				}
			} catch (error) {
				if (!isAbortError(error) && !cancelled && mountedRef.current) {
					setConfigError('无法读取 Mumble 代理配置');
				}
			}

			if (!cancelled && mountedRef.current && !configController.signal.aborted && config) {
				const nextClient = createMumbleClient({
					config,
					nickname: `监控-${Math.floor(Math.random() * 9000 + 1000)}`,
					mode: 'monitor'
				});
				clientRef.current = nextClient;
				setClient(nextClient);
				nextClient.connect();
			}
			if (!cancelled && mountedRef.current) setLoading(false);

			await healthRefresh;
			if (!cancelled && mountedRef.current) scheduleHealthRefresh();
		})();

		return () => {
			cancelled = true;
			mountedRef.current = false;
			configController.abort();
			if (configControllerRef.current === configController) {
				configControllerRef.current = null;
			}
			healthControllerRef.current?.abort();
			healthControllerRef.current = null;
			healthRequestRef.current = null;
			if (healthTimerRef.current) clearTimeout(healthTimerRef.current);
			healthTimerRef.current = null;
			clientRef.current?.destroy();
			clientRef.current = null;
		};
	}, [refreshHealth, scheduleHealthRefresh]);

	const channelNameMap = createChannelNameMap(clientState.channels);
	const visibleUsers = clientState.users.filter((user) => user.sessionId !== clientState.sessionId);
	const usersByChannel = countUsersByChannel(visibleUsers);
	const recentMessages = [...clientState.messages].slice(-16).reverse();
	let monitorStatusText = '监控尚未连接';
	if (clientState.reconnecting) monitorStatusText = '监控连接重连中';
	else if (clientState.status === 'connecting') monitorStatusText = '监控连接建立中';
	else if (clientState.connected) monitorStatusText = '监控连接已就绪';
	else if (configError) monitorStatusText = '监控不可用';

	function getChannelName(channelId: number): string {
		return channelNameMap.get(channelId) ?? `频道 #${channelId}`;
	}

	async function handleManualHealthRefresh(): Promise<void> {
		await refreshHealth();
		scheduleHealthRefresh();
	}

	function handleReconnect(): void {
		clientRef.current?.reconnect();
		void handleManualHealthRefresh();
	}

	return (
		<div className={classNames('mumble-status-panel')}>
			<div className={classNames('panel-header')}>
				<div>
					<h2>🎧 Mumble 状态面板</h2>
					<p>
						该页面会以只读监控身份连接 Mumble 代理，展示当前健康状态、频道、在线用户与最近文字消息。
					</p>
				</div>

				<div className={classNames('panel-actions')}>
					<button
						className={classNames('action-btn', 'soft')}
						type="button"
						onClick={() => void handleManualHealthRefresh()}
						disabled={refreshingHealth}
					>
						{refreshingHealth ? '刷新中...' : '刷新健康'}
					</button>
					<button
						className={classNames('action-btn')}
						type="button"
						onClick={handleReconnect}
						disabled={loading}
					>
						重连监控
					</button>
				</div>
			</div>

			{configError && (
				<div className={classNames('alert', 'alert-error')} role="alert">
					❌ {configError}
				</div>
			)}

			{healthError && (
				<div className={classNames('alert', 'alert-error')} role="alert">
					❌ {healthError}
				</div>
			)}

			<div className={classNames('summary-grid')}>
				<section
					className={classNames('summary-card')}
					aria-live="polite"
					aria-busy={refreshingHealth}
				>
					<h3>代理健康</h3>
					{proxyHealth ? (
						<>
							<div className={classNames('status-line')}>
								<span
									className={classNames('status-dot', proxyHealth.healthy && 'healthy')}
									aria-hidden="true"
								/>
								<strong>{proxyHealth.healthy ? '运行正常' : '状态异常'}</strong>
							</div>
							<p>目标：{formatHealthEndpoint(proxyHealth.url)}</p>
							<p>响应：{proxyHealth.message}</p>
							<p>更新时间：{formatTime(proxyHealth.checkedAt)}</p>
						</>
					) : (
						<p>{loading ? '正在读取健康信息...' : '暂无健康数据'}</p>
					)}
				</section>

				<section className={classNames('summary-card')}>
					<h3>监控连接</h3>
					<div className={classNames('status-line')}>
						<span
							className={classNames('status-dot', clientState.connected && 'healthy')}
							aria-hidden="true"
						/>
						<strong>{monitorStatusText}</strong>
					</div>
					<p>昵称：{clientState.username || '等待连接中...'}</p>
					<p>频道数：{clientState.channels.length}</p>
					<p>在线用户：{visibleUsers.length}</p>
				</section>

				<section className={classNames('summary-card')}>
					<h3>最近活动</h3>
					<p>最近文字消息：{clientState.messages.length}</p>
					<p>
						当前频道：
						{clientState.currentChannelId === null
							? '未加入'
							: getChannelName(clientState.currentChannelId)}
					</p>
					<p>断线原因：{clientState.disconnectReason || '—'}</p>
				</section>
			</div>

			<div className={classNames('content-grid')}>
				<section className={classNames('content-card')}>
					<h3>频道列表</h3>
					{clientState.channels.length === 0 ? (
						<p className={classNames('empty-text')}>
							{loading ? '等待频道数据...' : '暂无频道数据'}
						</p>
					) : (
						<div className={classNames('table-wrap')}>
							<table aria-label="Mumble 频道列表">
								<thead>
									<tr>
										<th>频道</th>
										<th>在线人数</th>
										<th>描述</th>
									</tr>
								</thead>
								<tbody>
									{clientState.channels.map((channel) => (
										<tr key={channel.id}>
											<td>{channel.name}</td>
											<td>{usersByChannel.get(channel.id) ?? 0}</td>
											<td>{channel.description || '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				<section className={classNames('content-card')}>
					<h3>在线用户</h3>
					{visibleUsers.length === 0 ? (
						<p className={classNames('empty-text')}>
							{loading ? '等待在线用户...' : '暂无在线用户'}
						</p>
					) : (
						<div className={classNames('table-wrap')}>
							<table aria-label="Mumble 在线用户">
								<thead>
									<tr>
										<th>昵称</th>
										<th>所在频道</th>
										<th>静音</th>
										<th>耳聋</th>
									</tr>
								</thead>
								<tbody>
									{visibleUsers.map((user) => (
										<tr key={user.sessionId}>
											<td>{user.name}</td>
											<td>{getChannelName(user.channelId)}</td>
											<td>{user.muted ? '是' : '否'}</td>
											<td>{user.deafened ? '是' : '否'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			<section className={classNames('content-card', 'messages-card')}>
				<h3>最近文字消息</h3>
				{recentMessages.length === 0 ? (
					<p className={classNames('empty-text')}>
						{loading ? '等待文本消息...' : '当前会话尚未收到文字消息'}
					</p>
				) : (
					<div className={classNames('message-list')}>
						{recentMessages.map((message) => (
							<article className={classNames('message-item')} key={message.id}>
								<div className={classNames('message-meta')}>
									<strong>{message.sender}</strong>
									<span>{getChannelName(message.channelId)}</span>
									<time dateTime={formatDateTime(message.timestamp)}>
										{formatTime(message.timestamp)}
									</time>
								</div>
								<p>{message.message}</p>
							</article>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
