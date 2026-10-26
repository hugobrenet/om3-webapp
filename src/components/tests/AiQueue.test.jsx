import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {axe} from 'vitest-axe';
import AiChat from '../AiChat.jsx';
import {replayRun} from '../../services/tests/agui-fixtures.js';

const mocks = vi.hoisted(() => ({auth: null, client: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
vi.mock('../../hooks/useFetchDaemonStatus.jsx', () => ({
    default: () => ({clusterId: 'cluster-id', clusterName: 'Lab cluster', fetchNodes: vi.fn(), loading: false, error: ''}),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({client: mocks.client, enabled: true, ready: true, configurationError: null}),
}));

const existing = {id: 'existing', title: 'Previous diagnostic'};

// A run that waits until the user stops it.
const hangingRun = (_id, _input, {signal, onEvent}) =>
    new Promise((_resolve, reject) => {
        onEvent({type: 'RUN_STARTED', at: 1000});
        signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), {once: true});
    });

describe('the message queued while the agent answers', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: ''}),
            getConversation: vi.fn().mockResolvedValue(existing),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(),
        };
    });
    const box = () => screen.getByRole('textbox', {name: 'Message'});
    const type = (text) => fireEvent.change(box(), {target: {value: text}});
    const start = async (run = hangingRun) => {
        mocks.client.run.mockImplementationOnce(run);
        const view = render(
            <MemoryRouter>
                <AiChat/>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        type('First');
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await screen.findByRole('button', {name: 'Stop'});
        return view;
    };
    const queued = () => screen.queryByRole('group', {name: 'Queued message'});

    test('announces the first message queued, in a live region always there', async () => {
        await start();
        const live = document.querySelector('[aria-live="polite"].sr-only');
        expect(live).toBeEmptyDOMElement();
        type('Second');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        expect(live).toHaveTextContent('Message queued: Second');
    });

    test('stays open while an approved action runs and the model goes on', async () => {
        await start(replayRun('confirmation'));
        const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
        await waitFor(() => expect(within(card).getByRole('button', {name: 'Approve'})).toBeEnabled());
        mocks.client.run.mockImplementationOnce(hangingRun);
        fireEvent.click(within(card).getByRole('button', {name: 'Approve'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(box()).toBeEnabled();
        expect(screen.getByText(/your message will be sent once it ends/)).toBeInTheDocument();
        type('Then check it');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        expect(within(queued()).getByText('Then check it')).toBeInTheDocument();
        // No stop: the action runs on the daemon, a stop would not cancel it.
        expect(screen.queryByRole('button', {name: 'Stop'})).not.toBeInTheDocument();
    });

    test('closes the replacement asked when the message queued went meanwhile, keeping what is typed', async () => {
        let end;
        await start((_id, _input, {onEvent}) =>
            new Promise((resolve) => {
                onEvent({type: 'RUN_STARTED', at: 1000});
                end = () => resolve({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-1', tokens: null});
            })
        );
        type('Second');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        type('Third');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        await screen.findByRole('dialog', {name: 'Replace the queued message'});
        mocks.client.run.mockImplementationOnce(hangingRun);
        end();
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(mocks.client.run.mock.calls[1][1].prompt).toBe('Second');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(box()).toHaveValue('Third');
    });

    test('stays open while the turn runs, and queues the message with Enter', async () => {
        await start();
        expect(box()).toBeEnabled();
        expect(screen.getByText(/your message will be sent once it ends/)).toBeInTheDocument();
        type('Second');
        expect(fireEvent.keyDown(box(), {key: 'Enter'})).toBe(false);
        expect(within(queued()).getByText('Second')).toHaveAttribute('title', 'Second');
        expect(box()).toHaveValue('');
        expect(box()).toHaveFocus();
        expect(screen.getByRole('button', {name: 'Queue'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Stop'})).toBeInTheDocument();
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
    });

    test('gives the message back to edit, never over what is typed, and removes it', async () => {
        await start();
        type('Second');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        type('Typing');
        expect(within(queued()).getByRole('button', {name: 'Edit'})).toBeDisabled();
        type('');
        fireEvent.click(within(queued()).getByRole('button', {name: 'Edit'}));
        expect(box()).toHaveValue('Second');
        expect(queued()).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        fireEvent.click(within(queued()).getByRole('button', {name: 'Remove'}));
        expect(queued()).toBeNull();
    });

    test('asks before replacing the message queued', async () => {
        const {container} = await start();
        type('Second');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        type('Second, rather');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        const dialog = await screen.findByRole('dialog', {name: 'Replace the queued message'});
        expect((await axe(container)).violations).toHaveLength(0);
        fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
        expect(within(queued()).getByText('Second')).toBeInTheDocument();
        expect(box()).toHaveValue('Second, rather');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {name: 'Replace'}));
        expect(within(queued()).getByText('Second, rather')).toBeInTheDocument();
        expect(box()).toHaveValue('');
    });

    test('waits for the decision on a confirmation, the card saying so', async () => {
        await start(replayRun('confirmation'));
        const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
        await waitFor(() => expect(within(card).getByRole('button', {name: 'Reject'})).toBeEnabled());
        expect(box()).toBeEnabled();
        expect(screen.getByText(/it does not answer the confirmation/)).toBeInTheDocument();
        type('Then check it');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        expect(within(card).getByText('A message is queued: it will be sent after your decision.')).toBeInTheDocument();
        expect(within(card).getByRole('button', {name: 'Approve'})).toBeEnabled();
        expect(within(card).getByRole('button', {name: 'Reject'})).toBeEnabled();
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
    });

    test('stays after a stop, sent again on demand, and comes back into the box of another conversation', async () => {
        const {container} = await start();
        type('Second');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        fireEvent.click(screen.getByRole('button', {name: 'Stop'}));
        await screen.findByText(/Incomplete response — stopped/);
        // Nothing goes alone: the box sends what is typed, the chip what is queued.
        expect(screen.getByRole('button', {name: 'Send'})).toBeInTheDocument();
        expect(within(queued()).getByRole('button', {name: 'Send again'})).toBeEnabled();
        expect((await axe(container)).violations).toHaveLength(0);
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        // Once the conversation is there, its history read, not in between.
        await waitFor(() => expect(mocks.client.getMessages).toHaveBeenCalledWith('existing', expect.anything()));
        await waitFor(() => expect(screen.getByRole('heading', {name: 'Previous diagnostic'})).toBeInTheDocument());
        await waitFor(() => expect(screen.getByRole('button', {name: 'Previous diagnostic'})).toBeEnabled());
        expect(box()).toHaveValue('Second');
        expect(queued()).toBeNull();
    });

    test('sends the queued message again when the user asks it, after a stop', async () => {
        await start();
        type('Second');
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        fireEvent.click(screen.getByRole('button', {name: 'Stop'}));
        await screen.findByText(/Incomplete response — stopped/);
        mocks.client.run.mockImplementationOnce(replayRun('text_and_tools'));
        fireEvent.click(within(queued()).getByRole('button', {name: 'Send again'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(mocks.client.run.mock.calls[1][1].prompt).toBe('Second');
        expect(queued()).toBeNull();
    });
});
