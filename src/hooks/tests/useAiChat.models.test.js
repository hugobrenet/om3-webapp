import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import useAiChat, {MODEL_KEY} from '../useAiChat.js';
import {AiAgentError} from '../../services/ai-agent.js';

const existing = {id: 'existing', title: 'Previous diagnostic'};
const created = {id: 'new', title: 'New diagnostic'};
const haiku = {id: 'default', label: 'Claude Haiku', default: true, ready: true};
const luna = {id: 'luna', label: 'GPT Luna', default: false, ready: true};
const small = {id: 'small', label: 'Mistral Small 4', default: false, ready: true};
const saved = (modelId) => [
    {id: 'turn-1:1', turn_id: 'turn-1', role: 'user', text: 'Old prompt', created_at: '2026-10-05T12:00:00Z'},
    {id: 'turn-1:2', turn_id: 'turn-1', role: 'assistant', text: 'Old answer', created_at: '2026-10-05T12:00:01Z', ...(modelId ? {model_id: modelId} : {})},
];

describe('useAiChat models', () => {
    let client;
    beforeEach(() => {
        localStorage.clear();
        client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue(created),
            getConversation: vi.fn().mockResolvedValue(created),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn().mockResolvedValue({messages: saved('small'), next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(async () => ({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-live', tokens: null})),
            getCapabilities: vi.fn().mockResolvedValue({feedback: true, models: true}),
            listModels: vi.fn().mockResolvedValue([haiku, luna, small]),
        };
    });
    afterEach(() => localStorage.clear());
    const setup = async ({models = true} = {}) => {
        const hook = renderHook((options) => useAiChat(options), {initialProps: {client, ready: true, scope: 'user:cluster'}});
        await waitFor(() => expect(hook.result.current.pending).toBe(''));
        if (models) await waitFor(() => expect(hook.result.current.models).not.toBeNull());
        return hook;
    };
    const sentModel = (call = 0) => client.run.mock.calls[call][1].model;

    it('offers the models of the agent, the default chosen', async () => {
        const {result} = await setup();
        expect(result.current.models).toEqual([haiku, luna, small]);
        expect(result.current.model).toBe('default');
        await act(async () => {
            await result.current.send('hello');
        });
        expect(sentModel()).toBe('default');
    });
    it('offers no choice, and sends no model, when the agent does not say its runs choose', async () => {
        client.getCapabilities.mockResolvedValue({feedback: true, models: false});
        const {result} = await setup({models: false});
        await waitFor(() => expect(result.current.feedbackEnabled).toBe(true));
        expect(client.listModels).not.toHaveBeenCalled();
        expect(result.current.models).toBeNull();
        await act(async () => {
            await result.current.send('hello');
        });
        expect(client.run.mock.calls[0][1]).not.toHaveProperty('model');
    });
    it('offers no choice with one model', async () => {
        client.listModels.mockResolvedValue([haiku]);
        const {result} = await setup({models: false});
        await waitFor(() => expect(client.listModels).toHaveBeenCalled());
        expect(result.current.models).toBeNull();
        expect(result.current.model).toBeNull();
    });
    it('sends the model chosen, and keeps the choice for the next visit', async () => {
        const {result, unmount} = await setup();
        act(() => result.current.selectModel('luna'));
        expect(result.current.model).toBe('luna');
        await act(async () => {
            await result.current.send('hello');
        });
        expect(sentModel()).toBe('luna');
        expect(localStorage.getItem(MODEL_KEY)).toBe('luna');
        unmount();
        const next = await setup();
        expect(next.result.current.model).toBe('luna');
    });
    it('passes over a choice the list does not offer', async () => {
        localStorage.setItem(MODEL_KEY, 'gone');
        client.listModels.mockResolvedValue([haiku, {...luna, ready: false}]);
        const {result} = await setup();
        expect(result.current.model).toBe('default');
        act(() => result.current.selectModel('luna'));
        act(() => result.current.selectModel('gone'));
        expect(result.current.model).toBe('default');
        expect(localStorage.getItem(MODEL_KEY)).toBe('gone');
    });
    it('goes on with the model of the last turn of the conversation opened', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.model).toBe('small');
        // The browser keeps the choices of the user only.
        expect(localStorage.getItem(MODEL_KEY)).toBeNull();
        await act(async () => {
            await result.current.send('and then?');
        });
        expect(sentModel()).toBe('small');
    });
    it('keeps the choice when the conversation opened names no model', async () => {
        client.getMessages.mockResolvedValue({messages: saved(null), next_cursor: ''});
        const {result} = await setup();
        act(() => result.current.selectModel('luna'));
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.model).toBe('luna');
    });
    it('queues the prompt again, on the default model, when the agent no longer offers the model', async () => {
        const {result} = await setup();
        act(() => result.current.selectModel('luna'));
        client.run.mockRejectedValueOnce(new AiAgentError('model_unknown', 'This model is no longer available: the default model is selected. Send your message again.', 400));
        client.listModels.mockResolvedValue([haiku, luna, small]);
        await act(async () => {
            await result.current.send('hello', [{description: 'page', value: 'nodes'}]);
        });
        expect(result.current.error).toBe('This model is no longer available: the default model is selected. Send your message again.');
        expect(result.current.messages).toEqual([]);
        // With the page it was asked from, without its model.
        expect(result.current.queued).toEqual({conversationId: 'new', text: 'hello', context: [{description: 'page', value: 'nodes'}]});
        // The default, even should a replica still offer the model refused,
        // and the choice kept forgotten.
        await waitFor(() => expect(client.listModels).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.models).toEqual([haiku, luna, small]));
        expect(result.current.model).toBe('default');
        expect(localStorage.getItem(MODEL_KEY)).toBeNull();
    });
    it('keeps a message queued meanwhile, the prompt refused left failed in the thread', async () => {
        const {result} = await setup();
        act(() => result.current.selectModel('luna'));
        let refuse;
        client.run.mockImplementationOnce(() => new Promise((_ok, ko) => (refuse = () => ko(new AiAgentError('model_unknown', 'gone', 400)))));
        act(() => {
            void result.current.send('hello');
        });
        await waitFor(() => expect(client.run).toHaveBeenCalledTimes(1));
        act(() => {
            expect(result.current.queue('second')).toBe(true);
        });
        await act(async () => refuse());
        expect(result.current.queued).toMatchObject({text: 'second'});
        expect(result.current.messages.map((message) => message.text)).toContain('hello');
    });
    it('goes on the default when the model of the conversation is refused, the choice kept untouched', async () => {
        localStorage.setItem(MODEL_KEY, 'luna');
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.model).toBe('small');
        client.run.mockRejectedValueOnce(new AiAgentError('model_unknown', 'gone', 400));
        await act(async () => {
            await result.current.send('hello');
        });
        await waitFor(() => expect(client.listModels).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.models).not.toBeNull());
        expect(result.current.model).toBe('default');
        expect(localStorage.getItem(MODEL_KEY)).toBe('luna');
    });
    it('starts a new conversation, or one naming no model, from the choice kept', async () => {
        localStorage.setItem(MODEL_KEY, 'luna');
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.model).toBe('small');
        await act(async () => {
            await result.current.createConversation();
        });
        expect(result.current.model).toBe('luna');
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.model).toBe('small');
        client.getMessages.mockResolvedValue({messages: saved(null), next_cursor: ''});
        client.getConversationState.mockResolvedValue({conversation: {id: 'other', title: 'Other'}, confirmation: null});
        await act(async () => {
            await result.current.resumeConversation('other');
        });
        expect(result.current.model).toBe('luna');
    });
    it('leaves the model of a conversation with it', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.model).toBe('small');
        act(() => result.current.leaveConversation());
        expect(result.current.model).toBe('default');
    });
    it('leaves the choice of the user as it is when a message queued with another model is refused', async () => {
        let end;
        client.run.mockImplementationOnce(() => new Promise((ok) => (end = () => ok({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-a', tokens: null}))));
        const {result} = await setup();
        act(() => {
            void result.current.send('first');
        });
        await waitFor(() => expect(client.run).toHaveBeenCalledTimes(1));
        act(() => result.current.selectModel('small'));
        act(() => {
            expect(result.current.queue('second')).toBe(true);
        });
        act(() => result.current.selectModel('luna'));
        client.run.mockRejectedValueOnce(new AiAgentError('model_unknown', 'gone', 400));
        await act(async () => end());
        await waitFor(() => expect(client.run).toHaveBeenCalledTimes(2));
        expect(sentModel(1)).toBe('small');
        await waitFor(() => expect(result.current.queued).toMatchObject({text: 'second'}));
        expect(result.current.queued).not.toHaveProperty('model');
        await waitFor(() => expect(result.current.models).not.toBeNull());
        expect(result.current.model).toBe('luna');
        expect(localStorage.getItem(MODEL_KEY)).toBe('luna');
    });
    it('keeps the choice of the user when the conversation shown is read again whole', async () => {
        client.run.mockImplementationOnce(async (_id, _input, {onEvent}) => {
            onEvent({type: 'MESSAGES_SNAPSHOT', omittedTurns: 2, messages: [{id: 'turn-8:1', role: 'user', content: 'Later'}]});
            return {type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-live', tokens: null};
        });
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        expect(result.current.partial).toBe(true);
        act(() => result.current.selectModel('luna'));
        client.getConversationState.mockResolvedValue({conversation: created, confirmation: null});
        await act(async () => {
            await result.current.resumeConversation('new');
        });
        expect(result.current.partial).toBe(false);
        expect(result.current.model).toBe('luna');
    });
    it('sends a queued message on the model chosen when it was queued', async () => {
        let end;
        client.run.mockImplementationOnce(() => new Promise((ok) => (end = () => ok({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-a', tokens: null}))));
        const {result} = await setup();
        act(() => {
            void result.current.send('first');
        });
        await waitFor(() => expect(client.run).toHaveBeenCalledTimes(1));
        act(() => result.current.selectModel('small'));
        act(() => {
            expect(result.current.queue('second')).toBe(true);
        });
        act(() => result.current.selectModel('luna'));
        await act(async () => end());
        await waitFor(() => expect(client.run).toHaveBeenCalledTimes(2));
        expect(sentModel(0)).toBe('default');
        expect(sentModel(1)).toBe('small');
    });
    it('reads the list again, with the next action of the user, when it could not be read', async () => {
        client.listModels.mockRejectedValueOnce(new AiAgentError('http_error', 'Authentication or agent temporarily unavailable.', 503));
        const {result} = await setup({models: false});
        await waitFor(() => expect(client.listModels).toHaveBeenCalledTimes(1));
        expect(result.current.models).toBeNull();
        await act(async () => {
            await result.current.createConversation();
        });
        await waitFor(() => expect(result.current.models).toEqual([haiku, luna, small]));
        expect(client.listModels).toHaveBeenCalledTimes(2);
    });
    it('reads the list again for another scope, and drops the late list of the previous one', async () => {
        let resolve;
        client.listModels.mockImplementationOnce(() => new Promise((ok) => (resolve = ok)));
        const {result, rerender} = await setup({models: false});
        await waitFor(() => expect(client.listModels).toHaveBeenCalledTimes(1));
        client.listModels.mockResolvedValue([haiku, small]);
        rerender({client, ready: true, scope: 'other:cluster'});
        await waitFor(() => expect(result.current.models).toEqual([haiku, small]));
        await act(async () => resolve([haiku, luna]));
        expect(result.current.models).toEqual([haiku, small]);
    });
});
