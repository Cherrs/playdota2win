import { type RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

export function useDialogFocus(
	open: boolean,
	dialogRef: RefObject<HTMLElement | null>,
	preferredRef: RefObject<HTMLElement | null>,
	onClose: () => void
): void {
	useEffect(() => {
		if (!open) return;

		const previousFocus =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const dialog = dialogRef.current;
		const focusable = dialog
			? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
			: [];
		(preferredRef.current ?? focusable[0] ?? dialog)?.focus();

		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== 'Tab' || !dialog) return;

			const nextFocusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
			if (nextFocusable.length === 0) {
				event.preventDefault();
				dialog.focus();
				return;
			}

			const first = nextFocusable[0];
			const last = nextFocusable[nextFocusable.length - 1];
			if (
				event.shiftKey &&
				(document.activeElement === first || document.activeElement === dialog)
			) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			previousFocus?.focus();
		};
	}, [dialogRef, onClose, open, preferredRef]);
}
