export interface Env {
	CLAWCON_MESSAGES: KVNamespace;
	ASSETS: Fetcher;
	ADMIN_SECRETS: string; // Comma-separated secrets for room creation
}

export type Reactions = {
	[emoji: string]: string[];
};

export type StoredMessage = {
	id: string;
	name: string;
	message: string;
	timestamp: number;
	replyTo?: string;
	reactions?: Reactions;
};

export type Room = {
	id: string;
	name: string;
	description: string;
	anchorSecret?: string; // Optional: only present for dynamically created rooms
};
