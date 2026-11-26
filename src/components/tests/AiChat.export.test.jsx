import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import AiChat from '../AiChat.jsx';
import {MemoryRouter} from 'react-router-dom';
import {AiChatProvider} from '../../context/AiChatProvider.jsx';
import {AiAgentError, parseConfirmation} from '../../services/ai-agent.js';

// The provider reads the page under the dock: the application mounts it in its
// router. The page of the assistant has none under it.
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

const existing = {id: 'existing', title: 'Previous diagnostic'};
const message = (id, role, text, extra = {}) => ({id, turn_id: id.split(':')[0], role, text, created_at: '2026-10-05T12:00:00Z', ...extra});

// The history by pages, the most recent first: the transcript shows the last
// one, the export reads them all.
const PAGES = {
    '': {
        messages: [message('turn-2:1', 'user', 'Per OS?'), message('turn-2:2', 'assistant', 'Linux mostly.', {model_id: 'haiku'})],
        next_cursor: '1:1',
    },
    '1:1': {
        messages: [message('turn-1:1', 'user', 'How many nodes?'), message('turn-1:2', 'assistant', 'There are 484 nodes.')],
        next_cursor: '',
    },
};

describe('the export of a conversation of the assistant', () => {
    let saved;
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: 'New'}),
            getConversation: vi.fn().mockResolvedValue(existing),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn(async (_id, {before = ''} = {}) => PAGES[before]),
            getCapabilities: vi.fn().mockResolvedValue({feedback: true}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(),
        };
        // What the browser is given to save: the blob, and the name of the file.
        saved = [];
        let blob = null;
        URL.createObjectURL = vi.fn((object) => {
            blob = object;
            return 'blob:export';
        });
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            saved.push({name: this.download, href: this.href, blob});
        });
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    const resume = async () => {
        render(<AiChat />, {wrapper: ChatWrapper});
        fireEvent.click(await screen.findByRole('button', {name: 'Previous diagnostic'}));
        await screen.findByText('Linux mostly.');
    };
    const exportButton = () => screen.getByRole('button', {name: 'Export the conversation'});
    // The menu of the export, then its entry: Markdown or PDF.
    const exportAs = async (format) => {
        fireEvent.click(exportButton());
        fireEvent.click(await screen.findByRole('menuitem', {name: format === 'pdf' ? /^Download the conversation in PDF/ : /^Download the conversation in Markdown/}));
    };

    test('saves the whole conversation as Markdown, the messages not loaded too', async () => {
        await resume();
        expect(screen.queryByText('There are 484 nodes.')).toBeNull();
        await exportAs('md');
        await waitFor(() => expect(saved).toHaveLength(1));
        expect(mocks.client.getMessages).toHaveBeenLastCalledWith('existing', expect.objectContaining({before: '1:1'}));
        const [file] = saved;
        expect(file.name).toMatch(/^previous-diagnostic-\d{4}-\d\d-\d\d\.md$/);
        expect(file.blob.type).toBe('text/markdown;charset=utf-8');
        // jsdom's Blob has no text(): a FileReader reads it.
        const text = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsText(file.blob);
        });
        expect(text.startsWith('# Previous diagnostic\n\nCluster: Lab cluster · Exported on ')).toBe(true);
        expect(text.indexOf('How many nodes?')).toBeLessThan(text.indexOf('There are 484 nodes.'));
        expect(text.indexOf('There are 484 nodes.')).toBeLessThan(text.indexOf('Per OS?'));
        expect(text).toContain('Linux mostly.\n\n_Model: haiku_\n');
        // The transcript stays as it was.
        expect(screen.queryByText('There are 484 nodes.')).toBeNull();
        expect(exportButton()).toBeEnabled();
    });

    test('is offered for a conversation holding messages only, not while a turn runs', async () => {
        let finish;
        mocks.client.run.mockImplementation(
            (_id, _input, {onEvent}) =>
                new Promise((resolve) => {
                    onEvent({type: 'TEXT_MESSAGE_START', messageId: 'turn-3:2'});
                    finish = () => resolve({type: 'RUN_FINISHED', outcome: 'success', turnId: 'turn-3', tokens: null});
                })
        );
        render(<AiChat />, {wrapper: ChatWrapper});
        await screen.findByRole('button', {name: 'Previous diagnostic'});
        // A new conversation, none created yet: nothing to export.
        expect(screen.queryByRole('button', {name: 'Export the conversation'})).toBeNull();

        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        await screen.findByText('Linux mostly.');
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'And per version?'}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        await waitFor(() => expect(exportButton()).toBeDisabled());
        finish();
        await waitFor(() => expect(exportButton()).toBeEnabled());
    });

    test('tells why an export failed, the message of the agent, and lets it be tried again', async () => {
        await resume();
        mocks.client.getMessages.mockRejectedValueOnce(new AiAgentError('agent_unavailable', 'The agent is unavailable.'));
        await exportAs('md');
        expect(await screen.findByRole('alert')).toHaveTextContent('The agent is unavailable.');
        expect(saved).toHaveLength(0);
        await exportAs('md');
        await waitFor(() => expect(saved).toHaveLength(1));
        expect(screen.queryByText('The agent is unavailable.')).toBeNull();
        expect(screen.getByRole('status', {name: ''})).toHaveTextContent('The conversation is exported.');
    });

    test('tells another failure in its own words, and the alert is dismissed', async () => {
        await resume();
        mocks.client.getMessages.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await exportAs('md');
        expect(await screen.findByText('The conversation could not be exported. Try again.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Dismiss'}));
        expect(screen.queryByText('The conversation could not be exported. Try again.')).toBeNull();
    });

    test('tells a conversation too long, and one holding no stored turn, without saving', async () => {
        await resume();
        mocks.client.getMessages.mockImplementation(async () => ({messages: [message('turn-1:1', 'user', 'Again')], next_cursor: '1:1'}));
        await exportAs('md');
        expect(await screen.findByText('The conversation is too long to be exported.')).toBeInTheDocument();
        mocks.client.getMessages.mockImplementation(async () => ({messages: [], next_cursor: ''}));
        await exportAs('md');
        expect(await screen.findByText('Nothing to export: no turn of this conversation is stored.')).toBeInTheDocument();
        expect(saved).toHaveLength(0);
    });

    test('keeps the menu while it runs, its entries off, and drops the export of a conversation left', async () => {
        await resume();
        let release;
        mocks.client.getMessages.mockImplementationOnce(
            (_id, {signal}) =>
                new Promise((resolve, reject) => {
                    release = () => resolve(PAGES['']);
                    signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), {once: true});
                })
        );
        await exportAs('md');
        expect(await screen.findByRole('status', {name: ''})).toHaveTextContent('Exporting the conversation');
        expect(exportButton()).toBeEnabled();
        // Opened again while it runs: nothing more to start.
        fireEvent.click(exportButton());
        for (const entry of await screen.findAllByRole('menuitem')) expect(entry).toBeDisabled();
        fireEvent.keyDown(document.activeElement, {key: 'Escape'});
        expect(mocks.client.getMessages).toHaveBeenCalledTimes(2);

        // Another conversation, created: the export of the former gives nothing.
        fireEvent.click(screen.getByRole('button', {name: 'New conversation'}));
        await screen.findByRole('heading', {name: 'New'});
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(saved).toHaveLength(0);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    // The frame the print is made ready in, once its document holds the sheet.
    const frame = () => document.querySelector('iframe[aria-hidden="true"]');
    const frameReady = async () => {
        await waitFor(() => expect(frame()?.contentDocument?.querySelector('.ai-print')).toBeTruthy());
        return frame();
    };
    // Opening the menu: the press reads the history and makes the print ready.
    const openMenu = () => {
        fireEvent.pointerDown(exportButton());
        fireEvent.click(exportButton());
    };
    const pdfEntry = () => screen.findByRole('menuitem', {name: /^Download the conversation in PDF/});

    test('prints the whole conversation within the click, made ready as the menu opens, the page as it is', async () => {
        localStorage.setItem('om3.theme', 'dark');
        document.documentElement.classList.add('dark');
        document.title = 'Lab cluster';
        try {
            mocks.client.getMessages.mockImplementation(async (_id, {before = ''} = {}) =>
                before
                    ? {
                          messages: [
                              message('turn-1:1', 'user', 'How many nodes?\n<b>bold</b>'),
                              message('turn-1:2', 'assistant', 'There are **484** nodes. <img src=https://attacker.example> ![x](https://attacker.example/i.png)', {
                                  history: {
                                      steps: [{id: 'c1', tool: 'get_object_status', arguments: {path: 'prod/svc/web'}, status: 'failed'}],
                                      stepsOmitted: 0,
                                      runs: [{startedAt: 0, endedAt: 3000}],
                                  },
                              }),
                          ],
                          next_cursor: '',
                      }
                    : PAGES['']
            );
            await resume();
            openMenu();
            const ready = await frameReady();
            const print = vi.spyOn(ready.contentWindow, 'print').mockImplementation(() => {});
            fireEvent.click(await pdfEntry());
            // At once, within the click, without reading the history again.
            expect(print).toHaveBeenCalledTimes(1);
            expect(mocks.client.getMessages).toHaveBeenCalledTimes(3);
            const sheet = ready.contentDocument;
            expect(sheet.documentElement).not.toHaveClass('dark');
            expect(sheet.title).toMatch(/^previous-diagnostic-\d{4}-\d\d-\d\d$/);
            expect(sheet.head.querySelectorAll('style').length).toBe(document.head.querySelectorAll('style').length);
            const text = sheet.body.textContent;
            expect(text).toContain('Previous diagnostic');
            expect(text).toContain('Cluster: Lab cluster');
            expect(text.indexOf('How many nodes?')).toBeLessThan(text.indexOf('Per OS?'));
            // The prompt as text, the answer through the renderer of the transcript.
            expect(text).toContain('<b>bold</b>');
            expect(sheet.body.innerHTML).toContain('<strong>484</strong>');
            expect([...sheet.body.querySelectorAll('img, [src], a[href*="attacker"]')]).toEqual([]);
            expect(text).toContain('Read the status of prod/svc/web (refused by the tool)');
            expect(text).toContain('Model: haiku');
            // The page is left as it is: its theme, its title.
            expect(document.documentElement).toHaveClass('dark');
            expect(document.title).toBe('Lab cluster');
            expect(saved).toHaveLength(0);
        } finally {
            document.documentElement.classList.remove('dark');
            localStorage.removeItem('om3.theme');
        }
    });

    test('offers the print once ready, to a click before the history was read', async () => {
        await resume();
        let release;
        mocks.client.getMessages.mockImplementationOnce(
            (_id, {signal}) =>
                new Promise((resolve, reject) => {
                    release = () => resolve(PAGES['1:1']);
                    signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), {once: true});
                })
        );
        openMenu();
        fireEvent.click(await pdfEntry());
        // Read once for the press and the click.
        await act(async () => release());
        const ready = await frameReady();
        const print = vi.spyOn(ready.contentWindow, 'print').mockImplementation(() => {});
        expect(print).not.toHaveBeenCalled();
        expect(screen.getByText('The conversation is ready to be saved as a PDF.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Open the print dialog'}));
        expect(print).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('The conversation is ready to be saved as a PDF.')).toBeNull();
    });

    test('tells a browser that cannot print, the page as it was', async () => {
        document.title = 'Lab cluster';
        await resume();
        openMenu();
        const ready = await frameReady();
        vi.spyOn(ready.contentWindow, 'print').mockImplementation(() => {
            throw new Error('Not implemented: window.print');
        });
        fireEvent.click(await pdfEntry());
        expect(await screen.findByText('The browser could not open its print dialog: the PDF was not made.')).toBeInTheDocument();
        expect(document.title).toBe('Lab cluster');
    });

    test('reads the history again once a turn changed the transcript', async () => {
        await resume();
        openMenu();
        await frameReady();
        fireEvent.keyDown(document.activeElement, {key: 'Escape'});
        expect(mocks.client.getMessages).toHaveBeenCalledTimes(3);
        // Pressed again, the transcript as it was: nothing read again.
        fireEvent.pointerDown(exportButton());
        expect(mocks.client.getMessages).toHaveBeenCalledTimes(3);
    });

    test('is not offered while an action waits for the decision of the user', async () => {
        mocks.client.getConversationState.mockResolvedValue({
            conversation: existing,
            confirmation: parseConfirmation({
                id: 'confirmation-1',
                turn_id: 'turn-3',
                tool: {name: 'stop_instance', title: 'Stop instance', destructive: true},
                arguments: {path: 'test/svc/web', node: 'dev5n1'},
                argument_types: {},
                editable: false,
                expires_at: '2099-10-26T17:45:00Z',
            }),
        });
        mocks.client.listTools = vi.fn().mockResolvedValue([]);
        await resume();
        await screen.findByRole('region', {name: 'Action waiting for confirmation'});
        expect(exportButton()).toBeDisabled();
    });
});
