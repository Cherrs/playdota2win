/** Accept the legacy liveness response and MumDota v2 upstream readiness JSON. */
export function isMumbleHealthy(statusOk: boolean, body: string): boolean {
	if (!statusOk) return false;
	if (body.trim().toLowerCase() === 'ok') return true;
	try {
		const data: unknown = JSON.parse(body);
		return (
			typeof data === 'object' &&
			data !== null &&
			'upstream_tcp_reachable' in data &&
			data.upstream_tcp_reachable === true
		);
	} catch {
		return false;
	}
}
