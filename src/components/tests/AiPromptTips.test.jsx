import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {axe} from 'vitest-axe';
import AiChat from '../AiChat.jsx';

const mocks = vi.hoisted(() => ({auth: null, client: null, ready: true}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
vi.mock('../../hooks/useFetchDaemonStatus.jsx', () => ({
    default: () => ({clusterId: 'cluster-id', clusterName: 'Lab cluster', fetchNodes: vi.fn(), loading: false, error: ''}),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({client: mocks.client, enabled: true, ready: mocks.ready, configurationError: null}),
}));

const existing = {id: 'existing', title: 'Previous diagnostic'};
const answered = [
    {id: 'turn-1:1', turn_id: 'turn-1', role: 'user', text: 'How many nodes?', created_at: '2026-10-26T10:00:00Z'},
    {id: 'turn-1:2', turn_id: 'turn-1', role: 'assistant', text: 'Two nodes.', created_at: '2026-10-26T10:00:01Z'},
];

describe('the tips for writing a request', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.ready = true;
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: ''}),
            getConversation: vi.fn().mockResolvedValue(existing),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn().mockResolvedValue({messages: answered, next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(),
        };
    });
    const open = async () => {
        const view = render(
            <MemoryRouter>
                <AiChat/>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        return view;
    };
    const tips = () => screen.queryByRole('region', {name: 'Writing a good request'});

    test('greet an empty conversation, and leave one that has messages', async () => {
        const {container} = await open();
        expect(within(tips()).getByRole('list', {name: 'Writing a good request'}).children).toHaveLength(6);
        expect(tips()).toHaveTextContent('Name the target: the full path of the object');
        expect((await axe(container)).violations).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        await screen.findByText('Two nodes.');
        expect(tips()).toBeNull();
    });

    test('open from the header at any time, in a dialog', async () => {
        await open();
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        await screen.findByText('Two nodes.');
        fireEvent.click(screen.getByRole('button', {name: 'Tips for writing a request'}));
        const dialog = screen.getByRole('dialog', {name: 'Writing a good request'});
        expect(within(dialog).getByText('One action at a time.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Close'}));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    test('close the tools with the session, and do not open them again with the next', async () => {
        mocks.client.listTools = vi.fn(() => new Promise(() => {}));
        const view = await open();
        fireEvent.click(screen.getByRole('button', {name: 'What the assistant can do'}));
        expect(screen.getByRole('dialog', {name: 'What the assistant can do'})).toBeInTheDocument();
        const rerender = () => view.rerender(
            <MemoryRouter>
                <AiChat/>
            </MemoryRouter>
        );
        mocks.ready = false;
        rerender();
        expect(screen.queryByRole('dialog')).toBeNull();
        mocks.ready = true;
        rerender();
        await waitFor(() => expect(screen.getByRole('button', {name: 'What the assistant can do'})).toBeEnabled());
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
