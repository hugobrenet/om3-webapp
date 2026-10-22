import React from 'react';
import {fireEvent, render as renderInDom, screen, within} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import {act, waitFor} from '@testing-library/react';
import {ObjectResources, ObjectSchedules} from '../ObjectTabs';
import useEventStore from '../../hooks/useEventStore.js';
import {retainEventReception} from '../../eventSourceManager.jsx';

vi.mock('../../eventSourceManager.jsx', async (importOriginal) => ({
    ...(await importOriginal()),
    retainEventReception: vi.fn(() => vi.fn()),
}));

const Search = () => <span data-testid="search">{useLocation().search}</span>;
/** Rendered in a router: its badges open their records over the view. */
const render = (ui) => renderInDom(<MemoryRouter>{ui}<Search/></MemoryRouter>);

const NEVER = '0001-01-01T00:00:00Z';

const schedule = (node, action, extra = {}) => ({
    kind: 'ScheduleItem',
    meta: {node, object: 'ns1/svc/web'},
    data: {
        action,
        key: `${action}_schedule`,
        schedule: '@60',
        max_parallel: 1,
        last_run_at: NEVER,
        next_run_at: NEVER,
        require: '',
        require_collector: false,
        require_provisioned: false,
        ...extra,
    },
});

const info = (node, rid, key, value) => ({node, object: 'ns1/svc/web', rid, key, value});

/** The daemon answers `body` to any read, and the address read is kept. */
let read;
const answer = (body, {ok = true, status = 200} = {}) => {
    read = [];
    global.fetch = vi.fn((url, options) => {
        read.push({url, options});
        return Promise.resolve({
            ok,
            status,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(JSON.stringify(body)),
            headers: {get: () => 'application/json'},
        });
    });
};

describe('ObjectTabs', () => {
    beforeEach(() => {
        localStorage.setItem('authToken', 'tok');
    });

    afterEach(() => {
        localStorage.clear();
    });

    describe('schedules', () => {
        test('reads the schedules of all the instances, by task then by node', async () => {
            answer({
                kind: 'ScheduleList',
                items: [
                    schedule('n2', 'status'),
                    schedule('n1', 'sync_all', {schedule: '', require_provisioned: true}),
                    schedule('n1', 'status'),
                ],
            });
            render(<ObjectSchedules path="ns1/svc/web"/>);
            const table = await screen.findByRole('table', {name: 'Schedules'});
            expect(read[0].url).toBe('/api/object/path/ns1/svc/web/schedule');
            expect(read[0].options.headers).toEqual({Authorization: 'Bearer tok'});
            const rows = within(table).getAllByRole('row').slice(1);
            expect(rows.map((r) => within(r).getAllByRole('cell').slice(0, 2).map((c) => c.textContent)))
                .toEqual([['status', 'on n1'], ['status', 'on n2'], ['sync_all', 'on n1']]);
            expect(rows[2]).toHaveTextContent('not scheduled');
            expect(rows[2]).toHaveTextContent('provisioned');
        });

        test('a root service is read by its full path', async () => {
            answer({kind: 'ScheduleList', items: []});
            render(<ObjectSchedules path="web"/>);
            expect(await screen.findByText('No task scheduled')).toBeInTheDocument();
            expect(read[0].url).toBe('/api/object/path/root/svc/web/schedule');
        });

        test('a long list is filtered', async () => {
            answer({
                kind: 'ScheduleList',
                items: Array.from({length: 10}, (_, i) => schedule('n1', `task${i}`)),
            });
            render(<ObjectSchedules path="ns1/svc/web"/>);
            const table = await screen.findByRole('table', {name: 'Schedules'});
            fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the schedules'}), {target: {value: 'task7'}});
            expect(within(table).getAllByRole('row')).toHaveLength(2);
        });

        test('says why the schedules could not be read', async () => {
            answer({detail: 'forbidden'}, {ok: false, status: 403});
            render(<ObjectSchedules path="ns1/svc/web"/>);
            expect(await screen.findByText(/Could not read it/)).toBeInTheDocument();
        });
    });

    describe('resources', () => {
        const items = [
            info('n2', 'ip#0', 'ipaddr', '10.0.0.12'),
            info('n1', 'ip#0', 'ipaddr', '10.0.0.11'),
            info('n1', 'container#0', 'id', 'abc123'),
            info('n1', 'ip#0', 'netmask', '24'),
        ];

        /** The table read back: each resource, the line opening it, then its key lines. */
        const groups = () => {
            const table = screen.getByRole('table', {name: 'Resource information'});
            const out = [];
            for (const row of within(table).getAllByRole('row').slice(1)) {
                if (row.hasAttribute('data-resource-row')) out.push([row.textContent, []]);
                else out.at(-1)[1].push(within(row).getAllByRole('cell').map((c) => c.textContent).join(' '));
            }
            return out;
        };

        test('one plain table, a line per key, a column per node, a line opening each resource', async () => {
            answer({kind: 'ResourceInfoList', items});
            render(<ObjectResources path="ns1/svc/web"/>);
            const table = await screen.findByRole('table', {name: 'Resource information'});
            expect(read[0].url).toBe('/api/object/path/ns1/svc/web/resource/info');
            expect(screen.getAllByRole('table')).toHaveLength(1);
            expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Key', 'on n1', 'on n2']);
            // The resources in order, a key a node does not report marked missing there.
            expect(groups()).toEqual([
                ['container#0', ['id abc123 –']],
                ['ip#0', ['ipaddr 10.0.0.11 10.0.0.12', 'netmask 24 –']],
            ]);
            // The line of a resource across the row.
            const line = within(table).getByRole('rowheader', {name: 'ip#0'});
            expect(line).toHaveAttribute('colspan', '3');
            // The resource and the nodes, badges opening the resource and its instances.
            fireEvent.click(within(line).getByRole('button', {name: 'ip#0'}));
            expect(screen.getByTestId('search')).toHaveTextContent('peek=resource%3Ans1%2Fsvc%2Fweb%3Aip%230');
            fireEvent.click(within(table).getByRole('button', {name: 'on n2'}));
            expect(screen.getByTestId('search')).toHaveTextContent('peek=instance%3Ans1%2Fsvc%2Fweb%40n2');
        });

        test('a node or a resource alone: its columns or its lines only, the filter kept', async () => {
            answer({kind: 'ResourceInfoList', items});
            const {unmount} = render(<ObjectResources path="ns1/svc/web" node="n1"/>);
            await screen.findByRole('table', {name: 'Resource information'});
            expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Key', 'on n1']);
            expect(groups().map(([rid]) => rid)).toEqual(['container#0', 'ip#0']);
            unmount();
            render(<ObjectResources path="ns1/svc/web" rid="ip#0"/>);
            await screen.findByRole('table', {name: 'Resource information'});
            expect(groups()).toEqual([['ip#0', ['ipaddr 10.0.0.11 10.0.0.12', 'netmask 24 –']]]);
            expect(screen.getByRole('searchbox', {name: 'Filter the resources'})).toBeInTheDocument();
        });

        test('the filter keeps a resource by its name, or the keys and values that match', async () => {
            answer({kind: 'ResourceInfoList', items});
            render(<ObjectResources path="ns1/svc/web"/>);
            await screen.findByRole('table', {name: 'Resource information'});
            const filter = screen.getByRole('searchbox', {name: 'Filter the resources'});
            fireEvent.change(filter, {target: {value: 'container'}});
            expect(groups()).toEqual([['container#0', ['id abc123 –']]]);
            fireEvent.change(filter, {target: {value: '10.0.0.12'}});
            expect(groups()).toEqual([['ip#0', ['ipaddr 10.0.0.11 10.0.0.12']]]);
            fireEvent.change(filter, {target: {value: 'nothing'}});
            expect(screen.getByText('No resource matches the filter')).toBeInTheDocument();
        });

        test('no resource reports anything', async () => {
            answer({kind: 'ResourceInfoList', items: []});
            render(<ObjectResources path="ns1/svc/web"/>);
            expect(await screen.findByText('No resource reports information')).toBeInTheDocument();
        });

        describe('a resource deleted, which the daemon still reports from its cache', () => {
            const config = (csum, rids) => ({csum, resources: Object.fromEntries(rids.map((rid) => [rid, {}]))});

            afterEach(() => {
                act(() => useEventStore.setState({instanceConfig: {}}));
            });

            test('the configurations of the instances are carried by the stream while shown', () => {
                answer({kind: 'ResourceInfoList', items});
                const {unmount} = render(<ObjectResources path="ns1/svc/web" node="n1"/>);
                expect(retainEventReception).toHaveBeenCalledWith('tok', ['InstanceConfigUpdated'], 'ns1/svc/web');
                const release = vi.mocked(retainEventReception).mock.results.at(-1).value;
                unmount();
                expect(release).toHaveBeenCalled();
            });

            test('a resource no longer configured on its node is not shown there', async () => {
                act(() => useEventStore.setState({instanceConfig: {'ns1/svc/web': {n1: config('a', ['ip#0'])}}}));
                answer({kind: 'ResourceInfoList', items});
                render(<ObjectResources path="ns1/svc/web"/>);
                await screen.findByRole('table', {name: 'Resource information'});
                // container#0 gone from the configuration of n1; n2, not known yet, all it reports.
                expect(groups()).toEqual([
                    ['ip#0', ['ipaddr 10.0.0.11 10.0.0.12', 'netmask 24 –']],
                ]);
            });

            test('a configuration changed reads the key-values again', async () => {
                act(() => useEventStore.setState({instanceConfig: {'ns1/svc/web': {n1: config('a', ['ip#0', 'container#0'])}}}));
                answer({kind: 'ResourceInfoList', items});
                render(<ObjectResources path="ns1/svc/web" node="n1"/>);
                await screen.findByRole('table', {name: 'Resource information'});
                expect(read).toHaveLength(1);
                act(() => useEventStore.setState({instanceConfig: {'ns1/svc/web': {n1: config('b', ['ip#0'])}}}));
                await waitFor(() => expect(read).toHaveLength(2));
                await waitFor(() => expect(groups().map(([rid]) => rid)).toEqual(['ip#0']));
            });

            test('the first configuration known reads nothing again', async () => {
                answer({kind: 'ResourceInfoList', items});
                render(<ObjectResources path="ns1/svc/web" node="n1"/>);
                await screen.findByRole('table', {name: 'Resource information'});
                act(() => useEventStore.setState({instanceConfig: {'ns1/svc/web': {n1: config('a', ['ip#0', 'container#0'])}}}));
                await new Promise((r) => setTimeout(r, 50));
                expect(read).toHaveLength(1);
            });
        });
    });
});
