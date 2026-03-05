import { readFileSync, writeFileSync } from 'node:fs';

const workerPath = '.svelte-kit/cloudflare/_worker.js';
const chatRoomImport = 'import { ChatRoom } from "../../src/lib/server/chat/chat-room.ts";';

const original = readFileSync(workerPath, 'utf8');
let next = original;

if (!next.includes(chatRoomImport)) {
	const envImport = 'import { env } from "cloudflare:workers";';
	if (!next.includes(envImport)) {
		throw new Error('Cannot find cloudflare:workers env import in worker output.');
	}
	next = next.replace(envImport, `${envImport}\n${chatRoomImport}`);
}

if (!/worker_default as default,\s*ChatRoom/.test(next)) {
	const exportPattern = /export\s*\{\s*worker_default as default\s*\};/m;
	if (!exportPattern.test(next)) {
		throw new Error('Cannot find default worker export block for ChatRoom patch.');
	}
	next = next.replace(
		exportPattern,
		`export {
  worker_default as default,
  ChatRoom
};`
	);
}

if (next !== original) {
	writeFileSync(workerPath, next, 'utf8');
	console.log('Patched worker export with ChatRoom durable object.');
} else {
	console.log('Worker already includes ChatRoom durable object export.');
}
