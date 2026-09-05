import assert from 'node:assert/strict';
import test from 'node:test';
import { readNetworkStats } from './stats.ts';

test('reports the selected pair rather than an obsolete succeeded direct pair', () => {
	const entries = [
		{
			id: 'old',
			type: 'candidate-pair',
			state: 'succeeded',
			localCandidateId: 'host',
			remoteCandidateId: 'remote'
		},
		{ id: 'transport', type: 'transport', selectedCandidatePairId: 'selected' },
		{
			id: 'selected',
			type: 'candidate-pair',
			localCandidateId: 'relay',
			remoteCandidateId: 'remote',
			currentRoundTripTime: 0.043
		},
		{ id: 'host', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
		{
			id: 'relay',
			type: 'local-candidate',
			candidateType: 'relay',
			protocol: 'udp',
			relayProtocol: 'tls'
		},
		{ id: 'remote', type: 'remote-candidate', candidateType: 'host' },
		{
			id: 'audio',
			type: 'inbound-rtp',
			kind: 'audio',
			packetsReceived: 98,
			packetsLost: 2,
			jitter: 0.005
		}
	];
	const stats = readNetworkStats(
		new Map(entries.map((entry) => [entry.id, entry])) as RTCStatsReport
	);
	assert.deepEqual(stats, {
		route: 'relay',
		protocol: 'tls',
		rttMs: 43,
		jitterMs: 5,
		packetLossPercent: 2
	});
});

test('missing selected transport is unknown and missing samples are not zero loss', () => {
	assert.deepEqual(readNetworkStats(new Map() as RTCStatsReport), {
		route: 'unknown',
		protocol: '',
		rttMs: null,
		jitterMs: null,
		packetLossPercent: null
	});
});
