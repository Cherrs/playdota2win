import { useState } from 'react';
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
					<svg
						viewBox="0 0 120 120"
						className={styles['mascot-svg']}
						aria-hidden="true"
						focusable="false"
					>
						<circle cx="60" cy="65" r="45" fill="#FFE4EC" />
						<ellipse cx="30" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6" />
						<ellipse cx="90" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6" />
						<circle cx="42" cy="58" r="8" fill="#2D1B4E" />
						<circle cx="78" cy="58" r="8" fill="#2D1B4E" />
						<circle cx="45" cy="55" r="3" fill="#FFFFFF" />
						<circle cx="81" cy="55" r="3" fill="#FFFFFF" />
						<path
							d="M 48 78 Q 60 88 72 78"
							stroke="#2D1B4E"
							strokeWidth="3"
							fill="none"
							strokeLinecap="round"
						/>
						<path d="M 25 30 L 35 55 L 15 50 Z" fill="#FFE4EC" />
						<path d="M 95 30 L 85 55 L 105 50 Z" fill="#FFE4EC" />
						<path d="M 27 35 L 34 52 L 20 48 Z" fill="#FFB6C1" />
						<path d="M 93 35 L 86 52 L 100 48 Z" fill="#FFB6C1" />
					</svg>
				</div>
				<div className={styles.sparkles}>
					<span className={styles.sparkle}>✨</span>
					<span className={styles.sparkle}>💫</span>
					<span className={styles.sparkle}>✨</span>
				</div>
			</div>
		</div>
	);
}
