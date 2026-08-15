import { isPublicDownloadPath } from '../src/lib/utils/public-route.ts';

export const PUBLIC_SHELL_HTML = `
<div class="initial-shell" data-prerendered-shell>
	<main class="initial-shell__main" aria-busy="true">
		<div class="initial-shell__mascot" aria-hidden="true"></div>
		<section class="initial-shell__title">
			<h1>PlayDota2Win <span aria-hidden="true">🎮</span></h1>
			<p>下载下载下载</p>
			<div class="initial-shell__stats">已有 <strong>…</strong> 位小伙伴下载</div>
		</section>
		<nav class="initial-shell__categories" aria-label="下载分类">
			<span class="initial-shell__category initial-shell__category--active">全部</span>
			<span class="initial-shell__category initial-shell__category--placeholder" aria-hidden="true"></span>
			<span class="initial-shell__category initial-shell__category--placeholder" aria-hidden="true"></span>
		</nav>
		<section class="initial-shell__downloads" aria-label="下载内容正在加载">
			<div class="initial-shell__tabs" aria-hidden="true">
				<span class="initial-shell__tab initial-shell__tab--active">下载</span>
				<span class="initial-shell__tab">配置指引</span>
			</div>
			<div class="initial-shell__cards" aria-hidden="true">
				<div class="initial-shell__card">
					<span class="initial-shell__line initial-shell__line--badge"></span>
					<span class="initial-shell__line initial-shell__line--title"></span>
					<span class="initial-shell__line"></span>
					<span class="initial-shell__line initial-shell__line--short"></span>
					<span class="initial-shell__button"></span>
				</div>
				<div class="initial-shell__card">
					<span class="initial-shell__line initial-shell__line--badge"></span>
					<span class="initial-shell__line initial-shell__line--title"></span>
					<span class="initial-shell__line"></span>
					<span class="initial-shell__line initial-shell__line--short"></span>
					<span class="initial-shell__button"></span>
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
