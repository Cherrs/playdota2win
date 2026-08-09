import { useSyncExternalStore } from 'react';

import {
	createInitialMumbleClientSnapshot,
	type MumbleClient,
	type MumbleClientSnapshot
} from '../lib/mumble/client';

const EMPTY_SNAPSHOT = createInitialMumbleClientSnapshot();
const getEmptySnapshot = (): MumbleClientSnapshot => EMPTY_SNAPSHOT;
const subscribeToNothing = (): (() => void) => () => {};

/** Subscribe to a browser Mumble client without coupling the client to React. */
export function useMumbleClientSnapshot(client: MumbleClient | null): MumbleClientSnapshot {
	return useSyncExternalStore(
		client?.subscribe ?? subscribeToNothing,
		client?.getSnapshot ?? getEmptySnapshot,
		getEmptySnapshot
	);
}
