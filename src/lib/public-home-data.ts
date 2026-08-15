import type { AnnouncementList, ApiResponse, CategoryList, PublicDownloadList } from './types';

const PRELOAD_TTL_MS = 10_000;

export interface PublicHomeJsonResponse<T> {
	ok: boolean;
	status: number;
	data: ApiResponse<T>;
}

interface LoadOptions {
	force?: boolean;
	signal?: AbortSignal;
}

interface PreloadedRequest<T> {
	expiresAt: number;
	promise: Promise<PublicHomeJsonResponse<T>>;
}

export interface PublicHomeDataPreload {
	createdAt: number;
	categories: Promise<PublicHomeJsonResponse<CategoryList>>;
	downloads: Promise<PublicHomeJsonResponse<PublicDownloadList>>;
	announcements: Promise<PublicHomeJsonResponse<AnnouncementList>>;
}

declare global {
	interface Window {
		__PLAYDOTA2WIN_PUBLIC_HOME_PRELOAD__?: PublicHomeDataPreload;
	}
}

function createResource<T>(
	url: string,
	fetcher: typeof fetch,
	now: () => number,
	requestInit?: RequestInit
) {
	let preloaded: PreloadedRequest<T> | null = null;

	const request = async (signal?: AbortSignal): Promise<PublicHomeJsonResponse<T>> => {
		const response = await fetcher(url, {
			...requestInit,
			...(signal ? { signal } : {})
		});
		const data = (await response.json()) as ApiResponse<T>;
		return { ok: response.ok, status: response.status, data };
	};

	const preload = () => {
		if (preloaded && preloaded.expiresAt > now()) return;
		const promise = request();
		void promise.catch(() => undefined);
		preloaded = { expiresAt: now() + PRELOAD_TTL_MS, promise };
	};

	const seed = (promise: Promise<PublicHomeJsonResponse<T>>, expiresAt: number) => {
		void promise.catch(() => undefined);
		preloaded = { expiresAt, promise };
	};

	const load = async (options: LoadOptions = {}): Promise<PublicHomeJsonResponse<T>> => {
		if (options.force) preloaded = null;
		if (!preloaded || preloaded.expiresAt <= now()) {
			return request(options.signal);
		}

		const result = await preloaded.promise;
		options.signal?.throwIfAborted();
		return result;
	};

	return { load, preload, seed };
}

function takeBrowserPreload(): PublicHomeDataPreload | undefined {
	if (typeof window === 'undefined') return undefined;
	const preload = window.__PLAYDOTA2WIN_PUBLIC_HOME_PRELOAD__;
	delete window.__PLAYDOTA2WIN_PUBLIC_HOME_PRELOAD__;
	return preload;
}

export function createPublicHomeDataLoader(
	fetcher: typeof fetch = fetch,
	now: () => number = Date.now,
	initialPreload: PublicHomeDataPreload | undefined = takeBrowserPreload()
) {
	const categories = createResource<CategoryList>('/api/categories', fetcher, now);
	const downloads = createResource<PublicDownloadList>('/api/downloads', fetcher, now, {
		cache: 'no-store'
	});
	const announcements = createResource<AnnouncementList>('/api/announcements', fetcher, now);
	if (initialPreload) {
		const expiresAt = Math.max(initialPreload.createdAt + PRELOAD_TTL_MS, now() + PRELOAD_TTL_MS);
		categories.seed(initialPreload.categories, expiresAt);
		downloads.seed(initialPreload.downloads, expiresAt);
		announcements.seed(initialPreload.announcements, expiresAt);
	}

	return {
		preload() {
			categories.preload();
			downloads.preload();
			announcements.preload();
		},
		loadCategories: categories.load,
		loadDownloads: downloads.load,
		loadAnnouncements: announcements.load
	};
}

export const publicHomeDataLoader = createPublicHomeDataLoader();
