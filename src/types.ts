export interface Env {
	CLAWCON_MESSAGES: KVNamespace;
	ASSETS: Fetcher;
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
};
