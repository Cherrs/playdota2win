import { isPublicDownloadPath } from '../src/lib/utils/public-route.ts';

export const PUBLIC_SHELL_HTML = `
<div class="initial-shell" data-prerendered-shell>
	<header class="initial-shell__header">
		<a class="initial-shell__brand" href="/" aria-label="PlayDota2Win 首页">
			<span class="initial-shell__brand-mark" aria-hidden="true">
				<svg viewBox="0 0 120 120"><circle cx="60" cy="64" r="48" fill="#ffe8e5"/><path d="M22 28 35 56 12 50Z" fill="#ffe8e5"/><path d="m98 28-13 28 23-6Z" fill="#ffe8e5"/><path d="m24 34 10 19-17-5Z" fill="#ffabb6"/><path d="m96 34-10 19 17-5Z" fill="#ffabb6"/><ellipse cx="31" cy="71" rx="11" ry="7" fill="#ffb8c0" opacity=".66"/><ellipse cx="89" cy="71" rx="11" ry="7" fill="#ffb8c0" opacity=".66"/><circle cx="42" cy="59" r="9" fill="#3f2b7a"/><circle cx="78" cy="59" r="9" fill="#3f2b7a"/><circle cx="45" cy="55.5" r="3.2" fill="#fff"/><circle cx="81" cy="55.5" r="3.2" fill="#fff"/><path d="M47 79q13 13 26 0" stroke="#3f2b7a" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>
			</span>
			<span>PlayDota2Win</span>
		</a>
		<nav class="initial-shell__nav" aria-label="主导航">
			<a class="initial-shell__nav-item initial-shell__nav-item--active" href="/">首页</a>
			<a class="initial-shell__nav-item" href="#initial-shell-downloads">配置指引</a>
			<span class="initial-shell__nav-item">社区</span>
		</nav>
	</header>
	<main class="initial-shell__main" aria-busy="true">
		<section class="initial-shell__hero">
			<div class="initial-shell__mascot" aria-hidden="true">
				<svg viewBox="0 0 120 120"><circle cx="60" cy="64" r="48" fill="#ffe8e5"/><path d="M22 28 35 56 12 50Z" fill="#ffe8e5"/><path d="m98 28-13 28 23-6Z" fill="#ffe8e5"/><path d="m24 34 10 19-17-5Z" fill="#ffabb6"/><path d="m96 34-10 19 17-5Z" fill="#ffabb6"/><ellipse cx="31" cy="71" rx="11" ry="7" fill="#ffb8c0" opacity=".66"/><ellipse cx="89" cy="71" rx="11" ry="7" fill="#ffb8c0" opacity=".66"/><circle cx="42" cy="59" r="9" fill="#3f2b7a"/><circle cx="78" cy="59" r="9" fill="#3f2b7a"/><circle cx="45" cy="55.5" r="3.2" fill="#fff"/><circle cx="81" cy="55.5" r="3.2" fill="#fff"/><path d="M47 79q13 13 26 0" stroke="#3f2b7a" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>
			</div>
			<div class="initial-shell__title">
				<h1>PlayDota2Win</h1>
				<p>下载中心</p>
				<div class="initial-shell__stats">已有 <strong>…</strong> 位小伙伴下载</div>
			</div>
		</section>
		<nav class="initial-shell__categories" aria-label="下载分类">
			<span class="initial-shell__category initial-shell__category--active">▦ 全部</span>
			<span class="initial-shell__category initial-shell__category--placeholder" aria-hidden="true"></span>
			<span class="initial-shell__category initial-shell__category--placeholder" aria-hidden="true"></span>
		</nav>
		<section class="initial-shell__downloads" id="initial-shell-downloads" aria-label="下载内容正在加载">
			<div class="initial-shell__tabs" aria-hidden="true">
				<span class="initial-shell__tab initial-shell__tab--active">下载</span>
				<span class="initial-shell__tab">配置指引</span>
			</div>
			<div class="initial-shell__cards" aria-hidden="true">
				<div class="initial-shell__card">
					<span class="initial-shell__product"></span>
					<span class="initial-shell__line initial-shell__line--title"></span>
					<span class="initial-shell__line"></span>
					<span class="initial-shell__line initial-shell__line--short"></span>
					<span class="initial-shell__button"></span>
				</div>
				<div class="initial-shell__card">
					<span class="initial-shell__product"></span>
					<span class="initial-shell__line initial-shell__line--title"></span>
					<span class="initial-shell__line"></span>
					<span class="initial-shell__line initial-shell__line--short"></span>
					<span class="initial-shell__button"></span>
				</div>
				<div class="initial-shell__card">
					<span class="initial-shell__product initial-shell__product--warm"></span>
					<span class="initial-shell__line initial-shell__line--title"></span>
					<span class="initial-shell__line"></span>
					<span class="initial-shell__line initial-shell__line--short"></span>
					<span class="initial-shell__button initial-shell__button--warm"></span>
				</div>
			</div>
		</section>
	</main>
</div>`;

export function shouldPrerenderPublicShell(
	request: Request,
	url: URL,
	response: Response
): boolean {
	return (
		request.method === 'GET' &&
		isPublicDownloadPath(url.pathname) &&
		response.ok &&
		(response.headers.get('Content-Type') ?? '').startsWith('text/html')
	);
}

export function prerenderPublicShell(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.delete('Content-Length');
	headers.delete('ETag');

	const source = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});

	return new HTMLRewriter()
		.on('#root', {
			element(element) {
				element.setInnerContent(PUBLIC_SHELL_HTML, { html: true });
			}
		})
		.transform(source);
}
