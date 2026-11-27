import React, {useEffect, useMemo, useState} from 'react';
import {act, fireEvent, render, renderHook, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation, useNavigate} from 'react-router-dom';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import AiChat from '../AiChat.jsx';
import AiDock, {AiDockButton} from '../AiDock.jsx';
import AskAssistantLink from '../AskAssistantLink.jsx';
import {AiChatProvider} from '../../context/AiChatProvider.jsx';
import {useShareListFilters} from '../../app/list-filters';
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

// jsdom has no PointerEvent: a mouse event with the id of its pointer, for the dock dragged.
if (typeof window.PointerEvent === 'undefined') {
    window.PointerEvent = class PointerEvent extends MouseEvent {
        constructor(type, init = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 0;
        }
    };
}

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

    test('Escape closes the list of the skills, the dock staying open; the tag chosen goes with the draft to the page', async () => {
        mocks.client.getCapabilities = vi.fn().mockResolvedValue({feedback: false, models: false, skills: true});
        mocks.client.listSkills = vi.fn().mockResolvedValue([{name: 'morning-check', description: 'Check the cluster in the morning.'}]);
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dockBox()).toBeEnabled());
        await waitFor(() => expect(mocks.client.listSkills).toHaveBeenCalled());
        fireEvent.change(dockBox(), {target: {value: '/mor'}});
        expect(within(dock()).getByRole('listbox')).toBeInTheDocument();
        fireEvent.keyDown(dockBox(), {key: 'Escape'});
        expect(within(dock()).queryByRole('listbox')).toBeNull();
        expect(dock()).toBeInTheDocument();
        fireEvent.change(dockBox(), {target: {value: '/morning-check '}});
        expect(within(dock()).getByRole('button', {name: 'Remove the procedure “morning-check”'})).toBeInTheDocument();
        // To the page of the assistant: the tag goes with the draft.
        fireEvent.click(within(dock()).getByRole('button', {name: 'Open in the assistant page'}));
        expect(await screen.findByRole('button', {name: 'Remove the procedure “morning-check”'})).toBeInTheDocument();
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

    const wideWindow = () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = (query) => ({matches: query.includes('40rem'), addEventListener() {}, removeEventListener() {}});
        return () => {
            window.matchMedia = matchMedia;
        };
    };
    const geometry = () => JSON.parse(localStorage.getItem('om3.ai.dock.geometry') ?? 'null');
    /** Its own height in the window of jsdom, as its classes say it. */
    const ownHeight = () => Math.min(576, window.innerHeight - 96);
    /** Drags `element` from x, y by dx, dy, as a pointer pressed, moved and released. */
    const dragBy = (element, [x, y], [dx, dy], {pointerId = 1, end = 'pointerUp'} = {}) => {
        fireEvent.pointerDown(element, {button: 0, clientX: x, clientY: y, pointerId});
        fireEvent.pointerMove(element, {clientX: x + dx, clientY: y + dy, pointerId});
        fireEvent[end](element, {clientX: x + dx, clientY: y + dy, pointerId});
    };
    const handle = () => within(dock()).getByRole('button', {name: 'Move or size the assistant'});
    const bar = () => within(dock()).getByRole('heading').parentElement;
    const openWide = async () => {
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        return dock();
    };
    /** A test on a wide window, the place of the dock forgotten before and after. */
    const onWideWindow = (name, body) => test(name, async () => {
        const restore = wideWindow();
        localStorage.removeItem('om3.ai.dock.geometry');
        localStorage.removeItem('om3.ai.dock.right');
        const width = window.innerWidth;
        const height = window.innerHeight;
        try {
            await body();
        } finally {
            restore();
            window.innerWidth = width;
            window.innerHeight = height;
            localStorage.removeItem('om3.ai.dock.geometry');
            localStorage.removeItem('om3.ai.dock.right');
        }
    });

    onWideWindow('moves anywhere and is sized with the keyboard on its handle, and remembers where', async () => {
        await openWide();
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        fireEvent.keyDown(handle(), {key: 'ArrowUp'});
        expect(dock().style.right).toBe('80px');
        expect(dock().style.bottom).toBe('48px');
        expect(geometry()).toEqual({right: 80, bottom: 48, width: null, height: null});
        fireEvent.keyDown(handle(), {key: 'ArrowRight'});
        fireEvent.keyDown(handle(), {key: 'ArrowDown'});
        expect(dock().style.right).toBe('48px');
        expect(dock().style.bottom).toBe('');
        // With Shift, the arrows size it, from its own size, the bottom right staying.
        fireEvent.keyDown(handle(), {key: 'ArrowLeft', shiftKey: true});
        fireEvent.keyDown(handle(), {key: 'ArrowDown', shiftKey: true});
        expect(dock().style.width).toBe('448px');
        expect(dock().style.height).toBe(`${ownHeight() - 32}px`);
        expect(dock().style.right).toBe('48px');
        // Folded and opened again, where the user left it.
        fireEvent.click(screen.getByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
        fireEvent.click(screen.getByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dock().style.right).toBe('48px'));
        expect(dock().style.width).toBe('448px');
        // Home puts it back, at its own place and size.
        fireEvent.keyDown(handle(), {key: 'Home'});
        expect(dock().style.right).toBe('');
        expect(dock().style.width).toBe('');
        expect(localStorage.getItem('om3.ai.dock.geometry')).toBeNull();
    });

    onWideWindow('gives its handle the focus when pressed, for its arrows', async () => {
        await openWide();
        fireEvent.pointerDown(handle(), {button: 0, clientX: 20, clientY: 300, pointerId: 1});
        fireEvent.pointerUp(handle(), {clientX: 20, clientY: 300, pointerId: 1});
        expect(handle()).toHaveFocus();
        fireEvent.keyDown(document.activeElement, {key: 'ArrowLeft'});
        expect(dock().style.right).toBe('48px');
    });

    onWideWindow('moves by its title bar anywhere, against an edge once close to it, never over the top bar, and is put back by a double click', async () => {
        await openWide();
        fireEvent.pointerDown(bar(), {button: 0, clientX: 500, clientY: 500, pointerId: 1});
        fireEvent.pointerMove(bar(), {clientX: 300, clientY: 450, pointerId: 1});
        // While dragged it follows, and nothing is kept until released.
        expect(dock().style.right).toBe('216px');
        expect(dock().style.bottom).toBe('66px');
        expect(localStorage.getItem('om3.ai.dock.geometry')).toBeNull();
        fireEvent.pointerUp(bar(), {clientX: 300, clientY: 450, pointerId: 1});
        expect(geometry()).toEqual({right: 216, bottom: 66, width: null, height: null});
        // Close to the right edge, it goes against it; past the top bar, it stays under it.
        dragBy(bar(), [300, 450], [190, -950]);
        const top = window.innerHeight - ownHeight() - 80;
        expect(geometry()).toMatchObject({right: null, bottom: top});
        fireEvent.doubleClick(bar());
        expect(localStorage.getItem('om3.ai.dock.geometry')).toBeNull();
        expect(dock().style.right).toBe('');
        expect(dock().style.bottom).toBe('');
    });

    onWideWindow('is not moved by a button of its bar, a plain click, another button or another pointer', async () => {
        await openWide();
        dragBy(within(dock()).getByRole('button', {name: 'Fold'}), [300, 400], [-200, -50]);
        expect(dock().style.right).toBe('');
        // A plain click, or a move of less than its threshold, changes nothing, keeps nothing.
        dragBy(bar(), [300, 400], [-3, 2]);
        expect(dock().style.right).toBe('');
        expect(localStorage.getItem('om3.ai.dock.geometry')).toBeNull();
        // The right button does not drag it.
        fireEvent.pointerDown(bar(), {button: 2, clientX: 300, clientY: 400, pointerId: 1});
        fireEvent.pointerMove(bar(), {clientX: 100, clientY: 400, pointerId: 1});
        expect(dock().style.right).toBe('');
        fireEvent.pointerUp(bar(), {clientX: 100, clientY: 400, pointerId: 1});
        // Another pointer moving meanwhile does not move it.
        fireEvent.pointerDown(bar(), {button: 0, clientX: 300, clientY: 400, pointerId: 1});
        fireEvent.pointerMove(bar(), {clientX: 100, clientY: 400, pointerId: 7});
        expect(dock().style.right).toBe('');
        fireEvent.pointerMove(bar(), {clientX: 200, clientY: 400, pointerId: 1});
        expect(dock().style.right).toBe('116px');
        // A drag cancelled keeps it where it was dragged.
        fireEvent.pointerCancel(bar(), {clientX: 200, clientY: 400, pointerId: 1});
        expect(geometry()).toMatchObject({right: 116});
    });

    onWideWindow('is not snapped nor written by a plain click, close to an edge', async () => {
        localStorage.setItem('om3.ai.dock.geometry', JSON.stringify({right: 30, bottom: 30, width: null, height: null}));
        await openWide();
        dragBy(bar(), [300, 400], [2, -3]);
        expect(dock().style.right).toBe('30px');
        expect(geometry()).toEqual({right: 30, bottom: 30, width: null, height: null});
    });

    onWideWindow('is sized by each edge and corner, the opposite ones staying, within its bounds', async () => {
        await openWide();
        const edge = (name) => dock().querySelector(`[data-dock-edge="${name}"]`);
        expect([...dock().querySelectorAll('[data-dock-edge]')].map((element) => element.dataset.dockEdge)).toEqual([
            'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
        ]);
        dragBy(edge('top-left'), [600, 300], [-100, -50]);
        expect(geometry()).toEqual({right: null, bottom: null, width: 516, height: Math.min(ownHeight() + 50, window.innerHeight - 96)});
        // Never smaller than its smallest size.
        dragBy(edge('left'), [500, 300], [1000, 0]);
        expect(geometry().width).toBe(320);
        // Never larger than the window leaves on the side of its edge: the bottom right stays.
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        dragBy(edge('left'), [500, 300], [-2000, 0]);
        expect(geometry()).toMatchObject({right: 80, width: window.innerWidth - 80 - 16});
        dragBy(edge('top'), [500, 300], [0, -2000]);
        expect(geometry().height).toBe(window.innerHeight - 96);
        fireEvent.keyDown(handle(), {key: 'Home'});
        // Its right edge, its left one staying: wider to the right, down to the margin.
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        dragBy(edge('right'), [900, 300], [40, 0]);
        expect(geometry()).toMatchObject({right: 72, width: 416 + 40});
        dragBy(edge('right'), [900, 300], [500, 0]);
        expect(geometry()).toMatchObject({right: null, width: 416 + 96});
        dragBy(edge('right'), [900, 300], [-1000, 0]);
        expect(geometry().width).toBe(320);
        // Its bottom edge, its top one staying: taller to the bottom, down to the margin.
        fireEvent.keyDown(handle(), {key: 'Home'});
        fireEvent.keyDown(handle(), {key: 'ArrowUp'});
        fireEvent.keyDown(handle(), {key: 'ArrowUp'});
        dragBy(edge('bottom'), [500, 700], [0, 30]);
        expect(geometry()).toMatchObject({bottom: 50, height: ownHeight() + 30});
        // Its bottom right corner, both: against the right margin already, taller only.
        dragBy(edge('bottom-right'), [900, 700], [20, 20]);
        expect(geometry()).toEqual({right: null, bottom: 30, width: null, height: ownHeight() + 50});
        // Its top right corner, away from the right margin: wider and taller.
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        dragBy(edge('top-right'), [900, 300], [24, -10]);
        expect(geometry()).toMatchObject({right: 56, width: 416 + 24, height: ownHeight() + 60});
    });

    onWideWindow('keeps what the user chose through a smaller window, and gives it back after', async () => {
        window.innerWidth = 1600;
        window.innerHeight = 1200;
        localStorage.setItem('om3.ai.dock.geometry', JSON.stringify({right: 600, bottom: 300, width: 700, height: 700}));
        await openWide();
        expect(dock().style.width).toBe('700px');
        act(() => {
            window.innerWidth = 1000;
            window.innerHeight = 500;
            window.dispatchEvent(new Event('resize'));
        });
        // Held within the smaller window...
        expect(dock().style.right).toBe('284px');
        expect(dock().style.height).toBe(`${500 - 96}px`);
        act(() => {
            window.innerWidth = 1600;
            window.innerHeight = 1200;
            window.dispatchEvent(new Event('resize'));
        });
        // ...and given back as chosen, nothing written meanwhile.
        expect(dock().style.right).toBe('600px');
        expect(dock().style.bottom).toBe('300px');
        expect(dock().style.height).toBe('700px');
        expect(geometry()).toEqual({right: 600, bottom: 300, width: 700, height: 700});
    });

    onWideWindow('reads where an older version moved it, along the bottom, and keeps it under its own key', async () => {
        localStorage.setItem('om3.ai.dock.right', '120');
        await openWide();
        await waitFor(() => expect(dock().style.right).toBe('120px'));
        expect(localStorage.getItem('om3.ai.dock.right')).toBeNull();
        expect(geometry()).toMatchObject({right: 120});
    });

    onWideWindow('takes a place the browser kept broken as none', async () => {
        for (const kept of ['not json', '"x"', '[1,2]', '42', '{"right":"a","bottom":"b","width":-5,"height":1e999}', '{"enlarged":true}']) {
            localStorage.setItem('om3.ai.dock.geometry', kept);
            const view = renderApp({withLink: false});
            fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
            expect(dock().style.right).toBe('');
            expect(dock().style.bottom).toBe('');
            expect(dock().style.width).toBe('');
            view.unmount();
        }
    });

    test('has no handle on a narrow window, where it takes the width', async () => {
        renderApp({withLink: false});
        fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
        await waitFor(() => expect(dockBox()).toBeEnabled());
        expect(within(dock()).queryByRole('button', {name: 'Move or size the assistant'})).toBeNull();
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

    test('sends with a prompt the filters of the list on display, as its page tells them', async () => {
        const list = renderHook(() => useShareListFilters('nodes', useMemo(() => ({chosen: {frozen: ['frozen']}}), [])));
        try {
            renderApp({withLink: false});
            fireEvent.click(await screen.findByRole('button', {name: 'Open the assistant'}));
            await waitFor(() => expect(dockBox()).toBeEnabled());
            fireEvent.change(dockBox(), {target: {value: 'which are frozen?'}});
            fireEvent.click(within(dock()).getByRole('button', {name: 'Send'}));
            await waitFor(() => expect(mocks.client.run).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({context: expect.arrayContaining([{description: 'list filters', value: 'nodes; frozen is frozen'}])}),
                expect.any(Object)
            ));
        } finally {
            list.unmount();
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

        test('shows where the dock was moved to open', async () => {
            const restore = wideWindow();
            localStorage.setItem('om3.ai.dock.geometry', JSON.stringify({right: 200, width: null, height: null}));
            try {
                const run = hangingRun();
                await sendThenLeave();
                await act(async () => run.finish());
                const notice = (await screen.findByRole('button', {name: 'See the answer'})).closest('div[style]');
                expect(notice.style.right).toBe('200px');
            } finally {
                restore();
                localStorage.removeItem('om3.ai.dock.geometry');
            }
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

        test('tells the end of a message queued once it ends too, not while it runs', async () => {
            const runs = [];
            mocks.client.run.mockImplementation(
                (_id, _input, options) =>
                    new Promise((resolve) => {
                        for (const event of text(`Checking ${runs.length + 1}.`, `turn-${runs.length + 1}:2`)) options.onEvent(event);
                        runs.push(resolve);
                    })
            );
            await send();
            await screen.findByRole('button', {name: 'Stop'});
            fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'second'}});
            fireEvent.click(screen.getByRole('button', {name: 'Queue'}));
            await act(async () => navigate('/'));
            // The first ends, the message queued runs at once: nothing to tell yet.
            await act(async () => runs[0]({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-1', tokens: null}));
            await waitFor(() => expect(runs).toHaveLength(2));
            expect(toast()).toBeNull();
            await act(async () => runs[1]({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-2', tokens: null}));
            await waitFor(() => expect(told()).toBe('Your analysis is done.'));
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
