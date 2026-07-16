/**
 * Raw uploads pass through a Cloudflare Worker. Keep the application limit
 * below the 100 MB request-body ceiling used by Free and Pro zones.
 */
export const MAX_ADMIN_R2_UPLOAD_BYTES = 90 * 1024 * 1024;

/** External mirrors are bounded so one synchronous backup cannot grow forever. */
export const MAX_EXTERNAL_BACKUP_BYTES = 200 * 1024 * 1024;

export function formatMiB(bytes: number): string {
	return `${Math.floor(bytes / (1024 * 1024))} MiB`;
}
