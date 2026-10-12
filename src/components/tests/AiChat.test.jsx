import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import AiChat from '../AiChat.jsx';
import {AiAgentError} from '../../services/ai-agent.js';

const mocks = vi.hoisted(() => ({
    auth: null,
    client: null,
    enabled: true,
    clusterId: 'cluster-id',
    fetchNodes: vi.fn(),
}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
vi.mock('../../hooks/useFetchDaemonStatus.jsx', () => ({
    default: () => ({
        clusterId: mocks.clusterId,
        clusterName: 'Lab cluster',
        fetchNodes: mocks.fetchNodes,
        loading: false,
        error: '',
    }),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({
        client: mocks.client,
        enabled: mocks.enabled,
        ready: mocks.enabled && Boolean(mocks.auth.accessToken && mocks.clusterId),
        configurationError: null,
    }),
}));
const existing = {id: 'existing', title: 'Previous diagnostic'};
const created = {id: 'new', title: 'New diagnostic'};
const oldMessage = {
    id: 'turn-old:1',
    turn_id: 'turn-old',
    role: 'user',
    text: 'Older prompt',
    created_at: '2026-10-05T12:00:00Z',
};

describe('AI chatbot page', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.enabled = true;
        mocks.clusterId = 'cluster-id';
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue(created),
            getConversation: vi.fn().mockResolvedValue(existing),
            getConversationState: vi.fn(async (id, options) => ({
                conversation: await mocks.client.getConversation(id, options),
                confirmation: null,
            })),
            confirmTurn: vi.fn(),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            renameConversation: vi.fn().mockResolvedValue({...created, title: 'Renamed'}),
            deleteConversation: vi.fn().mockResolvedValue(undefined),
            sendTurn: vi.fn(async (_id, _prompt, {onEvent}) => {
                onEvent({type: 'tool_started', tool_name: 'get_cluster_health'});
                onEvent({
                    type: 'tool_finished',
                    tool_name: 'get_cluster_health',
                    tool_error: false,
                });
                onEvent({type: 'text_delta', text_delta: 'Cluster looks healthy.'});
                onEvent({type: 'usage', usage: {total_tokens: 12}});
                onEvent({type: 'completed'});
            }),
        };
    });
    const renderReady = async () => {
        const view = render(<AiChat />);
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled()
        );
        return view;
    };
    const submit = async (prompt) => {
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: prompt}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await waitFor(() => expect(mocks.client.sendTurn).toHaveBeenCalledTimes(1));
    };
    test('sends a prompt with Enter without adding a newline', async () => {
        await renderReady();
        const input = screen.getByRole('textbox', {name: 'Message'});
        fireEvent.change(input, {target: {value: 'Keyboard diagnostic'}});
        expect(fireEvent.keyDown(input, {key: 'Enter'})).toBe(false);
        await waitFor(() => expect(mocks.client.sendTurn).toHaveBeenCalledTimes(1));
        expect(mocks.client.sendTurn).toHaveBeenCalledWith(
            'new',
            'Keyboard diagnostic',
            expect.any(Object)
        );
        expect(input).toHaveValue('');
    });
    test('leaves Shift+Enter available for a newline without sending', async () => {
        await renderReady();
        const input = screen.getByRole('textbox', {name: 'Message'});
        fireEvent.change(input, {target: {value: 'First line'}});
        expect(fireEvent.keyDown(input, {key: 'Enter', shiftKey: true})).toBe(true);
        expect(mocks.client.sendTurn).not.toHaveBeenCalled();
        expect(input).toHaveValue('First line');
    });
    test.each([{isComposing: true}, {keyCode: 229}])(
        'does not send Enter during IME composition: %j',
        async (composition) => {
            await renderReady();
            const input = screen.getByRole('textbox', {name: 'Message'});
            fireEvent.change(input, {target: {value: 'Composing'}});
            expect(fireEvent.keyDown(input, {key: 'Enter', ...composition})).toBe(true);
            expect(mocks.client.sendTurn).not.toHaveBeenCalled();
        }
    );
    test('does not submit an empty prompt with Enter', async () => {
        await renderReady();
        fireEvent.keyDown(screen.getByRole('textbox', {name: 'Message'}), {key: 'Enter'});
        expect(mocks.client.sendTurn).not.toHaveBeenCalled();
        expect(mocks.client.createConversation).not.toHaveBeenCalled();
    });
    test('renders the target and loads metadata without creating or sending a turn', async () => {
        await renderReady();
        expect(screen.getByRole('heading', {name: /AI Assistant/})).toBeInTheDocument();
        expect(screen.getByText('Lab cluster')).toBeInTheDocument();
        expect(mocks.fetchNodes).toHaveBeenCalledWith('token');
        expect(mocks.client.createConversation).not.toHaveBeenCalled();
        expect(mocks.client.sendTurn).not.toHaveBeenCalled();
    });
    test.each(['openid', 'basic', null])(
        'renders the chat and sends a turn for %s login',
        async (authChoice) => {
            mocks.auth.authChoice = authChoice;
            await renderReady();
            expect(mocks.fetchNodes).toHaveBeenCalledWith('token');
            await submit('Diagnose my cluster');
            expect(await screen.findByText('Cluster looks healthy.')).toBeInTheDocument();
            const log = screen.getByRole('log', {name: 'Conversation messages'});
            expect(within(log).getByText('Diagnose my cluster')).toBeInTheDocument();
            expect(within(log).getByText('get_cluster_health — completed')).toBeInTheDocument();
            expect(within(log).getByText('Tokens: 12')).toBeInTheDocument();
            expect(screen.queryByRole('button', {name: 'Stop'})).not.toBeInTheDocument();
        }
    );
    test('loads saved messages of a resumed conversation without sending a turn', async () => {
        await renderReady();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        await waitFor(() => expect(mocks.client.getMessages).toHaveBeenCalledWith('existing', expect.anything()));
        expect(await screen.findByRole('log')).toHaveTextContent('Send a prompt');
        expect(screen.queryByText(/History shows completed exchanges only/)).not.toBeInTheDocument();
        expect(mocks.client.sendTurn).not.toHaveBeenCalled();
    });
    test('displays interrupted output and stops without retrying', async () => {
        let signal;
        mocks.client.sendTurn.mockImplementation(
            (_id, _prompt, options) =>
                new Promise((_resolve, reject) => {
                    signal = options.signal;
                    options.onEvent({type: 'text_delta', text_delta: 'Partial response'});
                    signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('Canceled', 'AbortError')),
                        {once: true}
                    );
                })
        );
        await renderReady();
        await submit('hello');
        fireEvent.click(screen.getByRole('button', {name: 'Stop'}));
        expect(await screen.findByText(/Incomplete response — stopped/)).toBeInTheDocument();
        expect(screen.getByText('Partial response')).toBeInTheDocument();
        expect(signal.aborted).toBe(true);
        expect(mocks.client.sendTurn).toHaveBeenCalledTimes(1);
    });
    test.each(['openid', 'basic'])(
        'restores and pages saved messages for %s without running a turn',
        async (authChoice) => {
            mocks.auth.authChoice = authChoice;
            const answer = {
                ...oldMessage,
                id: 'turn-old:2',
                role: 'assistant',
                text: 'Saved answer',
            };
            mocks.client.getMessages
                .mockResolvedValueOnce({messages: [answer], next_cursor: '1:2'})
                .mockResolvedValueOnce({messages: [oldMessage], next_cursor: ''});
            await renderReady();
            fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
            expect(await screen.findByText('Saved answer')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', {name: 'Load earlier messages'}));
            expect(await screen.findByText('Older prompt')).toBeInTheDocument();
            expect(
                screen.queryByRole('button', {name: 'Load earlier messages'})
            ).not.toBeInTheDocument();
            const log = screen.getByRole('log');
            expect(log.textContent.indexOf('Older prompt')).toBeLessThan(
                log.textContent.indexOf('Saved answer')
            );
            expect(mocks.client.sendTurn).not.toHaveBeenCalled();
            expect(mocks.client.createConversation).not.toHaveBeenCalled();
        }
    );
    test('keeps the reading position when older messages are prepended', async () => {
        mocks.client.getMessages.mockResolvedValueOnce({
            messages: [oldMessage],
            next_cursor: '1:1',
        });
        await renderReady();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        await screen.findByText('Older prompt');
        const log = screen.getByRole('log');
        let height = 1000;
        Object.defineProperty(log, 'scrollHeight', {configurable: true, get: () => height});
        log.scrollTop = 120;
        mocks.client.getMessages.mockImplementationOnce(async () => {
            height = 1500;
            return {
                messages: [{...oldMessage, id: 'turn-earlier:1', text: 'Earlier message'}],
                next_cursor: '',
            };
        });
        fireEvent.click(screen.getByRole('button', {name: 'Load earlier messages'}));
        await screen.findByText('Earlier message');
        expect(log.scrollTop).toBe(620);
    });
    test('blocks sending after a history error and permits a manual resume', async () => {
        mocks.client.getMessages
            .mockRejectedValueOnce(new AiAgentError('http_error', 'Authentication required.', 401))
            .mockResolvedValueOnce({messages: [oldMessage], next_cursor: ''});
        await renderReady();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        expect(await screen.findByRole('alert')).toHaveTextContent('Authentication required.');
        expect(screen.getByRole('textbox', {name: 'Message'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Send'})).toBeDisabled();
        expect(mocks.client.sendTurn).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        await screen.findByText('Older prompt');
        expect(screen.getByRole('textbox', {name: 'Message'})).toBeEnabled();
    });
    test('renders historical messages as text, never HTML', async () => {
        mocks.client.getMessages.mockResolvedValue({
            messages: [{...oldMessage, text: '<img src=x onerror="alert(1)">'}],
            next_cursor: '',
        });
        const {container} = await renderReady();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
    });
    test('reports stream errors without a retry button or automatic resubmission', async () => {
        mocks.client.sendTurn.mockRejectedValue(
            new AiAgentError('stream_interrupted', 'The stream was interrupted.')
        );
        await renderReady();
        await submit('hello');
        expect(await screen.findByRole('alert')).toHaveTextContent('The stream was interrupted.');
        expect(mocks.client.sendTurn).toHaveBeenCalledTimes(1);
    });
    test('renders streamed Markdown without executing model HTML or formatting the prompt', async () => {
        mocks.client.sendTurn.mockImplementation(async (_id, _prompt, {onEvent}) => {
            onEvent({type: 'text_delta', text_delta: '**Healthy**\n\n'});
            onEvent({type: 'text_delta', text_delta: '<img src=x onerror="alert(1)">'});
            onEvent({type: 'completed'});
        });
        const {container} = await renderReady();
        await submit('**diagnose**');
        expect(await screen.findByText('Healthy')).toHaveProperty('tagName', 'STRONG');
        expect(screen.getByText('**diagnose**')).toBeInTheDocument();
        expect(screen.queryByText('<img src=x onerror="alert(1)">')).not.toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
    });
    test('renders saved assistant responses using the same Markdown policy', async () => {
        mocks.client.getMessages.mockResolvedValue({
            messages: [{...oldMessage, role: 'assistant', text: '**Saved diagnostic**'}],
            next_cursor: '',
        });
        await renderReady();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        expect(await screen.findByText('Saved diagnostic')).toHaveProperty('tagName', 'STRONG');
        expect(mocks.client.sendTurn).not.toHaveBeenCalled();
    });
    test('allows renaming and requires confirmation before deleting', async () => {
        await renderReady();
        fireEvent.click(screen.getByRole('button', {name: 'New conversation'}));
        await waitFor(() => expect(screen.getByRole('button', {name: 'Rename'})).toBeEnabled());
        fireEvent.click(screen.getByRole('button', {name: 'Rename'}));
        fireEvent.change(screen.getByRole('textbox', {name: 'Conversation title'}), {
            target: {value: 'Renamed'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'Save title'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(mocks.client.renameConversation).toHaveBeenCalledWith(
            'new',
            'Renamed',
            expect.any(Object)
        );
        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        expect(mocks.client.deleteConversation).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Confirm deletion'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(mocks.client.deleteConversation).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', {name: 'Rename'})).not.toBeInTheDocument();
    });
    test.each(['openid', 'basic'])(
        'aborts and hides the transcript on %s logout',
        async (authChoice) => {
            mocks.auth.authChoice = authChoice;
            let signal;
            mocks.client.sendTurn.mockImplementation(
                (_id, _prompt, options) =>
                    new Promise((_resolve, reject) => {
                        signal = options.signal;
                        options.onEvent({type: 'text_delta', text_delta: 'Private response'});
                        signal.addEventListener(
                            'abort',
                            () => reject(new DOMException('Canceled', 'AbortError')),
                            {once: true}
                        );
                    })
            );
            const {rerender} = await renderReady();
            await submit('private prompt');
            await act(async () => {
                mocks.auth = {...mocks.auth, accessToken: null};
                rerender(<AiChat />);
            });
            expect(signal.aborted).toBe(true);
            expect(screen.queryByText('Private response')).not.toBeInTheDocument();
            expect(screen.queryByText('private prompt')).not.toBeInTheDocument();
            expect(mocks.client.sendTurn).toHaveBeenCalledTimes(1);
        }
    );
    test.each(['openid', 'basic'])(
        'does not cancel or replay a turn when the %s token renews',
        async (authChoice) => {
            mocks.auth.authChoice = authChoice;
            let signal;
            mocks.client.sendTurn.mockImplementation(
                (_id, _prompt, options) =>
                    new Promise((_resolve, reject) => {
                        signal = options.signal;
                        signal.addEventListener(
                            'abort',
                            () => reject(new DOMException('Canceled', 'AbortError')),
                            {once: true}
                        );
                    })
            );
            const {rerender} = await renderReady();
            await submit('hello');
            await act(async () => {
                mocks.auth = {...mocks.auth, accessToken: 'renewed'};
                rerender(<AiChat />);
            });
            expect(signal.aborted).toBe(false);
            expect(mocks.client.sendTurn).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByRole('button', {name: 'Stop'}));
            await screen.findByText(/Incomplete response — stopped/);
        }
    );
    test.each(['disabled', 'missing-token', 'missing-target'])(
        'does not contact the agent when %s',
        async (reason) => {
            if (reason === 'disabled') mocks.enabled = false;
            if (reason === 'missing-token') mocks.auth.accessToken = null;
            if (reason === 'missing-target') mocks.clusterId = '';
            render(<AiChat />);
            // Information strips are announced politely, as a status.
            expect(screen.getByRole('status')).toBeInTheDocument();
            expect(screen.queryByRole('textbox', {name: 'Message'})).not.toBeInTheDocument();
            expect(mocks.client.listConversations).not.toHaveBeenCalled();
            expect(mocks.client.createConversation).not.toHaveBeenCalled();
            expect(mocks.client.sendTurn).not.toHaveBeenCalled();
        }
    );

    describe('action confirmation', () => {
        const confirmation = {
            id: 'confirmation-1',
            turn_id: 'turn-1',
            tool: {name: 'stop_object', title: 'Stop object', destructive: true},
            arguments: {path: 'prod/svc/web'},
            expires_at: '2026-10-09T17:45:00Z',
        };
        test('shows the exact call to confirm and sends the decision', async () => {
            mocks.client.sendTurn = vi.fn(async (_id, _prompt, {onEvent}) => {
                const event = {type: 'confirmation_required', confirmation};
                onEvent({type: 'text_delta', text_delta: 'I will only freeze it.'});
                onEvent(event);
                return event;
            });
            mocks.client.confirmTurn = vi.fn(async (_id, _turn, _confirmation, _decision, {onEvent}) => {
                onEvent({type: 'completed'});
                return {type: 'completed'};
            });
            await renderReady();
            await submit('stop web');
            const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
            expect(within(card).getByText('Destructive action to confirm')).toBeInTheDocument();
            expect(within(card).getByText('Stop object')).toBeInTheDocument();
            expect(within(card).getByText('stop_object')).toBeInTheDocument();
            expect(within(card).getByText('prod/svc/web')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Send'})).toBeDisabled();
            fireEvent.click(within(card).getByRole('button', {name: 'Approve'}));
            await waitFor(() =>
                expect(mocks.client.confirmTurn).toHaveBeenCalledWith('new', 'turn-1', 'confirmation-1', 'approve', expect.anything())
            );
            await waitFor(() =>
                expect(screen.queryByRole('region', {name: 'Action waiting for confirmation'})).not.toBeInTheDocument()
            );
        });
    });
});
