const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
	if (!container) return [];
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export async function focusFirstElement(
	container: HTMLElement | null,
	fallback?: HTMLElement | null
): Promise<void> {
	const focusable = getFocusableElements(container);
	const target = focusable[0] ?? fallback ?? container;
	if (target instanceof HTMLElement) {
		target.focus();
	}
}

export function trapFocus(node: HTMLElement) {
	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Tab') return;

		const focusable = getFocusableElements(node);
		if (focusable.length === 0) {
			event.preventDefault();
			node.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;

		if (event.shiftKey) {
			if (active === first || active === node) {
				event.preventDefault();
				last.focus();
			}
			return;
		}

		if (active === last) {
			event.preventDefault();
			first.focus();
		}
	};

	node.addEventListener('keydown', handleKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
		}
	};
}
