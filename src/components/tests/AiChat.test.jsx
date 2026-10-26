import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {axe} from 'vitest-axe';
import AiChat, {groupConversations} from '../AiChat.jsx';
import {NARROW_QUERY} from '../../ui/lib/media';
import {AiAgentError} from '../../services/ai-agent.js';
import {replayRun} from '../../services/tests/agui-fixtures.js';

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
// The events of a run as the client gives them.
const text = (delta, messageId = 'turn-9:2') => [
    {type: 'TEXT_MESSAGE_START', messageId},
    {type: 'TEXT_MESSAGE_CONTENT', messageId, delta},
];
const completed = (tokens = null) => ({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-9', tokens});
const existing = {id: 'existing', title: 'Previous diagnostic'};
const created = {id: 'new', title: 'New diagnostic'};
const oldMessage = {
    id: 'turn-old:1',
    turn_id: 'turn-old',
    role: 'user',
    text: 'Older prompt',
    created_at: '2026-10-05T12:00:00Z',
};

// The step of an answer whose sentence is given, its frise unfolded.
const stepOf = (log, sentence) => {
    const folded = within(log).getAllByRole('button', {expanded: false}).find((button) => /^\d+ steps? · /.test(button.textContent));
    if (folded) fireEvent.click(folded);
    return within(log).getByRole('button', {name: sentence}).closest('li');
};

describe('AI chatbot page', () => {
    afterEach(() => {
        vi.useRealTimers();
        delete window.matchMedia;
    });
    beforeEach(() => {
        localStorage.removeItem('om3.ai.conversations');
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
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            renameConversation: vi.fn().mockResolvedValue({...created, title: 'Renamed'}),
            deleteConversation: vi.fn().mockResolvedValue(undefined),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(async (_id, _input, {onEvent}) => {
                onEvent({type: 'TOOL_CALL_START', toolCallId: 'call-1', toolCallName: 'get_cluster_health', parentMessageId: 'turn-9:2'});
                onEvent({type: 'TOOL_CALL_RESULT', toolCallId: 'call-1', rejected: false, structured: true});
                for (const event of text('Cluster looks healthy.', 'turn-9:4')) onEvent(event);
                return completed(12);
            }),
        };
    });
    const renderReady = async (props = {}) => {
        const view = render(<AiChat {...props} />);
        await waitFor(() =>
            expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled()
        );
        return view;
    };
    const submit = async (prompt) => {
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: prompt}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
    };
    test('sends a prompt with Enter without adding a newline', async () => {
        await renderReady();
        const input = screen.getByRole('textbox', {name: 'Message'});
        fireEvent.change(input, {target: {value: 'Keyboard diagnostic'}});
        expect(fireEvent.keyDown(input, {key: 'Enter'})).toBe(false);
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        expect(mocks.client.run).toHaveBeenCalledWith(
            'new',
            {prompt: 'Keyboard diagnostic', promptId: 'prompt-1', held: []},
            expect.any(Object)
        );
        expect(input).toHaveValue('');
    });
    test('leaves Shift+Enter available for a newline without sending', async () => {
        await renderReady();
        const input = screen.getByRole('textbox', {name: 'Message'});
        fireEvent.change(input, {target: {value: 'First line'}});
        expect(fireEvent.keyDown(input, {key: 'Enter', shiftKey: true})).toBe(true);
        expect(mocks.client.run).not.toHaveBeenCalled();
        expect(input).toHaveValue('First line');
    });
    test.each([{isComposing: true}, {keyCode: 229}])(
        'does not send Enter during IME composition: %j',
        async (composition) => {
            await renderReady();
            const input = screen.getByRole('textbox', {name: 'Message'});
            fireEvent.change(input, {target: {value: 'Composing'}});
            expect(fireEvent.keyDown(input, {key: 'Enter', ...composition})).toBe(true);
            expect(mocks.client.run).not.toHaveBeenCalled();
        }
    );
    test('does not submit an empty prompt with Enter', async () => {
        await renderReady();
        fireEvent.keyDown(screen.getByRole('textbox', {name: 'Message'}), {key: 'Enter'});
        expect(mocks.client.run).not.toHaveBeenCalled();
        expect(mocks.client.createConversation).not.toHaveBeenCalled();
    });
    test('renders the target and loads metadata without creating or sending a turn', async () => {
        await renderReady();
        expect(screen.getByRole('heading', {name: /AI Assistant/})).toBeInTheDocument();
        expect(screen.getByText('Lab cluster')).toBeInTheDocument();
        expect(mocks.fetchNodes).toHaveBeenCalledWith('token');
        expect(mocks.client.createConversation).not.toHaveBeenCalled();
        expect(mocks.client.run).not.toHaveBeenCalled();
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
            expect(stepOf(log, 'Get cluster health')).toHaveTextContent('done');
            expect(within(log).getByText(/1 step · Tokens: 12/)).toBeInTheDocument();
            expect(screen.queryByRole('button', {name: 'Stop'})).not.toBeInTheDocument();
        }
    );
    test('loads saved messages of a resumed conversation without sending a turn', async () => {
        await renderReady();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        await waitFor(() => expect(mocks.client.getMessages).toHaveBeenCalledWith('existing', expect.anything()));
        expect(await screen.findByRole('log')).toHaveTextContent('Send a prompt');
        expect(screen.queryByText(/History shows completed exchanges only/)).not.toBeInTheDocument();
        expect(mocks.client.run).not.toHaveBeenCalled();
    });
    test('displays interrupted output and stops without retrying', async () => {
        let signal;
        mocks.client.run.mockImplementation(
            (_id, _input, options) =>
                new Promise((_resolve, reject) => {
                    signal = options.signal;
                    for (const event of text('Partial response')) options.onEvent(event);
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
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
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
            expect(mocks.client.run).not.toHaveBeenCalled();
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
        expect(mocks.client.run).not.toHaveBeenCalled();
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
        mocks.client.run.mockRejectedValue(
            new AiAgentError('stream_interrupted', 'The stream was interrupted.')
        );
        await renderReady();
        await submit('hello');
        expect(await screen.findByRole('alert')).toHaveTextContent('The stream was interrupted.');
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
    });
    test('renders streamed Markdown without executing model HTML or formatting the prompt', async () => {
        mocks.client.run.mockImplementation(async (_id, _input, {onEvent}) => {
            for (const event of text('**Healthy**\n\n')) onEvent(event);
            onEvent({type: 'TEXT_MESSAGE_CONTENT', messageId: 'turn-9:2', delta: '<img src=x onerror="alert(1)">'});
            return completed();
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
        expect(mocks.client.run).not.toHaveBeenCalled();
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
            mocks.client.run.mockImplementation(
                (_id, _input, options) =>
                    new Promise((_resolve, reject) => {
                        signal = options.signal;
                        for (const event of text('Private response')) options.onEvent(event);
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
            expect(mocks.client.run).toHaveBeenCalledTimes(1);
        }
    );
    test.each(['openid', 'basic'])(
        'does not cancel or replay a turn when the %s token renews',
        async (authChoice) => {
            mocks.auth.authChoice = authChoice;
            let signal;
            mocks.client.run.mockImplementation(
                (_id, _input, options) =>
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
            expect(mocks.client.run).toHaveBeenCalledTimes(1);
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
            expect(mocks.client.run).not.toHaveBeenCalled();
        }
    );

    describe('action confirmation', () => {
        test('shows the exact call to confirm, a YAML by its lines, and answers it with a resume', async () => {
            mocks.client.run.mockImplementationOnce(replayRun('confirmation')).mockImplementationOnce(replayRun('resume_approved'));
            await renderReady();
            await submit('Start web with /bin/true');
            const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
            expect(within(card).getByText('Destructive action to confirm')).toBeInTheDocument();
            expect(within(card).getByText('Update object config')).toBeInTheDocument();
            expect(within(card).getByText('update_object_config')).toBeInTheDocument();
            expect(within(card).getByText('web')).toHaveProperty('tagName', 'CODE');
            // The YAML keeps its lines and indentation, under its media type.
            expect(within(card).getByText('application/yaml')).toBeInTheDocument();
            const yaml = card.querySelector('pre');
            expect(yaml.textContent).toBe('app#1:\n  start: /bin/true\n');
            expect(stepOf(screen.getByRole('log'), 'Update object config')).toHaveTextContent('waiting for your decision');
            expect(screen.getByRole('button', {name: 'Send'})).toBeDisabled();
            fireEvent.click(within(card).getByRole('button', {name: 'Approve'}));
            await waitFor(() =>
                expect(mocks.client.run).toHaveBeenLastCalledWith(
                    'new',
                    expect.objectContaining({resume: {interruptId: 'confirmation-1', approved: true}}),
                    expect.anything()
                )
            );
            await waitFor(() =>
                expect(screen.queryByRole('region', {name: 'Action waiting for confirmation'})).not.toBeInTheDocument()
            );
            expect(await screen.findByText('Done: web starts with /bin/true.')).toBeInTheDocument();
            expect(stepOf(screen.getByRole('log'), 'Update object config')).toHaveTextContent('done');
        });
        test('keeps the line breaks of an untyped text argument', async () => {
            mocks.client.getConversationState.mockResolvedValue({
                conversation: existing,
                confirmation: {
                    id: 'confirmation-1',
                    turn_id: 'turn-1',
                    tool: {name: 'set_note', title: 'Set note', destructive: true},
                    arguments: {note: 'first\n  second'},
                    argument_types: {},
                    expires_at: '2026-10-09T17:45:00Z',
                },
            });
            await renderReady();
            fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
            const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
            expect(card.querySelector('pre').textContent).toBe('first\n  second');
            // A call that takes no edits offers none.
            expect(within(card).queryByRole('button', {name: 'Edit'})).not.toBeInTheDocument();
        });
        test('edits the arguments in a form built from the input schema, and approves with them', async () => {
            mocks.client.run.mockImplementationOnce(replayRun('confirmation')).mockImplementationOnce(replayRun('resume_edited'));
            await renderReady();
            await submit('Start web with /bin/true');
            const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
            fireEvent.click(within(card).getByRole('button', {name: 'Edit'}));
            const form = within(card).getByRole('form', {name: 'Arguments of the action'});
            // The labels and descriptions come from the schema, the values from the call.
            const path = within(form).getByRole('textbox', {name: /path/});
            const yaml = within(form).getByRole('textbox', {name: /yaml/});
            expect(path).toHaveValue('web');
            expect(path).toHaveAttribute('aria-required', 'true');
            expect(yaml).toHaveValue('app#1:\n  start: /bin/true\n');
            expect(yaml).toHaveClass('font-mono');
            expect(within(form).getByText('application/yaml')).toBeInTheDocument();
            expect(within(form).getByText('The configuration to apply.')).toBeInTheDocument();
            expect(within(form).getByRole('checkbox', {name: /wait/})).not.toBeChecked();
            expect(within(card).getByRole('button', {name: 'Approve'})).toBeEnabled();
            fireEvent.change(yaml, {target: {value: 'app#1:\n  start: /bin/false\n'}});
            fireEvent.click(within(card).getByRole('button', {name: 'Approve with my changes'}));
            await waitFor(() =>
                expect(mocks.client.run).toHaveBeenLastCalledWith(
                    'new',
                    expect.objectContaining({
                        resume: {
                            interruptId: 'confirmation-1',
                            approved: true,
                            editedArgs: {path: 'web', yaml: 'app#1:\n  start: /bin/false\n'},
                        },
                    }),
                    expect.anything()
                )
            );
            await screen.findByText('Done: web starts with /bin/false, as you set it.');
            expect(stepOf(screen.getByRole('log'), 'Update object config')).toHaveTextContent(/done.*\(with your changes\)/);
        });
        test('checks the form against the schema before sending it, and discards the changes', async () => {
            mocks.client.getConversationState.mockResolvedValue({
                conversation: existing,
                confirmation: {
                    id: 'confirmation-1',
                    turn_id: 'turn-1',
                    tool: {name: 'scale_object', title: 'Scale object', destructive: true},
                    arguments: {path: 'web', count: 2},
                    argument_types: {},
                    editable: true,
                    input_schema: {
                        type: 'object',
                        properties: {path: {type: 'string', minLength: 1}, count: {type: 'integer', minimum: 1}},
                        required: ['path'],
                    },
                    expires_at: '2026-10-09T17:45:00Z',
                },
            });
            await renderReady();
            fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
            const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
            fireEvent.click(within(card).getByRole('button', {name: 'Edit'}));
            fireEvent.change(within(card).getByRole('textbox', {name: /count/}), {target: {value: 'many'}});
            expect(within(card).getByText('A number is required.')).toBeInTheDocument();
            fireEvent.change(within(card).getByRole('textbox', {name: /count/}), {target: {value: '0'}});
            expect(within(card).getByText('must be >= 1')).toBeInTheDocument();
            expect(within(card).getByRole('button', {name: 'Approve with my changes'})).toBeDisabled();
            fireEvent.click(within(card).getByRole('button', {name: 'Discard changes'}));
            expect(within(card).getByRole('button', {name: 'Approve'})).toBeEnabled();
            expect(within(card).getByText('2')).toBeInTheDocument();
            expect(mocks.client.run).not.toHaveBeenCalled();
        });
    });

    describe('layout', () => {
        const local = (...parts) => new Date(...parts).toISOString();
        const toggle = (name) => screen.getByRole('button', {name});
        test('folds the conversations, remembers it, and still starts a conversation folded', async () => {
            const {unmount} = await renderReady();
            const hide = toggle('Hide conversations');
            expect(hide).toHaveAttribute('aria-expanded', 'true');
            const panel = document.getElementById(hide.getAttribute('aria-controls'));
            expect(panel).toContainElement(screen.getByRole('button', {name: 'Previous diagnostic'}));
            fireEvent.click(hide);
            expect(toggle('Show conversations')).toHaveAttribute('aria-expanded', 'false');
            expect(panel).not.toBeVisible();
            expect(screen.queryByRole('button', {name: 'Previous diagnostic'})).not.toBeInTheDocument();
            expect(localStorage.getItem('om3.ai.conversations')).toBe('closed');
            unmount();
            await renderReady();
            expect(toggle('Show conversations')).toHaveAttribute('aria-expanded', 'false');
            fireEvent.click(screen.getByRole('button', {name: 'New conversation'}));
            await waitFor(() => expect(mocks.client.createConversation).toHaveBeenCalledTimes(1));
            fireEvent.click(toggle('Show conversations'));
            expect(localStorage.getItem('om3.ai.conversations')).toBe('open');
            expect(screen.getByRole('button', {name: 'Previous diagnostic'})).toBeVisible();
        });
        test('folds the conversations of a narrow window by default, and once one is chosen', async () => {
            window.matchMedia = vi.fn((query) => ({
                matches: query === NARROW_QUERY,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));
            await renderReady();
            fireEvent.click(toggle('Show conversations'));
            fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
            expect(toggle('Show conversations')).toHaveAttribute('aria-expanded', 'false');
            // Narrow, the fold is not a preference.
            expect(localStorage.getItem('om3.ai.conversations')).toBeNull();
        });
        test('searches the titles of the conversations loaded', async () => {
            mocks.client.listConversations.mockResolvedValue([existing, {id: 'pool', title: 'Pool usage'}, {id: 'untitled'}]);
            await renderReady();
            const search = screen.getByRole('searchbox', {name: 'Search conversations'});
            fireEvent.change(search, {target: {value: 'POOL'}});
            expect(screen.getByRole('button', {name: 'Pool usage'})).toBeInTheDocument();
            expect(screen.queryByRole('button', {name: 'Previous diagnostic'})).not.toBeInTheDocument();
            // An untitled conversation is found by the name it shows.
            fireEvent.change(search, {target: {value: 'untitled'}});
            expect(screen.getByRole('button', {name: 'Untitled conversation'})).toBeInTheDocument();
            fireEvent.change(search, {target: {value: 'nothing like it'}});
            expect(screen.getByText('No conversation matches.')).toBeInTheDocument();
            expect(mocks.client.listConversations).toHaveBeenCalledTimes(1);
        });
        test('groups the conversations by the day of their last change', async () => {
            vi.useFakeTimers({toFake: ['Date'], now: new Date(2026, 9, 23, 15, 0)});
            mocks.client.listConversations.mockResolvedValue([
                {id: 'a', title: 'Disk check', created_at: local(2026, 9, 1), updated_at: local(2026, 9, 23, 9, 0)},
                {id: 'b', title: 'Freeze review', updated_at: local(2026, 9, 22, 23, 30)},
                {id: 'c', title: 'Pool usage', updated_at: local(2026, 9, 18, 12, 0)},
                {id: 'd', title: 'Old upgrade', updated_at: local(2026, 8, 1)},
                {id: 'e', title: 'No date'},
                {id: 'f', title: 'Latest', created_at: local(2026, 9, 23, 14, 0)},
            ]);
            await renderReady();
            const panel = screen.getByRole('region', {name: 'Conversations'});
            expect(within(panel).getAllByRole('heading', {level: 3}).map((heading) => heading.textContent)).toEqual([
                'Today',
                'Yesterday',
                'Previous 7 days',
                'Older',
            ]);
            const titles = (name) => within(screen.getByRole('list', {name})).getAllByRole('button').map((button) => button.textContent);
            expect(titles('Today')).toEqual(['Latest', 'Disk check']);
            expect(titles('Yesterday')).toEqual(['Freeze review']);
            expect(titles('Previous 7 days')).toEqual(['Pool usage']);
            expect(titles('Older')).toEqual(['Old upgrade', 'No date']);
        });
        test('leaves out the empty groups, by the local day of now', () => {
            const now = new Date(2026, 9, 23, 0, 30);
            expect(groupConversations([{id: 'a', updated_at: local(2026, 9, 22, 23, 59)}], now)).toEqual([
                {key: 'yesterday', items: [{id: 'a', updated_at: local(2026, 9, 22, 23, 59)}]},
            ]);
            expect(groupConversations([], now)).toEqual([]);
        });
        test('offers first questions from the state of the menu, until the first message', async () => {
            const status = {
                objects: {
                    'prod/svc/api': {avail: 'up', overall: 'warn'},
                    'prod/svc/web': {avail: 'down', overall: 'down'},
                    'prod/cfg/settings': {avail: 'n/a', overall: 'warn'},
                },
                nodeStatus: {
                    n1: {frozen_at: '0001-01-01T00:00:00Z'},
                    n3: {frozen_at: '2026-10-23T10:00:00Z'},
                    n2: {frozen_at: '2026-10-23T09:00:00Z'},
                },
            };
            await renderReady({status});
            const starters = screen.getByRole('list', {name: 'Suggested questions'});
            expect(within(starters).getAllByRole('button').map((button) => button.textContent)).toEqual([
                'Why is prod/svc/web down?',
                'Why is n2 frozen?',
                'Which services are stopped?',
                'Are all the heartbeats alive?',
            ]);
            fireEvent.click(within(starters).getByRole('button', {name: 'Why is prod/svc/web down?'}));
            await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
            expect(mocks.client.run).toHaveBeenCalledWith(
                'new',
                expect.objectContaining({prompt: 'Why is prod/svc/web down?'}),
                expect.any(Object)
            );
            await screen.findByText('Cluster looks healthy.');
            expect(screen.queryByRole('list', {name: 'Suggested questions'})).not.toBeInTheDocument();
        });
        test('asks about a warn object when none is down, the general questions otherwise', async () => {
            const {unmount} = await renderReady({status: {objects: {'ns/vol/data': {avail: 'up', overall: 'warn'}}, nodeStatus: {}}});
            expect(within(screen.getByRole('list', {name: 'Suggested questions'})).getAllByRole('button').map((button) => button.textContent)).toEqual([
                'Why is ns/vol/data warn?',
                'Which services are stopped?',
                'Are all the heartbeats alive?',
            ]);
            unmount();
            await renderReady();
            expect(within(screen.getByRole('list', {name: 'Suggested questions'})).getAllByRole('button')).toHaveLength(2);
        });
        test('puts an object path in a question as text, never as markup or a placeholder', async () => {
            const path = 'ns/svc/<img src=x onerror=alert(1)>{{state}}{{node}}$t(ai.title)';
            const {container} = await renderReady({status: {objects: {[path]: {avail: 'down'}}}});
            const question = `Why is ${path} down?`;
            fireEvent.click(screen.getByRole('button', {name: question}));
            await waitFor(() => expect(mocks.client.run).toHaveBeenCalledWith('new', expect.objectContaining({prompt: question}), expect.any(Object)));
            expect(container.querySelector('img')).toBeNull();
        });
        test('offers no Stop while an approved action runs: its result is what to see', async () => {
            mocks.client.run.mockImplementationOnce(replayRun('confirmation')).mockImplementationOnce(() => new Promise(() => {}));
            await renderReady();
            await submit('Start web with /bin/true');
            const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
            fireEvent.click(within(card).getByRole('button', {name: 'Approve'}));
            await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
            expect(screen.getByRole('button', {name: 'Send'})).toBeDisabled();
            expect(screen.queryByRole('button', {name: 'Stop'})).not.toBeInTheDocument();
        });
        test('accessibility of the layout', async () => {
            const {container} = await renderReady({status: {objects: {'prod/svc/web': {avail: 'down'}}, nodeStatus: {}}});
            expect(screen.getByRole('log', {name: 'Conversation messages'})).toBeInTheDocument();
            expect(toggle('Hide conversations')).toHaveAttribute('aria-controls', 'ai-conversations-panel');
            expect((await axe(container)).violations).toHaveLength(0);
            fireEvent.click(toggle('Hide conversations'));
            expect((await axe(container)).violations).toHaveLength(0);
        });
    });
});
