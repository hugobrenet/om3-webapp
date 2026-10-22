import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ReadableStream} from 'node:stream/web';
import {createAiAgentClient} from '../ai-agent.js';
import {
    GOLDEN_THREAD,
    aguiFrame,
    goldenResponse,
    goldenStream,
    runFinished,
    runStarted,
    streamResponse,
} from './agui-fixtures.js';

const baseUrl = 'https://agent.example.com:8090';
const prompt = (text, promptId) => ({prompt: text, promptId});

describe('AI agent AG-UI runs', () => {
    let client, fetchMock;
    beforeEach(() => {
        client = createAiAgentClient({
            baseUrl,
            getCredentials: () => ({accessToken: 'token', clusterId: 'cluster-id'}),
            newId: () => 'run-1',
        });
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        client.cancelAll();
        vi.unstubAllGlobals();
    });
    const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body);
    const types = (onEvent) => onEvent.mock.calls.map(([event]) => event.type);

    describe('replaying the streams of the agent', () => {
        it('posts a RunAgentInput on the runs route and streams the answers and tools of a turn', async () => {
            fetchMock.mockResolvedValue(goldenResponse('text_and_tools'));
            const onEvent = vi.fn();
            const result = await client.run(GOLDEN_THREAD, prompt('How many nodes?', 'u-1'), {onEvent});
            expect(result).toEqual({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-1', tokens: 370});
            const [url, request] = fetchMock.mock.calls[0];
            expect(url).toBe(`${baseUrl}/v1/om3/conversations/conversation-id/runs`);
            expect(request).toMatchObject({
                method: 'POST',
                credentials: 'omit',
                redirect: 'error',
                headers: {
                    Accept: 'text/event-stream',
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer token',
                    'X-OpenSVC-Cluster-ID': 'cluster-id',
                },
            });
            expect(sent()).toMatchObject(goldenStream('text_and_tools').request);
            expect(types(onEvent)).toEqual([
                'RUN_STARTED',
                'TEXT_MESSAGE_START',
                'TEXT_MESSAGE_CONTENT',
                'TEXT_MESSAGE_CONTENT',
                'TOOL_CALL_START',
                'TOOL_CALL_RESULT',
                'TOOL_CALL_START',
                'TOOL_CALL_RESULT',
                'TEXT_MESSAGE_START',
                'TEXT_MESSAGE_CONTENT',
            ]);
            expect(onEvent.mock.calls[6][0]).toEqual({
                type: 'TOOL_CALL_START',
                toolCallId: 'call-1',
                toolCallName: 'list_nodes',
                parentMessageId: 'turn-1:2',
            });
            expect(onEvent.mock.calls[9][0]).toEqual({
                type: 'TEXT_MESSAGE_CONTENT',
                messageId: 'turn-1:4',
                delta: 'There are two nodes: **n1** and **n2**.',
            });
        });

        it('ends a run on the confirmation of a call, its arguments those the run streamed', async () => {
            fetchMock.mockResolvedValue(goldenResponse('confirmation'));
            const onEvent = vi.fn();
            const result = await client.run(GOLDEN_THREAD, prompt('Start web with /bin/true', 'u-c'), {onEvent});
            expect(result).toEqual({
                type: 'RUN_FINISHED',
                outcome: 'interrupt',
                turnId: 'turn-c',
                tokens: 340,
                confirmation: {
                    id: 'confirmation-1',
                    turn_id: 'turn-c',
                    tool: {name: 'update_object_config', title: 'Update object config', destructive: true},
                    arguments: {path: 'web', yaml: 'app#1:\n  start: /bin/true\n'},
                    argument_types: {yaml: 'application/yaml'},
                    editable: true,
                    input_schema: {
                        type: 'object',
                        properties: {
                            path: {type: 'string', description: 'The path of the object.'},
                            yaml: {type: 'string', contentMediaType: 'application/yaml', description: 'The configuration to apply.'},
                            wait: {type: 'boolean', description: 'Wait until every live node has it.'},
                        },
                        required: ['path', 'yaml'],
                        additionalProperties: false,
                    },
                    expires_at: '2026-10-09T17:45:00Z',
                },
            });
            expect(types(onEvent)).toEqual([
                'RUN_STARTED',
                'TEXT_MESSAGE_START',
                'TEXT_MESSAGE_CONTENT',
                'TOOL_CALL_START',
            ]);
        });

        it.each([
            ['resume_approved', true, false, 415],
            ['resume_rejected', false, true, null],
        ])('answers a confirmation with a resume (%s)', async (name, approved, rejected, tokens) => {
            fetchMock.mockResolvedValue(goldenResponse(name));
            const onEvent = vi.fn();
            const held = [
                {id: 'u-c', role: 'user'},
                {id: 'turn-c:2', role: 'assistant'},
            ];
            const result = await client.run(
                GOLDEN_THREAD,
                {held, resume: {interruptId: 'confirmation-1', approved}},
                {onEvent}
            );
            expect(result).toEqual({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-c', tokens});
            expect(sent()).toMatchObject(goldenStream(name).request);
            expect(onEvent.mock.calls[1][0]).toEqual({type: 'TOOL_CALL_RESULT', toolCallId: 'call-7', rejected});
        });

        it('approves a call with the arguments the user edited', async () => {
            fetchMock.mockResolvedValue(goldenResponse('resume_edited'));
            const onEvent = vi.fn();
            const editedArgs = {path: 'web', yaml: 'app#1:\n  start: /bin/false\n'};
            const result = await client.run(
                GOLDEN_THREAD,
                {
                    held: [
                        {id: 'u-c', role: 'user'},
                        {id: 'turn-c:2', role: 'assistant'},
                    ],
                    resume: {interruptId: 'confirmation-1', approved: true, editedArgs},
                },
                {onEvent}
            );
            expect(sent()).toMatchObject(goldenStream('resume_edited').request);
            expect(result).toMatchObject({outcome: 'success', turnId: 'turn-c'});
            expect(onEvent.mock.calls[1][0]).toEqual({type: 'TOOL_CALL_RESULT', toolCallId: 'call-7', rejected: false});
        });

        it('explains an edit the agent refuses, never with its message', async () => {
            fetchMock.mockResolvedValue(goldenResponse('invalid_edited_arguments'));
            const error = await client
                .run(GOLDEN_THREAD, {resume: {interruptId: 'confirmation-1', approved: true, editedArgs: {path: 'web'}}})
                .catch((error) => error);
            expect(error).toMatchObject({
                code: 'invalid_edited_arguments',
                status: 400,
                message: 'The agent refused the edited arguments. Check the form; the action still waits.',
            });
            expect(error.message).not.toContain('missing properties');
        });

        it('gives the thread of a client out of phase before the run', async () => {
            fetchMock.mockResolvedValue(goldenResponse('snapshot'));
            const onEvent = vi.fn();
            await client.run(GOLDEN_THREAD, prompt('Any service?', 'u-2'), {onEvent});
            expect(onEvent.mock.calls[1][0]).toEqual({
                type: 'MESSAGES_SNAPSHOT',
                omittedTurns: 0,
                messages: [
                    {id: 'u-1', role: 'user', content: 'How many nodes?'},
                    {id: 'turn-1:2', role: 'assistant', content: '', toolCalls: [{id: 'call-1', name: 'list_nodes'}]},
                    {id: 'call-1-result', role: 'tool', toolCallId: 'call-1', rejected: false},
                    {id: 'turn-1:4', role: 'assistant', content: 'Two nodes.', toolCalls: []},
                    {id: 'turn-2:1', role: 'user', content: 'Any service?'},
                ],
            });
        });

        it('explains the tool call limit with its own message, never the agent one', async () => {
            fetchMock.mockResolvedValue(goldenResponse('tool_call_limit'));
            const error = await client.run(GOLDEN_THREAD, prompt('Check everything', 'u-l')).catch((error) => error);
            expect(error).toMatchObject({code: 'tool_call_limit'});
            expect(error.message).toContain('Ask a narrower question');
            expect(error.message).not.toContain('tool calls than the agent runs');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('reports another run error generically', async () => {
            fetchMock.mockResolvedValue(goldenResponse('agent_failed'));
            const error = await client.run(GOLDEN_THREAD, prompt('Hello', 'u-f')).catch((error) => error);
            expect(error).toMatchObject({code: 'turn_failed', message: 'The AI turn failed. It was not retried.'});
        });

        it('explains a confirmation that no longer waits by its code', async () => {
            fetchMock.mockResolvedValue(goldenResponse('confirmation_not_pending'));
            await expect(
                client.run(GOLDEN_THREAD, {resume: {interruptId: 'confirmation-0', approved: true}})
            ).rejects.toMatchObject({status: 409, message: 'This action no longer waits for a decision.'});
        });

        it('reports a busy conversation as before', async () => {
            fetchMock.mockResolvedValue(goldenResponse('conversation_busy'));
            const error = await client.run(GOLDEN_THREAD, prompt('Hello', 'u-b')).catch((error) => error);
            expect(error).toMatchObject({code: 'http_error', status: 409, message: 'Conversation busy or conversation limit reached.'});
            expect(error.message).not.toContain('active turn');
        });
    });

    describe('refusals of a run', () => {
        it('explains an expired confirmation, never with the agent message', async () => {
            fetchMock.mockResolvedValue(
                Response.json({error: {code: 'confirmation_expired', message: 'secret upstream'}}, {status: 410})
            );
            const error = await client
                .run(GOLDEN_THREAD, {resume: {interruptId: 'confirmation-1', approved: false}})
                .catch((error) => error);
            expect(error).toMatchObject({status: 410, message: 'The confirmation request expired. The action was not run.'});
        });

        it('tells an agent without the runs route from a conversation not found', async () => {
            fetchMock
                .mockResolvedValueOnce(new Response('404 page not found\n', {status: 404, headers: {'Content-Type': 'text/plain'}}))
                .mockResolvedValueOnce(Response.json({error: {code: 'conversation_not_found', message: 'x'}}, {status: 404}));
            await expect(client.run(GOLDEN_THREAD, prompt('Hello', 'u-1'))).rejects.toMatchObject({
                code: 'agent_outdated',
                message: 'The AI agent is too old for this webapp: it does not serve AG-UI runs.',
            });
            await expect(client.run(GOLDEN_THREAD, prompt('Hello', 'u-1'))).rejects.toMatchObject({
                code: 'http_error',
                message: 'Conversation not found.',
            });
        });

        it.each(['thread_mismatch', 'invalid_run_id', 'invalid_decision', 'unsupported_protocol_version', 'toString'])(
            'reports the program error %s generically',
            async (code) => {
                fetchMock.mockResolvedValue(Response.json({error: {code, message: 'secret upstream'}}, {status: 400}));
                const error = await client.run(GOLDEN_THREAD, prompt('Hello', 'u-1')).catch((error) => error);
                expect(error).toMatchObject({code: 'http_error', status: 400, message: 'AI agent request failed.'});
            }
        );

        it('sends the held messages by their IDs only, then the prompt', async () => {
            fetchMock.mockResolvedValue(goldenResponse('text_and_tools'));
            await client.run(GOLDEN_THREAD, {
                prompt: 'How many nodes?',
                promptId: 'u-9',
                held: [
                    {id: 'u-1', role: 'user', text: 'not sent'},
                    {id: 'turn-1:4', role: 'assistant'},
                ],
            });
            expect(sent()).toEqual({
                threadId: GOLDEN_THREAD,
                runId: 'run-1',
                protocolVersion: '1.0',
                messages: [
                    {id: 'u-1', role: 'user'},
                    {id: 'turn-1:4', role: 'assistant'},
                    {id: 'u-9', role: 'user', content: 'How many nodes?'},
                ],
                tools: [],
                context: [],
                state: {},
                forwardedProps: {},
            });
        });

        it.each([
            [prompt('', 'u-1'), '32 KiB'],
            [prompt(' ', 'u-1'), '32 KiB'],
            [prompt('é'.repeat(16385), 'u-1'), '32 KiB'],
            [prompt('hello', 'has space'), 'invalid'],
            [prompt('hello', ''), 'invalid'],
            [{...prompt('hello', 'u-1'), held: [{id: 'u 0', role: 'user'}]}, 'invalid'],
            [{...prompt('hello', 'u-1'), held: [{id: 'u-0', role: 'tool'}]}, 'invalid'],
            [{resume: {interruptId: 'bad id', approved: true}}, 'valid confirmation'],
            [{resume: {interruptId: 'confirmation-1', approved: 'yes'}}, 'valid confirmation'],
            [{resume: {interruptId: 'confirmation-1', approved: false, editedArgs: {path: 'web'}}}, 'valid confirmation'],
            [{resume: {interruptId: 'confirmation-1', approved: true, editedArgs: ['web']}}, 'valid confirmation'],
            [{resume: {interruptId: 'confirmation-1', approved: true, editedArgs: 'web'}}, 'valid confirmation'],
        ])('refuses an invalid run before HTTP', (input, message) => {
            expect(() => client.run(GOLDEN_THREAD, input)).toThrow(message);
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe('the grammar of the stream', () => {
        const run = (chunks) => {
            fetchMock.mockResolvedValue(streamResponse(chunks));
            return client.run(GOLDEN_THREAD, prompt('hello', 'u-1'));
        };
        const text = [
            {type: 'TEXT_MESSAGE_START', messageId: 'turn-1:2', role: 'assistant'},
            {type: 'TEXT_MESSAGE_CONTENT', messageId: 'turn-1:2', delta: 'Hi'},
            {type: 'TEXT_MESSAGE_END', messageId: 'turn-1:2'},
        ];

        it.each([
            ['invalid JSON', ['data: {not json}\n\n']],
            ['RUN_FINISHED without RUN_STARTED', [aguiFrame(runFinished())]],
            ['the start of another run', [aguiFrame({...runStarted, runId: 'run-2'}), aguiFrame(runFinished())]],
            ['two terminal events', [aguiFrame(runStarted), aguiFrame(runFinished()), aguiFrame(runFinished())]],
            ['an event after the end', [aguiFrame(runStarted), aguiFrame(runFinished()), aguiFrame(text[0])]],
            ['content outside a message', [aguiFrame(runStarted), aguiFrame(text[1]), aguiFrame(runFinished())]],
            ['a message left open', [aguiFrame(runStarted), aguiFrame(text[0]), aguiFrame(runFinished())]],
            [
                'arguments of an unknown call',
                [aguiFrame(runStarted), aguiFrame({type: 'TOOL_CALL_ARGS', toolCallId: 'call-1', delta: '{}'}), aguiFrame(runFinished())],
            ],
            [
                'an interrupt on a call the run did not make',
                [
                    aguiFrame(runStarted),
                    aguiFrame(
                        runFinished({
                            result: undefined,
                            outcome: {type: 'interrupt', interrupts: [{...goldenInterrupt(), toolCallId: 'call-9'}]},
                        })
                    ),
                ],
            ],
            [
                'calls waiting on tools the webapp did not offer',
                [aguiFrame(runStarted), aguiFrame(runFinished({outcome: {type: 'success', pendingToolCallIds: ['ui-1']}}))],
            ],
            ['an invalid turn ID', [aguiFrame(runStarted), aguiFrame(runFinished({result: {turnId: '../turn'}}))]],
            ['an invalid usage', [aguiFrame(runStarted), aguiFrame(runFinished({usage: [{totalTokens: -1}]}))]],
        ])('rejects %s', async (_name, chunks) => {
            await expect(run(chunks)).rejects.toMatchObject({code: 'invalid_response'});
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('rejects a stream that ends before its terminal event, without retrying', async () => {
            await expect(run([aguiFrame(runStarted), ...text.map(aguiFrame)])).rejects.toMatchObject({
                code: 'stream_interrupted',
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('ignores the event names, IDs and retries a relay adds, as SSE has a consumer do', async () => {
            const onEvent = vi.fn();
            fetchMock.mockResolvedValue(
                streamResponse([
                    'retry: 1000\n\n',
                    `event: message\nid: 1\n${aguiFrame(runStarted)}`,
                    'event: ping\n\n',
                    `id: 2\n${aguiFrame(runFinished())}`,
                ])
            );
            await expect(client.run(GOLDEN_THREAD, prompt('hello', 'u-1'), {onEvent})).resolves.toMatchObject({
                turnId: 'turn-1',
            });
            expect(types(onEvent)).toEqual(['RUN_STARTED']);
        });

        it('reads the text parts of a content, and does not show a text of another role', async () => {
            const onEvent = vi.fn();
            fetchMock.mockResolvedValue(
                streamResponse([
                    aguiFrame(runStarted),
                    aguiFrame({
                        type: 'MESSAGES_SNAPSHOT',
                        messages: [
                            {id: 'u-1', role: 'user', content: [{type: 'text', text: 'Look'}, {type: 'image', url: 'x'}, {type: 'text', text: 'here'}]},
                        ],
                    }),
                    aguiFrame({type: 'TEXT_MESSAGE_START', messageId: 'dev-1', role: 'developer'}),
                    aguiFrame({type: 'TEXT_MESSAGE_CONTENT', messageId: 'dev-1', delta: 'hidden'}),
                    aguiFrame({type: 'TEXT_MESSAGE_END', messageId: 'dev-1'}),
                    aguiFrame({type: 'TOOL_CALL_RESULT', toolCallId: 'call-7', content: [{type: 'text', text: '{"rejected":true}'}]}),
                    aguiFrame(runFinished()),
                ])
            );
            await client.run(GOLDEN_THREAD, prompt('hello', 'u-1'), {onEvent});
            expect(onEvent.mock.calls.map(([event]) => event).slice(1)).toEqual([
                {type: 'MESSAGES_SNAPSHOT', omittedTurns: 0, messages: [{id: 'u-1', role: 'user', content: 'Look\nhere'}]},
                {type: 'TOOL_CALL_RESULT', toolCallId: 'call-7', rejected: true},
            ]);
        });

        it('ignores warnings and the events of AG-UI the agent does not send', async () => {
            const onEvent = vi.fn();
            fetchMock.mockResolvedValue(
                streamResponse([
                    aguiFrame(runStarted),
                    aguiFrame({type: 'CUSTOM', name: 'opensvc.warning', value: {message: 'newer client'}}),
                    aguiFrame({type: 'STEP_STARTED', stepName: 'x'}),
                    aguiFrame(runFinished()),
                ])
            );
            await client.run(GOLDEN_THREAD, prompt('hello', 'u-1'), {onEvent});
            expect(types(onEvent)).toEqual(['RUN_STARTED']);
        });

        it('handles split UTF-8, CRLF, comments and multiline data', async () => {
            const input =
                ': keepalive\r\n' +
                aguiFrame(runStarted).replaceAll('\n', '\r\n') +
                aguiFrame(text[0]).replaceAll('\n', '\r\n') +
                'data: {"type":"TEXT_MESSAGE_CONTENT",\r\ndata: "messageId":"turn-1:2","delta":"reçu 😀"}\r\n\r\n' +
                aguiFrame(text[2]) +
                aguiFrame(runFinished()).replaceAll('\n', '\r');
            const onEvent = vi.fn();
            fetchMock.mockResolvedValue(
                streamResponse(Array.from(new TextEncoder().encode(input), (byte) => new Uint8Array([byte])))
            );
            await client.run(GOLDEN_THREAD, prompt('hello', 'u-1'), {onEvent});
            expect(onEvent.mock.calls[2][0].delta).toBe('reçu 😀');
            expect(types(onEvent)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT']);
        });

        it('rejects oversized streams', async () => {
            await expect(run([new Uint8Array(16 * 1024 * 1024 + 1)])).rejects.toMatchObject({code: 'stream_limit'});
        });

        it('sanitizes a reader failure without retrying the run', async () => {
            fetchMock.mockResolvedValue(
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.error(new Error('secret reader failure'));
                        },
                    }),
                    {headers: {'Content-Type': 'text/event-stream'}}
                )
            );
            const error = await client.run(GOLDEN_THREAD, prompt('hello', 'u-1')).catch((error) => error);
            expect(error.code).toBe('stream_interrupted');
            expect(error.message).not.toContain('secret');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('stops delivering already buffered events after cancellation', async () => {
            fetchMock.mockResolvedValue(streamResponse([aguiFrame(runStarted) + text.map(aguiFrame).join('') + aguiFrame(runFinished())]));
            const onEvent = vi.fn(() => client.cancelAll());
            await expect(client.run(GOLDEN_THREAD, prompt('hello', 'u-1'), {onEvent})).rejects.toMatchObject({
                name: 'AbortError',
            });
            expect(onEvent).toHaveBeenCalledTimes(1);
        });

        it.each(['application/json', 'text/html', null])(
            'closes an open non-SSE body before rejecting (%s)',
            async (contentType) => {
                const cancel = vi.fn();
                const body = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('unexpected body'));
                    },
                    cancel,
                });
                fetchMock.mockResolvedValue(new Response(body, {headers: contentType ? {'Content-Type': contentType} : {}}));
                await expect(client.run(GOLDEN_THREAD, prompt('hello', 'u-1'))).rejects.toMatchObject({
                    code: 'invalid_response',
                });
                expect(cancel).toHaveBeenCalledTimes(1);
                expect(body.locked).toBe(false);
            }
        );

        it('preserves the protocol error if closing a non-SSE body fails', async () => {
            const body = new ReadableStream({
                cancel() {
                    throw new Error('secret cleanup failure');
                },
            });
            fetchMock.mockResolvedValue(new Response(body, {headers: {'Content-Type': 'text/html'}}));
            const error = await client.run(GOLDEN_THREAD, prompt('hello', 'u-1')).catch((error) => error);
            expect(error.code).toBe('invalid_response');
            expect(error.message).not.toContain('secret');
        });

        it('rejects a response without a body', async () => {
            fetchMock.mockResolvedValue(new Response(null, {headers: {'Content-Type': 'text/event-stream'}}));
            await expect(client.run(GOLDEN_THREAD, prompt('hello', 'u-1'))).rejects.toMatchObject({
                code: 'invalid_response',
            });
        });

        it.each(['signal', 'cancelAll'])('cancels an active stream through %s', async (mode) => {
            const cancel = vi.fn();
            const body = new ReadableStream({cancel});
            fetchMock.mockResolvedValue(new Response(body, {headers: {'Content-Type': 'text/event-stream'}}));
            const controller = new AbortController();
            const pending = client.run(GOLDEN_THREAD, prompt('hello', 'u-1'), {signal: controller.signal});
            const assertion = expect(pending).rejects.toMatchObject({name: 'AbortError'});
            await vi.waitFor(() => expect(body.locked).toBe(true));
            if (mode === 'signal') controller.abort();
            else client.cancelAll();
            await assertion;
            expect(cancel).toHaveBeenCalled();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});

// The interrupt of the golden confirmation, from its RUN_FINISHED.
function goldenInterrupt() {
    const finished = goldenStream('confirmation')
        .body.split('\n\n')
        .map((frame) => frame.replace(/^data: /, ''))
        .filter(Boolean)
        .map((data) => JSON.parse(data))
        .find((event) => event.type === 'RUN_FINISHED');
    return finished.outcome.interrupts[0];
}
