import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import useAiChat from '../useAiChat.js';
import {AiAgentError} from '../../services/ai-agent.js';

const existing = {id: 'existing', title: 'Previous diagnostic'};
const created = {id: 'new', title: 'Untitled conversation'};
const aborted = () => new DOMException('Canceled', 'AbortError');
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
    let client;
    beforeEach(() => {
        client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue(created),
            getConversation: vi.fn().mockResolvedValue(existing),
            // The resumed conversation, without a pending confirmation unless a test sets one.
            getConversationState: vi.fn(async (id, options) => ({
                conversation: await client.getConversation(id, options),
                confirmation: null,
            })),
            confirmTurn: vi.fn(),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            renameConversation: vi.fn().mockResolvedValue({...created, title: 'Renamed'}),
            deleteConversation: vi.fn().mockResolvedValue(undefined),
            sendTurn: vi.fn(async (_id, _prompt, {onEvent}) => {
                onEvent({type: 'text_delta', text_delta: 'Hello'});
                onEvent({type: 'completed'});
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
        expect(client.sendTurn).not.toHaveBeenCalled();
    });
    it('performs no HTTP while disabled or without a target/session', async () => {
        const {result} = await setup({ready: false});
        await act(async () => {
            await result.current.send('hello');
        });
        expect(client.listConversations).not.toHaveBeenCalled();
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.sendTurn).not.toHaveBeenCalled();
    });
    it('creates the first conversation only on explicit submission', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        expect(client.createConversation).toHaveBeenCalledTimes(1);
        expect(client.sendTurn).toHaveBeenCalledWith(
            'new',
            'hello',
            expect.objectContaining({signal: expect.any(AbortSignal)})
        );
        expect(result.current.messages).toMatchObject([
            {role: 'user', text: 'hello'},
            {role: 'assistant', text: 'Hello', status: 'completed'},
        ]);
        await act(async () => {
            await result.current.send('again');
        });
        expect(client.createConversation).toHaveBeenCalledTimes(1);
        expect(client.sendTurn).toHaveBeenCalledTimes(2);
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
        expect(client.sendTurn).not.toHaveBeenCalled();
        await act(async () => {
            await result.current.send('continue');
        });
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(client.sendTurn.mock.calls[0][0]).toBe('existing');
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
        expect(client.sendTurn).toHaveBeenCalledTimes(1);
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
        expect(client.sendTurn).toHaveBeenCalledTimes(1);
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
        expect(client.sendTurn).not.toHaveBeenCalled();
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
        expect(client.sendTurn).not.toHaveBeenCalled();
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
            expect(client.sendTurn).not.toHaveBeenCalled();
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
    it('records tool activity, usage and streamed text', async () => {
        client.sendTurn.mockImplementation(async (_id, _prompt, {onEvent}) => {
            onEvent({type: 'text_delta', text_delta: 'Checking '});
            onEvent({type: 'tool_started', tool_name: 'health'});
            onEvent({type: 'tool_finished', tool_name: 'health', tool_error: false});
            onEvent({type: 'tool_started', tool_name: 'health'});
            onEvent({type: 'tool_finished', tool_name: 'health', tool_error: true});
            onEvent({type: 'text_delta', text_delta: 'done'});
            onEvent({type: 'usage', usage: {total_tokens: 12}});
            onEvent({type: 'completed'});
        });
        const {result} = await setup();
        await act(async () => {
            await result.current.send('diagnostic');
        });
        expect(result.current.messages[1]).toMatchObject({
            text: 'Checking done',
            status: 'completed',
            usage: {total_tokens: 12},
            tools: [
                {name: 'health', status: 'completed'},
                {name: 'health', status: 'failed'},
            ],
        });
        expect(new Set(result.current.messages[1].tools.map((tool) => tool.id)).size).toBe(2);
    });
    it('stops a turn, preserves partial output and never retries', async () => {
        let signal;
        client.sendTurn.mockImplementation(
            (_id, _prompt, options) =>
                new Promise((_resolve, reject) => {
                    signal = options.signal;
                    options.onEvent({type: 'text_delta', text_delta: 'Partial'});
                    options.onEvent({type: 'tool_started', tool_name: 'health'});
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
        expect(client.sendTurn).toHaveBeenCalledTimes(1);
    });
    it.each(['logout', 'scope', 'unmount'])(
        'aborts on %s and ignores late stream callbacks',
        async (change) => {
            let options;
            client.sendTurn.mockImplementation(
                (_id, _prompt, value) =>
                    new Promise((_resolve, reject) => {
                        options = value;
                        value.onEvent({type: 'text_delta', text_delta: "Old user's response"});
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
                options.onEvent({type: 'text_delta', text_delta: 'Late secret'});
                await turn;
            });
            expect(options.signal.aborted).toBe(true);
            if (change !== 'unmount') expect(result.current.messages).toEqual([]);
            expect(client.sendTurn).toHaveBeenCalledTimes(1);
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
        expect(client.sendTurn).not.toHaveBeenCalled();
        expect(result.current.conversation).toBeNull();
    });
    it('rejects duplicate submissions while a turn is active', async () => {
        client.sendTurn.mockImplementation(
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
        expect(client.sendTurn).toHaveBeenCalledTimes(1);
        await act(async () => {
            result.current.stop();
            await turn;
        });
    });
    it('preserves a failed response without retrying or exposing arbitrary errors', async () => {
        client.sendTurn.mockImplementation(async (_id, _prompt, {onEvent}) => {
            onEvent({type: 'text_delta', text_delta: 'Partial'});
            throw new Error('secret backend failure');
        });
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        expect(result.current.error).toBe('The AI request failed. It was not retried.');
        expect(result.current.messages[1]).toMatchObject({text: 'Partial', status: 'failed'});
        expect(client.sendTurn).toHaveBeenCalledTimes(1);
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
        expect(client.sendTurn).not.toHaveBeenCalled();
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
        expect(client.sendTurn).not.toHaveBeenCalled();
    });

    describe('action confirmation', () => {
        const confirmation = {
            id: 'confirmation-1',
            turn_id: 'turn-1',
            tool: {name: 'stop_object', title: 'Stop object', destructive: true},
            arguments: {path: 'prod/svc/web'},
            expires_at: '2026-10-09T17:45:00Z',
        };
        const suspendTurn = () =>
            client.sendTurn.mockImplementation(async (_id, _prompt, {onEvent}) => {
                const event = {type: 'confirmation_required', confirmation};
                onEvent({type: 'text_delta', text_delta: 'I will stop it.'});
                onEvent(event);
                return event;
            });
        it('waits for a decision when a turn requests a confirmation', async () => {
            suspendTurn();
            const {result} = await setup();
            await act(async () => {
                await result.current.send('stop web');
            });
            expect(result.current.confirmation).toMatchObject({...confirmation, conversationId: 'new'});
            expect(result.current.messages.at(-1)).toMatchObject({status: 'awaiting_confirmation', text: 'I will stop it.'});
            await act(async () => {
                await result.current.send('another');
            });
            expect(client.sendTurn).toHaveBeenCalledTimes(1);
        });
        it.each(['approve', 'reject'])('sends %s and streams the rest of the turn', async (decision) => {
            suspendTurn();
            client.confirmTurn.mockImplementation(async (_id, _turn, _confirmation, _decision, {onEvent}) => {
                onEvent({type: 'text_delta', text_delta: ' Done.'});
                onEvent({type: 'completed'});
                return {type: 'completed'};
            });
            const {result} = await setup();
            await act(async () => {
                await result.current.send('stop web');
            });
            await act(async () => {
                await result.current[decision]();
            });
            expect(client.confirmTurn).toHaveBeenCalledWith('new', 'turn-1', 'confirmation-1', decision, expect.anything());
            expect(result.current.confirmation).toBeNull();
            expect(result.current.messages.at(-1)).toMatchObject({status: 'completed', text: 'I will stop it. Done.'});
        });
        it('shows the confirmation again after a reload', async () => {
            client.getConversationState.mockResolvedValue({conversation: existing, confirmation});
            client.confirmTurn.mockImplementation(async (_id, _turn, _confirmation, _decision, {onEvent}) => {
                onEvent({type: 'completed'});
                return {type: 'completed'};
            });
            const {result} = await setup();
            await act(async () => {
                await result.current.resumeConversation('existing');
            });
            expect(result.current.confirmation).toMatchObject({id: 'confirmation-1', conversationId: 'existing'});
            await act(async () => {
                await result.current.reject();
            });
            expect(client.confirmTurn).toHaveBeenCalledWith('existing', 'turn-1', 'confirmation-1', 'reject', expect.anything());
            expect(result.current.messages.at(-1)).toMatchObject({role: 'assistant', status: 'completed'});
        });
        it('reports an expired confirmation and frees the conversation', async () => {
            suspendTurn();
            client.confirmTurn.mockRejectedValue(
                new AiAgentError('http_error', 'The confirmation request expired. The action was not run.', 410)
            );
            const {result} = await setup();
            await act(async () => {
                await result.current.send('stop web');
            });
            await act(async () => {
                await result.current.approve();
            });
            expect(result.current.confirmation).toBeNull();
            expect(result.current.error).toBe('The confirmation request expired. The action was not run.');
        });
    });
});
