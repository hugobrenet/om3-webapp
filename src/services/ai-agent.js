import {parseAiAgentUrl} from '../config/ai-agent.js';

const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_TITLE_CHARACTERS = 80;
const MAX_HISTORY_BYTES = 1024 * 1024;
const MAX_HISTORY_MESSAGES = 100;
const EVENT_TYPES = new Set([
    'text_delta',
    'tool_started',
    'tool_finished',
    'usage',
    'completed',
    'confirmation_required',
    'error',
]);
const DECISIONS = new Set(['approve', 'reject']);
// The turn error codes the webapp explains. The agent message is never shown:
// any other code gets the generic failure message.
const TURN_ERROR_MESSAGES = {
    tool_call_limit:
        'This question needs more tools at once than the agent runs. Ask a narrower question. It was not retried.',
};
// A confirmation decision answers 409 when the action no longer waits and 410
// when its request expired, not when the conversation is busy or expired.
const CONFIRMATION_HTTP_MESSAGES = {
    409: 'This action no longer waits for a decision.',
    410: 'The confirmation request expired. The action was not run.',
};
const HTTP_MESSAGES = {
    401: 'Authentication required. Renew your session before trying again.',
    403: 'Access denied to the agent or target cluster.',
    404: 'Conversation not found.',
    409: 'Conversation busy or conversation limit reached.',
    410: 'Conversation expired.',
    413: 'The request or stored message exceeds the allowed size.',
    429: 'Agent busy. Try again later.',
    503: 'Authentication or agent temporarily unavailable.',
};

export class AiAgentError extends Error {
    constructor(code, message, status = null) {
        super(message);
        this.name = 'AiAgentError';
        this.code = code;
        this.status = status;
    }
}

const protocolError = () =>
    new AiAgentError('invalid_response', 'Invalid response from the AI agent.');
const checkAborted = (signal) => {
    if (signal.aborted) throw new DOMException('Request canceled.', 'AbortError');
};
// The agent serves each backend under its own routes; the webapp talks to om3.
const CONVERSATIONS_PATH = '/v1/om3/conversations';
const conversationPath = (id) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        throw new AiAgentError('invalid_conversation', 'A valid conversation ID is required.');
    }
    return `${CONVERSATIONS_PATH}/${encodeURIComponent(id)}`;
};

const validHistoryCursor = (cursor) =>
    typeof cursor === 'string' &&
    /^[1-9]\d{0,18}:[1-9]\d{0,18}$/.test(cursor) &&
    cursor.split(':').every((part) => BigInt(part) <= 9223372036854775807n);
const olderCursor = (cursor, before) => {
    const [turn, message] = cursor.split(':').map(BigInt);
    const [beforeTurn, beforeMessage] = before.split(':').map(BigInt);
    return turn < beforeTurn || (turn === beforeTurn && message < beforeMessage);
};

// Bound history independently of SSE, including untrusted or still-open bodies.
const readMessagePage = async (response, signal, limit, before) => {
    if (
        response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
            'application/json' ||
        !response.body
    ) {
        await response.body?.cancel().catch(() => {});
        throw protocolError();
    }
    const reader = response.body.getReader();
    const cancel = () => void reader.cancel().catch(() => {});
    signal.addEventListener('abort', cancel, {once: true});
    try {
        const bytes = new Uint8Array(MAX_HISTORY_BYTES);
        let size = 0;
        while (true) {
            checkAborted(signal);
            const {done, value} = await reader.read();
            checkAborted(signal);
            if (done) break;
            if (size + value.byteLength > MAX_HISTORY_BYTES) throw protocolError();
            bytes.set(value, size);
            size += value.byteLength;
        }
        const page = JSON.parse(
            new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, size))
        );
        if (
            !page ||
            !Array.isArray(page.messages) ||
            page.messages.length > limit ||
            typeof page.next_cursor !== 'string' ||
            (page.next_cursor !== '' &&
                (!page.messages.length ||
                    !validHistoryCursor(page.next_cursor) ||
                    (before && !olderCursor(page.next_cursor, before))))
        )
            throw protocolError();
        const ids = new Set();
        const messages = page.messages.map((message) => {
            if (
                !message ||
                typeof message.turn_id !== 'string' ||
                !/^[A-Za-z0-9_.~-]{1,128}$/.test(message.turn_id) ||
                typeof message.id !== 'string' ||
                !message.id.startsWith(`${message.turn_id}:`) ||
                !/^[1-9]\d{0,18}$/.test(message.id.slice(message.turn_id.length + 1)) ||
                BigInt(message.id.slice(message.turn_id.length + 1)) > 9223372036854775807n ||
                ids.has(message.id) ||
                !['user', 'assistant'].includes(message.role) ||
                typeof message.text !== 'string' ||
                typeof message.created_at !== 'string' ||
                message.created_at.length > 64 ||
                !Number.isFinite(Date.parse(message.created_at))
            )
                throw protocolError();
            ids.add(message.id);
            return {
                id: message.id,
                turn_id: message.turn_id,
                role: message.role,
                text: message.text,
                created_at: message.created_at,
            };
        });
        return {messages, next_cursor: page.next_cursor};
    } catch {
        checkAborted(signal);
        throw protocolError();
    } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
};

const MAX_CONFIRMATION_ARGUMENTS_BYTES = 256 * 1024;
const confirmationIdPattern = /^[A-Za-z0-9_.~-]{1,128}$/;

// Validate a tool call waiting for the decision of the user: the card shows
// these fields only, never the model text describing the action.
export const parseConfirmation = (value) => {
    if (
        !value ||
        typeof value !== 'object' ||
        typeof value.id !== 'string' ||
        !confirmationIdPattern.test(value.id) ||
        typeof value.turn_id !== 'string' ||
        !confirmationIdPattern.test(value.turn_id) ||
        !value.tool ||
        typeof value.tool.name !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,128}$/.test(value.tool.name) ||
        typeof value.tool.title !== 'string' ||
        value.tool.title.length > 256 ||
        typeof value.tool.destructive !== 'boolean' ||
        !value.arguments ||
        typeof value.arguments !== 'object' ||
        Array.isArray(value.arguments) ||
        new TextEncoder().encode(JSON.stringify(value.arguments)).length > MAX_CONFIRMATION_ARGUMENTS_BYTES ||
        typeof value.expires_at !== 'string' ||
        value.expires_at.length > 64 ||
        !Number.isFinite(Date.parse(value.expires_at))
    )
        throw protocolError();
    return {
        id: value.id,
        turn_id: value.turn_id,
        tool: {name: value.tool.name, title: value.tool.title || value.tool.name, destructive: value.tool.destructive},
        arguments: value.arguments,
        expires_at: value.expires_at,
    };
};

// A turn ends with completed, or with confirmation_required when a tool call
// waits for the decision of the user.
const readTurn = async (response, signal, onEvent) => {
    // EventSource cannot POST or set Bearer headers; use fetch and a streaming reader.
    if (
        response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
            'text/event-stream' ||
        !response.body
    ) {
        // No reader exists yet: explicitly stop unexpected, possibly still-open bodies.
        await response.body?.cancel().catch(() => {});
        throw protocolError();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    let buffer = '',
        eventName = '',
        data = [],
        streamBytes = 0;
    const cancel = () => {
        void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, {once: true});
    const consumeLine = (line) => {
        if (line === '') {
            if (!data.length) {
                eventName = '';
                return null;
            }
            let event;
            try {
                event = JSON.parse(data.join('\n'));
            } catch {
                throw protocolError();
            }
            data = [];
            if (!event || !EVENT_TYPES.has(eventName) || event.type !== eventName)
                throw protocolError();
            eventName = '';
            if (event.type === 'error') {
                // Do not surface arbitrary upstream error messages (which may contain secrets):
                // only a known code selects a message of the webapp.
                if (Object.hasOwn(TURN_ERROR_MESSAGES, event.code)) {
                    throw new AiAgentError(event.code, TURN_ERROR_MESSAGES[event.code]);
                }
                throw new AiAgentError('turn_failed', 'The AI turn failed. It was not retried.');
            }
            if (event.type === 'confirmation_required') {
                event = {...event, confirmation: parseConfirmation(event.confirmation)};
            }
            checkAborted(signal);
            onEvent?.(event);
            checkAborted(signal);
            return ['completed', 'confirmation_required'].includes(event.type) ? event : null;
        }
        if (line.startsWith(':')) return null;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        let value = separator < 0 ? '' : line.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventName = value;
        if (field === 'data') data.push(value);
        return null;
    };
    try {
        while (true) {
            checkAborted(signal);
            let chunk;
            try {
                chunk = await reader.read();
            } catch {
                checkAborted(signal);
                throw new AiAgentError(
                    'stream_interrupted',
                    'The AI stream was interrupted. It was not retried.'
                );
            }
            const {value, done} = chunk;
            checkAborted(signal);
            streamBytes += value?.byteLength || 0;
            if (streamBytes > MAX_STREAM_BYTES)
                throw new AiAgentError('stream_limit', 'AI stream size limit exceeded.');
            try {
                buffer += decoder.decode(value, {stream: !done});
            } catch {
                throw protocolError();
            }
            // Preserve an end-of-chunk CR: the next chunk may start with its LF.
            let offset = 0;
            for (let index = 0; index < buffer.length; index++) {
                const char = buffer[index];
                if (char !== '\n' && char !== '\r') continue;
                if (char === '\r' && index === buffer.length - 1 && !done) break;
                const event = consumeLine(buffer.slice(offset, index));
                if (event) return event;
                if (char === '\r' && buffer[index + 1] === '\n') index++;
                offset = index + 1;
            }
            buffer = buffer.slice(offset);
            if (done)
                throw new AiAgentError(
                    'stream_interrupted',
                    'The AI stream ended without completion. It was not retried.'
                );
        }
    } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
};

// The agent requires one cluster ID: at most 256 bytes, without whitespace,
// control characters or commas. It selects the daemon that verifies the token.
const isClusterId = (value) =>
    typeof value === 'string' &&
    /^[^\s\x00-\x1f\x7f,]+$/.test(value) &&
    new TextEncoder().encode(value).length <= 256;

export const createAiAgentClient = ({baseUrl, getCredentials}) => {
    const origin = parseAiAgentUrl(baseUrl);
    if (!origin) throw new AiAgentError('disabled', 'The AI agent is not configured.');
    const requests = new Set();

    const request = async (path, options, consume, signal, httpMessages = HTTP_MESSAGES) => {
        const {accessToken, clusterId} = getCredentials() || {};
        if (
            typeof accessToken !== 'string' ||
            !/^[^\s\x00-\x1f\x7f]{1,16384}$/.test(accessToken) ||
            !isClusterId(clusterId)
        ) {
            throw new AiAgentError(
                'not_ready',
                'An authenticated session and the current cluster ID are required.'
            );
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) abort();
        requests.add(controller);
        try {
            checkAborted(controller.signal);
            let response;
            try {
                response = await fetch(`${origin}${path}`, {
                    ...options,
                    headers: {
                        ...options.headers,
                        Authorization: `Bearer ${accessToken}`,
                        'X-OpenSVC-Cluster-ID': clusterId,
                    },
                    credentials: 'omit',
                    redirect: 'error',
                    cache: 'no-store',
                    signal: controller.signal,
                });
            } catch (error) {
                checkAborted(controller.signal);
                if (error.name === 'AbortError') throw error;
                throw new AiAgentError(
                    'network_error',
                    'Cannot reach the AI agent. Check its URL, TLS and CORS configuration.'
                );
            }
            checkAborted(controller.signal);
            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                throw new AiAgentError(
                    'http_error',
                    httpMessages[response.status] || HTTP_MESSAGES[response.status] || 'AI agent request failed.',
                    response.status
                );
            }
            return await consume(response, controller.signal);
        } finally {
            requests.delete(controller);
            signal?.removeEventListener('abort', abort);
        }
    };

    const jsonRequest = (path, method, key, options = {}, body) =>
        request(
            path,
            {
                method,
                headers: {
                    Accept: 'application/json',
                    ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            },
            async (response, signal) => {
                let result;
                try {
                    result = await response.json();
                } catch {
                    checkAborted(signal);
                    throw protocolError();
                }
                checkAborted(signal);
                if (
                    !result ||
                    (key === 'conversations'
                        ? !Array.isArray(result[key])
                        : !result[key] || typeof result[key].id !== 'string')
                )
                    throw protocolError();
                return result[key];
            },
            options.signal
        );

    return {
        createConversation: (options) =>
            jsonRequest(CONVERSATIONS_PATH, 'POST', 'conversation', options),
        listConversations: (options) =>
            jsonRequest(CONVERSATIONS_PATH, 'GET', 'conversations', options),
        getConversation: (id, options) =>
            jsonRequest(conversationPath(id), 'GET', 'conversation', options),
        // The conversation with the tool call it waits on, if any.
        getConversationState: (id, {signal} = {}) =>
            request(
                conversationPath(id),
                {method: 'GET', headers: {Accept: 'application/json'}},
                async (response, requestSignal) => {
                    let result;
                    try {
                        result = await response.json();
                    } catch {
                        checkAborted(requestSignal);
                        throw protocolError();
                    }
                    checkAborted(requestSignal);
                    if (!result?.conversation || typeof result.conversation.id !== 'string') throw protocolError();
                    return {
                        conversation: result.conversation,
                        confirmation:
                            result.pending_confirmation === undefined
                                ? null
                                : parseConfirmation(result.pending_confirmation),
                    };
                },
                signal
            ),
        getMessages: (id, {limit = 50, before = '', signal} = {}) => {
            const path = conversationPath(id);
            if (
                !Number.isInteger(limit) ||
                limit < 1 ||
                limit > MAX_HISTORY_MESSAGES ||
                (before !== '' && !validHistoryCursor(before))
            ) {
                throw new AiAgentError('invalid_history_query', 'Invalid history pagination.');
            }
            const query = new URLSearchParams({limit: String(limit)});
            if (before) query.set('before', before);
            return request(
                `${path}/messages?${query}`,
                {method: 'GET', headers: {Accept: 'application/json'}},
                (response, requestSignal) =>
                    readMessagePage(response, requestSignal, limit, before),
                signal
            );
        },
        renameConversation: (id, title, options) => {
            const path = conversationPath(id);
            if (typeof title !== 'string') {
                throw new AiAgentError(
                    'invalid_title',
                    'A non-empty conversation title of at most 80 characters is required.'
                );
            }
            // Match the agent's normalization, counting Unicode code points rather than UTF-16 units.
            const normalizedTitle = title
                .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
                .trim()
                .replace(/\s+/gu, ' ');
            if (!normalizedTitle || Array.from(normalizedTitle).length > MAX_TITLE_CHARACTERS) {
                throw new AiAgentError(
                    'invalid_title',
                    'A non-empty conversation title of at most 80 characters is required.'
                );
            }
            return jsonRequest(path, 'PATCH', 'conversation', options, {title: normalizedTitle});
        },
        deleteConversation: (id, {signal} = {}) =>
            request(
                conversationPath(id),
                {method: 'DELETE', headers: {Accept: 'application/json'}},
                async (response, requestSignal) => {
                    checkAborted(requestSignal);
                    if (response.status !== 204) {
                        await response.body?.cancel().catch(() => {});
                        throw protocolError();
                    }
                },
                signal
            ),
        sendTurn: (id, prompt, {signal, onEvent} = {}) => {
            const path = conversationPath(id);
            if (
                typeof prompt !== 'string' ||
                !prompt.trim() ||
                new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES
            ) {
                throw new AiAgentError(
                    'invalid_prompt',
                    'A non-empty prompt of at most 32 KiB is required.'
                );
            }
            return request(
                `${path}/turns`,
                {
                    method: 'POST',
                    headers: {Accept: 'text/event-stream', 'Content-Type': 'application/json'},
                    body: JSON.stringify({prompt}),
                },
                (response, requestSignal) => readTurn(response, requestSignal, onEvent),
                signal
            );
        },
        // Answer the confirmation a turn waits on. The decision applies to the
        // stored call; the response streams the rest of the turn.
        confirmTurn: (id, turnId, confirmationId, decision, {signal, onEvent} = {}) => {
            const path = conversationPath(id);
            if (
                typeof turnId !== 'string' ||
                !confirmationIdPattern.test(turnId) ||
                typeof confirmationId !== 'string' ||
                !confirmationIdPattern.test(confirmationId) ||
                !DECISIONS.has(decision)
            ) {
                throw new AiAgentError('invalid_confirmation', 'A valid confirmation and decision are required.');
            }
            return request(
                `${path}/turns/${encodeURIComponent(turnId)}/confirmation`,
                {
                    method: 'POST',
                    headers: {Accept: 'text/event-stream', 'Content-Type': 'application/json'},
                    body: JSON.stringify({confirmation_id: confirmationId, decision}),
                },
                (response, requestSignal) => readTurn(response, requestSignal, onEvent),
                signal,
                CONFIRMATION_HTTP_MESSAGES
            );
        },
        cancelAll: () => {
            for (const controller of requests) controller.abort();
        },
    };
};
