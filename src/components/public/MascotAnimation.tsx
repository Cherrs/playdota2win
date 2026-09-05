import { useState } from 'react';
import MascotIcon from './MascotIcon';
import styles from './MascotAnimation.module.css';

export default function MascotAnimation() {
	const [isHovering, setIsHovering] = useState(false);

	return (
		<div className={styles['mascot-area']}>
			<div
				className={styles['mascot-container']}
				onMouseEnter={() => setIsHovering(true)}
				onMouseLeave={() => setIsHovering(false)}
				role="img"
				aria-label="可爱的吉祥物"
			>
				<div className={`${styles.mascot} ${isHovering ? styles.bouncing : ''}`}>
					<MascotIcon className={styles['mascot-svg']} />
				</div>
				<div className={styles.sparkles} aria-hidden="true">
					<span className={styles.sparkle} />
					<span className={styles.sparkle} />
					<span className={styles.sparkle} />
				</div>
			</div>
		</div>
	);
}
