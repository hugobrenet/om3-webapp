
export class ApiError extends Error {
    constructor(message, {status = null, statusText = null, body = null} = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}

/** The Authorization header of a request to the daemon, the token of the session. */
export const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

/** Of a whole page, a proxy's error say: not words to show, the status says more. */
const HTML_PAGE = /^\s*<(!doctype\s+html|html)[\s>]/i;

/**
 * The words of the body of a refusal, null when it has none. The daemon's problem, its
 * detail or its title; the error or the message of the others; the values of any other
 * object; a text, but for a page of HTML.
 */
function wordsOf(body) {
    if (typeof body === "string") return body.trim() === "" || HTML_PAGE.test(body) ? null : body;
    if (!body || typeof body !== "object") return null;
    for (const key of ["detail", "title", "error", "message"]) {
        if (typeof body[key] === "string" && body[key].trim() !== "") return body[key];
    }
    const values = Object.values(body).map((value) => (typeof value === "string" ? value : JSON.stringify(value)));
    return values.length > 0 ? values.join(" | ") : null;
}

/**
 * The reason a refusal gives, in words: those of its body; else what apiFetch said of it.
 */
export function problemOf(err) {
    return wordsOf(err?.body) ?? err?.message ?? "";
}

/**
 * The body of a response: JSON, else its text, null when empty or unreadable. Read as
 * text first: a body is read only once, a failed response.json() would leave no text.
 */
async function readBody(response) {
    if (typeof response.text !== "function") {
        try {
            return typeof response.json === "function" ? await response.json() : null;
        } catch {
            return null;
        }
    }
    let text;
    try {
        text = await response.text();
    } catch {
        return null;
    }
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export async function apiFetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeout || 10000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
        response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
    } catch (networkErr) {
        clearTimeout(timeoutId);
        if (networkErr.name === 'AbortError') {
            throw new ApiError(`Request timed out after ${timeoutMs}ms`, {body: null});
        }
        throw new ApiError(networkErr.message || 'Network error', {body: null});
    }

    const parsedBody = await readBody(response);

    if (!response.ok) {
        const message = wordsOf(parsedBody) ||
            response.statusText ||
            `Request failed with status ${response.status}`;

        throw new ApiError(message, {
            status: response.status,
            statusText: response.statusText,
            body: parsedBody
        });
    }

    // JSON announced and not JSON: nothing the caller can use.
    const contentType = typeof response.headers?.get === "function" ? response.headers.get("content-type") : null;
    if (typeof parsedBody === "string" && contentType?.includes("application/json")) return null;

    return parsedBody;
}

export async function getResponseErrorMessage(response) {
    if (!response) {
        return null;
    }
    return wordsOf(await readBody(response));
}
