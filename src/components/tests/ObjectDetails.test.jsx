import React, {act} from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {vi} from 'vitest';
import ObjectDetail, {getResourceType, parseProvisionedState} from '../ObjectDetails';
import useEventStore from '../../hooks/useEventStore.js';
import logger from '../../utils/logger';
import {useActionTracker} from '../../app/action-tracker';

/** What the actions tray holds, the latest first: action, state, reason. */
const tray = () => useActionTracker.getState().tracked.map((e) => [e.action, e.state, e.error ?? null]);

// ── Hoisted variables for use in vi.mock factories ──────────────────────
const {
    mockUseParams,
    mockUseNavigate,
    mockNavigate,
    mockLocalStorage,
} = vi.hoisted(() => {
    const mockNavigate = vi.fn();
    return {
        mockUseParams: vi.fn(),
        mockUseNavigate: vi.fn(() => mockNavigate),
        mockNavigate,
        mockLocalStorage: {
            getItem: vi.fn(() => 'mock-token'),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        },
    };
});

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useParams: mockUseParams,
        useNavigate: mockUseNavigate,
    };
});

vi.mock('../../hooks/useEventStore.js', () => ({
    __esModule: true,
    default: Object.assign(vi.fn(), {
        getState: vi.fn(),
        subscribe: vi.fn(),
        setState: vi.fn(),
    }),
}));

const {mockRetainEventReception, mockReleaseEventReception} = vi.hoisted(() => ({
    mockRetainEventReception: vi.fn(),
    mockReleaseEventReception: vi.fn(),
}));

vi.mock('../../eventSourceManager.jsx', () => ({
    retainEventReception: (...args) => {
        mockRetainEventReception(...args);
        return mockReleaseEventReception;
    },
    clearEventBuffers: vi.fn(),
    startLoggerReception: vi.fn(),
    closeLoggerEventSource: vi.fn(),
}));

vi.mock('../../context/DarkModeContext', () => ({
    useDarkMode: () => ({
        isDarkMode: false,
        toggleDarkMode: vi.fn(),
    }),
}));

vi.mock('../../utils/logger', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../ConfigSection', () => ({
    __esModule: true,
    default: (props) => {
        const {decodedObjectName, configNode, configDialogOpen, setConfigDialogOpen} = props;
        return (
            <div>
                <button onClick={() => setConfigDialogOpen(true)} data-testid="open-config-dialog">
                    View Configuration
                </button>
                {configDialogOpen && (
                    <div role="dialog" data-testid="config-dialog">
                        <div>Configuration for {decodedObjectName}</div>
                        {configNode && <div>Node: {configNode}</div>}
                    </div>
                )}
            </div>
        );
    },
}));

vi.mock('../../constants/actions', async (importOriginal) => ({
    ...(await importOriginal()),
    OBJECT_ACTIONS: [
        {name: 'start', icon: 'StartIcon', endpoint: 'action/start'},
        {name: 'stop', icon: 'StopIcon', endpoint: 'action/stop'},
        {name: 'freeze', icon: 'FreezeIcon', endpoint: 'action/freeze'},
        {name: 'unprovision', icon: 'UnprovisionIcon', endpoint: 'action/unprovision'},
        {name: 'purge', icon: 'PurgeIcon', endpoint: 'action/purge'},
        {name: 'enable', icon: 'EnableIcon', endpoint: 'enable', kinds: ['svc']},
        {name: 'disable', icon: 'DisableIcon', endpoint: 'disable', kinds: ['svc'], color: 'red'},
    ],
    INSTANCE_ACTIONS: [
        {name: 'start', icon: 'StartIcon', endpoint: 'start'},
        {name: 'stop', icon: 'StopIcon', endpoint: 'stop'},
        {name: 'freeze', icon: 'FreezeIcon', endpoint: 'freeze'},
        {name: 'unprovision', icon: 'UnprovisionIcon', endpoint: 'unprovision'},
        {name: 'purge', icon: 'PurgeIcon', endpoint: 'purge'},
        {name: 'start standby', icon: 'StartStandbyIcon', endpoint: 'startstandby'},
        {name: 'pg reset', icon: 'PgResetIcon', endpoint: 'pg/reset'},
    ],
    RESOURCE_ACTIONS: [
        {name: 'start', icon: 'StartIcon'},
        {name: 'stop', icon: 'StopIcon'},
        {name: 'run', icon: 'RunIcon'},
        {name: 'unprovision', icon: 'UnprovisionIcon'},
        {name: 'purge', icon: 'PurgeIcon'},
    ],
}));

vi.mock('../LogsViewer.jsx', () => ({
    default: ({nodename, height}) => (
        <div data-testid="logs-viewer" data-nodename={nodename} style={{height}}>
            Logs Viewer Mock
        </div>
    ),
}));

vi.mock('../../services/api.jsx', () => ({
    getResponseErrorMessage: vi.fn(() => 'Server error'),
}));

Object.defineProperty(global, 'localStorage', {value: mockLocalStorage});
Object.defineProperty(global.navigator, 'clipboard', {
    value: {writeText: vi.fn()},
    configurable: true,
    writable: true,
});

// ── State factories ─────────────────────────────────────────────────────
const BASE_FNS = () => ({
    configUpdates: [],
    clearConfigUpdate: vi.fn(),
    removeObject: vi.fn(),
    setObjectStatuses: vi.fn(),
    setInstanceStatuses: vi.fn(),
    setInstanceConfig: vi.fn(),
    setInstanceMonitors: vi.fn(),
});

const emptyState = () => ({
    objectStatus: {},
    objectInstanceStatus: {},
    instanceMonitor: {},
    instanceConfig: {},
    ...BASE_FNS(),
});

const buildState = (overrides = {}) => ({
    objectStatus: {'root/svc/svc1': {avail: 'up', frozen: null}},
    objectInstanceStatus: {
        'root/svc/svc1': {
            node1: {
                avail: 'up',
                frozen_at: null,
                resources: {
                    res1: {status: 'up', label: 'R1', type: 'disk', provisioned: {state: 'true'}, running: true},
                },
            },
            node2: {
                avail: 'down',
                frozen_at: null,
                resources: {
                    res2: {status: 'warn', label: 'R2', type: 'compute', provisioned: {state: 'true'}, running: false},
                },
            },
        },
    },
    instanceMonitor: {
        'node1:root/svc/svc1': {state: 'running', global_expect: 'placed@node1', resources: {}},
        'node2:root/svc/svc1': {state: 'idle', global_expect: 'none', resources: {}},
    },
    instanceConfig: {
        'root/svc/svc1': {
            node1: {resources: {res1: {is_monitored: true, is_disabled: false, is_standby: false, restart: 0}}},
        },
    },
    ...BASE_FNS(),
    ...overrides,
});

const fullMockState = {
    objectStatus: {
        'root/cfg/cfg1': {avail: 'up', frozen: 'frozen'},
        'root/svc/svc1': {avail: 'up', frozen: null},
    },
    objectInstanceStatus: {
        'root/cfg/cfg1': {
            node1: {
                avail: 'up',
                frozen_at: null,
                resources: {
                    res1: {
                        status: 'up',
                        label: 'Resource 1',
                        type: 'disk',
                        provisioned: {state: 'true'},
                        running: true
                    },
                    res2: {
                        status: 'down',
                        label: 'Resource 2',
                        type: 'task',
                        provisioned: {state: 'false'},
                        running: false
                    },
                },
            },
            node2: {
                avail: 'down',
                frozen_at: null,
                resources: {
                    res3: {
                        status: 'warn',
                        label: 'Resource 3',
                        type: 'compute',
                        provisioned: {state: 'true'},
                        running: false
                    },
                },
            },
        },
        'root/svc/svc1': {
            node1: {
                avail: 'up',
                frozen_at: null,
                resources: {
                    res1: {
                        status: 'up',
                        label: 'Resource 1',
                        type: 'disk',
                        provisioned: {state: 'true'},
                        running: true
                    },
                    res2: {
                        status: 'down',
                        label: 'Resource 2',
                        type: 'task',
                        provisioned: {state: 'false'},
                        running: false
                    },
                    res5: {status: 'up', label: 'Resource 5', type: 'ip', provisioned: true, running: true},
                },
                encap: {
                    container1: {
                        resources: {
                            res4: {
                                status: 'up',
                                label: 'Encap Resource 1',
                                type: 'container',
                                provisioned: {state: 'true'},
                                running: true
                            },
                        },
                    },
                },
            },
            node2: {
                avail: 'down',
                frozen_at: null,
                resources: {
                    res3: {
                        status: 'warn',
                        label: 'Resource 3',
                        type: 'compute',
                        provisioned: {state: 'true'},
                        running: false
                    },
                },
            },
        },
    },
    instanceMonitor: {
        'node1:root/cfg/cfg1': {
            state: 'running',
            global_expect: 'placed@node1',
            resources: {res1: {restart: {remaining: 0}}}
        },
        'node1:root/svc/svc1': {
            state: 'running',
            global_expect: 'placed@node1',
            resources: {res1: {restart: {remaining: 0}}}
        },
        'node2:root/svc/svc1': {state: 'idle', global_expect: 'none', resources: {res3: {restart: {remaining: 0}}}},
    },
    instanceConfig: {
        'root/cfg/cfg1': {
            node1: {resources: {res1: {is_monitored: true, is_disabled: false, is_standby: false, restart: 0}}},
        },
        'root/svc/svc1': {
            node1: {
                resources: {
                    res1: {is_monitored: true, is_disabled: false, is_standby: false, restart: 0},
                    res2: {is_monitored: true, is_disabled: false, is_standby: false, restart: 0},
                },
            },
            node2: {resources: {}},
        },
    },
    ...BASE_FNS(),
};

// ── Render helpers ────────────────────────────────────────────────────────
const renderComponent = (objectName) => {
    mockUseParams.mockReturnValue({objectName});
    return render(
        <MemoryRouter initialEntries={[`/object/${encodeURIComponent(objectName)}`]}>
            <Routes>
                <Route path="/object/:objectName" element={<ObjectDetail/>}/>
            </Routes>
        </MemoryRouter>
    );
};

const renderSvc = (objectName = 'root/svc/svc1') => renderComponent(objectName);
const waitForNode = (name) => screen.findByText(name, {}, {timeout: 10000});
const renderReadySvc = async () => {
    renderSvc();
    await waitForNode('node1');
    await waitForNode('node2');
};

const setStoreState = (state) => {
    vi.mocked(useEventStore).mockImplementation((s) => s(state));
    vi.mocked(useEventStore.getState).mockReturnValue(state);
};

// ── Action helpers ────────────────────────────────────────────────────────
// The logs side panel (SlideOver) is a non-modal dialog that stays mounted, inert while
// closed: the action dialogs are the dialogs that are not inert.
const actionDialogs = () => screen.queryAllByRole('dialog').filter((d) => !d.hasAttribute('inert'));
const findActionDialog = () =>
    waitFor(() => {
        const dialogs = actionDialogs();
        expect(dialogs).toHaveLength(1);
        return dialogs[0];
    });
const logsPanel = () => screen.getByRole('dialog', {name: /Logs/});
// Feedback messages: errors are alerts, the others status messages.
const feedbackWith = (text) =>
    [...screen.queryAllByRole('alert'), ...screen.queryAllByRole('status')].find((a) => a.textContent?.includes(text));
// Menu entries by their exact name: 'Start' must not match 'Start standby'.
const getMenuItemByLabel = (label, menu = null) => {
    const scope = menu ? within(menu) : screen;
    return scope.getByRole('menuitem', {name: label});
};

const queryMenuItemByLabel = (label, menu = null) => {
    const scope = menu ? within(menu) : screen;
    return scope.queryByRole('menuitem', {name: label});
};

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const confirmDialog = async (dialog) => {
    const cb = within(dialog).queryByRole('checkbox', {name: /confirm/i});
    if (cb) await userEvent.click(cb);
    await userEvent.click(
        within(dialog).getByRole('button', {name: /confirm|submit|ok|execute|apply|proceed|accept|stop|delete/i})
    );
};

const mockNetworkFailure = (urlPattern) => {
    global.fetch.mockImplementation((url) =>
        url.includes(urlPattern)
            ? Promise.reject(new Error('Network error'))
            : Promise.resolve({ok: true, text: () => Promise.resolve('')})
    );
};

const mockActionFailure = (status = 500, message = 'Server error') => {
    global.fetch.mockImplementation((url, options) =>
        options?.method === 'POST' && url.includes('/action/')
            ? Promise.resolve({ok: false, status, text: () => Promise.resolve(message)})
            : Promise.resolve({ok: true, text: () => Promise.resolve('')})
    );
};

const expandResourceSections = async () => {
    const expandIcons = screen.queryAllByText('ExpandMore');
    for (const icon of expandIcons) {
        const btn = icon.closest('button') || icon.parentElement;
        if (btn) {
            try {
                await userEvent.click(btn);
            } catch (e) {
                // ignore
            }
        }
    }
};

const defaultFetchMock = (url, options) => {
    if (url.includes('/data/keys'))
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    items: [
                        {name: 'key1', node: 'node1', size: 2626},
                        {name: 'key2', node: 'node1', size: 6946},
                    ],
                }),
            text: () => Promise.resolve(''),
        });
    if (url.includes('/config?set=') || url.includes('/config?unset=') || url.includes('/config?delete='))
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({}),
            text: () => Promise.resolve('Success'),
        });
    if (url.includes('/config/file'))
        return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(`[DEFAULT]\nnodes = *\norchestrate = ha\nid = 0bfea9c4-0114-4776-9169-d5e3455cee1f\n[fs#1]\ntype = flag`),
            json: () => Promise.resolve({}),
        });
    if (options?.method === 'POST' && url.includes('/action/'))
        return Promise.resolve({ok: true, status: 200, text: () => Promise.resolve('Action executed successfully')});
    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('')});
};

// ── Tests ─────────────────────────────────────────────────────────────────
describe('ObjectDetail Component', () => {
    const user = userEvent.setup();

    beforeEach(() => {
        vi.clearAllMocks();
        useActionTracker.setState({tracked: [], revealed: 0});
        mockUseNavigate.mockReturnValue(mockNavigate);
        mockLocalStorage.getItem.mockReturnValue('mock-token');
        global.fetch = vi.fn(defaultFetchMock);
        vi.mocked(useEventStore).mockImplementation((selector) => selector(fullMockState));
        vi.mocked(useEventStore.getState).mockReturnValue(fullMockState);
        vi.mocked(useEventStore.subscribe).mockReturnValue(vi.fn());
    });

    afterEach(() => vi.clearAllMocks());

    // ─── Pure function tests ───────────────────────────────────────────────
    describe('getResourceType', () => {
        test.each([
            [null, {}, ''],
            ['', {}, ''],
            ['rid1', null, ''],
            ['rid1', undefined, ''],
            [null, null, ''],
            [undefined, undefined, ''],
            ['notfound', {resources: {}, encap: {c1: {resources: {}}}}, ''],
            ['rid1', {resources: {}, encap: {}}, ''],
            ['rid1', {resources: {rid1: {type: 'disk.disk'}}}, 'disk.disk'],
            ['rid2', {resources: {rid2: {type: 'fs.flag'}}}, 'fs.flag'],
            ['rid2', {
                resources: {},
                encap: {container1: {resources: {rid2: {type: 'container.docker'}}}}
            }, 'container.docker'],
            ['r3', {resources: {r1: {type: 'disk'}}, encap: {c1: {resources: {r2: {type: 'container'}}}}}, ''],
        ])('getResourceType(%p, %p) => %p', (rid, nodeData, expected) =>
            expect(getResourceType(rid, nodeData)).toBe(expected)
        );
    });

    describe('parseProvisionedState', () => {
        test.each([
            ['true', true], ['True', true], ['TRUE', true], ['tRuE', true],
            ['false', false], ['False', false], ['FALSE', false], ['fAlSe', false],
            ['yes', false], ['no', false], ['', false], ['abc', false], ['1', false], ['0', false],
            [true, true], [false, false], [1, true], [0, false], [42, true], [-1, true],
            [{}, true], [{state: true}, true], [[], true], [new Date(), true],
            [null, false], [undefined, false], [NaN, false],
        ])('%p => %p', (input, expected) => expect(parseProvisionedState(input)).toBe(expected));
    });

    // ─── Lifecycle ────────────────────────────────────────────────────────
    test('mount/unmount lifecycle', () => {
        const {unmount} = renderComponent('root/cfg/cfg1');
        expect(localStorage.getItem).toHaveBeenCalledWith('authToken');
        expect(mockRetainEventReception).toHaveBeenCalledWith('mock-token', expect.any(Array), 'root/cfg/cfg1');
        expect(vi.mocked(useEventStore.getState)().removeObject).toHaveBeenCalledWith('root/cfg/cfg1');
        unmount();
        expect(mockReleaseEventReception).toHaveBeenCalled();
    });

    // ── Basic rendering ──────────────────────────────────────────────────
    test('renders svc with nodes and monitor', async () => {
        renderSvc();
        await waitForNode('node1');
        await waitForNode('node2');
        expect(screen.getByText(/running/i)).toBeInTheDocument();
        expect(screen.getByText(/placed@node1/i)).toBeInTheDocument();
        expect(screen.queryByText(/Resources \(\d+\)/i)).not.toBeInTheDocument();
    });

    test('shows no data message when object data is empty', async () => {
        setStoreState({...emptyState(), objectInstanceStatus: {'root/cfg/cfg1': {}}});
        global.fetch.mockImplementation((url) =>
            url.includes('/data/keys')
                ? Promise.resolve({ok: true, json: () => Promise.resolve({items: []})})
                : Promise.resolve({ok: true, json: () => Promise.resolve({}), text: () => ''})
        );
        renderComponent('root/cfg/cfg1');
        await waitFor(() => expect(screen.getByText(/No keys available/i)).toBeInTheDocument());
    });

    test('cfg kind hides node cards and batch actions', async () => {
        renderComponent('root/cfg/cfg1');
        await screen.findByText(/root\/cfg\/cfg1/i);
        await waitFor(() => {
            expect(screen.queryAllByRole('group', {name: /Instance on node/})).toHaveLength(0);
            expect(screen.queryByRole('heading', {name: /Instances/})).not.toBeInTheDocument();
            expect(screen.queryByRole('button', {name: /Actions on Selected Nodes/i})).not.toBeInTheDocument();
        });
    });

    test.each([['root/sec/sec1'], ['root/usr/usr1']])(
        'batch actions hidden for %s',
        async (objectName) => {
            setStoreState({
                objectStatus: {[objectName]: {avail: 'up', frozen: null}},
                objectInstanceStatus: {[objectName]: {node1: {avail: 'up', resources: {}}}},
                instanceMonitor: {},
                instanceConfig: {},
                ...BASE_FNS(),
            });
            renderComponent(objectName);
            await screen.findByText(new RegExp(objectName.replace(/\//g, '\\/'), 'i'));
            expect(screen.queryByRole('button', {name: /Actions on Selected Nodes/i})).not.toBeInTheDocument();
        }
    );

    test('renders warn / unknown / frozen node states', async () => {
        const state = buildState();
        state.objectStatus['root/svc/svc1'].avail = 'warn';
        state.objectInstanceStatus['root/svc/svc1'].node1.avail = 'unknown';
        state.objectInstanceStatus['root/svc/svc1'].node1.frozen_at = '2023-01-01T12:00:00Z';
        setStoreState(state);
        renderSvc();
        await waitFor(() => expect(screen.getByTitle('Object status: warn')).toHaveAttribute('data-state', 'warn'));
        expect(screen.getByText('node1', {exact: true})).toBeInTheDocument();
        const node1 = screen.getByRole('group', {name: 'Instance on node node1'});
        expect(node1.querySelector('[data-state]')).toHaveAttribute('data-state', 'unknown');
        expect(within(node1).getByTitle('frozen')).toBeInTheDocument();
        const node2 = screen.getByRole('group', {name: 'Instance on node node2'});
        expect(node2.querySelector('[data-state]')).toHaveAttribute('data-state', 'down');
        expect(within(node2).queryByTitle('frozen')).not.toBeInTheDocument();
    });

    test('getObjectStatus handles missing global_expect (none)', async () => {
        setStoreState({
            objectStatus: {},
            objectInstanceStatus: {},
            instanceMonitor: {'node1:root/cfg/cfg1': {state: 'running', global_expect: 'none'}},
            instanceConfig: {},
            ...BASE_FNS(),
        });
        renderComponent('root/cfg/cfg1');
        await waitFor(() => expect(screen.queryByText(/placed@node1/i)).not.toBeInTheDocument());
    });

    // ── Config / Keys ────────────────────────────────────────────────────
    test('config dialog opens when button clicked', async () => {
        renderComponent('root/cfg/cfg1');
        fireEvent.click(await screen.findByTestId('open-config-dialog'));
        await waitFor(() => expect(screen.getByTestId('config-dialog')).toBeInTheDocument());
    });

    test('embedded, the keys without the config button: the panel has a tab for it', async () => {
        render(
            <MemoryRouter>
                <ObjectDetail path="root/cfg/cfg1" embedded/>
            </MemoryRouter>
        );
        expect(await screen.findByText('key1')).toBeInTheDocument();
        expect(screen.queryByTestId('open-config-dialog')).not.toBeInTheDocument();
    });

    test('renders keys section for cfg', async () => {
        renderComponent('root/cfg/cfg1');
        expect(await screen.findByRole('heading', {name: /Object Keys/})).toBeInTheDocument();
        expect(await screen.findByText('key1')).toBeInTheDocument();
        expect(screen.getByText('key2')).toBeInTheDocument();
    });

    test('displays no keys message when empty', async () => {
        global.fetch.mockImplementation((url) =>
            url.includes('/data/keys')
                ? Promise.resolve({ok: true, json: () => Promise.resolve({items: []})})
                : Promise.resolve({ok: true, text: () => Promise.resolve(''), json: () => Promise.resolve({})})
        );
        renderComponent('root/cfg/cfg1');
        expect(await screen.findByText(/No keys available/i)).toBeInTheDocument();
    });

    // ── Node selection & navigation ──────────────────────────────────────
    test('node selection toggle', async () => {
        await renderReadySvc();
        const checkbox = screen.getByLabelText(/select node node1/i);
        expect(checkbox.checked).toBe(false);
        await user.click(checkbox);
        expect(checkbox.checked).toBe(true);
        await user.click(checkbox);
        expect(checkbox.checked).toBe(false);
    });

    test('disables batch actions button when no nodes are selected', async () => {
        await renderReadySvc();
        expect(screen.getByRole('button', {name: /Actions on selected nodes/i}).disabled).toBe(true);
    });

    test('view instance navigation on node click', async () => {
        await renderReadySvc();
        fireEvent.click(screen.getByText('node1'));
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/nodes/node1/objects/root%2Fsvc%2Fsvc1'));
    });

    test('switches configNode when current node disappears', async () => {
        const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {
        });
        setStoreState({
            ...buildState(),
            objectInstanceStatus: {'root/svc/svc1': {node2: {avail: 'up', resources: {}}}},
        });

        mockUseParams.mockReturnValue({objectName: 'root/svc/svc1'});
        const {rerender} = render(
            <MemoryRouter initialEntries={['/object/root%2Fsvc%2Fsvc1']}>
                <Routes>
                    <Route path="/object/:objectName" element={<ObjectDetail/>}/>
                </Routes>
            </MemoryRouter>
        );
        await screen.findByText('node2');

        setStoreState({
            ...buildState(),
            objectInstanceStatus: {'root/svc/svc1': {node1: {avail: 'up', resources: {}}}},
        });
        rerender(
            <MemoryRouter initialEntries={['/object/root%2Fsvc%2Fsvc1']}>
                <Routes>
                    <Route path="/object/:objectName" element={<ObjectDetail/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('configNode "node2" removed, switching to "node1"'));
        });
        debugSpy.mockRestore();
    });

    test('resets configNode to null and closes config dialog when all nodes are removed', async () => {
        setStoreState({...buildState()});
        mockUseParams.mockReturnValue({objectName: 'root/svc/svc1'});
        const {rerender} = render(
            <MemoryRouter initialEntries={['/object/root%2Fsvc%2Fsvc1']}>
                <Routes>
                    <Route path="/object/:objectName" element={<ObjectDetail/>}/>
                </Routes>
            </MemoryRouter>
        );
        await screen.findByText('node1');

        fireEvent.click(screen.getByTestId('open-config-dialog'));
        await waitFor(() => expect(screen.getByTestId('config-dialog')).toBeInTheDocument());

        setStoreState({...buildState(), objectInstanceStatus: {'root/svc/svc1': {}}});
        rerender(
            <MemoryRouter initialEntries={['/object/root%2Fsvc%2Fsvc1']}>
                <Routes>
                    <Route path="/object/:objectName" element={<ObjectDetail/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.queryByText('node1')).not.toBeInTheDocument();
            expect(screen.queryByTestId('config-dialog')).not.toBeInTheDocument();
        });
    });

    // ── Batch node actions ───────────────────────────────────────────────
    test('batch node actions: select nodes and execute start', async () => {
        await renderReadySvc();
        await user.click(screen.getByLabelText(/select node node1/i));
        await user.click(screen.getByLabelText(/select node node2/i));
        const batchBtn = screen.getByRole('button', {name: /Actions on selected nodes/i});
        expect(batchBtn).not.toBeDisabled();
        await user.click(batchBtn);
        await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
        await user.click(getMenuItemByLabel('Start', screen.getAllByRole('menu')[0]));
        await confirmDialog(await findActionDialog());
        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringMatching(/\/api\/node\/name\/node1\/instance\/path\/root(%2F|\/)svc(%2F|\/)svc1\/action\/start/),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({Authorization: 'Bearer mock-token'}),
                })
            );
        });
    });

    // ── Routing by endpoint ───────────────────────────────────────────────
    test('svc-only enable action posts to the object endpoint, outside /action', async () => {
        await renderReadySvc();
        await user.click(screen.getByRole('button', {name: /object actions/i}));
        await user.click(getMenuItemByLabel('Enable', screen.getByRole('menu', {name: 'Object actions'})));
        await confirmDialog(await findActionDialog());
        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringMatching(/\/api\/object\/path\/root(%2F|\/)svc(%2F|\/)svc1\/enable$/),
                expect.objectContaining({method: 'POST'})
            );
        });
    });

    test('instance action posts to its endpoint (pg reset → action/pg/reset)', async () => {
        await renderReadySvc();
        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        await user.click(getMenuItemByLabel('Pg reset', screen.getByRole('menu', {name: 'Node node1 actions'})));
        await confirmDialog(await findActionDialog());
        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringMatching(/\/api\/node\/name\/node1\/instance\/path\/root(%2F|\/)svc(%2F|\/)svc1\/action\/pg\/reset$/),
                expect.objectContaining({method: 'POST'})
            );
        });
    });

    // ── Individual node actions ───────────────────────────────────────────
    test('individual node stop action', async () => {
        await renderReadySvc();
        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
        await user.click(getMenuItemByLabel('Stop', screen.getAllByRole('menu')[0]));
        await confirmDialog(await findActionDialog());
        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringMatching(/\/api\/node\/name\/node1\/instance\/path\/root(%2F|\/)svc(%2F|\/)svc1\/action\/stop/),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({Authorization: 'Bearer mock-token'}),
                })
            );
        });
    });

    test('individual node menu offers freeze only on a node that is not frozen', async () => {
        const state = buildState();
        state.objectInstanceStatus['root/svc/svc1'].node1.frozen_at = '2023-01-01T12:00:00Z';
        setStoreState(state);
        await renderReadySvc();
        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        let menu = screen.getByRole('menu', {name: 'Node node1 actions'});
        expect(within(menu).queryByRole('menuitem', {name: /^freeze/i})).not.toBeInTheDocument();
        expect(getMenuItemByLabel('Start', menu)).toBeInTheDocument();
        await user.click(document.body);
        await user.click(screen.getByRole('button', {name: /Node node2 actions/i}));
        menu = screen.getByRole('menu', {name: 'Node node2 actions'});
        expect(within(menu).getByRole('menuitem', {name: /^freeze/i})).toBeInTheDocument();
    });

    test('batch actions button counts the selected nodes', async () => {
        await renderReadySvc();
        expect(screen.getByRole('button', {name: 'Actions on selected nodes (0)'})).toBeDisabled();
        await user.click(screen.getByLabelText(/select node node2/i));
        expect(screen.getByRole('button', {name: 'Actions on selected nodes (1)'})).toBeEnabled();
    });

    // ── Error handling (object & node actions) ────────────────────────────
    describe.each([
        {label: 'object', openMenu: async () => userEvent.click(screen.getByRole('button', {name: /object actions/i}))},
        {
            label: 'node',
            openMenu: async () => userEvent.click(screen.getByRole('button', {name: /Node node1 actions/i}))
        },
    ])('$label actions', ({openMenu}) => {
        test('fetch exception', async () => {
            mockNetworkFailure('/action/');
            await renderReadySvc();
            await openMenu();
            await userEvent.click(getMenuItemByLabel('Start'));
            await confirmDialog(await findActionDialog());
            await waitFor(() => expect(tray()).toEqual([['start', 'refused', expect.stringContaining('Network error')]]));
        });

        test.each([[403, 'Forbidden'], [500, 'Server error']])('HTTP %i', async (status, msg) => {
            mockActionFailure(status, msg);
            await renderReadySvc();
            await openMenu();
            await userEvent.click(getMenuItemByLabel('Start'));
            await confirmDialog(await findActionDialog());
            await waitFor(() => expect(tray()).toEqual([['start', 'refused', expect.stringMatching(new RegExp(`^HTTP ${status}`))]]));
        });

        test('missing auth token', async () => {
            mockLocalStorage.getItem.mockReturnValue(null);
            await renderReadySvc();
            await openMenu();
            await userEvent.click(getMenuItemByLabel('Start'));
            const dialog = await findActionDialog();
            await userEvent.click(within(dialog).getByRole('button', {name: /confirm/i}));
            await waitFor(() =>
                expect(screen.getAllByRole('alert').some((a) => a.textContent.includes('Auth token not found'))).toBe(true)
            );
        });
    });

    // ── handleDialogConfirm outer .catch branches ─────────────────────────
    describe('handleDialogConfirm promise rejection handling', () => {
        test.each([
            [
                'batch node',
                'postNodeAction',
                async () => {
                    await user.click(screen.getByLabelText(/select node node1/i));
                    await user.click(screen.getByLabelText(/select node node2/i));
                    await user.click(screen.getByRole('button', {name: /Actions on selected nodes/i}));
                    await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
                    await user.click(getMenuItemByLabel('Start', screen.getAllByRole('menu')[0]));
                },
            ],
            [
                'individual node',
                'postNodeAction',
                async () => {
                    await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
                    await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
                    await user.click(getMenuItemByLabel('Start', screen.getAllByRole('menu')[0]));
                },
            ],
            [
                'object',
                'postObjectAction',
                async () => {
                    await user.click(screen.getByRole('button', {name: /object actions/i}));
                    await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
                    await user.click(getMenuItemByLabel('Start'));
                },
            ],
        ])('%s action rejection is logged via logger.error', async (label, fnName, triggerAction) => {
            const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {
            });
            await renderReadySvc();
            await triggerAction();
            const dialog = await findActionDialog();

            mockLocalStorage.getItem.mockImplementation(() => {
                throw new Error('Storage boom');
            });

            await confirmDialog(dialog);

            await waitFor(() => {
                expect(errorSpy).toHaveBeenCalledWith(`[ObjectDetail] ${fnName} failed:`, expect.any(Error));
            });
            errorSpy.mockRestore();
        });
    });

    // ── Dialog controls ──────────────────────────────────────────────────
    test('all object action dialogs open and cancel', async () => {
        setStoreState(buildState());
        renderSvc();
        for (const action of ['start', 'freeze', 'stop', 'unprovision', 'purge']) {
            await user.click(screen.getByRole('button', {name: /object actions/i}));
            await screen.findByRole('menu');
            await user.click(getMenuItemByLabel(capitalize(action)));
            const dialog = await findActionDialog();
            const cancelBtn = within(dialog).queryByRole('button', {name: /cancel/i});
            if (cancelBtn) {
                await user.click(cancelBtn);
                await waitFor(() => expect(actionDialogs()).toHaveLength(0));
            }
        }
    });

    test('closes manage params dialog on submit', async () => {
        renderComponent('root/cfg/cfg1');
        await screen.findAllByText(/root\/cfg\/cfg1/i);
        const manageBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Manage'));
        if (!manageBtn) return;
        await user.click(manageBtn);
        const dialog = await findActionDialog();
        await user.click(within(dialog).getByRole('button', {name: /confirm/i}));
        await waitFor(() => expect(actionDialogs()).toHaveLength(0));
    });

    test('closes snackbar via close button', async () => {
        await renderReadySvc();
        mockLocalStorage.getItem.mockReturnValue(null);
        await userEvent.click(screen.getByRole('button', {name: /object actions/i}));
        await screen.findByRole('menu');
        await userEvent.click(getMenuItemByLabel('Start'));
        await confirmDialog(await findActionDialog());
        await waitFor(() => expect(feedbackWith('Auth token not found')).toBeInTheDocument());
        await user.click(within(feedbackWith('Auth token not found')).getByRole('button', {name: 'Close'}));
        await waitFor(() => expect(feedbackWith('Auth token not found')).toBeUndefined());
    });

    // ── Logs drawer ──────────────────────────────────────────────────────
    test('a click outside closes the "Actions on selected nodes" menu', async () => {
        await renderReadySvc();
        await user.click(screen.getByLabelText(/select node node1/i));
        await user.click(screen.getByRole('button', {name: /Actions on selected nodes/i}));
        await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
        await user.click(document.body);
        await waitFor(() => expect(screen.queryAllByRole('menu').length).toBe(0));
        expect(actionDialogs()).toHaveLength(0);
    });

    test('a click outside closes the individual "Node actions" menu', async () => {
        await renderReadySvc();
        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
        await user.click(document.body);
        await waitFor(() => expect(screen.queryAllByRole('menu').length).toBe(0));
        expect(actionDialogs()).toHaveLength(0);
    });

    test('logs button opens the logs panel with the instance logs, resizable', async () => {
        renderSvc();
        await waitForNode('node1');
        expect(logsPanel()).toHaveAttribute('inert');
        expect(screen.queryByTestId('logs-viewer')).not.toBeInTheDocument();
        expect(screen.queryByRole('separator', {name: 'Resize drawer'})).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', {name: 'View logs for instance svc1 on node node1'}));

        const panel = await screen.findByRole('dialog', {name: 'Instance Logs - svc1'});
        expect(panel).not.toHaveAttribute('inert');
        expect(within(panel).getByRole('heading', {name: 'Instance Logs - svc1'})).toBeInTheDocument();
        expect(within(panel).getByTestId('logs-viewer')).toHaveAttribute('data-nodename', 'node1');
        expect(screen.getByRole('separator', {name: 'Resize drawer'})).toBeInTheDocument();
        // The logs panel is not an action dialog.
        expect(actionDialogs()).toHaveLength(1);
    });

    test('logs of the second instance open on its node', async () => {
        await renderReadySvc();
        expect(screen.getAllByRole('button', {name: /View logs for instance/})).toHaveLength(2);
        await user.click(screen.getByRole('button', {name: 'View logs for instance svc1 on node node2'}));
        const panel = await screen.findByRole('dialog', {name: 'Instance Logs - svc1'});
        expect(within(panel).getByTestId('logs-viewer')).toHaveAttribute('data-nodename', 'node2');
    });

    test('closing logs drawer resets state', async () => {
        renderSvc();
        await waitForNode('node1');
        await user.click(screen.getByRole('button', {name: /View logs for instance svc1 on node node1/}));
        await waitFor(() => expect(screen.getByTestId('logs-viewer')).toBeInTheDocument());
        await user.click(within(logsPanel()).getByRole('button', {name: 'Close logs'}));
        await waitFor(() => expect(screen.queryByTestId('logs-viewer')).not.toBeInTheDocument());
        expect(logsPanel()).toHaveAttribute('inert');
        expect(logsPanel()).toHaveAccessibleName('Logs');
        expect(screen.queryByRole('separator', {name: 'Resize drawer'})).not.toBeInTheDocument();
    });

    test('Escape closes the logs drawer', async () => {
        renderSvc();
        await waitForNode('node1');
        await user.click(screen.getByRole('button', {name: /View logs for instance svc1 on node node1/}));
        await waitFor(() => expect(screen.getByTestId('logs-viewer')).toBeInTheDocument());
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByTestId('logs-viewer')).not.toBeInTheDocument());
    });

    // ── Feedback message ─────────────────────────────────────────────────
    test('feedback message hides itself after 5 seconds', async () => {
        let instanceConfigCallback;
        vi.mocked(useEventStore.subscribe).mockImplementation((selector, callback) => {
            instanceConfigCallback = callback;
            return vi.fn();
        });
        await renderReadySvc();
        vi.useFakeTimers();
        try {
            act(() => instanceConfigCallback({'root/svc/svc1': {node1: {resources: {}}}}));
            expect(feedbackWith('Instance configuration updated')).toBeInTheDocument();
            act(() => vi.advanceTimersByTime(4900));
            expect(feedbackWith('Instance configuration updated')).toBeInTheDocument();
            act(() => vi.advanceTimersByTime(200));
            expect(feedbackWith('Instance configuration updated')).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    // ── per-node stopped / RPO-breached indicators ───────────────────────
    describe('per-node stopped and RPO-breached indicators', () => {
        test('shows the stopped indicator on the node card when stopped_at is set', async () => {
            setStoreState({
                objectStatus: {'root/svc/svc1': {avail: 'down', frozen: null}},
                objectInstanceStatus: {
                    'root/svc/svc1': {
                        node1: {
                            avail: 'down',
                            frozen_at: null,
                            stopped_at: '2025-05-16T10:00:00Z',
                            resources: {},
                        },
                    },
                },
                instanceMonitor: {},
                instanceConfig: {},
                ...BASE_FNS(),
            });
            renderSvc();
            await waitForNode('node1');
            expect(screen.getByLabelText('Instance on node node1 is stopped')).toBeInTheDocument();
        });

        test('does not show the stopped indicator when stopped_at is the zero sentinel', async () => {
            setStoreState({
                objectStatus: {'root/svc/svc1': {avail: 'up', frozen: null}},
                objectInstanceStatus: {
                    'root/svc/svc1': {
                        node1: {
                            avail: 'up',
                            frozen_at: null,
                            stopped_at: '0001-01-01T00:00:00Z',
                            resources: {},
                        },
                    },
                },
                instanceMonitor: {},
                instanceConfig: {},
                ...BASE_FNS(),
            });
            renderSvc();
            await waitForNode('node1');
            expect(screen.queryByLabelText('Instance on node node1 is stopped')).not.toBeInTheDocument();
        });

        test('shows the RPO-breached indicator on the node card when rpo_breached_at is set', async () => {
            setStoreState({
                objectStatus: {'root/svc/svc1': {avail: 'up', frozen: null}},
                objectInstanceStatus: {
                    'root/svc/svc1': {
                        node1: {
                            avail: 'up',
                            frozen_at: null,
                            rpo_breached_at: '2025-05-16T10:00:00Z',
                            resources: {},
                        },
                    },
                },
                instanceMonitor: {},
                instanceConfig: {},
                ...BASE_FNS(),
            });
            renderSvc();
            await waitForNode('node1');
            expect(screen.getByLabelText('Instance on node node1 is lagging')).toBeInTheDocument();
        });

        test('does not show the RPO-breached indicator when rpo_breached_at is the zero sentinel', async () => {
            setStoreState({
                objectStatus: {'root/svc/svc1': {avail: 'up', frozen: null}},
                objectInstanceStatus: {
                    'root/svc/svc1': {
                        node1: {
                            avail: 'up',
                            frozen_at: null,
                            rpo_breached_at: '0001-01-01T00:00:00Z',
                            resources: {},
                        },
                    },
                },
                instanceMonitor: {},
                instanceConfig: {},
                ...BASE_FNS(),
            });
            renderSvc();
            await waitForNode('node1');
            expect(screen.queryByLabelText('Instance on node node1 is lagging')).not.toBeInTheDocument();
        });

        test('shows stopped and RPO-breached indicators simultaneously', async () => {
            setStoreState({
                objectStatus: {'root/svc/svc1': {avail: 'down', frozen: null}},
                objectInstanceStatus: {
                    'root/svc/svc1': {
                        node1: {
                            avail: 'down',
                            frozen_at: null,
                            stopped_at: '2025-05-16T10:00:00Z',
                            rpo_breached_at: '2025-05-16T10:00:00Z',
                            resources: {},
                        },
                    },
                },
                instanceMonitor: {},
                instanceConfig: {},
                ...BASE_FNS(),
            });
            renderSvc();
            await waitForNode('node1');
            expect(screen.getByLabelText('Instance on node node1 is stopped')).toBeInTheDocument();
            expect(screen.getByLabelText('Instance on node node1 is lagging')).toBeInTheDocument();
        });

        test('healthy node shows neither stopped nor RPO-breached indicators', async () => {
            setStoreState({
                objectStatus: {'root/svc/svc1': {avail: 'up', frozen: null}},
                objectInstanceStatus: {
                    'root/svc/svc1': {
                        node1: {
                            avail: 'up',
                            frozen_at: null,
                            stopped_at: '0001-01-01T00:00:00Z',
                            rpo_breached_at: '0001-01-01T00:00:00Z',
                            resources: {},
                        },
                    },
                },
                instanceMonitor: {},
                instanceConfig: {},
                ...BASE_FNS(),
            });
            renderSvc();
            await waitForNode('node1');
            expect(screen.queryByLabelText('Instance on node node1 is stopped')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Instance on node node1 is lagging')).not.toBeInTheDocument();
        });
    });

    // ── instanceConfig subscription ──────────────────────────────────────
    test.each([
        [
            'triggers snackbar when configNode is set',
            {
                objectStatus: {},
                instanceMonitor: {},
                objectInstanceStatus: {'root/svc/svc1': {node1: {avail: 'up', resources: {}}}},
                instanceConfig: {'root/svc/svc1': {node1: {resources: {res1: {is_monitored: true}}}}},
                ...BASE_FNS(),
            },
            'root/svc/svc1',
            () => waitForNode('node1'),
            {'root/svc/svc1': {node1: {resources: {res1: {is_monitored: false}}}}},
            true,
        ],
        [
            'does not trigger snackbar when configNode is null',
            {
                objectStatus: {},
                instanceMonitor: {},
                objectInstanceStatus: {'root/svc/svc-empty': {}},
                instanceConfig: {},
                ...BASE_FNS(),
            },
            'root/svc/svc-empty',
            () => screen.findByText(/No information available/i),
            {'root/svc/svc-empty': {node1: {resources: {res1: {is_monitored: true}}}}},
            false,
        ],
    ])('instanceConfig subscription %s', async (label, state, objectName, waitForReady, updatedConfig, shouldFire) => {
        setStoreState(state);
        let instanceConfigCallback;
        vi.mocked(useEventStore.subscribe).mockImplementation((selector, callback) => {
            if (selector.toString().includes('instanceConfig')) instanceConfigCallback = callback;
            return vi.fn();
        });
        renderComponent(objectName);
        await waitForReady();
        act(() => instanceConfigCallback(updatedConfig));

        if (shouldFire) {
            await waitFor(() => {
                expect(feedbackWith('Instance configuration updated')).toBeInTheDocument();
            });
        } else {
            await waitFor(() => {
                expect(feedbackWith('Instance configuration updated')).toBeUndefined();
            });
        }
    });

    test.each([
        [
            'subscription error triggers logger.warn',
            () => {
                throw new Error('Subscription failed');
            },
            '[ObjectDetail] Failed to subscribe to instanceConfig:',
            expect.any(Error),
        ],
        [
            'non-function return triggers logger.warn',
            () => 'not-a-function',
            '[ObjectDetail] Subscription is not a function:',
            'not-a-function',
        ],
    ])('instanceConfig: %s', async (label, subscribeFn, warnMsg, warnArg) => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {
        });
        vi.mocked(useEventStore.subscribe).mockImplementation(subscribeFn);
        renderSvc();
        await screen.findAllByText(/root\/svc\/svc1/i);
        await waitFor(() => expect(warnSpy).toHaveBeenCalledWith(warnMsg, warnArg));
        warnSpy.mockRestore();
    });

    test('instanceConfig selector body executes and returns the expected slice', async () => {
        let capturedSelector;
        vi.mocked(useEventStore.subscribe).mockImplementation((selector) => {
            capturedSelector = selector;
            return vi.fn();
        });
        renderSvc();
        await waitForNode('node1');

        expect(typeof capturedSelector).toBe('function');
        const sampleState = {instanceConfig: {'root/svc/svc1': {node1: {resources: {}}}}, other: 'ignored'};
        expect(capturedSelector(sampleState)).toBe(sampleState.instanceConfig);
    });

    // ── batch menu mixed frozen state ────────────────────────────────────
    test.each([
        [
            'keeps freeze when selected nodes have mixed frozen state',
            {
                node1: {avail: 'up', frozen_at: null, resources: {}},
                node2: {avail: 'up', frozen_at: '2023-01-01T12:00:00Z', resources: {}}
            },
            true,
            false,
        ],
        [
            'hides freeze when all selected nodes are already frozen',
            {
                node1: {avail: 'up', frozen_at: '2023-01-01T12:00:00Z', resources: {}},
                node2: {avail: 'up', frozen_at: '2023-01-01T12:00:00Z', resources: {}}
            },
            false,
            true,
        ],
    ])('batch menu %s', async (label, nodeStates, expectFreeze, expectStart) => {
        setStoreState({
            objectStatus: {'root/svc/svc1': {avail: 'up', frozen: null}},
            objectInstanceStatus: {'root/svc/svc1': nodeStates},
            instanceMonitor: {},
            instanceConfig: {},
            ...BASE_FNS(),
        });
        renderSvc();
        await waitForNode('node1');
        await waitForNode('node2');
        await user.click(screen.getByLabelText(/select node node1/i));
        await user.click(screen.getByLabelText(/select node node2/i));
        await user.click(screen.getByRole('button', {name: /Actions on selected nodes/i}));
        await waitFor(() => expect(screen.queryAllByRole('menu').length).toBeGreaterThan(0));
        const menu = screen.getAllByRole('menu')[0];
        expect(!!queryMenuItemByLabel('Freeze', menu)).toBe(expectFreeze);
        if (expectStart) expect(queryMenuItemByLabel('Start', menu)).toBeTruthy();
    });

    // ── Fallback fetch ───────────────────────────────────────────────────
    describe('fallback fetch', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        test('triggers after 5 seconds when no SSE data', async () => {
            setStoreState(emptyState());
            renderSvc();
            expect(screen.getByText(/Loading object data.../i)).toBeInTheDocument();
            act(() => vi.advanceTimersByTime(5000));
            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(/\/api\/object\/path\/root(%2F|\/)svc(%2F|\/)svc1/),
                    expect.any(Object)
                );
            });
        });

        test('handles fallback fetch failure gracefully', async () => {
            setStoreState(emptyState());
            global.fetch.mockRejectedValueOnce(new Error('Network failure'));
            renderSvc();
            act(() => vi.advanceTimersByTime(5000));
            await waitFor(() => expect(screen.queryByText(/Loading object data.../i)).not.toBeInTheDocument());
            expect(screen.queryByText(/Network failure/i)).not.toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'View Configuration'})).toBeInTheDocument();
        });

        test('sets error and stops loading when auth token is missing', async () => {
            setStoreState(emptyState());
            mockLocalStorage.getItem.mockReturnValue(null);
            renderSvc();
            expect(screen.getByText(/Loading object data.../i)).toBeInTheDocument();
            act(() => vi.advanceTimersByTime(5000));
            await waitFor(() => expect(screen.queryByText(/Loading object data.../i)).not.toBeInTheDocument());
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('logs error when fetchFallbackData itself rejects outside its own try/catch', async () => {
            const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {
            });
            setStoreState(emptyState());
            mockLocalStorage.getItem
                .mockReturnValueOnce('mock-token')
                .mockImplementation(() => {
                    throw new Error('Storage boom');
                });

            renderSvc();
            act(() => vi.advanceTimersByTime(5000));

            await waitFor(() => {
                expect(errorSpy).toHaveBeenCalledWith('[ObjectDetail] fetchFallbackData failed:', expect.any(Error));
            });
            errorSpy.mockRestore();
        });

        test('the object alone read: its instances out of its answer, none read apart', async () => {
            setStoreState(emptyState());
            renderSvc();
            act(() => vi.advanceTimersByTime(5000));
            await waitFor(() => expect(screen.queryByText(/Loading object data.../i)).not.toBeInTheDocument());
            expect(global.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/api/object/path/'))).toHaveLength(1);
            expect(global.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/instance/path/'))).toEqual([]);
        });

        test('an object without instances: none set', async () => {
            const s = emptyState();
            setStoreState(s);
            global.fetch.mockImplementation((url) => {
                if (url.includes('/api/object/path')) {
                    return Promise.resolve({ok: true, json: () => Promise.resolve({kind: 'ObjectItem', data: {avail: 'n/a'}})});
                }
                return Promise.resolve({ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('')});
            });
            renderSvc();
            act(() => vi.advanceTimersByTime(5000));
            await waitFor(() => {
                expect(s.setInstanceStatuses).toHaveBeenCalledWith({'root/svc/svc1': {}}, true);
            });
        });

        test('this object set out of its answer, the others kept', async () => {
            const s = {
                ...emptyState(),
                objectStatus: {'root/svc/other': {avail: 'up'}},
                instanceMonitor: {'n1:root/svc/other': {state: 'idle'}},
            };
            setStoreState(s);
            global.fetch.mockImplementation((url) => {
                if (url.includes('/api/object/path')) {
                    return Promise.resolve({ok: true, json: () => Promise.resolve({
                        kind: 'ObjectItem',
                        meta: {object: 'root/svc/svc1'},
                        data: {
                            avail: 'up',
                            overall: 'up',
                            instances: {n1: {status: {avail: 'up'}, config: {csum: 'abc'}, monitor: {state: 'idle'}}},
                        },
                    })});
                }
                return Promise.resolve({ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('')});
            });
            renderSvc();
            act(() => vi.advanceTimersByTime(5000));
            await waitFor(() => expect(s.setObjectStatuses).toHaveBeenCalled());
            // Its status, not the envelope of the answer nor its instances; the other object kept.
            expect(s.setObjectStatuses).toHaveBeenCalledWith({
                'root/svc/other': {avail: 'up'},
                'root/svc/svc1': {avail: 'up', overall: 'up'},
            });
            expect(s.setInstanceStatuses).toHaveBeenCalledWith({'root/svc/svc1': {n1: {avail: 'up'}}}, true);
            expect(s.setInstanceConfig).toHaveBeenCalledWith('root/svc/svc1', 'n1', {csum: 'abc'});
            expect(s.setInstanceMonitors).toHaveBeenCalledWith({
                'n1:root/svc/other': {state: 'idle'},
                'n1:root/svc/svc1': {state: 'idle'},
            });
        });

        test('the object not read (an HTTP error): nothing set', async () => {
            const s = emptyState();
            setStoreState(s);
            global.fetch.mockImplementation((url) => Promise.resolve(url.includes('/api/object/path')
                ? {ok: false, status: 500, json: () => Promise.resolve({})}
                : {ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('')}));
            renderSvc();
            act(() => vi.advanceTimersByTime(5000));
            await waitFor(() => expect(screen.queryByText(/Loading object data.../i)).not.toBeInTheDocument());
            expect(s.setObjectStatuses).not.toHaveBeenCalled();
            expect(s.setInstanceStatuses).not.toHaveBeenCalled();
        });

        test('hasInstances short-circuit: does not overwrite store if getState() already has instances at fallback time', async () => {
            const reactiveEmptyState = emptyState();
            const storeStateWithInstances = buildState();

            vi.mocked(useEventStore).mockImplementation((selector) => selector(reactiveEmptyState));
            vi.mocked(useEventStore.getState).mockReturnValue(storeStateWithInstances);

            renderSvc();
            expect(screen.getByText(/Loading object data.../i)).toBeInTheDocument();

            act(() => vi.advanceTimersByTime(5000));

            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(/\/api\/object\/path\/root(%2F|\/)svc(%2F|\/)svc1/),
                    expect.any(Object)
                );
            });

            await waitFor(() => {
                expect(storeStateWithInstances.setObjectStatuses).not.toHaveBeenCalled();
                expect(storeStateWithInstances.setInstanceStatuses).not.toHaveBeenCalled();
            });
        });
    });
});
