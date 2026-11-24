import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import AiChat from '../AiChat.jsx';
import {MemoryRouter} from 'react-router-dom';
import {AiChatProvider} from '../../context/AiChatProvider.jsx';
import {AiAgentError} from '../../services/ai-agent.js';

const ChatWrapper = ({children}) => (
    <MemoryRouter initialEntries={['/ai']}>
        <AiChatProvider>{children}</AiChatProvider>
    </MemoryRouter>
);

const mocks = vi.hoisted(() => ({auth: null, client: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
vi.mock('../../hooks/useClusterConfig.js', () => ({
    default: () => ({clusterId: 'cluster-id', clusterName: 'Lab cluster', agentUrl: 'https://agent.example.com:8090', loaded: true}),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({client: mocks.client, enabled: true, openid: true, ready: true, configurationError: null}),
}));

const models = [
    {id: 'default', label: 'Claude Haiku', default: true, ready: true},
    {id: 'luna', label: 'GPT Luna', default: false, ready: true},
    {id: 'small', label: 'Mistral Small 4', default: false, ready: false},
];

describe('AI chatbot models', () => {
    beforeEach(() => {
        localStorage.clear();
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: 'New'}),
            getConversation: vi.fn().mockResolvedValue({id: 'new', title: 'New'}),
            getConversationState: vi.fn(),
            getMessages: vi.fn(),
            getCapabilities: vi.fn().mockResolvedValue({feedback: true, models: true}),
            listModels: vi.fn().mockResolvedValue(models),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(async () => ({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-live', tokens: null})),
        };
    });
    afterEach(() => localStorage.clear());
    const renderReady = async () => {
        render(<AiChat />, {wrapper: ChatWrapper});
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
    };
    const send = (text) => {
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: text}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
    };

    test('offers the models beside the message box, one the user cannot run on shown only', async () => {
        await renderReady();
        const select = await screen.findByRole('combobox', {name: 'Model'});
        expect(select).toHaveValue('default');
        const options = within(select).getAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual(['Claude Haiku', 'GPT Luna', 'Mistral Small 4']);
        expect(options[2]).toBeDisabled();
    });
    test('sends the message on the model chosen', async () => {
        await renderReady();
        fireEvent.change(await screen.findByRole('combobox', {name: 'Model'}), {target: {value: 'luna'}});
        send('How many nodes?');
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        expect(mocks.client.run.mock.calls[0][1]).toMatchObject({prompt: 'How many nodes?', model: 'luna'});
    });
    test('offers no choice when the agent offers none', async () => {
        mocks.client.getCapabilities.mockResolvedValue({feedback: true, models: false});
        await renderReady();
        await waitFor(() => expect(mocks.client.getCapabilities).toHaveBeenCalled());
        expect(screen.queryByRole('combobox', {name: 'Model'})).not.toBeInTheDocument();
    });
    test('queues a message refused for a model the agent no longer offers, the box left as typed, and sends it again on the default', async () => {
        await renderReady();
        fireEvent.change(await screen.findByRole('combobox', {name: 'Model'}), {target: {value: 'luna'}});
        // Refused once the conversation is on display, as over a network.
        mocks.client.run.mockImplementationOnce(
            () =>
                new Promise((_ok, ko) =>
                    setTimeout(() => ko(new AiAgentError('model_unknown', 'This model is no longer available: the default model is selected. Send your message again.', 400)), 20)
                )
        );
        mocks.client.listModels.mockResolvedValue([models[0], models[1]]);
        send('How many nodes?');
        expect(await screen.findByText('This model is no longer available: the default model is selected. Send your message again.')).toBeInTheDocument();
        const queued = await screen.findByRole('group', {name: 'Queued message'});
        expect(within(queued).getByText('How many nodes?')).toBeInTheDocument();
        // The user typed meanwhile: what they typed stays.
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'draft'}});
        await waitFor(() => expect(screen.getByRole('combobox', {name: 'Model'})).toHaveValue('default'));
        fireEvent.click(within(queued).getByRole('button', {name: 'Send again'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(mocks.client.run.mock.calls[1][1]).toMatchObject({prompt: 'How many nodes?', model: 'default'});
        expect(screen.getByRole('textbox', {name: 'Message'})).toHaveValue('draft');
    });
    test('sends again a message queued then stopped on the model it was queued with', async () => {
        await renderReady();
        let end;
        mocks.client.run.mockImplementationOnce(() => new Promise((_ok, ko) => (end = () => ko(new AiAgentError('http_error', 'Agent busy. Try again later.', 429)))));
        send('first');
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        fireEvent.change(screen.getByRole('combobox', {name: 'Model'}), {target: {value: 'luna'}});
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'second'}});
        fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
        fireEvent.change(screen.getByRole('combobox', {name: 'Model'}), {target: {value: 'default'}});
        end();
        const queued = await screen.findByRole('group', {name: 'Queued message'});
        fireEvent.click(within(queued).getByRole('button', {name: 'Send again'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(mocks.client.run.mock.calls[1][1]).toMatchObject({prompt: 'second', model: 'luna'});
    });
});
