import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import useAiChat from '../useAiChat.js';
import {AiAgentError} from '../../services/ai-agent.js';

const existing = {id: 'existing', title: 'Previous diagnostic'};
const created = {id: 'new', title: 'New diagnostic'};
const down = {rating: 'down', reasons: ['missing_information'], expected: 'per OS'};
const saved = [
    {id: 'turn-1:1', turn_id: 'turn-1', role: 'user', text: 'Old prompt', created_at: '2026-10-05T12:00:00Z'},
    {id: 'turn-1:4', turn_id: 'turn-1', role: 'assistant', text: 'Old answer', created_at: '2026-10-05T12:00:01Z', feedback: down},
];

describe('useAiChat feedback', () => {
    let client;
    beforeEach(() => {
        client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue(created),
            getConversation: vi.fn().mockResolvedValue(created),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn().mockResolvedValue({messages: saved, next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(async (_id, _input, {onEvent}) => {
                onEvent({type: 'TEXT_MESSAGE_START', messageId: 'turn-live:2'});
                onEvent({type: 'TEXT_MESSAGE_CONTENT', messageId: 'turn-live:2', delta: 'Hello'});
                return {type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-live', tokens: null};
            }),
            setFeedback: vi.fn(async (_id, _turnId, feedback) => ({reasons: [], expected: '', ...feedback})),
            deleteFeedback: vi.fn().mockResolvedValue(undefined),
            getCapabilities: vi.fn().mockResolvedValue({feedback: true}),
        };
    });
    const setup = async ({feedback = true} = {}) => {
        const hook = renderHook((options) => useAiChat(options), {initialProps: {client, ready: true, scope: 'user:cluster'}});
        await waitFor(() => expect(hook.result.current.pending).toBe(''));
        if (feedback) await waitFor(() => expect(hook.result.current.feedbackEnabled).toBe(true));
        return hook;
    };

    it('takes the feedback only once the agent says it does', async () => {
        let resolve;
        client.getCapabilities.mockImplementationOnce(() => new Promise((ok) => (resolve = ok)));
        const {result} = await setup({feedback: false});
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.feedbackEnabled).toBe(false);
        await act(async () => {
            expect(await result.current.rate('turn-1', {rating: 'up'})).toBe(false);
        });
        expect(client.setFeedback).not.toHaveBeenCalled();
        // The read under way is not started again by the action of the user.
        expect(client.getCapabilities).toHaveBeenCalledTimes(1);
        await act(async () => resolve({feedback: true}));
        expect(result.current.feedbackEnabled).toBe(true);
    });
    it('reads again, with the next action of the user, the capabilities it could not read', async () => {
        client.getCapabilities.mockRejectedValueOnce(new AiAgentError('http_error', 'Authentication or agent temporarily unavailable.', 503));
        const {result} = await setup({feedback: false});
        await waitFor(() => expect(client.getCapabilities).toHaveBeenCalledTimes(1));
        expect(result.current.feedbackEnabled).toBe(false);
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        await waitFor(() => expect(result.current.feedbackEnabled).toBe(true));
        expect(client.getCapabilities).toHaveBeenCalledTimes(2);
        // Known, they are not read again.
        await act(async () => {
            await result.current.createConversation();
        });
        expect(client.getCapabilities).toHaveBeenCalledTimes(2);
    });
    it('reads again with send, and starts no second read while one is under way', async () => {
        client.getCapabilities.mockRejectedValueOnce(new AiAgentError('http_error', 'Authentication or agent temporarily unavailable.', 503));
        let resolve;
        client.getCapabilities.mockImplementationOnce(() => new Promise((ok) => (resolve = ok)));
        const {result} = await setup({feedback: false});
        await waitFor(() => expect(client.getCapabilities).toHaveBeenCalledTimes(1));
        await act(async () => {
            await result.current.send('hello');
        });
        await waitFor(() => expect(client.getCapabilities).toHaveBeenCalledTimes(2));
        // Another action while the second read is under way does not start a third.
        await act(async () => {
            await result.current.send('again');
        });
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(client.getCapabilities).toHaveBeenCalledTimes(2);
        await act(async () => resolve({feedback: true}));
        expect(result.current.feedbackEnabled).toBe(true);
    });
    it('offers no feedback once the chat is no longer ready', async () => {
        const {result, rerender} = await setup();
        rerender({client, ready: false, scope: 'user:cluster'});
        expect(result.current.feedbackEnabled).toBe(false);
    });
    it('takes the feedback off when the agent refuses it as turned off', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        client.setFeedback.mockRejectedValueOnce(new AiAgentError('feedback_disabled', 'Feedback is turned off on this agent.', 403));
        await act(async () => {
            expect(await result.current.rate('turn-1', {rating: 'up'})).toBe(false);
        });
        expect(result.current.ratings['turn-1'].error).toBe('Feedback is turned off on this agent.');
        expect(result.current.feedbackEnabled).toBe(false);
    });
    it('drops the late capabilities of a previous scope', async () => {
        let resolve, signal;
        client.getCapabilities.mockImplementationOnce((options) => {
            signal = options.signal;
            return new Promise((ok) => (resolve = ok));
        });
        const {result, rerender} = await setup({feedback: false});
        client.getCapabilities.mockResolvedValue({feedback: false});
        rerender({client, ready: true, scope: 'other:cluster'});
        await waitFor(() => expect(client.getCapabilities).toHaveBeenCalledTimes(2));
        expect(signal.aborted).toBe(true);
        await waitFor(() => expect(result.current.feedbackEnabled).toBe(false));
        await act(async () => resolve({feedback: true}));
        expect(result.current.feedbackEnabled).toBe(false);
        // The late answer does not replace those of the new scope, which are
        // not read again.
        await act(async () => new Promise((done) => setTimeout(done, 20)));
        expect(client.getCapabilities).toHaveBeenCalledTimes(2);
    });
    it('reads the capabilities of another client of the same scope', async () => {
        const {result, rerender} = await setup();
        let resolve;
        const other = {...client, getCapabilities: vi.fn(() => new Promise((ok) => (resolve = ok)))};
        rerender({client: other, ready: true, scope: 'user:cluster'});
        expect(result.current.feedbackEnabled).toBe(false);
        await waitFor(() => expect(other.getCapabilities).toHaveBeenCalled());
        await act(async () => resolve({feedback: true}));
        expect(result.current.feedbackEnabled).toBe(true);
    });
    it.each([
        ['turned off', () => client.getCapabilities.mockResolvedValue({feedback: false})],
        ['unreadable', () => client.getCapabilities.mockRejectedValue(new AiAgentError('network_error', 'Cannot reach the AI agent.'))],
    ])('neither offers nor sends the feedback when the capabilities are %s', async (_name, mock) => {
        mock();
        const {result} = await setup({feedback: false});
        await waitFor(() => expect(client.getCapabilities).toHaveBeenCalled());
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.feedbackEnabled).toBe(false);
        await act(async () => {
            expect(await result.current.rate('turn-1', {rating: 'up'})).toBe(false);
            expect(await result.current.unrate('turn-1')).toBe(false);
        });
        expect(client.setFeedback).not.toHaveBeenCalled();
        expect(client.deleteFeedback).not.toHaveBeenCalled();
    });
    it('reads the capabilities again for another scope', async () => {
        const {result, rerender} = await setup();
        client.getCapabilities.mockResolvedValue({feedback: false});
        rerender({client, ready: true, scope: 'other:cluster'});
        expect(result.current.feedbackEnabled).toBe(false);
        await waitFor(() => expect(client.getCapabilities).toHaveBeenCalledTimes(2));
        expect(result.current.feedbackEnabled).toBe(false);
    });

    it('restores the saved feedback per turn and keeps it off the messages', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        expect(result.current.ratings['turn-1']).toEqual({feedback: down, pending: false, error: ''});
        expect(result.current.messages[1]).not.toHaveProperty('feedback');
        expect(result.current.messages[1].turn_id).toBe('turn-1');
    });
    it('rates a streamed answer with the turn of its completion, beside the turns', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.send('hello');
        });
        const answer = result.current.messages[1];
        expect(answer).toMatchObject({role: 'assistant', status: 'completed', turn_id: 'turn-live'});
        await act(async () => {
            expect(await result.current.rate('turn-live', {rating: 'up'})).toBe(true);
        });
        expect(client.setFeedback).toHaveBeenCalledWith('new', 'turn-live', {rating: 'up'}, expect.any(Object));
        expect(result.current.ratings['turn-live'].feedback).toEqual({rating: 'up', reasons: [], expected: ''});
        expect(result.current.pending).toBe('');

        await act(async () => {
            expect(await result.current.unrate('turn-live')).toBe(true);
        });
        expect(client.deleteFeedback).toHaveBeenCalledWith('new', 'turn-live', expect.any(Object));
        expect(result.current.ratings['turn-live'].feedback).toBeNull();
    });
    it('keeps the previous feedback and shows the error when saving fails', async () => {
        const {result} = await setup();
        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        client.setFeedback.mockRejectedValueOnce(new AiAgentError('http_error', 'This answer can no longer be rated.', 404));
        await act(async () => {
            expect(await result.current.rate('turn-1', {rating: 'up'})).toBe(false);
        });
        expect(result.current.ratings['turn-1']).toEqual({feedback: down, pending: false, error: 'This answer can no longer be rated.'});
    });
    it('does not rate without a conversation, and drops a late result after a scope change', async () => {
        const {result, rerender} = await setup();
        await act(async () => {
            expect(await result.current.rate('turn-1', {rating: 'up'})).toBe(false);
        });
        expect(client.setFeedback).not.toHaveBeenCalled();

        await act(async () => {
            await result.current.resumeConversation('existing');
        });
        let resolve;
        client.setFeedback.mockImplementationOnce((_id, _turn, _feedback, {signal}) => new Promise((ok, fail) => {
            resolve = ok;
            signal.addEventListener('abort', () => fail(new DOMException('Canceled', 'AbortError')));
        }));
        let rated;
        act(() => {
            rated = result.current.rate('turn-1', {rating: 'up'});
        });
        expect(result.current.ratings['turn-1'].pending).toBe(true);
        rerender({client, ready: true, scope: 'other:cluster'});
        resolve?.({rating: 'up', reasons: [], expected: ''});
        await act(async () => {
            expect(await rated).toBe(false);
        });
        expect(result.current.ratings).toEqual({});
    });
});
