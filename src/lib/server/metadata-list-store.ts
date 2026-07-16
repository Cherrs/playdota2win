export interface MetadataList {
	lastUpdated: number;
}

export interface MetadataListStoreConfig<TList extends MetadataList> {
	name: string;
	kvKey: string;
	r2Key: `.metadata/${string}.json`;
	isValid: (value: unknown) => value is TList;
}

export interface MetadataListStoreOptions {
	/**
	 * Explicit escape hatch for local tests/development that intentionally provide KV without R2.
	 * Deployed Workers must leave this disabled so a missing R2 binding fails closed.
	 */
	allowKvOnlyForLocalDevelopment?: boolean;
}

export interface MetadataListSnapshot<TList extends MetadataList> {
	list: TList;
	/** Raw R2 ETag used for a conditional write; null is the KV-only development fallback. */
	version: string | null;
}

export class MetadataListConflictError extends Error {
	constructor(name: string) {
		super(`${name} changed while this request was in progress`);
		this.name = 'MetadataListConflictError';
	}
}

export class MetadataListStorageUnavailableError extends Error {
	constructor(message = 'Canonical R2 metadata storage is unavailable') {
		super(message);
		this.name = 'MetadataListStorageUnavailableError';
	}
}

async function parseR2List<TList extends MetadataList>(
	object: R2ObjectBody,
	config: MetadataListStoreConfig<TList>
): Promise<TList> {
	const value = await object.json<unknown>();
	if (!config.isValid(value)) {
		throw new MetadataListStorageUnavailableError(
			`Canonical R2 ${config.name} snapshot is invalid`
		);
	}
	return value;
}

async function readRequiredKvList<TList extends MetadataList>(
	kv: KVNamespace | undefined,
	config: MetadataListStoreConfig<TList>
): Promise<TList> {
	if (!kv) {
		throw new MetadataListStorageUnavailableError(
			`KV ${config.name} binding is unavailable for local development`
		);
	}

	const value = await kv.get<unknown>(config.kvKey, 'json');
	if (value === null || value === undefined) {
		throw new MetadataListStorageUnavailableError(
			`KV ${config.name} snapshot is missing for local development`
		);
	}
	if (!config.isValid(value)) {
		throw new MetadataListStorageUnavailableError(
			`KV ${config.name} snapshot is invalid for local development`
		);
	}
	return value;
}

/**
 * Read a strongly consistent metadata snapshot from R2. Runtime requests never migrate from KV:
 * canonical objects must be created by the explicit migration tooling before serving traffic.
 * KV is only read when an explicit local-development fallback has been enabled by the caller.
 */
export async function readMetadataList<TList extends MetadataList>(
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	config: MetadataListStoreConfig<TList>,
	options: MetadataListStoreOptions = {}
): Promise<MetadataListSnapshot<TList>> {
	if (!r2) {
		if (!options.allowKvOnlyForLocalDevelopment) {
			throw new MetadataListStorageUnavailableError();
		}
		return {
			list: await readRequiredKvList(kv, config),
			version: null
		};
	}

	const existing = await r2.get(config.r2Key);
	if (existing) {
		return { list: await parseR2List(existing, config), version: existing.etag };
	}

	throw new MetadataListStorageUnavailableError(
		`Canonical R2 ${config.name} snapshot is missing; run the explicit metadata migration before serving requests`
	);
}

export async function writeMetadataList<TList extends MetadataList>(
	snapshot: MetadataListSnapshot<TList>,
	nextList: TList,
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	config: MetadataListStoreConfig<TList>,
	options: MetadataListStoreOptions = {}
): Promise<MetadataListSnapshot<TList>> {
	const list = { ...nextList, lastUpdated: Date.now() } as TList;
	if (!config.isValid(list)) {
		throw new MetadataListStorageUnavailableError(
			`Refusing to store invalid ${config.name} snapshot`
		);
	}

	if (!r2) {
		if (!options.allowKvOnlyForLocalDevelopment) {
			throw new MetadataListStorageUnavailableError();
		}
		if (!kv) {
			throw new MetadataListStorageUnavailableError(
				`KV ${config.name} binding is unavailable for local development`
			);
		}
		await kv.put(config.kvKey, JSON.stringify(list));
		return { list, version: null };
	}

	if (!snapshot.version) {
		throw new MetadataListConflictError(config.name);
	}
	const stored = await r2.put(config.r2Key, JSON.stringify(list), {
		onlyIf: { etagMatches: snapshot.version },
		httpMetadata: { contentType: 'application/json; charset=utf-8' }
	});
	if (!stored) throw new MetadataListConflictError(config.name);

	if (kv) {
		try {
			await kv.put(config.kvKey, JSON.stringify(list));
		} catch (error) {
			// R2 already committed. KV is only the migration mirror, so its failure must not make a
			// successful canonical update look unsuccessful to the caller.
			console.warn({
				component: 'metadata_list_store',
				event_name: 'kv_mirror_write_failed',
				metadata_name: config.name,
				error_message: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return { list, version: stored.etag };
}
