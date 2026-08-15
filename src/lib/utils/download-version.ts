import { extractFilenameFromUrl } from './parseFilename.ts';

const NUMERIC_VERSION_PATTERN = /(?:^|[^0-9])v?(\d+(?:\.\d+)+)(?=$|[^0-9])/iu;

/**
 * Extract the comparable numeric release portion from a filename, URL or version label.
 * Architecture suffixes such as `-x86_64` are deliberately excluded.
 */
export function extractComparableVersion(value: string): string | undefined {
	const filename = extractFilenameFromUrl(value) || value;
	return filename.match(NUMERIC_VERSION_PATTERN)?.[1] || value.match(NUMERIC_VERSION_PATTERN)?.[1];
}

export function compareNumericVersions(left: string, right: string): number {
	const leftParts = left.split('.').map(Number);
	const rightParts = right.split('.').map(Number);
	const length = Math.max(leftParts.length, rightParts.length);

	for (let index = 0; index < length; index += 1) {
		const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
		if (difference !== 0) return difference > 0 ? 1 : -1;
	}
	return 0;
}

/** Returns null when either filename does not expose a comparable dotted version. */
export function compareVersionedFilenames(left: string, right: string): number | null {
	const leftVersion = extractComparableVersion(left);
	const rightVersion = extractComparableVersion(right);
	return leftVersion && rightVersion ? compareNumericVersions(leftVersion, rightVersion) : null;
}
