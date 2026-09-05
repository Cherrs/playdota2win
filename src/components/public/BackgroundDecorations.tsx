import styles from './BackgroundDecorations.module.css';

export default function BackgroundDecorations() {
	return (
		<div className={styles['bg-decorations']} aria-hidden="true">
			<div className={styles['corner-bloom']}>
				<span className={`${styles.petal} ${styles['petal-one']}`} />
				<span className={`${styles.petal} ${styles['petal-two']}`} />
				<span className={`${styles.petal} ${styles['petal-three']}`} />
				<span className={`${styles.petal} ${styles['petal-four']}`} />
				<span className={`${styles.stem} ${styles['stem-one']}`} />
				<span className={`${styles.stem} ${styles['stem-two']}`} />
			</div>
			<span className={`${styles.spark} ${styles['spark-one']}`}>✦</span>
			<span className={`${styles.spark} ${styles['spark-two']}`}>☆</span>
			<span className={`${styles.spark} ${styles['spark-three']}`}>✦</span>
			<span className={`${styles.spark} ${styles['spark-four']}`}>☆</span>
			<span className={`${styles.spark} ${styles['spark-five']}`}>✦</span>
			<span className={`${styles.dot} ${styles['dot-one']}`} />
			<span className={`${styles.dot} ${styles['dot-two']}`} />
			<span className={`${styles.dot} ${styles['dot-three']}`} />
			<span className={`${styles.dot} ${styles['dot-four']}`} />
			<span className={`${styles.cloud} ${styles['cloud-one']}`} />
		</div>
	);
}
