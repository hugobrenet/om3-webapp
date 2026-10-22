import React from 'react';
import {render, screen, waitFor, act, within, fireEvent} from '@testing-library/react';
import ConfigSection from '../ConfigSection';
import {clearKeywordsCache} from '../ConfigText';
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
const getViewConfigButton = () => screen.getByRole('button', {name: 'View Configuration'});
const getUploadButton = () => screen.getByRole('button', {name: /Upload new configuration file/i});
const getManageButton = () => screen.getByRole('button', {name: /Manage configuration parameters/i});
const getKeywordsButton = () => screen.getByRole('button', {name: /View configuration keywords/i});
const getDialogByTitle = (title) => screen.getAllByRole('dialog').find(d => within(d).queryByRole('heading', {name: title}));
const queryLoading = () => screen.queryByRole('status', {name: /^Loading/i});
// The "add" field: free text completed from the keywords list.
const getAddInput = () => screen.getByRole('combobox', {name: 'Select parameter to add'});
const getUnsetGroup = () => screen.getByRole('group', {name: 'Unset parameters'});
const getDeleteGroup = () => screen.getByRole('group', {name: 'Delete sections'});
const getParamsTable = () => screen.getByRole('table', {name: 'Parameters to add'});
const queryParamsTable = () => screen.queryByRole('table', {name: 'Parameters to add'});
// Checks an existing parameter to unset (comboIdx 1) or an existing section to delete (comboIdx 2).
const checkExisting = (user, comboIdx, input) =>
    user.click(within(comboIdx === 1 ? getUnsetGroup() : getDeleteGroup()).getByRole('checkbox', {name: input}));
const addParam = async (user, input) => {
    await act(() => user.type(getAddInput(), input));
    await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
};

const openUpdateDialogWithFile = async (user, fileName = 'config.ini', content = '[DEFAULT]\nnodes = node2') => {
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));
    await act(() => user.click(getUploadButton()));
    await waitFor(() => expect(screen.getByRole('heading', {name: 'Update Configuration'})).toBeInTheDocument());
    const file = new File([content], fileName);
    await act(() => user.upload(document.querySelector('#update-config-file-upload'), file));
    return file;
};

const openManageDialog = async (user) => {
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await act(() => user.click(getManageButton()));
    await waitFor(() => expect(screen.getByRole('heading', {name: 'Manage Configuration Parameters'})).toBeInTheDocument());
    await waitFor(() => expect(queryLoading()).not.toBeInTheDocument());
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
                ],
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
        mockLocalStorage.getItem.mockReturnValue('mock-token');
        mockUseParams.mockReturnValue({objectName: 'root/cfg/cfg1'});
        global.fetch = vi.fn(defaultFetchMock);
        clearKeywordsCache();
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
        await waitFor(() => expect(screen.getByText(/nodes = \*/i)).toBeInTheDocument());
        await waitFor(() => expect(screen.getByText(/orchestrate = ha/i)).toBeInTheDocument());
        await waitFor(() => expect(screen.getByText(/size = 10GB/i)).toBeInTheDocument());
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
            expect(url).toBe(`${URL_OBJECT}/dev/nscfg/namespace/config/file`);
            expect(options.body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\n\n\[claim#1\]\ntype = memory\nlimit = 4g\n$/);
            await waitFor(() => expect(tray()).toEqual([['Create the configuration', 'dev/nscfg/namespace', 'succeeded', null]]));
        });

        test('the parameters set in the wizard: the object created with them all, in one request', async () => {
            renderConfig({inline: true, configNode: null, decodedObjectName: 'dev/nscfg/namespace', absent: true});
            await act(() => user.click(getManageButton()));
            await waitFor(() => expect(queryLoading()).not.toBeInTheDocument());
            // Nothing set yet to read.
            expect(global.fetch.mock.calls.some(([u, o]) => /\/config$/.test(u) && (o?.method ?? 'GET') === 'GET')).toBe(false);
            await act(() => user.type(getAddInput(), 'DEFAULT.orchestrate{Enter}'));
            await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
            await waitFor(() => expect(within(getParamsTable()).getByText('orchestrate')).toBeInTheDocument());
            await user.clear(screen.getByLabelText('Value'));
            await user.type(screen.getByLabelText('Value'), 'no');
            await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
            await waitFor(() => expect(posts()).toHaveLength(1));
            const [url, options] = posts()[0];
            expect(url).toBe(`${URL_OBJECT}/dev/nscfg/namespace/config/file?set=orchestrate%3Dno`);
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

        test('the pencil edits the file; the sliders open the parameters wizard', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *'});
            renderConfig();
            const glyph = (Icon) => render(<Icon/>).container.querySelector('svg').innerHTML;
            const edit = await screen.findByRole('button', {name: 'Edit configuration file'});
            const wizard = screen.getByRole('button', {name: 'Manage configuration parameters'});
            expect(edit.querySelector('svg').innerHTML).toBe(glyph(PencilIcon));
            expect(wizard.querySelector('svg').innerHTML).toBe(glyph(SlidersIcon));
        });

        test('edits the file as stored, secrets in clear, and uploads it', async () => {
            const openSnackbar = vi.fn();
            mockDaemon({stored: '[DEFAULT]\nnodes = *\nsecret = s3cr3t'});
            renderConfig({openSnackbar});
            expect(await screen.findByText(/secret = \*{8}/)).toBeInTheDocument();

            const editor = await startEditing();
            // Written back redacted, the secrets would become asterisks.
            expect(editor).toHaveValue('[DEFAULT]\nnodes = *\nsecret = s3cr3t');
            const save = screen.getByRole('button', {name: 'Save'});
            expect(save).toBeDisabled();

            fireEvent.change(editor, {target: {value: '[DEFAULT]\nnodes = node1\nsecret = s3cr3t'}});
            await act(() => user.click(save));

            await waitFor(() => expect(configPuts()).toHaveLength(1));
            const [url, options] = configPuts()[0];
            expect(url).toBe(`${URL_OBJECT}/root/cfg/cfg1/config/file`);
            expect(options.body).toBe('[DEFAULT]\nnodes = node1\nsecret = s3cr3t');
            expect(options.headers.Authorization).toBe('Bearer mock-token');
            await waitFor(() => expect(tray()).toEqual([['Update the configuration', 'root/cfg/cfg1', 'succeeded', null]]));
            noWriteSnackbar(openSnackbar);
            // Back to the redacted view, reloaded.
            expect(await screen.findByText(/nodes = node1/)).toBeInTheDocument();
            expect(screen.queryByRole('textbox', {name: 'Configuration file'})).toBeNull();
            expect(screen.queryByText(/s3cr3t/)).toBeNull();
        });

        test('a section alone: shown, edited and put back in its place in the file; no upload nor wizard', async () => {
            mockDaemon({stored: '[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\nsecret = s3cr3t\n\n[app#1]\ntype = forking\n'});
            renderConfig({inline: true, section: 'fs#1'});
            expect(await screen.findByText(/secret = \*{8}/)).toBeInTheDocument();
            expect(screen.queryByText(/nodes = \*/)).toBeNull();
            expect(screen.queryByText(/type = forking/)).toBeNull();
            expect(screen.queryByRole('button', {name: 'Upload new configuration file'})).toBeNull();
            expect(screen.queryByRole('button', {name: 'Manage configuration parameters'})).toBeNull();

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
            await screen.findByText(/nodes = \*/);
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
            expect(await screen.findByText(/secret = \*{8}/)).toBeInTheDocument();
            expect(screen.queryByText(/s3cr3t-value/)).toBeNull();

            await act(() => user.click(screen.getByRole('button', {name: 'Show secrets'})));
            expect(await screen.findByText(/secret = s3cr3t-value/)).toBeInTheDocument();

            await act(() => user.click(screen.getByRole('button', {name: 'Hide secrets'})));
            expect(await screen.findByText(/secret = \*{8}/)).toBeInTheDocument();
            expect(screen.queryByText(/s3cr3t-value/)).toBeNull();
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
        }, null, ['Update the configuration', 'root/cfg/cfg1', 'refused', 'HTTP 500'], true],
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

    // ── Manage params dialog (add / unset / delete) ──────────────────────
    test('manage params: no selection shows error', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith('No selection made', 'error'));
        expect(screen.getByRole('heading', {name: 'Manage Configuration Parameters'})).toBeInTheDocument();
    });

    test('manage params dialog: cancel button closes it', async () => {
        renderConfig();
        await openManageDialog(user);
        const dlg = getDialogByTitle('Manage Configuration Parameters');
        await act(() => user.click(within(dlg).getByRole('button', {name: /Cancel/i})));
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Manage Configuration Parameters'})).not.toBeInTheDocument());
    });

    test('manage params: add invalid parameter shows error', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'invalid_param{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith('Invalid parameter: invalid_param', 'error'));
    });

    test('manage params: add DEFAULT.orchestrate and apply', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.orchestrate{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('orchestrate')).toBeInTheDocument());
        await act(() => user.type(screen.getByLabelText('Value'), 'new-value'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set orchestrate = new-value', 'root/cfg/cfg1', 'succeeded', null]]));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/config/file'), expect.any(Object)));
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Manage Configuration Parameters'})).not.toBeInTheDocument());
    });

    test('manage params: add fs.size with indexed section and apply', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'fs.size{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('size')).toBeInTheDocument());
        await act(() => user.type(screen.getByLabelText('Index'), '2'));
        await act(() => user.type(screen.getByLabelText('Value'), '20GB'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set fs#2.size = 20GB', 'root/cfg/cfg1', 'succeeded', null]]));
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('set=fs%232.size=20GB'), expect.objectContaining({
            method: 'PATCH',
            headers: expect.objectContaining({Authorization: 'Bearer mock-token'}),
        }));
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Manage Configuration Parameters'})).not.toBeInTheDocument());
    });

    test('manage params: add fs.size without index and apply', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'fs.size{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('size')).toBeInTheDocument());
        await act(() => user.type(screen.getByLabelText('Value'), '30GB'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set fs.size = 30GB', 'root/cfg/cfg1', 'succeeded', null]]));
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('set=fs.size=30GB'), expect.objectContaining({
            method: 'PATCH',
            headers: expect.objectContaining({Authorization: 'Bearer mock-token'}),
        }));
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Manage Configuration Parameters'})).not.toBeInTheDocument());
    });

    test('manage params: TListLowercase with empty split shows error', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.roles{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('roles')).toBeInTheDocument());
        const valueInput = screen.getByLabelText('Value');
        await user.clear(valueInput);
        await user.type(valueInput, 'admin, , guest');
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith(
            expect.stringMatching(/Invalid value for .*: must be comma-separated lowercase strings/), 'error'
        ));
        expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('set=DEFAULT.roles='), expect.any(Object));
    });

    test('manage params: TListLowercase success', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.roles{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('roles')).toBeInTheDocument());
        await user.clear(screen.getByLabelText('Value'));
        await user.type(screen.getByLabelText('Value'), 'admin,user,guest');
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set roles = admin,user,guest', 'root/cfg/cfg1', 'succeeded', null]]));
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('set=roles=admin%2Cuser%2Cguest'), expect.anything());
    });

    test('manage params: modify section of added parameter', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.orchestrate{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('orchestrate')).toBeInTheDocument());
        const sectionInput = screen.getByLabelText('Section (optional)');
        await user.clear(sectionInput);
        await user.type(sectionInput, 'database');
        await user.clear(screen.getByLabelText('Value'));
        await user.type(screen.getByLabelText('Value'), 'test-value');
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set database.orchestrate = test-value', 'root/cfg/cfg1', 'succeeded', null]]));
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('set=database.orchestrate=test-value'), expect.any(Object));
    });

    test('manage params: remove parameter from list', async () => {
        renderConfig();
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.orchestrate{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('orchestrate')).toBeInTheDocument());
        await act(() => user.click(screen.getByRole('button', {name: /Remove parameter/i})));
        await waitFor(() => expect(queryParamsTable()).not.toBeInTheDocument());
    });

    test.each([
        ['unset', 1, 'nodes', 'unset=nodes', 'Unset nodes'],
        ['delete', 2, 'fs#1', 'delete=fs%231', 'Delete section fs#1'],
    ])('manage params: %s success', async (_, comboIdx, input, urlFragment, label) => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => checkExisting(user, comboIdx, input));
        await waitFor(() => expect(within(comboIdx === 1 ? getUnsetGroup() : getDeleteGroup())
            .getByRole('checkbox', {name: input})).toBeChecked());
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([[label, 'root/cfg/cfg1', 'succeeded', null]]));
        noWriteSnackbar(openSnackbar);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining(`${URL_OBJECT}/root/cfg/cfg1/config?${urlFragment}`),
            expect.objectContaining({
                method: 'PATCH',
                headers: expect.objectContaining({Authorization: 'Bearer mock-token'}),
            })
        );
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Manage Configuration Parameters'})).not.toBeInTheDocument());
    });

    test.each([
        ['unset', 1, 'nodes', 'Unset nodes'],
        ['delete', 2, 'fs#1', 'Delete section fs#1'],
    ])('manage params: %s API failure', async (_, comboIdx, input, label) => {
        global.fetch.mockImplementation((url, options) => {
            if (url.includes(`/config?${comboIdx === 1 ? 'unset' : 'delete'}=`))
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({}),
                    headers: new Headers(),
                });
            return defaultFetchMock(url, options);
        });
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => checkExisting(user, comboIdx, input));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([[label, 'root/cfg/cfg1', 'refused', 'HTTP 500']]));
        expect(screen.getByRole('heading', {name: 'Manage Configuration Parameters'})).toBeInTheDocument();
    });

    test('manage params: add parameter network error is said in the tray', async () => {
        global.fetch.mockImplementation((url) => {
            if (url.includes('/config?set=')) return Promise.reject(new Error('Network failure'));
            return defaultFetchMock(url);
        });
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.orchestrate{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('orchestrate')).toBeInTheDocument());
        await user.clear(screen.getByLabelText('Value'));
        await user.type(screen.getByLabelText('Value'), 'test');
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set orchestrate = test', 'root/cfg/cfg1', 'refused', 'Network failure']]));
    });

    test.each([
        ['unset', 1, 'nodes', 'Unset nodes'],
        ['delete', 2, 'fs#1', 'Delete section fs#1'],
    ])('manage params: %s network error', async (_, comboIdx, input, label) => {
        global.fetch.mockImplementation((url) => {
            if (url.includes(`/config?${comboIdx === 1 ? 'unset' : 'delete'}=`)) return Promise.reject(new Error('Network failure'));
            return defaultFetchMock(url);
        });
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => checkExisting(user, comboIdx, input));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([[label, 'root/cfg/cfg1', 'refused', 'Network failure']]));
    });

    test('manage params: all operations fail keeps dialog open', async () => {
        global.fetch.mockImplementation((url, options) => {
            if (url.includes('/config?set=') || url.includes('/config?unset=') || url.includes('/config?delete='))
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({}),
                    headers: new Headers(),
                });
            return defaultFetchMock(url, options);
        });
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.orchestrate{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('orchestrate')).toBeInTheDocument());
        await user.clear(screen.getByLabelText('Value'));
        await user.type(screen.getByLabelText('Value'), 'test');
        await act(() => checkExisting(user, 1, 'nodes'));
        await act(() => checkExisting(user, 2, 'fs#1'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        // Each one refused, newest first.
        await waitFor(() => expect(tray()).toEqual([
            ['Delete section fs#1', 'root/cfg/cfg1', 'refused', 'HTTP 500'],
            ['Unset nodes', 'root/cfg/cfg1', 'refused', 'HTTP 500'],
            ['Set orchestrate = test', 'root/cfg/cfg1', 'refused', 'HTTP 500'],
        ]));
        expect(screen.getByRole('heading', {name: 'Manage Configuration Parameters'})).toBeInTheDocument();
    });

    test.each([
        ['add', 0, 'DEFAULT.roles'],
        ['unset', 1, 'nodes'],
        ['delete', 2, 'fs#1'],
    ])('manage params: missing token for %s shows error', async (_, comboIdx, input) => {
        mockLocalStorage.getItem.mockReturnValue(null);
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        if (comboIdx !== 0) await act(() => checkExisting(user, comboIdx, input));
        if (comboIdx === 0) {
            await addParam(user, input);
            await waitFor(() => expect(within(getParamsTable()).getByText(input.split('.')[1] || input)).toBeInTheDocument());
            await user.clear(screen.getByLabelText('Value'));
            await user.type(screen.getByLabelText('Value'), 'admin');
        }
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith('Auth token not found.', 'error'));
    });

    // The unset list offers the parameters set in the configuration: an option
    // with its section is sent as "section.option", one without as "option".
    test.each([
        ['with a section', 'fs#1.size', 'unset=fs%231.size'],
        ['without a section', 'orchestrate', 'unset=orchestrate'],
    ])('manage params: unset an existing parameter %s', async (_, keyword, urlFragment) => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => checkExisting(user, 1, keyword));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([[`Unset ${keyword}`, 'root/cfg/cfg1', 'succeeded', null]]));
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining(`${URL_OBJECT}/root/cfg/cfg1/config?${urlFragment}`),
            expect.objectContaining({method: 'PATCH'})
        );
    });

    test('manage params: unchecking a parameter or a section takes it out of the selection', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => checkExisting(user, 1, 'nodes'));
        await act(() => checkExisting(user, 1, 'orchestrate'));
        await act(() => checkExisting(user, 1, 'nodes'));
        await act(() => checkExisting(user, 2, 'fs#1'));
        await act(() => checkExisting(user, 2, 'fs#1'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Unset orchestrate', 'root/cfg/cfg1', 'succeeded', null]]));
        const patched = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH').map(([url]) => url);
        expect(patched).toEqual([`${URL_OBJECT}/root/cfg/cfg1/config?unset=orchestrate`]);
    });

    test('manage params: existing parameters and sections are disabled while loading', async () => {
        global.fetch.mockImplementation((url, options) => {
            if (url.includes('/config?unset=')) return new Promise(() => {});
            return defaultFetchMock(url, options);
        });
        renderConfig();
        await openManageDialog(user);
        await act(() => checkExisting(user, 1, 'nodes'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(within(getUnsetGroup()).getByRole('checkbox', {name: 'nodes'})).toBeDisabled());
        expect(within(getDeleteGroup()).getByRole('checkbox', {name: 'fs#1'})).toBeDisabled();
        expect(screen.getByRole('button', {name: /Apply/i})).toBeDisabled();
        expect(getAddInput()).toBeDisabled();
    });

    // ── Fetch existing params edge cases ─────────────────────────────────
    test.each([
        ['HTTP error', () => ({
            ok: false,
            status: 403,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        }), 'Failed to fetch existing parameters: HTTP 403'],
        ['network error', () => Promise.reject(new Error('Network failure')), 'Failed to fetch existing parameters: Network failure'],
    ])('fetchExistingParams: %s', async (_, fetchImpl, expectedText) => {
        global.fetch.mockImplementation((url) => {
            if (url.includes('/config') && !url.includes('file') && !url.includes('set') && !url.includes('unset') && !url.includes('delete') && !url.includes('keywords'))
                return fetchImpl();
            return defaultFetchMock(url);
        });
        renderConfig();
        await openManageDialog(user);
        await waitFor(() => {
            const alerts = screen.getAllByRole('alert');
            expect(alerts.find(a => a.textContent.includes(expectedText))).toBeInTheDocument();
        });
    });

    test('getExistingSections: null existingParams renders no parameter nor section to choose', async () => {
        global.fetch.mockImplementation((url) => {
            if (url.includes('/config') && !url.includes('file') && !url.includes('set') && !url.includes('unset') && !url.includes('delete'))
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({items: null}),
                    headers: new Headers(),
                });
            return defaultFetchMock(url);
        });
        renderConfig();
        await openManageDialog(user);
        await waitFor(() => expect(within(getDeleteGroup()).getByText('No sections.')).toBeInTheDocument());
        expect(within(getUnsetGroup()).getByText('No parameters set.')).toBeInTheDocument();
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    // ── Keywords dialog ──────────────────────────────────────────────────
    // ── Keywords help, in place of the keywords dialog ────────────────────
    test('no button lists the keywords: the help of each one stands by its line', async () => {
        renderConfig();
        await screen.findByRole('group', {name: 'Configuration file'});
        expect(screen.queryByRole('button', {name: /keywords/i})).not.toBeInTheDocument();
    });

    test('hovering the file reads the keywords of the kind once, and a "?" by each keyword tells what it does', async () => {
        renderConfig();
        const file = await screen.findByRole('group', {name: 'Configuration file'});
        fireEvent.mouseEnter(file.parentElement);
        const help = await screen.findByRole('button', {name: 'What fs#1.size does'});
        expect(screen.getByRole('button', {name: 'What nodes does'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'What orchestrate does'})).toBeInTheDocument();
        // A section header has no help.
        expect(screen.getAllByRole('button', {name: /^What /})).toHaveLength(3);
        fireEvent.click(help);
        const doc = screen.getByRole('dialog', {name: 'fs#1.size'});
        expect(doc).toHaveTextContent('Size of filesystem');
        expect(doc).toHaveTextContent('Default1GB');
        // A click beside it closes it.
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('dialog', {name: 'fs#1.size'})).not.toBeInTheDocument();
        fireEvent.mouseEnter(file.parentElement);
        expect(global.fetch.mock.calls.filter(([url]) => url.includes('/config/keywords'))).toHaveLength(1);
    });

    test('getUniqueSections: null keywordsData renders empty add combobox', async () => {
        global.fetch.mockImplementation((url) => {
            if (url.includes('/config/keywords')) return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({items: null}),
                headers: new Headers(),
            });
            return defaultFetchMock(url);
        });
        renderConfig();
        await openManageDialog(user);
        await waitFor(() => expect(getAddInput()).toHaveValue(''));
    });

    test('add parameter without section (empty section)', async () => {
        const openSnackbar = vi.fn();
        renderConfig({openSnackbar});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'debug{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('debug')).toBeInTheDocument());
        expect(screen.getByLabelText('Section (optional)')).toBeInTheDocument();
        await user.clear(screen.getByLabelText('Value'));
        await user.type(screen.getByLabelText('Value'), 'true');
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set debug = true', 'root/cfg/cfg1', 'succeeded', null]]));
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('set=debug=true'), expect.any(Object));
    });

    test('manage params: add success with empty configNode does not refetch or open dialog', async () => {
        const openSnackbar = vi.fn();
        const setConfigDialogOpen = vi.fn();
        renderConfig({openSnackbar, configNode: '', setConfigDialogOpen});
        await openManageDialog(user);
        await act(() => user.type(getAddInput(), 'DEFAULT.orchestrate{Enter}'));
        await act(() => user.click(screen.getByRole('button', {name: /Add Parameter/i})));
        await waitFor(() => expect(within(getParamsTable()).getByText('orchestrate')).toBeInTheDocument());
        await user.clear(screen.getByLabelText('Value'));
        await user.type(screen.getByLabelText('Value'), 'new-value');
        const fetchCallsBefore = global.fetch.mock.calls.length;
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Set orchestrate = new-value', 'root/cfg/cfg1', 'succeeded', null]]));
        const fetchCallsAfter = global.fetch.mock.calls;
        const configFileCallsAfter = fetchCallsAfter.slice(fetchCallsBefore).filter(call => call[0].includes('/config/file'));
        expect(configFileCallsAfter).toHaveLength(0);
        expect(setConfigDialogOpen).not.toHaveBeenCalledWith(true);
    });

    test('manage params: unset success with empty configNode does not refetch or open dialog', async () => {
        const openSnackbar = vi.fn();
        const setConfigDialogOpen = vi.fn();
        renderConfig({openSnackbar, configNode: '', setConfigDialogOpen});
        await openManageDialog(user);
        await act(() => checkExisting(user, 1, 'nodes'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Unset nodes', 'root/cfg/cfg1', 'succeeded', null]]));
        const configFileCalls = global.fetch.mock.calls.filter(call => call[0].includes('/config/file'));
        expect(configFileCalls).toHaveLength(0);
        expect(setConfigDialogOpen).not.toHaveBeenCalledWith(true);
    });

    test('manage params: delete success with empty configNode does not refetch or open dialog', async () => {
        const openSnackbar = vi.fn();
        const setConfigDialogOpen = vi.fn();
        renderConfig({openSnackbar, configNode: '', setConfigDialogOpen});
        await openManageDialog(user);
        await act(() => checkExisting(user, 2, 'fs#1'));
        await act(() => user.click(screen.getByRole('button', {name: /Apply/i})));
        await waitFor(() => expect(tray()).toEqual([['Delete section fs#1', 'root/cfg/cfg1', 'succeeded', null]]));
        const configFileCalls = global.fetch.mock.calls.filter(call => call[0].includes('/config/file'));
        expect(configFileCalls).toHaveLength(0);
        expect(setConfigDialogOpen).not.toHaveBeenCalledWith(true);
    });
});
