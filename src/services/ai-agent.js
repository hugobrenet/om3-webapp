import {parseAiAgentUrl} from '../config/ai-agent.js';

const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_TITLE_CHARACTERS = 80;
const MAX_HISTORY_BYTES = 1024 * 1024;
const MAX_HISTORY_MESSAGES = 100;
// The version of AG-UI the webapp speaks, which the agent checks.
const AGUI_PROTOCOL_VERSION = '1.0';
// The tools of the agent itself, which the webapp shows apart: their results
// carry no structured content when they succeed, unlike the tools of the MCP.
export const AGENT_TOOLS = new Set(['search_tools', 'read_resource', 'load_skill']);
// The reasons of a negative feedback, in the order the agent keeps them.
export const FEEDBACK_REASONS = [
    'not_answered',
    'missing_information',
    'incorrect_or_outdated',
    'hard_to_understand',
    'action_not_done',
];
export const MAX_FEEDBACK_EXPECTED_CHARACTERS = 1000;
const FEEDBACK_HTTP_MESSAGES = {
    400: 'The feedback is invalid.',
    404: 'This answer can no longer be rated.',
    409: 'The agent keeps no more feedback for now.',
};
// The run error codes the webapp explains. The agent message is never shown:
// any other code gets the generic failure message.
const RUN_ERROR_MESSAGES = {
    request_timeout: 'The agent did not answer in time. It was not retried.',
    tool_name_conflict: 'A tool of the webapp is named as a tool of the agent. It was not retried.',
};
// The refusals of a run the webapp explains by their code: the answer to a
// confirmation that no longer waits, or that expired.
const RUN_HTTP_CODE_MESSAGES = {
    confirmation_not_pending: 'This action no longer waits for a decision.',
    confirmation_expired: 'The confirmation request expired. The action was not run.',
    invalid_edited_arguments: 'The agent refused the edited arguments. Check the form; the action still waits.',
};
// An agent from before AG-UI answers 404 for the runs, without the code of a
// conversation not found.
const AGENT_OUTDATED_MESSAGE = 'The AI agent is too old for this webapp: it does not serve AG-UI runs.';
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

// The refusals of a creation, by the code of the agent: the quota of the user
// says what to do, the limit of the instance that it is not the user's doing.
const CREATE_MESSAGES = (status, code) => {
    if (code === 'conversation_quota')
        return [code, 'Your conversation quota is reached: delete conversations, or wait for them to expire.'];
    if (code === 'conversation_limit')
        return [code, 'The assistant holds as many conversations as it can for now. Try again later.'];
    return undefined;
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
const TOOLS_PATH = '/v1/om3/tools';
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

// A stored message goes by <turn ID>:<sequence>.
const storedMessageId = (id, turnId) => {
    if (!id.startsWith(`${turnId}:`)) return false;
    const sequence = id.slice(turnId.length + 1);
    return /^[1-9]\d{0,18}$/.test(sequence) && BigInt(sequence) <= 9223372036854775807n;
};
// The ID the webapp gives a prompt, which the agent keeps: at most 128
// printable ASCII bytes without spaces.
const promptIdPattern = /^[\x21-\x7e]{1,128}$/;

// Bound history independently of SSE, including untrusted or still-open bodies.
// The steps the history gives with the last assistant message of a turn:
// the calls of its tools, its runs and its tokens, checked as strictly as
// the rest; a field out of its bounds is an error of the protocol.
const STEP_STATUSES = ['completed', 'failed', 'rejected', 'interrupted'];
const MAX_HISTORY_STEPS = 64;
const isStamp = (value) => value === undefined || (Number.isSafeInteger(value) && value > 0);
const parseHistorySteps = (message) => {
    const {steps, steps_omitted: omitted, runs, usage} = message;
    if (steps === undefined && omitted === undefined && runs === undefined && usage === undefined) return null;
    if (
        (steps !== undefined && (!Array.isArray(steps) || steps.length > MAX_HISTORY_STEPS)) ||
        (omitted !== undefined && (!Number.isSafeInteger(omitted) || omitted < 0)) ||
        (runs !== undefined && (!Array.isArray(runs) || runs.length > 32)) ||
        (usage !== undefined && (!isPlainObject(usage) || !Number.isSafeInteger(usage.total_tokens) || usage.total_tokens < 0))
    )
        throw protocolError();
    const ids = new Set();
    const parsedSteps = (steps || []).map((step) => {
        if (
            !isPlainObject(step) ||
            !isEventId(step.id) ||
            ids.has(step.id) ||
            !toolNamePattern.test(step.tool) ||
            !(step.arguments === null || isPlainObject(step.arguments)) ||
            (step.arguments_omitted !== undefined && typeof step.arguments_omitted !== 'boolean') ||
            !isStamp(step.started_at) ||
            !isStamp(step.ended_at) ||
            !STEP_STATUSES.includes(step.status) ||
            !isText(step.result_excerpt, RESULT_EXCERPT_CHARACTERS) ||
            typeof step.result_truncated !== 'boolean' ||
            !isText(step.refusal, MAX_REFUSAL_CHARACTERS) ||
            (step.edited_arguments !== undefined && !isPlainObject(step.edited_arguments))
        )
            throw protocolError();
        ids.add(step.id);
        return {
            id: step.id,
            tool: step.tool,
            arguments: step.arguments,
            startedAt: step.started_at ?? null,
            endedAt: step.ended_at ?? null,
            status: step.status,
            result_excerpt: step.result_excerpt,
            result_truncated: step.result_truncated,
            refusal: step.refusal,
            ...(step.arguments_omitted ? {argumentsOmitted: true} : {}),
            ...(step.edited_arguments ? {editedArgs: step.edited_arguments} : {}),
        };
    });
    const parsedRuns = (runs || []).map((run) => {
        if (!isPlainObject(run) || !isStamp(run.started_at) || run.started_at === undefined || !isStamp(run.ended_at)) throw protocolError();
        return {startedAt: run.started_at, endedAt: run.ended_at ?? null};
    });
    return {steps: parsedSteps, stepsOmitted: omitted || 0, runs: parsedRuns, usage: usage ? {total_tokens: usage.total_tokens} : null};
};

// The tools the assistant may call, as the agent lists them: at most
// MAX_TOOLS, a title and a summary of bounded length each.
const MAX_TOOLS = 512;
const MAX_TOOL_TITLE_CHARACTERS = 256;
const MAX_TOOL_SUMMARY_CHARACTERS = 600;
const parseTools = (result) => {
    if (!isPlainObject(result) || !Array.isArray(result.tools) || result.tools.length > MAX_TOOLS) throw protocolError();
    const names = new Set();
    return result.tools.map((tool) => {
        if (
            !isPlainObject(tool) ||
            !toolNamePattern.test(tool.name) ||
            names.has(tool.name) ||
            !isText(tool.title, MAX_TOOL_TITLE_CHARACTERS) ||
            !isText(tool.summary, MAX_TOOL_SUMMARY_CHARACTERS) ||
            typeof tool.read_only !== 'boolean' ||
            typeof tool.needs_confirmation !== 'boolean'
        )
            throw protocolError();
        names.add(tool.name);
        return {name: tool.name, title: tool.title || tool.name, summary: tool.summary, readOnly: tool.read_only, needsConfirmation: tool.needs_confirmation};
    });
};
const TOOLS_MESSAGES = (status, code) =>
    status === 502 && code === 'tools_unavailable'
        ? ['tools_unavailable', 'The agent could not read its tools.']
        : [undefined, status === 404 ? 'This agent does not list its tools.' : HTTP_MESSAGES[status]];

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
                // A prompt goes by the ID the webapp gave it, when the agent kept it.
                !(storedMessageId(message.id, message.turn_id) || (message.role === 'user' && promptIdPattern.test(message.id))) ||
                ids.has(message.id) ||
                !['user', 'assistant'].includes(message.role) ||
                typeof message.text !== 'string' ||
                typeof message.created_at !== 'string' ||
                message.created_at.length > 64 ||
                !Number.isFinite(Date.parse(message.created_at))
            )
                throw protocolError();
            // Only an assistant message carries the feedback of its turn.
            const feedback = message.feedback === undefined ? undefined : parseFeedback(message.feedback);
            if (feedback === null || (feedback && message.role !== 'assistant')) throw protocolError();
            // Only an assistant message carries the steps of its turn.
            const history = parseHistorySteps(message);
            if (history && message.role !== 'assistant') throw protocolError();
            ids.add(message.id);
            return {
                id: message.id,
                turn_id: message.turn_id,
                role: message.role,
                text: message.text,
                created_at: message.created_at,
                ...(feedback ? {feedback} : {}),
                ...(history ? {history} : {}),
            };
        });
        // The steps go with the last assistant message of their turn.
        messages.forEach((message, index) => {
            if (message.history && messages.slice(index + 1).some((later) => later.role === 'assistant' && later.turn_id === message.turn_id))
                throw protocolError();
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

const turnIdPattern = /^[A-Za-z0-9_.~-]{1,128}$/;

// Validate and normalize a feedback: a rating, the reasons of a negative one
// and what the user expected, as the agent accepts and returns them.
export const parseFeedback = (value) => {
    if (
        !value ||
        typeof value !== 'object' ||
        !['up', 'down'].includes(value.rating) ||
        (value.reasons !== undefined && !Array.isArray(value.reasons)) ||
        (value.expected !== undefined && typeof value.expected !== 'string')
    )
        return null;
    const reasons = value.reasons || [];
    if (
        (value.rating === 'up' && reasons.length) ||
        reasons.some((reason) => !FEEDBACK_REASONS.includes(reason)) ||
        new Set(reasons).size !== reasons.length
    )
        return null;
    const expected = (value.expected || '').trim();
    if (
        Array.from(expected).length > MAX_FEEDBACK_EXPECTED_CHARACTERS ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(expected)
    )
        return null;
    return {
        rating: value.rating,
        reasons: FEEDBACK_REASONS.filter((reason) => reasons.includes(reason)),
        expected,
    };
};

const MAX_CONFIRMATION_ARGUMENTS_BYTES = 256 * 1024;
// The input schema of a tool whose call the user may edit, as the agent
// bounds it.
const MAX_INPUT_SCHEMA_BYTES = 64 * 1024;
const MAX_ARGUMENT_TYPES = 32;
const confirmationIdPattern = /^[A-Za-z0-9_.~-]{1,128}$/;
const toolNamePattern = /^[A-Za-z0-9_.-]{1,128}$/;
// The IDs of the messages and tool calls of a run: printable ASCII, no spaces.
const eventIdPattern = /^[\x21-\x7e]{1,256}$/;
const isEventId = (value) => typeof value === 'string' && eventIdPattern.test(value);
const isLabel = (value) =>
    typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);

// The media types of text arguments, such as {"yaml": "application/yaml"},
// as the input schema of the tool declares them: the card shows an argument
// by its type, not by guessing.
const parseArgumentTypes = (value) => {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw protocolError();
    const entries = Object.entries(value);
    if (entries.length > MAX_ARGUMENT_TYPES || entries.some(([name, type]) => !isLabel(name) || !isLabel(type)))
        throw protocolError();
    return Object.fromEntries(entries);
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

// The input schema of a call the user may edit: an object schema, within
// its bound. Its labels come from the MCP, not from the model.
const parseInputSchema = (value) => {
    if (!isPlainObject(value) || value.type !== 'object' || jsonBytes(value) > MAX_INPUT_SCHEMA_BYTES) throw protocolError();
    return value;
};

// What a call would do, as the MCP tells it before the user confirms it.
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_PREVIEW_ERROR_CHARACTERS = 2048;
const PREVIEW_OPS = ['=', '+=', '-=', '|=', '^=', 'insert', 'unset'];
const previewKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const isText = (value, max) => typeof value === 'string' && value.length <= max;
const isOptionalText = (value, max) => value === undefined || isText(value, max);

// The preview of a confirmation, its fields checked and nothing else kept;
// null when it does not hold. Its texts come from the MCP, the values from
// the model and the daemon: untrusted, shown as text only.
export const parsePreview = (value) => {
    if (!isPlainObject(value) || jsonBytes(value) > MAX_PREVIEW_BYTES) return null;
    const {summary, changes = [], deleted = [], content, read_at: readAt, warnings = [], secrets_omitted: secrets = 0} = value;
    if (
        !isPlainObject(summary) ||
        !isText(summary.text, 2048) ||
        !isText(summary.key, 64) ||
        !previewKeyPattern.test(summary.key) ||
        (summary.params !== undefined && !isPlainObject(summary.params)) ||
        Object.values(summary.params || {}).some((param) => !isText(param, 1024)) ||
        !Array.isArray(changes) ||
        changes.length > 200 ||
        changes.some(
            (change) =>
                !isPlainObject(change) ||
                !isText(change.key, 512) ||
                !PREVIEW_OPS.includes(change.op) ||
                !isOptionalText(change.scope, 256) ||
                !isOptionalText(change.value, 8192) ||
                !isOptionalText(change.before, 8192) ||
                !isOptionalText(change.after, 16384) ||
                typeof change.after_computed_by_mcp !== 'boolean' ||
                !isOptionalText(change.note, 1024) ||
                (change.note_keys !== undefined &&
                    (!Array.isArray(change.note_keys) ||
                        change.note_keys.length > 10 ||
                        change.note_keys.some((key) => typeof key !== 'string' || !previewKeyPattern.test(key))))
        ) ||
        !Array.isArray(deleted) ||
        deleted.length > 100 ||
        deleted.some(
            (section) =>
                !isPlainObject(section) ||
                !isText(section.section, 256) ||
                !Array.isArray(section.keys) ||
                section.keys.length > 1000 ||
                section.keys.some((key) => !isText(key, 512)) ||
                (section.secrets_omitted !== undefined && (!Number.isSafeInteger(section.secrets_omitted) || section.secrets_omitted < 0))
        ) ||
        (content !== undefined &&
            (!isPlainObject(content) || !isText(content.media_type, 128) || typeof content.text !== 'string')) ||
        (readAt !== undefined && (!isText(readAt, 64) || !Number.isFinite(Date.parse(readAt)))) ||
        !Array.isArray(warnings) ||
        warnings.length > 20 ||
        warnings.some((warning) => !isText(warning, 1024)) ||
        !Number.isSafeInteger(secrets) ||
        secrets < 0
    )
        return null;
    return {
        summary: {text: summary.text, key: summary.key, params: {...(summary.params || {})}},
        changes: changes.map((change) => ({
            key: change.key,
            scope: change.scope || '',
            op: change.op,
            ...(change.value !== undefined ? {value: change.value} : {}),
            ...(change.before !== undefined ? {before: change.before} : {}),
            ...(change.after !== undefined ? {after: change.after} : {}),
            computed: change.after_computed_by_mcp,
            note: change.note || '',
            noteKeys: [...(change.note_keys || [])],
        })),
        deleted: deleted.map((section) => ({section: section.section, keys: [...section.keys], secretsOmitted: section.secrets_omitted || 0})),
        ...(content ? {content: {mediaType: content.media_type, text: content.text, truncated: content.truncated === true}} : {}),
        readAt: readAt || '',
        warnings: [...warnings],
        secretsOmitted: secrets,
    };
};

// The preview fields of a confirmation: what the call would do, why it could
// not be told, and the edited arguments it is of. A preview that does not
// hold leaves the confirmation standing, its arguments shown.
const previewFields = (preview, error, previewArguments) => {
    const fields = {};
    if (preview !== undefined && preview !== null) {
        const parsed = parsePreview(preview);
        if (parsed) fields.preview = parsed;
        else fields.preview_error = 'The preview of the agent is invalid.';
    }
    if (!fields.preview_error && typeof error === 'string' && error)
        fields.preview_error = error.slice(0, MAX_PREVIEW_ERROR_CHARACTERS);
    if (isPlainObject(previewArguments) && jsonBytes(previewArguments) <= MAX_CONFIRMATION_ARGUMENTS_BYTES)
        fields.preview_arguments = previewArguments;
    return fields;
};

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
        !toolNamePattern.test(value.tool.name) ||
        typeof value.tool.title !== 'string' ||
        value.tool.title.length > 256 ||
        typeof value.tool.destructive !== 'boolean' ||
        !value.arguments ||
        typeof value.arguments !== 'object' ||
        Array.isArray(value.arguments) ||
        new TextEncoder().encode(JSON.stringify(value.arguments)).length > MAX_CONFIRMATION_ARGUMENTS_BYTES ||
        typeof value.expires_at !== 'string' ||
        value.expires_at.length > 64 ||
        !Number.isFinite(Date.parse(value.expires_at)) ||
        (value.editable !== undefined && typeof value.editable !== 'boolean')
    )
        throw protocolError();
    // A call the user may edit carries the input schema of its tool.
    const editable = value.editable === true;
    return {
        id: value.id,
        turn_id: value.turn_id,
        tool: {name: value.tool.name, title: value.tool.title || value.tool.name, destructive: value.tool.destructive},
        arguments: value.arguments,
        argument_types: parseArgumentTypes(value.argument_types),
        editable,
        ...(editable ? {input_schema: parseInputSchema(value.input_schema)} : {}),
        expires_at: value.expires_at,
        ...previewFields(value.preview, value.preview_error, value.preview_arguments),
    };
};

// The tokens of a run, the sum of its TokenUsage entries; null when the run
// reports none.
const runTokens = (usage) => {
    if (usage === undefined) return null;
    if (!Array.isArray(usage)) throw protocolError();
    let total = 0;
    for (const entry of usage) {
        if (!entry || !Number.isSafeInteger(entry.totalTokens) || entry.totalTokens < 0) throw protocolError();
        total += entry.totalTokens;
    }
    return usage.length ? total : null;
};

// The text of a content: a string, or the text parts of a list of parts,
// joined by line breaks, the other parts skipped; empty when absent.
const contentText = (content) => {
    if (content === undefined || content === null) return '';
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) throw protocolError();
    return content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');
};

// The thread as the agent holds it: the texts, and the tool calls with the
// messages of their results, the only fields the webapp shows.
const parseSnapshot = (event) => {
    if (!Array.isArray(event.messages)) throw protocolError();
    const messages = [];
    for (const message of event.messages) {
        if (!message || typeof message !== 'object' || !isEventId(message.id)) throw protocolError();
        const content = contentText(message.content);
        if (message.role === 'user') {
            messages.push({id: message.id, role: 'user', content});
        } else if (message.role === 'assistant') {
            const calls = message.toolCalls ?? [];
            if (!Array.isArray(calls)) throw protocolError();
            const toolCalls = calls.map((call) => {
                if (!call || !isEventId(call.id) || !toolNamePattern.test(call.function?.name)) throw protocolError();
                return {id: call.id, name: call.function.name, arguments: stepArguments(call.function.arguments)};
            });
            messages.push({id: message.id, role: 'assistant', content, toolCalls});
        } else if (message.role === 'tool') {
            if (!isEventId(message.toolCallId)) throw protocolError();
            messages.push({id: message.id, role: 'tool', toolCallId: message.toolCallId, ...parseToolResult(content)});
        }
        // Messages of other roles hold nothing the webapp shows.
    }
    const omitted = event.metadata?.['opensvc.truncated']?.omittedTurns;
    return {type: 'MESSAGES_SNAPSHOT', messages, omittedTurns: Number.isSafeInteger(omitted) && omitted > 0 ? omitted : 0};
};

// The result of a call the user rejected, which the agent did not run.
const isRejected = (content) => {
    try {
        return JSON.parse(content)?.rejected === true;
    } catch {
        return false;
    }
};

// The part of the result of a step the webapp keeps: an excerpt of 4 KiB,
// bounded at reading, and the text of a refusal of the tool, shown whole.
export const RESULT_EXCERPT_CHARACTERS = 4096;
const MAX_REFUSAL_CHARACTERS = 16384;

// What the result of a tool call says: rejected by the user, refused by the
// tool, isError as the agent gives it with every result, whether it holds a
// structured content, whether the agent cut it (omitted, past 64 KiB) or the
// compaction of the history did (_history_compaction, in a snapshot: a large
// result that succeeded, an error never being compacted), an excerpt of its
// text and the text of a refusal.
const parseToolResult = (content) => {
    const text = contentText(content);
    let payload = null;
    try {
        payload = JSON.parse(text);
    } catch {
        // A result that is no JSON is an excerpt only.
    }
    const object = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const rejected = object?.rejected === true;
    const isError = typeof object?.isError === 'boolean' ? object.isError : undefined;
    const structured = object?.structuredContent !== undefined && object?.structuredContent !== null;
    const omitted = object?.omitted === true || (object?._history_compaction !== undefined && object?._history_compaction !== null);
    let refusal = '';
    if (!rejected && !omitted && (isError === true || (isError === undefined && object && !structured))) {
        refusal = (Array.isArray(object.content) ? contentText(object.content) : '').slice(0, MAX_REFUSAL_CHARACTERS);
    }
    return {rejected, isError, structured, omitted, refusal, excerpt: text.slice(0, RESULT_EXCERPT_CHARACTERS), truncated: text.length > RESULT_EXCERPT_CHARACTERS};
};

// The time of an event, in milliseconds of the clock of the agent; null when
// the event carries none.
const stampOf = (event) => (Number.isSafeInteger(event.timestamp) && event.timestamp > 0 ? event.timestamp : null);

// The arguments of a call as the steps show them: an object, or null for
// arguments that do not read.
const stepArguments = (text) => {
    if (!text) return {};
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

// The arguments of a tool call, the JSON text its TOOL_CALL_ARGS stream.
const parseArguments = (text) => {
    if (text === null) throw protocolError();
    try {
        return JSON.parse(text || '{}');
    } catch {
        throw protocolError();
    }
};

// How a run ends: a completed turn, or a tool call waiting for the decision
// of the user, its arguments those the run streamed for the call.
const finishRun = (event, run) => {
    if (event.threadId !== run.threadId || event.runId !== run.runId || run.text) throw protocolError();
    const tokens = runTokens(event.usage);
    const outcome = event.outcome;
    if (!outcome || outcome.type === 'success') {
        // The webapp offers no tool of its own: no call can wait on it.
        if (outcome?.pendingToolCallIds !== undefined && (!Array.isArray(outcome.pendingToolCallIds) || outcome.pendingToolCallIds.length))
            throw protocolError();
        const turnId = event.result?.turnId;
        if (turnId !== undefined && (typeof turnId !== 'string' || !turnIdPattern.test(turnId))) throw protocolError();
        return {type: 'RUN_FINISHED', outcome: 'success', turnId: turnId || '', tokens, startedAt: run.startedAt ?? null, endedAt: stampOf(event)};
    }
    if (outcome.type !== 'interrupt' || !Array.isArray(outcome.interrupts) || outcome.interrupts.length !== 1)
        throw protocolError();
    const interrupt = outcome.interrupts[0];
    // A preview asked again ends on the call the run resumed, which the stream
    // does not start again.
    const call = run.calls.get(interrupt?.toolCallId) ?? run.resumed;
    if (interrupt?.reason !== 'tool_call' || !call) throw protocolError();
    const metadata = interrupt.metadata || {};
    // The input schema of an editable call is the editedArgs of the response
    // the interrupt takes.
    const editable = metadata.editable === true;
    const confirmation = parseConfirmation({
        id: interrupt.id,
        turn_id: metadata.turnId,
        tool: metadata.tool,
        arguments: parseArguments(call.arguments),
        argument_types: metadata.argumentTypes,
        editable,
        input_schema: editable ? interrupt.responseSchema?.properties?.editedArgs : undefined,
        expires_at: interrupt.expiresAt,
        preview: metadata.preview,
        preview_error: metadata.previewError,
        preview_arguments: metadata.previewArguments,
    });
    if (confirmation.tool.name !== call.name) throw protocolError();
    return {type: 'RUN_FINISHED', outcome: 'interrupt', turnId: confirmation.turn_id, confirmation, tokens, startedAt: run.startedAt ?? null, endedAt: stampOf(event)};
};

// Validate one AG-UI event of a run, in the order of the protocol: RUN_STARTED
// of this run first, a text message opened before its content and closed
// after it, then one terminal event and nothing after it. It gives the event
// as the webapp reads it, or null for one it does not show.
const parseRunEvent = (event, run) => {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || run.finished) throw protocolError();
    if (!run.started) {
        if (event.type !== 'RUN_STARTED' || event.threadId !== run.threadId || event.runId !== run.runId)
            throw protocolError();
        run.started = true;
        run.startedAt = stampOf(event);
        return {type: 'RUN_STARTED', at: run.startedAt};
    }
    switch (event.type) {
        case 'MESSAGES_SNAPSHOT':
            return parseSnapshot(event);
        case 'TEXT_MESSAGE_START':
            if (run.text || !isEventId(event.messageId)) throw protocolError();
            run.text = event.messageId;
            // A text of another role than the assistant, which the agent does
            // not send, is not shown as its answer.
            run.shown = event.role === undefined || event.role === 'assistant';
            return run.shown ? {type: event.type, messageId: event.messageId} : null;
        case 'TEXT_MESSAGE_CONTENT':
            if (!run.text || event.messageId !== run.text || typeof event.delta !== 'string') throw protocolError();
            return run.shown ? {type: event.type, messageId: event.messageId, delta: event.delta} : null;
        case 'TEXT_MESSAGE_END':
            if (!run.text || event.messageId !== run.text) throw protocolError();
            run.text = '';
            return null;
        case 'TOOL_CALL_START':
            if (
                !isEventId(event.toolCallId) ||
                run.calls.has(event.toolCallId) ||
                !toolNamePattern.test(event.toolCallName) ||
                (event.parentMessageId !== undefined && !isEventId(event.parentMessageId))
            )
                throw protocolError();
            run.calls.set(event.toolCallId, {name: event.toolCallName, arguments: '', ended: false});
            return {
                type: event.type,
                toolCallId: event.toolCallId,
                toolCallName: event.toolCallName,
                parentMessageId: event.parentMessageId || '',
                at: stampOf(event),
            };
        case 'TOOL_CALL_ARGS': {
            const call = run.calls.get(event.toolCallId);
            if (!call || call.ended || typeof event.delta !== 'string') throw protocolError();
            // Arguments beyond the bound of a confirmation are not kept: such a
            // call cannot be confirmed.
            if (call.arguments !== null)
                call.arguments =
                    call.arguments.length + event.delta.length > MAX_CONFIRMATION_ARGUMENTS_BYTES
                        ? null
                        : call.arguments + event.delta;
            return null;
        }
        case 'TOOL_CALL_END': {
            const call = run.calls.get(event.toolCallId);
            if (!call || call.ended) throw protocolError();
            call.ended = true;
            return {type: event.type, toolCallId: event.toolCallId, arguments: call.arguments === null ? null : stepArguments(call.arguments)};
        }
        case 'TOOL_CALL_RESULT': {
            if (!isEventId(event.toolCallId)) throw protocolError();
            const result = parseToolResult(event.content);
            return {type: event.type, toolCallId: event.toolCallId, at: stampOf(event), ...result};
        }
        case 'RUN_FINISHED':
            run.finished = finishRun(event, run);
            return run.finished;
        case 'RUN_ERROR':
            // Do not surface arbitrary upstream error messages (which may contain
            // secrets): only a known code selects a message of the webapp.
            if (Object.hasOwn(RUN_ERROR_MESSAGES, event.code))
                throw new AiAgentError(event.code, RUN_ERROR_MESSAGES[event.code]);
            throw new AiAgentError('turn_failed', 'The AI turn failed. It was not retried.');
        default:
            // CUSTOM warnings for the developer, and the events of AG-UI the
            // agent does not send, show nothing.
            return null;
    }
};

// Read the AG-UI stream of a run, one JSON event per data line, to its end:
// the terminal event, RUN_FINISHED, is given once the stream is over.
const readRun = async (response, signal, onEvent, run) => {
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
        data = [],
        streamBytes = 0;
    const cancel = () => {
        void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, {once: true});
    const consumeLine = (line) => {
        if (line === '') {
            if (!data.length) return;
            let event;
            try {
                event = JSON.parse(data.join('\n'));
            } catch {
                throw protocolError();
            }
            data = [];
            const parsed = parseRunEvent(event, run);
            // The terminal event is the result of the run, once its stream is over.
            if (!parsed || parsed.type === 'RUN_FINISHED') return;
            checkAborted(signal);
            onEvent?.(parsed);
            checkAborted(signal);
            return;
        }
        if (line.startsWith(':')) return;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        // AG-UI reads the data lines only: event names, IDs and retries, which
        // a relay may add, are ignored, as SSE has a consumer do.
        if (field !== 'data') return;
        const value = separator < 0 ? '' : line.slice(separator + 1);
        data.push(value.startsWith(' ') ? value.slice(1) : value);
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
                consumeLine(buffer.slice(offset, index));
                if (char === '\r' && buffer[index + 1] === '\n') index++;
                offset = index + 1;
            }
            buffer = buffer.slice(offset);
            if (done) {
                if (run.finished) return run.finished;
                throw new AiAgentError(
                    'stream_interrupted',
                    'The AI stream ended without completion. It was not retried.'
                );
            }
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

// The code of a JSON error of the agent, {"error": {"code"}}, read within
// 4 KiB; empty for any other body.
const readErrorCode = async (response) => {
    if (
        response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
        !response.body
    ) {
        await response.body?.cancel().catch(() => {});
        return '';
    }
    const reader = response.body.getReader();
    try {
        const bytes = new Uint8Array(4096);
        let size = 0;
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (size + value.byteLength > bytes.length) return '';
            bytes.set(value, size);
            size += value.byteLength;
        }
        const code = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, size)))?.error?.code;
        return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : '';
    } catch {
        return '';
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
};

// The refusals of a run: the answers to a confirmation by their code, and the
// 404 of an agent that serves no runs, from the conversation not found.
const runRefusal = (status, code) => {
    if (code === 'invalid_edited_arguments') return [code, RUN_HTTP_CODE_MESSAGES[code]];
    if (Object.hasOwn(RUN_HTTP_CODE_MESSAGES, code)) return ['http_error', RUN_HTTP_CODE_MESSAGES[code]];
    if (status === 404 && code !== 'conversation_not_found') return ['agent_outdated', AGENT_OUTDATED_MESSAGE];
    return undefined;
};

// An ID of 128 random bits. crypto.randomUUID needs a secure context, which
// a webapp served over plain HTTP is not.
const randomId = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

export const createAiAgentClient = ({baseUrl, getCredentials, newId = randomId}) => {
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
                // A refusal explained by its code reads the code of the agent,
                // never its message.
                const [code, message] =
                    typeof httpMessages === 'function'
                        ? httpMessages(response.status, await readErrorCode(response)) || []
                        : (await response.body?.cancel().catch(() => {}), [undefined, httpMessages[response.status]]);
                checkAborted(controller.signal);
                throw new AiAgentError(
                    code || 'http_error',
                    message || HTTP_MESSAGES[response.status] || 'AI agent request failed.',
                    response.status
                );
            }
            return await consume(response, controller.signal);
        } finally {
            requests.delete(controller);
            signal?.removeEventListener('abort', abort);
        }
    };

    const jsonRequest = (path, method, key, options = {}, body, httpMessages) =>
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
            options.signal,
            httpMessages
        );

    return {
        createConversation: (options) =>
            jsonRequest(CONVERSATIONS_PATH, 'POST', 'conversation', options, undefined, CREATE_MESSAGES),
        listConversations: (options) =>
            jsonRequest(CONVERSATIONS_PATH, 'GET', 'conversations', options),
        // The tools the assistant may call for the user.
        listTools: ({signal} = {}) =>
            request(
                TOOLS_PATH,
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
                    return parseTools(result);
                },
                signal,
                TOOLS_MESSAGES
            ),
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
        // The ID the webapp gives a message of the user.
        newId,
        // Run the agent on a conversation, in AG-UI: a new prompt, or the
        // answer to the confirmation it waits on. held are the messages the
        // webapp holds, by their IDs, for the agent to tell whether it is in
        // phase: it keeps the history itself and reads no other message, so
        // their texts are not sent. A run resolves with its RUN_FINISHED.
        run: (id, {prompt, promptId, held = [], resume} = {}, {signal, onEvent} = {}) => {
            const path = conversationPath(id);
            if (
                !Array.isArray(held) ||
                held.some((message) => !isEventId(message?.id) || !['user', 'assistant'].includes(message.role))
            ) {
                throw new AiAgentError('invalid_run', 'The messages of the run are invalid.');
            }
            const messages = held.map(({id: messageId, role}) => ({id: messageId, role}));
            let answer;
            if (resume === undefined) {
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
                if (typeof promptId !== 'string' || !promptIdPattern.test(promptId)) {
                    throw new AiAgentError('invalid_run', 'The messages of the run are invalid.');
                }
                messages.push({id: promptId, role: 'user', content: prompt});
            } else if (resume?.preview === true) {
                // The preview of the call waiting, asked again for the arguments
                // the user edited: nothing runs, the call waits again.
                if (
                    typeof resume.interruptId !== 'string' ||
                    !confirmationIdPattern.test(resume.interruptId) ||
                    !isPlainObject(resume.editedArgs) ||
                    jsonBytes(resume.editedArgs) > MAX_CONFIRMATION_ARGUMENTS_BYTES ||
                    !toolNamePattern.test(resume.pending?.name) ||
                    !isPlainObject(resume.pending?.arguments)
                ) {
                    throw new AiAgentError('invalid_confirmation', 'A valid confirmation and edited arguments are required.');
                }
                answer = [{interruptId: resume.interruptId, status: 'resolved', payload: {action: 'preview', editedArgs: resume.editedArgs}}];
            } else {
                if (
                    typeof resume?.interruptId !== 'string' ||
                    !confirmationIdPattern.test(resume.interruptId) ||
                    typeof resume.approved !== 'boolean' ||
                    // Edited arguments, a full replacement of those of the call,
                    // go with an approval only.
                    (resume.editedArgs !== undefined &&
                        (!resume.approved ||
                            !isPlainObject(resume.editedArgs) ||
                            jsonBytes(resume.editedArgs) > MAX_CONFIRMATION_ARGUMENTS_BYTES))
                ) {
                    throw new AiAgentError('invalid_confirmation', 'A valid confirmation and decision are required.');
                }
                const payload = {approved: resume.approved};
                if (resume.editedArgs !== undefined) payload.editedArgs = resume.editedArgs;
                answer = [{interruptId: resume.interruptId, status: 'resolved', payload}];
            }
            const runId = newId();
            const input = {
                threadId: id,
                runId,
                protocolVersion: AGUI_PROTOCOL_VERSION,
                messages,
                tools: [],
                context: [],
                state: {},
                forwardedProps: {},
                ...(answer ? {resume: answer} : {}),
            };
            return request(
                `${path}/runs`,
                {
                    method: 'POST',
                    headers: {Accept: 'text/event-stream', 'Content-Type': 'application/json'},
                    body: JSON.stringify(input),
                },
                (response, requestSignal) =>
                    readRun(response, requestSignal, onEvent, {
                        threadId: id, runId, started: false, text: '', calls: new Map(), finished: null,
                        ...(resume?.preview === true
                            ? {resumed: {name: resume.pending.name, arguments: JSON.stringify(resume.pending.arguments), ended: true}}
                            : {}),
                    }),
                signal,
                runRefusal
            );
        },
        // Give or replace the feedback of the user on a completed turn.
        setFeedback: (id, turnId, feedback, {signal} = {}) => {
            const path = conversationPath(id);
            const normalized = parseFeedback(feedback);
            if (typeof turnId !== 'string' || !turnIdPattern.test(turnId) || !normalized) {
                throw new AiAgentError('invalid_feedback', 'A valid answer and feedback are required.');
            }
            return request(
                `${path}/turns/${encodeURIComponent(turnId)}/feedback`,
                {
                    method: 'PUT',
                    headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
                    body: JSON.stringify(normalized),
                },
                async (response, requestSignal) => {
                    let result;
                    try {
                        result = await response.json();
                    } catch {
                        checkAborted(requestSignal);
                        throw protocolError();
                    }
                    checkAborted(requestSignal);
                    const stored = parseFeedback(result?.feedback);
                    if (!stored) throw protocolError();
                    return stored;
                },
                signal,
                FEEDBACK_HTTP_MESSAGES
            );
        },
        // Withdraw the feedback of the user on a turn.
        deleteFeedback: (id, turnId, {signal} = {}) => {
            const path = conversationPath(id);
            if (typeof turnId !== 'string' || !turnIdPattern.test(turnId)) {
                throw new AiAgentError('invalid_feedback', 'A valid answer and feedback are required.');
            }
            return request(
                `${path}/turns/${encodeURIComponent(turnId)}/feedback`,
                {method: 'DELETE', headers: {Accept: 'application/json'}},
                async (response, requestSignal) => {
                    checkAborted(requestSignal);
                    if (response.status !== 204) {
                        await response.body?.cancel().catch(() => {});
                        throw protocolError();
                    }
                },
                signal,
                FEEDBACK_HTTP_MESSAGES
            );
        },
        cancelAll: () => {
            for (const controller of requests) controller.abort();
        },
    };
};
