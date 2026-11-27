import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {axe} from 'vitest-axe';
import AiChat from '../AiChat.jsx';
import {MemoryRouter} from 'react-router-dom';
import {AiChatProvider} from '../../context/AiChatProvider.jsx';

// The provider reads the page under the dock: the application mounts it in its
// router. The page of the assistant has none under it.
const ChatWrapper = ({children}) => (
    <MemoryRouter initialEntries={['/ai']}>
        <AiChatProvider>{children}</AiChatProvider>
    </MemoryRouter>
);
import {AiAgentError} from '../../services/ai-agent.js';

const mocks = vi.hoisted(() => ({
    auth: null,
    client: null,
    enabled: true,
    clusterId: 'cluster-id',
}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
// The configuration of the cluster, as the event stream of the menu keeps it:
// the page reads no cluster status.
vi.mock('../../hooks/useClusterConfig.js', () => ({
    default: () => ({
        clusterId: mocks.clusterId,
        clusterName: 'Lab cluster',
        agentUrl: 'https://agent.example.com:8090',
        loaded: Boolean(mocks.clusterId),
    }),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({
        client: mocks.client,
        enabled: mocks.enabled,
        openid: mocks.auth.authChoice === 'openid',
        ready: mocks.enabled && mocks.auth.authChoice === 'openid' && Boolean(mocks.auth.accessToken && mocks.clusterId),
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



const skills = [
    {name: 'morning-check', description: 'Check the cluster in the morning.'},
    {name: 'node-maintenance', description: 'Reboot a node.'},
    {name: 'drain-a-node', description: 'Drain a node before its maintenance.'},
    {name: 'node', description: 'Read a node.'},
];

// A run the test ends when it wants: the first one a turn, held.
const heldRun = () => {
    let finish;
    const run = vi.fn((_id, _input, {onEvent}) => new Promise((resolve) => {
        finish = () => {
            for (const event of text('Done.', 'turn-9:4')) onEvent(event);
            resolve(completed(12));
        };
    }));
    return {run, finish: () => finish()};
};

describe('the skills of the assistant, asked with /', () => {
    afterEach(() => {
        delete window.matchMedia;
    });
    beforeEach(() => {
        localStorage.removeItem('om3.ai.conversations');
        localStorage.removeItem('om3.ai.model');
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
            newId: vi.fn(() => 'prompt-1'),
            getCapabilities: vi.fn().mockResolvedValue({feedback: false, models: false, skills: true}),
            listSkills: vi.fn().mockResolvedValue(skills),
            run: vi.fn(async (_id, _input, {onEvent}) => {
                for (const event of text('Done.', 'turn-9:4')) onEvent(event);
                return completed(12);
            }),
        };
    });
    const box = () => screen.getByRole('textbox', {name: 'Message'});
    const renderReady = async () => {
        const view = render(<AiChat/>, {wrapper: ChatWrapper});
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        await waitFor(() => expect(mocks.client.listSkills).toHaveBeenCalled());
        return view;
    };
    const list = () => screen.queryByRole('listbox', {name: 'Procedures matching what you type'});
    // The names of the options, in their order.
    const names = () => within(list()).getAllByRole('option').map((option) => option.querySelector('.font-mono').textContent);
    const tag = (name) => screen.queryByRole('button', {name: `Remove the procedure “${name}”`});
    const sent = (index = 0) => mocks.client.run.mock.calls[index][1];

    test('a / at the start lists the skills, the one named whole first, then those beginning with it, and Enter chooses one', async () => {
        const {container} = await renderReady();
        expect(screen.getByText(/Type \/ at the start to follow a procedure/)).toBeInTheDocument();
        fireEvent.change(box(), {target: {value: '/'}});
        expect(names()).toEqual(['/morning-check', '/node-maintenance', '/drain-a-node', '/node']);
        expect(within(list()).getAllByRole('option')[0]).toHaveTextContent('Check the cluster in the morning.');
        expect((await axe(container)).violations).toHaveLength(0);
        fireEvent.change(box(), {target: {value: '/node'}});
        expect(names()).toEqual(['/node', '/node-maintenance', '/drain-a-node']);
        // In any case, as typed.
        fireEvent.change(box(), {target: {value: '/Mor'}});
        expect(names()).toEqual(['/morning-check']);
        fireEvent.change(box(), {target: {value: '/n'}});
        expect(names()).toEqual(['/node-maintenance', '/node', '/morning-check', '/drain-a-node']);
        expect(box()).not.toHaveAttribute('aria-expanded');
        fireEvent.keyDown(box(), {key: 'ArrowDown'});
        expect(box()).toHaveAttribute('aria-activedescendant', within(list()).getAllByRole('option')[1].id);
        fireEvent.keyDown(box(), {key: 'ArrowUp'});
        fireEvent.keyDown(box(), {key: 'Enter'});
        // Chosen: a tag over the box, told, the box empty, nothing sent yet.
        expect(list()).toBeNull();
        expect(tag('node-maintenance')).toBeInTheDocument();
        expect(screen.getByText('Procedure /node-maintenance chosen')).toBeInTheDocument();
        expect(box()).toHaveValue('');
        expect(mocks.client.run).not.toHaveBeenCalled();
        // Sent without words: the message is the skill named.
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        expect(sent()).toMatchObject({prompt: '/node-maintenance', skill: 'node-maintenance'});
        await screen.findByText('Done.');
        expect(tag('node-maintenance')).toBeNull();
    });

    test('the words typed after the skill are the message, a click or Tab choosing it, not Shift+Tab', async () => {
        await renderReady();
        fireEvent.change(box(), {target: {value: '/mor'}});
        fireEvent.click(within(list()).getAllByRole('option')[0]);
        fireEvent.change(box(), {target: {value: 'and tell me the frozen nodes'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        expect(sent()).toMatchObject({prompt: 'and tell me the frozen nodes', skill: 'morning-check'});
        await screen.findByText('Done.');
        fireEvent.change(box(), {target: {value: '/drain'}});
        fireEvent.keyDown(box(), {key: 'Tab', shiftKey: true});
        expect(tag('drain-a-node')).toBeNull();
        fireEvent.keyDown(box(), {key: 'Tab'});
        expect(tag('drain-a-node')).toBeInTheDocument();
    });

    test('a skill named whole is that skill: then a space, it is chosen; sent as it is, it goes with it', async () => {
        await renderReady();
        fireEvent.change(box(), {target: {value: '/morning-check '}});
        expect(tag('morning-check')).toBeInTheDocument();
        expect(box()).toHaveValue('');
        fireEvent.click(tag('morning-check'));
        fireEvent.change(box(), {target: {value: '/node-maintenance'}});
        fireEvent.keyDown(box(), {key: 'Escape'});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        expect(sent()).toMatchObject({prompt: '/node-maintenance', skill: 'node-maintenance'});
    });

    test('Escape or leaving the box closes the list, typing opens it again; a / elsewhere or after a space is text', async () => {
        await renderReady();
        fireEvent.change(box(), {target: {value: '/'}});
        fireEvent.keyDown(box(), {key: 'Escape'});
        expect(list()).toBeNull();
        fireEvent.change(box(), {target: {value: ''}});
        fireEvent.change(box(), {target: {value: '/'}});
        expect(list()).not.toBeNull();
        fireEvent.blur(box());
        expect(list()).toBeNull();
        fireEvent.focus(box());
        expect(list()).not.toBeNull();
        fireEvent.change(box(), {target: {value: 'is /etc/hosts full?'}});
        expect(list()).toBeNull();
        fireEvent.change(box(), {target: {value: '/etc/hosts is full'}});
        expect(list()).toBeNull();
        fireEvent.keyDown(box(), {key: 'Enter'});
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        expect(sent().skill).toBeUndefined();
        expect(sent().prompt).toBe('/etc/hosts is full');
    });

    test('the tag goes by its button, or Backspace in an empty box, not a Backspace held', async () => {
        await renderReady();
        fireEvent.change(box(), {target: {value: '/node-m'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        fireEvent.click(tag('node-maintenance'));
        expect(tag('node-maintenance')).toBeNull();
        fireEvent.change(box(), {target: {value: '/node-m'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        fireEvent.keyDown(box(), {key: 'Backspace', repeat: true});
        expect(tag('node-maintenance')).toBeInTheDocument();
        fireEvent.keyDown(box(), {key: 'Backspace'});
        expect(tag('node-maintenance')).toBeNull();
    });

    test('a message queued keeps its skill apart: shown, sent with it once released, taken back as a tag', async () => {
        const held = heldRun();
        mocks.client.run = held.run;
        await renderReady();
        fireEvent.change(box(), {target: {value: 'first'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(1));
        // The skill alone, queued: shown, and taken back as a tag, the box empty.
        fireEvent.change(box(), {target: {value: '/node-m'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        fireEvent.keyDown(box(), {key: 'Enter'});
        const queued = screen.getByRole('group', {name: 'Queued message'});
        expect(queued).toHaveTextContent('/node-maintenance');
        fireEvent.click(within(queued).getByRole('button', {name: 'Edit'}));
        expect(box()).toHaveValue('');
        expect(tag('node-maintenance')).toBeInTheDocument();
        // With words, queued again, and released with the turn.
        fireEvent.change(box(), {target: {value: 'on n1'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        expect(screen.getByRole('group', {name: 'Queued message'})).toHaveTextContent('/node-maintenanceon n1');
        await act(async () => held.finish());
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(sent(1)).toMatchObject({prompt: 'on n1', skill: 'node-maintenance'});
    });

    test('a model no longer offered queues the message again with its skill', async () => {
        mocks.client.getCapabilities.mockResolvedValue({feedback: false, models: true, skills: true});
        mocks.client.listModels = vi.fn().mockResolvedValue([
            {id: 'default', label: 'GPT Luna', default: true, ready: true},
            {id: 'haiku', label: 'Claude Haiku', default: false, ready: true},
        ]);
        // Refused once the conversation is on display, as over a network.
        mocks.client.run.mockImplementationOnce(
            () => new Promise((_ok, ko) => setTimeout(() => ko(new AiAgentError('model_unknown', 'This model is no longer available: the default model is selected. Send your message again.', 400)), 20))
        );
        await renderReady();
        await waitFor(() => expect(screen.getByRole('combobox', {name: 'Model'})).toBeInTheDocument());
        fireEvent.change(box(), {target: {value: '/node-m'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        fireEvent.change(box(), {target: {value: 'on n1'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        const queued = await screen.findByRole('group', {name: 'Queued message'});
        expect(queued).toHaveTextContent('/node-maintenanceon n1');
        fireEvent.click(within(queued).getByRole('button', {name: 'Send again'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(sent(1)).toMatchObject({prompt: 'on n1', skill: 'node-maintenance'});
    });

    test('a skill no longer served: its step failed, the list read again, the words queued without it', async () => {
        mocks.client.run.mockImplementationOnce(async (_id, _input, {onEvent}) => {
            // An agent of before tells no error of its own tools.
            onEvent({type: 'TOOL_CALL_START', toolCallId: 'call_skill_1', toolCallName: 'load_skill', parentMessageId: 'turn-9:2'});
            onEvent({type: 'TOOL_CALL_ARGS', toolCallId: 'call_skill_1', delta: '{"skill":"morning-check"}'});
            onEvent({type: 'TOOL_CALL_END', toolCallId: 'call_skill_1'});
            onEvent({type: 'TOOL_CALL_RESULT', toolCallId: 'call_skill_1', rejected: false, structured: false});
            // Failed once the conversation is on display, as over a network.
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw new AiAgentError('skill_unavailable', 'This procedure is not available to you now: choose another, or send your message without it.');
        });
        await renderReady();
        fireEvent.change(box(), {target: {value: '/morning'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        fireEvent.change(box(), {target: {value: 'tell me the frozen nodes'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        expect(await screen.findByText(/This procedure is not available to you now/)).toBeInTheDocument();
        await waitFor(() => expect(mocks.client.listSkills).toHaveBeenCalledTimes(2));
        const log = screen.getByRole('log');
        expect(log).not.toHaveTextContent(/load_skill · done/);
        expect(screen.getByRole('group', {name: 'Queued message'})).toHaveTextContent('tell me the frozen nodes');
        expect(screen.getByRole('group', {name: 'Queued message'})).not.toHaveTextContent('/morning-check');
    });

    test('a skill chosen that the list read again no longer holds goes, said so', async () => {
        await renderReady();
        fireEvent.change(box(), {target: {value: '/node-m'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        mocks.client.listSkills.mockResolvedValue(skills.filter((skill) => skill.name !== 'node-maintenance'));
        mocks.client.run.mockRejectedValueOnce(new AiAgentError('invalid_skill', 'The agent refused the name of this procedure. Choose it again in the list.'));
        fireEvent.change(box(), {target: {value: 'go'}});
        fireEvent.keyDown(box(), {key: 'Enter'});
        await waitFor(() => expect(mocks.client.listSkills).toHaveBeenCalledTimes(2));
        fireEvent.change(box(), {target: {value: '/node-m'}});
        expect(list()).toBeNull();
    });

    test('an agent that serves no skill, or a list that cannot be read or is empty, lists none', async () => {
        mocks.client.getCapabilities.mockResolvedValue({feedback: false, models: false, skills: false});
        const view = render(<AiChat/>, {wrapper: ChatWrapper});
        await waitFor(() => expect(mocks.client.getCapabilities).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        fireEvent.change(box(), {target: {value: '/'}});
        expect(list()).toBeNull();
        expect(mocks.client.listSkills).not.toHaveBeenCalled();
        expect(screen.queryByText(/Type \/ at the start/)).toBeNull();
        view.unmount();
        for (const answer of [Promise.reject(new AiAgentError('skills_unavailable', 'The agent could not read its procedures.')), Promise.resolve([])]) {
            answer.catch(() => {});
            mocks.client.getCapabilities.mockResolvedValue({feedback: false, models: false, skills: true});
            mocks.client.listSkills = vi.fn(() => answer);
            const again = render(<AiChat/>, {wrapper: ChatWrapper});
            await waitFor(() => expect(mocks.client.listSkills).toHaveBeenCalled());
            fireEvent.change(box(), {target: {value: '/'}});
            expect(list()).toBeNull();
            expect(screen.queryByText(/Type \/ at the start/)).toBeNull();
            again.unmount();
        }
    });
});
