export interface MumbleNetworkStats {
	route: 'direct' | 'relay' | 'unknown';
	protocol: string;
	rttMs: number | null;
	jitterMs: number | null;
	packetLossPercent: number | null;
}

/** Use the selected transport pair; a succeeded pair may no longer carry media. */
export function readNetworkStats(report: RTCStatsReport): MumbleNetworkStats {
	const stats = [...report.values()];
	const transport = stats.find(
		(entry) => entry.type === 'transport' && entry.selectedCandidatePairId
	);
	const pair = transport ? report.get(transport.selectedCandidatePairId) : undefined;
	const local = pair ? report.get(pair.localCandidateId) : undefined;
	const remote = pair ? report.get(pair.remoteCandidateId) : undefined;
	const inbound = stats.filter((entry) => entry.type === 'inbound-rtp' && entry.kind === 'audio');
	const lost = inbound.reduce((sum, entry) => sum + Math.max(0, entry.packetsLost ?? 0), 0);
	const received = inbound.reduce((sum, entry) => sum + (entry.packetsReceived ?? 0), 0);
	const jitter = inbound
		.filter((entry) => typeof entry.jitter === 'number')
		.map((entry) => entry.jitter);
	return {
		route:
			!local || !remote
				? 'unknown'
				: local.candidateType === 'relay' || remote.candidateType === 'relay'
					? 'relay'
					: 'direct',
		protocol: local?.relayProtocol ?? local?.protocol ?? '',
		rttMs: typeof pair?.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null,
		jitterMs: jitter.length ? Math.max(...jitter) * 1000 : null,
		packetLossPercent: lost + received > 0 ? (lost / (lost + received)) * 100 : null
	};
}
