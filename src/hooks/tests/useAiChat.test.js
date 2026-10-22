import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import useAiChat from '../useAiChat.js';
import {AiAgentError} from '../../services/ai-agent.js';
import {replayRun} from '../../services/tests/agui-fixtures.js';

const existing = {id: 'existing', title: 'Previous diagnostic'};
const created = {id: 'new', title: 'Untitled conversation'};
const aborted = () => new DOMException('Canceled', 'AbortError');
// The events of a run as the client gives them.
const text = (delta, messageId = 'turn-9:2') => [
    {type: 'TEXT_MESSAGE_START', messageId},
    {type: 'TEXT_MESSAGE_CONTENT', messageId, delta},
];
const completed = (turnId = 'turn-9', tokens = null) => ({type: 'RUN_FINISHED', outcome: 'success', turnId, tokens});
const saved = [
    {
        id: 'turn-1:1',
        turn_id: 'turn-1',
        role: 'user',
        text: 'Old prompt',
        created_at: '2026-10-05T12:00:00Z',
    },
    {
        id: 'turn-1:2',
        turn_id: 'turn-1',
        role: 'assistant',
        text: 'Old answer',
        created_at: '2026-10-05T12:00:01Z',
    },
];

describe('useAiChat', () => {
    let client, ids;
    beforeEach(() => {
        ids = 0;
        client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue(created),
            getConversation: vi.fn().mockResolvedValue(existing),
            // The resumed conversation, without a pending confirmation unless a test sets one.
            getConversationState: vi.fn(async (id, options) => ({
                conversation: await client.getConversation(id, options),
                confirmation: null,
            })),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            renameConversation: vi.fn().mockResolvedValue({...created, title: 'Renamed'}),
            deleteConversation: vi.fn().mockResolvedValue(undefined),
            newId: vi.fn(() => `prompt-${++ids}`),
            run: vi.fn(async (_id, _input, {onEvent}) => {
                onEvent({type: 'RUN_STARTED'});
                for (const event of text('Hello')) onEvent(event);
                return completed();
            }),
        };
    });
    const setup = async (props = {}) => {
        const initialProps = {client, ready: true, scope: 'user:cluster:node1', ...props};
        const hook = renderHook((options) => useAiChat(options), {initialProps});
        if (initialProps.ready) await waitFor(() => expect(hook.result.current.pending).toBe(''));
        return {...hook, initialProps};
    };
    it('only lists metadata automatically', async () => {
        const {result} = await setup();
        expect(result.current.conversations).toEqual([existing]);
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.run).not.toHaveBeenCalled();
    });
    it('performs no HTTP while disabled or without a target/session', async () => {
        const {result} = await setup({ready: false});
        await act(async () => {
            await result.current.send('hello');
        });
        expect(client.listConversations).not.toHaveBeenCalled();
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.run).not.toHaveBeenCalled();
    });
    it('creates the first conversation only on explicit submission', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        expect(client.createConversation).toHaveBeenCalledTimes(1);
        expect(client.run).toHaveBeenCalledWith(
            'new',
            {prompt: 'hello', promptId: 'prompt-1', held: []},
            expect.objectContaining({signal: expect.any(AbortSignal)})
        );
        expect(result.current.messages).toMatchObject([
            {id: 'prompt-1', role: 'user', text: 'hello'},
            {role: 'assistant', text: 'Hello', status: 'completed', turn_id: 'turn-9', messageIds: ['turn-9:2']},
        ]);
        await act(async () => {
            await result.current.send('again');
        });
        expect(client.createConversation).toHaveBeenCalledTimes(1);
        expect(client.run).toHaveBeenCalledTimes(2);
        // The agent tells by the messages the webapp holds that it is in phase.
        expect(client.run.mock.calls[1][1]).toEqual({
            prompt: 'again',
            promptId: 'prompt-2',
            held: [
                {id: 'prompt-1', role: 'user'},
                {id: 'turn-9:2', role: 'assistant'},
            ],
        });
    });
    it('reads the agent title back after the first turn of an untitled conversation', async () => {
        const untitled = {id: 'untitled', title: ''};
        client.createConversation.mockResolvedValue(untitled);
        client.getConversation.mockResolvedValue({id: 'untitled', title: 'Cluster health'});
        const {result} = await setup();
        await act(async () => {
            await result.current.send('cluster health?');
        });
        expect(client.getConversation).toHaveBeenCalledWith('untitled', expect.anything());
        expect(result.current.conversation.title).toBe('Cluster health');
        expect(result.current.conversations[0]).toEqual({id: 'untitled', title: 'Cluster health'});
    });
    it('keeps a successful turn when reading the title back fails', async () => {
        client.createConversation.mockResolvedValue({id: 'untitled', title: ''});
        client.getConversation.mockRejectedValue(new Error('unavailable'));
        const {result} = await setup();
        await act(async () => {
            await result.current.send('cluster health?');
        });
        expect(result.current.error).toBeFalsy();
        expect(result.current.messages.at(-1)).toMatchObject({role: 'assistant', status: 'completed'});
    });
    it('loads saved messages before continuing the server conversation', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.resumed).toBe(true);
        expect(result.current.messages).toEqual([]);
        expect(client.getMessages).toHaveBeenCalledWith(
            'existing',
            expect.objectContaining({signal: expect.any(AbortSignal)})
        );
        expect(client.run).not.toHaveBeenCalled();
        await act(async () => {
            await result.current.send('continue');
        });
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.run.mock.calls[0][0]).toBe('existing');
    });
    it('does not erase the local transcript when selecting the current conversation', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        await act(async () => {
            await result.current.resumeConversation('new');
        });
        expect(result.current.messages).toHaveLength(2);
        expect(client.getConversation).not.toHaveBeenCalled();
    });
    it('restores saved text, then appends SSE without replacing history', async () => {
        client.getMessages.mockResolvedValue({messages: saved, next_cursor: ''});
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.messages).toMatchObject([
            {...saved[0], status: 'completed'},
            {...saved[1], status: 'completed'},
        ]);
        await act(async () => {
            await result.current.send('continue');
        });
        expect(result.current.messages.map((message) => message.text)).toEqual([
            'Old prompt',
            'Old answer',
            'continue',
            'Hello',
        ]);
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.run).toHaveBeenCalledTimes(1);
        expect(client.run.mock.calls[0][1].held).toEqual([
            {id: 'turn-1:1', role: 'user'},
            {id: 'turn-1:2', role: 'assistant'},
        ]);
    });
    it('prepends earlier messages, deduplicates stable IDs and keeps local SSE messages', async () => {
        client.getMessages
            .mockResolvedValueOnce({messages: [saved[1]], next_cursor: '1:2'})
            .mockResolvedValueOnce({messages: saved, next_cursor: ''});
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        await act(async () => {
            await result.current.send('continue');
        });
        await act(async () => {
            await result.current.loadOlderMessages();
        });
        expect(result.current.messages.map((message) => message.text)).toEqual([
            'Old prompt',
            'Old answer',
            'continue',
            'Hello',
        ]);
        expect(client.getMessages.mock.calls[1][1]).toMatchObject({before: '1:2'});
        expect(result.current.historyCursor).toBe('');
        await act(async () => {
            await result.current.loadOlderMessages();
        });
        expect(client.getMessages).toHaveBeenCalledTimes(2);
        expect(client.run).toHaveBeenCalledTimes(1);
    });
    it('blocks sending after failed resume until a manual retry succeeds', async () => {
        client.getMessages
            .mockRejectedValueOnce(new AiAgentError('http_error', 'Authentication required.', 401))
            .mockResolvedValueOnce({messages: saved, next_cursor: ''});
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.historyReady).toBe(false);
        await act(async () => {
            await result.current.send('must not send');
        });
        expect(client.run).not.toHaveBeenCalled();
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.getMessages).toHaveBeenCalledTimes(1);
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.historyReady).toBe(true);
        expect(result.current.messages).toHaveLength(2);
    });
    it('allows an explicit new conversation after a failed history load', async () => {
        client.getMessages.mockRejectedValue(
            new AiAgentError('http_error', 'Conversation expired.', 410)
        );
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        await act(async () => {
            await result.current.createConversation();
        });
        expect(result.current.historyReady).toBe(true);
        expect(result.current.historyCursor).toBe('');
        expect(result.current.messages).toEqual([]);
        expect(client.run).not.toHaveBeenCalled();
    });
    it('keeps transcript and cursor after an earlier-page error without retry', async () => {
        client.getMessages
            .mockResolvedValueOnce({messages: saved, next_cursor: '1:1'})
            .mockRejectedValueOnce(new AiAgentError('http_error', 'Conversation expired.', 410));
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        await act(async () => {
            await result.current.loadOlderMessages();
        });
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.historyCursor).toBe('1:1');
        expect(result.current.error).toBe('Conversation expired.');
        expect(client.getMessages).toHaveBeenCalledTimes(2);
    });
    it.each(['logout', 'scope', 'unmount'])(
        'cancels a history read on %s and ignores late messages',
        async (change) => {
            let options, resolve;
            client.getMessages.mockImplementation((_id, value) => {
                options = value;
                return new Promise((done) => {
                    resolve = done;
                });
            });
            const {result, rerender, unmount, initialProps} = await setup();
            let pending;
            await act(async () => {
                pending = result.current.resumeConversation('existing');
            });
            await act(async () => {
                if (change === 'logout') rerender({...initialProps, ready: false});
                if (change === 'scope') rerender({...initialProps, scope: 'other-user'});
                if (change === 'unmount') unmount();
            });
            expect(options.signal.aborted).toBe(true);
            await act(async () => {
                resolve({messages: saved, next_cursor: ''});
                await pending;
            });
            if (change !== 'unmount') expect(result.current.messages).toEqual([]);
            expect(client.run).not.toHaveBeenCalled();
        }
    );
    it('does not fetch history if metadata resolves after logout', async () => {
        let resolve;
        client.getConversation.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        const {result, rerender, initialProps} = await setup();
        let pending;
        await act(async () => {
            pending = result.current.resumeConversation('existing');
        });
        await act(async () => {
            rerender({...initialProps, ready: false});
        });
        await act(async () => {
            resolve(existing);
            await pending;
        });
        expect(client.getMessages).not.toHaveBeenCalled();
    });
    it('streams the answers of a turn into one message, its tools and its usage', async () => {
        client.run.mockImplementation(replayRun('text_and_tools'));
        const {result} = await setup();
        await act(async () => {
            await result.current.send('How many nodes?');
        });
        expect(result.current.messages[1]).toMatchObject({
            text: 'Let me check the nodes.\n\nThere are two nodes: **n1** and **n2**.',
            status: 'completed',
            turn_id: 'turn-1',
            usage: {total_tokens: 370},
            messageIds: ['turn-1:2', 'turn-1:4'],
            // search_tools is a tool of the agent itself: it is not shown.
            tools: [{id: 'call-1', name: 'list_nodes', status: 'completed'}],
        });
    });
    it('replaces the thread with the snapshot a webapp out of phase receives', async () => {
        client.getMessages.mockResolvedValue({messages: saved, next_cursor: '1:1'});
        client.run.mockImplementation(replayRun('snapshot'));
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        await act(async () => {
            await result.current.send('Any service?');
        });
        expect(result.current.messages).toMatchObject([
            {id: 'u-1', role: 'user', text: 'How many nodes?'},
            {
                role: 'assistant',
                text: 'Two nodes.',
                status: 'completed',
                turn_id: 'turn-1',
                messageIds: ['turn-1:2', 'turn-1:4'],
                tools: [{id: 'call-1', name: 'list_nodes', status: 'completed'}],
            },
            {id: 'turn-2:1', role: 'user', text: 'Any service?'},
            {role: 'assistant', text: 'No service.', status: 'completed', turn_id: 'turn-2'},
        ]);
        expect(result.current.messages).toHaveLength(4);
        // The snapshot holds the whole thread: there is no earlier page.
        expect(result.current.historyCursor).toBe('');
    });
    it('reads the conversation again when a snapshot left out its oldest turns', async () => {
        client.run.mockImplementation(async (_id, _input, {onEvent}) => {
            onEvent({type: 'RUN_STARTED'});
            onEvent({type: 'MESSAGES_SNAPSHOT', omittedTurns: 2, messages: [{id: 'turn-8:1', role: 'user', content: 'Later'}]});
            for (const event of text('Hello')) onEvent(event);
            return completed();
        });
        client.getConversation.mockResolvedValue(created);
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        expect(result.current.partial).toBe(true);
        expect(result.current.notice).toContain('select it again');
        await act(async () => {
            await result.current.resumeConversation('new');
        });
        expect(client.getMessages).toHaveBeenCalledWith('new', expect.anything());
        expect(result.current.partial).toBe(false);
    });
    it('stops a turn, preserves partial output and never retries', async () => {
        let signal;
        client.run.mockImplementation(
            (_id, _prompt, options) =>
                new Promise((_resolve, reject) => {
                    signal = options.signal;
                    for (const event of text('Partial')) options.onEvent(event);
                    options.onEvent({type: 'TOOL_CALL_START', toolCallId: 'call-1', toolCallName: 'health', parentMessageId: 'turn-9:2'});
                    signal.addEventListener('abort', () => reject(aborted()), {once: true});
                })
        );
        const {result} = await setup();
        let turn;
        await act(async () => {
            turn = result.current.send('hello');
        });
        await act(async () => {
            result.current.stop();
            await turn;
        });
        expect(signal.aborted).toBe(true);
        expect(result.current.messages[1]).toMatchObject({
            text: 'Partial',
            status: 'stopped',
            tools: [{status: 'interrupted'}],
        });
        expect(result.current.notice).toContain('not retried');
        expect(client.run).toHaveBeenCalledTimes(1);
    });
    it.each(['logout', 'scope', 'unmount'])(
        'aborts on %s and ignores late stream callbacks',
        async (change) => {
            let options;
            client.run.mockImplementation(
                (_id, _prompt, value) =>
                    new Promise((_resolve, reject) => {
                        options = value;
                        for (const event of text("Old user's response")) value.onEvent(event);
                        value.signal.addEventListener('abort', () => reject(aborted()), {
                            once: true,
                        });
                    })
            );
            const {result, rerender, unmount, initialProps} = await setup();
            let turn;
            await act(async () => {
                turn = result.current.send('hello');
            });
            await act(async () => {
                if (change === 'logout') rerender({...initialProps, ready: false});
                if (change === 'scope')
                    rerender({...initialProps, scope: 'other-user:other-cluster:node2'});
                if (change === 'unmount') unmount();
            });
            await act(async () => {
                options.onEvent({type: 'TEXT_MESSAGE_CONTENT', messageId: 'turn-9:2', delta: 'Late secret'});
                await turn;
            });
            expect(options.signal.aborted).toBe(true);
            if (change !== 'unmount') expect(result.current.messages).toEqual([]);
            expect(client.run).toHaveBeenCalledTimes(1);
        }
    );
    it('does not start a turn if conversation creation finishes after logout', async () => {
        let resolve;
        client.createConversation.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        const {result, rerender, initialProps} = await setup();
        let turn;
        act(() => {
            turn = result.current.send('hello');
        });
        await act(async () => {
            rerender({...initialProps, ready: false});
        });
        await act(async () => {
            resolve(created);
            await turn;
        });
        expect(client.run).not.toHaveBeenCalled();
        expect(result.current.conversation).toBeNull();
    });
    it('rejects duplicate submissions while a turn is active', async () => {
        client.run.mockImplementation(
            (_id, _prompt, {signal}) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(aborted()), {once: true});
                })
        );
        const {result} = await setup();
        let turn;
        await act(async () => {
            turn = result.current.send('hello');
        });
        await act(async () => {
            await result.current.send('duplicate');
        });
        expect(client.run).toHaveBeenCalledTimes(1);
        await act(async () => {
            result.current.stop();
            await turn;
        });
    });
    it('preserves a failed response without retrying or exposing arbitrary errors', async () => {
        client.run.mockImplementation(async (_id, _prompt, {onEvent}) => {
            for (const event of text('Partial')) onEvent(event);
            throw new Error('secret backend failure');
        });
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        expect(result.current.error).toBe('The AI request failed. It was not retried.');
        expect(result.current.messages[1]).toMatchObject({text: 'Partial', status: 'failed'});
        expect(client.run).toHaveBeenCalledTimes(1);
    });
    it('surfaces typed authentication errors without initiating a login or retry', async () => {
        client.listConversations.mockRejectedValue(
            new AiAgentError('http_error', 'Authentication required.', 401)
        );
        const {result} = await setup();
        expect(result.current.error).toBe('Authentication required.');
        expect(client.listConversations).toHaveBeenCalledTimes(1);
        expect(client.createConversation).not.toHaveBeenCalled();
    });
    it('keeps the submitted prompt visible when conversation creation fails', async () => {
        client.createConversation.mockRejectedValue(
            new AiAgentError('http_error', 'Authentication required.', 401)
        );
        const {result} = await setup();
        await act(async () => {
            await result.current.send('Diagnose my cluster');
        });
        expect(result.current.messages).toMatchObject([
            {role: 'user', text: 'Diagnose my cluster'},
            {role: 'assistant', status: 'failed'},
        ]);
        expect(result.current.error).toBe('Authentication required.');
        expect(client.createConversation).toHaveBeenCalledTimes(1);
        expect(client.run).not.toHaveBeenCalled();
    });
    it('renames and deletes the selected conversation', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.createConversation();
        });
        await act(async () => {
            await result.current.renameConversation('Renamed');
        });
        expect(result.current.conversation.title).toBe('Renamed');
        expect(result.current.conversations[0].title).toBe('Renamed');
        await act(async () => {
            await result.current.deleteConversation();
        });
        expect(result.current.conversation).toBeNull();
        expect(result.current.conversations).toEqual([existing]);
        expect(result.current.messages).toEqual([]);
    });
    it('refreshes metadata without erasing the current transcript', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        client.listConversations.mockResolvedValue([{...created, title: 'Hello diagnostic'}]);
        await act(async () => {
            await result.current.refreshConversations();
        });
        expect(result.current.conversation.title).toBe('Hello diagnostic');
        expect(result.current.messages).toHaveLength(2);
    });
    it('never starts turns automatically in StrictMode', async () => {
        const {result} = renderHook(() => useAiChat({client, ready: true, scope: 'scope'}), {
            wrapper: ({children}) => React.createElement(React.StrictMode, null, children),
        });
        await waitFor(() => expect(result.current.pending).toBe(''));
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.run).not.toHaveBeenCalled();
    });

    describe('action confirmation', () => {
        const confirmation = {
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
        };
        const suspendTurn = () => client.run.mockImplementationOnce(replayRun('confirmation'));
        it('waits for a decision when a run ends on a confirmation', async () => {
            suspendTurn();
            const {result} = await setup();
            await act(async () => {
                await result.current.send('Start web with /bin/true');
            });
            expect(result.current.confirmation).toEqual({...confirmation, conversationId: 'new', assistantId: 'local:1'});
            expect(result.current.messages.at(-1)).toMatchObject({
                status: 'awaiting_confirmation',
                text: 'I will apply this configuration.',
                turn_id: 'turn-c',
                usage: {total_tokens: 340},
                tools: [{id: 'call-7', name: 'update_object_config', status: 'pending'}],
            });
            await act(async () => {
                await result.current.send('another');
            });
            expect(client.run).toHaveBeenCalledTimes(1);
        });
        it.each([
            ['approve', 'resume_approved', true, 'Done: web starts with /bin/true.', 'completed', 755],
            ['reject', 'resume_rejected', false, 'I did not apply it.', 'rejected', 340],
        ])('answers %s with a resume and streams the rest of the turn', async (decision, name, approved, answer, status, tokens) => {
            suspendTurn();
            const {result} = await setup();
            await act(async () => {
                await result.current.send('Start web with /bin/true');
            });
            client.run.mockImplementationOnce(replayRun(name));
            await act(async () => {
                await result.current[decision]();
            });
            expect(client.run).toHaveBeenLastCalledWith(
                'new',
                {
                    held: [
                        {id: 'prompt-1', role: 'user'},
                        {id: 'turn-c:2', role: 'assistant'},
                    ],
                    resume: {interruptId: 'confirmation-1', approved},
                },
                expect.anything()
            );
            expect(result.current.confirmation).toBeNull();
            expect(result.current.messages).toHaveLength(2);
            expect(result.current.messages.at(-1)).toMatchObject({
                status: 'completed',
                text: `I will apply this configuration.\n\n${answer}`,
                turn_id: 'turn-c',
                usage: {total_tokens: tokens},
                tools: [{id: 'call-7', name: 'update_object_config', status}],
            });
        });
        it('approves with the arguments the user edited, shown on the call', async () => {
            suspendTurn();
            const {result} = await setup();
            await act(async () => {
                await result.current.send('Start web with /bin/true');
            });
            const editedArgs = {path: 'web', yaml: 'app#1:\n  start: /bin/false\n'};
            client.run.mockImplementationOnce(replayRun('resume_edited'));
            await act(async () => {
                await result.current.approve(editedArgs);
            });
            expect(client.run.mock.calls[1][1].resume).toEqual({interruptId: 'confirmation-1', approved: true, editedArgs});
            expect(result.current.messages.at(-1)).toMatchObject({
                status: 'completed',
                tools: [{id: 'call-7', status: 'completed', editedArgs}],
            });
        });
        it('keeps the confirmation waiting when the agent refuses the edit', async () => {
            suspendTurn();
            const {result} = await setup();
            await act(async () => {
                await result.current.send('Start web with /bin/true');
            });
            client.run.mockImplementationOnce(replayRun('invalid_edited_arguments'));
            await act(async () => {
                await result.current.approve({path: 'web'});
            });
            expect(result.current.confirmation).toMatchObject({id: 'confirmation-1', editable: true});
            expect(result.current.error).toContain('Check the form');
            expect(result.current.messages.at(-1)).toMatchObject({
                status: 'awaiting_confirmation',
                tools: [{id: 'call-7', status: 'pending'}],
            });
        });
        it('sends no edit for a call that takes none, nor with a rejection', async () => {
            client.getConversationState.mockResolvedValue({conversation: existing, confirmation: {...confirmation, editable: false, input_schema: undefined}});
            const {result} = await setup();
            await act(async () => {
                await result.current.resumeConversation('existing');
            });
            await act(async () => {
                await result.current.approve({path: 'db'});
            });
            expect(client.run).not.toHaveBeenCalled();
            expect(result.current.confirmation).toMatchObject({id: 'confirmation-1'});
        });
        it('shows the confirmation again after a reload, and the thread with it once answered', async () => {
            client.getConversationState.mockResolvedValue({conversation: existing, confirmation});
            client.getMessages.mockResolvedValue({
                messages: [
                    {id: 'u-1', turn_id: 'turn-1', role: 'user', text: 'How many nodes?', created_at: '2026-10-05T12:00:00Z'},
                    {id: 'turn-1:2', turn_id: 'turn-1', role: 'assistant', text: 'Two nodes.', created_at: '2026-10-05T12:00:01Z'},
                ],
                next_cursor: '',
            });
            client.run.mockImplementationOnce(replayRun('resume_snapshot'));
            const {result} = await setup();
            await act(async () => {
                await result.current.resumeConversation('existing');
            });
            expect(result.current.confirmation).toMatchObject({id: 'confirmation-1', conversationId: 'existing', assistantId: null});
            await act(async () => {
                await result.current.reject();
            });
            expect(client.run.mock.calls[0][1]).toEqual({
                held: [
                    {id: 'u-1', role: 'user'},
                    {id: 'turn-1:2', role: 'assistant'},
                ],
                resume: {interruptId: 'confirmation-1', approved: false},
            });
            expect(result.current.messages).toMatchObject([
                {id: 'u-1', text: 'How many nodes?'},
                {role: 'assistant', text: 'Two nodes.', turn_id: 'turn-1'},
                {id: 'u-c', text: 'Start web with /bin/true'},
                {
                    role: 'assistant',
                    status: 'completed',
                    turn_id: 'turn-c',
                    text: 'I will apply this configuration.\n\nI did not apply it.',
                    tools: [{id: 'call-7', name: 'update_object_config', status: 'rejected'}],
                },
            ]);
            expect(result.current.messages).toHaveLength(4);
        });
        it('reports an expired confirmation and frees the conversation', async () => {
            suspendTurn();
            const {result} = await setup();
            await act(async () => {
                await result.current.send('Start web with /bin/true');
            });
            client.run.mockRejectedValueOnce(
                new AiAgentError('http_error', 'The confirmation request expired. The action was not run.', 410)
            );
            await act(async () => {
                await result.current.approve();
            });
            expect(result.current.confirmation).toBeNull();
            expect(result.current.error).toBe('The confirmation request expired. The action was not run.');
            expect(result.current.messages.at(-1)).toMatchObject({
                status: 'failed',
                tools: [{id: 'call-7', status: 'interrupted'}],
            });
        });
    });
});
