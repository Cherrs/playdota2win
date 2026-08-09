import { lazy, Suspense } from 'react';
import { Outlet, useLocation, useRouteError } from 'react-router';

const DownloadPage = lazy(() => import('./pages/DownloadPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const MumbleWidget = lazy(() => import('./components/mumble/MumbleWidget'));

function RouteFallback() {
	return (
		<div className="route-fallback" role="status" aria-live="polite">
			<div className="route-fallback__spinner" aria-hidden="true" />
			<span>加载中...</span>
		</div>
	);
}

export function AppLayout() {
	const location = useLocation();
	const isAdmin = location.pathname === '/admin' || location.pathname.startsWith('/admin/');

	return (
		<>
			<Suspense fallback={<RouteFallback />}>
				<Outlet />
			</Suspense>
			{!isAdmin ? (
				<Suspense fallback={null}>
					<MumbleWidget />
				</Suspense>
			) : null}
		</>
	);
}

export function DownloadPageRoute() {
	return <DownloadPage />;
}

export function AdminPageRoute() {
	return <AdminPage />;
}

export function RouteError() {
	const error = useRouteError();
	const message = error instanceof Error ? error.message : '页面加载失败';

	return (
		<main className="route-error">
			<span aria-hidden="true">😵</span>
			<h1>页面暂时无法打开</h1>
			<p>{message}</p>
			<a href="/">返回首页</a>
		</main>
	);
}
