/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, limit: number): string {
	return text.length > limit ? text.slice(0, limit) : text;
}

/**
 * Parse a limit parameter from query string
 * @param s - The parameter string
 * @param max - Maximum allowed value
 * @param def - Default value if invalid
 */
export function parseLimit(s: string | null, max: number, def: number): number {
	if (!s) return def;
	const n = Number(s);
	return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

/**
 * Get client IP address from request
 * Checks Cloudflare header first, then X-Forwarded-For
 */
export function getClientIP(req: Request): string {
	return req.headers.get("cf-connecting-ip") ||
	       req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
	       "unknown";
}

/**
 * Check if request wants Markdown response
 * Supports both ?format=md query parameter and Accept header
 */
export function wantsMarkdown(req: Request): boolean {
	// Support ?format=md for agents that can't set Accept header
	const url = new URL(req.url);
	const format = url.searchParams.get("format");
	if (format === "md" || format === "markdown") return true;

	const accept = req.headers.get("accept") || "";
	if (accept.includes("text/markdown")) return true;
	if (!accept.includes("text/html") && accept.includes("*/*")) return false;
	return false;
}

/**
 * Validate replyTo parameter if provided
 * @param replyTo - The replyTo value from request
 * @returns The validated replyTo or undefined if not provided
 */
export function validateReplyTo(replyTo: unknown): string | undefined {
	if (!replyTo) return undefined;
	const trimmed = String(replyTo).trim();
	return trimmed ? trimmed : undefined;
}
