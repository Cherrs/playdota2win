import styles from './AdminHeader.module.css';

interface AdminHeaderProps {
	itemCount: number;
	onLogout: () => void;
}

export default function AdminHeader({ itemCount, onLogout }: AdminHeaderProps) {
	return (
		<header className={styles.header}>
			<h1>🎮 PlayDota2Win 管理后台</h1>
			<div className={styles.actions}>
				<div className={styles.stats}>
					<span>
						📦 下载项: <strong>{itemCount}</strong>
					</span>
				</div>
				<button className={styles.logout} type="button" onClick={onLogout}>
					🚪 退出登录
				</button>
			</div>
		</header>
	);
}
