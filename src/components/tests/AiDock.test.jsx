import React, {useEffect, useState} from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation, useNavigate} from 'react-router-dom';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import AiChat from '../AiChat.jsx';
import AiDock, {AiDockButton} from '../AiDock.jsx';
import AskAssistantLink from '../AskAssistantLink.jsx';
import {AiChatProvider} from '../../context/AiChatProvider.jsx';
import useAddressPrompt from '../../hooks/useAddressPrompt.js';
import {replayRun} from '../../services/tests/agui-fixtures.js';
import {AiAgentError} from '../../services/ai-agent.js';

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
/** A record panel as SlideOver is: not modal, closed by Escape anywhere, inert once closed. */
function RecordPanelStub() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => event.key === 'Escape' && setOpen(false);
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open]);
    return <div role="dialog" aria-modal="false" aria-label="record" inert={!open}>panel</div>;
}

function renderApp({path = '/', withLink = true, withPanel = false} = {}) {
    const tree = () => (
        <MemoryRouter initialEntries={[path]}>
            <AiChatProvider>
                <Routes>
                    <Route path="/" element={<section aria-label="object">{withLink && <AskAssistantLink prompt={question}/>}{withPanel && <RecordPanelStub/>}</section>}/>
                    <Route path="/ai" element={<AiPage/>}/>
                </Routes>
                <AiDockButton/>
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
        // Its button stays, greyed, saying why.
        expect(screen.getByRole('button', {name: 'The assistant is on this page'})).toBeDisabled();
    });

    test('keeps its button greyed until the assistant can be used', async () => {
        mocks.auth = {...mocks.auth, accessToken: ''};
        renderApp({withLink: false});
        const button = await screen.findByRole('button', {name: 'The assistant is not available: see its page'});
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(screen.queryByRole('complementary')).toBeNull();
    });

    test('shows no button where the menu has no entry for the assistant: another session than OpenID', async () => {
        mocks.auth = {...mocks.auth, authChoice: 'basic'};
        renderApp({withLink: false});
        await act(async () => {});
        expect(screen.queryByRole('button', {name: /assistant/i})).toBeNull();
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

    test('opens and folds from its button of the top bar, which it leaves without the focus', async () => {
        renderApp({withLink: false});
        const button = await screen.findByRole('button', {name: 'Open the assistant'});
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        await waitFor(() => expect(dockBox()).toBeEnabled());
        expect(button).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(button);
        await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        await waitFor(() => expect(dockBox()).toBeEnabled());
        // Folded with Escape, it leaves the focus nowhere: the button, which did
        // not open it from a link, is not ringed.
        fireEvent.keyDown(dockBox(), {key: 'Escape'});
        await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
        expect(button).not.toHaveFocus();
    });

    test('moves along the bottom, by its handle, not to hide the page, and remembers where', async () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = (query) => ({matches: query.includes('40rem'), addEventListener() {}, removeEventListener() {}});
        localStorage.removeItem('om3.ai.dock.right');
        try {
            renderApp({withLink: false});
            fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
            const handle = within(dock()).getByRole('button', {name: /^Move the assistant/});
            fireEvent.keyDown(handle, {key: 'ArrowLeft'});
            fireEvent.keyDown(handle, {key: 'ArrowLeft'});
            expect(dock().style.right).toBe('80px');
            expect(localStorage.getItem('om3.ai.dock.right')).toBe('80');
            fireEvent.keyDown(handle, {key: 'ArrowRight'});
            expect(dock().style.right).toBe('48px');
            // Folded and opened again, where the user left it.
            fireEvent.click(screen.getByRole('button', {name: 'Open the assistant'}));
            await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
            fireEvent.click(screen.getByRole('button', {name: 'Open the assistant'}));
            await waitFor(() => expect(dock().style.right).toBe('48px'));
            // Home takes it back to the right.
            fireEvent.keyDown(within(dock()).getByRole('button', {name: /^Move the assistant/}), {key: 'Home'});
            expect(dock().style.right).toBe('');
            expect(localStorage.getItem('om3.ai.dock.right')).toBeNull();
        } finally {
            window.matchMedia = matchMedia;
            localStorage.removeItem('om3.ai.dock.right');
        }
    });

    test('has no handle on a narrow window, where it takes the width', async () => {
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dockBox()).toBeEnabled());
        expect(within(dock()).queryByRole('button', {name: /^Move the assistant/})).toBeNull();
    });

    test('opens with the key a out of a field, as the other shortcuts, and folds with it', async () => {
        renderApp({withLink: false});
        const button = await screen.findByRole('button', {name: 'Open the assistant'});
        fireEvent.keyDown(document.body, {key: 'a'});
        await waitFor(() => expect(dockBox()).toBeEnabled());
        // Typed in the message box, the key is a letter.
        fireEvent.keyDown(dockBox(), {key: 'a'});
        expect(dock()).toBeInTheDocument();
        // With the focus out of a field, it folds the dock.
        button.focus();
        fireEvent.keyDown(button, {key: 'a'});
        await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
        // With Ctrl, the key is the browser's.
        fireEvent.keyDown(document.body, {key: 'a', ctrlKey: true});
        expect(screen.queryByRole('complementary')).toBeNull();
    });

    test('leaves the key a alone on the page of the assistant', async () => {
        renderApp({path: '/ai'});
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        const event = new KeyboardEvent('keydown', {key: 'a', bubbles: true, cancelable: true});
        document.body.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(screen.queryByRole('complementary')).toBeNull();
    });

    test('folds on Escape from the page, once the panel over it is closed', async () => {
        renderApp({withLink: false, withPanel: true});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dockBox()).toBeEnabled());
        // The focus on the page: the first Escape closes the panel, the dock stays.
        act(() => document.activeElement.blur());
        fireEvent.keyDown(document.body, {key: 'Escape'});
        await waitFor(() => expect(screen.getByText('panel').closest('[role="dialog"]')).toHaveAttribute('inert'));
        expect(dock()).toBeInTheDocument();
        // The second folds the dock.
        fireEvent.keyDown(document.body, {key: 'Escape'});
        await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    });

    test('leaves Escape to a field of the page', async () => {
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dockBox()).toBeEnabled());
        const field = document.createElement('input');
        document.body.appendChild(field);
        try {
            field.focus();
            fireEvent.keyDown(field, {key: 'Escape'});
            expect(dock()).toBeInTheDocument();
        } finally {
            field.remove();
        }
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
        expect(within(dock()).getByRole('heading', {name: /^AI assistant$/i})).toHaveFocus();
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

    describe('once a turn ends out of sight', () => {
        // A prompt sent on the page of the assistant, then another page shown.
        const send = async () => {
            renderApp({path: '/ai', withLink: false});
            await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
            fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'hello'}});
            fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        };
        const sendThenLeave = async () => {
            await send();
            await act(async () => navigate('/'));
        };
        // The words of the notice, as the region always there tells them.
        const told = () => document.querySelector('p[role="status"]')?.textContent ?? null;
        const toast = () => screen.queryByRole('button', {name: /^See the (answer|action)$/});

        test('tells it where the dock opens, and opens the dock on its answer', async () => {
            const run = hangingRun();
            await sendThenLeave();
            expect(told()).toBe('');
            await act(async () => run.finish());
            await waitFor(() => expect(told()).toBe('Your analysis is done.'));
            fireEvent.click(screen.getByRole('button', {name: 'See the answer'}));
            expect(within(dock()).getByText('Checking.')).toBeInTheDocument();
            expect(toast()).toBeNull();
        });

        test('is closed by its button or Escape, the focus on the button of the dock, which still tells it', async () => {
            const run = hangingRun();
            await sendThenLeave();
            await act(async () => run.finish());
            await screen.findByRole('button', {name: 'See the answer'});
            fireEvent.click(screen.getByRole('button', {name: 'Dismiss'}));
            expect(toast()).toBeNull();
            expect(told()).toBe('');
            const button = screen.getByRole('button', {name: 'Open the assistant · The assistant has finished'});
            expect(button).toHaveFocus();
        });

        test('is closed by Escape', async () => {
            const run = hangingRun();
            await sendThenLeave();
            await act(async () => run.finish());
            fireEvent.keyDown(await screen.findByRole('button', {name: 'See the answer'}), {key: 'Escape'});
            expect(toast()).toBeNull();
        });

        test('tells an answer that failed, as the button of the dock does', async () => {
            let fail;
            mocks.client.run.mockImplementation(
                (_id, _input, options) =>
                    new Promise((_resolve, reject) => {
                        for (const event of text('Checking.')) options.onEvent(event);
                        fail = () => reject(new AiAgentError('agent_unavailable', 'The agent is unavailable.'));
                    })
            );
            await sendThenLeave();
            await act(async () => fail());
            await waitFor(() => expect(told()).toBe('Your analysis failed: its answer is incomplete.'));
            expect(screen.getByRole('button', {name: 'Open the assistant · The answer of the assistant failed'})).toBeInTheDocument();
        });

        test('tells an action that began to wait out of sight, the dock opening on it, not one seen waiting', async () => {
            let release;
            const gate = new Promise((resolve) => {
                release = resolve;
            });
            const confirmation = replayRun('confirmation');
            mocks.client.run.mockImplementationOnce(async (...args) => {
                await gate;
                return confirmation(...args);
            });
            await sendThenLeave();
            await act(async () => release());
            await waitFor(() => expect(told()).toBe('Your analysis waits for your decision on an action.'));
            fireEvent.click(screen.getByRole('button', {name: 'See the action'}));
            expect(await within(dock()).findByRole('group', {name: 'Action waiting for a decision'})).toBeInTheDocument();
            // Seen, then folded: not told again, the button of the dock still telling it.
            fireEvent.click(within(dock()).getByRole('button', {name: 'Fold'}));
            await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
            expect(toast()).toBeNull();
            expect(screen.getByRole('button', {name: /The action of the assistant waits for your decision|waits for your decision/})).toBeInTheDocument();
        });

        test('tells nothing on the page of the assistant, which shows the answer', async () => {
            const run = hangingRun();
            await send();
            await act(async () => run.finish());
            await screen.findByText('Checking.');
            expect(told()).toBeNull();
            expect(toast()).toBeNull();
        });

        test('says it in the title of a hidden tab, given back once a turn runs again or the tab is shown', async () => {
            let visibility = 'visible';
            const property = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
            try {
                document.title = 'Lab cluster';
                const run = hangingRun();
                await send();
                await screen.findByRole('button', {name: 'Stop'});
                // Another tab: the page of the assistant stays on display there.
                visibility = 'hidden';
                await act(async () => run.finish());
                await waitFor(() => expect(document.title).toBe('✓ Analysis done · Lab cluster'));
                // The next turn: the title is given back while it runs.
                const next = hangingRun();
                fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'again'}});
                fireEvent.click(screen.getByRole('button', {name: 'Send'}));
                await waitFor(() => expect(document.title).toBe('Lab cluster'));
                await act(async () => next.finish());
                await waitFor(() => expect(document.title).toBe('✓ Analysis done · Lab cluster'));
                visibility = 'visible';
                act(() => {
                    document.dispatchEvent(new Event('visibilitychange'));
                });
                expect(document.title).toBe('Lab cluster');
            } finally {
                property.mockRestore();
            }
        });

        test('says nothing in the title of a turn ended by another identity', async () => {
            let visibility = 'visible';
            const property = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
            try {
                document.title = 'Lab cluster';
                hangingRun();
                const view = renderApp({path: '/ai', withLink: false});
                await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
                fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'hello'}});
                fireEvent.click(screen.getByRole('button', {name: 'Send'}));
                await screen.findByRole('button', {name: 'Stop'});
                visibility = 'hidden';
                // Signed out in another tab: the chat starts afresh for the next one.
                mocks.auth = {...mocks.auth, user: 'other'};
                view.rerender();
                await waitFor(() => expect(screen.queryByRole('button', {name: 'Stop'})).toBeNull());
                expect(document.title).toBe('Lab cluster');
            } finally {
                property.mockRestore();
            }
        });
    });
});
