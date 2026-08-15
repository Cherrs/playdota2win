import * as adminDownloads from './routes/admin/downloads';
import * as adminAnnouncements from './routes/admin/announcements';
import * as adminAuth from './routes/admin/auth';
import * as adminCategories from './routes/admin/categories';
import * as adminNicknameKeywords from './routes/admin/nickname-keywords';
import * as adminDownload from './routes/admin/download-file';
import * as adminDownloadSync from './routes/admin/download-sync';
import * as adminMumbleHealth from './routes/admin/mumble-health';
import * as adminUploads from './routes/admin/uploads';
import * as announcements from './routes/public/announcements';
import * as categories from './routes/public/categories';
import * as nicknameKeywords from './routes/public/nickname-keywords';
import * as downloads from './routes/public/downloads';
import * as retiredDownloadAuth from './routes/public/retired-download-auth';
import * as downloadLink from './routes/public/download-link';
import * as downloadRelay from './routes/public/download-relay';
import * as getTime from './routes/public/get-time';
import * as mumbleConfig from './routes/public/mumble-config';
import * as rustDesk from './routes/public/rustdesk';
import { json } from './http';
import { prerenderPublicShell, shouldPrerenderPublicShell } from './public-shell';
import { exact, runApiHandler, splat, type ApiRoute } from './router';
import { addSecurityHeaders, rejectCrossOriginAdminMutation } from './security';

const API_ROUTES: ApiRoute[] = [
	exact('/api/admin/auth', adminAuth),
	exact('/api/admin/categories', adminCategories),
	exact('/api/admin/announcements', adminAnnouncements),
	exact('/api/admin/chat/nicknames', adminNicknameKeywords),
	exact('/api/admin/downloads/sync', adminDownloadSync),
	exact('/api/admin/mumble/health', adminMumbleHealth),
	exact('/api/admin/uploads', adminUploads),
	splat('/api/admin/download', 'path', adminDownload),
	exact('/api/admin', adminDownloads),
	exact('/api/announcements', announcements),
	exact('/api/categories', categories),
	exact('/api/chat/nicknames', nicknameKeywords),
	exact('/api/downloads/auth', retiredDownloadAuth),
	exact('/api/downloads/link', downloadLink),
	splat('/api/downloads/relay', 'path', downloadRelay),
	exact('/api/downloads', downloads),
	exact('/api/gettime', getTime),
	exact('/api/mumble/config', mumbleConfig),
	exact('/api/rustdesk', rustDesk)
];

async function handleRequest(
	request: Request,
	env: Env,
	executionContext: ExecutionContext
): Promise<Response> {
	const url = new URL(request.url);
	const crossOriginRejection = rejectCrossOriginAdminMutation(request, url);
	if (crossOriginRejection) return addSecurityHeaders(crossOriginRejection, url);

	try {
		const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/');
		let response = isApiRequest
			? await runApiHandler(request, env, executionContext, url, API_ROUTES)
			: await env.ASSETS.fetch(request);
		if (!isApiRequest && shouldPrerenderPublicShell(request, url, response)) {
			response = prerenderPublicShell(response);
		}
		return addSecurityHeaders(response, url);
	} catch (error) {
		console.error({
			component: 'worker_router',
			event_name: 'unhandled_request_error',
			path: url.pathname,
			error_message: error instanceof Error ? error.message : String(error)
		});
		return addSecurityHeaders(
			json({ success: false, error: 'Internal server error' }, { status: 500 }),
			url
		);
	}
}

export default {
	fetch: handleRequest
} satisfies ExportedHandler<Env>;
