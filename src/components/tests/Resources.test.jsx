import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import Resources, {resourceColumns, resourceLayout, toLine} from '../Resources';
import useEventStore from '../../hooks/useEventStore.js';
import {useMenuState} from '../../hooks/useSidebarAlerts';

const {mockRetain, mockRelease} = vi.hoisted(() => ({mockRetain: vi.fn(), mockRelease: vi.fn()}));
vi.mock('../../eventSourceManager', () => ({
    retainEventReception: (...args) => {
        mockRetain(...args);
        return mockRelease;
    },
}));

// The confirmation dialogs are tested on their own: here, what is confirmed, and the action posted.
vi.mock('../ActionDialogManager', () => ({
    default: ({pendingAction, handleConfirm, target, names}) => (pendingAction === null ? null : (
        <div role="alertdialog" aria-label={`${pendingAction.action} ${target}`}>
            <ul aria-label="names">{(names ?? []).map((n) => <li key={n}>{n}</li>)}</ul>
            <button type="button" onClick={() => handleConfirm(pendingAction.action)}>Confirm</button>
        </div>
    )),
}));

/** A resource of an instance, as GET /resource lists it. */
const item = (object, node, rid, status, extra = {}) => ({
    kind: 'ResourceItem',
    meta: {object, node, rid, encap_node: extra.encap ?? ''},
    data: {
        config: {is_disabled: !!extra.disabled, is_monitored: !!extra.monitored, is_standby: false},
        ...(extra.restarts === undefined ? {} : {monitor: {restart: {remaining: extra.restarts}}}),
        status: {status, type: extra.type ?? `${rid.split('#')[0]}.x`, label: extra.label ?? '', provisioned: {state: extra.provisioned ?? 'true'}},
    },
});

const ITEMS = [
    item('ns1/svc/web', 'n1', 'fs#1', 'up', {type: 'fs.flag', label: '/srv/web'}),
    item('ns1/svc/web', 'n2', 'fs#1', 'down', {type: 'fs.flag', label: '/srv/web'}),
    item('ns1/svc/web', 'n1', 'container#1', 'up', {type: 'container.docker', monitored: true, restarts: 2}),
    item('system/svc/dns', 'n2', 'ip#0', 'warn', {type: 'ip.host', disabled: true, provisioned: 'false'}),
];

function Search() {
    return <output data-testid="search">{decodeURIComponent(useLocation().search)}</output>;
}

describe('Resources', () => {
    let answers;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.setItem('authToken', 'tok');
        localStorage.removeItem('om3.paging.resources');
        answers = [{status: 200, body: {kind: 'ResourceList', items: ITEMS}}];
        global.fetch = vi.fn(async () => {
            const answer = answers.length > 1 ? answers.shift() : answers[0];
            return new Response(JSON.stringify(answer.body), {status: answer.status});
        });
        useEventStore.setState({objectInstanceStatus: {}});
        useMenuState.setState({objects: {}});
    });

    afterEach(() => {
        localStorage.clear();
        vi.useRealTimers();
    });

    const renderView = () => render(<MemoryRouter><Resources/><Search/></MemoryRouter>);
    const table = () => screen.getByRole('table', {name: 'The resources of the cluster'});
    const rows = () => within(table()).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').slice(1).map((c) => c.textContent));

    test('a line per resource of each instance, every object read, sorted by object, node and resource', async () => {
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        // Every service and volume: a selection reaching a data object breaks the read.
        expect(global.fetch.mock.calls[0][0]).toBe('/api/resource?path=*%2Fsvc%2F*%2C*%2Fvol%2F*');
        expect(global.fetch.mock.calls[0][1].headers).toEqual({Authorization: 'Bearer tok'});
        expect(rows()).toEqual([
            ['ns1/svc/web', 'n1', 'container#1', 'container.docker', 'upup', 'monitored, 2 restarts left', ''],
            ['ns1/svc/web', 'n1', 'fs#1', 'fs.flag', 'upup', '-', '/srv/web'],
            ['ns1/svc/web', 'n2', 'fs#1', 'fs.flag', 'downdown', '-', '/srv/web'],
            ['system/svc/dns', 'n2', 'ip#0', 'ip.host', 'warnwarnnot provisioned', 'disabled', ''],
        ]);
        expect(screen.getByText('4 / 4')).toBeInTheDocument();
        // The instances' reports carried while shown.
        expect(mockRetain).toHaveBeenCalledWith('tok', ['InstanceStatusUpdated']);
    });

    test('each object, instance and resource a badge opening its record, the resource on its instance alone', async () => {
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        const line = within(table()).getAllByRole('row')[3];
        fireEvent.click(within(line).getByRole('button', {name: 'fs#1'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=resource:ns1/svc/web:fs#1@n2');
        fireEvent.click(within(line).getByRole('button', {name: 'n2'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=instance:ns1/svc/web@n2');
        fireEvent.click(within(line).getByRole('button', {name: 'ns1/svc/web'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object:ns1/svc/web');
    });

    // A value of a filter toggled in its popover, as several may be kept at once.
    const pick = (filter, value) => fireEvent.click(within(screen.getByRole('group', {name: filter})).getByRole('checkbox', {name: value}));

    test('filtered by status, node, driver and words, the count said', async () => {
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        // Each value of a popover counted, as in the rail.
        expect(within(screen.getByRole('group', {name: 'Status'})).getByRole('checkbox', {name: 'up'}).closest('span.flex')).toHaveTextContent(/up2$/);
        pick('Status', 'up');
        expect(rows().map((r) => r[2])).toEqual(['container#1', 'fs#1']);
        pick('Driver', 'fs');
        expect(rows().map((r) => `${r[1]} ${r[2]}`)).toEqual(['n1 fs#1']);
        expect(screen.getByText('1 / 4')).toBeInTheDocument();
        pick('Status', 'up');
        pick('Node', 'n2');
        expect(rows().map((r) => `${r[1]} ${r[2]}`)).toEqual(['n2 fs#1']);
        pick('Driver', 'fs');
        fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the resources'}), {target: {value: 'dns'}});
        expect(rows().map((r) => r[2])).toEqual(['ip#0']);
        fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the resources'}), {target: {value: 'nothing'}});
        expect(within(table()).getByText('No resource matches.')).toBeInTheDocument();
    });

    test('refresh stays above the expanded filters on mobile', async () => {
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn((query) => ({
            matches: query === '(max-width:899.95px)',
            addEventListener: () => {},
            removeEventListener: () => {},
        }));
        try {
            renderView();
            await waitFor(() => expect(rows()).toHaveLength(4));
            fireEvent.click(screen.getByRole('button', {name: 'Show filters'}));
            const refresh = screen.getByRole('button', {name: 'Refresh'});
            const filters = document.querySelector('[data-filter-toolbar]');
            expect(refresh.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        } finally {
            window.matchMedia = originalMatchMedia;
        }
    });

    test('wide, the filters beside the table as facets, each value counted, several kept at once; the tools at their head', async () => {
        window.matchMedia = (query) => ({matches: query.includes('1536px'), addEventListener() {}, removeEventListener() {}});
        try {
            renderView();
            await waitFor(() => expect(rows()).toHaveLength(4));
            const rail = screen.getByRole('complementary', {name: 'Filters'});
            expect(screen.queryByRole('group', {name: 'Status'})).not.toBeInTheDocument();
            const facet = (name) => within(rail).getByRole('region', {name});
            // The text of a value and its count, not that of its mark.
            const values = (name) => within(facet(name)).getAllByRole('button')
                .filter((b) => b.hasAttribute('aria-pressed'))
                .map((b) => b.textContent.slice((b.querySelector('[aria-hidden="true"]')?.textContent ?? '').length));
            expect(values('Status')).toEqual(['down1', 'up2', 'warn1']);
            expect(values('Node')).toEqual(['n12', 'n22']);
            expect(values('Driver')).toEqual(['container1', 'fs2', 'ip1']);
            fireEvent.click(within(facet('Status')).getByRole('button', {name: /^up/}));
            fireEvent.click(within(facet('Status')).getByRole('button', {name: /^warn/}));
            expect(rows().map((r) => r[2])).toEqual(['container#1', 'fs#1', 'ip#0']);
            // The other facets counted under the statuses kept.
            expect(values('Node')).toEqual(['n12', 'n21']);
            fireEvent.change(within(rail).getByLabelText('Filter the resources'), {target: {value: 'dns'}});
            expect(rows().map((r) => r[2])).toEqual(['ip#0']);
            const head = rail.querySelector('[data-rail-head]');
            expect(within(head).getByRole('button', {name: 'Refresh'})).toBeInTheDocument();
            expect(head).toHaveTextContent('1 / 4');
            expect(screen.queryByRole('navigation', {name: 'Pagination'})).not.toBeInTheDocument();
        } finally {
            delete window.matchMedia;
        }
    });

    test('select all selects every resource the filters keep; their actions, those all take, posted once per instance', async () => {
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        expect(screen.getByText('Select resources to act on them')).toBeInTheDocument();
        pick('Node', 'n1');
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select all the resources'}));
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        // A filter hiding some: they leave the selection.
        pick('Driver', 'fs');
        expect(screen.getByText('1 selected')).toBeInTheDocument();
        pick('Driver', 'fs');
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select container#1 of ns1/svc/web on n1'}));
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Actions on the resources selected'}));
        const menu = screen.getByRole('menu', {name: 'Actions on the resources selected'});
        // Two drivers: no console, of a container alone.
        expect(within(menu).queryByRole('menuitem', {name: 'Console'})).toBeNull();
        fireEvent.click(within(menu).getByRole('menuitem', {name: 'Stop'}));
        const dialog = screen.getByRole('alertdialog', {name: 'stop 2 resources, on 1 instance'});
        expect(within(within(dialog).getByRole('list', {name: 'names'})).getAllByRole('listitem').map((li) => li.textContent))
            .toEqual(['ns1/svc/web@n1 container#1', 'ns1/svc/web@n1 fs#1']);
        fireEvent.click(within(dialog).getByRole('button', {name: 'Confirm'}));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/api/node/name/n1/instance/path/ns1/svc/web/action/stop?rid=container%231%2Cfs%231',
            expect.objectContaining({method: 'POST'}),
        ));
        // Done: the selection cleared.
        await waitFor(() => expect(screen.getByText('Select resources to act on them')).toBeInTheDocument());
    });

    test('cleared from the actions; unticked, select all selects none', async () => {
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        const all = () => screen.getByRole('checkbox', {name: 'Select all the resources'});
        fireEvent.click(all());
        expect(screen.getByText('4 selected')).toBeInTheDocument();
        expect(all()).toBeChecked();
        fireEvent.click(screen.getByRole('button', {name: 'Clear'}));
        expect(all()).not.toBeChecked();
        fireEvent.click(all());
        fireEvent.click(all());
        expect(screen.getByText('Select resources to act on them')).toBeInTheDocument();
    });

    test('sorted by a column, then the other way', async () => {
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        fireEvent.click(within(table()).getByRole('button', {name: /^Status/}));
        expect(rows().map((r) => r[4].replace(/not provisioned/, ''))).toEqual(['downdown', 'upup', 'upup', 'warnwarn']);
        fireEvent.click(within(table()).getByRole('button', {name: /^Status/}));
        expect(rows()[0][4]).toMatch(/^warn/);
    });

    test('read again once the instances report, a burst read once', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        answers = [{status: 200, body: {kind: 'ResourceList', items: ITEMS.slice(0, 1)}}];
        act(() => useEventStore.setState({objectInstanceStatus: {'ns1/svc/web': {n1: {avail: 'up'}}}}));
        act(() => useEventStore.setState({objectInstanceStatus: {'ns1/svc/web': {n1: {avail: 'down'}}}}));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2500);
        });
        await waitFor(() => expect(rows()).toHaveLength(1));
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('not read: said, read again on demand', async () => {
        answers = [{status: 500, body: {detail: 'boom'}}, {status: 200, body: {kind: 'ResourceList', items: ITEMS}}];
        renderView();
        expect(await screen.findByText('The resources could not be read: boom')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
        await waitFor(() => expect(rows()).toHaveLength(4));
        expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
    });

    test('a resource of an encapsulated node: shown on that node, opened on its host', () => {
        const line = toLine(item('ns1/svc/web', 'n1', 'app#1', 'up', {encap: 'c1'}));
        expect([line.node, line.hostNode]).toEqual(['c1', 'n1']);
    });

    test('down on the passive node of an object up elsewhere: gray, said passive; Problems only keeps the others down and those in warn', async () => {
        // web up on n1, its instance on n2 down, as a failover service waits there.
        // The objects as the menu has them; the instances not reported yet: the object up is enough.
        useMenuState.setState({objects: {'ns1/svc/web': {avail: 'up'}, 'system/svc/dns': {avail: 'warn'}}});
        renderView();
        await waitFor(() => expect(rows()).toHaveLength(4));
        const passive = within(table()).getAllByRole('row').find((r) => r.textContent.includes('n2') && r.textContent.includes('fs#1'));
        expect(passive).toHaveTextContent('down· passive');
        expect(passive.querySelector('[data-muted]')).not.toBeNull();
        // Down on n1, its object up: still a problem, not gray.
        fireEvent.click(screen.getByRole('checkbox', {name: 'Problems only'}));
        expect(rows().map((r) => `${r[0]} ${r[1]} ${r[2]}`)).toEqual(['system/svc/dns n2 ip#0']);
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('problems=1'));
        // The instance on n2 reporting up, its object's active one: its resource down a problem again.
        act(() => useEventStore.setState({objectInstanceStatus: {'ns1/svc/web': {n2: {avail: 'up'}}}}));
        await waitFor(() => expect(rows().map((r) => `${r[1]} ${r[2]}`)).toEqual(['n2 fs#1', 'n2 ip#0']));
    });

    test('filtered from the address, as the cluster overview links it; the filters written back to it', async () => {
        render(<MemoryRouter initialEntries={['/resources?status=up,warn&node=n1']}><Resources/><Search/></MemoryRouter>);
        await waitFor(() => expect(rows()).toHaveLength(2));
        expect(rows().map((r) => `${r[1]} ${r[2]}`)).toEqual(['n1 container#1', 'n1 fs#1']);
        pick('Node', 'n1');
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(/^\?status=up,warn$/));
        expect(rows()).toHaveLength(3);
    });

    describe('scaled down to its room', () => {
        const headers = () => within(table()).getAllByRole('columnheader').slice(1).map((h) => h.textContent.replace(/[▲▼]/g, '').trim());

        test('the whole table, then a step at a time: the flags, the label, the type a badge by the resource, the node a badge by the object', () => {
            const keys = (step) => resourceColumns(resourceLayout(step)).map((c) => c.key);
            expect(keys(0)).toEqual(['object', 'node', 'rid', 'type', 'status', 'flags', 'label']);
            expect(keys(1)).toEqual(['object', 'node', 'rid', 'type', 'status', 'label']);
            expect(keys(2)).toEqual(['object', 'node', 'rid', 'type', 'status']);
            expect(keys(3)).toEqual(['object', 'node', 'rid', 'status']);
            expect(keys(4)).toEqual(['object', 'rid', 'status']);
        });

        test('while the table overflows its frame, down to the last step: the type a badge by the resource, the node by the object', async () => {
            const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2000);
            const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
            try {
                renderView();
                await waitFor(() => expect(rows()).toHaveLength(4));
                expect(headers()).toEqual(['Object', 'Resource', 'Status']);
                expect(rows()[0]).toEqual(['ns1/svc/webn1', 'container#1container.docker', 'upup']);
                // The node, by the object, still opens the instance.
                fireEvent.click(within(within(table()).getAllByRole('row')[3]).getByRole('button', {name: 'n2'}));
                expect(screen.getByTestId('search')).toHaveTextContent('peek=instance:ns1/svc/web@n2');
            } finally {
                scroll.mockRestore();
                client.mockRestore();
            }
        });

        test('room enough, the whole table', async () => {
            renderView();
            await waitFor(() => expect(rows()).toHaveLength(4));
            expect(headers()).toEqual(['Object', 'Node', 'Resource', 'Type', 'Status', 'Flags', 'Label']);
        });
    });
});
