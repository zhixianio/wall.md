import type { Env, StoredMessage } from '../types';

const MAX_MESSAGES = 200;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function messagesKey(roomId: string): string {
	return `messages:${roomId}:v1`;
}

/**
 * Read messages from KV (no side effects)
 */
export async function readMessages(
	env: Env,
	roomId: string
): Promise<StoredMessage[]> {
	const raw = await env.CLAWCON_MESSAGES.get(messagesKey(roomId));
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr as StoredMessage[];
	} catch (e) {
		console.error(`[KV] Failed to parse messages for ${roomId}:`, e);
		return [];
	}
}

/**
 * Filter expired messages in memory (no KV write)
 */
export function pruneInMemory(
	messages: StoredMessage[],
	now = Date.now()
): StoredMessage[] {
	const cutoff = now - MAX_AGE_MS;
	return messages
		.filter(m => m && typeof m.timestamp === 'number' && m.timestamp >= cutoff)
		.sort((a, b) => a.timestamp - b.timestamp)
		.slice(-MAX_MESSAGES);
}

/**
 * Write messages with automatic pruning
 */
export async function writeMessagesWithPrune(
	env: Env,
	roomId: string,
	messages: StoredMessage[]
): Promise<void> {
	const pruned = pruneInMemory(messages);
	await env.CLAWCON_MESSAGES.put(
		messagesKey(roomId),
		JSON.stringify(pruned)
	);
}
