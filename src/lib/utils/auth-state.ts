const GUIDE_VERIFIED_KEY = 'guide_password_verified';

export function isGuideVerified(): boolean {
	if (typeof window === 'undefined') return false;
	return sessionStorage.getItem(GUIDE_VERIFIED_KEY) === 'true';
}

export function setGuideVerified(): void {
	if (typeof window === 'undefined') return;
	sessionStorage.setItem(GUIDE_VERIFIED_KEY, 'true');
}
