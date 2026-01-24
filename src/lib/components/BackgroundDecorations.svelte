<script lang="ts">
	// Floating background decorations - stars and clouds
</script>

<div class="bg-decorations">
	<div class="floating-star star-1">✦</div>
	<div class="floating-star star-2">★</div>
	<div class="floating-star star-3">✧</div>
	<div class="floating-star star-4">❋</div>
	<div class="floating-cloud cloud-1">☁</div>
	<div class="floating-cloud cloud-2">☁</div>
</div>

<style>
	.bg-decorations {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
		z-index: 0;
	}

	.floating-star {
		position: absolute;
		font-size: 2rem;
		color: #ffb6c1;
		animation: float 6s ease-in-out infinite;
		opacity: 0.6;
	}

	.star-1 {
		top: 10%;
		left: 10%;
		animation-delay: 0s;
		color: #ffd700;
	}
	.star-2 {
		top: 20%;
		right: 15%;
		animation-delay: 1s;
		color: #ff69b4;
	}
	.star-3 {
		bottom: 30%;
		left: 8%;
		animation-delay: 2s;
		color: #dda0dd;
	}
	.star-4 {
		bottom: 20%;
		right: 10%;
		animation-delay: 3s;
		color: #87ceeb;
	}

	.floating-cloud {
		position: absolute;
		font-size: 4rem;
		color: #ffffff;
		opacity: 0.5;
		animation: drift 20s linear infinite;
	}

	.cloud-1 {
		top: 15%;
		left: -10%;
		animation-duration: 25s;
	}
	.cloud-2 {
		top: 60%;
		left: -10%;
		animation-duration: 30s;
		animation-delay: 10s;
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0) rotate(0deg);
		}
		50% {
			transform: translateY(-20px) rotate(10deg);
		}
	}

	@keyframes drift {
		from {
			transform: translateX(-100px);
		}
		to {
			transform: translateX(calc(100vw + 100px));
		}
	}
</style>
