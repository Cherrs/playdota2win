import type { MumbleChannel, MumbleUser } from '$lib/types';

export interface MumbleChannelOption {
	id: number;
	label: string;
	depth: number;
}

function sortChannelsByName(a: MumbleChannel, b: MumbleChannel): number {
	return a.name.localeCompare(b.name, 'zh-CN');
}

export function dedupeChannels(channels: MumbleChannel[]): MumbleChannel[] {
	const channelIds: number[] = [];
	const channelsById = new Map<number, MumbleChannel>();

	for (const channel of channels) {
		const existing = channelsById.get(channel.id);
		if (!existing) {
			channelIds.push(channel.id);
			channelsById.set(channel.id, channel);
			continue;
		}

		channelsById.set(channel.id, {
			...existing,
			name: existing.name || channel.name,
			description: existing.description || channel.description,
			parentId:
				existing.parentId === existing.id && channel.parentId !== channel.id
					? channel.parentId
					: existing.parentId
		});
	}

	return channelIds.map((channelId) => channelsById.get(channelId)!);
}

export function buildChannelOptions(channels: MumbleChannel[]): MumbleChannelOption[] {
	if (channels.length === 0) {
		return [];
	}

	const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
	const children = new Map<number, MumbleChannel[]>();
	const roots: MumbleChannel[] = [];

	for (const channel of channels) {
		if (channel.parentId === channel.id || !channelMap.has(channel.parentId)) {
			roots.push(channel);
			continue;
		}

		const siblings = children.get(channel.parentId) ?? [];
		siblings.push(channel);
		children.set(channel.parentId, siblings);
	}

	const ordered: MumbleChannelOption[] = [];

	function visit(channel: MumbleChannel, depth: number): void {
		ordered.push({
			id: channel.id,
			label: `${depth > 0 ? `${'— '.repeat(depth)}` : ''}${channel.name}`,
			depth
		});

		const nested = [...(children.get(channel.id) ?? [])].sort(sortChannelsByName);
		for (const child of nested) {
			visit(child, depth + 1);
		}
	}

	for (const root of [...roots].sort(sortChannelsByName)) {
		visit(root, 0);
	}

	return ordered;
}

export function createChannelNameMap(channels: MumbleChannel[]): Map<number, string> {
	return new Map(channels.map((channel) => [channel.id, channel.name]));
}

export function countUsersByChannel(users: MumbleUser[]): Map<number, number> {
	const counts = new Map<number, number>();

	for (const user of users) {
		counts.set(user.channelId, (counts.get(user.channelId) ?? 0) + 1);
	}

	return counts;
}
