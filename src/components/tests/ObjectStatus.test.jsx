import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {vi} from 'vitest';
import ObjectStatus from '../ObjectStatus';
import {PanelHeaderContext} from '../../app/panel-header';
import {MemoryRouter} from 'react-router-dom';
import useEventStore from '../../hooks/useEventStore.js';
import {useActionTracker} from '../../app/action-tracker';

/** What the actions tray holds, the latest first: action, subject, state, reason. */
const tray = () => useActionTracker.getState().tracked.map((e) => [e.action, e.subject, e.state, e.error ?? null]);
import dns from '../../app/tests/fixtures/system-svc-dns.json';

const {mockApiFetch, mockRetain, mockRelease} = vi.hoisted(() => ({
    mockApiFetch: vi.fn(),
    mockRetain: vi.fn(),
    mockRelease: vi.fn(),
}));

vi.mock('../../services/api.jsx', () => ({
    apiFetch: mockApiFetch,
    getResponseErrorMessage: async (response) => response.detail ?? '',
}));
// The console, an xterm, is tested on its own: here, what it is opened on.
vi.mock('../ConsoleTerminal.jsx', () => ({
    default: ({open, target}) => (open ? <div data-testid="console">{`${target.rid} on ${target.node}`}</div> : null),
}));
vi.mock('../../eventSourceManager.jsx', () => ({
    retainEventReception: (...args) => {
        mockRetain(...args);
        return mockRelease;
    },
}));

const cluster = (frozen) => ({
    cluster: {
        status: {is_compat: true},
        node: {
            dev3n1: {status: {frozen_at: frozen ? '2026-10-12T10:00:00Z' : '0001-01-01T00:00:00Z'}},
            dev3n2: {status: {frozen_at: '0001-01-01T00:00:00Z'}},
        },
    },
});

/** Answers the object with `object`, the cluster status with `clusterStatus`. */
const answer = (object, clusterStatus = cluster(false)) => mockApiFetch.mockImplementation((url) =>
    Promise.resolve(url.includes('/cluster/status') ? clusterStatus : {data: object}));

describe('ObjectStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.setItem('authToken', 'tok');
        useActionTracker.setState({tracked: [], revealed: 0});
    });

    afterEach(() => {
        localStorage.clear();
    });

    test('reads the object and shows its status board, its stream claimed while shown', async () => {
        answer(dns);
        const {unmount} = render(<ObjectStatus path="system/svc/dns"/>);
        const board = await screen.findByRole('table', {name: 'Status of system/svc/dns by node'});
        expect(mockApiFetch).toHaveBeenCalledWith('/api/object/path/system/svc/dns', expect.objectContaining({
            headers: {Authorization: 'Bearer tok'},
        }));
        expect(mockRetain).toHaveBeenCalledWith('tok', expect.arrayContaining(['InstanceStatusUpdated']), 'system/svc/dns');
        for (const fact of ['flex', 'ha', 'nodes order']) expect(screen.getByText(fact)).toBeInTheDocument();
        expect(screen.getByText('Instances up').nextSibling).toHaveTextContent('0/2');
        expect(within(board).getByRole('columnheader', {name: /dev3n1/})).toBeInTheDocument();
        expect(within(board).getByRole('rowheader', {name: /container#janitor$/})).toBeInTheDocument();
        expect(within(board).getAllByText('start failed')).toHaveLength(2);
        // The statuses drawn as in the other views, the flags named.
        expect(within(board).getAllByText('down').length).toBeGreaterThan(0);
        expect(within(board).getAllByText('disabled')).toHaveLength(2);
        // n/a written as om writes it, and no tooltip of its own on a piece of a
        // cell: the card of the cell says what they mean, without two over each other.
        const config = within(board).getByRole('rowheader', {name: /container#config$/}).closest('tr');
        expect(config.querySelectorAll('[data-glyph="na"]')).toHaveLength(2);
        expect(board.querySelectorAll('td [title]')).toHaveLength(0);
        expect(screen.getByRole('heading', {name: 'Notes (2)'})).toBeInTheDocument();
        expect(screen.getByText('system/vol/dns avail down')).toBeInTheDocument();
        unmount();
        expect(mockRelease).toHaveBeenCalled();
    });

    test('the summary: a status a line, said in full in its tint, then an issue a line, the policies and the actions apart', async () => {
        const broken = structuredClone(dns);
        broken.provisioned = 'false';
        answer(broken);
        render(<ObjectStatus path="system/svc/dns"/>);
        await screen.findByRole('table');
        expect(screen.getByText('Avail').nextSibling).toHaveTextContent(/^down$/);
        // The word in full, bold, in the tint of its state: no badge, no glyph.
        const avail = screen.getByText('Avail').nextSibling.querySelector('[data-state]');
        expect(avail).toHaveClass('font-semibold', 'text-state-down');
        expect(screen.getByText('Avail').nextSibling.querySelector('svg')).toBeNull();
        const overall = screen.getByText('Overall').nextSibling.querySelector('[data-state]');
        expect(overall.className).toMatch(/font-semibold text-(state-\w+|ink-muted)/);
        // One a line: label and value pairs of a two-column list.
        expect(screen.getByText('Avail').tagName).toBe('DT');
        expect(screen.getByText('Overall').tagName).toBe('DT');
        expect(screen.getByRole('list', {name: 'Issues'})).toHaveTextContent('not provisioned');
        expect(screen.getByRole('list', {name: 'Issues'})).toHaveClass('flex-col');
        // Beside the summary, not under it: a state coming or going (frozen) moves nothing below.
        const summary = screen.getByText('Instances up').closest('dl');
        expect(screen.getByRole('list', {name: 'Issues'}).parentElement).toBe(summary.parentElement);
        expect(summary.parentElement).toHaveClass('flex', 'flex-wrap');
        // Out of a panel, the policies and the actions stand over the summary.
        const policies = screen.getByLabelText('Policies');
        expect(policies).toHaveTextContent('Topology: flexOrchestrate: haPlacement: nodes order');
        // Each policy a tag of its value alone, no icon, named in its tooltip.
        expect([...policies.querySelectorAll('[data-policy]')].map((tag) => [tag.dataset.policy, tag.title]))
            .toEqual([['topology', 'Topology: flex'], ['orchestrate', 'Orchestrate: ha'], ['placement', 'Placement: nodes order']]);
        expect(policies.querySelectorAll('[data-policy] svg')).toHaveLength(0);
        expect(screen.getByRole('button', {name: 'Actions'})).toBeInTheDocument();
    });

    test('in a panel: the policies over the summary, the actions an outlined button of the title bar', async () => {
        answer(dns);
        function InPanel() {
            const [title, setTitle] = React.useState(null);
            const [actions, setActions] = React.useState(null);
            return (
                <>
                    <div data-testid="bar-title" ref={setTitle}/>
                    <div data-testid="bar-actions" ref={setActions}/>
                    <div data-testid="body">
                        <PanelHeaderContext.Provider value={{title, actions}}>
                            <ObjectStatus path="system/svc/dns"/>
                        </PanelHeaderContext.Provider>
                    </div>
                </>
            );
        }
        render(<InPanel/>);
        await screen.findByRole('table');
        expect(screen.getByTestId('body')).toContainElement(screen.getByLabelText('Policies'));
        expect(screen.getByTestId('bar-title')).toBeEmptyDOMElement();
        const actions = within(screen.getByTestId('bar-actions')).getByRole('button', {name: 'Actions'});
        expect(actions).toHaveClass('max-md:w-7', 'border', 'border-line');
        expect(actions).not.toHaveClass('rounded-(--radius-pill)');
    });

    test('the datastores its instances use, once each, a badge each, in the summary after the instances up', async () => {
        answer(dns);
        useEventStore.setState({objectInstanceStatus: {'system/svc/dns': {
            dev3n1: {resources: {'fs#1': {datastores: ['system/cfg/dns']}}},
            dev3n2: {resources: {'fs#1': {datastores: ['system/cfg/dns', 'system/sec/dns']}, 'volume#1': {volumes: ['system/vol/dns']}}},
        }}});
        try {
            render(<MemoryRouter><ObjectStatus path="system/svc/dns"/></MemoryRouter>);
            await screen.findByRole('table');
            const label = screen.getByText('Datastores');
            expect(label.tagName).toBe('DT');
            expect(label.previousElementSibling.previousElementSibling).toHaveTextContent('Instances up');
            expect(within(label.nextElementSibling).getAllByRole('button').map((b) => b.textContent)).toEqual(['system/cfg/dns', 'system/sec/dns']);
            // The volumes, after the datastores.
            const volumes = screen.getByText('Volumes', {selector: 'dt'});
            expect(volumes.previousElementSibling.previousElementSibling).toBe(label);
            expect(within(volumes.nextElementSibling).getAllByRole('button').map((b) => b.textContent)).toEqual(['system/vol/dns']);
        } finally {
            useEventStore.setState({objectInstanceStatus: {}});
        }
    });

    test('the status of all its instances refreshed, a node refusing said', async () => {
        answer(dns);
        useEventStore.setState({objectInstanceStatus: {'system/svc/dns': {dev3n1: {}, dev3n2: {}}}});
        const fetch = global.fetch;
        global.fetch = vi.fn((url) => Promise.resolve(url.includes('/dev3n2/')
            ? {ok: false, status: 409, json: () => Promise.resolve({detail: 'busy'}), headers: new Headers(), text: () => Promise.resolve('')}
            : {ok: true, status: 200, json: () => Promise.resolve({})}));
        try {
            render(<ObjectStatus path="system/svc/dns"/>);
            await screen.findByRole('table');
            fireEvent.click(screen.getByRole('button', {name: 'Refresh the status of all the instances'}));
            await waitFor(() => expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
                '/api/node/name/dev3n1/instance/path/system/svc/dns/action/status',
                '/api/node/name/dev3n2/instance/path/system/svc/dns/action/status',
            ]));
            expect(await screen.findByRole('alert')).toHaveTextContent(/Refresh refused: dev3n2: HTTP 409/);
        } finally {
            global.fetch = fetch;
            useEventStore.setState({objectInstanceStatus: {}});
        }
    });

    test('no issue, no issue line', async () => {
        answer(dns);
        render(<ObjectStatus path="system/svc/dns"/>);
        await screen.findByRole('table');
        expect(screen.queryByRole('list', {name: 'Issues'})).not.toBeInTheDocument();
    });

    test('the instances counted on the line of the nodes, their state under it', async () => {
        answer(dns);
        render(<ObjectStatus path="system/svc/dns"/>);
        const board = await screen.findByRole('table');
        expect(within(board).getByRole('columnheader', {name: 'Instances (2)'})).toBeInTheDocument();
        const state = within(board).getByRole('rowheader', {name: 'State'}).closest('tr');
        expect(within(state).getAllByText('down')).toHaveLength(2);
        expect(within(board).getByRole('rowheader', {name: 'Resources (6)'})).toBeInTheDocument();
        // A light border round the table, a very light line between its rows.
        expect(board.parentElement).toHaveClass('border', 'border-line');
        expect(board.parentElement).not.toHaveClass('border-0');
        expect(state).toHaveClass('border-b', 'border-line/40');
        // The headings not bold, on a grey band as the group lines of the lists, a line under each.
        for (const cell of [
            within(board).getByRole('columnheader', {name: 'Instances (2)'}),
            within(board).getByRole('rowheader', {name: 'Resources (6)'}),
        ]) {
            expect(cell).toHaveClass('font-normal');
            expect(cell.closest('tr')).toHaveClass('border-b', 'border-line', 'bg-surface-sunken');
            expect(cell.closest('tr')).not.toHaveClass('border-t');
        }
        // The nodes last, their names bold, a line before them.
        const headers = within(board).getAllByRole('columnheader');
        expect(headers.slice(1).map((h) => h.textContent)).toEqual(['Type', 'Description', 'dev3n1', 'dev3n2']);
        expect(within(headers[3]).getByText('dev3n1')).toHaveClass('font-semibold');
        expect(headers[3]).toHaveClass('border-l');
        expect(headers[4]).not.toHaveClass('border-l');
        expect(within(state).getAllByRole('cell')[2]).toHaveClass('border-l');
    });

    test('the names of the nodes and the resources are the badges given: a click opens a record, selects nothing', async () => {
        answer(dns);
        const opened = vi.fn();
        render(<ObjectStatus
            path="system/svc/dns"
            linkNode={(node) => <button type="button" onClick={() => opened('instance', node)}>{node}</button>}
            linkResource={(rid) => <button type="button" onClick={() => opened('resource', rid)}>{rid}</button>}
        />);
        await screen.findByRole('table');
        fireEvent.click(within(screen.getByRole('columnheader', {name: /dev3n2/})).getByRole('button', {name: 'dev3n2'}));
        expect(opened).toHaveBeenCalledWith('instance', 'dev3n2');
        fireEvent.click(within(screen.getByRole('rowheader', {name: /volume#1$/})).getByRole('button', {name: 'volume#1'}));
        expect(opened).toHaveBeenCalledWith('resource', 'volume#1');
        // Not selected for an action; no other button by the names.
        expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /^Open the instance on/})).not.toBeInTheDocument();
    });

    test('the value of a resource on a node opens the resource on that instance; its checkbox, apart, selects it', async () => {
        answer(dns);
        const openCell = vi.fn();
        render(<ObjectStatus path="system/svc/dns" openCell={openCell}/>);
        await screen.findByRole('table');
        const row = screen.getByRole('rowheader', {name: /volume#1$/}).closest('tr');
        const open = within(within(row).getAllByRole('cell')[3]).getByRole('button', {name: 'Open volume#1 on dev3n2'});
        // Drawn as the badges of the names: clickable at a glance, not on hover alone.
        expect(open).toHaveClass('rounded-full', 'border', 'border-line', 'cursor-pointer');
        expect(open).toHaveClass('hover:border-line-strong');
        fireEvent.click(open);
        expect(openCell).toHaveBeenCalledWith('volume#1', 'dev3n2');
        expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
        // The instances' cells open nothing.
        const state = screen.getByRole('rowheader', {name: 'State'}).closest('tr');
        expect(within(state).queryAllByRole('button', {name: /^Open/})).toHaveLength(0);
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select volume#1 on dev3n2'}));
        expect(openCell).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', {name: 'Actions on 1 resource'})).toBeInTheDocument();
    });

    test('without a way to open them given, the values of the resources are plain text', async () => {
        answer(dns);
        render(<ObjectStatus path="system/svc/dns"/>);
        await screen.findByRole('table');
        expect(screen.queryAllByRole('button', {name: /^Open /})).toHaveLength(0);
    });

    test('without badges given, the names are plain text', async () => {
        answer(dns);
        render(<ObjectStatus path="system/svc/dns"/>);
        await screen.findByRole('table');
        expect(within(screen.getByRole('columnheader', {name: /dev3n2/})).queryByRole('button')).toBeNull();
        expect(within(screen.getByRole('rowheader', {name: /volume#1$/})).queryByRole('button')).toBeNull();
    });

    test('marks the frozen nodes the cluster status names', async () => {
        answer(dns, cluster(true));
        render(<ObjectStatus path="system/svc/dns"/>);
        expect(await screen.findByRole('columnheader', {name: /dev3n1.*frozen/})).toBeInTheDocument();
        expect(screen.getByText('the daemon takes no initiative on the instances of the node')).toBeInTheDocument();
    });

    test('reads the object again when an event about it arrives', async () => {
        answer(dns);
        render(<ObjectStatus path="system/svc/dns"/>);
        await screen.findByRole('table');
        const up = structuredClone(dns);
        up.avail = 'up';
        answer(up);
        act(() => {
            useEventStore.setState((s) => ({objectStatus: {...s.objectStatus, 'system/svc/dns': {avail: 'up'}}}));
        });
        await waitFor(() => expect(screen.getByText('Avail').nextSibling).toHaveTextContent('up'));
    });

    test('says why the status could not be read', async () => {
        mockApiFetch.mockRejectedValue(new Error('403 forbidden'));
        render(<ObjectStatus path="system/svc/dns"/>);
        expect(await screen.findByText(/403 forbidden/)).toBeInTheDocument();
    });

    describe('actions', () => {
        /** The actions posted, their address and method. */
        let posted;
        beforeEach(() => {
            posted = [];
            global.fetch = vi.fn((url, options) => {
                posted.push(`${options.method} ${url}`);
                return Promise.resolve({ok: true, status: 200});
            });
        });

        const ready = async (object = dns) => {
            answer(object);
            render(<ObjectStatus path="system/svc/dns"/>);
            await screen.findByRole('table');
        };

        /** The name of a resource, its checkbox selecting it on all its nodes. */
        const name = (rid) => screen.getByRole('rowheader', {name: new RegExp(`${rid}$`)});
        /** The cell of a resource on a node, its checkbox selecting it there. */
        const cell = (rid, node) => within(name(rid).closest('tr')).getAllByRole('cell')[node === 'dev3n1' ? 2 : 3];
        /** The column header of a node, its checkbox selecting its instance. */
        const header = (node) => screen.getByRole('columnheader', {name: new RegExp(node)});
        /** The checkboxes that select: a resource on a node, on all its nodes, an instance. */
        const pickCell = (rid, node) => fireEvent.click(screen.getByRole('checkbox', {name: `Select ${rid} on ${node}`}));
        const pickRow = (rid) => fireEvent.click(screen.getByRole('checkbox', {name: `Select ${rid} on all its nodes`}));
        const pickNode = (node) => fireEvent.click(screen.getByRole('checkbox', {name: `Select the instance on ${node}`}));
        const selectionButton = () => screen.getByRole('button', {name: /^Actions on/});

        const pick = (...labels) => labels.forEach((label) => fireEvent.click(screen.getByRole('menuitem', {name: label})));
        const confirm = (action) => fireEvent.click(within(screen.getByRole('dialog', {name: new RegExp(action, 'i')})).getByRole('button', {name: 'Confirm'}));

        test('the object starts, confirmed first, where the orchestration decides', async () => {
            await ready();
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            pick('Start');
            expect(posted).toEqual([]);
            confirm('start');
            await waitFor(() => expect(posted).toEqual(['POST /api/object/path/system/svc/dns/action/start']));
            // What comes of it, the actions tray says: no message on the board.
            expect(screen.queryByText(/requested/)).not.toBeInTheDocument();
        });

        test('no abort in the menu: the orchestration in progress offers it, with its logs, by its global expect', async () => {
            const onLogs = vi.fn();
            act(() => useEventStore.setState({instanceMonitor: {
                'dev3n1:system/svc/dns': {global_expect: 'none'},
                'dev3n2:system/svc/dns': {global_expect: 'stopped', orchestration_id: 'o-42'},
            }}));
            answer(dns);
            render(<ObjectStatus path="system/svc/dns" onOrchestrationLogs={onLogs}/>);
            await screen.findByRole('table');
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            expect(screen.queryByRole('menuitem', {name: 'Abort'})).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));

            const badge = screen.getByRole('button', {name: 'Orchestration in progress: stopped'});
            fireEvent.click(badge);
            pick('Logs');
            expect(onLogs).toHaveBeenCalledWith('o-42');
            fireEvent.click(badge);
            pick('Abort');
            confirm('abort');
            await waitFor(() => expect(posted).toEqual(['POST /api/object/path/system/svc/dns/action/abort']));

            // Done, the badge goes.
            act(() => useEventStore.setState({instanceMonitor: {}}));
            expect(screen.queryByRole('button', {name: /Orchestration in progress/})).not.toBeInTheDocument();
        });

        test('no abort in the menu: the orchestration in progress offers it, with its logs, by its global expect', async () => {
            const onLogs = vi.fn();
            act(() => useEventStore.setState({instanceMonitor: {
                'dev3n1:system/svc/dns': {global_expect: 'none'},
                'dev3n2:system/svc/dns': {global_expect: 'stopped', orchestration_id: 'o-42'},
            }}));
            answer(dns);
            render(<ObjectStatus path="system/svc/dns" onOrchestrationLogs={onLogs}/>);
            await screen.findByRole('table');
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            expect(screen.queryByRole('menuitem', {name: 'Abort'})).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', {name: 'Actions'}));

            const badge = screen.getByRole('button', {name: 'Orchestration in progress: stopped'});
            fireEvent.click(badge);
            pick('Logs');
            expect(onLogs).toHaveBeenCalledWith('o-42');
            fireEvent.click(badge);
            pick('Abort');
            confirm('abort');
            await waitFor(() => expect(posted).toEqual(['POST /api/object/path/system/svc/dns/action/abort']));

            // Done, the badge goes.
            act(() => useEventStore.setState({instanceMonitor: {}}));
            expect(screen.queryByRole('button', {name: /Orchestration in progress/})).not.toBeInTheDocument();
        });

        test('nothing selected, no action button: the help says how to select', async () => {
            await ready();
            const help = /Check resources or instances to select them/;
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
            expect(screen.getByText(help)).toBeInTheDocument();
            // The help and the buttons share a row as high as the buttons: the table does not move.
            const bar = screen.getByText(help).parentElement;
            expect(bar).toHaveClass('min-h-7');
            // The checkboxes light, until a cell is hovered.
            for (const box of screen.getAllByRole('checkbox')) expect(box).toHaveClass('opacity-30', 'group-hover:opacity-100');

            pickCell('volume#1', 'dev3n1');
            expect(selectionButton()).toBeInTheDocument();
            expect(screen.queryByText(help)).not.toBeInTheDocument();
            expect(selectionButton().closest('.min-h-7')).toBe(bar);
            // Unselected, the button goes, and the help comes back.
            pickCell('volume#1', 'dev3n1');
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
            expect(screen.getByText(help)).toBeInTheDocument();
        });

        test('the values of the instances in line with those of the resources: the room of a checkbox before them', async () => {
            await ready();
            const row = (label) => screen.getByRole('rowheader', {name: label}).closest('tr');
            for (const label of ['State', 'Monitor']) {
                const room = within(row(label)).getAllByRole('cell')[2].querySelector('[data-checkbox-room]');
                // First, before the value.
                expect(room.parentElement.firstElementChild).toBe(room);
                expect(room).toHaveClass('w-3.5', 'h-3.5');
            }
            // A resource cell, its checkbox of the same width.
            expect(screen.getByRole('checkbox', {name: 'Select volume#1 on dev3n1'})).toHaveClass('w-3.5', 'h-3.5');
        });

        test('a checkbox selects, shown on hover of its cell, kept shown once checked; a click on the cell selects nothing', async () => {
            await ready();
            for (const holder of [cell('container#janitor', 'dev3n1'), name('container#janitor'), header('dev3n1')]) {
                expect(holder).toHaveClass('group');
                expect(holder).not.toHaveClass('cursor-pointer');
            }
            fireEvent.click(cell('container#janitor', 'dev3n1'));
            fireEvent.click(name('container#janitor'));
            fireEvent.click(header('dev3n1'));
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
            pickCell('container#janitor', 'dev3n1');
            const box = screen.getByRole('checkbox', {name: 'Select container#janitor on dev3n1'});
            expect(box).not.toHaveClass('opacity-30');
            // Partly selected, the box of the name stays shown too.
            expect(screen.getByRole('checkbox', {name: 'Select container#janitor on all its nodes'})).not.toHaveClass('opacity-30');
            // The type and the description select nothing: no checkbox.
            expect(within(name('container#janitor').closest('tr').querySelectorAll('td')[0]).queryByRole('checkbox')).toBeNull();
        });

        test('a cell selects its resource on its node only, tinted and edged', async () => {
            await ready();
            pickCell('container#janitor', 'dev3n2');
            expect(cell('container#janitor', 'dev3n2')).toHaveClass('bg-accent-soft');
            expect(cell('container#janitor', 'dev3n1')).not.toHaveClass('bg-accent-soft');
            // The tint and the edge tell it: no check mark.
            expect(cell('container#janitor', 'dev3n2').style.boxShadow).toMatch(/inset/);
            expect(cell('container#janitor', 'dev3n2').querySelector('svg.text-accent')).toBeNull();
            expect(screen.getByRole('checkbox', {name: 'Select container#janitor on dev3n2'})).toBeChecked();
            expect(screen.getByRole('checkbox', {name: 'Select container#janitor on dev3n1'})).not.toBeChecked();
            // The name says the resource is partly selected: its checkbox mixed.
            expect(screen.getByRole('checkbox', {name: 'Select container#janitor on all its nodes'})).toHaveProperty('indeterminate', true);
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 resource');
            fireEvent.click(selectionButton());
            pick('Restart');
            expect(screen.getByRole('dialog', {name: /restart/i})).toHaveTextContent('container#janitor of system/svc/dns on dev3n2');
            confirm('restart');
            await waitFor(() => expect(posted).toEqual([
                'POST /api/node/name/dev3n2/instance/path/system/svc/dns/action/restart?rid=container%23janitor',
            ]));
        });

        test('a name selects its resource on all its nodes, a second click unselects it', async () => {
            await ready();
            pickRow('container#janitor');
            expect(cell('container#janitor', 'dev3n1')).toHaveClass('bg-accent-soft');
            expect(cell('container#janitor', 'dev3n2')).toHaveClass('bg-accent-soft');
            expect(screen.getByRole('checkbox', {name: 'Select container#janitor on all its nodes'})).toBeChecked();
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 resource');
            // Its cells, side by side, make one block, edged outside only; the name, apart
            // from them past the type and the description, a block of its own.
            const edges = (el) => el.style.boxShadow;
            expect(edges(cell('container#janitor', 'dev3n1'))).toMatch(/inset 1px 0 0/);
            expect(edges(cell('container#janitor', 'dev3n1'))).not.toMatch(/inset -1px 0 0/);
            expect(edges(cell('container#janitor', 'dev3n1'))).toMatch(/inset 0 1px 0/);
            expect(edges(cell('container#janitor', 'dev3n2'))).toMatch(/inset -1px 0 0/);
            expect(edges(cell('container#janitor', 'dev3n2'))).not.toMatch(/inset 1px 0 0/);
            expect(edges(name('container#janitor'))).toMatch(/inset 1px 0 0/);
            expect(edges(name('container#janitor'))).toMatch(/inset -1px 0 0/);
            pickRow('container#janitor');
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
            // Partly selected, a click selects the rest.
            pickCell('container#janitor', 'dev3n1');
            pickRow('container#janitor');
            expect(screen.getByRole('checkbox', {name: 'Select container#janitor on all its nodes'})).toBeChecked();
        });

        test('the hidden checkboxes select from the keyboard', async () => {
            await ready();
            fireEvent.click(screen.getByRole('checkbox', {name: 'Select volume#1 on dev3n1'}));
            expect(cell('volume#1', 'dev3n1')).toHaveClass('bg-accent-soft');
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 resource');
            fireEvent.click(screen.getByRole('checkbox', {name: 'Select the instance on dev3n2'}));
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 instance');
        });

        test('instances or resources: picking one kind drops the other', async () => {
            await ready();
            pickCell('volume#1', 'dev3n2');
            pickNode('dev3n1');
            expect(cell('volume#1', 'dev3n2')).not.toHaveClass('bg-accent-soft');
            expect(header('dev3n1')).toHaveClass('bg-accent-soft');
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 instance');
            // Unselecting an instance drops the resources too: none are left to drop.
            pickRow('volume#1');
            expect(header('dev3n1')).not.toHaveClass('bg-accent-soft');
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 resource');
            pickNode('dev3n1');
            pickNode('dev3n1');
            expect(screen.getByRole('checkbox', {name: 'Select volume#1 on all its nodes'})).not.toBeChecked();
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
        });

        test('the selection is cleared by a button', async () => {
            await ready();
            pickCell('volume#1', 'dev3n2');
            const clear = screen.getByRole('button', {name: 'Clear the selection'});
            expect(clear).toHaveClass('border');
            expect(clear.querySelector('svg')).not.toBeNull();
            fireEvent.click(clear);
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
        });

        test('the resources picked run together, each node given the ones picked on it', async () => {
            await ready();
            pickRow('container#janitor');
            pickCell('container#server', 'dev3n1');
            fireEvent.click(selectionButton());
            // A console is for one resource: not among the actions of several.
            expect(screen.queryByRole('menuitem', {name: 'Console'})).not.toBeInTheDocument();
            pick('Restart');
            expect(screen.getByRole('dialog', {name: /restart/i})).toHaveTextContent(
                'container#janitor on all nodes, container#server on dev3n1 of system/svc/dns',
            );
            confirm('restart');
            await waitFor(() => expect(posted).toEqual([
                'POST /api/node/name/dev3n1/instance/path/system/svc/dns/action/restart?rid=container%23janitor%2Ccontainer%23server',
                'POST /api/node/name/dev3n2/instance/path/system/svc/dns/action/restart?rid=container%23janitor',
            ]));
            // Done, the selection is cleared, and the button with it.
            await waitFor(() => expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument());
        });

        test('instances alone: the instance actions, a failed one cleared first', async () => {
            await ready();
            pickNode('dev3n1');
            pickNode('dev3n2');
            expect(selectionButton()).toHaveAccessibleName('Actions on 2 instances');
            fireEvent.click(selectionButton());
            expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent('Clear');
            pick('Start');
            expect(screen.getByRole('dialog', {name: /start/i})).toHaveTextContent('system/svc/dns on all nodes');
            confirm('start');
            await waitFor(() => expect(posted).toEqual([
                'POST /api/node/name/dev3n1/instance/path/system/svc/dns/action/start',
                'POST /api/node/name/dev3n2/instance/path/system/svc/dns/action/start',
            ]));
        });

        test('an instance selected by the checkbox of its node: its column one block; a click on its cells selects nothing', async () => {
            await ready();
            const row = (label) => screen.getByRole('rowheader', {name: label}).closest('tr');
            const monitor = within(row('Monitor')).getAllByRole('cell')[3];
            // The state, right under the header, in the middle of the block.
            const state = within(row('State')).getAllByRole('cell')[3];
            fireEvent.click(monitor);
            fireEvent.click(state);
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
            pickNode('dev3n2');
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 instance');
            expect(header('dev3n2')).toHaveClass('bg-accent-soft');
            expect(state).toHaveClass('bg-accent-soft');
            expect(monitor).toHaveClass('bg-accent-soft');
            // One block from the header to the last row of the instances: edged on its outside only.
            expect(header('dev3n2').style.boxShadow).not.toMatch(/inset 0 -1px 0/);
            expect(state.style.boxShadow).not.toMatch(/inset 0 (-)?1px 0/);
            expect(monitor.style.boxShadow).toMatch(/inset 0 -1px 0/);
            expect(monitor.style.boxShadow).not.toMatch(/inset 0 1px 0/);
            // The first resource, under the block, is not part of it.
            expect(cell('volume#1', 'dev3n2')).not.toHaveClass('bg-accent-soft');
            pickNode('dev3n2');
            expect(screen.queryByRole('button', {name: /^Actions on/})).not.toBeInTheDocument();
        });

        test('a node of the scope with no instance reported selects its instance too', async () => {
            const wider = structuredClone(dns);
            wider.scope = [...wider.scope, 'dev3n3'];
            await ready(wider);
            pickNode('dev3n3');
            expect(selectionButton()).toHaveAccessibleName('Actions on 1 instance');
            expect(header('dev3n3')).toHaveClass('bg-accent-soft');
            fireEvent.click(selectionButton());
            pick('Start');
            confirm('start');
            await waitFor(() => expect(posted).toEqual(['POST /api/node/name/dev3n3/instance/path/system/svc/dns/action/start']));
        });

        test('a node of the scope that reports nothing shows a red "?", as om status draws it', async () => {
            const wider = structuredClone(dns);
            wider.scope = [...wider.scope, 'dev3n3'];
            await ready(wider);
            const unknown = document.querySelectorAll('[data-state="unknown"]');
            expect(unknown).toHaveLength(1);
            expect(unknown[0]).toHaveTextContent('?');
            expect(unknown[0]).toHaveClass('text-state-down');
        });

        test('a failed instance is cleared, for the orchestration to try again', async () => {
            await ready();
            pickNode('dev3n1');
            fireEvent.click(selectionButton());
            pick('Clear');
            confirm('clear');
            await waitFor(() => expect(posted).toEqual(['POST /api/node/name/dev3n1/instance/path/system/svc/dns/clear']));
        });

        test('an instance not failed has nothing to clear, and freezes', async () => {
            const idle = structuredClone(dns);
            idle.instances.dev3n2.monitor.state = 'idle';
            await ready(idle);
            pickNode('dev3n2');
            fireEvent.click(selectionButton());
            expect(screen.queryByRole('menuitem', {name: 'Clear'})).not.toBeInTheDocument();
            expect(screen.getByRole('menuitem', {name: 'Freeze'})).toBeInTheDocument();
            expect(screen.queryByRole('menuitem', {name: 'Unfreeze'})).not.toBeInTheDocument();
        });

        test('a container on one node opens a console; a volume has none', async () => {
            await ready();
            pickCell('container#server', 'dev3n1');
            fireEvent.click(selectionButton());
            pick('Console');
            expect(screen.getByTestId('console')).toHaveTextContent('container#server on dev3n1');
            expect(posted).toEqual([]);
            fireEvent.click(screen.getByRole('button', {name: 'Clear the selection'}));
            pickCell('volume#1', 'dev3n1');
            fireEvent.click(selectionButton());
            expect(screen.queryByRole('menuitem', {name: 'Console'})).not.toBeInTheDocument();
        });

        describe('the cluster object', () => {
            const readyCluster = async (clusterStatus) => {
                answer(dns, clusterStatus);
                render(<ObjectStatus path="cluster"/>);
                await screen.findByRole('table');
                fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
            };

            test('is frozen as the cluster, on all its nodes, confirmed first', async () => {
                await readyCluster(cluster(false));
                expect(screen.getByRole('menuitem', {name: 'Start'})).toBeDisabled();
                expect(screen.getByRole('menuitem', {name: 'Delete'})).toBeDisabled();
                expect(screen.getByRole('menuitem', {name: 'Unfreeze'})).toBeDisabled();
                pick('Freeze');
                const dialog = screen.getByRole('dialog', {name: /freeze/i});
                fireEvent.click(within(dialog).getByRole('checkbox'));
                fireEvent.click(within(dialog).getByRole('button', {name: 'Confirm freeze action'}));
                await waitFor(() => expect(posted).toEqual(['POST /api/cluster/action/freeze']));
                expect(screen.queryByText(/requested/)).not.toBeInTheDocument();
            });

            test('a node picked is frozen as a node, not as an instance of the cluster object', async () => {
                answer(dns, cluster(true));
                useEventStore.setState({objectInstanceStatus: {cluster: {dev3n1: {}, dev3n2: {}}}});
                render(<ObjectStatus path="cluster"/>);
                await screen.findByRole('table');
                // No status of its own to refresh.
                expect(screen.queryByRole('button', {name: /Refresh the status/})).toBeNull();
                useEventStore.setState({objectInstanceStatus: {}});
                pickNode('dev3n2');
                fireEvent.click(selectionButton());
                // dev3n2 is not frozen: nothing to unfreeze, and no service action.
                expect(screen.queryByRole('menuitem', {name: 'Unfreeze'})).not.toBeInTheDocument();
                expect(screen.queryByRole('menuitem', {name: 'Start'})).not.toBeInTheDocument();
                pick('Freeze');
                const dialog = screen.getByRole('dialog', {name: /freeze/i});
                fireEvent.click(within(dialog).getByRole('checkbox'));
                fireEvent.click(within(dialog).getByRole('button', {name: 'Confirm freeze action'}));
                await waitFor(() => expect(posted).toEqual(['POST /api/node/name/dev3n2/action/freeze']));
                expect(screen.queryByText(/requested/)).not.toBeInTheDocument();
            });

            test('the board follows the freeze of the nodes', async () => {
                answer(dns, cluster(false));
                render(<ObjectStatus path="cluster"/>);
                await screen.findByRole('table');
                expect(mockRetain).toHaveBeenCalledWith('tok', ['NodeStatusUpdated']);
                const reads = mockApiFetch.mock.calls.length;
                act(() => useEventStore.setState({nodeStatus: {dev3n1: {frozen_at: '2026-10-14T08:00:00Z'}}}));
                await waitFor(() => expect(mockApiFetch.mock.calls.length).toBeGreaterThan(reads));
                act(() => useEventStore.setState({nodeStatus: {}}));
            });

            test('a node frozen, the cluster unfreezes, and freezes the others', async () => {
                await readyCluster(cluster(true));
                expect(screen.getByRole('menuitem', {name: 'Freeze'})).toBeEnabled();
                expect(screen.getByRole('menuitem', {name: 'Unfreeze'})).toBeEnabled();
                pick('Unfreeze');
                confirm('unfreeze');
                await waitFor(() => expect(posted).toEqual(['POST /api/cluster/action/unfreeze']));
            });
        });

        test('says in the actions tray which node refused the action, and why', async () => {
            await ready();
            global.fetch = vi.fn((url) => Promise.resolve(url.includes('dev3n2')
                ? {ok: false, status: 403, detail: 'forbidden'}
                : {ok: true, status: 200}));
            pickRow('container#janitor');
            fireEvent.click(selectionButton());
            pick('Start');
            confirm('start');
            await waitFor(() => expect(tray()).toHaveLength(2));
            expect(tray()).toEqual(expect.arrayContaining([
                ['start', 'container#janitor of system/svc/dns on dev3n1', 'succeeded', null],
                ['start', 'container#janitor of system/svc/dns on dev3n2', 'refused', 'HTTP 403 forbidden'],
            ]));
        });
    });

    describe('notes on hover', () => {
        test('a cell says what it shows, then the notes of its resource on its node', async () => {
            answer(dns);
            render(<ObjectStatus path="system/svc/dns"/>);
            await screen.findByRole('table');
            const cell = within(screen.getByRole('rowheader', {name: /volume#1$/}).closest('tr')).getAllByRole('cell')[2];
            const target = cell.querySelector(':scope > span');
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
            fireEvent.mouseOver(target);
            expect(screen.getByRole('tooltip')).toHaveTextContent('Status: down');
            expect(screen.getByRole('tooltip')).toHaveTextContent('system/vol/dns avail down');
            fireEvent.mouseOut(target);
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
            // A cell with nothing to explain, and no note: a monitor state.
            fireEvent.mouseOver(within(screen.getByRole('rowheader', {name: 'Monitor'}).closest('tr')).getAllByText('start failed')[0]);
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });

        test('an instance cell shows the notes about the instance of its node', async () => {
            answer(dns);
            render(<ObjectStatus path="system/svc/dns"/>);
            await screen.findByRole('table');
            const cell = within(screen.getByRole('rowheader', {name: 'State'}).closest('tr')).getAllByRole('cell')[3];
            fireEvent.mouseOver(cell.firstElementChild);
            expect(screen.getByRole('tooltip')).toHaveTextContent('Status: down');
            expect(screen.getByRole('tooltip')).toHaveTextContent('start failed: the orchestration gave up, clear the instance to retry');
        });

        test('a resource name shows its notes on every node', async () => {
            answer(dns);
            render(<ObjectStatus path="system/svc/dns"/>);
            await screen.findByRole('table');
            fireEvent.mouseOver(within(screen.getByRole('rowheader', {name: /volume#1$/})).getByText('volume#1'));
            expect(screen.getByRole('tooltip')).toHaveTextContent('all nodes');
            expect(screen.getByRole('tooltip')).toHaveTextContent('system/vol/dns avail down');
        });
    });
});
