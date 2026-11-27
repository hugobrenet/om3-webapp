import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import useAiChat from '../useAiChat.js';

const existing = {id: 'existing', title: 'Previous diagnostic'};
const finished = (turnId) => ({type: 'RUN_FINISHED', outcome: 'success', turnId, tokens: null});

// The skills of the prompts kept through a snapshot of the thread: those the
// webapp holds, by their ID, the one the run was sent with, and those the
// snapshot names.
describe('useAiChat skills through a snapshot', () => {
    let client;
    beforeEach(() => {
        client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue(existing),
            getConversation: vi.fn().mockResolvedValue(existing),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn().mockResolvedValue({
                messages: [
                    {id: 'turn-1:1', turn_id: 'turn-1', role: 'user', text: 'check', created_at: '2026-10-05T12:00:00Z', skill: 'morning-check'},
                    {id: 'turn-1:2', turn_id: 'turn-1', role: 'assistant', text: 'ok', created_at: '2026-10-05T12:00:01Z'},
                ],
                next_cursor: '',
            }),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(async () => finished('turn-live')),
            getCapabilities: vi.fn().mockResolvedValue({feedback: true, models: false, skills: true}),
            listSkills: vi.fn().mockResolvedValue([{name: 'node-maintenance', description: 'Reboot a node.'}]),
        };
    });
    const opened = async () => {
        const hook = renderHook((options) => useAiChat(options), {initialProps: {client, ready: true, scope: 'user:cluster'}});
        await waitFor(() => expect(hook.result.current.pending).toBe(''));
        await act(async () => {
            await hook.result.current.resumeConversation('existing');
        });
        return hook;
    };
    const skillsOf = (messages) => messages.filter((message) => message.role === 'user').map((message) => `${message.id}=${message.skill ?? ''}`);
    const snapshotting = (messages) => async (_id, _input, {onEvent}) => {
        onEvent({type: 'MESSAGES_SNAPSHOT', omittedTurns: 0, messages});
        return finished('turn-2');
    };

    it('keeps the skill of the prompts the webapp holds, and of the prompt of the run', async () => {
        const {result} = await opened();
        expect(skillsOf(result.current.messages)).toEqual(['turn-1:1=morning-check']);
        // Out of phase: the prompt goes under another ID, named without the
        // skill, as an agent of before does.
        client.run.mockImplementationOnce(snapshotting([
            {id: 'turn-1:1', role: 'user', content: 'check'},
            {id: 'turn-1:2', role: 'assistant', content: 'ok', toolCalls: []},
            {id: 'turn-2:1', role: 'user', content: 'on n1'},
        ]));
        await act(async () => {
            await result.current.send('on n1', undefined, undefined, 'node-maintenance');
        });
        expect(skillsOf(result.current.messages)).toEqual(['turn-1:1=morning-check', 'turn-2:1=node-maintenance']);
    });

    it('shows the skill the snapshot names, such as of the turn a run resumes', async () => {
        const {result} = await opened();
        client.run.mockImplementationOnce(snapshotting([
            {id: 'turn-1:1', role: 'user', content: 'check'},
            {id: 'turn-1:2', role: 'assistant', content: 'ok', toolCalls: []},
            {id: 'turn-2:1', role: 'user', content: 'stop web', skill: 'node-maintenance'},
            {id: 'turn-2:2', role: 'assistant', content: 'Stopped.', toolCalls: []},
            {id: 'turn-3:1', role: 'user', content: 'and now?'},
        ]));
        await act(async () => {
            await result.current.send('and now?');
        });
        expect(skillsOf(result.current.messages)).toEqual(['turn-1:1=morning-check', 'turn-2:1=node-maintenance', 'turn-3:1=']);
    });
});
