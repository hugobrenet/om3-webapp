import React from 'react';
import {render, screen, waitFor, act, within, fireEvent} from '@testing-library/react';
import ConfigSection from '../ConfigSection';
import {clearKeywordsCache} from '../ConfigText';
import {clearDesignerCache} from '../ObjectDesigner';
import userEvent from '@testing-library/user-event';
import {URL_OBJECT} from '../../config/apiPath.js';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import i18n from '../../i18n';
import {PencilIcon, SlidersIcon} from '../../ui/icons';
import {useActionTracker} from '../../app/action-tracker';

// ── Hoisted variables ─────────────────────────────────────────────────
const {
    mockUseParams,
    mockLocalStorage,
} = vi.hoisted(() => ({
    mockUseParams: vi.fn(),
    mockLocalStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    },
}));

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useParams: mockUseParams,
    };
});

Object.defineProperty(global, 'localStorage', {value: mockLocalStorage});

// ── Helpers ─────────────────────────────────────────────────────────────
// The writes said in the actions tray, newest first.
const tray = () => useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state, e.error ?? null]);
// No success nor progress said by snackbar: the tray says it.
const noWriteSnackbar = (openSnackbar) =>
    expect(openSnackbar.mock.calls.filter(([, severity]) => severity !== 'error')).toEqual([]);
const defaultProps = {
    decodedObjectName: 'root/cfg/cfg1',
    configNode: 'node1',
    setConfigNode: vi.fn(),
    openSnackbar: vi.fn(),
    configDialogOpen: true,
    setConfigDialogOpen: vi.fn(),
};
const renderConfig = (props = {}) => render(<ConfigSection {...defaultProps} {...props} />);
/** A line of the file shown by its whole text, its key a button of its own; any other element by its own text. */
const fileLine = (re) => (content, element) => (element?.hasAttribute?.('data-line') ? re.test(element.textContent) : re.test(content));
const getViewConfigButton = () => screen.getByRole('button', {name: 'View Configuration'});
const getUploadButton = () => screen.getByRole('button', {name: /Upload new configuration file/i});
const getManageButton = () => screen.getByRole('button', {name: 'Design the configuration'});
const getKeywordsButton = () => screen.getByRole('button', {name: /View configuration keywords/i});
const getDialogByTitle = (title) => screen.getAllByRole('dialog').find(d => within(d).queryByRole('heading', {name: title}));
const queryLoading = () => screen.queryByRole('status', {name: /^Loading/i});
const openUpdateDialogWithFile = async (user, fileName = 'config.ini', content = '[DEFAULT]\nnodes = node2') => {
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    await act(() => user.click(getUploadButton()));
    await waitFor(() => expect(screen.getByRole('heading', {name: 'Update Configuration'})).toBeInTheDocument());
    const file = new File([content], fileName);
    await act(() => user.upload(document.querySelector('#update-config-file-upload'), file));
    return file;
};

// The designer opened, on the file read.
const openDesigner = async (user) => {
    const open = await screen.findByRole('button', {name: 'Design the configuration'});
    await act(() => user.click(open));
    await screen.findByRole('navigation', {name: 'Sections'});
    return getDialogByTitle('Configuration design');
};

const defaultFetchMock = (url, options) => {
    const headers = options?.headers || {};
    if (url.includes('/config/file')) {
        return Promise.resolve({
            ok: true, status: 200,
            text: () => Promise.resolve('[DEFAULT]\nnodes = *\norchestrate = ha\n[fs#1]\nsize = 10GB'),
            json: () => Promise.resolve({}),
            headers: new Headers({Authorization: headers.Authorization || ''}),
        });
    }
    if (url.includes('/config/keywords')) {
        const option = new URL(url, 'http://x').searchParams.get('option');
        return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({
                items: [
                    {
                        option: 'nodes',
                        section: 'DEFAULT',
                        text: 'Nodes to deploy the service',
                        converter: 'string',
                        scopable: true,
                        default: '*'
                    },
                    {
                        option: 'size',
                        section: 'fs',
                        text: 'Size of filesystem',
                        converter: 'string',
                        scopable: false,
                        default: '1GB'
                    },
                    {
                        option: 'orchestrate',
                        section: 'DEFAULT',
                        text: 'Orchestration mode',
                        converter: 'string',
                        scopable: true,
                        default: 'ha'
                    },
                    {
                        option: 'roles',
                        section: 'DEFAULT',
                        text: 'Comma-separated roles',
                        converter: 'converters.TListLowercase',
                        scopable: true,
                        default: ''
                    },
                    {
                        option: 'debug',
                        section: '',
                        text: 'Debug mode',
                        converter: 'boolean',
                        scopable: false,
                        default: 'false'
                    },
                ].filter((k) => !option || k.option === option),
            }),
            headers: new Headers({Authorization: headers.Authorization || ''}),
        });
    }
    if (url.includes('/config?set=') || url.includes('/config?unset=') || url.includes('/config?delete=')) {
        return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({}),
            text: () => Promise.resolve(''),
            headers: new Headers({Authorization: headers.Authorization || ''}),
        });
    }
    if (url.includes('/config')) {
        return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({
                items: [
                    {keyword: 'nodes', value: '*'},
                    {keyword: 'fs#1.size', value: '10GB'},
                    {keyword: 'orchestrate', value: 'ha'},
                ],
            }),
            headers: new Headers({Authorization: headers.Authorization || ''}),
        });
    }
    return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({}), text: () => Promise.resolve(''),
        headers: new Headers({Authorization: headers.Authorization || ''}),
    });
};

// ── Tests ───────────────────────────────────────────────────────────────
/** The GET requests of the configuration file made so far. */
const configFileGets = () => global.fetch.mock.calls.filter(
    ([url, options]) => url.includes('/config/file') && (options?.method ?? 'GET') === 'GET'
);

describe('ConfigSection Component', () => {
    const user = userEvent.setup();

    beforeEach(() => {
        vi.clearAllMocks();
        mockLocalStorage.getItem.mockImplementation(() => 'mock-token');
        mockUseParams.mockReturnValue({objectName: 'root/cfg/cfg1'});
        global.fetch = vi.fn(defaultFetchMock);
        clearKeywordsCache();
        clearDesignerCache();
        useActionTracker.setState({tracked: [], revealed: 0});
    });

    afterEach(() => vi.resetAllMocks());

    // ── Basic rendering ──────────────────────────────────────────────────
    test('displays configuration button, no dialog initially', () => {
        renderConfig({configDialogOpen: false});
        expect(getViewConfigButton()).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('inline, the file and its tools are in place: no button, no dialog', async () => {
        renderConfig({configDialogOpen: false, inline: true});
        expect(screen.queryByRole('button', {name: 'View Configuration'})).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(getUploadButton()).toBeInTheDocument();
        expect(getManageButton()).toBeInTheDocument();
        await waitFor(() => expect(configFileGets().length).toBeGreaterThan(0));
    });

    test('speaks French in a French browser', async () => {
        await i18n.changeLanguage('fr');
        try {
            renderConfig({configDialogOpen: false});
            expect(screen.getByRole('button', {name: 'Voir la configuration'})).toBeInTheDocument();
        } finally {
            await act(() => i18n.changeLanguage('en'));
        }
    });

    test('clicking View Configuration calls setConfigDialogOpen(true)', async () => {
        const setConfigDialogOpen = vi.fn();
        renderConfig({configDialogOpen: false, setConfigDialogOpen});
        await act(() => user.click(getViewConfigButton()));
        expect(setConfigDialogOpen).toHaveBeenCalledWith(true);
    });

    test('displays dialog content when open', async () => {
        renderConfig();
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        expect(screen.getByText('Configuration')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText(fileLine(/nodes = \*/i))).toBeInTheDocument());
        await waitFor(() => expect(screen.getByText(fileLine(/orchestrate = ha/i))).toBeInTheDocument());
        await waitFor(() => expect(screen.getByText(fileLine(/size = 10GB/i))).toBeInTheDocument());
    });

    test('close button calls setConfigDialogOpen(false)', async () => {
        const setConfigDialogOpen = vi.fn();
        renderConfig({setConfigDialogOpen});
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        // The footer button, then the close cross of the header.
        const [cross, footerClose] = within(screen.getByRole('dialog')).getAllByRole('button', {name: /^Close$/});
        await act(() => user.click(footerClose));
        expect(setConfigDialogOpen).toHaveBeenCalledWith(false);
        setConfigDialogOpen.mockClear();
        await act(() => user.click(cross));
        expect(setConfigDialogOpen).toHaveBeenCalledWith(false);
    });

    test('pressing Escape on the configuration dialog triggers onClose', async () => {
        const setConfigDialogOpen = vi.fn();
        renderConfig({setConfigDialogOpen});
        const dialog = await screen.findByRole('dialog');
        fireEvent.keyDown(dialog, {key: 'Escape', code: 'Escape'});
        expect(setConfigDialogOpen).toHaveBeenCalledWith(false);
    });

    test('shows no configuration available when configNode is missing', async () => {
        renderConfig({configNode: ''});
        await waitFor(() => expect(screen.getByText(/No instance selected to view configuration/i)).toBeInTheDocument());
    });

    test('shows "No configuration available" when config text is null', async () => {
        global.fetch.mockImplementation((url) => {
            if (url.includes('/config/file')) return Promise.resolve({
                ok: true,
                status: 200,
                text: () => Promise.resolve(null),
                headers: new Headers(),
            });
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({items: []}),
                headers: new Headers(),
            });
        });
        renderConfig();
        await waitFor(() => expect(screen.getByText(/No configuration available/i)).toBeInTheDocument());
    });

    // ── Fetch error cases ────────────────────────────────────────────────
    test.each([
        ['HTTP error', () => Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Server error'),
        }), /Failed to fetch config: HTTP 500/i],
        ['network error', () => Promise.reject(new Error('Network failure')), /Failed to fetch config: Network failure/i],
    ])('fetch configuration: %s', async (_, fetchImpl, expected) => {
        global.fetch.mockImplementation(fetchImpl);
        renderConfig();
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.getByRole('alert')).toHaveTextContent(expected);
    });

    test('shows loading indicator while fetching', async () => {
        global.fetch.mockImplementation(() => new Promise(() => {
        }));
        renderConfig();
        await waitFor(() => expect(screen.getByRole('status', {name: 'Loading configuration'})).toBeInTheDocument());
    });

    // ── Re-fetch triggers ────────────────────────────────────────────────
    test('configNode change triggers config re-fetch', async () => {
        const {rerender} = renderConfig();
        await waitFor(() => expect(configFileGets()).toHaveLength(1));
        rerender(<ConfigSection {...defaultProps} configNode="node2"/>);
        await waitFor(() => expect(configFileGets()).toHaveLength(2));
    });

    test('decodedObjectName change triggers config re-fetch', async () => {
        const {rerender} = renderConfig();
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('cfg1'), expect.any(Object)));
        rerender(<ConfigSection {...defaultProps} decodedObjectName="root/cfg/cfg2"/>);
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('cfg2'), expect.any(Object)));
    });

    test('debounce prevents duplicate fetchConfig calls within 1 second', async () => {
        renderConfig();
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        const count = global.fetch.mock.calls.filter(c => c[0].includes('/config/file')).length;
        const {rerender} = renderConfig();
        rerender(<ConfigSection {...defaultProps} />);
        await act(() => new Promise(r => setTimeout(r, 100)));
        expect(global.fetch.mock.calls.filter(c => c[0].includes('/config/file')).length).toBeGreaterThanOrEqual(count);
    });

    test('throttle blocks immediate re-fetch for same node', async () => {
        const {rerender} = renderConfig();
        await waitFor(() => expect(configFileGets()).toHaveLength(1));
        global.fetch.mockClear();

        rerender(<ConfigSection {...defaultProps} configNode="node2"/>);
        await waitFor(() => expect(configFileGets()).toHaveLength(1));
        global.fetch.mockClear();

        // Back to node1 within a second of its fetch: throttled.
        rerender(<ConfigSection {...defaultProps} configNode="node1"/>);
        await act(() => new Promise(r => setTimeout(r, 100)));
        expect(configFileGets()).toHaveLength(0);
    });

    test('refreshTrigger change triggers fetchConfig with forceBypassThrottle=true', async () => {
        const {rerender} = renderConfig();
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        global.fetch.mockClear();
        rerender(<ConfigSection {...defaultProps} configRefreshTrigger={1}/>);
        await waitFor(() => expect(configFileGets()).toHaveLength(1));
    });

    test('refreshTrigger bypasses throttle even with recent fetch', async () => {
        const {rerender} = renderConfig();
        await waitFor(() => expect(configFileGets()).toHaveLength(1));
        global.fetch.mockClear();

        rerender(<ConfigSection {...defaultProps} configRefreshTrigger={1}/>);
        await waitFor(() => expect(configFileGets()).toHaveLength(1));
    });

    test('the configuration shown copied, its secrets as shown', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
        try {
            global.fetch.mockImplementation((url, options) => (url.includes('/config/file')
                ? Promise.resolve({ok: true, status: 200, text: () => Promise.resolve('[DEFAULT]\nnodes = *\nsecret = ********\n')})
                : defaultFetchMock(url, options)));
            renderConfig({inline: true});
            const copy = await screen.findByRole('button', {name: 'Copy the configuration shown'});
            await act(() => user.click(copy));
            expect(writeText).toHaveBeenCalledWith('[DEFAULT]\nnodes = *\nsecret = ********\n');
        } finally {
            Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true});
        }
    });

    test('an edit in progress, inline: kept when the editor is unmounted, a tab of its panel left', async () => {
        const first = renderConfig({inline: true});
        const edit = await screen.findByRole('button', {name: 'Edit configuration file'});
        await act(() => user.click(edit));
        const editor = await screen.findByRole('textbox', {name: 'Configuration file'});
        fireEvent.change(editor, {target: {value: '[DEFAULT]\nnodes = n1\n'}});
        first.unmount();
        renderConfig({inline: true});
        expect(await screen.findByRole('textbox', {name: 'Configuration file'})).toHaveValue('[DEFAULT]\nnodes = n1\n');
        // Cancelled, forgotten.
        await act(() => user.click(screen.getByRole('button', {name: 'Cancel'})));
        expect(screen.queryByRole('textbox', {name: 'Configuration file'})).toBeNull();
    });

    describe('no configuration yet', () => {
        const posts = () => global.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');

        test('said, the file edited from empty: saved, the object created with it, an id of its own', async () => {
            renderConfig({inline: true, configNode: null, decodedObjectName: 'dev/nscfg/namespace', absent: true});
            expect(screen.getByText('No configuration yet: it is created with the first change written.')).toBeInTheDocument();
            expect(screen.queryByRole('button', {name: /secrets/i})).toBeNull();
            await act(() => user.click(screen.getByRole('button', {name: 'Edit configuration file'})));
            const editor = screen.getByRole('textbox', {name: 'Configuration file'});
            expect(editor).toHaveValue('');
            // Nothing read: there is nothing yet.
            expect(configFileGets()).toHaveLength(0);
            fireEvent.change(editor, {target: {value: '[claim#1]\ntype = memory\nlimit = 4g\n'}});
            await act(() => user.click(screen.getByRole('button', {name: 'Save'})));
            await waitFor(() => expect(posts()).toHaveLength(1));
            const [url, options] = posts()[0];
            expect(url).toBe(`${URL_OBJECT}/dev/nscfg/namespace/config/file?wait=30s`);
            expect(options.body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\n\n\[claim#1\]\ntype = memory\nlimit = 4g\n$/);
            await waitFor(() => expect(tray()).toEqual([['Create the configuration', 'dev/nscfg/namespace', 'succeeded', null]]));
        });

        test('the configuration designed: the object created with it, in one request', async () => {
            renderConfig({inline: true, configNode: null, decodedObjectName: 'dev/nscfg/namespace', absent: true});
            const dialog = await openDesigner(user);
            // Nothing to read yet.
            expect(configFileGets()).toHaveLength(0);
            const more = await within(dialog).findByRole('button', {name: 'More'});
            await act(() => user.click(more));
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Add orchestrate'})));
            fireEvent.change(within(dialog).getByRole('textbox', {name: 'Value of orchestrate'}), {target: {value: 'no'}});
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Apply 1 change'})));
            await waitFor(() => expect(posts()).toHaveLength(1));
            const [url, options] = posts()[0];
            expect(url).toBe(`${URL_OBJECT}/dev/nscfg/namespace/config/file?set=orchestrate=no&wait=30s`);
            expect(options.body).toMatch(/^\[DEFAULT\]\nid = /);
            expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(false);
            await waitFor(() => expect(tray()).toEqual([['Create the configuration', 'dev/nscfg/namespace', 'succeeded', null]]));
        });
    });

    // ── Secrets ──────────────────────────────────────────────────────────
    describe('editing the file', () => {
        // The daemon file: `stored`, redacted on demand; a PUT answers `putResponse`.
        const mockDaemon = ({stored, putResponse = {ok: true, status: 204}, onPut} = {}) => {
            let file = stored;
            global.fetch.mockImplementation((url, options) => {
                if (url.includes('/config/file')) {
                    if (options?.method === 'PUT') {
                        onPut?.();
                        if (putResponse.ok) file = options.body;
                        return Promise.resolve({
                            json: () => Promise.resolve(putResponse.problem ?? {}),
                            ...putResponse,
                        });
                    }
                    const text = url.includes('redact-secrets=false') ? file : file.replace(/secret = .*/, 'secret = ********');
                    return Promise.resolve({ok: true, status: 200, text: () => Promise.resolve(text)});
                }
                return defaultFetchMock(url, options);
            });
            return {setFile: (text) => { file = text; }};
        };
        const configPuts = () => global.fetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
        const startEditing = async () => {
            const edit = await screen.findByRole('button', {name: 'Edit configuration file'});
            await act(() => user.click(edit));
            return screen.findByRole('textbox', {name: 'Configuration file'});
        };

        test('the pencil edits the file; the sliders open the designer', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *'});
            renderConfig();
            const glyph = (Icon) => render(<Icon/>).container.querySelector('svg').innerHTML;
            const edit = await screen.findByRole('button', {name: 'Edit configuration file'});
            const wizard = screen.getByRole('button', {name: 'Design the configuration'});
            expect(edit.querySelector('svg').innerHTML).toBe(glyph(PencilIcon));
            expect(wizard.querySelector('svg').innerHTML).toBe(glyph(SlidersIcon));
        });

        test('edits the file as stored, secrets in clear, and uploads it', async () => {
            const openSnackbar = vi.fn();
            mockDaemon({stored: '[DEFAULT]\nnodes = *\nsecret = s3cr3t'});
            renderConfig({openSnackbar});
            expect(await screen.findByText(fileLine(/secret = \*{8}/))).toBeInTheDocument();

            const editor = await startEditing();
            // Written back redacted, the secrets would become asterisks.
            expect(editor).toHaveValue('[DEFAULT]\nnodes = *\nsecret = s3cr3t');
            const save = screen.getByRole('button', {name: 'Save'});
            expect(save).toBeDisabled();

            fireEvent.change(editor, {target: {value: '[DEFAULT]\nnodes = node1\nsecret = s3cr3t'}});
            await act(() => user.click(save));

            await waitFor(() => expect(configPuts()).toHaveLength(1));
            const [url, options] = configPuts()[0];
            expect(url).toBe(`${URL_OBJECT}/root/cfg/cfg1/config/file?wait=30s`);
            expect(options.body).toBe('[DEFAULT]\nnodes = node1\nsecret = s3cr3t');
            expect(options.headers.Authorization).toBe('Bearer mock-token');
            await waitFor(() => expect(tray()).toEqual([['Update the configuration', 'root/cfg/cfg1', 'succeeded', null]]));
            noWriteSnackbar(openSnackbar);
            // Back to the redacted view, reloaded.
            expect(await screen.findByText(fileLine(/nodes = node1/))).toBeInTheDocument();
            expect(screen.queryByRole('textbox', {name: 'Configuration file'})).toBeNull();
            expect(screen.queryByText(/s3cr3t/)).toBeNull();
        });

        test('a section alone: shown, edited and put back in its place in the file; no upload nor wizard', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\nsecret = s3cr3t\n\n[app#1]\ntype = forking\n'});
            renderConfig({inline: true, section: 'fs#1'});
            expect(await screen.findByText(fileLine(/secret = \*{8}/))).toBeInTheDocument();
            expect(screen.queryByText(fileLine(/nodes = \*/))).toBeNull();
            expect(screen.queryByText(fileLine(/type = forking/))).toBeNull();
            expect(screen.queryByRole('button', {name: 'Upload new configuration file'})).toBeNull();
            expect(screen.queryByRole('button', {name: 'Design the configuration'})).toBeNull();

            const editor = await startEditing();
            expect(editor).toHaveValue('[fs#1]\ntype = flag\nsecret = s3cr3t\n');
            fireEvent.change(editor, {target: {value: '[fs#1]\ntype = flag\nsecret = s3cr3t\nsize = 1G\n'}});
            await act(() => user.click(screen.getByRole('button', {name: 'Save'})));
            await waitFor(() => expect(configPuts()).toHaveLength(1));
            expect(configPuts()[0][1].body)
                .toBe('[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\nsecret = s3cr3t\nsize = 1G\n\n[app#1]\ntype = forking\n');
        });

        test('a section the file does not hold: said', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *\n'});
            renderConfig({inline: true, section: 'fs#9'});
            expect(await screen.findByText('No section [fs#9] in the configuration.')).toBeInTheDocument();
        });

        test('cancel drops the changes without uploading', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *'});
            renderConfig();
            const editor = await startEditing();
            fireEvent.change(editor, {target: {value: '[DEFAULT]\nnodes = node9'}});
            await act(() => user.click(screen.getByRole('button', {name: 'Cancel'})));
            expect(screen.queryByRole('textbox', {name: 'Configuration file'})).toBeNull();
            expect(configPuts()).toHaveLength(0);
            expect(screen.queryByText(/node9/)).toBeNull();
        });

        test('keeps the changes while the dialog is closed and opened again', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *'});
            const {rerender} = renderConfig();
            const editor = await startEditing();
            fireEvent.change(editor, {target: {value: '[DEFAULT]\nnodes = node9'}});
            rerender(<ConfigSection {...defaultProps} configDialogOpen={false}/>);
            rerender(<ConfigSection {...defaultProps} configDialogOpen/>);
            expect(screen.getByRole('textbox', {name: 'Configuration file'})).toHaveValue('[DEFAULT]\nnodes = node9');
        });

        test('refuses to overwrite a file changed by someone else meanwhile', async () => {
            const daemon = mockDaemon({stored: '[DEFAULT]\nnodes = *'});
            renderConfig();
            const editor = await startEditing();
            fireEvent.change(editor, {target: {value: '[DEFAULT]\nnodes = node9'}});
            daemon.setFile('[DEFAULT]\nnodes = node2');
            await act(() => user.click(screen.getByRole('button', {name: 'Save'})));

            expect(await screen.findByText(/changed by someone else/)).toBeInTheDocument();
            expect(configPuts()).toHaveLength(0);
            expect(editor).toHaveValue('[DEFAULT]\nnodes = node9');

            await act(() => user.click(screen.getByRole('button', {name: 'Start over from the current file'})));
            await waitFor(() => expect(screen.getByRole('textbox', {name: 'Configuration file'})).toHaveValue('[DEFAULT]\nnodes = node2'));
            expect(screen.queryByText(/changed by someone else/)).toBeNull();
        });

        test('shows why the daemon refused the file, and keeps the changes', async () => {
            mockDaemon({
                stored: '[DEFAULT]\nnodes = *',
                putResponse: {ok: false, status: 400, problem: {detail: 'DEFAULT.bogus: unknown keyword'}},
            });
            renderConfig();
            const editor = await startEditing();
            fireEvent.change(editor, {target: {value: '[DEFAULT]\nbogus = 1'}});
            await act(() => user.click(screen.getByRole('button', {name: 'Save'})));
            expect(await screen.findByText('Failed to update config: DEFAULT.bogus: unknown keyword')).toBeInTheDocument();
            expect(editor).toHaveValue('[DEFAULT]\nbogus = 1');
            expect(screen.queryByRole('button', {name: 'Start over from the current file'})).toBeNull();
        });

        test('offers to start over when the daemon reports a conflict', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *', putResponse: {ok: false, status: 409}});
            renderConfig();
            const editor = await startEditing();
            fireEvent.change(editor, {target: {value: '[DEFAULT]\nnodes = node9'}});
            await act(() => user.click(screen.getByRole('button', {name: 'Save'})));
            expect(await screen.findByText('Failed to update config: HTTP 409')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Start over from the current file'})).toBeInTheDocument();
        });

        test('says so when the file can not be loaded for editing', async () => {
            renderConfig();
            await screen.findByText(fileLine(/nodes = \*/));
            global.fetch.mockImplementation(() => Promise.resolve({ok: false, status: 403}));
            await act(() => user.click(screen.getByRole('button', {name: 'Edit configuration file'})));
            expect(await screen.findByText('Failed to fetch config: HTTP 403')).toBeInTheDocument();
            expect(screen.queryByRole('textbox', {name: 'Configuration file'})).toBeNull();
        });
    });

    describe('secrets', () => {
        test('loads the object configuration with its secrets redacted by default', async () => {
            renderConfig();
            await waitFor(() => expect(configFileGets()).toHaveLength(1));
            expect(configFileGets()[0][0]).toBe(`${URL_OBJECT}/root/cfg/cfg1/config/file?redact-secrets=true`);
        });

        test('shows the secrets on demand, and hides them again', async () => {
            renderConfig({configDialogOpen: true});
            await waitFor(() => expect(configFileGets()).toHaveLength(1));
            expect(await screen.findByText('Secret values are shown as ********.')).toBeInTheDocument();
            const show = screen.getByRole('button', {name: 'Show secrets'});
            expect(show).toHaveAttribute('aria-pressed', 'false');

            await act(() => user.click(show));
            await waitFor(() => expect(configFileGets().at(-1)[0]).toContain('redact-secrets=false'));
            const hide = await screen.findByRole('button', {name: 'Hide secrets'});
            expect(hide).toHaveAttribute('aria-pressed', 'true');
            await waitFor(() => expect(screen.queryByText('Secret values are shown as ********.')).toBeNull());

            // Hidden again at once, within the throttle second: still reloaded.
            await act(() => user.click(hide));
            await waitFor(() => expect(configFileGets().at(-1)[0]).toContain('redact-secrets=true'));
            expect(await screen.findByRole('button', {name: 'Show secrets'})).toBeInTheDocument();
        });

        test('never leaves a revealed secret on screen once hidden', async () => {
            // The daemon redacts on demand: the real value only without redact-secrets.
            global.fetch.mockImplementation((url, options) => {
                if (url.includes('/config/file') && (options?.method ?? 'GET') === 'GET') {
                    const value = url.includes('redact-secrets=false') ? 's3cr3t-value' : '********';
                    return Promise.resolve({
                        ok: true, status: 200,
                        text: () => Promise.resolve(`[cluster]\nsecret = ${value}`),
                    });
                }
                return defaultFetchMock(url, options);
            });
            renderConfig({configDialogOpen: true});
            expect(await screen.findByText(fileLine(/secret = \*{8}/))).toBeInTheDocument();
            expect(screen.queryByText(/s3cr3t-value/)).toBeNull();

            await act(() => user.click(screen.getByRole('button', {name: 'Show secrets'})));
            expect(await screen.findByText(fileLine(/secret = s3cr3t-value/))).toBeInTheDocument();

            await act(() => user.click(screen.getByRole('button', {name: 'Hide secrets'})));
            expect(await screen.findByText(fileLine(/secret = \*{8}/))).toBeInTheDocument();
            expect(screen.queryByText(/s3cr3t-value/)).toBeNull();
        });

        test('a revealed config answering after the hide is dropped, never shown as hidden', async () => {
            // The read of the secrets in clear held, answered only once hidden again.
            let answerRevealed;
            const revealed = new Promise((resolve) => { answerRevealed = resolve; });
            const signals = [];
            global.fetch.mockImplementation((url, options) => {
                if (url.includes('/config/file') && (options?.method ?? 'GET') === 'GET') {
                    signals.push(options?.signal);
                    const text = url.includes('redact-secrets=false')
                        ? revealed.then(() => '[cluster]\nsecret = s3cr3t-value')
                        : Promise.resolve('[cluster]\nsecret = ********');
                    return Promise.resolve({ok: true, status: 200, text: () => text});
                }
                return defaultFetchMock(url, options);
            });
            renderConfig({configDialogOpen: true});
            expect(await screen.findByText(fileLine(/secret = \*{8}/))).toBeInTheDocument();

            await act(() => user.click(screen.getByRole('button', {name: 'Show secrets'})));
            const hide = await screen.findByRole('button', {name: 'Hide secrets'});
            await act(() => user.click(hide));
            expect(await screen.findByText(fileLine(/secret = \*{8}/))).toBeInTheDocument();
            // The read in clear aborted, its late answer dropped.
            expect(signals.at(-2)?.aborted).toBe(true);
            await act(async () => { answerRevealed(); await revealed; });
            expect(screen.queryByText(/s3cr3t-value/)).toBeNull();
            expect(screen.getByText(fileLine(/secret = \*{8}/))).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Show secrets'})).toBeInTheDocument();
        });

        test('masks the shown secrets again on their own after 10 seconds', async () => {
            renderConfig({configDialogOpen: true});
            const show = await screen.findByRole('button', {name: 'Show secrets'});
            vi.useFakeTimers();
            try {
                fireEvent.click(show);
                await act(async () => {});
                expect(configFileGets().at(-1)[0]).toContain('redact-secrets=false');
                expect(screen.getByRole('button', {name: 'Hide secrets'})).toBeInTheDocument();
                expect(screen.getByText('Secrets masked again in 10 seconds.')).toBeInTheDocument();

                await act(async () => vi.advanceTimersByTime(4_000));
                expect(screen.getByText('Secrets masked again in 6 seconds.')).toBeInTheDocument();

                await act(async () => vi.advanceTimersByTime(5_999));
                expect(screen.getByRole('button', {name: 'Hide secrets'})).toBeInTheDocument();

                await act(async () => vi.advanceTimersByTime(1));
                expect(screen.getByRole('button', {name: 'Show secrets'})).toBeInTheDocument();
                expect(configFileGets().at(-1)[0]).toContain('redact-secrets=true');
            } finally {
                vi.useRealTimers();
            }
        });

        test('hides the secrets again each time the dialog opens', async () => {
            const {rerender} = renderConfig({configDialogOpen: true});
            const show = await screen.findByRole('button', {name: 'Show secrets'});
            await act(() => user.click(show));
            await waitFor(() => expect(configFileGets().at(-1)[0]).toContain('redact-secrets=false'));

            rerender(<ConfigSection {...defaultProps} configDialogOpen={false}/>);
            rerender(<ConfigSection {...defaultProps} configDialogOpen={true}/>);
            expect(await screen.findByRole('button', {name: 'Show secrets'})).toBeInTheDocument();
            await waitFor(() => expect(configFileGets().at(-1)[0]).toContain('redact-secrets=true'));
        });
    });

    test('refreshTrigger change with null configNode does not fetch', async () => {
        const {rerender} = renderConfig({configNode: ''});
        expect(await screen.findByText(/No instance selected to view configuration/i)).toBeInTheDocument();
        global.fetch.mockClear();
        rerender(<ConfigSection {...defaultProps} configNode="" configRefreshTrigger={1}/>);
        await act(() => new Promise(r => setTimeout(r, 200)));
        expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/config/file'), expect.anything());
    });

    test('handles parseObjectPath with various input formats', async () => {
        renderConfig({decodedObjectName: 'cluster'});
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    });

    test('configNode null triggers fetchConfig reset', async () => {
        renderConfig({configNode: null});
        await waitFor(() => expect(screen.getByText(/No instance selected to view configuration/i)).toBeInTheDocument());
    });

    // ── Viewer (the theme now comes from the tokens: no dark branch left) ──
    test('shows the configuration text as is, a line each', async () => {
        renderConfig();
        const file = await screen.findByRole('group', {name: 'Configuration file'});
        expect(file).toHaveClass('whitespace-pre-wrap', 'font-mono');
        expect([...file.children].map((line) => line.textContent))
            .toEqual(['[DEFAULT]', 'nodes = *', 'orchestrate = ha', '[fs#1]', 'size = 10GB']);
    });

    // ── Update config dialog ─────────────────────────────────────────────
    test('update config: success flow', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        const file = await openUpdateDialogWithFile(user);
        await waitFor(() => expect(screen.getByText(file.name)).toBeInTheDocument());
        await act(() => user.click(screen.getByRole('button', {name: /Update/i})));
        await waitFor(() => expect(tray()).toEqual([['Update the configuration', 'root/cfg/cfg1', 'succeeded', null]]));
        noWriteSnackbar(openSnackbar);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining(`${URL_OBJECT}/root/cfg/cfg1/config/file`),
            expect.objectContaining({
                method: 'PUT',
                headers: expect.objectContaining({
                    Authorization: 'Bearer mock-token',
                    'Content-Type': 'application/octet-stream',
                }),
            })
        );
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Update Configuration'})).not.toBeInTheDocument());
    });

    test('update config: Update button disabled without file', async () => {
        renderConfig();
        await act(() => user.click(getUploadButton()));
        await waitFor(() => expect(screen.getByRole('heading', {name: 'Update Configuration'})).toBeInTheDocument());
        expect(screen.getByRole('button', {name: /Update/i})).toBeDisabled();
    });

    test.each([
        ['missing token', () => mockLocalStorage.getItem.mockReturnValue(null), 'Auth token not found.', null, false],
        ['API failure', () => {
            global.fetch.mockImplementation((url, options) => {
                if (url.includes('/config/file')) return Promise.resolve({
                    ok: false,
                    status: 500,
                    text: () => Promise.resolve('Server error'),
                    headers: new Headers(),
                });
                return defaultFetchMock(url, options);
            });
        // Refused, the dialog stays open, saying why.
        }, null, ['Update the configuration', 'root/cfg/cfg1', 'refused', 'HTTP 500'], false],
        ['network error', () => {
            global.fetch.mockImplementation((url, options) => {
                if (url.includes('/config/file') && options.method === 'PUT') return Promise.reject(new Error('Network error'));
                return defaultFetchMock(url, options);
            });
        }, null, ['Update the configuration', 'root/cfg/cfg1', 'refused', 'Network error'], true],
    ])('update config: %s', async (_, setup, expectedMsg, expectedWrite, shouldClose) => {
        setup();
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openUpdateDialogWithFile(user);
        await act(() => user.click(screen.getByRole('button', {name: /Update/i})));
        if (expectedMsg) await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith(expectedMsg, 'error'));
        // Refused, in the tray; no token, nothing written.
        await waitFor(() => expect(tray()).toEqual(expectedWrite ? [expectedWrite] : []));
        if (shouldClose) {
            await waitFor(() => expect(screen.queryByRole('heading', {name: 'Update Configuration'})).not.toBeInTheDocument());
        } else {
            expect(screen.getByRole('heading', {name: 'Update Configuration'})).toBeInTheDocument();
        }
    });

    test('update config: works without configNode', async () => {
        global.fetch.mockImplementation((url) => {
            if (url.includes('/config/file')) return Promise.resolve({
                ok: true,
                status: 200,
                text: () => Promise.resolve(''),
                headers: new Headers(),
            });
            return defaultFetchMock(url);
        });
        const openSnackbar = vi.fn();
        renderConfig({configNode: '', openSnackbar});
        await openUpdateDialogWithFile(user);
        await act(() => user.click(screen.getByRole('button', {name: /Update/i})));
        await waitFor(() => expect(tray()).toEqual([['Update the configuration', 'root/cfg/cfg1', 'succeeded', null]]));
    });

    test('update config dialog: cancel closes it', async () => {
        renderConfig();
        await openUpdateDialogWithFile(user);
        const dlg = getDialogByTitle('Update Configuration');
        await act(() => user.click(within(dlg).getByRole('button', {name: /Cancel/i})));
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Update Configuration'})).not.toBeInTheDocument());
    });

    // ── The designer, on the file as stored ──────────────────────────────
    describe('the designer', () => {
        const patches = () => global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH').map(([url]) => decodeURIComponent(url));

        test('the cluster configuration: a section added, one of its own a click, one of several by a name and a type', async () => {
            const CLUSTER_KEYWORDS = [
                {option: 'name', section: 'cluster', text: 'The cluster name'},
                {option: 'agent_url', section: 'ai', text: 'The url of the AI agent'},
                {option: 'type', section: 'pool', text: 'The pool type', candidates: ['drbd', 'directory']},
                {option: 'vg', section: 'pool', types: ['drbd'], text: 'The volume group'},
                {option: 'type', section: 'hb', text: 'The heartbeat type'},
                {option: 'timeout', section: 'arbitrator', text: 'The arbitrator timeout'},
                {option: 'nodes', section: 'DEFAULT', text: 'The nodes'},
            ];
            global.fetch.mockImplementation((url, options) => {
                if (url.includes('/config/file')) {
                    return Promise.resolve({ok: true, status: 200, text: () => Promise.resolve('[cluster]\nname = c1\n')});
                }
                if (url.includes('/config/keywords')) {
                    const params = new URL(url, 'http://x').searchParams;
                    const section = params.get('section');
                    const driver = params.get('driver');
                    const items = section ? CLUSTER_KEYWORDS.filter((k) => k.section === section.split('#')[0])
                        : driver && driver !== 'DEFAULT' ? CLUSTER_KEYWORDS.filter((k) => k.section === driver.split('.')[0])
                            : driver === 'DEFAULT' ? CLUSTER_KEYWORDS.filter((k) => k.section === 'DEFAULT') : CLUSTER_KEYWORDS;
                    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({items})});
                }
                return defaultFetchMock(url, options);
            });
            // jsdom scrolls nothing: the panel's call recorded.
            const scrolled = vi.fn();
            Element.prototype.scrollIntoView = scrolled;
            renderConfig({decodedObjectName: 'cluster'});
            const dialog = await openDesigner(user);
            const nav = within(dialog).getByRole('navigation', {name: 'Sections'});
            await act(() => user.click(within(nav).getByRole('button', {name: 'Add a section'})));
            // Of its own: those not there yet, cluster there already.
            const single = await within(dialog).findByRole('group', {name: 'Sections'});
            // Brought where the eye is: its first choice focused, the panel scrolled into view.
            await waitFor(() => expect(within(single).getByRole('button', {name: '[ai]'})).toHaveFocus());
            expect(scrolled).toHaveBeenCalledWith({block: 'nearest', behavior: 'smooth'});
            expect(within(single).getAllByRole('button').map((b) => b.textContent)).toEqual(['[ai]']);
            const several = within(dialog).getByRole('group', {name: 'Sections of several, by a name'});
            expect(within(several).getAllByRole('button').map((b) => b.textContent)).toEqual(['[arbitrator#…]', '[hb#…]', '[pool#…]']);
            await act(() => user.click(within(single).getByRole('button', {name: '[ai]'})));
            await waitFor(() => expect(within(nav).getByRole('button', {name: /^ai/})).toHaveAttribute('aria-current', 'true'));
            // Its keywords there to set: the url of the agent.
            await waitFor(() => expect(within(dialog).getByRole('button', {name: 'Add agent_url'})).toBeInTheDocument());
            // One of several: a name, a type among those the keyword lists; a name there already refused.
            await act(() => user.click(within(nav).getByRole('button', {name: 'Add a section'})));
            const pool = await within(dialog).findByRole('button', {name: '[pool#…]'});
            await act(() => user.click(pool));
            const name = within(dialog).getByRole('textbox', {name: 'Name of the pool'});
            await act(() => user.type(name, 'bad name'));
            expect(within(dialog).getByText(/A word: letters, digits/)).toBeInTheDocument();
            await act(() => user.clear(name));
            await act(() => user.type(name, 'ceph'));
            const type = within(dialog).getByRole('combobox', {name: 'Type'});
            expect([...type.options].map((o) => o.value)).toEqual(['directory', 'drbd']);
            await act(() => user.selectOptions(type, 'drbd'));
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Add [pool#ceph]'})));
            await waitFor(() => expect(within(nav).getByRole('button', {name: /^pool#ceph/})).toHaveAttribute('aria-current', 'true'));
            expect(global.fetch.mock.calls.some(([url]) => url.includes('driver=pool.drbd'))).toBe(true);
            delete Element.prototype.scrollIntoView;
        });

        test('seeded with the file as stored, secrets in clear: a value changed, set alone', async () => {
            renderConfig();
            const dialog = await openDesigner(user);
            expect(configFileGets().map(([url]) => url)).toEqual(expect.arrayContaining([expect.stringContaining('redact-secrets=false')]));
            const sections = within(within(dialog).getByRole('navigation', {name: 'Sections'})).getAllByRole('button').map((b) => b.textContent);
            expect(sections.join(' ')).toMatch(/DEFAULT.*fs#1/);
            const orchestrate = within(dialog).getByRole('textbox', {name: 'Value of orchestrate'});
            expect(orchestrate).toHaveValue('ha');
            expect(within(dialog).getByRole('textbox', {name: 'Value of nodes'})).toHaveValue('*');
            // Nothing changed: nothing to apply.
            expect(within(dialog).getByRole('button', {name: 'No change'})).toBeDisabled();
            fireEvent.change(orchestrate, {target: {value: 'no'}});
            expect(within(within(dialog).getByRole('region', {name: 'Changes'})).getByText('Set orchestrate = no')).toBeInTheDocument();
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Apply 1 change'})));
            await waitFor(() => expect(patches()).toEqual([`${URL_OBJECT}/root/cfg/cfg1/config?set=orchestrate=no&wait=30s`]));
            await waitFor(() => expect(getDialogByTitle('Configuration design')).toBeUndefined());
            expect(tray()[0]).toEqual(['Set orchestrate = no', 'root/cfg/cfg1', 'succeeded', null]);
        });

        test('a keyword removed unset, a resource removed deleted, in the same request', async () => {
            renderConfig();
            const dialog = await openDesigner(user);
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Remove nodes'})));
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Remove fs#1'})));
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Apply 2 changes'})));
            await waitFor(() => expect(patches()).toEqual([`${URL_OBJECT}/root/cfg/cfg1/config?unset=nodes&delete=fs#1&wait=30s`]));
        });

        test('cancelled, nothing written; opened again, read again from the file', async () => {
            renderConfig();
            let dialog = await openDesigner(user);
            fireEvent.change(within(dialog).getByRole('textbox', {name: 'Value of orchestrate'}), {target: {value: 'no'}});
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Cancel'})));
            expect(patches()).toEqual([]);
            const reads = configFileGets().length;
            dialog = await openDesigner(user);
            await waitFor(() => expect(within(dialog).getByRole('textbox', {name: 'Value of orchestrate'})).toHaveValue('ha'));
            expect(configFileGets().length).toBeGreaterThan(reads);
        });

        test('changes designed: a stray Escape keeps them, the dialog open; Cancel discards them', async () => {
            renderConfig();
            const dialog = await openDesigner(user);
            fireEvent.change(within(dialog).getByRole('textbox', {name: 'Value of orchestrate'}), {target: {value: 'no'}});
            fireEvent.keyDown(within(dialog).getByRole('textbox', {name: 'Value of orchestrate'}), {key: 'Escape'});
            expect(getDialogByTitle('Configuration design')).toBe(dialog);
            expect(within(dialog).getByRole('textbox', {name: 'Value of orchestrate'})).toHaveValue('no');
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Cancel'})));
            expect(screen.queryByRole('navigation', {name: 'Sections'})).toBeNull();
            expect(patches()).toEqual([]);
        });

        test('a value on several lines: edited in a field of several lines, its line breaks kept', async () => {
            global.fetch.mockImplementation((url, options) => (url.includes('/config/file')
                ? Promise.resolve({ok: true, status: 200, text: () => Promise.resolve('[DEFAULT]\nnodes = *\n\n[task#1]\ncommand = echo a\n    echo b\n')})
                : defaultFetchMock(url, options)));
            renderConfig();
            const dialog = await openDesigner(user);
            const sections = within(dialog).getByRole('navigation', {name: 'Sections'});
            await act(() => user.click(within(sections).getAllByRole('button', {name: /task#1/})[0]));
            const command = await within(dialog).findByRole('textbox', {name: 'Value of command'});
            expect(command.tagName).toBe('TEXTAREA');
            expect(command.value).toContain('\n');
        });

        test('a file that can not be read: said', async () => {
            global.fetch.mockImplementation((url, options) => (url.includes('/config/file')
                ? Promise.resolve({ok: false, status: 403, text: () => Promise.resolve('')})
                : defaultFetchMock(url, options)));
            renderConfig();
            const open = await screen.findByRole('button', {name: 'Design the configuration'});
    await act(() => user.click(open));
            const dialog = getDialogByTitle('Configuration design');
            expect(await within(dialog).findByText(/HTTP 403/)).toBeInTheDocument();
            expect(within(dialog).queryByRole('navigation', {name: 'Sections'})).toBeNull();
        });

        test('written, with no instance to read the file from: nothing read again', async () => {
            renderConfig({configNode: null, inline: true});
            const dialog = await openDesigner(user);
            fireEvent.change(within(dialog).getByRole('textbox', {name: 'Value of orchestrate'}), {target: {value: 'no'}});
            await act(() => user.click(within(dialog).getByRole('button', {name: 'Apply 1 change'})));
            await waitFor(() => expect(patches()).toHaveLength(1));
            expect(defaultProps.setConfigDialogOpen).not.toHaveBeenCalledWith(true);
        });
    });

    // ── Keywords dialog ──────────────────────────────────────────────────
    // ── Keywords help, in place of the keywords dialog ────────────────────
    test('no button lists the keywords: the help of each one stands by its line', async () => {
        renderConfig();
        await screen.findByRole('group', {name: 'Configuration file'});
        // The keywords evaluated have a button of their own (ConfigEvalDialog): no list of them.
        expect(screen.queryByRole('button', {name: /keywords/i})).toHaveAccessibleName('Evaluate the keywords');
    });

    test('each key of the file a button opening what its keyword does, read for it alone by its section and key', async () => {
        renderConfig();
        const file = await screen.findByRole('group', {name: 'Configuration file'});
        expect(within(file).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
            .toEqual(['What nodes does', 'What orchestrate does', 'What fs#1.size does']);
        expect(global.fetch.mock.calls.filter(([url]) => url.includes('/config/keywords?'))).toHaveLength(0);
        fireEvent.click(within(file).getByRole('button', {name: 'What fs#1.size does'}));
        const doc = await screen.findByRole('dialog', {name: 'fs#1.size'});
        expect(await within(doc).findByText('Size of filesystem')).toBeInTheDocument();
        expect(doc).toHaveTextContent('Default1GB');
        expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/config\/keywords\?section=fs%231&option=size$/), expect.any(Object));
        fireEvent.keyDown(doc, {key: 'Escape'});
        expect(screen.queryByRole('dialog', {name: 'fs#1.size'})).not.toBeInTheDocument();
    });
});
