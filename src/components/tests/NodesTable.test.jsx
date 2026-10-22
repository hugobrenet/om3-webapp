import React from 'react';
import {render, screen, waitFor, fireEvent, act, within} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import {vi} from 'vitest';
import NodesTable from '../NodesTable.jsx';
import i18n from '../../i18n';
import {useActionTracker} from '../../app/action-tracker';

/** What the actions tray holds, the latest first: action, subject, state, reason. */
const tray = () => useActionTracker.getState().tracked.map((e) => [e.action, e.subject, e.state, e.error ?? null]);

// ── Hoisted mock variables ────────────────────────────────────────────────
const {
    mockUseFetchDaemonStatus,
    mockUseEventStore,
    mockRetainEventReception,
    mockReleaseEventReception,
    mockStartLoggerReception,
    mockCloseLoggerEventSource,
    mockNavigate,
    mockLogger,
} = vi.hoisted(() => ({
    mockUseFetchDaemonStatus: vi.fn(),
    mockUseEventStore: vi.fn(),
    mockRetainEventReception: vi.fn(),
    mockReleaseEventReception: vi.fn(),
    mockStartLoggerReception: vi.fn(),
    mockCloseLoggerEventSource: vi.fn(),
    mockNavigate: vi.fn(),
    mockLogger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../NodeRow.jsx', () => ({
    default: (props) => (
        <tr data-testid={`row-${props.nodename}`}>
            <td><input type="checkbox" aria-label={`select ${props.nodename}`} checked={props.isSelected} onChange={(e) => props.onSelect(e, props.nodename)}/>
            </td>
            <td>{props.nodename}</td>
            <td>{props.monitor?.state || 'idle'}</td>
            <td>{props.stats?.score || 0}</td>
            <td>{props.stats?.load_15m || 0}</td>
            <td>{props.stats?.mem_avail || 0}</td>
            <td>{props.stats?.swap_avail || 0}</td>
            <td>{props.status?.agent || ''}</td>
            <td>
                <span data-testid={`props-${props.nodename}`}>
                    {Object.keys(props).sort().join(',')}
                </span>
            </td>
            <td>
                <button onClick={() => props.onOpen(props.nodename)}>Open {props.nodename}</button>
                {props.isOpen && <span>open</span>}
            </td>
        </tr>
    ),
}));

// The nodes of the cluster configuration; null, not read: the nodes reporting a status.
const mockClusterOrder = vi.hoisted(() => ({value: null}));
vi.mock('../../hooks/useClusterNodeOrder', () => ({useClusterNodeOrder: () => mockClusterOrder.value}));

// The confirmation of a node action is tested on its own (NodeActionDialog.test): here, the action confirmed.
vi.mock('../NodeActionDialog', () => ({
    NodeActionDialog: ({pending: pendingAction, onConfirm: handleConfirm, target, onClose}) => {
        if (!pendingAction) return null;
        const action = pendingAction.action;
        const actionTitle = action.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        return (
            <div role="dialog" data-testid={`dialog-${action}`}>
                <h2>Confirm {actionTitle} Action on {target}</h2>
                <button onClick={() => handleConfirm(action)} aria-label="Confirm">Confirm</button>
                <button onClick={onClose}>Cancel</button>
            </div>
        );
    },
}));

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// The node panel is tested on its own: here, which node it shows and on which tab.
vi.mock('../NodePanel', () => ({
    NodeDetailPanel: ({node, tab, onClose}) => (node === undefined ? null : (
        <div role="dialog" aria-label={`Node ${node}`}>
            {`${node} on ${tab ?? 'status'}`}
            <button onClick={onClose}>Close panel</button>
        </div>
    )),
}));

vi.mock('../../components/LogsViewer.jsx', () => ({
    default: ({nodename, type, height}) => (
        <div data-testid="logs-viewer">Logs for {nodename} ({type}), height: {height}</div>
    ),
}));

vi.mock('../../hooks/useFetchDaemonStatus.jsx', () => ({
    default: mockUseFetchDaemonStatus,
}));

vi.mock('../../hooks/useEventStore.js', () => ({
    default: mockUseEventStore,
}));

vi.mock('../../eventSourceManager', () => ({
    retainEventReception: (...args) => {
        mockRetainEventReception(...args);
        return mockReleaseEventReception;
    },
    startLoggerReception: mockStartLoggerReception,
    closeLoggerEventSource: mockCloseLoggerEventSource,
}));

vi.mock('../../utils/logger', () => ({
    default: mockLogger,
}));

describe('NodesTable', () => {
    const createDefaultStore = () => ({
        nodeStatus: {
            'node-1': {state: 'idle', frozen_at: null, agent: 'v1.0', booted_at: '2023-01-01T00:00:00Z'},
            'node-2': {state: 'busy', frozen_at: null, agent: 'v2.0', booted_at: '2023-01-02T00:00:00Z'},
            'node-3': {state: 'idle', frozen_at: null, agent: 'v3.0', booted_at: '2023-01-03T00:00:00Z'},
        },
        nodeStats: {
            'node-1': {score: 42, load_15m: 1.5, mem_avail: 1000, swap_avail: 500},
            'node-2': {score: 18, load_15m: 2.0, mem_avail: 2000, swap_avail: 1000},
        },
        nodeMonitor: {
            'node-1': {state: 'idle', updated_at: '2023-01-03T00:00:00Z'},
            'node-2': {state: 'busy', updated_at: '2023-01-01T00:00:00Z'},
        },
    });

    const originalUserAgent = navigator.userAgent;
    const originalDevicePixelRatio = window.devicePixelRatio;

    beforeEach(() => {
        // The panel lives in the URL: no test inherits the one the test before opened.
        window.history.replaceState({}, '', '/nodes');
        const fetchNodesMock = vi.fn().mockResolvedValue(undefined);
        mockUseFetchDaemonStatus.mockReturnValue({
            daemon: {nodename: 'node-1'},
            fetchNodes: fetchNodesMock,
        });

        mockUseEventStore.mockImplementation((selector) =>
            selector(createDefaultStore())
        );

        mockRetainEventReception.mockImplementation(() => {
        });
        mockReleaseEventReception.mockImplementation(() => {
        });
        mockStartLoggerReception.mockImplementation(() => {
        });
        mockCloseLoggerEventSource.mockImplementation(() => {
        });

        localStorage.setItem('authToken', 'test-token');
        useActionTracker.setState({tracked: [], revealed: 0});
        vi.clearAllMocks();
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
        vi.resetAllMocks();
        delete global.fetch;
        vi.useRealTimers();

        Object.defineProperty(navigator, 'userAgent', {
            value: originalUserAgent,
            configurable: true,
        });
        Object.defineProperty(window, 'devicePixelRatio', {
            value: originalDevicePixelRatio,
            configurable: true,
        });
    });

    const renderWithRouter = (ui) => render(<BrowserRouter>{ui}</BrowserRouter>);

    /** Selects node-1 and picks the action in the menu of the selection: the only way to act from the view. */
    const actOnFirstNode = async (label) => {
        fireEvent.click(await screen.findByRole('checkbox', {name: 'select node-1'}));
        fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
        fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(`^${label}$`, 'i')}));
    };

    const setStore = (overrides) => {
        const store = {...createDefaultStore(), ...overrides};
        mockUseEventStore.mockImplementation((sel) => sel(store));
        return store;
    };

    test('a node of the cluster dropped keeps its line, and the drops are heard', async () => {
        mockClusterOrder.value = ['node-1', 'node-2', 'node-3', 'node-4'];
        try {
            renderWithRouter(<NodesTable/>);
            expect(await screen.findByTestId('row-node-4')).toBeInTheDocument();
            expect(screen.getByTestId('row-node-1')).toBeInTheDocument();
            expect(mockRetainEventReception.mock.calls[0][1]).toContain('NodeMonitorDeleted');
        } finally {
            mockClusterOrder.value = null;
        }
    });

    test('shows loader when no data, then renders rows', async () => {
        setStore({nodeStatus: {}, nodeStats: {}, nodeMonitor: {}});
        renderWithRouter(<NodesTable/>);
        expect(screen.getByRole('status')).toHaveTextContent('Loading nodes');
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    test('speaks French to a French browser', async () => {
        await i18n.changeLanguage('fr');
        try {
            renderWithRouter(<NodesTable/>);
            expect(await screen.findByText('Sélectionnez des nœuds pour agir dessus, ou ouvrez-en un')).toBeInTheDocument();
            expect(screen.getByRole('columnheader', {name: 'Charge (15m)'})).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('renders all node names', async () => {
        renderWithRouter(<NodesTable/>);
        expect(await screen.findByText('node-1')).toBeInTheDocument();
        expect(screen.getByText('node-2')).toBeInTheDocument();
        expect(screen.getByText('node-3')).toBeInTheDocument();
    });

    test('the actions show with a selection, and go with it', async () => {
        renderWithRouter(<NodesTable/>);
        const checkboxes = await screen.findAllByRole('checkbox');
        const actions = () => screen.queryByRole('button', {name: 'Actions'});

        expect(actions()).not.toBeInTheDocument();
        fireEvent.click(checkboxes[1]);
        expect(actions()).toBeInTheDocument();
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        fireEvent.click(checkboxes[1]);
        expect(actions()).not.toBeInTheDocument();

        expect(checkboxes[0]).toBe(screen.getByRole('checkbox', {name: 'Select all nodes'}));
        fireEvent.click(checkboxes[0]);
        expect(checkboxes[0]).toBeChecked();
        expect(checkboxes[1]).toBeChecked();
        expect(checkboxes[2]).toBeChecked();
        expect(checkboxes[3]).toBeChecked();
        expect(actions()).toBeInTheDocument();

        fireEvent.click(checkboxes[0]);
        expect(checkboxes[1]).not.toBeChecked();
        expect(actions()).not.toBeInTheDocument();
    });

    describe('action execution', () => {
        test('opens confirmation dialog and cancels', async () => {
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            await waitFor(() =>
                expect(screen.getByTestId('dialog-freeze')).toHaveTextContent('Confirm Freeze Action on 1 node')
            );
            fireEvent.click(screen.getByText('Cancel'));
            await waitFor(() => expect(screen.queryByTestId('dialog-freeze')).not.toBeInTheDocument());
        });

        test('a node action accepted is followed in the actions tray, no message of its own', async () => {
            global.fetch = vi.fn((url) => (url.includes('/daemon/exec/')
                ? new Promise(() => undefined)
                : Promise.resolve({ok: true, clone: () => ({json: async () => ({exec_id: 'e1', session_id: 's1'})})})));
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            fireEvent.click(await screen.findByRole('button', {name: 'Confirm'}));
            await waitFor(() => expect(tray()).toEqual([['freeze', 'node-1', 'running', null]]));
            expect(screen.queryByRole('status', {name: /requested/i})).not.toBeInTheDocument();
        });

        test('shows error if token missing', async () => {
            localStorage.removeItem('authToken');
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            fireEvent.click(await screen.findByRole('button', {name: 'Confirm'}));
            expect(await screen.findByRole('alert')).toHaveTextContent(/Authentication token not found/i);
        });

        test('partial success', async () => {
            global.fetch = vi.fn((url) =>
                url.includes('node-1')
                    ? Promise.resolve({ok: true, json: () => ({})})
                    : Promise.reject(new Error('HTTP error'))
            );
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            fireEvent.click(checkboxes[2]);
            const actionsBtn = screen.getByRole('button', {name: 'Actions'});
            await waitFor(() => expect(actionsBtn).toBeEnabled());
            fireEvent.click(actionsBtn);
            fireEvent.click(await screen.findByRole('menuitem', {name: /^Freeze$/i}));
            expect(screen.getByTestId('dialog-freeze')).toHaveTextContent('Confirm Freeze Action on 2 nodes');
            fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
            await waitFor(() => expect(tray()).toHaveLength(2));
            expect(tray()).toEqual(expect.arrayContaining([
                ['freeze', 'node-1', 'succeeded', null],
                ['freeze', 'node-2', 'refused', 'HTTP error'],
            ]));
        });

        test('total failure', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('fail'));
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            fireEvent.click(await screen.findByRole('button', {name: 'Confirm'}));
            await waitFor(() => expect(tray()).toEqual([['freeze', 'node-1', 'refused', 'fail']]));
        });

        test('a node already frozen in the selection is not frozen again, the others are', async () => {
            setStore({
                nodeStatus: {
                    ...createDefaultStore().nodeStatus,
                    'node-1': {...createDefaultStore().nodeStatus['node-1'], frozen_at: '2023-01-01T00:00:00Z'},
                },
            });
            global.fetch = vi.fn().mockResolvedValue({ok: true});
            renderWithRouter(<NodesTable/>);
            fireEvent.click(await screen.findByRole('checkbox', {name: 'select node-2'}));
            await actOnFirstNode('Freeze');
            fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
            await waitFor(() => expect(tray()).toEqual([['freeze', 'node-1', 'refused', 'already frozen']]));
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(global.fetch.mock.calls[0][0]).toContain('/node-2/');
        });

        test('handles HTTP error response', async () => {
            global.fetch = vi.fn().mockResolvedValue({ok: false, status: 500});
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            fireEvent.click(await screen.findByRole('button', {name: 'Confirm'}));
            await waitFor(() => {
                expect(mockLogger.error).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to execute freeze on node-1: HTTP error! status: 500')
                );
            });
            await waitFor(() => expect(tray()).toEqual([['freeze', 'node-1', 'refused', expect.stringMatching(/^HTTP 500/)]]));
        });

        test('correct URL for restart daemon', async () => {
            global.fetch = vi.fn().mockResolvedValue({ok: true});
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Restart');
            fireEvent.click(await screen.findByRole('button', {name: 'Confirm'}));
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(/\/daemon\/action\/restart$/),
                    expect.objectContaining({method: 'POST'})
                )
            );
        });

        test('correct URL for daemon stop via menu', async () => {
            global.fetch = vi.fn().mockResolvedValue({ok: true});
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            const actionsBtn = screen.getByRole('button', {name: 'Actions'});
            await waitFor(() => expect(actionsBtn).toBeEnabled());
            fireEvent.click(actionsBtn);
            fireEvent.click(await screen.findByRole('menuitem', {name: /^Stop$/i}));
            fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(/\/daemon\/action\/stop$/),
                    expect.any(Object)
                )
            );
        });

        test('correct URL for node-level freeze via menu', async () => {
            global.fetch = vi.fn().mockResolvedValue({ok: true});
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            const actionsBtn = screen.getByRole('button', {name: 'Actions'});
            await waitFor(() => expect(actionsBtn).toBeEnabled());
            fireEvent.click(actionsBtn);
            fireEvent.click(await screen.findByRole('menuitem', {name: /^Freeze$/i}));
            fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(/\/action\/freeze$/),
                    expect.any(Object)
                )
            );
        });

        test('no dequeue: the daemon dequeues the actions the collector says queued, on each feed', async () => {
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            const actionsBtn = screen.getByRole('button', {name: 'Actions'});
            await waitFor(() => expect(actionsBtn).toBeEnabled());
            fireEvent.click(actionsBtn);
            await screen.findByRole('menuitem', {name: /^Drain$/i});
            expect(screen.queryByRole('menuitem', {name: /dequeue/i})).toBeNull();
        });

        test.each([
            ['Asset', /\/action\/push\/asset$/],
            ['Disks', /\/action\/push\/disk$/],
            ['Packages', /\/action\/push\/pkg$/],
            ['Capabilities', /\/action\/scan\/capabilities$/],
            ['Sysreport', /\/action\/sysreport$/],
            ['Drain', /\/action\/drain$/],
            ['Clear monitor', /\/action\/clear$/],
            ['SCSI', /\/action\/scsi\/scan$/],
            ['Restart', /\/daemon\/action\/restart$/],
            ['Shutdown', /\/daemon\/action\/shutdown$/],
        ])('correct URL for %s', async (label, urlPattern) => {
            global.fetch = vi.fn().mockResolvedValue({ok: true});
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            const actionsBtn = screen.getByRole('button', {name: 'Actions'});
            await waitFor(() => expect(actionsBtn).toBeEnabled());
            fireEvent.click(actionsBtn);
            fireEvent.click(await screen.findByRole('menuitem', {name: new RegExp(`^${label}$`, 'i')}));
            fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(urlPattern),
                    expect.any(Object)
                )
            );
        });

        test('handleDialogConfirm with null pendingAction does nothing', async () => {
            global.fetch = vi.fn().mockResolvedValue({ok: true});
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            fireEvent.click(screen.getByText('Cancel'));
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('the feedback closes with its Close button', async () => {
            localStorage.removeItem('authToken');
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            fireEvent.click(await screen.findByRole('button', {name: 'Confirm'}));
            const message = await screen.findByText(/Authentication token not found/i);
            const close = screen.getAllByRole('button', {name: 'Close'}).find((btn) => btn.closest('[role="alert"]'));
            expect(close).toBeDefined();
            fireEvent.click(close);
            await waitFor(() => expect(message).not.toBeInTheDocument());
        });

        test('the feedback hides itself after a while', async () => {
            localStorage.removeItem('authToken');
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            vi.useFakeTimers();
            try {
                fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
                expect(screen.getByText(/Authentication token not found/i)).toBeInTheDocument();
                act(() => {
                    vi.advanceTimersByTime(5000);
                });
                expect(screen.queryByText(/Authentication token not found/i)).not.toBeInTheDocument();
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('menus', () => {
        test('passes each row its data and callbacks: no row actions, the panel holds them', async () => {
            renderWithRouter(<NodesTable/>);
            expect(await screen.findByTestId('props-node-1')).toHaveTextContent(
                'daemonNodename,isOpen,isSelected,monitor,nodename,onOpen,onSelect,stats,status'
            );
        });

        test('bulk menu lists the node actions by group, a column each, each with what it does, the harmful ones red', async () => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(await screen.findByRole('checkbox', {name: 'select node-2'}));
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            const menu = await screen.findByRole('menu', {name: 'Actions'});
            // The node, its inventory, its daemon, in that order, a column each in a wide window.
            expect([...menu.querySelectorAll('[data-menu-heading]')].map((h) => h.textContent)).toEqual(['Node', 'Inventory', 'Daemon']);
            expect(menu).toHaveClass('md:grid-cols-3');
            const entries = within(menu).getAllByRole('menuitem');
            expect(entries.map((item) => item.getAttribute('aria-labelledby') && document.getElementById(item.getAttribute('aria-labelledby')).textContent)).toEqual([
                'Freeze',
                'Asset', 'Capabilities', 'Disks', 'Packages', 'SCSI', 'Sysreport',
                'Clear monitor', 'Restart', 'Shutdown', 'Stop', 'Drain', 'Leave',
            ]);
            // Not frozen, no unfreeze; no abort, the badge of the orchestration offers it; no dequeue.
            expect(within(menu).queryByRole('menuitem', {name: /unfreeze|abort|dequeue/i})).toBeNull();
            // What each does, described; the harmful ones red.
            expect(within(menu).getByRole('menuitem', {name: 'Stop'})).toHaveAccessibleDescription('Stop the daemon; the instances keep running, unwatched.');
            expect(['Shutdown', 'Stop', 'Drain', 'Leave'].every((name) => within(menu).getByRole('menuitem', {name}).classList.contains('text-state-down'))).toBe(true);
            expect(within(menu).getByRole('menuitem', {name: 'Restart'})).not.toHaveClass('text-state-down');
        });

        test('leave: the cluster evicts the node, asked of the api node; not offered for the api node itself', async () => {
            global.fetch = vi.fn().mockResolvedValue({ok: true});
            renderWithRouter(<NodesTable/>);
            fireEvent.click(await screen.findByRole('checkbox', {name: 'select node-2'}));
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            fireEvent.click(await screen.findByRole('menuitem', {name: 'Leave'}));
            fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
            await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
                '/api/cluster/evict',
                expect.objectContaining({method: 'POST', body: JSON.stringify({node: 'node-2'})}),
            ));
            // The api node, node-1, selected: leave off, said why.
            fireEvent.click(screen.getByRole('checkbox', {name: 'select node-1'}));
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            const leave = await screen.findByRole('menuitem', {name: 'Leave'});
            expect(leave).toBeDisabled();
            expect(leave).toHaveAccessibleDescription('Ask it from the webapp of another node: this one serves the webapp.');
        });

        test('filters based on frozen/unfrozen state and closes via Escape', async () => {
            setStore({
                nodeStatus: {
                    ...createDefaultStore().nodeStatus,
                    'node-1': {...createDefaultStore().nodeStatus['node-1'], frozen_at: '2023-01-01T00:00:00Z'},
                },
            });
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            fireEvent.click(checkboxes[2]);
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            await waitFor(() => {
                expect(screen.getByRole('menuitem', {name: /^Unfreeze$/i})).toBeInTheDocument();
                expect(screen.getByRole('menuitem', {name: /^Freeze$/i})).toBeInTheDocument();
            });
            fireEvent.keyDown(screen.getByRole('menu'), {key: 'Escape'});
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        });

        test('no menu while no node is selected: a hint says how to act', async () => {
            renderWithRouter(<NodesTable/>);
            await screen.findByText('node-1');
            expect(screen.queryByRole('button', {name: 'Actions'})).not.toBeInTheDocument();
            expect(screen.getByText('Select nodes to act on them, or open one')).toBeInTheDocument();
        });

        test('handleAction without nodename closes actions menu', async () => {
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
            fireEvent.click(screen.getByRole('menuitem', {name: /^Freeze$/i}));
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        });

        test('an action on one node selected is confirmed for that one', async () => {
            renderWithRouter(<NodesTable/>);
            await actOnFirstNode('Freeze');
            await waitFor(() => expect(screen.getByTestId('dialog-freeze')).toHaveTextContent('on 1 node'));
        });
    });

    describe('sorting', () => {
        test.each([
            ['State', /node-2/],
            ['Score', /node-3/],
            ['Load (15m)', /node-3/],
            ['Mem Avail', /node-3/],
            ['Swap Avail', /node-3/],
            ['Version', /node-1/],
        ])('ascending sort by %s', async (header, expectedFirst) => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: header}));
            await waitFor(() => {
                const firstRow = screen.getAllByTestId(/row-/)[0];
                expect(firstRow).toHaveTextContent(expectedFirst);
            });
        });

        test('sort by name descending', async () => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: 'Name'}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent('node-3');
                expect(rows[2]).toHaveTextContent('node-1');
            });
        });

        test('toggles direction on same column, resets on new column', async () => {
            renderWithRouter(<NodesTable/>);
            const header = (name) => screen.getByRole('columnheader', {name});
            expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
            expect(header('Score')).toHaveAttribute('aria-sort', 'none');
            fireEvent.click(screen.getByRole('button', {name: 'Name'}));
            await waitFor(() => expect(header('Name')).toHaveAttribute('aria-sort', 'descending'));
            fireEvent.click(screen.getByRole('button', {name: 'Name'}));
            await waitFor(() => expect(header('Name')).toHaveAttribute('aria-sort', 'ascending'));
            fireEvent.click(screen.getByRole('button', {name: 'Name'}));
            fireEvent.click(screen.getByRole('button', {name: 'Score'}));
            await waitFor(() => expect(header('Score')).toHaveAttribute('aria-sort', 'ascending'));
            expect(header('Name')).toHaveAttribute('aria-sort', 'none');
        });

        test('sort by booted_at', async () => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: 'Booted At'}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent('node-1');
                expect(rows[2]).toHaveTextContent('node-3');
            });
        });

        test('sort by updated_at', async () => {
            setStore({
                nodeMonitor: {
                    'node-1': {state: 'idle', updated_at: '2023-01-03T00:00:00Z'},
                    'node-2': {state: 'busy', updated_at: '2023-01-01T00:00:00Z'},
                    'node-3': {state: 'idle', updated_at: '2023-01-02T00:00:00Z'},
                },
            });
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: 'Updated At'}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent('node-2');
                expect(rows[2]).toHaveTextContent('node-1');
            });
        });

        test('sort by version with empty strings', async () => {
            setStore({
                nodeStatus: {
                    ...createDefaultStore().nodeStatus,
                    'node-1': {...createDefaultStore().nodeStatus['node-1'], agent: ''},
                },
            });
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: 'Version'}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent('node-1');
            });
        });

        test('handles missing stats/monitor', async () => {
            setStore({
                nodeStats: {'node-1': {score: 100, load_15m: 1.0, mem_avail: 50, swap_avail: 30}},
                nodeMonitor: {'node-1': {state: 'idle'}},
            });
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: 'Score'}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent('node-2');
            });
        });
    });

    describe('node panel', () => {
        test('a row opens the panel of its node, marked open', async () => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(await screen.findByRole('button', {name: 'Open node-2'}));
            expect(screen.getByRole('dialog', {name: 'Node node-2'})).toHaveTextContent('node-2 on status');
            expect(within(screen.getByTestId('row-node-2')).getByText('open')).toBeInTheDocument();
            expect(window.location.search).toBe('?sel=node-2');
        });

        test('no logs column: the logs are a tab of the panel', async () => {
            renderWithRouter(<NodesTable/>);
            await screen.findByTestId('row-node-1');
            expect(screen.queryByRole('columnheader', {name: 'Logs'})).not.toBeInTheDocument();
        });

        test('closed, the URL forgets it', async () => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(await screen.findByRole('button', {name: 'Open node-1'}));
            fireEvent.click(screen.getByRole('button', {name: 'Close panel'}));
            expect(screen.queryByRole('dialog', {name: /^Node /})).not.toBeInTheDocument();
            expect(window.location.search).toBe('');
        });
    });

    describe('fetch nodes failure', () => {
        test('logs error when fetchNodes rejects', async () => {
            const error = new Error('Network error');
            const fetchNodesMock = vi.fn().mockRejectedValue(error);
            mockUseFetchDaemonStatus.mockReturnValue({
                daemon: {nodename: 'node-1'},
                fetchNodes: fetchNodesMock,
            });
            renderWithRouter(<NodesTable/>);
            await waitFor(() => {
                expect(mockLogger.error).toHaveBeenCalledWith('Failed to fetch nodes:', error);
            });
        });
    });

    test('cleans up event source on unmount', () => {
        const {unmount} = renderWithRouter(<NodesTable/>);
        unmount();
        expect(mockReleaseEventReception).toHaveBeenCalled();
    });

    test('renders the rows once data is there', () => {
        renderWithRouter(<NodesTable/>);
        expect(screen.getByText('node-1')).toBeInTheDocument();
        expect(screen.getByRole('table')).toBeInTheDocument();
    });
    describe('additional branch coverage', () => {
        test('bulk menu closes on a click outside', async () => {
            renderWithRouter(<NodesTable/>);
            const checkboxes = await screen.findAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);
            const actionsBtn = screen.getByRole('button', {name: 'Actions'});
            fireEvent.click(actionsBtn);
            expect(actionsBtn).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByRole('menu')).toBeInTheDocument();
            fireEvent.pointerDown(document.body);
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
            expect(actionsBtn).toHaveAttribute('aria-expanded', 'false');
        });

        test.each([
            ['State', 'node-1', 'node-2'],
            ['Score', 'node-1', 'node-3'],
            ['Load (15m)', 'node-2', 'node-3'],
            ['Mem Avail', 'node-2', 'node-3'],
            ['Swap Avail', 'node-2', 'node-3'],
            ['Version', 'node-3', 'node-1'],
            ['Booted At', 'node-3', 'node-1'],
            ['Updated At', 'node-1', 'node-3'],
        ])('descending sort by %s', async (header, expectedFirst, expectedLast) => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: header}));
            fireEvent.click(screen.getByRole('button', {name: header}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent(expectedFirst);
                expect(rows[2]).toHaveTextContent(expectedLast);
            });
        });

        test('sort by booted_at with missing booted_at', async () => {
            setStore({
                nodeStatus: {
                    'node-1': {state: 'idle', frozen_at: null, agent: 'v1.0', booted_at: '2023-01-01T00:00:00Z'},
                    'node-2': {state: 'busy', frozen_at: null, agent: 'v2.0', booted_at: '2023-01-02T00:00:00Z'},
                    'node-3': {state: 'idle', frozen_at: null, agent: 'v3.0'},
                },
                nodeStats: {},
                nodeMonitor: {},
            });
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: 'Booted At'}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent('node-3');
                expect(rows[1]).toHaveTextContent('node-1');
                expect(rows[2]).toHaveTextContent('node-2');
            });
        });

        test('sort by updated_at with missing updated_at', async () => {
            renderWithRouter(<NodesTable/>);
            fireEvent.click(screen.getByRole('button', {name: 'Updated At'}));
            await waitFor(() => {
                const rows = screen.getAllByTestId(/row-/);
                expect(rows[0]).toHaveTextContent('node-3');
                expect(rows[1]).toHaveTextContent('node-2');
                expect(rows[2]).toHaveTextContent('node-1');
            });
        });
    });
});
