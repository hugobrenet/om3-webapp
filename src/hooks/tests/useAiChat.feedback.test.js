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
            sendTurn: vi.fn(async (_id, _prompt, {onEvent}) => {
                onEvent({type: 'text_delta', text_delta: 'Hello'});
                onEvent({type: 'completed', turn_id: 'turn-live'});
            }),
            setFeedback: vi.fn(async (_id, _turnId, feedback) => ({reasons: [], expected: '', ...feedback})),
            deleteFeedback: vi.fn().mockResolvedValue(undefined),
        };
    });
    const setup = async () => {
        const hook = renderHook((options) => useAiChat(options), {initialProps: {client, ready: true, scope: 'user:cluster'}});
        await waitFor(() => expect(hook.result.current.pending).toBe(''));
        return hook;
    };

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
