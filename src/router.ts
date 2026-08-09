import { createBrowserRouter } from 'react-router';

import { AdminPageRoute, AppLayout, DownloadPageRoute, RouteError } from './route-components';

export const router = createBrowserRouter([
	{
		path: '/',
		Component: AppLayout,
		ErrorBoundary: RouteError,
		children: [
			{ index: true, Component: DownloadPageRoute },
			{ path: 'download', Component: DownloadPageRoute },
			{ path: 'admin', Component: AdminPageRoute }
		]
	}
]);
