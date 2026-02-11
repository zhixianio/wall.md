export function json(data: unknown, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	return new Response(JSON.stringify(data), { ...init, headers });
}

export function markdown(text: string, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("content-type", "text/markdown; charset=utf-8");
	return new Response(text, { ...init, headers });
}

export function html(text: string, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("content-type", "text/html; charset=utf-8");
	return new Response(text, { ...init, headers });
}
