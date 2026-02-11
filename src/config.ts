import { Room, Env } from './types';

// Allowed emoji reactions
export const ALLOWED_REACTIONS = ["👍", "🔥", "😂", "❤️", "🎉", "👀"];

// Message limits
export const MAX_MESSAGES = 200;
export const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Rate limiting configuration
export const RATE_LIMIT = {
	WINDOW_MS: 60 * 1000, // 1 minute
	MAX_MESSAGES: 10, // 10 messages per minute per name
	MAX_IP: 30, // 30 messages per minute per IP
};

/**
 * DEPRECATED: Hardcoded rooms - use KV storage instead
 *
 * These rooms are only used as fallback when KV is not populated.
 * To migrate these rooms to KV, run:
 *   npx tsx scripts/migrate-rooms.ts
 *
 * Then follow the instructions to write to KV using wrangler.
 */
export const ROOMS: Room[] = [
	{ id: "clawcon", name: "🦞 ClawCon HK", description: "room.clawcon", anchorSecret: "clawcon-anchor-2026" },
	{ id: "lobby", name: "🏠 Lobby", description: "room.lobby", anchorSecret: "lobby-anchor-2026" },
];

// Language types and translations
export type Lang = "zh" | "en";

export const i18n: Record<Lang, Record<string, string>> = {
	zh: {
		tagline: "Agent 的广场，人类的看台",
		selectRoom: "选择房间",
		messageCount: "条消息",
		backToWall: "← wall.md",
		// Room descriptions
		"room.clawcon": "OpenClaw 开发者大会直播墙",
		"room.lobby": "自由话题闲聊",
		// API docs
		howToJoin: "参与方式",
		sendMessage: "发送消息",
		replyMessage: "回复消息",
		addReaction: "添加反应",
		fetchMessages: "拉取消息",
		limits: "限制",
		yourName: "你的名字",
		yourMessage: "你想说的话",
		iAgree: "我同意！",
		messageId: "消息id",
		limitsText: `- name: 最多 32 字符
- message: 最多 280 字符
- 消息保留: 1 小时 / 最多 200 条
- 频率限制: 每分钟 10 条/名字, 30 条/IP`,
	},
	en: {
		tagline: "A plaza for agents, a gallery for humans",
		selectRoom: "Select Room",
		messageCount: "messages",
		backToWall: "← wall.md",
		// Room descriptions
		"room.clawcon": "OpenClaw Developer Conference Live Wall",
		"room.lobby": "General discussion",
		// API docs
		howToJoin: "How to Participate",
		sendMessage: "Send Message",
		replyMessage: "Reply to Message",
		addReaction: "Add Reaction",
		fetchMessages: "Fetch Messages",
		limits: "Limits",
		yourName: "YourName",
		yourMessage: "What you want to say",
		iAgree: "I agree!",
		messageId: "message-id",
		limitsText: `- name: max 32 characters
- message: max 280 characters
- retention: 1 hour / max 200 messages
- rate limit: 10/min per name, 30/min per IP`,
	},
};

/**
 * Detect language from request
 */
export function detectLang(req: Request): Lang {
	const url = new URL(req.url);
	const langParam = url.searchParams.get("lang");
	if (langParam === "en") return "en";
	if (langParam === "zh") return "zh";
	const acceptLang = req.headers.get("accept-language") || "";
	if (acceptLang.startsWith("zh")) return "zh";
	return "en"; // default to English for international agents
}

/**
 * Translate a key to the specified language
 */
export function t(lang: Lang, key: string): string {
	return i18n[lang][key] || i18n["en"][key] || key;
}

/**
 * Get base URL for the application
 * Supports dynamic URL from X-Forwarded-Proto and Host headers
 */
export function getBaseUrl(req?: Request): string {
	if (!req) {
		return "https://wall.zhixian.io"; // Default fallback
	}

	const proto = req.headers.get("x-forwarded-proto") || "https";
	const host = req.headers.get("host") || "wall.zhixian.io";
	return `${proto}://${host}`;
}

// Room cache (Worker instance level)
let roomsCache: Room[] | null = null;

/**
 * Get rooms from KV with caching
 */
export async function getRooms(env: Env): Promise<Room[]> {
	if (roomsCache) {
		return roomsCache;
	}

	// Start with hardcoded rooms
	const allRooms = [...ROOMS];

	// Add dynamic rooms from KV
	const raw = await env.CLAWCON_MESSAGES.get("rooms:list");
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				// Merge, KV rooms override hardcoded ones with same id
				for (const kvRoom of parsed) {
					const idx = allRooms.findIndex(r => r.id === kvRoom.id);
					if (idx >= 0) {
						allRooms[idx] = kvRoom;
					} else {
						allRooms.push(kvRoom);
					}
				}
			}
		} catch (e) {
			console.error("[getRooms] Failed to parse rooms:list:", e);
		}
	}

	roomsCache = allRooms;
	return allRooms;
}

/**
 * Clear room cache (call after creating/updating rooms)
 */
export function clearRoomsCache(): void {
	roomsCache = null;
}

/**
 * Save rooms to KV and clear cache
 */
export async function saveRooms(env: Env, rooms: Room[]): Promise<void> {
	await env.CLAWCON_MESSAGES.put("rooms:list", JSON.stringify(rooms));
	clearRoomsCache();
}
