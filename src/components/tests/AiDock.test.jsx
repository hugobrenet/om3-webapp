import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation, useNavigate} from 'react-router-dom';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import AiChat from '../AiChat.jsx';
import AiDock from '../AiDock.jsx';
import AskAssistantLink from '../AskAssistantLink.jsx';
import {AiChatProvider} from '../../context/AiChatProvider.jsx';
import useAddressPrompt from '../../hooks/useAddressPrompt.js';
import {replayRun} from '../../services/tests/agui-fixtures.js';

const mocks = vi.hoisted(() => ({auth: null, client: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth, useAuthSession: () => mocks.auth}));
vi.mock('../../hooks/useClusterConfig.js', () => ({
    default: () => ({clusterId: 'cluster-id', clusterName: 'Lab cluster', agentUrl: 'https://agent.example.com', loaded: true}),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({
        client: mocks.client,
        enabled: true,
        openid: true,
        ready: Boolean(mocks.auth.accessToken),
        configurationError: null,
    }),
}));

const question = 'Analyze why the object prod/svc/web is down.';
const text = (delta, messageId = 'turn-9:2') => [
    {type: 'TEXT_MESSAGE_START', messageId},
    {type: 'TEXT_MESSAGE_CONTENT', messageId, delta},
];
const completed = () => ({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-9', tokens: null});
const existing = {id: 'existing', title: 'Previous diagnostic'};

const dock = () => screen.getByRole('complementary');
const dockBox = () => within(dock()).getByRole('textbox', {name: 'Message'});
const link = () => screen.getByRole('link', {name: 'Analyze with the assistant'});

/** Where the app is, and a way to move, as the menu would. */
let location;
let navigate;
function Probe() {
    location = useLocation();
    navigate = useNavigate();
    return null;
}

/** The page of the assistant, with the question of its address. */
function AiPage() {
    useAddressPrompt();
    return <AiChat/>;
}

/**
 * The application as far as the dock goes: the chat held above the pages, a page
 * with a record and its link to the assistant, the page of the assistant, and
 * the dock over them.
 */
function renderApp({path = '/', withLink = true} = {}) {
    const tree = () => (
        <MemoryRouter initialEntries={[path]}>
            <AiChatProvider>
                <Routes>
                    <Route path="/" element={<section aria-label="object">{withLink && <AskAssistantLink prompt={question}/>}</section>}/>
                    <Route path="/ai" element={<AiPage/>}/>
                </Routes>
                <AiDock/>
                <Probe/>
            </AiChatProvider>
        </MemoryRouter>
    );
    const view = render(tree());
    // Rendered again, as the application after a sign-in or an impersonation.
    return {...view, rerender: () => view.rerender(tree())};
}

/** Another user signed in, the same cluster. */
const signInAs = (user) => {
    mocks.auth = {...mocks.auth, user};
};

/** Asks from the link of the record: the dock opens, the question sent. */
async function openFromRecord() {
    fireEvent.click(await screen.findByRole('link', {name: 'Analyze with the assistant'}));
    await waitFor(() =>
        expect(mocks.client.run).toHaveBeenCalledWith('new', expect.objectContaining({prompt: question}), expect.any(Object))
    );
}

/** A run that streams its start and waits; `finish` ends it. */
function hangingRun() {
    const run = {finish: () => undefined};
    mocks.client.run.mockImplementation(
        (_id, _input, options) =>
            new Promise((resolve) => {
                for (const event of text('Checking.')) options.onEvent(event);
                run.finish = () => resolve(completed());
            })
    );
    return run;
}

describe('the dock of the assistant', () => {
    beforeEach(() => {
        localStorage.removeItem('om3.ai.conversations');
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: 'New diagnostic'}),
            getConversation: vi.fn().mockResolvedValue(existing),
            getConversationState: vi.fn(async () => ({conversation: existing, confirmation: null})),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            cancelAll: vi.fn(),
            run: vi.fn(async (_id, _input, {onEvent}) => {
                for (const event of text('The object is down: fs#1 failed.')) onEvent(event);
                return completed();
            }),
        };
    });

    test('sends the question of the record at once, and answers in the dock over it', async () => {
        renderApp();
        await openFromRecord();
        expect(location.pathname).toBe('/');
        expect(screen.getByRole('region', {name: 'object'})).toBeInTheDocument();
        expect(await within(dock()).findByText('The object is down: fs#1 failed.')).toBeInTheDocument();
        expect(within(dock()).getByText(question)).toBeInTheDocument();
        // A new conversation, the agent creating it with the first turn.
        expect(mocks.client.createConversation).toHaveBeenCalledTimes(1);
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
        expect(dockBox()).toHaveValue('');
    });

    test('sends it on a new conversation, the one shown left, as its message box', async () => {
        renderApp();
        await openFromRecord();
        await within(dock()).findByText('The object is down: fs#1 failed.');
        fireEvent.change(dockBox(), {target: {value: 'a draft'}});
        mocks.client.createConversation.mockResolvedValueOnce({id: 'second', title: ''});
        fireEvent.click(link());
        await waitFor(() =>
            expect(mocks.client.run).toHaveBeenLastCalledWith('second', expect.objectContaining({prompt: question}), expect.any(Object))
        );
        expect(mocks.client.createConversation).toHaveBeenCalledTimes(2);
        // What was typed for the conversation left went with it, as on any change of conversation.
        expect(dockBox()).toHaveValue('');
    });

    test('leaves a click with a modifier to the link', async () => {
        renderApp();
        // The browser would open the link in another tab; jsdom cannot.
        const leave = (event) => event.preventDefault();
        document.addEventListener('click', leave);
        fireEvent.click(await screen.findByRole('link', {name: 'Analyze with the assistant'}), {ctrlKey: true});
        document.removeEventListener('click', leave);
        expect(screen.queryByRole('complementary')).toBeNull();
        expect(location.pathname).toBe('/');
    });

    test('drops a question asked while a turn runs, and says so', async () => {
        const run = hangingRun();
        renderApp();
        await openFromRecord();
        await within(dock()).findByRole('button', {name: 'Stop'});
        fireEvent.change(dockBox(), {target: {value: 'typed meanwhile'}});
        fireEvent.click(link());
        expect(await within(dock()).findByText(/The question prepared was not taken/)).toBeInTheDocument();
        expect(dockBox()).toHaveValue('typed meanwhile');
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
        await act(async () => run.finish());
    });

    test('goes on with a turn while the page of the assistant is left', async () => {
        const run = hangingRun();
        renderApp({path: '/ai'});
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'hello'}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await screen.findByRole('button', {name: 'Stop'});
        await act(async () => navigate('/'));
        // Folded, the dock tells the turn runs, and then that it ended.
        expect(await screen.findByRole('button', {name: 'Open the assistant · The assistant is answering'})).toBeInTheDocument();
        await act(async () => run.finish());
        expect(await screen.findByRole('button', {name: 'Open the assistant · The assistant has finished'})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Open the assistant · The assistant has finished'}));
        expect(within(dock()).getByText('Checking.')).toBeInTheDocument();
        expect(mocks.client.run).toHaveBeenCalledTimes(1);
    });

    test('is not shown on the page of the assistant', async () => {
        renderApp({path: '/ai'});
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        expect(screen.queryByRole('complementary')).toBeNull();
        expect(screen.queryByRole('button', {name: /^Open the assistant/})).toBeNull();
    });

    test('expands to the page, the conversation and the message typed kept', async () => {
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dockBox()).toBeEnabled());
        fireEvent.change(dockBox(), {target: {value: `${question} Since when?`}});
        fireEvent.click(within(dock()).getByRole('button', {name: 'Open in the assistant page'}));
        await waitFor(() => expect(location.pathname).toBe('/ai'));
        expect(screen.queryByRole('complementary')).toBeNull();
        await waitFor(() =>
            expect(screen.getByRole('textbox', {name: 'Message'})).toHaveValue(`${question} Since when?`)
        );
        // The same chat: nothing read again, nothing sent.
        expect(mocks.client.listConversations).toHaveBeenCalledTimes(1);
        expect(mocks.client.run).not.toHaveBeenCalled();
        // A move, not an end: back on another page, the dock is there, folded.
        await act(async () => navigate('/'));
        expect(await screen.findByRole('button', {name: 'Open the assistant'})).toBeInTheDocument();
    });

    test('names an action waiting, to reject or to decide on the page, never to approve', async () => {
        mocks.client.run.mockImplementationOnce(replayRun('confirmation'));
        renderApp();
        await openFromRecord();
        const waiting = await within(dock()).findByRole('group', {name: 'Action waiting for a decision'});
        expect(within(waiting).getByRole('button', {name: 'See the details to decide'})).toBeInTheDocument();
        await waitFor(() => expect(within(waiting).getByRole('button', {name: 'Reject'})).toBeEnabled());
        expect(within(dock()).queryByRole('button', {name: /Approve/})).toBeNull();
    });

    test('folds on Escape, the focus back on the link that opened it', async () => {
        renderApp();
        await openFromRecord();
        fireEvent.keyDown(dockBox(), {key: 'Escape'});
        await waitFor(() => expect(link()).toHaveFocus());
        expect(screen.queryByRole('complementary')).toBeNull();
        expect(screen.getByRole('button', {name: 'Open the assistant'})).toBeInTheDocument();
    });

    test('starts a new conversation without asking the agent for one', async () => {
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dockBox()).toBeEnabled());
        fireEvent.change(dockBox(), {target: {value: 'hello'}});
        fireEvent.click(within(dock()).getByRole('button', {name: 'Send'}));
        await within(dock()).findByText('The object is down: fs#1 failed.');
        fireEvent.click(within(dock()).getByRole('button', {name: 'New conversation'}));
        await waitFor(() => expect(within(dock()).queryByText('The object is down: fs#1 failed.')).toBeNull());
        expect(within(dock()).getByRole('button', {name: 'New conversation'})).toBeDisabled();
        expect(mocks.client.createConversation).toHaveBeenCalledTimes(1);
    });

    test('reads nothing of the chat until it opens', async () => {
        renderApp({withLink: false});
        await screen.findByRole('button', {name: 'Open the assistant'});
        expect(mocks.client.listConversations).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(mocks.client.listConversations).toHaveBeenCalledTimes(1));
    });

    test('opened while the chat is read, takes the focus, then gives it to the message box', async () => {
        let listed = () => undefined;
        mocks.client.listConversations.mockImplementation(() => new Promise((resolve) => (listed = resolve)));
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        expect(within(dock()).getByRole('heading', {name: 'AI Assistant'})).toHaveFocus();
        await act(async () => listed([]));
        await waitFor(() => expect(dockBox()).toHaveFocus());
    });

    test('a question in the address goes in the box of the page, then leaves the address', async () => {
        renderApp({path: `/ai?${new URLSearchParams({prompt: question, tab: 'x'})}`});
        await waitFor(() => expect(screen.getByRole('textbox', {name: 'Message'})).toHaveValue(question));
        expect(new URLSearchParams(location.search).get('prompt')).toBeNull();
        expect(new URLSearchParams(location.search).get('tab')).toBe('x');
        expect(mocks.client.run).not.toHaveBeenCalled();
    });

    describe('another identity', () => {
        test('folds the dock, the conversations of the new one read once a view opens', async () => {
            const view = renderApp({withLink: false});
            fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
            await waitFor(() => expect(mocks.client.listConversations).toHaveBeenCalledTimes(1));
            signInAs('alice');
            await act(async () => view.rerender());
            expect(await screen.findByRole('button', {name: 'Open the assistant'})).toBeInTheDocument();
            expect(screen.queryByRole('complementary')).toBeNull();
            // Nothing read for alice while no view shows the chat.
            await act(async () => Promise.resolve());
            expect(mocks.client.listConversations).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByRole('button', {name: 'Open the assistant'}));
            await waitFor(() => expect(mocks.client.listConversations).toHaveBeenCalledTimes(2));
        });

        test('reads the conversations of the new one on the page of the assistant', async () => {
            const view = renderApp({path: '/ai'});
            await waitFor(() => expect(mocks.client.listConversations).toHaveBeenCalledTimes(1));
            signInAs('alice');
            await act(async () => view.rerender());
            await waitFor(() => expect(mocks.client.listConversations).toHaveBeenCalledTimes(2));
            await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        });

        test('does not tell the new one that the turn of the former ended', async () => {
            mocks.client.run.mockImplementation(
                (_id, _input, options) =>
                    new Promise((_resolve, reject) => {
                        for (const event of text('Checking.')) options.onEvent(event);
                        options.signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), {once: true});
                    })
            );
            const view = renderApp();
            await openFromRecord();
            await within(dock()).findByRole('button', {name: 'Stop'});
            fireEvent.click(within(dock()).getByRole('button', {name: 'Fold'}));
            await screen.findByRole('button', {name: 'Open the assistant · The assistant is answering'});
            signInAs('alice');
            await act(async () => view.rerender());
            expect(await screen.findByRole('button', {name: 'Open the assistant'})).toBeInTheDocument();
            expect(screen.queryByTestId('dock-activity')).toBeNull();
        });
    });
});
