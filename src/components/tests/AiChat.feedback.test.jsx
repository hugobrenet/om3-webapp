import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import AiChat from '../AiChat.jsx';

const mocks = vi.hoisted(() => ({auth: null, client: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
vi.mock('../../hooks/useFetchDaemonStatus.jsx', () => ({
    default: () => ({clusterId: 'cluster-id', clusterName: 'Lab cluster', fetchNodes: vi.fn(), loading: false, error: ''}),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({client: mocks.client, enabled: true, ready: true, configurationError: null}),
}));

const existing = {id: 'existing', title: 'Previous diagnostic'};
const message = (id, role, text, extra = {}) => ({id, turn_id: id.split(':')[0], role, text, created_at: '2026-10-05T12:00:00Z', ...extra});

describe('AI chatbot feedback', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: 'New'}),
            getConversation: vi.fn().mockResolvedValue({id: 'new', title: 'New'}),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn().mockResolvedValue({
                messages: [
                    message('turn-1:1', 'user', 'How many nodes?'),
                    message('turn-1:2', 'assistant', 'Looking.'),
                    message('turn-1:4', 'assistant', 'There are 484 nodes.'),
                    message('turn-2:1', 'user', 'Per OS?'),
                    message('turn-2:2', 'assistant', 'Linux mostly.', {feedback: {rating: 'up', reasons: [], expected: ''}}),
                ],
                next_cursor: '',
            }),
            sendTurn: vi.fn(async (_id, _prompt, {onEvent}) => {
                onEvent({type: 'text_delta', text_delta: 'Streamed answer.'});
                onEvent({type: 'completed', turn_id: 'turn-live'});
            }),
            setFeedback: vi.fn(async (_id, _turnId, feedback) => ({reasons: [], expected: '', ...feedback})),
            deleteFeedback: vi.fn().mockResolvedValue(undefined),
        };
    });
    const resume = async () => {
        render(<AiChat />);
        fireEvent.click(await screen.findByRole('button', {name: 'Previous diagnostic'}));
        await screen.findByText('There are 484 nodes.');
    };
    const answer = (text) => screen.getByText(text).closest('li');

    test('offers the rating under the last answer of each turn only', async () => {
        await resume();
        expect(screen.getAllByRole('group', {name: 'Rate this answer'})).toHaveLength(2);
        expect(within(answer('Looking.')).queryByRole('group', {name: 'Rate this answer'})).toBeNull();
        const rated = within(answer('Linux mostly.'));
        expect(rated.getByRole('button', {name: /Helpful/})).toHaveAttribute('aria-pressed', 'true');
        expect(rated.getByText('Thanks for your feedback.')).toBeInTheDocument();
    });
    test('sends a helpful rating at once, and withdraws it on a second click', async () => {
        await resume();
        const turn = within(answer('There are 484 nodes.'));
        fireEvent.click(turn.getByRole('button', {name: /Helpful/}));
        await waitFor(() => expect(turn.getByRole('button', {name: /Helpful/})).toHaveAttribute('aria-pressed', 'true'));
        expect(mocks.client.setFeedback).toHaveBeenCalledWith('existing', 'turn-1', {rating: 'up'}, expect.any(Object));
        fireEvent.click(turn.getByRole('button', {name: /Helpful/}));
        await waitFor(() => expect(mocks.client.deleteFeedback).toHaveBeenCalledWith('existing', 'turn-1', expect.any(Object)));
        await waitFor(() => expect(turn.getByRole('button', {name: /Helpful/})).toHaveAttribute('aria-pressed', 'false'));
    });
    test('asks the optional reasons and expectation of a negative rating', async () => {
        await resume();
        const turn = within(answer('There are 484 nodes.'));
        fireEvent.click(turn.getByRole('button', {name: /Needs improvement/}));
        const form = within(turn.getByRole('form', {name: 'Feedback details'}));
        expect(form.getByText(/without your identity/)).toBeInTheDocument();
        fireEvent.click(form.getByRole('checkbox', {name: 'Missing information'}));
        fireEvent.change(form.getByRole('textbox', {name: /What did you expect/}), {target: {value: 'The count per OS'}});
        fireEvent.click(form.getByRole('button', {name: 'Send'}));
        await waitFor(() =>
            expect(mocks.client.setFeedback).toHaveBeenCalledWith(
                'existing', 'turn-1', {rating: 'down', reasons: ['missing_information'], expected: 'The count per OS'}, expect.any(Object)
            )
        );
        await waitFor(() => expect(turn.queryByRole('form', {name: 'Feedback details'})).toBeNull());
        expect(turn.getByRole('button', {name: /Needs improvement/})).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(turn.getByRole('button', {name: 'Edit'}));
        expect(within(turn.getByRole('form', {name: 'Feedback details'})).getByRole('checkbox', {name: 'Missing information'})).toBeChecked();
    });
    test('refuses an expectation over 1000 characters and cancels without sending', async () => {
        await resume();
        const turn = within(answer('There are 484 nodes.'));
        fireEvent.click(turn.getByRole('button', {name: /Needs improvement/}));
        const form = within(turn.getByRole('form', {name: 'Feedback details'}));
        fireEvent.change(form.getByRole('textbox', {name: /What did you expect/}), {target: {value: 'x'.repeat(1001)}});
        expect(form.getByRole('button', {name: 'Send'})).toBeDisabled();
        expect(form.getByText('At most 1000 characters.')).toBeInTheDocument();
        fireEvent.click(form.getByRole('button', {name: 'Cancel'}));
        expect(turn.queryByRole('form', {name: 'Feedback details'})).toBeNull();
        expect(mocks.client.setFeedback).not.toHaveBeenCalled();
    });
    test('rates an answer just streamed with the turn of its completion', async () => {
        render(<AiChat />);
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'hello'}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await screen.findByText('Streamed answer.');
        fireEvent.click(await within(answer('Streamed answer.')).findByRole('button', {name: /Helpful/}));
        await waitFor(() => expect(mocks.client.setFeedback).toHaveBeenCalledWith('new', 'turn-live', {rating: 'up'}, expect.any(Object)));
    });
    test('shows a saving error under the answer', async () => {
        mocks.client.setFeedback.mockRejectedValueOnce(new Error('boom'));
        await resume();
        const turn = within(answer('There are 484 nodes.'));
        fireEvent.click(turn.getByRole('button', {name: /Helpful/}));
        expect(await turn.findByRole('alert')).toHaveTextContent('The AI request failed.');
    });
});
