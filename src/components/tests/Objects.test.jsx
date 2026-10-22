import React from 'react';
import '@testing-library/jest-dom';
import {render, screen, fireEvent, waitFor, within, cleanup, act} from '@testing-library/react';
import {MemoryRouter, useRouterLocation} from 'react-router-dom';
import {vi} from 'vitest';
import {axe} from 'vitest-axe';
import Objects, {PROPERTY_COLUMNS} from '../Objects';
import i18n from '../../i18n';

// ── Hoisted mock variables ─────────────────────────────────────────────
const {
    mockNavigate,
    mockRemoveObject,
    mockSetObjectStatuses,
    mockForceFlush,
} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockRemoveObject: vi.fn(),
    mockSetObjectStatuses: vi.fn(),
    mockForceFlush: vi.fn(),
}));

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        useLocation: vi.fn(() => ({search: '', pathname: '/objects'})),
        // The location the router holds, for a test to read what a panel opened.
        useRouterLocation: actual.useLocation,
    };
});

vi.mock('../../hooks/useEventStore', async (importOriginal) => {
    const actual = await importOriginal();
    const mockFn = vi.fn();
    mockFn.getState = vi.fn();
    return {
        ...actual,
        __esModule: true,
        default: mockFn,
        getState: mockFn.getState,
    };
});

const mockGrants = vi.hoisted(() => ({value: {}}));
// The nodes of the cluster configuration; null, not read: the nodes reporting an instance.
const mockClusterOrder = vi.hoisted(() => ({value: null}));
vi.mock('../../hooks/useClusterNodeOrder', () => ({useClusterNodeOrder: () => mockClusterOrder.value}));
vi.mock('../../hooks/useGrants', () => ({useGrants: () => mockGrants.value}));
vi.mock('../../hooks/useFetchDaemonStatus', () => ({
    default: vi.fn(() => ({daemon: {cluster: {object: {}}}})),
}));

const {mockRetainEventReception, mockReleaseEventReception} = vi.hoisted(() => ({
    mockRetainEventReception: vi.fn(),
    mockReleaseEventReception: vi.fn(),
}));

vi.mock('../../eventSourceManager', () => ({
    retainEventReception: (...args) => {
        mockRetainEventReception(...args);
        return mockReleaseEventReception;
    },
    forceFlush: mockForceFlush,
    startLoggerReception: vi.fn(),
    closeLoggerEventSource: vi.fn(),
}));

// The panel of an object, on its own tested elsewhere: here, which object it is given.
// The views of the group tabs are tested on their own: here, which one the tab shows.
vi.mock('../RecordPanels', () => ({
    ObjectDetailPanel: ({path}) => (path ? <div data-testid="object-panel">{path}</div> : null),
}));

vi.mock('../../ui/lib/media', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMediaQuery: vi.fn(),
    };
});

import useEventStore from '../../hooks/useEventStore';
import {clearKeyStats} from '../../hooks/useKeyStats';
import useFetchDaemonStatus from '../../hooks/useFetchDaemonStatus';
import {useMediaQuery} from '../../ui/lib/media';
import {useLocation} from 'react-router-dom';
import {useActionTracker} from '../../app/action-tracker';

/** What the actions tray holds, the latest first: action, subject, state, reason. */
const tray = () => useActionTracker.getState().tracked.map((e) => [e.action, e.subject, e.state, e.error ?? null]);

// ---------- helpers ----------
let originalConsoleError;
let originalGetItem;

const defaultState = {
    objectStatus: {
        'test-ns/svc/test1': {avail: 'up', frozen: 'unfrozen', provisioned: 'true'},
        'test-ns/svc/test2': {avail: 'down', frozen: 'frozen', provisioned: 'true'},
        'root/svc/test3': {avail: 'warn', frozen: 'unfrozen', provisioned: 'true'},
        'test-ns/svc/test4': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
        'test-ns/svc/unprovisioned': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'false'},
        'test-ns/svc/unprovisioned-bool': {avail: 'n/a', frozen: 'unfrozen', provisioned: false},
    },
    objectInstanceStatus: {
        'test-ns/svc/test1': {
            node1: {avail: 'up', frozen_at: '0001-01-01T00:00:00Z'},
            node2: {avail: 'down', frozen_at: '2025-05-16T10:00:00Z'},
        },
        'test-ns/svc/test2': {
            node1: {avail: 'down', frozen_at: '2025-05-16T10:00:00Z'},
        },
        'root/svc/test3': {node2: {avail: 'warn', frozen_at: '0001-01-01T00:00:00Z'}},
        'test-ns/svc/test4': {},
        'test-ns/svc/unprovisioned': {
            node1: {avail: 'n/a', frozen_at: '0001-01-01T00:00:00Z', provisioned: 'false'},
        },
        'test-ns/svc/unprovisioned-bool': {
            node1: {avail: 'n/a', frozen_at: '0001-01-01T00:00:00Z', provisioned: false},
        },
    },
    instanceMonitor: {
        'node1:test-ns/svc/test1': {state: 'running', global_expect: 'frozen'},
        'node2:test-ns/svc/test1': {state: 'idle', global_expect: 'none'},
        'node1:test-ns/svc/test2': {state: 'failed', global_expect: 'none'},
        'node2:root/svc/test3': {state: 'idle', global_expect: 'started'},
    },
    removeObject: mockRemoveObject,
    setObjectStatuses: mockSetObjectStatuses,
};

/**
 * Two kinds on the Services tab, svc and nscfg: the Kind filter, hidden with a
 * single kind to choose, then shows.
 */
const TWO_KINDS = {
    objectStatus: {
        ...defaultState.objectStatus,
        'test-ns/nscfg/ns1': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
    },
    objectInstanceStatus: {
        ...defaultState.objectInstanceStatus,
        'test-ns/nscfg/ns1': {},
    },
};

const setup = (customState = {}, locationSearch = '', mediaQuery = true, {daemon} = {}) => {
    const state = {...defaultState, ...customState};

    const useEventStoreMock = useEventStore;
    useEventStoreMock.mockImplementation((sel) => sel(state));
    useEventStoreMock.getState.mockReturnValue(state);

    vi.mocked(useFetchDaemonStatus).mockReturnValue({daemon: daemon || {cluster: {object: {}}}});
    vi.mocked(useLocation).mockReturnValue({search: locationSearch, pathname: '/objects'});

    const mockedUseMediaQuery = vi.mocked(useMediaQuery);
    mockedUseMediaQuery.mockReset();

    if (typeof mediaQuery === 'object' && mediaQuery !== null) {
        mockedUseMediaQuery.mockImplementation((query) => {
            if (typeof query === 'string') {
                if (query.includes('min-width')) {
                    return mediaQuery.isWideScreen;
                }
                if (query.includes('max-width')) {
                    return mediaQuery.isMobile;
                }
            }
            return false;
        });
    } else {
        mockedUseMediaQuery.mockReturnValue(mediaQuery);
    }

    global.fetch = vi.fn(() => Promise.resolve({ok: true, json: () => Promise.resolve({})}));

    mockForceFlush.mockClear();
    mockNavigate.mockClear();
    mockRemoveObject.mockClear();
    mockSetObjectStatuses.mockClear();

    const RouterSearch = () => <span data-testid="router-search">{decodeURIComponent(useRouterLocation().search)}</span>;
    const utils = render(
        <MemoryRouter>
            <Objects/>
            <RouterSearch/>
        </MemoryRouter>
    );
    return {...utils, state};
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The checkbox popover of a multi-valued filter. */
const filterGroup = (label) => screen.getByRole('group', {name: label});
const queryFilterGroup = (label) => screen.queryByRole('group', {name: label});
/** The summary that opens a filter popover, holding the filter name and its choice. */
const filterSummary = (label) => filterGroup(label).closest('details').querySelector('summary');
const filterOption = (label, optionText) =>
    within(filterGroup(label)).getByRole('checkbox', {name: new RegExp(`^${escapeRegExp(optionText)}$`, 'i')});

/** The visible text of a filter option, without its mark. */
const optionText = (checkbox) => checkbox.closest('label').lastChild.lastChild.textContent;

const waitForLoad = () =>
    waitFor(() => expect(screen.getByRole('table', {name: 'Objects'})).toBeInTheDocument());

const selectFilter = async (label, optionText) => {
    const summary = filterSummary(label);
    fireEvent.click(summary);
    fireEvent.click(filterOption(label, optionText));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument(), {timeout: 1000});
};

const objectRow = (name) => screen.getByRole('row', {name: new RegExp(name, 'i')});
const rowCells = (row) => within(row).getAllByRole('cell');
/**
 * Cells: 0 selection, 1 object, 2 and 3 the properties (orchestrate, topology), 4 status,
 * then one per node (node1, node2) on a wide screen.
 */
const statusCell = (row) => rowCells(row)[2 + PROPERTY_COLUMNS.length];
const propertyCell = (row, label) => rowCells(row)[2 + PROPERTY_COLUMNS.findIndex((c) => i18n.t(c.labelKey) === label)];
const nodeCell = (row, index) => rowCells(row)[3 + PROPERTY_COLUMNS.length + index];

const selectRow = (name) => {
    const row = objectRow(name);
    const cb = within(row).getByRole('checkbox');
    fireEvent.click(cb);
    return cb;
};

const rowCheckboxes = () => screen.getAllByRole('checkbox', {name: /^Select object /});

const openActionsMenu = () =>
    fireEvent.click(screen.getByRole('button', {name: 'Actions'}));

const clickMenuItem = async (text) => {
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', {name: new RegExp(`^${text}$`, 'i')}));
};

const confirmDialog = async (buttonName = /Confirm|Stop|Delete/i) => {
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');
    const checkbox = /** @type {HTMLInputElement} */ (within(dialog).queryByRole('checkbox'));
    if (checkbox && !checkbox.checked) {
        fireEvent.click(checkbox);
    }
    fireEvent.click(within(dialog).getByRole('button', {name: buttonName}));
};

/** The feedback strip (the former snackbar): an alert for errors and warnings, a status otherwise. */
const getFeedback = () =>
    screen.getByRole('button', {name: 'Close'}).closest('[role="alert"], [role="status"]');

/** The rows of the objects, past the header, the lines of the namespaces left out. */
const objectRows = () => within(screen.getByRole('table', {name: 'Objects'})).getAllByRole('row').slice(1)
    .filter((row) => !row.hasAttribute('data-namespace-row'));
/** The lines opening the namespaces, in the order shown. */
const namespaceRows = () => [...screen.getByRole('table', {name: 'Objects'}).querySelectorAll('[data-namespace-row]')];
/** The names of the rows: the cell under the Object column, wherever the list puts it. */
const objectNamesInOrder = () => {
    const table = screen.getByRole('table', {name: 'Objects'});
    const column = within(table).getAllByRole('columnheader')
        .findIndex((h) => h.textContent.replace(/[▲▼]/g, '').trim() === 'Object');
    return objectRows().map((row) => rowCells(row)[column].textContent);
};

const makeMany = (n) => {
    const objectStatus = {};
    const objectInstanceStatus = {};
    for (let i = 0; i < n; i++) {
        const name = `test-ns/svc/obj${i}`;
        objectStatus[name] = {avail: 'up', frozen: 'unfrozen'};
        objectInstanceStatus[name] = {node1: {avail: 'up', frozen_at: '0001-01-01T00:00:00Z'}};
    }
    return {objectStatus, objectInstanceStatus};
};


beforeEach(() => {
    originalConsoleError = console.error;
    console.error = vi.fn((msg, ...args) => {
        if (
            typeof msg === 'string' &&
            (msg.includes('A props object containing a "key" prop is being spread into JSX') ||
                msg.includes('<li> cannot appear as a descendant of <li>'))
        )
            return;
        originalConsoleError.call(console, msg, ...args);
    });
    vi.clearAllMocks();
    originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn().mockReturnValue('mock-token');
    mockRemoveObject.mockClear();
    mockSetObjectStatuses.mockClear();
    vi.mocked(useMediaQuery).mockReset();
    useActionTracker.setState({tracked: [], revealed: 0});
    cleanup();
});

afterEach(() => {
    console.error = originalConsoleError;
    Storage.prototype.getItem = originalGetItem;
    vi.restoreAllMocks();
    cleanup();
});

// ---------- tests ----------
describe('Objects Component', () => {
    test('initial render and data fetch', async () => {
        const {unmount} = setup();
        await waitForLoad();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Object')).toBeInTheDocument();
        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(mockRetainEventReception).toHaveBeenCalledWith('mock-token', expect.any(Array));
        // The instances of a node dropped are deleted: the list hears it, for its "?".
        expect(mockRetainEventReception.mock.calls[0][1]).toContain('InstanceConfigDeleted');
        unmount();
        expect(mockReleaseEventReception).toHaveBeenCalled();
    });

    test('does not start event reception without a token', async () => {
        Storage.prototype.getItem = vi.fn().mockReturnValue(null);
        setup();
        await waitForLoad();
        expect(mockRetainEventReception).not.toHaveBeenCalled();
    });

    test('renders object data correctly (status labels)', async () => {
        setup({}, '', {isWideScreen: true, isMobile: false});
        await waitForLoad();
        ['test-ns/svc/test1', 'test-ns/svc/test2', 'root/svc/test3'].forEach((name) =>
            expect(screen.getByRole('row', {name: new RegExp(name)})).toBeInTheDocument()
        );
        const row1 = objectRow('test-ns/svc/test1');
        const status1 = statusCell(row1);
        expect(status1.querySelector('[data-state]')).toHaveAttribute('data-state', 'up');
        // The availability in a bold word, in its tint.
        expect(within(status1).getByText('up')).toHaveClass('font-semibold', 'text-state-up');
        // The global expect of an instance, as small muted text.
        expect(within(status1).getByText('frozen')).toHaveClass('text-ink-muted', 'whitespace-nowrap');
        expect(within(status1).queryByTitle('frozen')).toHaveTextContent('frozen');
        expect(within(status1).queryByRole('img', {name: 'Not provisioned'})).not.toBeInTheDocument();

        const row2 = objectRow('test-ns/svc/test2');
        expect(statusCell(row2).querySelector('[data-state]')).toHaveAttribute('data-state', 'down');
        // Frozen object: the snowflake mark, named for screen readers.
        expect(within(statusCell(row2)).getByText('frozen')).toHaveClass('sr-only');

        const row3 = objectRow('root/svc/test3');
        expect(statusCell(row3).querySelector('[data-state]')).toHaveAttribute('data-state', 'warn');
        expect(within(statusCell(row3)).getByText('started')).toBeInTheDocument();

        const row4 = objectRow('test-ns/svc/test4');
        expect(statusCell(row4).querySelector('[data-state]')).toHaveAttribute('data-state', 'na');
        expect(within(statusCell(row4)).getByText('n/a')).toHaveClass('text-ink-muted');

        // The object name first, medium weight.
        expect(rowCells(row1)[1]).toHaveTextContent('test-ns/svc/test1');
        expect(rowCells(row1)[1]).toHaveClass('font-medium');
    });

    test('has no per-row actions column', async () => {
        setup({}, '', {isWideScreen: true, isMobile: false});
        await waitForLoad();
        expect(screen.queryByRole('columnheader', {name: 'Actions'})).not.toBeInTheDocument();
        // No action button in a row: its only buttons open the instances of its nodes.
        expect(within(objectRow('test-ns/svc/test1')).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
            .toEqual(['Open the instance of test-ns/svc/test1 on node1', 'Open the instance of test-ns/svc/test1 on node2']);
    });

    describe('object property columns', () => {
        const propertyState = {
            objectStatus: {
                'test-ns/svc/fo': {
                    avail: 'up', overall: 'up', frozen: 'unfrozen', provisioned: 'true',
                    orchestrate: 'ha', topology: 'failover', placement_policy: 'nodes order',
                    placement_state: 'optimal', up_instances_count: 1, scope: ['node1', 'node2'], priority: 10,
                },
                'test-ns/svc/fx': {
                    avail: 'up', overall: 'warn', frozen: 'unfrozen', provisioned: 'true',
                    orchestrate: 'start', topology: 'flex', flex: {min: 1, max: 3, target: 2},
                    placement_policy: 'spread', placement_state: 'non-optimal', up_instances_count: 2,
                    scope: ['node1', 'node2', 'node3'], priority: 50,
                },
                'test-ns/usr/c': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true', scope: ['node1'], priority: 50},
            },
            objectInstanceStatus: {},
        };

        test('show orchestrate and topology', async () => {
            setup(propertyState, '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            ['Placement', 'Up', 'Priority'].forEach((label) =>
                expect(screen.queryByRole('columnheader', {name: new RegExp(`^${label}`)})).not.toBeInTheDocument()
            );
            PROPERTY_COLUMNS.forEach(({labelKey}) =>
                expect(screen.getByRole('columnheader', {name: new RegExp(`^${i18n.t(labelKey)}`)})).toBeInTheDocument()
            );

            const failover = objectRow('test-ns/svc/fo');
            // Plain words: no icon, no badge.
            expect(propertyCell(failover, 'Orchestrate')).toHaveTextContent(/^ha$/);
            expect(propertyCell(failover, 'Topology')).toHaveTextContent(/^failover$/);
            expect(propertyCell(failover, 'Orchestrate').querySelector('svg, [data-policy]')).toBeNull();

            // Flex: its parameters in a badge, min-max then the target, each named in its card.
            const flex = propertyCell(objectRow('test-ns/svc/fx'), 'Topology');
            expect(flex).toHaveTextContent(/^flex1-3 · 2$/);
            const badge = flex.querySelector('[data-flex]');
            fireEvent.mouseEnter(badge.parentElement);
            const card = await screen.findByRole('tooltip');
            expect(within(card).getByText('Flex')).toBeInTheDocument();
            expect(within(card).getByText('Min instances').nextSibling).toHaveTextContent('1');
            expect(within(card).getByText('Max instances').nextSibling).toHaveTextContent('3');
            expect(within(card).getByText('Target instances').nextSibling).toHaveTextContent('2');
        });

        test('the status marks a degraded object, its overall warn, whatever its availability', async () => {
            setup(propertyState, '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            const degraded = within(statusCell(objectRow('test-ns/svc/fx'))).getByRole('img', {name: 'Degraded'});
            expect(degraded).toHaveClass('text-state-warn');
            expect(within(statusCell(objectRow('test-ns/svc/fx'))).getByText('up')).toHaveClass('text-state-up');
            expect(within(statusCell(objectRow('test-ns/svc/fo'))).queryByRole('img', {name: 'Degraded'})).not.toBeInTheDocument();
        });

        test('narrow: the orchestrate and the topology one badge by the path, the instances up out of the target in their column', async () => {
            setup(propertyState, '?list=any', {isWideScreen: false, isMobile: true});
            await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
            expect(screen.queryByRole('columnheader', {name: /^Orchestrate/})).not.toBeInTheDocument();
            expect(screen.queryByRole('columnheader', {name: /^Topology/})).not.toBeInTheDocument();
            expect(screen.getByRole('columnheader', {name: /^Up/})).toBeInTheDocument();
            const cells = (name) => rowCells(objectRow(name));
            expect(within(cells('test-ns/svc/fo')[1]).getByRole('img', {name: 'Orchestrate: ha, Topology: failover'}))
                .toHaveTextContent(/^ha · failover$/);
            // A flex: its sizes left out of the badge.
            expect(within(cells('test-ns/svc/fx')[1]).getByRole('img', {name: 'Orchestrate: start, Topology: flex'}))
                .toHaveTextContent(/^start · flex$/);
            expect(cells('test-ns/usr/c')[1].querySelector('[data-mark="orchestrate"]')).toBeNull();
            // Up out of the target: one for a failover, the flex target else; then the status.
            expect(cells('test-ns/svc/fo')[2]).toHaveTextContent(/^1\/1$/);
            expect(cells('test-ns/svc/fx')[2]).toHaveTextContent(/^2\/2$/);
            expect(cells('test-ns/svc/fx')[2]).not.toHaveClass('text-state-warn');
            expect(cells('test-ns/usr/c')[2]).toHaveTextContent(/^$/);
            expect(cells('test-ns/svc/fo')).toHaveLength(4);
            // The badge on its line over the path; kept empty without one, the rows as high.
            const line = cells('test-ns/svc/fo')[1].querySelector('[data-badge-line]');
            expect(line.nextSibling.textContent).toBe('test-ns/svc/fo');
            expect(cells('test-ns/usr/c')[1].querySelector('[data-badge-line]')).toBeEmptyDOMElement();
        });

        test('narrow: a cfg or a sec, a datastore', async () => {
            const state = structuredClone(propertyState);
            state.objectStatus['test-ns/cfg/settings'] = {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true', scope: ['node1']};
            setup(state, '?list=any', {isWideScreen: false, isMobile: true});
            await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
            const badge = rowCells(objectRow('test-ns/cfg/settings'))[1].querySelector('[data-badge-line] [data-mark="datastore"]');
            expect(badge).toHaveTextContent(/^datastore$/);
        });

        test('narrow: the topology alone for no orchestrate; short of the target, in the warn tint', async () => {
            const state = structuredClone(propertyState);
            state.objectStatus['test-ns/svc/fo'] = {...state.objectStatus['test-ns/svc/fo'], orchestrate: 'no', up_instances_count: 0};
            setup(state, '', {isWideScreen: false, isMobile: true});
            await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
            const cells = rowCells(objectRow('test-ns/svc/fo'));
            expect(within(cells[1]).getByRole('img', {name: 'Topology: failover'})).toHaveTextContent(/^failover$/);
            expect(cells[2]).toHaveTextContent(/^0\/1$/);
            expect(cells[2]).toHaveClass('text-state-warn');
        });

        test('are empty for an object with no instances to place', async () => {
            setup(propertyState, '?list=any', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            const cfg = objectRow('test-ns/usr/c');
            ['Orchestrate', 'Topology'].forEach((label) =>
                expect(propertyCell(cfg, label)).toHaveTextContent(/^$/)
            );
        });
    });

    test('a node gone keeps its column, a "?" for the objects it runs, as om mon', async () => {
        // node3, of the cluster, reports nothing: dropped, its instances deleted.
        mockClusterOrder.value = ['node2', 'node1', 'node3'];
        try {
            setup({
                objectStatus: {
                    ...defaultState.objectStatus,
                    'test-ns/svc/test1': {...defaultState.objectStatus['test-ns/svc/test1'], scope: ['node1', 'node2', 'node3']},
                    'root/svc/test3': {...defaultState.objectStatus['root/svc/test3'], scope: ['node2']},
                },
            }, '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            // In the order of the cluster configuration.
            const headers = within(screen.getByRole('table', {name: 'Objects'})).getAllByRole('columnheader')
                .map((h) => h.textContent).filter((text) => /^node/.test(text));
            expect(headers).toEqual(['node2', 'node1', 'node3']);
            const gone = nodeCell(objectRow('test-ns/svc/test1'), 2);
            expect(gone).toHaveTextContent('?');
            expect(within(gone).getByTitle('No status from node3: the node is gone or not heard from')).toHaveClass('text-state-down');
            // Not of its scope: nothing.
            expect(nodeCell(objectRow('root/svc/test3'), 2)).toHaveTextContent(/^$/);
            expect(nodeCell(objectRow('root/svc/test3'), 1)).toHaveTextContent(/^$/);
        } finally {
            mockClusterOrder.value = null;
        }
    });

    test('per-node cells show avail, frozen, not provisioned and monitor state', async () => {
        setup({}, '', {isWideScreen: true, isMobile: false});
        await waitForLoad();
        expect(screen.getByRole('columnheader', {name: /node1/})).toBeInTheDocument();
        expect(screen.getByRole('columnheader', {name: /node2/})).toBeInTheDocument();

        const row1 = objectRow('test-ns/svc/test1');
        const node1 = nodeCell(row1, 0);
        // The instance of a service on a node opens its own panel, a button of its own.
        expect(within(node1).getByRole('button', {name: 'Open the instance of test-ns/svc/test1 on node1'})).toBeInTheDocument();
        expect(node1.querySelector('[data-state]')).toHaveAttribute('data-state', 'up');
        expect(within(node1).getByText('running')).toHaveClass('text-ink-muted', 'whitespace-nowrap');
        expect(within(node1).queryByTitle('frozen')).not.toBeInTheDocument();
        const node2 = nodeCell(row1, 1);
        expect(node2.querySelector('[data-state]')).toHaveAttribute('data-state', 'down');
        // Its object up, the instance down is no issue: gray, not red.
        expect(node2.querySelector('[data-state]')).toHaveClass('text-ink-muted');
        expect(node2.querySelector('[data-state]')).not.toHaveClass('text-state-down');
        expect(within(node2).getByTitle('frozen')).toBeInTheDocument();
        // An idle instance shows no monitor state.
        expect(within(node2).queryByText('idle')).not.toBeInTheDocument();

        const row2 = objectRow('test-ns/svc/test2');
        expect(within(nodeCell(row2, 0)).getByText('failed')).toBeInTheDocument();
        // No instance on that node: an empty cell.
        expect(nodeCell(row2, 1)).toBeEmptyDOMElement();

        const unprovisioned = objectRow('test-ns/svc/unprovisioned(?!-bool)');
        const unprovisionedNode = nodeCell(unprovisioned, 0);
        expect(unprovisionedNode.querySelector('[data-state]')).toHaveAttribute('data-state', 'na');
        expect(within(unprovisionedNode).getByRole('img', {name: 'Not provisioned'})).toHaveClass('text-state-down');

        // A line before the first node column, the per-node columns past it.
        expect(screen.getByRole('columnheader', {name: /node1/})).toHaveClass('border-l');
        expect(screen.getByRole('columnheader', {name: /node2/})).not.toHaveClass('border-l');
        expect(nodeCell(row1, 0)).toHaveClass('border-l');
        expect(nodeCell(row1, 1)).not.toHaveClass('border-l');
    });

    test('selection and select all', async () => {
        setup();
        await waitForLoad();
        const cb = selectRow('test-ns/svc/test1');
        expect(cb).toBeChecked();
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        const selectAll = screen.getByRole('checkbox', {name: 'Select all objects'});
        expect(selectAll).not.toBeChecked();
        fireEvent.click(selectAll);
        expect(selectAll).toBeChecked();
        rowCheckboxes().forEach((c) => expect(c).toBeChecked());
        expect(screen.getByText(`${rowCheckboxes().length} selected`)).toBeInTheDocument();
        fireEvent.click(selectAll);
        rowCheckboxes().forEach((c) => expect(c).not.toBeChecked());
        expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    });

    test('select all selects the filtered objects only', async () => {
        setup();
        await waitForLoad();
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'test1'}});
        await waitFor(() => expect(rowCheckboxes()).toHaveLength(1));
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select all objects'}));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
    });

    test('an object a filter hides leaves the selection, and stays out when the filter goes', async () => {
        setup();
        await waitForLoad();
        selectRow('test-ns/svc/test1');
        selectRow('test-ns/svc/test2');
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'test1'}});
        await waitFor(() => expect(rowCheckboxes()).toHaveLength(1));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: ''}});
        await waitFor(() => expect(rowCheckboxes().length).toBeGreaterThan(1));
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', {name: 'Select object test-ns/svc/test2'})).not.toBeChecked();
    });

    test('actions menu opens and lists actions', async () => {
        setup();
        await waitForLoad();
        selectRow('test-ns/svc/test1');
        openActionsMenu();
        const menu = await screen.findByRole('menu');
        ['Restart', 'Stop', 'Freeze', 'Delete'].forEach((a) =>
            expect(within(menu).getByRole('menuitem', {name: a})).toBeEnabled()
        );
        // The destructive actions carry the down colour on their icon.
        expect(within(menu).getByRole('menuitem', {name: 'Delete'}).querySelector('.text-state-down')).not.toBeNull();
        expect(within(menu).getByRole('menuitem', {name: 'Restart'}).querySelector('.text-state-down')).toBeNull();
    });

    test('a selection of configurations offers what applies to keys only: abort, delete, purge', async () => {
        setup({
            objectStatus: {
                ...defaultState.objectStatus,
                'test-ns/cfg/conf1': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
            },
        }, '?list=configs');
        await waitForLoad();
        selectRow('test-ns/cfg/conf1');
        openActionsMenu();
        const menu = await screen.findByRole('menu');
        expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Abort', 'Delete', 'Purge']);
        expect(within(menu).getByRole('menuitem', {name: 'Delete'})).toBeEnabled();
        expect(within(menu).getByRole('menuitem', {name: 'Abort'})).toBeEnabled();
    });

    test('a selection of secrets offers no purge: a secret is deleted', async () => {
        setup({
            objectStatus: {
                ...defaultState.objectStatus,
                'test-ns/cfg/conf1': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
                'test-ns/sec/sec1': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
            },
        }, '?list=secrets');
        await waitForLoad();
        selectRow('test-ns/sec/sec1');
        openActionsMenu();
        const menu = await screen.findByRole('menu');
        expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Abort', 'Delete']);
    });

    describe('tabs', () => {
        const mixed = {
            objectStatus: {
                ...defaultState.objectStatus,
                'test-ns/cfg/conf1': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
                'test-ns/sec/sec1': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
                'cluster': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
                'test-ns/usr/usr1': {avail: 'n/a', frozen: 'unfrozen', provisioned: 'true'},
                'test-ns/vol/data': {avail: 'up', frozen: 'unfrozen', provisioned: 'true'},
            },
        };
        const configs = ['test-ns/cfg/conf1', 'cluster'];

        test('no tab bar: the menu opens each list, the services by default, the namespaces a view of their own', async () => {
            setup(mixed);
            await waitForLoad();
            expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
            expect(screen.queryByRole('tab')).not.toBeInTheDocument();
            expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
            // The services, without a list in the address.
            expect(objectNamesInOrder()).not.toEqual(expect.arrayContaining([configs[0]]));
            expect(objectNamesInOrder()).not.toContain('test-ns/usr/usr1');
            expect(objectNamesInOrder()).not.toContain('test-ns/vol/data');
        });

        test.each(['configs', 'secrets', 'users'])('list=%s, held on all the nodes, shows their names and keys only: no status, placement nor node column', async (tab) => {
            setup({...mixed, objectInstanceStatus: {'test-ns/usr/usr1': {node1: {}}, 'test-ns/cfg/conf1': {node1: {}}}},
                `?list=${tab}`, {isWideScreen: true, isMobile: false});
            await waitForLoad();
            const table = screen.getByRole('table', {name: 'Objects'});
            expect(within(table).getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim())).toEqual(['', 'Object', 'Keys', 'Size']);
            for (const row of objectRows()) {
                expect(within(row).getAllByRole('cell')).toHaveLength(4);
            }
        });

        test('the keys of each configuration shown: how many, and their size as stored; the cluster object has none', async () => {
            const state = {...mixed, instanceConfig: {'test-ns/cfg/conf1': {node1: {csum: 'a', updated_at: 't1'}}}};
            const {state: full} = setup(state, '?list=configs');
            await waitForLoad();
            // What the rows read with the fetch of setup, settled then forgotten.
            await act(async () => {});
            clearKeyStats();
            global.fetch = vi.fn((url) => Promise.resolve(url === '/api/object/path/test-ns/cfg/conf1/data/keys'
                ? {ok: true, json: () => Promise.resolve({items: [{name: 'a', size: 10}, {name: 'b', size: 2038}]})}
                : {ok: false, status: 400, json: () => Promise.resolve({})}));
            // Rendered again, the rows read their keys with the fetch of this test.
            cleanup();
            render(<MemoryRouter><Objects/></MemoryRouter>);
            await waitForLoad();
            const cells = (name) => rowCells(objectRow(name)).map((c) => c.textContent);
            await waitFor(() => expect(cells('test-ns/cfg/conf1').slice(2)).toEqual(['2', '2 KiB']));
            // The cluster object is no store of keys: a dash, after a refused read.
            await waitFor(() => expect(cells('cluster').slice(2)).toEqual(['–', '–']));
            // Read once per configuration of the object, whatever the renders.
            const reads = () => global.fetch.mock.calls.filter(([url]) => url.endsWith('/cfg/conf1/data/keys')).length;
            expect(reads()).toBe(1);

            // Its configuration changed: read again.
            useEventStore.mockImplementation((sel) => sel({...full, instanceConfig: {'test-ns/cfg/conf1': {node1: {csum: 'b', updated_at: 't2'}}}}));
            cleanup();
            render(<MemoryRouter><Objects/></MemoryRouter>);
            await waitFor(() => expect(reads()).toBe(2));
        });

        test.each(['configs', 'secrets', 'users'])('list=%s has no global state filter, one in the URL filtering nothing', async (tab) => {
            setup(mixed, `?list=${tab}&globalState=up`);
            await waitForLoad();
            expect(queryFilterGroup('Global State')).not.toBeInTheDocument();
            expect(objectNamesInOrder().length).toBeGreaterThan(0);
        });

        test.each(['services', 'volumes', 'any'])('list=%s keeps the global state filter', async (tab) => {
            setup(mixed, `?list=${tab}`);
            await waitForLoad();
            expect(filterGroup('Global State')).toBeInTheDocument();
        });

        test('the services keep their status, placement and node columns', async () => {
            setup(mixed, '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            const headers = within(screen.getByRole('table', {name: 'Objects'})).getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim());
            expect(headers.slice(1, 5)).toEqual(['Object', 'Orchestrate', 'Topology', 'Status']);
        });

        test('list=users shows the users alone', async () => {
            setup(mixed, '?list=users');
            await waitForLoad();
            expect(objectNamesInOrder()).toEqual(['test-ns/usr/usr1']);
        });

        test('list=configs shows the configurations alone, no Kind filter: the kind filter is All\'s', async () => {
            setup(mixed, '?list=configs');
            await waitForLoad();
            expect([...objectNamesInOrder()].sort()).toEqual([...configs].sort());
            expect(queryFilterGroup('Kind')).not.toBeInTheDocument();
        });

        test.each([
            ['secrets', ['test-ns/sec/sec1']],
            ['volumes', ['test-ns/vol/data']],
        ])('list=%s shows them alone', async (tab, names) => {
            setup(mixed, `?list=${tab}`);
            await waitForLoad();
            expect(objectNamesInOrder()).toEqual(names);
        });

        test('list=any, All, shows the objects of all the lists, with their status, placement and node columns', async () => {
            setup(mixed, '?list=any', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            expect([...objectNamesInOrder()].sort()).toEqual(Object.keys(mixed.objectStatus).sort());
            const headers = within(screen.getByRole('table', {name: 'Objects'})).getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim());
            expect(headers.slice(1, 5)).toEqual(['Object', 'Orchestrate', 'Topology', 'Status']);
            const kinds = within(filterGroup('Kind')).getAllByRole('checkbox').map(optionText);
            expect(kinds).toEqual(expect.arrayContaining(['ccfg', 'cfg', 'sec', 'svc', 'usr', 'vol']));
        });

        test('another list, opened from the menu, drops the selection', async () => {
            const {rerender} = setup(mixed);
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            expect(screen.getByText('1 selected')).toBeInTheDocument();
            vi.mocked(useLocation).mockReturnValue({search: '?list=configs', pathname: '/objects'});
            rerender(<MemoryRouter><Objects/></MemoryRouter>);
            await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument());
            expect([...objectNamesInOrder()].sort()).toEqual([...configs].sort());
        });
    });

    describe('new object', () => {
        test('opens on the kind of the tab, the namespace filtered on', async () => {
            setup({}, '?list=configs&namespace=test-ns');
            await waitForLoad();
            fireEvent.click(screen.getByRole('button', {name: 'New object'}));
            const dialog = screen.getByRole('dialog', {name: 'New object'});
            expect(within(dialog).getByLabelText('Kind')).toHaveValue('cfg');
            expect(within(dialog).getByLabelText('Namespace')).toHaveValue('test-ns');
            // An object listed is refused as a new one.
            fireEvent.change(within(dialog).getByLabelText('Namespace'), {target: {value: 'test-ns'}});
            fireEvent.change(within(dialog).getByLabelText('Kind'), {target: {value: 'svc'}});
            fireEvent.change(within(dialog).getByLabelText('Name'), {target: {value: 'test1'}});
            expect(within(dialog).getByText('test-ns/svc/test1 already exists.')).toBeInTheDocument();
        });

        test('created, the object opens in its panel over the tab it is listed in', async () => {
            setup({}, '?kind=svc&name=t');
            await waitForLoad();
            fireEvent.click(screen.getByRole('button', {name: 'New object'}));
            const dialog = screen.getByRole('dialog', {name: 'New object'});
            fireEvent.change(within(dialog).getByLabelText('Kind'), {target: {value: 'sec'}});
            fireEvent.change(within(dialog).getByLabelText('Namespace'), {target: {value: 'test-ns'}});
            fireEvent.change(within(dialog).getByLabelText('Name'), {target: {value: 'tls'}});
            fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
            // A datastore, created empty: on its keys.
            await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/objects?name=t&list=secrets&sel=test-ns%2Fsec%2Ftls&tab=keys'));
            expect(global.fetch).toHaveBeenCalledWith('/api/object/path/test-ns/sec/tls/config/file', expect.objectContaining({method: 'POST'}));
            expect(screen.queryByRole('dialog', {name: 'New object'})).not.toBeInTheDocument();
            // Its creation, the actions tray says: no message of the list's own.
            expect(tray()).toContainEqual(['create', 'test-ns/sec/tls', 'succeeded', null]);
            expect(screen.queryByText('test-ns/sec/tls created.')).not.toBeInTheDocument();
        });

        test('created from All, the object opens over All, which lists it too', async () => {
            setup({}, '?list=any');
            await waitForLoad();
            fireEvent.click(screen.getByRole('button', {name: 'New object'}));
            const dialog = screen.getByRole('dialog', {name: 'New object'});
            expect(within(dialog).getByLabelText('Kind')).toHaveValue('svc');
            fireEvent.change(within(dialog).getByLabelText('Kind'), {target: {value: 'sec'}});
            fireEvent.change(within(dialog).getByLabelText('Namespace'), {target: {value: 'test-ns'}});
            fireEvent.change(within(dialog).getByLabelText('Name'), {target: {value: 'tls'}});
            fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
            await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/objects?list=any&sel=test-ns%2Fsec%2Ftls&tab=keys'));
        });
    });

    describe('filtering', () => {
        const filterTests = [
            {
                label: 'Namespace',
                option: 'test-ns',
                visible: ['test-ns/svc/test1', 'test-ns/svc/test2'],
                hidden: ['root/svc/test3'],
            },
            {label: 'Global State', option: 'Up', visible: ['test-ns/svc/test1'], hidden: ['test-ns/svc/test2']},
            {label: 'Kind', option: 'svc', visible: ['test-ns/svc/test1'], hidden: []},
            {
                label: 'Name',
                option: 'test1',
                visible: ['test-ns/svc/test1'],
                hidden: ['test-ns/svc/test2', 'root/svc/test3'],
                isSearch: true,
            },
        ];

        test.each(filterTests)(
            '$label filter',
            async ({label, option, visible, hidden, isSearch}) => {
                setup(label === 'Kind' ? TWO_KINDS : {}, label === 'Kind' ? '?list=any' : '');
                await waitForLoad();
                if (isSearch) {
                    fireEvent.change(screen.getByLabelText('Name'), {target: {value: option}});
                } else {
                    await selectFilter(label, option);
                }
                await waitFor(() => {
                    visible.forEach((n) =>
                        expect(screen.getByRole('row', {name: new RegExp(n)})).toBeInTheDocument()
                    );
                    hidden.forEach((n) =>
                        expect(screen.queryByRole('row', {name: new RegExp(n)})).not.toBeInTheDocument()
                    );
                });
            }
        );

        const globalStateTests = [
            {option: 'Down', visible: ['test-ns/svc/test2'], hidden: ['test-ns/svc/test1']},
            {option: 'Warn', visible: ['root/svc/test3'], hidden: ['test-ns/svc/test1']},
            {option: 'N/a', visible: ['test-ns/svc/test4'], hidden: ['test-ns/svc/test1']},
            {
                option: 'Unprovisioned',
                visible: ['test-ns/svc/unprovisioned(?!-bool)', 'test-ns/svc/unprovisioned-bool'],
                hidden: ['test1'],
            },
        ];

        test.each(globalStateTests)('Global State filter: $option', async ({option, visible, hidden}) => {
            setup();
            await waitForLoad();
            await selectFilter('Global State', option);
            await waitFor(() => {
                visible.forEach((v) =>
                    expect(screen.getByRole('row', {name: new RegExp(v)})).toBeInTheDocument()
                );
                hidden.forEach((h) =>
                    expect(screen.queryByRole('row', {name: new RegExp(h)})).not.toBeInTheDocument()
                );
            });
        });

        test('combining multiple Global State selections matches any of them', async () => {
            setup();
            await waitForLoad();
            await selectFilter('Global State', 'Up');
            await selectFilter('Global State', 'Down');
            await waitFor(() => {
                expect(screen.getByRole('row', {name: /test-ns\/svc\/test1/})).toBeInTheDocument();
                expect(screen.getByRole('row', {name: /test-ns\/svc\/test2/})).toBeInTheDocument();
                expect(screen.queryByRole('row', {name: /root\/svc\/test3/})).not.toBeInTheDocument();
            });
        });

        test('URL param "all" results in empty filters', async () => {
            setup({}, '?globalState=all&namespace=all&kind=all');
            await waitForLoad();
            await waitFor(() => {
                expect(screen.getByRole('row', {name: /test-ns\/svc\/test1/})).toBeInTheDocument();
                expect(screen.getByRole('row', {name: /test-ns\/svc\/test2/})).toBeInTheDocument();
                expect(screen.getByRole('row', {name: /root\/svc\/test3/})).toBeInTheDocument();
            });
        });

        test('unchecking a Global State option removes that filter', async () => {
            setup();
            await waitForLoad();
            await selectFilter('Global State', 'Up');
            await waitFor(() => expect(screen.queryByRole('row', {name: /test-ns\/svc\/test2/})).not.toBeInTheDocument());
            expect(filterSummary('Global State')).toHaveTextContent('Global StateUp');
            fireEvent.click(filterOption('Global State', 'Up'));
            await waitFor(() => expect(filterOption('Global State', 'Up')).not.toBeChecked());
            expect(filterSummary('Global State')).toHaveTextContent('Global StateAll');
            await waitFor(() => expect(screen.getByRole('row', {name: /test-ns\/svc\/test2/})).toBeInTheDocument());
        });

        test('filter popovers list the global states, namespaces and kinds on offer', async () => {
            setup(TWO_KINDS, '?list=any');
            await waitForLoad();
            expect(within(filterGroup('Global State')).getAllByRole('checkbox').map(optionText))
                .toEqual(['Up', 'Down', 'Warn', 'N/a', 'Unprovisioned']);
            expect(within(filterGroup('Namespace')).getAllByRole('checkbox').map(optionText))
                .toEqual(['root', 'test-ns']);
            expect(within(filterGroup('Kind')).getAllByRole('checkbox').map(optionText))
                .toEqual(['nscfg', 'svc']);
            // Each global state carries its mark.
            expect(filterOption('Global State', 'Up').closest('label').querySelector('[data-state="up"]')).not.toBeNull();
            expect(filterOption('Global State', 'N/a').closest('label').querySelector('[data-state="na"]')).not.toBeNull();
            // Unprovisioned: the P of the not-provisioned marks, decorative beside its word.
            const p = filterOption('Global State', 'Unprovisioned').closest('label').querySelector('[data-mark="not-provisioned"]');
            expect(p).toHaveTextContent(/^P$/);
            expect(p).toHaveAttribute('aria-hidden', 'true');
        });

        test('filter popover opens from its summary and closes on Escape or a click outside', async () => {
            setup();
            await waitForLoad();
            const details = filterGroup('Namespace').closest('details');
            expect(details.open).toBe(false);
            fireEvent.click(filterSummary('Namespace'));
            expect(details.open).toBe(true);
            fireEvent.keyDown(filterOption('Namespace', 'root'), {key: 'Escape'});
            expect(details.open).toBe(false);
            expect(filterSummary('Namespace')).toHaveFocus();
            fireEvent.click(filterSummary('Namespace'));
            expect(details.open).toBe(true);
            fireEvent.pointerDown(filterOption('Namespace', 'root'));
            expect(details.open).toBe(true);
            fireEvent.pointerDown(document.body);
            expect(details.open).toBe(false);
        });

        test('summary lists the chosen values', async () => {
            setup();
            await waitForLoad();
            expect(filterSummary('Namespace')).toHaveTextContent('NamespaceAll');
            await selectFilter('Namespace', 'test-ns');
            await selectFilter('Namespace', 'root');
            expect(filterSummary('Namespace')).toHaveTextContent('Namespacetest-ns, root');
        });

        test('no Kind filter on a tab of a kind; a kind in the URL, from All, filters nothing there', async () => {
            setup(TWO_KINDS, '?kind=nscfg');
            await waitForLoad();
            expect(queryFilterGroup('Kind')).not.toBeInTheDocument();
            // The configuration of the namespace stands in the line of its namespace, not its own.
            expect(objectNamesInOrder()).toEqual(expect.arrayContaining(['test-ns/svc/test1']));
            expect(objectNamesInOrder()).not.toContain('test-ns/nscfg/ns1');
            expect(namespaceRows().map((row) => row.dataset.namespaceRow)).toContain('test-ns');
        });

        test('Kind filter excludes objects whose kind does not match the selection', async () => {
            setup(TWO_KINDS, '?list=any');
            await waitForLoad();
            await selectFilter('Kind', 'svc');
            await waitFor(() => {
                expect(screen.getByRole('row', {name: /test-ns\/svc\/test1/})).toBeInTheDocument();
                expect(screen.queryByRole('row', {name: /test-ns\/nscfg\/ns1/})).not.toBeInTheDocument();
            });
        });

        test('no Kind nor Namespace filter with a single one to choose: every object of the tab has it', async () => {
            setup({
                objectStatus: {
                    'test-ns/svc/a': {avail: 'up', frozen: 'unfrozen', provisioned: 'true'},
                    'test-ns/svc/b': {avail: 'up', frozen: 'unfrozen', provisioned: 'true'},
                },
                objectInstanceStatus: {},
            });
            await waitForLoad();
            expect(queryFilterGroup('Kind')).not.toBeInTheDocument();
            expect(queryFilterGroup('Namespace')).not.toBeInTheDocument();
            expect(filterGroup('Global State')).toBeInTheDocument();
        });

        test('a filter on a value no object of the tab has stays shown, not to act unseen', async () => {
            setup({
                objectStatus: {'test-ns/svc/a': {avail: 'up', frozen: 'unfrozen', provisioned: 'true'}},
                objectInstanceStatus: {},
            }, '?namespace=other');
            await waitForLoad();
            expect(filterOption('Namespace', 'other')).toBeChecked();
            expect(queryFilterGroup('Kind')).not.toBeInTheDocument();
        });
    });

    test('multiple filters combined', async () => {
        setup();
        await waitForLoad();
        await selectFilter('Namespace', 'test-ns');
        await selectFilter('Global State', 'Up');
        await waitFor(() => {
            expect(screen.getByRole('row', {name: /test1/})).toBeInTheDocument();
            expect(screen.queryByRole('row', {name: /test2/})).not.toBeInTheDocument();
        });
    });

    test('unchecking a Namespace option restores the filtered objects', async () => {
        setup();
        await waitForLoad();
        await selectFilter('Namespace', 'test-ns');
        await waitFor(() =>
            expect(screen.queryByRole('row', {name: /root\/svc\/test3/})).not.toBeInTheDocument()
        );
        fireEvent.click(filterOption('Namespace', 'test-ns'));
        await waitFor(() =>
            expect(screen.getByRole('row', {name: /root\/svc\/test3/})).toBeInTheDocument()
        );
    });

    test('unchecking a Global State option restores filtered objects', async () => {
        setup();
        await waitForLoad();
        await selectFilter('Global State', 'Up');
        await waitFor(() =>
            expect(screen.queryByRole('row', {name: /test-ns\/svc\/test2/})).not.toBeInTheDocument()
        );
        fireEvent.click(filterOption('Global State', 'Up'));
        await waitFor(() =>
            expect(screen.getByRole('row', {name: /test-ns\/svc\/test2/})).toBeInTheDocument()
        );
    });

    test('unchecking a Kind option keeps the other filters', async () => {
        setup(TWO_KINDS, '?list=any');
        await waitForLoad();
        await selectFilter('Kind', 'svc');
        await selectFilter('Namespace', 'test-ns');
        await waitFor(() =>
            expect(screen.queryByRole('row', {name: /root\/svc\/test3/})).not.toBeInTheDocument()
        );
        fireEvent.click(filterOption('Kind', 'svc'));
        await waitFor(() => expect(filterOption('Kind', 'svc')).not.toBeChecked());
        expect(screen.queryByRole('row', {name: /root\/svc\/test3/})).not.toBeInTheDocument();
        fireEvent.click(filterOption('Namespace', 'test-ns'));
        await waitFor(() =>
            expect(screen.getByRole('row', {name: /root\/svc\/test3/})).toBeInTheDocument()
        );
    });

    test('empty message when nothing matches', async () => {
        setup();
        await waitForLoad();
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'nonexistent'}});
        await waitFor(() => expect(screen.getByText(/No objects found/)).toBeInTheDocument());
    });

    describe('actions execution', () => {
        test('restart succeeds', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Restart');
            await confirmDialog();
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/action/restart'),
                    expect.any(Object)
                )
            );
            // Its progress, the actions tray says: no message of its own.
            await waitFor(() => expect(mockForceFlush).toHaveBeenCalled());
            expect(screen.queryByRole('status', {name: /requested/i})).not.toBeInTheDocument();
            expect(screen.queryByRole('checkbox', {checked: true})).not.toBeInTheDocument();
        });

        test('unfreeze succeeds on frozen object', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test2');
            openActionsMenu();
            await clickMenuItem('Unfreeze');
            await confirmDialog();
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/action/unfreeze'),
                    expect.any(Object)
                )
            );
            expect(mockForceFlush).toHaveBeenCalled();
            expect(mockSetObjectStatuses).toHaveBeenCalled();
        });

        test('freeze updates frozen status optimistically', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Freeze');
            await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
            const dialog = screen.getByRole('dialog');
            const checkbox = /** @type {HTMLInputElement} */ (within(dialog).getByRole('checkbox'));
            fireEvent.click(checkbox);
            fireEvent.click(within(dialog).getByRole('button', {name: /confirm/i}));
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/action/freeze'),
                    expect.any(Object)
                )
            );
            expect(mockForceFlush).toHaveBeenCalled();
            expect(mockSetObjectStatuses).toHaveBeenCalled();
            const callArg = mockSetObjectStatuses.mock.calls[0][0];
            expect(callArg['test-ns/svc/test1'].frozen).toBe('frozen');
        });

        test('an object already frozen is not frozen again, said so in the actions tray', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            selectRow('test-ns/svc/test2');
            openActionsMenu();
            await clickMenuItem('Freeze');
            await confirmDialog();
            expect(global.fetch).toHaveBeenCalledTimes(1);
            await waitFor(() => expect(tray()).toContainEqual(['freeze', 'test-ns/svc/test2', 'refused', 'already frozen']));
            expect(mockSetObjectStatuses).toHaveBeenCalled();
        });


        test('delete succeeds with confirmations', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Delete');
            await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
            fireEvent.click(screen.getByLabelText(/Confirm configuration loss/i));
            fireEvent.click(screen.getByLabelText(/Confirm clusterwide orchestration/i));
            fireEvent.click(screen.getByRole('button', {name: /Delete/i}));
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/action/delete'),
                    expect.any(Object)
                )
            );
            expect(mockRemoveObject).toHaveBeenCalledWith('test-ns/svc/test1');
            expect(mockForceFlush).toHaveBeenCalled();
        });

        test('an action refused is said in the actions tray, with its status', async () => {
            setup();
            global.fetch = vi.fn(() => Promise.resolve({ok: false, status: 500}));
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Restart');
            await confirmDialog();
            await waitFor(() => expect(tray()).toEqual([['restart', 'test-ns/svc/test1', 'refused', expect.stringMatching(/^HTTP 500/)]]));
        });

        test('of several objects, the one refused is said in the actions tray, the other followed', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            selectRow('test-ns/svc/test2');
            global.fetch = vi.fn()
                .mockResolvedValueOnce({ok: true, clone: () => ({json: async () => ({orchestration_id: 'o1', node: 'node1'})})})
                .mockResolvedValueOnce({ok: false, status: 500})
                .mockImplementation(() => new Promise(() => undefined));
            openActionsMenu();
            await clickMenuItem('Restart');
            await confirmDialog();
            await waitFor(() => expect(tray()).toHaveLength(2));
            expect(tray()).toEqual(expect.arrayContaining([
                ['restart', 'test-ns/svc/test1', 'running', null],
                ['restart', 'test-ns/svc/test2', 'refused', expect.stringMatching(/^HTTP 500/)],
            ]));
        });

        test('network error', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
            openActionsMenu();
            await clickMenuItem('Restart');
            await confirmDialog();
            await waitFor(() => expect(tray()).toEqual([['restart', 'test-ns/svc/test1', 'refused', 'Network error']]));
        });

        test('token missing prevents action', async () => {
            Storage.prototype.getItem = vi.fn().mockReturnValue(null);
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Restart');
            await confirmDialog();
            await waitFor(() =>
                expect(screen.getByRole('alert')).toHaveTextContent('Authentication token not found')
            );
        });

        test('the objects acted on are the ones the list holds, whatever getState says', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            selectRow('test-ns/svc/test2');
            const partialState = {
                ...defaultState,
                objectStatus: {'test-ns/svc/test1': defaultState.objectStatus['test-ns/svc/test1']},
            };
            useEventStore.getState.mockReturnValue(partialState);
            openActionsMenu();
            await clickMenuItem('Restart');
            await confirmDialog();
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
            // Answered with nothing to follow: done.
            await waitFor(() => expect(tray()).toEqual(expect.arrayContaining([
                ['restart', 'test-ns/svc/test1', 'succeeded', null],
                ['restart', 'test-ns/svc/test2', 'succeeded', null],
            ])));
        });

        test('an object gone after its selection leaves it: the action acts on the others only', async () => {
            const {rerender} = setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            selectRow('test-ns/svc/test2');

            const stateWithoutTest2 = {
                ...defaultState,
                objectStatus: {
                    'test-ns/svc/test1': defaultState.objectStatus['test-ns/svc/test1'],
                },
            };
            useEventStore.mockImplementation((sel) => sel(stateWithoutTest2));
            useEventStore.getState.mockReturnValue(stateWithoutTest2);
            rerender(
                <MemoryRouter>
                    <Objects/>
                </MemoryRouter>
            );

            await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument());
            openActionsMenu();
            await clickMenuItem('Restart');
            await confirmDialog();
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            expect(global.fetch.mock.calls[0][0]).toContain('test1');
            expect(tray().some(([, path]) => path === 'test-ns/svc/test2')).toBe(false);
        });


        test('stop action succeeds', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Stop');
            await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
            const dialog = screen.getByRole('dialog');
            const checkbox = /** @type {HTMLInputElement} */ (within(dialog).getByRole('checkbox'));
            fireEvent.click(checkbox);
            fireEvent.click(within(dialog).getByRole('button', {name: /confirm stop/i}));
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/action/stop'),
                    expect.any(Object)
                )
            );
        });
    });

    // ─── svc-only enable / disable ───────────────────────────────────────
    describe('svc enable/disable actions', () => {
        test('Enable and Disable appear in the bulk menu when svc objects are selected', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            const menu = await screen.findByRole('menu');
            expect(within(menu).getByRole('menuitem', {name: /^Enable$/})).toBeEnabled();
            expect(within(menu).getByRole('menuitem', {name: /^Disable$/})).toBeEnabled();
        });


        test('Enable URL uses the object-path endpoint (no /action prefix)', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Enable');
            await confirmDialog(/Confirm/i);
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(/test-ns\/svc\/test1\/enable$/),
                    expect.any(Object)
                )
            );
            // Done by the time the daemon answers (204): succeeded at once in the actions tray.
            await waitFor(() => expect(tray()).toEqual([['enable', 'test-ns/svc/test1', 'succeeded', null]]));
        });

        test('Disable URL uses the object-path endpoint (no /action prefix)', async () => {
            setup();
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            openActionsMenu();
            await clickMenuItem('Disable');
            await confirmDialog(/Confirm/i);
            await waitFor(() =>
                expect(global.fetch).toHaveBeenCalledWith(
                    expect.stringMatching(/test-ns\/svc\/test1\/disable$/),
                    expect.any(Object)
                )
            );
        });


        test('Enable/Disable not offered when a mixed-kind selection is made', async () => {
            setup({
                objectStatus: {
                    ...defaultState.objectStatus,
                    'test-ns/vol/v1': {avail: 'up', frozen: 'unfrozen', provisioned: 'true'},
                },
                objectInstanceStatus: {
                    ...defaultState.objectInstanceStatus,
                    'test-ns/vol/v1': {node1: {avail: 'up'}},
                },
            }, '?list=any');
            await waitForLoad();
            selectRow('test-ns/svc/test1');
            selectRow('test-ns/vol/v1');
            openActionsMenu();
            const menu = await screen.findByRole('menu');
            expect(within(menu).queryByRole('menuitem', {name: /^Enable$/})).not.toBeInTheDocument();
            expect(within(menu).queryByRole('menuitem', {name: /^Disable$/})).not.toBeInTheDocument();
        });
    });

    describe('per-node stopped and RPO-breached indicators', () => {
        const wideScreen = {isWideScreen: true, isMobile: false};

        /** One object with one instance on node1; returns the node1 cell. */
        const setupNode = async (nodeStatus) => {
            setup(
                {
                    objectStatus: {
                        'test-ns/svc/test1': {avail: 'up', frozen: 'unfrozen', provisioned: 'true'},
                    },
                    objectInstanceStatus: {
                        'test-ns/svc/test1': {node1: nodeStatus},
                    },
                },
                '',
                wideScreen,
            );
            await waitForLoad();
            return nodeCell(objectRow('test-ns/svc/test1'), 0);
        };

        const stoppedMark = (cell) => within(cell).queryByRole('img', {name: 'Stopped'});
        const rpoMark = (cell) => within(cell).queryByRole('img', {name: 'RPO breached'});
        const frozenMark = (cell) => within(cell).queryByTitle('frozen');
        const availState = (cell) => cell.querySelector('[data-state]')?.getAttribute('data-state');

        test('shows the stopped indicator when stopped_at is set', async () => {
            const cell = await setupNode({
                avail: 'down',
                frozen_at: '0001-01-01T00:00:00Z',
                stopped_at: '2025-05-16T10:00:00Z',
            });
            const mark = stoppedMark(cell);
            expect(mark).toBeInTheDocument();
            expect(mark).toHaveAttribute('title', `stopped at ${new Date('2025-05-16T10:00:00Z').toLocaleString(i18n.language)}`);
            expect(mark.querySelector('svg')).not.toBeNull();
        });

        test('does not show the stopped indicator when stopped_at is the zero sentinel', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '0001-01-01T00:00:00Z',
                stopped_at: '0001-01-01T00:00:00Z',
            });
            expect(stoppedMark(cell)).not.toBeInTheDocument();
        });

        test('does not show the stopped indicator when stopped_at is missing', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '0001-01-01T00:00:00Z',
            });
            expect(stoppedMark(cell)).not.toBeInTheDocument();
        });

        test('keeps the availability mark visible alongside the stopped indicator', async () => {
            const cell = await setupNode({
                avail: 'down',
                frozen_at: '0001-01-01T00:00:00Z',
                stopped_at: '2025-05-16T10:00:00Z',
            });
            // The availability mark (down) must still be rendered
            expect(availState(cell)).toBe('down');
            expect(within(cell).getByTitle('down')).toBeInTheDocument();
            // And the stopped indicator beside it
            expect(stoppedMark(cell)).toBeInTheDocument();
        });

        test('shows the RPO-breached indicator when rpo_breached_at is set', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '0001-01-01T00:00:00Z',
                rpo_breached_at: '2025-05-16T10:00:00Z',
            });
            const mark = rpoMark(cell);
            expect(mark).toBeInTheDocument();
            expect(mark).toHaveAttribute('title', 'RPO breached');
            expect(mark).toHaveClass('text-state-warn');
        });

        test('does not show the RPO-breached indicator when rpo_breached_at is the zero sentinel', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '0001-01-01T00:00:00Z',
                rpo_breached_at: '0001-01-01T00:00:00Z',
            });
            expect(rpoMark(cell)).not.toBeInTheDocument();
        });

        test('does not show the RPO-breached indicator when rpo_breached_at is missing', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '0001-01-01T00:00:00Z',
            });
            expect(rpoMark(cell)).not.toBeInTheDocument();
        });

        test('RPO-breached takes precedence over frozen when both are set', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '2025-05-16T10:00:00Z',
                rpo_breached_at: '2025-05-16T10:00:00Z',
            });
            expect(rpoMark(cell)).toBeInTheDocument();
            expect(frozenMark(cell)).not.toBeInTheDocument();
        });

        test('frozen is shown when only frozen_at is set', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '2025-05-16T10:00:00Z',
                rpo_breached_at: '0001-01-01T00:00:00Z',
            });
            expect(frozenMark(cell)).toBeInTheDocument();
            expect(rpoMark(cell)).not.toBeInTheDocument();
        });

        test('availability, stopped and RPO-breached indicators are visible simultaneously', async () => {
            const cell = await setupNode({
                avail: 'down',
                frozen_at: '0001-01-01T00:00:00Z',
                stopped_at: '2025-05-16T10:00:00Z',
                rpo_breached_at: '2025-05-16T10:00:00Z',
            });
            expect(availState(cell)).toBe('down');
            expect(stoppedMark(cell)).toBeInTheDocument();
            expect(rpoMark(cell)).toBeInTheDocument();
        });

        test('stopped and RPO-breached indicators are shown together', async () => {
            const cell = await setupNode({
                avail: 'down',
                frozen_at: '0001-01-01T00:00:00Z',
                stopped_at: '2025-05-16T10:00:00Z',
                rpo_breached_at: '2025-05-16T10:00:00Z',
            });
            expect(stoppedMark(cell)).toBeInTheDocument();
            expect(rpoMark(cell)).toBeInTheDocument();
        });

        test('no indicators are shown for a healthy node', async () => {
            const cell = await setupNode({
                avail: 'up',
                frozen_at: '0001-01-01T00:00:00Z',
                stopped_at: '0001-01-01T00:00:00Z',
                rpo_breached_at: '0001-01-01T00:00:00Z',
            });
            expect(availState(cell)).toBe('up');
            expect(within(cell).getByTitle('up')).toBeInTheDocument();
            expect(stoppedMark(cell)).not.toBeInTheDocument();
            expect(rpoMark(cell)).not.toBeInTheDocument();
            expect(frozenMark(cell)).not.toBeInTheDocument();
        });
    });

    test('row click opens the object panel over the list, the row marked', async () => {
        setup();
        await waitForLoad();
        const row = screen.getByRole('row', {name: /test-ns\/svc\/test1/});
        fireEvent.click(row);
        expect(await screen.findByTestId('object-panel')).toHaveTextContent('test-ns/svc/test1');
        expect(screen.getByRole('row', {name: /test-ns\/svc\/test1/})).toHaveAttribute('aria-current', 'true');
        expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/objects/'));
    });

    test('no panel if no instance status', async () => {
        setup({objectInstanceStatus: {}});
        await waitForLoad();
        fireEvent.click(screen.getByRole('row', {name: /test-ns\/svc\/test1/}));
        expect(screen.queryByTestId('object-panel')).not.toBeInTheDocument();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('checkbox click does not trigger row navigation', async () => {
        setup();
        await waitForLoad();
        selectRow('test-ns/svc/test1');
        expect(mockNavigate).not.toHaveBeenCalled();
    });






    test('no actions while none is selected: a hint says how to get them', async () => {
        setup();
        await waitForLoad();
        expect(screen.queryByRole('button', {name: 'Actions'})).not.toBeInTheDocument();
        expect(screen.getByText('Select objects to act on them')).toBeInTheDocument();
    });

    test('the filters with a choice to make are visible', async () => {
        setup(TWO_KINDS, '?list=any');
        await waitForLoad();
        expect(filterGroup('Namespace')).toBeInTheDocument();
        expect(filterGroup('Global State')).toBeInTheDocument();
        expect(filterGroup('Kind')).toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toBeInTheDocument();
    });

    test('not mobile: no filter toggle, filters shown', async () => {
        setup({}, '', {isWideScreen: false, isMobile: false});
        await waitForLoad();
        expect(screen.queryByRole('button', {name: /show filters|hide filters/i})).not.toBeInTheDocument();
        expect(filterGroup('Namespace')).toBeInTheDocument();
    });

    test('mobile: filters hidden initially and toggle button works', async () => {
        setup({}, '', {isWideScreen: false, isMobile: true});
        await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
        expect(queryFilterGroup('Namespace')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
        const toggleButton = screen.getByRole('button', {name: /show filters/i});
        expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggleButton);
        await waitFor(() => expect(filterGroup('Namespace')).toBeInTheDocument());
        const hideButton = screen.getByRole('button', {name: /hide filters/i});
        expect(hideButton).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(hideButton);
        await waitFor(() => expect(queryFilterGroup('Namespace')).not.toBeInTheDocument());
    });

    test('mobile on a wide screen: filters shown at first', async () => {
        setup({}, '', {isWideScreen: true, isMobile: true});
        await waitForLoad();
        expect(screen.getByRole('button', {name: /hide filters/i})).toBeInTheDocument();
    });

    describe('order', () => {
        test('always in the order of the paths, namespace by namespace: the headers sort nothing', async () => {
            setup({}, '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            expect(objectNamesInOrder()).toEqual([
                'root/svc/test3',
                'test-ns/svc/test1', 'test-ns/svc/test2', 'test-ns/svc/test4',
                'test-ns/svc/unprovisioned', 'test-ns/svc/unprovisioned-bool',
            ]);
            for (const header of within(screen.getByRole('table', {name: 'Objects'})).getAllByRole('columnheader')) {
                expect(within(header).queryByRole('button')).not.toBeInTheDocument();
                expect(header).not.toHaveAttribute('aria-sort');
            }
        });

        test('the line of a namespace stands for its configuration: no line of its own, the line of the namespace opens it', async () => {
            setup({objectStatus: {
                'prod/svc/web': {avail: 'up'}, 'prod/': {avail: 'n/a'}, 'dev/svc/x': {avail: 'up'},
            }, objectInstanceStatus: {}}, '?list=any', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            expect(objectNamesInOrder()).toEqual(['dev/svc/x', 'prod/svc/web']);
            const prod = namespaceRows().find((row) => row.dataset.namespaceRow === 'prod');
            expect(prod).toHaveAttribute('title', 'Open the configuration of prod');
            fireEvent.click(prod);
            await waitFor(() => expect(screen.getByTestId('router-search')).toHaveTextContent('peek=namespace:prod&peektab=config'));
            // dev has none: its line opens nothing, nothing offered without the grant.
            const dev = namespaceRows().find((row) => row.dataset.namespaceRow === 'dev');
            expect(dev).not.toHaveAttribute('title');
            // Its checkbox selects, it does not open.
            fireEvent.click(within(dev).getByRole('checkbox', {name: /dev/}));
            expect(screen.getByTestId('router-search')).not.toHaveTextContent('peek=namespace:dev');
            // None and no grant: nothing to configure; an object still created in it.
            expect(within(dev).queryByRole('button', {name: 'Configure the namespace dev'})).toBeNull();
            expect(within(dev).getByRole('button', {name: 'Create an object in dev'})).toBeInTheDocument();
            // prod has one: configured from its line too.
            fireEvent.click(within(prod).getByRole('button', {name: 'Configure the namespace prod'}));
            expect(screen.getByTestId('router-search')).toHaveTextContent('peek=namespace:prod&peektab=config');
        });

        test('a configuration alone in its namespace: the line of the namespace kept, alone', async () => {
            setup({objectStatus: {'prod/svc/web': {avail: 'up'}, 'empty/': {avail: 'n/a'}}, objectInstanceStatus: {}},
                '?list=any', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            expect(namespaceRows().map((row) => row.dataset.namespaceRow)).toEqual(['empty', 'prod']);
            expect(objectNamesInOrder()).toEqual(['prod/svc/web']);
        });

        test('a namespace without its configuration: those who may write it offered to configure it, created by its first change', async () => {
            mockGrants.value = {squatter: null};
            try {
                setup({objectStatus: {'dev/svc/x': {avail: 'up'}}, objectInstanceStatus: {}}, '?list=any', {isWideScreen: true, isMobile: false});
                await waitForLoad();
                const dev = namespaceRows().find((row) => row.dataset.namespaceRow === 'dev');
                const configure = within(dev).getByRole('button', {name: 'Configure the namespace dev'});
                expect(configure).toHaveTextContent('Configure');
                // Outlined, as high as fits the line.
                expect(configure).toHaveClass('border', 'h-6');
                expect(within(dev).getByRole('button', {name: 'Create an object in dev'})).toHaveClass('bg-accent', 'h-6');
                global.fetch.mockClear();
                fireEvent.click(configure);
                // Its configuration tab: nothing written until a change is.
                await waitFor(() => expect(screen.getByTestId('router-search')).toHaveTextContent('peek=namespace:dev&peektab=config'));
                expect(global.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toEqual([]);
            } finally {
                mockGrants.value = {};
            }
        });

        test('create from the line of a namespace: the wizard in that namespace', async () => {
            setup({objectStatus: {'dev/svc/x': {avail: 'up'}, 'prod/svc/web': {avail: 'up'}}, objectInstanceStatus: {}}, '?list=any', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            const dev = namespaceRows().find((row) => row.dataset.namespaceRow === 'dev');
            fireEvent.click(within(dev).getByRole('button', {name: 'Create an object in dev'}));
            const dialog = screen.getByRole('dialog', {name: 'New object'});
            expect(within(dialog).getByLabelText('Namespace')).toHaveValue('dev');
            // The line is not opened by it.
            expect(screen.getByTestId('router-search')).not.toHaveTextContent('peek=namespace:dev');
            fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
            // The top button: no namespace filtered on, root again.
            fireEvent.click(screen.getByRole('button', {name: 'New object'}));
            expect(within(screen.getByRole('dialog', {name: 'New object'})).getByLabelText('Namespace')).toHaveValue('root');
        });

        test('narrow, the buttons of the line of a namespace their icons alone', async () => {
            setup({objectStatus: {'prod/svc/web': {avail: 'up'}, 'prod/': {avail: 'n/a'}}, objectInstanceStatus: {}}, '', {isWideScreen: false, isMobile: true});
            await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
            const create = within(namespaceRows()[0]).getByRole('button', {name: 'Create an object in prod'});
            expect(create.querySelector('svg')).not.toBeNull();
            expect(create).toHaveTextContent(/^Create an object in prod$/);
            // It creates: the accent fill; Configure outlined.
            expect(create).toHaveClass('bg-accent', 'h-6', 'w-6');
            expect(within(namespaceRows()[0]).getByRole('button', {name: 'Configure the namespace prod'})).toBeInTheDocument();
        });

        test('narrow, a small badge over the name of the namespace, its line as high as the others', async () => {
            setup({objectStatus: {'prod/svc/web': {avail: 'up'}}, objectInstanceStatus: {}}, '', {isWideScreen: false, isMobile: true});
            await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
            expect(namespaceRows()[0].querySelector('th')).toHaveTextContent(/^namespaceprod/);
        });

        test('the short paths of the root namespace kept together under it', async () => {
            setup({objectStatus: {
                'b-ns/svc/x': {avail: 'up'}, 'cluster': {avail: 'n/a'}, 'svc/dns': {avail: 'up'}, 'a-ns/vol/v': {avail: 'up'},
            }, objectInstanceStatus: {}}, '?list=any', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            expect(namespaceRows().map((row) => row.dataset.namespaceRow)).toEqual(['a-ns', 'b-ns', 'root']);
            expect(objectNamesInOrder()).toEqual(['a-ns/vol/v', 'b-ns/svc/x', 'cluster', 'svc/dns']);
        });

        test('a line opens each namespace, its name across the row; it opens nothing', async () => {
            setup({objectStatus: {
                'prod/svc/web': {avail: 'up'}, 'prod/svc/api': {avail: 'up'}, 'dev/svc/x': {avail: 'up'},
            }, objectInstanceStatus: {}}, '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            const rows = within(screen.getByRole('table', {name: 'Objects'})).getAllByRole('row').slice(1);
            expect(rows.map((row) => row.getAttribute('data-namespace-row') ?? 'object')).toEqual(['dev', 'object', 'prod', 'object', 'object']);
            const line = namespaceRows()[1];
            // Across the row but the checkbox and the last cell, its buttons'.
            expect(within(line).getByRole('rowheader', {name: 'prod'})).toHaveAttribute('colspan', String(rowCells(objectRows()[0]).length - 2));
            fireEvent.click(within(line).getByRole('rowheader'));
            expect(mockNavigate).not.toHaveBeenCalled();
        });

        test('the checkbox of a namespace line selects all its objects the filters keep; mixed when some only are', async () => {
            setup({objectStatus: {
                'prod/svc/web': {avail: 'up'}, 'prod/svc/api': {avail: 'down'}, 'dev/svc/x': {avail: 'up'},
            }, objectInstanceStatus: {}});
            await waitForLoad();
            const prod = screen.getByRole('checkbox', {name: 'Select the objects of prod'});
            fireEvent.click(prod);
            expect(screen.getByText('2 selected')).toBeInTheDocument();
            expect(within(objectRow('prod/svc/web')).getByRole('checkbox')).toBeChecked();
            expect(within(objectRow('dev/svc/x')).getByRole('checkbox')).not.toBeChecked();
            expect(prod).toBeChecked();
            // One of them unselected: mixed.
            fireEvent.click(within(objectRow('prod/svc/api')).getByRole('checkbox'));
            expect(prod).not.toBeChecked();
            expect(prod.indeterminate).toBe(true);
            // Checked again: all of them; unchecked: none, the others kept.
            fireEvent.click(prod);
            expect(screen.getByText('2 selected')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('checkbox', {name: 'Select the objects of dev'}));
            fireEvent.click(prod);
            expect(screen.getByText('1 selected')).toBeInTheDocument();
            expect(within(objectRow('dev/svc/x')).getByRole('checkbox')).toBeChecked();
        });
    });

    describe('pages', () => {
        const dataRows = objectRows;

        test('pages the objects, 50 a page, as oc3 does: the next page, another size', async () => {
            setup(makeMany(60), '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            expect(dataRows()).toHaveLength(50);
            expect(screen.getByText('1–50 of 60')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', {name: 'Next'}));
            expect(dataRows()).toHaveLength(10);
            expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();

            fireEvent.change(screen.getByLabelText('Per page'), {target: {value: '25'}});
            expect(dataRows()).toHaveLength(25);
            expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
        });

        test('a page starting inside a namespace opens with its line; its checkbox selects the objects of every page', async () => {
            setup(makeMany(60), '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            expect(namespaceRows().map((row) => row.dataset.namespaceRow)).toEqual(['test-ns']);
            fireEvent.click(screen.getByRole('button', {name: 'Next'}));
            expect(namespaceRows().map((row) => row.dataset.namespaceRow)).toEqual(['test-ns']);
            fireEvent.click(screen.getByRole('checkbox', {name: 'Select the objects of test-ns'}));
            expect(screen.getByText('60 selected')).toBeInTheDocument();
        });

        test('select all selects the rows of the page shown, unticked it leaves the other pages selected', async () => {
            setup(makeMany(60), '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            const selectAll = () => screen.getByRole('checkbox', {name: 'Select all objects'});
            fireEvent.click(selectAll());
            expect(screen.getByText('50 selected')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', {name: 'Next'}));
            expect(selectAll()).not.toBeChecked();
            fireEvent.click(selectAll());
            expect(screen.getByText('60 selected')).toBeInTheDocument();
            fireEvent.click(selectAll());
            expect(screen.getByText('50 selected')).toBeInTheDocument();
        });

        test('a filter changed starts the list over from its first page', async () => {
            vi.useFakeTimers();
            try {
                setup(makeMany(60), '?offset=50&limit=25');
                fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'obj1'}});
                act(() => {
                    vi.advanceTimersByTime(350);
                });
                expect(mockNavigate).toHaveBeenCalledWith('/objects?limit=25&name=obj1', {replace: true});
            } finally {
                vi.useRealTimers();
            }
        });
    });

    test('URL sync debounced', async () => {
        vi.useFakeTimers();
        setup();
        await waitForLoad();
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'sync'}});
        vi.advanceTimersByTime(300);
        expect(mockNavigate).toHaveBeenCalledWith('/objects?name=sync', {replace: true});
        vi.useRealTimers();
    });

    test('URL sync is skipped when filters already match current URL params', async () => {
        vi.useFakeTimers();
        setup({}, '?name=test1');
        await waitForLoad();
        vi.advanceTimersByTime(300);
        expect(mockNavigate).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    test('URL filters update state on location change', async () => {
        const {rerender} = setup(TWO_KINDS, '?list=any');
        await waitForLoad();
        vi.mocked(useLocation).mockReturnValue({
            search: '?list=any&namespace=test-ns&kind=svc&name=test1',
            pathname: '/objects',
        });
        rerender(
            <MemoryRouter>
                <Objects/>
            </MemoryRouter>
        );
        await waitFor(() => {
            expect(filterOption('Namespace', 'test-ns')).toBeChecked();
            expect(filterOption('Kind', 'svc')).toBeChecked();
            expect(screen.getByLabelText('Name')).toHaveValue('test1');
        });
        expect(filterOption('Namespace', 'root')).not.toBeChecked();
        expect(filterSummary('Namespace')).toHaveTextContent('Namespacetest-ns');
        expect(filterSummary('Kind')).toHaveTextContent('Kindsvc');
    });

    test('URL globalState param hydrates selected global states on mount', async () => {
        setup({}, '?globalState=up,down');
        await waitForLoad();
        await waitFor(() => {
            expect(screen.getByRole('row', {name: /test-ns\/svc\/test1/})).toBeInTheDocument();
            expect(screen.getByRole('row', {name: /test-ns\/svc\/test2/})).toBeInTheDocument();
            expect(screen.queryByRole('row', {name: /root\/svc\/test3/})).not.toBeInTheDocument();
        });
        expect(filterOption('Global State', 'Up')).toBeChecked();
        expect(filterOption('Global State', 'Down')).toBeChecked();
        expect(filterOption('Global State', 'Warn')).not.toBeChecked();
    });

    test('unknown globalState URL value is offered as an option without a status mark, and can be removed', async () => {
        setup({}, '?globalState=bogus');
        await waitForLoad();
        const bogus = filterOption('Global State', 'Bogus');
        expect(bogus).toBeChecked();
        expect(bogus.closest('label').querySelector('[data-state], svg')).toBeNull();
        expect(filterSummary('Global State')).toHaveTextContent('Global StateBogus');
        await waitFor(() => expect(screen.getByText(/No objects found/)).toBeInTheDocument());
        fireEvent.click(bogus);
        await waitFor(() => expect(screen.getByRole('row', {name: /test-ns\/svc\/test1/})).toBeInTheDocument());
    });

    test('URL namespace absent from the data stays offered and checked', async () => {
        setup({}, '?namespace=ghost');
        await waitForLoad();
        expect(filterOption('Namespace', 'ghost')).toBeChecked();
        await waitFor(() => expect(screen.getByText(/No objects found/)).toBeInTheDocument());
    });

    test('URL sync writes every filter, comma-joined', async () => {
        vi.useFakeTimers();
        try {
            setup(TWO_KINDS, '?list=any');
            fireEvent.click(filterOption('Global State', 'Up'));
            fireEvent.click(filterOption('Global State', 'Unprovisioned'));
            fireEvent.click(filterOption('Namespace', 'test-ns'));
            fireEvent.click(filterOption('Kind', 'svc'));
            fireEvent.change(screen.getByLabelText('Name'), {target: {value: ' te '}});
            act(() => {
                vi.advanceTimersByTime(300);
            });
            expect(mockNavigate).toHaveBeenCalledWith(
                '/objects?list=any&globalState=up%2Cunprovisioned&namespace=test-ns&kind=svc&name=te',
                {replace: true}
            );
        } finally {
            vi.useRealTimers();
        }
    });

    test('feedback closes with its Close button', async () => {
        setup();
        await waitForLoad();
        selectRow('test-ns/svc/test1');
        Storage.prototype.getItem = vi.fn().mockReturnValue(null);
        openActionsMenu();
        await clickMenuItem('Restart');
        await confirmDialog();
        await waitFor(() => expect(getFeedback()).toHaveTextContent(/token not found/i));
        fireEvent.click(screen.getByRole('button', {name: 'Close'}));
        await waitFor(() => expect(screen.queryByText(/token not found/i)).not.toBeInTheDocument());
    });

    test('feedback hides itself after 4 seconds', async () => {
        setup();
        await waitForLoad();
        vi.useFakeTimers();
        try {
            selectRow('test-ns/svc/test1');
            Storage.prototype.getItem = vi.fn().mockReturnValue(null);
            openActionsMenu();
            await clickMenuItem('Restart');
            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: /Confirm/i}));
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(getFeedback()).toHaveTextContent(/token not found/i);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(3900);
            });
            expect(screen.getByText(/token not found/i)).toBeInTheDocument();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(200);
            });
            expect(screen.queryByText(/token not found/i)).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    test('cancel action dialog', async () => {
        setup();
        await waitForLoad();
        selectRow('test-ns/svc/test1');
        openActionsMenu();
        await clickMenuItem('Restart');
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', {name: /cancel/i}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('narrow screen hides node columns', async () => {
        setup({}, '', {isWideScreen: false, isMobile: false});
        await waitForLoad();
        expect(screen.queryByRole('columnheader', {name: /node1/})).not.toBeInTheDocument();
    });

    test('daemon fallback when store empty', async () => {
        setup(
            {objectStatus: {}, objectInstanceStatus: {}},
            '',
            {isWideScreen: true, isMobile: false},
            {daemon: {cluster: {object: {'daemon/svc/obj1': {avail: 'up', frozen: 'unfrozen'}}}}}
        );
        await waitFor(() =>
            expect(screen.getByRole('row', {name: /daemon\/svc\/obj1/})).toBeInTheDocument()
        );
    });


    test('daemon fallback with no objects at all renders empty state', async () => {
        setup(
            {objectStatus: {}, objectInstanceStatus: {}},
            '',
            {isWideScreen: true, isMobile: false},
            {daemon: {cluster: {object: {}}}}
        );
        await waitForLoad();
        await waitFor(() => expect(screen.getByText(/No objects found/)).toBeInTheDocument());
    });

    test('unprovisioned object icon is shown', async () => {
        setup({}, '', {isWideScreen: true, isMobile: false});
        await waitForLoad();
        ['test-ns/svc/unprovisioned(?!-bool)', 'test-ns/svc/unprovisioned-bool'].forEach((name) => {
            const mark = within(statusCell(objectRow(name))).getByRole('img', {name: 'Not provisioned'});
            expect(mark).toHaveAttribute('title', 'Not provisioned');
            expect(mark).toHaveClass('text-state-down');
            // The P of the unprovisioned resources of the status board, not a triangle.
            expect(mark).toHaveTextContent(/^P$/);
            expect(mark.querySelector('svg')).toBeNull();
        });
        expect(within(statusCell(objectRow('test-ns/svc/test1'))).queryByRole('img', {name: 'Not provisioned'}))
            .not.toBeInTheDocument();
    });

    test('the cluster object is frozen as the cluster, on all the nodes', async () => {
        // The cluster object is listed with the configurations.
        setup({
            objectStatus: {cluster: {avail: 'up', frozen: 'unfrozen'}},
            objectInstanceStatus: {cluster: {node1: {avail: 'up'}}},
        }, '?list=configs', {isWideScreen: true, isMobile: false});
        await waitForLoad();
        selectRow('cluster');
        openActionsMenu();
        await clickMenuItem('Freeze');
        await confirmDialog();
        await waitFor(() =>
            expect(global.fetch).toHaveBeenCalledWith('/api/cluster/action/freeze', expect.any(Object))
        );
    });

    test.each([
        ['svc/myobj', {
            objectStatus: {'svc/myobj': {avail: 'up', frozen: 'unfrozen'}},
            objectInstanceStatus: {'svc/myobj': {node1: {avail: 'up'}}},
        }, '/root/svc/myobj/action/restart'],
        ['standalone', {
            objectStatus: {standalone: {avail: 'up', frozen: 'unfrozen'}},
            objectInstanceStatus: {standalone: {node1: {avail: 'up'}}},
        }, '/root/svc/standalone/action/restart'],
    ])('object name "%s" resolves to the expected action URL', async (rowName, customState, expectedUrl) => {
        setup(customState, '', {isWideScreen: true, isMobile: false});
        await waitForLoad();
        selectRow(rowName);
        openActionsMenu();
        await clickMenuItem('Restart');
        await confirmDialog();
        await waitFor(() =>
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining(expectedUrl),
                expect.any(Object)
            )
        );
    });

    test('filters out non-object entries from allObjectNames', async () => {
        const stateWithNonObject = {
            ...defaultState,
            objectStatus: {
                ...defaultState.objectStatus,
                __proto__: null,
                validObj: {avail: 'up', frozen: 'unfrozen'},
            },
        };
        setup(stateWithNonObject, '', {isWideScreen: true, isMobile: false});
        await waitForLoad();
        expect(screen.queryByRole('row', {name: /someFunction/})).not.toBeInTheDocument();
        expect(screen.getByRole('row', {name: /validObj/})).toBeInTheDocument();
    });

    test('no floating events button: the events are a tab of the object panel', async () => {
        setup();
        await waitForLoad();
        expect(screen.queryByText('Object Events')).not.toBeInTheDocument();
    });

    describe('filter option toggle handlers (add branch coverage)', () => {
        test.each([
            ['Global State', 'Up'],
            ['Namespace', 'test-ns'],
            ['Kind', 'svc'],
        ])('rapidly toggling a %s option twice re-adds it', async (label, option) => {
            setup(TWO_KINDS, label === 'Kind' ? '?list=any' : '', {isWideScreen: true, isMobile: false});
            await waitForLoad();
            await selectFilter(label, option);
            const checkbox = filterOption(label, option);
            expect(checkbox).toBeChecked();
            act(() => {
                fireEvent.click(checkbox);
                fireEvent.click(checkbox);
            });
            await waitFor(() => expect(filterOption(label, option)).toBeChecked());
            expect(filterSummary(label)).toHaveTextContent(new RegExp(`${option}$`));
        });
    });

    test('accessibility', async () => {
        const {container} = setup();
        await waitForLoad();
        const results = await axe(container, {
            rules: {'aria-prohibited-attr': {enabled: false}, label: {enabled: false}},
        });
        expect(results.violations).toHaveLength(0);
    });
});
