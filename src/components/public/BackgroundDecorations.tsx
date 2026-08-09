import styles from './BackgroundDecorations.module.css';

export default function BackgroundDecorations() {
	return (
		<div className={styles['bg-decorations']} aria-hidden="true">
			<div className={`${styles['floating-star']} ${styles['star-1']}`}>✦</div>
			<div className={`${styles['floating-star']} ${styles['star-2']}`}>★</div>
			<div className={`${styles['floating-star']} ${styles['star-3']}`}>✧</div>
			<div className={`${styles['floating-star']} ${styles['star-4']}`}>❋</div>
			<div className={`${styles['floating-cloud']} ${styles['cloud-1']}`}>☁</div>
			<div className={`${styles['floating-cloud']} ${styles['cloud-2']}`}>☁</div>
		</div>
	);
}
