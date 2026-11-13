import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import {PeekPanel} from '../PeekPanel';
import useEventStore from '../../hooks/useEventStore.js';
import useEventLogStore from '../../hooks/useEventLogStore';
import {reloadRecordHistory} from '../../app/record-history';
import node from './fixtures/node-dev3n1.json';
import daemon from './fixtures/daemon-dev3n1.json';
import {useActionTracker} from '../../app/action-tracker';
import {propertyGroups} from '../NodePanel';
import {parseLabel} from '../NodeLabels';

/** What the actions tray holds, the latest first: label, subject, state, reason. */
const trayEntries = () => useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state, e.error ?? null]);

const {mockRetain, mockRelease, mockStartLogger} = vi.hoisted(() => ({mockRetain: vi.fn(), mockRelease: vi.fn(), mockStartLogger: vi.fn()}));

vi.mock('../../eventSourceManager', () => ({
    retainEventReception: (...args) => {
        mockRetain(...args);
        return mockRelease;
    },
    startLoggerReception: (...args) => mockStartLogger(...args),
    closeLoggerEventSource: () => {},
}));
// The logs stream is tested on its own: here, which node and which kind it reads.
vi.mock('../LogsViewer', () => ({
    default: ({nodename, nodenames, type, filters = []}) => (
        <div data-testid="logs">{`${type} logs of ${nodenames?.join('+') ?? nodename}${filters.length ? ` where ${filters.join(', ')}` : ''}`}</div>
    ),
}));
// The confirmation dialogs are tested on their own: here, the action confirmed.
// The grants of the user: root sets the thresholds of the health.
const mockGrants = vi.hoisted(() => ({value: {}}));
vi.mock('../../hooks/useGrants', () => ({
    useGrants: () => mockGrants.value,
    useIsRoot: () => Object.prototype.hasOwnProperty.call(mockGrants.value, 'root'),
}));

vi.mock('../NodeActionDialog', () => ({
    NodeActionDialog: ({pending: pendingAction, onConfirm: handleConfirm, target}) => (pendingAction === null ? null : (
        <div role="alertdialog" aria-label={`${pendingAction.action} ${target}`}>
            <button type="button" onClick={() => handleConfirm(pendingAction.action)}>Confirm</button>
        </div>
    )),
}));

const CONFIG = '[DEFAULT]\nid = 802efbd1\n\n[node]\nuuid = 5b5c-secret\nenv = TST\n';

function Location() {
    const location = useLocation();
    return <output data-testid="location">{decodeURIComponent(location.search)}</output>;
}

const renderPanel = (search = '?peek=node:dev3n1') => render(
    <MemoryRouter initialEntries={[`/objects${search}`]}>
        <PeekPanel/>
        <Location/>
    </MemoryRouter>
);

describe('NodeDetailPanel', () => {
    /** The requests made, their method, address and body. */
    let requests;
    let config;
    /** What the daemon answers, a copy a test may change. */
    let api;

    beforeEach(() => {
        useActionTracker.setState({tracked: [], revealed: 0});
        vi.clearAllMocks();
        localStorage.setItem('authToken', 'tok');
        sessionStorage.clear();
        reloadRecordHistory();
        requests = [];
        config = CONFIG;
        api = structuredClone({...node, ...daemon});
        global.fetch = vi.fn(async (url, options = {}) => {
            const method = options.method ?? 'GET';
            requests.push({method, url, body: options.body});
            const [path, query = ''] = url.replace('/api/node/name/dev3n1/', '').replace(/^\/api\//, '').split('?');
            if (path === 'config/file') {
                if (method === 'PUT') config = options.body;
                // The secrets redacted on demand, as the daemon does: node.uuid.
                const shown = query.includes('redact-secrets=true') ? config.replace(/^uuid = .*$/m, 'uuid = ********') : config;
                return new Response(method === 'PUT' ? null : shown, {status: method === 'PUT' ? 204 : 200});
            }
            if (method === 'POST' || method === 'DELETE') return new Response(null, {status: 200});
            const body = api[path];
            return body === undefined
                ? new Response(JSON.stringify({detail: 'not found'}), {status: 404})
                : new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
        });
        useEventStore.setState({
            nodeStatus: {dev3n1: {agent: 'v3.0.0-rc46', frozen_at: '0001-01-01T00:00:00Z', booted_at: '2026-10-10T14:08:50+02:00', is_leader: true}},
            nodeMonitor: {dev3n1: {
                state: 'idle', state_updated_at: '2026-10-10T12:08:50Z', global_expect: 'none', local_expect: 'none',
                orchestration_id: '0cbb5d5e-0d1c-4a7c-8f1a-3c0f1e1d2b3a', orchestration_is_done: true, preserved: false,
            }},
            nodeStats: {dev3n1: {score: 63, load_15m: 0.39, mem_avail: 42, mem_total: 5920, swap_avail: 0, swap_total: 0}},
            // No heartbeat event yet: the daemon tab reads the heartbeats of the cluster status.
            heartbeatStatus: {},
        });
    });

    afterEach(() => {
        localStorage.clear();
        mockGrants.value = {};
    });

    const panel = () => screen.getByRole('dialog', {name: 'dev3n1'});
    const openTab = (name) => fireEvent.click(within(panel()).getByRole('tab', {name}));

    test('opens on its monitor, its health, then its properties in groups, discovered then organisation, kept current by the node events', async () => {
        renderPanel();
        expect(within(panel()).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Overview', 'Inventory', 'Schedules', 'Drivers', 'Daemon', 'Configuration', 'Logs', 'Events']);
        const monitor = within(panel()).getByRole('region', {name: 'Monitor'});
        expect(monitor).toHaveTextContent('Stateidle');
        // Idle, quiet: no mark, no emphasis; running, bold; failed, red.
        expect(within(monitor).getByText('idle').className).toBe('');
        expect(monitor.querySelector('[role=img]')).toBeNull();
        act(() => useEventStore.setState({nodeMonitor: {dev3n1: {state: 'draining'}}}));
        expect(within(monitor).getByText('draining')).toHaveClass('font-semibold');
        act(() => useEventStore.setState({nodeMonitor: {dev3n1: {state: 'drain failed'}}}));
        expect(within(monitor).getByText('drain failed')).toHaveClass('text-state-down');
        act(() => useEventStore.setState({nodeMonitor: {dev3n1: {
            state: 'idle', state_updated_at: '2026-10-10T12:08:50Z', global_expect: 'none', local_expect: 'none',
            orchestration_id: '0cbb5d5e-0d1c-4a7c-8f1a-3c0f1e1d2b3a', orchestration_is_done: true, preserved: false,
        }}}));
        // Beyond its state: its expects, its orchestration, its logs a click away.
        expect(monitor).toHaveTextContent('Global expectnone');
        expect(monitor).toHaveTextContent('Orchestration0cbb5d5edone');
        expect(within(monitor).getByRole('button', {name: 'Show the logs of the orchestration 0cbb5d5e-0d1c-4a7c-8f1a-3c0f1e1d2b3a'})).toBeInTheDocument();
        // All of it as JSON, what the section leaves out too.
        fireEvent.click(within(monitor).getByRole('button', {name: 'Show the data of Monitor as JSON'}));
        const raw = screen.getByRole('dialog', {name: 'Monitor as JSON'});
        expect(raw).toHaveTextContent('"preserved": false');
        fireEvent.click(within(raw).getByRole('button', {name: 'Close'}));
        expect(monitor).toHaveTextContent('LeaderYes');
        const health = within(panel()).getByRole('region', {name: 'Health'});
        fireEvent.click(within(health).getByRole('button', {name: 'Show the data of Health as JSON'}));
        expect(screen.getByRole('dialog', {name: 'Health as JSON'})).toHaveTextContent('"load_15m": 0.39');
        fireEvent.click(within(screen.getByRole('dialog', {name: 'Health as JSON'})).getByRole('button', {name: 'Close'}));
        expect(health).toHaveTextContent('Score63');
        expect(health).toHaveTextContent('Memory available42% of 5.8 GiB');
        // No swap: a dash, as in the nodes table, and no minimum to set.
        expect(health).toHaveTextContent('Swap available-Overloaded');
        expect(health).toHaveTextContent('OverloadedNo');
        expect(mockRetain).toHaveBeenCalledWith('tok', ['NodeStatusUpdated', 'NodeMonitorUpdated', 'NodeStatsUpdated']);

        // The properties in groups, each a block of facts as the others: what the agent
        // discovered, by what it is about, then what the organisation gives the node.
        await within(panel()).findByRole('region', {name: 'OS'});
        expect(within(panel()).getAllByRole('heading', {level: 3}).map((h) => h.textContent))
            .toEqual(['Monitor', 'Health', 'Labels0', 'Node', 'OS', 'CPU', 'Memory', 'Hardware']);
        expect(within(panel()).getByRole('region', {name: 'OS'})).toHaveTextContent('Architecturex86_64');
        expect(within(panel()).getByRole('region', {name: 'CPU'})).toHaveTextContent(/Model.*Threads/);
        // Who gives the values: the node, or a person.
        expect(within(panel()).getByRole('region', {name: 'OS'})).toHaveTextContent('reported by the node');
        // A section with no value, its enclosure not probed: one line, together with the others so.
        const hardware = within(panel()).getByRole('region', {name: 'Hardware'});
        expect(hardware).toHaveTextContent(/^Hardware:not set$/);
        expect(hardware.parentElement).toHaveAttribute('data-folded', 'organisation');
        expect(within(panel()).queryByText('Enclosure')).toBeNull();
        expect(within(panel()).queryByRole('table', {name: /properties/i})).toBeNull();
    });

    test('the organisation properties edited in a buffer: applied at once, in one write of the node configuration, then the asset pushed', async () => {
        api['system/property'].items.push({data: {name: 'loc_city', source: 'config', title: 'loc, city', value: 'Paris', error: ''}});
        api.config = {items: [
            {keyword: 'node.enclosure', value: ''},
            {keyword: 'node.loc_city', value: 'Paris'},
        ]};
        mockGrants.value = {root: null};
        renderPanel();
        // A pencil on each block of the organisation, each editing them all: on a block set,
        // said set by you; on the line of one with no value.
        const location = await within(panel()).findByRole('region', {name: 'Location'});
        expect(location).toHaveTextContent('set by you');
        expect(within(location).getByRole('button', {name: 'Edit the organisation properties'})).toBeInTheDocument();
        const hardware = within(panel()).getByRole('region', {name: 'Hardware'});
        expect(hardware).toHaveTextContent('Hardware:not set');
        fireEvent.click(within(hardware).getByRole('button', {name: 'Edit the organisation properties'}));
        await waitFor(() => expect(within(panel()).queryAllByRole('button', {name: 'Edit the organisation properties'})).toEqual([]));
        // Unfolded for its fields, the first of the one whose pencil was clicked focused.
        const enclosure = await within(panel()).findByRole('textbox', {name: 'Enclosure'});
        expect(enclosure).toHaveFocus();
        const city = within(panel()).getByRole('textbox', {name: 'City'});
        // Edited, the keyword under its label.
        expect(within(panel()).getByText('node.loc_city')).toBeInTheDocument();
        expect(city).toHaveValue('Paris');
        // The discovered properties stay read only.
        expect(within(panel()).queryByRole('textbox', {name: 'Architecture'})).toBeNull();
        fireEvent.change(enclosure, {target: {value: 'rack 12'}});
        fireEvent.change(city, {target: {value: ''}});
        expect(enclosure).toHaveAttribute('data-changed');
        const bar = within(panel()).getByRole('region', {name: 'Changes of the organisation properties'});
        expect(bar).toHaveTextContent('2 changes, applied in one write of the node configuration');
        // Nothing written until applied.
        expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);
        // A change reverted leaves the buffer.
        fireEvent.click(within(panel()).getByRole('button', {name: 'Revert City'}));
        expect(city).toHaveValue('Paris');
        fireEvent.change(city, {target: {value: ''}});
        fireEvent.click(within(bar).getByRole('button', {name: 'Apply 2 changes'}));
        await waitFor(() => expect(requests.filter((r) => r.method === 'PATCH')).toEqual([expect.objectContaining({
            url: '/api/node/name/dev3n1/config?set=node.enclosure%3Drack%2012&unset=node.loc_city',
        })]));
        // The properties are those of the asset: pushed again for them to say it.
        await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({method: 'POST', url: '/api/node/name/dev3n1/action/push/asset'})));
        expect(within(panel()).queryByRole('region', {name: 'Changes of the organisation properties'})).toBeNull();
        expect(useActionTracker.getState().tracked.some((e) => e.label === 'Update 2 organisation properties' && e.state === 'succeeded')).toBe(true);
    });

    test('the agent version the one the node runs, not the one cached at the last asset push', async () => {
        api['system/property'].items.push({data: {name: 'version', source: 'probe', title: 'agent version', value: '.0.0-rc40-0-g791130387', error: ''}});
        renderPanel();
        const node = await within(panel()).findByRole('region', {name: 'Node'});
        expect(node).toHaveTextContent('Agent versionv3.0.0-rc46');
        expect(node).not.toHaveTextContent('rc40');
    });

    test('the last boot an age, its date hovered', async () => {
        // The clock set, the age the same whatever the day the test runs: the
        // timers left real, for the panel to be waited for.
        vi.useFakeTimers({toFake: ['Date']});
        vi.setSystemTime(new Date('2026-10-13T12:08:50Z'));
        try {
            renderPanel();
            const node = await within(panel()).findByRole('region', {name: 'Node'});
            const age = node.querySelector('time');
            expect(age).toHaveAttribute('datetime', '2026-10-10T12:08:50.000Z');
            expect(age).toHaveTextContent('3 days ago');
        } finally {
            vi.useRealTimers();
        }
    });

    test('the labels as badges, those of the cluster dashed; root edits them in a buffer, applied in one write', async () => {
        api.config = {items: [{keyword: 'labels.az', value: 'fr1'}, {keyword: 'labels.foo', value: 'a4'}, {keyword: 'node.env', value: 'DEV'}]};
        api['cluster/config'] = {items: [{keyword: 'labels.az', value: 'fr2'}, {keyword: 'labels.toto', value: 'tata'}]};
        mockGrants.value = {root: null};
        renderPanel();
        const labels = await within(panel()).findByRole('region', {name: /^Labels/});
        await waitFor(() => expect([...labels.querySelectorAll('[data-label]')].map((b) => [...b.children].map((c) => c.textContent).join(' '))).toEqual(['az fr1', 'foo a4', 'toto tata']));
        expect(labels).not.toHaveTextContent('=');
        // Its own over the cluster's; the cluster's dashed, said so.
        expect(labels.querySelector('[data-label=toto]')).toHaveClass('border-dashed');
        expect(labels.querySelector('[data-label=az]')).not.toHaveClass('border-dashed');

        fireEvent.click(within(labels).getByRole('button', {name: 'Edit the labels'}));
        fireEvent.change(within(labels).getByRole('textbox', {name: 'Value of az'}), {target: {value: 'fr3'}});
        fireEvent.click(within(labels).getByRole('button', {name: 'Remove foo'}));
        // One of the cluster: no removal from the node, a value of its own possible.
        expect(within(labels).queryByRole('button', {name: 'Remove toto'})).toBeNull();
        // A new one from the plus card, typed in one field.
        fireEvent.click(within(labels).getByRole('button', {name: 'Add a label'}));
        const field = within(labels).getByRole('textbox', {name: 'New label'});
        fireEvent.change(field, {target: {value: 'bad/key x'}});
        fireEvent.keyDown(field, {key: 'Enter'});
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(labels).toHaveTextContent('A key of letters, digits');
        fireEvent.change(field, {target: {value: 'rack = r12'}});
        fireEvent.keyDown(field, {key: 'Enter'});
        expect(within(labels).queryByRole('textbox', {name: 'New label'})).toBeNull();
        expect(within(labels).getByRole('textbox', {name: 'Value of rack'})).toHaveValue('r12');
        const bar = within(labels).getByRole('region', {name: 'Changes of the labels'});
        expect(bar).toHaveTextContent('3 changes, applied in one write of the node configuration');
        expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);
        fireEvent.click(within(bar).getByRole('button', {name: 'Apply 3 changes'}));
        await waitFor(() => expect(requests.filter((r) => r.method === 'PATCH')).toEqual([expect.objectContaining({
            url: '/api/node/name/dev3n1/config?set=labels.az%3Dfr3&unset=labels.foo&set=labels.rack%3Dr12',
        })]));
        expect(useActionTracker.getState().tracked[0]).toMatchObject({state: 'succeeded', label: 'Update 3 labels'});
    });

    test('the health says the minimum free memory; root sets it, said whether the node would be overloaded, written to its configuration', async () => {
        api.config = {items: [
            {keyword: 'node.min_avail_mem', value: '10', evaluated_text: '10%'},
            {keyword: 'node.min_avail_swap', value: '', evaluated_text: '10%'},
        ]};
        const {unmount} = renderPanel();
        const health = within(panel()).getByRole('region', {name: 'Health'});
        await waitFor(() => expect(health).toHaveTextContent('42% of 5.8 GiB· minimum 10%'));
        // Not root: said, not set.
        expect(within(health).queryByRole('button', {name: 'Set the minimum free memory'})).toBeNull();
        unmount();

        mockGrants.value = {root: null};
        renderPanel();
        fireEvent.click(await within(panel()).findByRole('button', {name: 'Set the minimum free memory'}));
        const dialog = screen.getByRole('dialog', {name: 'Minimum free memory of dev3n1'});
        const field = within(dialog).getByRole('textbox', {name: 'Minimum free'});
        expect(field).toHaveValue('10');
        expect(dialog).toHaveTextContent('Free now: 42%.');
        expect(dialog).toHaveTextContent('With a minimum of 10%, the node would not be overloaded now.');
        fireEvent.click(within(dialog).getByRole('button', {name: '20%'}));
        fireEvent.change(field, {target: {value: '3Gi'}});
        // 3 GiB of 5.8 GiB: 51%, read as 50% at most.
        expect(dialog).toHaveTextContent('With a minimum of 50%, the node would be overloaded now.');
        fireEvent.change(field, {target: {value: 'lots'}});
        expect(within(dialog).getByRole('button', {name: 'Save'})).toBeDisabled();
        fireEvent.change(field, {target: {value: '50%'}});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Save'}));
        await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
            method: 'PATCH', url: '/api/node/name/dev3n1/config?set=node.min_avail_mem%3D50%25',
        })));
        await waitFor(() => expect(screen.queryByRole('dialog', {name: 'Minimum free memory of dev3n1'})).toBeNull());
        expect(useActionTracker.getState().tracked[0]).toMatchObject({state: 'succeeded', label: 'Set node.min_avail_mem = 50%'});
    });

    test('its actions stand in the title bar, an accent button the size of the close one, each confirmed then posted', async () => {
        renderPanel();
        const actions = within(panel()).getByRole('button', {name: 'Node actions'});
        expect(actions).toHaveClass('max-md:w-7', 'bg-accent');
        expect(actions).not.toHaveClass('rounded-(--radius-pill)');
        // "Actions" in a wide window, the bolt alone in a narrow one.
        expect(actions).toHaveTextContent(/^Actions$/);
        fireEvent.click(actions);
        const menu = screen.getByRole('menu', {name: 'Node actions'});
        // Freeze and unfreeze both, whatever the state.
        expect(within(menu).getByRole('menuitem', {name: 'Freeze'})).toBeInTheDocument();
        expect(within(menu).getByRole('menuitem', {name: 'Unfreeze'})).toBeInTheDocument();
        fireEvent.click(within(menu).getByRole('menuitem', {name: 'Freeze'}));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {name: 'Confirm'}));
        await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
            method: 'POST', url: '/api/node/name/dev3n1/action/freeze',
        })));
        // What comes of it, the actions tray says: no message in the panel.
        expect(within(panel()).queryByText(/requested on 1 node/)).not.toBeInTheDocument();
    });

    test('no abort in its menu: the orchestration in progress offers it, and its logs', async () => {
        useEventStore.setState({nodeMonitor: {dev3n1: {state: 'draining', global_expect: 'drained', orchestration_id: 'o-7'}}});
        renderPanel();
        fireEvent.click(within(panel()).getByRole('button', {name: 'Node actions'}));
        expect(within(screen.getByRole('menu')).queryByRole('menuitem', {name: 'Abort'})).not.toBeInTheDocument();
        fireEvent.click(within(panel()).getByRole('button', {name: 'Node actions'}));

        const badge = within(panel()).getByRole('button', {name: 'Orchestration in progress: drained'});
        fireEvent.click(badge);
        fireEvent.click(screen.getByRole('menuitem', {name: 'Abort'}));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {name: 'Confirm'}));
        await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
            method: 'POST', url: '/api/node/name/dev3n1/action/abort',
        })));

        // Its logs: the logs tab, of this orchestration only, until asked for all.
        fireEvent.click(badge);
        fireEvent.click(screen.getByRole('menuitem', {name: 'Logs'}));
        expect(within(panel()).getByRole('tab', {name: 'Logs'})).toHaveAttribute('aria-selected', 'true');
        expect(within(panel()).getByTestId('logs')).toHaveTextContent('node logs of dev3n1 where ORCHESTRATION_ID=o-7');
        fireEvent.click(within(panel()).getByRole('button', {name: 'Show all the logs'}));
        expect(within(panel()).getByTestId('logs')).toHaveTextContent(/^node logs of dev3n1$/);
    });

    test('no abort in its menu: the orchestration in progress offers it, and its logs', async () => {
        useEventStore.setState({nodeMonitor: {dev3n1: {state: 'draining', global_expect: 'drained', orchestration_id: 'o-7'}}});
        renderPanel();
        fireEvent.click(within(panel()).getByRole('button', {name: 'Node actions'}));
        expect(within(screen.getByRole('menu')).queryByRole('menuitem', {name: 'Abort'})).not.toBeInTheDocument();
        fireEvent.click(within(panel()).getByRole('button', {name: 'Node actions'}));

        const badge = within(panel()).getByRole('button', {name: 'Orchestration in progress: drained'});
        fireEvent.click(badge);
        fireEvent.click(screen.getByRole('menuitem', {name: 'Abort'}));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {name: 'Confirm'}));
        await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
            method: 'POST', url: '/api/node/name/dev3n1/action/abort',
        })));

        // Its logs: the logs tab, of this orchestration only, until asked for all.
        fireEvent.click(badge);
        fireEvent.click(screen.getByRole('menuitem', {name: 'Logs'}));
        expect(within(panel()).getByRole('tab', {name: 'Logs'})).toHaveAttribute('aria-selected', 'true');
        expect(within(panel()).getByTestId('logs')).toHaveTextContent('node logs of dev3n1 where ORCHESTRATION_ID=o-7');
        fireEvent.click(within(panel()).getByRole('button', {name: 'Show all the logs'}));
        expect(within(panel()).getByTestId('logs')).toHaveTextContent(/^node logs of dev3n1$/);
    });

    /** The chip of an inventory view. */
    const inventoryChip = (name) => within(within(panel()).getByRole('tablist', {name: 'Inventory views'})).getByRole('tab', {name: new RegExp(`^${name}`)});

    test('its inventory, a view at a time from chips counting each, the hardware first, sizes in bytes made readable', async () => {
        renderPanel('?peek=node:dev3n1&peektab=inventory');
        expect(inventoryChip('Hardware')).toHaveAttribute('aria-selected', 'true');
        expect(await within(panel()).findByRole('table', {name: 'Hardware'})).toBeInTheDocument();
        await waitFor(() => expect(inventoryChip('Hardware')).toHaveTextContent('3'));
        // One view at a time.
        expect(within(panel()).queryByRole('table', {name: 'Disks'})).not.toBeInTheDocument();
        fireEvent.click(inventoryChip('Disks'));
        expect(screen.getByTestId('location')).toHaveTextContent('view=disks');
        const disks = await within(panel()).findByRole('table', {name: 'Disks'});
        expect(within(disks).getByRole('row', {name: /\/dev\/vda disk 0x1af4 30 GiB/})).toBeInTheDocument();
        expect(within(disks).getByRole('row', {name: /\/dev\/sr0 rom QEMU QEMU DVD-ROM 374 KiB/})).toBeInTheDocument();
        fireEvent.click(inventoryChip('Addresses'));
        expect(await within(panel()).findByRole('table', {name: 'IP addresses'})).toHaveTextContent('10.44.0.11/24');
        fireEvent.click(inventoryChip('SAN'));
        expect(await within(panel()).findByRole('table', {name: 'SAN paths'})).toHaveTextContent('dev3n1.storage.target.2');
        fireEvent.click(inventoryChip('Accounts'));
        expect(await within(panel()).findByRole('table', {name: 'Users'})).toHaveTextContent('root');
        expect(within(panel()).getByRole('table', {name: 'Groups'})).toBeInTheDocument();
    });

    test('the addresses grouped by interface, a line opening each, filtered', async () => {
        renderPanel('?peek=node:dev3n1&peektab=inventory&view=addresses');
        const table = await within(panel()).findByRole('table', {name: 'IP addresses'});
        const interfaces = () => [...table.querySelectorAll('[data-interface-row]')].map((row) => row.textContent);
        expect(interfaces().length).toBeGreaterThan(0);
        expect([...interfaces()].sort((a, b) => a.localeCompare(b))).toEqual(interfaces());
        fireEvent.change(within(panel()).getByRole('searchbox', {name: 'Filter the addresses'}), {target: {value: '10.44.0.11'}});
        const rows = within(table).getAllByRole('row').slice(1).filter((row) => !row.hasAttribute('data-interface-row'));
        expect(rows.every((row) => row.textContent.includes('10.44.0.11'))).toBe(true);
    });

    test('the objects on a disk, each the badge of its instance on the node, named by its path', async () => {
        const vda = api['system/disk'].items.find((item) => item.data.id === 'vda');
        vda.data.regions[0].object = 'ns1/svc/web';
        renderPanel('?peek=node:dev3n1&peektab=inventory&view=disks');
        const disks = await within(panel()).findByRole('table', {name: 'Disks'});
        const badge = within(disks).getByRole('button', {name: 'ns1/svc/web'});
        fireEvent.click(badge);
        expect(screen.getByTestId('location')).toHaveTextContent('peek=instance:ns1/svc/web@dev3n1');
    });

    test('packages are filtered and paged, 50 a page', async () => {
        api['system/package'] = {
            kind: 'PackageList',
            items: Array.from({length: 250}, (_, i) => ({kind: 'PackageItem', meta: {node: 'dev3n1'}, data: {name: `pkg${String(i).padStart(3, '0')}`, version: '1', arch: 'all', type: 'deb'}})),
        };
        renderPanel('?peek=node:dev3n1&peektab=inventory&view=packages');
        const packages = await within(panel()).findByRole('table', {name: 'Packages'});
        expect(within(packages).getAllByRole('row')).toHaveLength(1 + 50);
        expect(within(panel()).getByText('1–50 of 250')).toBeInTheDocument();
        fireEvent.click(within(panel()).getByRole('button', {name: 'Next'}));
        expect(within(packages).getAllByRole('row')[1].cells[0].textContent).toBe('pkg050');
        // Filtered: from the first page again.
        fireEvent.change(within(panel()).getByRole('searchbox', {name: 'Filter the packages'}), {target: {value: 'pkg24'}});
        expect(within(packages).getAllByRole('row').slice(1).map((row) => row.cells[0].textContent))
            .toEqual(['pkg240', 'pkg241', 'pkg242', 'pkg243', 'pkg244', 'pkg245', 'pkg246', 'pkg247', 'pkg248', 'pkg249']);
    });

    test('its configuration file, edited in place and written whole', async () => {
        renderPanel('?peek=node:dev3n1&peektab=config');
        expect(await within(panel()).findByLabelText('Node configuration file')).toHaveTextContent('env = TST');
        fireEvent.click(within(panel()).getByRole('button', {name: 'Edit the configuration file'}));
        const editor = await within(panel()).findByRole('textbox', {name: 'Node configuration file'});
        fireEvent.change(editor, {target: {value: `${CONFIG}max_parallel = 4\n`}});
        fireEvent.click(within(panel()).getByRole('button', {name: 'Save'}));
        await waitFor(() => expect(requests).toContainEqual({
            method: 'PUT', url: '/api/node/name/dev3n1/config/file', body: `${CONFIG}max_parallel = 4\n`,
        }));
        // Written, said in the actions tray; the file shown again.
        await waitFor(() => expect(useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state]))
            .toEqual([['Update the configuration', 'dev3n1', 'succeeded']]));
        expect(await within(panel()).findByLabelText('Node configuration file')).toHaveTextContent('max_parallel = 4');
    });

    test('its configuration validated on the node, as om node config validate; written, the result gone', async () => {
        api['config/validate'] = {kind: 'ConfigAlertList', items: [
            {node: 'dev3n1', path: '', level: 'warning', kind: 'unknown keyword', key: 'toto.titi', driver: '', comment: 'keyword does not exist: "toto.titi"'},
            {node: 'dev3n1', path: '', level: 'error', kind: 'invalid value', key: 'node.max_parallel', driver: '', comment: 'not an integer'},
        ]};
        renderPanel('?peek=node:dev3n1&peektab=config');
        await within(panel()).findByLabelText('Node configuration file');
        const run = within(panel()).getByRole('button', {name: 'Validate the configuration'});
        expect(run).toHaveTextContent(/^Validate$/);
        fireEvent.click(run);
        const result = await within(panel()).findByRole('region', {name: 'Validation of the configuration'});
        expect(requests).toContainEqual(expect.objectContaining({method: 'GET', url: '/api/node/name/dev3n1/config/validate'}));
        // The errors first, a write refusing them.
        expect(result).toHaveTextContent(/^1 error, 1 warning · a write with errors is refused/);
        expect([...result.querySelectorAll('[data-alert]')].map((a) => a.dataset.alert)).toEqual(['error', 'warning']);
        expect(result).toHaveTextContent('node.max_parallel invalid value');
        // Written, the result is no longer of the file.
        fireEvent.click(within(panel()).getByRole('button', {name: 'Edit the configuration file'}));
        const editor = await within(panel()).findByRole('textbox', {name: 'Node configuration file'});
        fireEvent.change(editor, {target: {value: `${CONFIG}max_parallel = 4\n`}});
        fireEvent.click(within(panel()).getByRole('button', {name: 'Save'}));
        await within(panel()).findByLabelText('Node configuration file');
        expect(within(panel()).queryByRole('region', {name: 'Validation of the configuration'})).toBeNull();
    });

    test('its secrets redacted, node.uuid, until shown for a while; edited, the file read whole', async () => {
        renderPanel('?peek=node:dev3n1&peektab=config');
        const file = await within(panel()).findByLabelText('Node configuration file');
        expect(file).toHaveTextContent('uuid = ********');
        expect(file).not.toHaveTextContent('5b5c-secret');
        expect(requests).toContainEqual(expect.objectContaining({url: '/api/node/name/dev3n1/config/file?redact-secrets=true'}));
        expect(within(panel()).getByText('Secret values are shown as ********.')).toBeInTheDocument();
        fireEvent.click(within(panel()).getByRole('button', {name: /^Show/}));
        await waitFor(() => expect(within(panel()).getByLabelText('Node configuration file')).toHaveTextContent('uuid = 5b5c-secret'));
        fireEvent.click(within(panel()).getByRole('button', {name: /^Hide/}));
        await waitFor(() => expect(within(panel()).getByLabelText('Node configuration file')).toHaveTextContent('uuid = ********'));
        // Edited, the file as stored: the uuid in clear, written back so.
        fireEvent.click(within(panel()).getByRole('button', {name: 'Edit the configuration file'}));
        const editor = await within(panel()).findByRole('textbox', {name: 'Node configuration file'});
        expect(editor.value).toContain('uuid = 5b5c-secret');
        fireEvent.change(editor, {target: {value: `${CONFIG}max_parallel = 4\n`}});
        fireEvent.click(within(panel()).getByRole('button', {name: 'Save'}));
        await waitFor(() => expect(requests).toContainEqual({
            method: 'PUT', url: '/api/node/name/dev3n1/config/file', body: `${CONFIG}max_parallel = 4\n`,
        }));
    });

    test('a file changed since the edit started is not overwritten', async () => {
        renderPanel('?peek=node:dev3n1&peektab=config');
        await within(panel()).findByLabelText('Node configuration file');
        fireEvent.click(within(panel()).getByRole('button', {name: 'Edit the configuration file'}));
        const editor = await within(panel()).findByRole('textbox', {name: 'Node configuration file'});
        config = `${CONFIG}changed = elsewhere\n`;
        fireEvent.change(editor, {target: {value: `${CONFIG}mine = 1\n`}});
        fireEvent.click(within(panel()).getByRole('button', {name: 'Save'}));
        expect(await within(panel()).findByRole('alert')).toHaveTextContent('changed by someone else');
        expect(requests.filter((r) => r.method === 'PUT')).toEqual([]);
    });

    test('its schedules, its drivers and capabilities filtered, its logs', async () => {
        renderPanel('?peek=node:dev3n1&peektab=schedules');
        const schedules = await within(panel()).findByRole('table', {name: 'Schedules'});
        expect(within(schedules).getByRole('row', {name: /checks ~00:00-06:00/})).toHaveTextContent('collector');

        openTab('Drivers');
        expect(screen.getByTestId('location')).toHaveTextContent('peektab=drivers');
        let drivers = await within(panel()).findByRole('table', {name: 'Drivers'});
        const row = (id) => within(drivers).getAllByRole('row').find((r) => r.cells[0]?.textContent === id);
        // Usable when the node holds its capability, a resource driver's under drivers.resource.
        expect(row('container.kvm')).toHaveTextContent('container.kvmUsablehvm partitions');
        expect(row('container.podman')).toHaveTextContent('Not usable: no capability');
        expect(row('pool.directory')).toHaveTextContent('Usable');
        expect(row('pool.rados')).toHaveTextContent('Not usable');
        // Each view on a chip at the head of the tab, its count on it: the drivers first.
        const section = (name) => within(within(panel()).getByRole('tablist', {name: 'What the node can run'})).getByRole('tab', {name: new RegExp(`^${name}`)});
        expect(section('Drivers')).toHaveAttribute('aria-selected', 'true');
        expect(section('Drivers')).toHaveTextContent('Drivers10');
        expect(within(panel()).queryByRole('list', {name: 'Node tools'})).toBeNull();
        fireEvent.click(section('Node tools'));
        expect(screen.getByTestId('location')).toHaveTextContent('peektab=drivers&view=tools');
        expect(within(panel()).getByRole('list', {name: 'Node tools'})).toHaveTextContent('scsi.sg_persistsystemd');
        expect(within(panel()).queryByRole('table', {name: 'Drivers'})).toBeNull();
        fireEvent.click(section('Drivers'));
        // Drawn again, back on its view.
        drivers = within(panel()).getByRole('table', {name: 'Drivers'});
        // Which drivers, a select apart from the chips of the views: those the node cannot run alone.
        const which = within(panel()).getByRole('combobox', {name: 'Which drivers'});
        expect([...which.options].map((o) => o.textContent)).toEqual(['All (10)', 'Usable here (7)', 'Not usable here (3)']);
        expect(within(panel()).queryByRole('tab', {name: /usable/i})).toBeNull();
        fireEvent.change(which, {target: {value: 'unusable'}});
        expect(within(drivers).getAllByRole('row').slice(1).map((r) => r.cells[0].textContent))
            .toEqual(['container.podman', 'fs.bind', 'pool.rados']);
        fireEvent.change(which, {target: {value: 'all'}});
        // The filter reads the capability of a driver too, and its features.
        fireEvent.change(within(panel()).getByRole('searchbox', {name: 'Filter the drivers and capabilities'}), {target: {value: 'hvm'}});
        expect(within(drivers).getAllByRole('row').slice(1).map((r) => r.cells[0].textContent)).toEqual(['container.kvm']);
        fireEvent.change(within(panel()).getByRole('searchbox', {name: 'Filter the drivers and capabilities'}), {target: {value: 'drivers.pool'}});
        // The filter reads every view: its counts on their chips.
        expect(section('Drivers')).toHaveTextContent('Drivers2');
        expect(section('Node tools')).toHaveTextContent('Node tools0');
        fireEvent.click(section('Capabilities'));
        expect(within(panel()).getByRole('list', {name: 'Capabilities'})).toHaveTextContent('drivers.pool.directory');

        openTab('Logs');
        expect(within(panel()).getByTestId('logs')).toHaveTextContent('node logs of dev3n1');
    });

    test('the capabilities scanned again on demand, read again once the scan is done', async () => {
        api['action/scan/capabilities'] = {exec_id: 'e1', session_id: 's1'};
        const post = global.fetch.getMockImplementation();
        global.fetch.mockImplementation(async (url, options = {}) => {
            if (options.method !== 'POST' || !url.endsWith('/action/scan/capabilities')) return post(url, options);
            requests.push({method: 'POST', url, body: options.body});
            return new Response(JSON.stringify(api['action/scan/capabilities']), {status: 200, headers: {'Content-Type': 'application/json'}});
        });
        renderPanel('?peek=node:dev3n1&peektab=drivers');
        await within(panel()).findByRole('table', {name: 'Drivers'});
        const reads = () => requests.filter((r) => r.method === 'GET' && r.url.endsWith('/capabilities')).length;
        expect(reads()).toBe(1);
        fireEvent.click(within(panel()).getByRole('button', {name: 'Rescan'}));
        // Running: the button says so, held back; followed in the actions tray.
        expect(await within(panel()).findByRole('button', {name: /Scanning/})).toBeDisabled();
        expect(requests).toContainEqual(expect.objectContaining({method: 'POST', url: '/api/node/name/dev3n1/action/scan/capabilities'}));
        await waitFor(() => expect(useActionTracker.getState().tracked.some((e) => e.followedId === 'e1')).toBe(true));
        expect(reads()).toBe(1);
        // Done: the capabilities read again.
        act(() => useActionTracker.setState((state) => ({
            tracked: state.tracked.map((e) => (e.followedId === 'e1' ? {...e, state: 'succeeded', endedAt: Date.now()} : e)),
        })));
        await waitFor(() => expect(reads()).toBe(2));
        expect(within(panel()).getByRole('button', {name: 'Rescan'})).toBeEnabled();
    });

    test('its events, read for the node alone, in a tab', async () => {
        localStorage.setItem('authToken', 'token');
        useEventLogStore.getState().clearLogs();
        useEventLogStore.getState().addEventLog('NodeMonitorUpdated', {node: 'dev3n2', labels: {node: 'dev3n2'}});
        useEventLogStore.getState().addEventLog('NodeStatusUpdated', {node: 'dev3n1', labels: {node: 'dev3n1'}});
        renderPanel('?peek=node:dev3n1&peektab=events');
        const events = await within(panel()).findByRole('region', {name: 'Events'});
        expect(mockStartLogger).toHaveBeenCalledWith('token', expect.arrayContaining(['NodeStatusUpdated', 'NodeMonitorUpdated', 'DaemonHeartbeatUpdated']), null, 'dev3n1');
        const list = within(events).getByRole('region', {name: 'Event list'});
        expect(await within(list).findByText('NodeStatusUpdated')).toBeInTheDocument();
        expect(within(list).queryByText('NodeMonitorUpdated')).not.toBeInTheDocument();
        // In place: no close of its own.
        expect(within(events).queryByRole('button', {name: 'Close'})).not.toBeInTheDocument();
        useEventLogStore.getState().clearLogs();
        localStorage.removeItem('authToken');
    });

    test('a read refused is said in its section', async () => {
        global.fetch.mockImplementation(async () => new Response(JSON.stringify({detail: 'forbidden'}), {status: 403}));
        renderPanel('?peek=node:dev3n1&peektab=schedules');
        expect(await within(panel()).findByRole('alert')).toHaveTextContent('Could not read it');
    });

    test('closed, it leaves the URL; the history keeps it, as a node', async () => {
        renderPanel();
        fireEvent.click(within(panel()).getAllByRole('button', {name: 'Close'})[0]);
        expect(screen.getByTestId('location')).toHaveTextContent(/^$/);
        await act(async () => {});
        expect(JSON.stringify(sessionStorage)).toContain('node');
    });

    test('a filter field is as wide as its label, which is never cut', async () => {
        renderPanel('?peek=node:dev3n1&peektab=drivers');
        const label = 'Filter the drivers and capabilities';
        const field = await within(panel()).findByRole('searchbox', {name: label});
        expect(field).toHaveAttribute('placeholder', label);
        expect(field.style.width).toBe(`calc(${label.length}ch + 3.5rem)`);
        expect(field).toHaveClass('min-w-56', 'max-w-full');
    });

    describe('daemon tab', () => {
        const section = (name) => within(panel()).getByRole('region', {name: new RegExp(`^${name}`)});
        const confirmDialog = () => screen.getByRole('dialog', {name: /^Confirm: /});
        const confirm = () => fireEvent.click(within(confirmDialog()).getByRole('button', {name: 'Confirm'}));
        const openDaemon = async () => {
            renderPanel('?peek=node:dev3n1&peektab=daemon');
            await within(panel()).findByRole('table', {name: 'Components'});
        };

        /** The chip of a view, the switch of the tab. */
        const chip = (name) => within(within(panel()).getByRole('tablist', {name: 'Daemon views'})).getByRole('tab', {name: new RegExp(`^${name}`)});

        test('the overview first: its components, the listener among them, and its heartbeats; each view summed up on its chip', async () => {
            await openDaemon();
            expect(within(panel()).getByText(`PID ${daemon['cluster/status'].cluster.node.dev3n1.daemon.pid}`, {exact: false})).toBeInTheDocument();
            expect(chip('Overview')).toHaveAttribute('aria-selected', 'true');
            const components = within(panel()).getByRole('table', {name: 'Components'});
            expect(within(components).getByRole('row', {name: /API listener.*running.*:::1215/})).toBeInTheDocument();
            expect(within(components).getByRole('row', {name: /Collector.*speaker/})).toBeInTheDocument();
            // The listener, a line of the components, its actions on it: no section of its own.
            expect(within(components).getByRole('button', {name: 'Actions on the listener api.inet'})).toBeInTheDocument();
            expect(within(panel()).queryByRole('region', {name: /^Listener/})).not.toBeInTheDocument();
            expect(within(panel()).queryByRole('region', {name: /^Log level/})).not.toBeInTheDocument();
            expect(requests.some((req) => req.url.includes('daemon/log/control'))).toBe(false);
            const heartbeats = await within(panel()).findByRole('table', {name: 'Heartbeats'});
            expect(within(heartbeats).getAllByRole('row').slice(1)).toHaveLength(8);
            // The long lists on views of their own, their counts on their chips.
            expect(within(panel()).queryByRole('table', {name: 'Executions'})).not.toBeInTheDocument();
            expect(within(panel()).queryByRole('table', {name: 'DNS zone'})).not.toBeInTheDocument();
            await waitFor(() => expect(chip('DNS')).toHaveTextContent('8'));
            expect(chip('Executions')).toHaveTextContent(String(api['daemon/exec'].items.length));
        });

        test('a view at a time, from its chip, in the URL: orchestrations, executions, the DNS zone grouped by name', async () => {
            await openDaemon();
            fireEvent.click(chip('Orchestrations'));
            expect(screen.getByTestId('location')).toHaveTextContent('view=orchestrations');
            expect(await within(panel()).findByRole('table', {name: 'Orchestrations'})).toHaveTextContent('foo002');
            // Its logs in a modal: on every node of the cluster, of its id.
            const orchestrations = within(panel()).getByRole('table', {name: 'Orchestrations'});
            fireEvent.click(within(orchestrations).getAllByRole('button', {name: 'Logs'})[0]);
            const orchestrationLogs = screen.getByRole('dialog', {name: /^Logs of the orchestration /});
            expect(within(orchestrationLogs).getByTestId('logs')).toHaveTextContent(/^node logs of dev3n1 where ORCHESTRATION_ID=[0-9a-f-]{36}$/);
            fireEvent.click(within(orchestrationLogs).getByRole('button', {name: 'Close'}));
            expect(within(panel()).queryByRole('table', {name: 'Components'})).not.toBeInTheDocument();
            fireEvent.click(chip('Executions'));
            expect(await within(panel()).findByRole('table', {name: 'Executions'})).toHaveTextContent('instance status');
            fireEvent.click(chip('DNS'));
            const zone = await within(panel()).findByRole('table', {name: 'DNS zone'});
            const records = () => within(zone).getAllByRole('row').slice(1).filter((row) => !row.hasAttribute('data-name-row'));
            const names = () => [...zone.querySelectorAll('[data-name-row]')].map((row) => row.textContent);
            expect(records()).toHaveLength(8);
            // A line opening the records of each name, the names in order.
            expect(names().length).toBeGreaterThan(0);
            expect([...names()].sort((x, y) => x.localeCompare(y))).toEqual(names());
            fireEvent.change(within(panel()).getByLabelText('Filter records'), {target: {value: 'ns1.dev3'}});
            // Each record kept matches, by its name or its own content.
            let name = '';
            for (const row of within(zone).getAllByRole('row').slice(1)) {
                if (row.hasAttribute('data-name-row')) name = row.textContent;
                else expect(`${name} ${row.textContent}`).toContain('ns1.dev3');
            }
            // Back to the overview: its view the first, out of the URL.
            fireEvent.click(chip('Overview'));
            expect(screen.getByTestId('location')).not.toHaveTextContent('view=');
            expect(await within(panel()).findByRole('table', {name: 'Components'})).toBeInTheDocument();
        });

        test('the heartbeats kept current by their events, without a reload', async () => {
            await openDaemon();
            expect(mockRetain).toHaveBeenCalledWith('tok', ['DaemonHeartbeatUpdated']);
            const heartbeats = await within(panel()).findByRole('table', {name: 'Heartbeats'});
            const row = () => within(heartbeats).getByRole('row', {name: /hb#1\.rx/});
            expect(within(row()).getByText('Beating')).toBeInTheDocument();
            const statusReads = requests.filter((r) => r.url === '/api/cluster/status?selector=cluster').length;

            // A DaemonHeartbeatUpdated: the peer of hb#1.rx stops beating.
            const heartbeat = structuredClone(daemon['cluster/status'].cluster.node.dev3n1.daemon.heartbeat);
            heartbeat.streams[0].peers.dev3n2.is_beating = false;
            act(() => useEventStore.setState({heartbeatStatus: {dev3n1: heartbeat}}));
            expect(within(row()).getByText('Stale')).toBeInTheDocument();
            expect(requests.filter((r) => r.url === '/api/cluster/status?selector=cluster')).toHaveLength(statusReads);
        });

        test('a heartbeat stream restarted, confirmed first, by its name without hb#', async () => {
            await openDaemon();
            fireEvent.click(within(panel()).getByRole('button', {name: 'Actions on hb#1.rx'}));
            fireEvent.click(within(screen.getByRole('menu', {name: 'Actions on hb#1.rx'})).getByRole('menuitem', {name: 'Restart'}));
            expect(confirmDialog()).toHaveTextContent('Restart the hb#1.rx heartbeat stream of dev3n1?');
            expect(requests.some((r) => r.method === 'POST')).toBe(false);
            confirm();
            await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
                method: 'POST', url: '/api/node/name/dev3n1/daemon/hb/name/1.rx/action/restart',
            })));
            // Queued by the daemon: followed in the actions tray until the stream runs anew.
            await waitFor(() => expect(trayEntries()).toEqual([['Restart', 'the hb#1.rx heartbeat stream of dev3n1', 'running', null]]));
            expect(within(panel()).queryByText(/requested/)).not.toBeInTheDocument();
        });

        test('a disk heartbeat is signed and wiped as a whole; the others offer neither, done when the daemon answers', async () => {
            api['cluster/status'].cluster.node.dev3n1.daemon.heartbeat.streams.push(
                {id: 'hb#3.rx', type: 'disk', state: 'running', peers: {dev3n2: {is_beating: true}}});
            await openDaemon();
            fireEvent.click(within(panel()).getByRole('button', {name: 'Actions on hb#1.rx'}));
            expect(within(screen.getByRole('menu')).queryByRole('menuitem', {name: 'Wipe'})).not.toBeInTheDocument();
            fireEvent.keyDown(screen.getByRole('menu'), {key: 'Escape'});
            fireEvent.click(within(panel()).getByRole('button', {name: 'Actions on hb#3.rx'}));
            fireEvent.click(within(screen.getByRole('menu', {name: 'Actions on hb#3.rx'})).getByRole('menuitem', {name: 'Wipe'}));
            expect(confirmDialog()).toHaveTextContent('Wipe the hb#3 disk heartbeat of dev3n1?');
            confirm();
            await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
                method: 'POST', url: '/api/node/name/dev3n1/daemon/hb/name/3/action/wipe',
            })));
            await waitFor(() => expect(trayEntries()).toEqual([['Wipe', 'the hb#3 disk heartbeat of dev3n1', 'succeeded', null]]));
        });

        test('the listener stopped, from its line of the components, warned that the API stops answering', async () => {
            await openDaemon();
            fireEvent.click(within(panel()).getByRole('button', {name: 'Actions on the listener api.inet'}));
            fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', {name: 'Stop'}));
            expect(confirmDialog()).toHaveTextContent('Its API stops answering over the network');
            confirm();
            await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
                method: 'POST', url: '/api/node/name/dev3n1/daemon/listener/name/api.inet/action/stop',
            })));
        });

        test('a running execution, listed first, terminated by a TERM signal', async () => {
            api['daemon/exec'].items.push({
                exec_id: 'e1', path: 'ns1/svc/web', command: '/usr/bin/om ns1/svc/web instance start', origin: 'api',
                state: 'running', node: 'dev3n1', started_at: '2026-10-15T10:00:00+02:00',
            });
            renderPanel('?peek=node:dev3n1&peektab=daemon&view=executions');
            const execs = await within(panel()).findByRole('table', {name: 'Executions'});
            const first = within(execs).getAllByRole('row')[1];
            // Its logs in a modal: on its node, of its id.
            fireEvent.click(within(first).getByRole('button', {name: 'Logs'}));
            const execLogs = screen.getByRole('dialog', {name: 'Logs of the exec e1 of ns1/svc/web'});
            expect(within(execLogs).getByTestId('logs')).toHaveTextContent('node logs of dev3n1 where EXEC_ID=e1');
            fireEvent.click(within(execLogs).getByRole('button', {name: 'Close'}));
            expect(first).toHaveTextContent('ns1/svc/web');
            fireEvent.click(within(first).getByRole('button', {name: 'Terminate'}));
            expect(confirmDialog()).toHaveTextContent('Send TERM to "/usr/bin/om ns1/svc/web instance start" on dev3n1?');
            confirm();
            await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
                method: 'DELETE', url: '/api/node/name/dev3n1/daemon/exec?exec_id=e1&signal=TERM',
            })));
            // Only the running ones can be signaled.
            expect(within(execs).getAllByRole('button', {name: 'Terminate'})).toHaveLength(1);
        });

        test('the listener restarted, followed until its status says so: its update time, its creation time kept', async () => {
            await openDaemon();
            fireEvent.click(within(panel()).getByRole('button', {name: 'Actions on the listener api.inet'}));
            fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', {name: 'Restart'}));
            confirm();
            await waitFor(() => expect(trayEntries()).toEqual([['Restart', 'the api.inet listener of dev3n1', 'running', null]]));
            // Restarted: the daemon updates it, created as it was.
            api['cluster/status'].cluster.node.dev3n1.daemon.listener.updated_at = '2026-10-19T16:30:09Z';
            await waitFor(() => expect(trayEntries()).toEqual([['Restart', 'the api.inet listener of dev3n1', 'succeeded', null]]), {timeout: 5000});
        });

        test('a request refused is said in the actions tray, with why', async () => {
            await openDaemon();
            global.fetch.mockImplementationOnce(async () => new Response(JSON.stringify({detail: 'listener busy'}), {status: 409}));
            fireEvent.click(within(panel()).getByRole('button', {name: 'Actions on the listener api.inet'}));
            fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', {name: 'Restart'}));
            confirm();
            await waitFor(() => expect(trayEntries()).toEqual([
                ['Restart', 'the api.inet listener of dev3n1', 'refused', expect.stringMatching(/^HTTP 409 .*listener busy/)],
            ]));
        });
    });
});

describe('parseLabel', () => {
    test('key=value or key value, spaces allowed around the equal sign; a key alone, an empty value', () => {
        expect(parseLabel('az=fr1')).toEqual({key: 'az', value: 'fr1'});
        expect(parseLabel('  az  =  fr1 ')).toEqual({key: 'az', value: 'fr1'});
        expect(parseLabel('az fr1')).toEqual({key: 'az', value: 'fr1'});
        expect(parseLabel('az\tfr 1')).toEqual({key: 'az', value: 'fr 1'});
        expect(parseLabel('az b=c')).toEqual({key: 'az', value: 'b=c'});
        expect(parseLabel('az')).toEqual({key: 'az', value: ''});
        expect(parseLabel('az=')).toEqual({key: 'az', value: ''});
        expect(parseLabel('=fr1')).toBeNull();
        expect(parseLabel('a/z fr1')).toBeNull();
    });
});

describe('propertyGroups', () => {
    test('in a group, by title, whatever order the api answers them in', () => {
        const props = [
            {name: 'loc_room', title: 'loc, room', source: 'default'}, {name: 'loc_city', title: 'loc, city', source: 'default'},
            {name: 'loc_addr', title: 'loc, address', source: 'config'},
        ];
        const order = (list) => propertyGroups(list)[0].items.map((p) => p.name);
        expect(order(props)).toEqual(['loc_addr', 'loc_city', 'loc_room']);
        expect(order([...props].reverse())).toEqual(['loc_addr', 'loc_city', 'loc_room']);
    });

    test('by the label given, when one is', () => {
        const props = [{name: 'loc_zip', title: 'loc, zip', source: 'default'}, {name: 'loc_city', title: 'loc, city', source: 'default'}];
        const labels = {loc_zip: 'Code postal', loc_city: 'Ville'};
        expect(propertyGroups(props, (p) => labels[p.name])[0].items.map((p) => p.name)).toEqual(['loc_zip', 'loc_city']);
    });

    test('by family then by what they are about; unknown ones in the other group of their family', () => {
        const props = [
            {name: 'loc_city', source: 'default'}, {name: 'os_name', source: 'probe'}, {name: 'nodename', source: 'probe'},
            {name: 'mystery', source: 'probe'}, {name: 'team_support', source: 'config'}, {name: 'sec_zone', source: 'default'},
            {name: 'odd', source: 'default'},
        ];
        expect(propertyGroups(props).map(({family, group, items}) => [family, group, items.map((p) => p.name)])).toEqual([
            ['discovered', 'node', ['nodename']],
            ['discovered', 'os', ['os_name']],
            ['discovered', 'other', ['mystery']],
            ['organisation', 'location', ['loc_city']],
            ['organisation', 'team', ['team_support']],
            ['organisation', 'asset', ['sec_zone']],
            ['organisation', 'other', ['odd']],
        ]);
    });
});
