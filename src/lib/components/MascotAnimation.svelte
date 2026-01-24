<script lang="ts">
	let isHovering = $state(false);
</script>

<div class="mascot-area">
	<div
		class="mascot-container"
		onmouseenter={() => (isHovering = true)}
		onmouseleave={() => (isHovering = false)}
		role="img"
		aria-label="可爱的吉祥物"
	>
		<div class="mascot" class:bouncing={isHovering}>
			<svg viewBox="0 0 120 120" class="mascot-svg">
				<!-- 身体 -->
				<circle cx="60" cy="65" r="45" fill="#FFE4EC" />
				<!-- 脸蛋红晕 -->
				<ellipse cx="30" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6" />
				<ellipse cx="90" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6" />
				<!-- 眼睛 -->
				<circle cx="42" cy="58" r="8" fill="#2D1B4E" />
				<circle cx="78" cy="58" r="8" fill="#2D1B4E" />
				<!-- 眼睛高光 -->
				<circle cx="45" cy="55" r="3" fill="#FFFFFF" />
				<circle cx="81" cy="55" r="3" fill="#FFFFFF" />
				<!-- 微笑 -->
				<path
					d="M 48 78 Q 60 88 72 78"
					stroke="#2D1B4E"
					stroke-width="3"
					fill="none"
					stroke-linecap="round"
				/>
				<!-- 猫耳朵 -->
				<path d="M 25 30 L 35 55 L 15 50 Z" fill="#FFE4EC" />
				<path d="M 95 30 L 85 55 L 105 50 Z" fill="#FFE4EC" />
				<path d="M 27 35 L 34 52 L 20 48 Z" fill="#FFB6C1" />
				<path d="M 93 35 L 86 52 L 100 48 Z" fill="#FFB6C1" />
			</svg>
		</div>
		<div class="sparkles">
			<span class="sparkle">✨</span>
			<span class="sparkle">💫</span>
			<span class="sparkle">✨</span>
		</div>
	</div>
</div>

<style>
	.mascot-area {
		margin-bottom: 1rem;
	}

	.mascot-container {
		position: relative;
		cursor: pointer;
	}

	.mascot {
		width: 140px;
		height: 140px;
		transition: transform 0.3s ease;
	}

	.mascot.bouncing {
		animation: bounce 0.5s ease infinite;
	}

	.mascot-svg {
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 10px 20px rgba(255, 182, 193, 0.4));
	}

	.sparkles {
		position: absolute;
		top: -10px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.5rem;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.mascot-container:hover .sparkles {
		opacity: 1;
	}

	.sparkle {
		animation: sparkle 1s ease-in-out infinite;
	}

	.sparkle:nth-child(2) {
		animation-delay: 0.2s;
	}
	.sparkle:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-10px);
		}
	}

	@keyframes sparkle {
		0%,
		100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.3);
			opacity: 0.7;
		}
	}
</style>
