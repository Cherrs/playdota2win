import {
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef
} from 'react';

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

interface PublicDialogOptions {
	dialogRef: RefObject<HTMLElement | null>;
	initialFocusRef?: RefObject<HTMLElement | null>;
	onClose: () => void;
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
	if (!container) return [];
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Keeps focus inside public dialogs: focus enters on mount, Escape closes,
 * and focus returns to the opener.
 */
export function usePublicDialog({
	dialogRef,
	initialFocusRef,
	onClose
}: PublicDialogOptions): (event: ReactKeyboardEvent<HTMLElement>) => void {
	const onCloseRef = useRef(onClose);

	useLayoutEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		const lastFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const focusTimer = window.requestAnimationFrame(() => {
			const requestedTarget = initialFocusRef?.current;
			const target =
				requestedTarget ?? getFocusableElements(dialogRef.current)[0] ?? dialogRef.current;
			target?.focus();
		});
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onCloseRef.current();
		};

		document.addEventListener('keydown', handleEscape);
		return () => {
			window.cancelAnimationFrame(focusTimer);
			document.removeEventListener('keydown', handleEscape);
			lastFocusedElement?.focus();
		};
	}, [dialogRef, initialFocusRef]);

	return useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			if (event.key !== 'Tab') return;

			const focusable = getFocusableElements(dialogRef.current);
			if (focusable.length === 0) {
				event.preventDefault();
				dialogRef.current?.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || active === dialogRef.current)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		},
		[dialogRef]
	);
}
