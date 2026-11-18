import React from 'react';
import {act, render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {StoreConfig, StoreOverview, StoreSnapshots} from '../StorePanel';
import {StoreWizard} from '../StoreWizard';
import KEYWORDS from '../../app/tests/store-keywords.fixture.json';

// The grants of the user: root edits a store of the cluster configuration.
const mockGrants = vi.hoisted(() => ({value: {}}));
vi.mock('../../hooks/useGrants', () => ({useGrants: () => mockGrants.value}));

// The changes the views read again on, counted here: a test makes them go up.
const mockLive = vi.hoisted(() => ({counts: {pool: 0, cluster: 0, poll: {}}, listeners: new Set()}));
const bump = (change) => act(() => {
    change(mockLive.counts);
    mockLive.listeners.forEach((listener) => listener());
});
vi.mock('../../hooks/useLiveChanges', async (importOriginal) => {
    const {useSyncExternalStore} = await import('react');
    const subscribe = (listener) => {
        mockLive.listeners.add(listener);
        return () => mockLive.listeners.delete(listener);
    };
    const use = (read) => useSyncExternalStore(subscribe, () => read(mockLive.counts));
    return {
        ...(await importOriginal()),
        usePoolChanges: () => use((c) => c.pool),
        useClusterConfigChanges: () => use((c) => c.cluster),
        usePollTicks: (ms) => use((c) => c.poll[ms] ?? 0),
    };
});
vi.mock('../ConfigText', () => ({
    ConfigText: ({text, label}) => <pre aria-label={label}>{text}</pre>,
}));

const Location = () => <div data-testid="search">{useLocation().search}</div>;
const renderIn = (ui) => render(<MemoryRouter initialEntries={['/stores']}>{ui}<Location/></MemoryRouter>);

const FILE = `[store#tar1]
type = tar
url = /var/tmp/om-store-tar1
keep = 7d
`;
const GiB = 2 ** 30;
const node = (runs, objects, free, last) => ({
    runs, incomplete: 0, protected: 0, objects, logical_bytes: 0, free_bytes: free, clusters: [],
    ...(last ? {last_created_at: last} : {}), updated_at: '2026-10-23T19:50:16Z',
});
const STORES = [
    {
        ref: 'tar1', type: 'tar', url: '/var/tmp/om-store-tar1', share: ['*'],
        stats: {
            runs: 3, incomplete: 1, protected: 1, objects: 2, logical_bytes: 5 * GiB, first_created_at: '2026-10-19T10:00:00Z',
            last_created_at: '2026-10-21T10:00:00Z', checked_at: '2026-10-23T19:50:16Z', updated_at: '2026-10-23T19:50:16Z',
            clusters: [{cluster_id: 'c1', cluster_name: 'dev2', runs: 3, objects: 2, protected: 1, incomplete: 1, logical_bytes: 5 * GiB}],
        },
        node_stats: {n1: node(2, 1, 12 * GiB, '2026-10-21T10:00:00Z'), n2: node(1, 1, 10 * GiB, '2026-10-19T10:00:00Z')},
    },
    {
        ref: 'from test/sec/stores store#tar2', type: 'tar', url: 'sftp://backup@n1:2222/data', share: ['tbk', 'test'],
        stats: {
            runs: 11, incomplete: 0, protected: 0, objects: 6, logical_bytes: 0, free_bytes: 13 * GiB, check_error: 'connection refused',
            checked_at: '2026-10-23T18:00:00Z', updated_at: '2026-10-23T19:50:16Z',
            clusters: [
                {cluster_id: 'c1', cluster_name: 'dev2', runs: 8, objects: 4, protected: 0, incomplete: 0, logical_bytes: 0},
                {cluster_id: 'c2', cluster_name: 'drp', runs: 3, objects: 2, protected: 0, incomplete: 0, logical_bytes: 0},
            ],
        },
    },
];
const OBJECTS = [
    {cluster_id: 'c1', cluster_name: 'dev2', object_id: 'o1', path: 'tbackup', runs: 2, incomplete: 1, protected: 1, nodes: ['n1', 'n2'],
     last_created_at: '2026-10-21T10:00:00Z', logical_bytes: 3 * GiB, updated_at: '2026-10-23T19:50:16Z'},
    {cluster_id: 'c1', cluster_name: 'dev2', object_id: 'o2', path: 'ns/svc/web', runs: 1, incomplete: 0, protected: 0, nodes: ['n1'],
     last_created_at: '2026-10-19T10:00:00Z', logical_bytes: 0, updated_at: '2026-10-23T19:50:16Z'},
];
const SNAPSHOTS = [
    {id: 's1', store: 'tar1', path: 'tbackup', created_at: '2026-10-20T10:00:00Z', node: 'n1', cluster_name: 'dev2', members: ['fs#1', 'config'], protected: false, note: ''},
    {id: 's2', store: 'tar1', path: 'tbackup', created_at: '2026-10-21T10:00:00Z', completed_at: '2026-10-21T10:01:30Z', logical_bytes: 3340, node: 'n2', cluster_name: 'dev2', members: ['fs#1', 'config'], protected: true, note: 'before upgrade'},
    {id: 's3', store: 'tar1', path: 'ns/svc/web', created_at: '2026-10-19T10:00:00Z', node: 'n1', cluster_name: 'dev2', members: ['config'], protected: false, note: ''},
];
// The snapshots, the latest first, a page at a time as the daemon answers them.
const SORTED = [...SNAPSHOTS].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

describe('the store panel', () => {
    let requests;

    beforeEach(() => {
        mockLive.counts = {pool: 0, cluster: 0, poll: {}};
        requests = [];
        mockGrants.value = {};
        vi.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
            const u = String(url);
            requests.push({url: u, method: options.method ?? 'GET'});
            const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
            if (options.method === 'DELETE' || options.method === 'PATCH') return json({});
            if (u.startsWith('/api/cluster/config/keywords')) return json({items: KEYWORDS});
            if (u.startsWith('/api/cluster/config/file')) return new Response(FILE, {status: 200});
            if (u.startsWith('/api/store/snapshot')) {
                const query = new URLSearchParams(u.split('?')[1]);
                const limit = Number(query.get('limit') || SORTED.length);
                const from = query.get('before') ? SORTED.findIndex((x) => x.id === query.get('before')) + 1 : 0;
                const items = SORTED.slice(from, from + limit);
                return json({items, ...(from + limit < SORTED.length ? {next: items[items.length - 1].id} : {})});
            }
            if (u.startsWith('/api/store/object')) return json({kind: 'StoreObjectStatsList', items: OBJECTS});
            if (u.startsWith('/api/store')) return json({items: STORES});
            return json({}, 404);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('the overview: where it is, whom it serves, what it keeps; its figures as the daemon sums them, by node, by object; no snapshot read', async () => {
        renderIn(<StoreOverview name="tar1"/>);
        const facts = await screen.findByRole('region', {name: 'Store'});
        expect(facts).toHaveTextContent('Typetar');
        expect(facts).toHaveTextContent('Where/var/tmp/om-store-tar1');
        expect(facts).toHaveTextContent('Servesevery namespace');
        expect(facts).toHaveTextContent('DeclaredOf the cluster configuration');
        await waitFor(() => expect(facts).toHaveTextContent('Keeps7d'));
        const figures = screen.getByRole('region', {name: 'Snapshots'}).querySelector('[data-figures]');
        const figure = (name) => figures.querySelector(`[data-figure=${name}]`);
        expect(figure('runs')).toHaveTextContent('3snapshots');
        expect(figure('objects')).toHaveTextContent('2objects');
        expect(figure('protected')).toHaveTextContent('1protected');
        expect(figure('incomplete')).toHaveTextContent('1incomplete');
        expect(figure('saved')).toHaveTextContent('5 GiBsaved');
        // A store of each node's own: no free space of its own, each node its own.
        expect(figure('free')).toBeNull();
        const byNode = within(screen.getByRole('region', {name: 'By node'})).getByRole('table');
        expect(byNode.querySelector('[data-row=n1]')).toHaveTextContent(/^n121.+12 GiB$/);
        expect(byNode.querySelector('[data-row=n2]')).toHaveTextContent(/^n211.+10 GiB$/);
        // One cluster writing it: no breakdown by cluster.
        expect(screen.queryByRole('region', {name: 'By cluster'})).toBeNull();
        const byObject = await screen.findByRole('table', {name: 'Snapshots by object'});
        expect(within(byObject).getAllByRole('columnheader').map((h) => h.textContent))
            .toEqual(['Object', 'Snapshots', 'Latest', 'Nodes', 'Saved', 'Protected', 'Incomplete']);
        expect([...byObject.querySelectorAll('[data-object]')].map((o) => o.getAttribute('data-object'))).toEqual(['tbackup', 'ns/svc/web']);
        expect(byObject.querySelector('[data-object=tbackup]')).toHaveTextContent(/^tbackup2.+n1, n23 GiB11$/);
        expect(byObject.querySelector('[data-object=tbackup] .text-state-warn')).toHaveTextContent('1');
        expect(byObject.querySelector('[data-object="ns/svc/web"]')).toHaveTextContent(/^ns\/svc\/web1.+n1–––$/);
        // The age of the latest compact, as in the tables; the figures computed, said so.
        expect(figure('latest')).not.toHaveTextContent(/il y a|ago.+ago/);
        expect(screen.getByRole('region', {name: 'Snapshots'})).toHaveTextContent(/Figures computed/);
        expect(requests.some((r) => r.url.startsWith('/api/store/snapshot?'))).toBe(false);
    });

    test('a store unreached at its last attempt said so, its figures kept; several clusters writing it, each one\'s share', async () => {
        renderIn(<StoreOverview name="from test/sec/stores store#tar2"/>);
        const snapshots = await screen.findByRole('region', {name: 'Snapshots'});
        expect(snapshots).toHaveTextContent('Not reached at its last attempt: connection refused');
        expect(snapshots.querySelector('[data-figure=free]')).toHaveTextContent('13 GiBfree');
        const byCluster = within(screen.getByRole('region', {name: 'By cluster'})).getByRole('table');
        expect(byCluster.querySelector('[data-row=drp]')).toHaveTextContent(/^drp32/);
    });

    test('a store of a secret: said declared by it, opening it', async () => {
        renderIn(<StoreOverview name="from test/sec/stores store#tar2"/>);
        const facts = await screen.findByRole('region', {name: 'Store'});
        expect(facts).toHaveTextContent('Servestbk, test');
        fireEvent.click(within(facts).getByRole('button', {name: 'test/sec/stores'}));
        expect(decodeURIComponent(screen.getByTestId('search').textContent)).toContain('peek=object:test/sec/stores');
    });

    test('the snapshots a page at a time, the latest first, older ones read on demand; how long each took, its size; filtered', async () => {
        const pageSize = (await import('../StorePanel')).SNAPSHOT_PAGE;
        expect(pageSize).toBe(100);
        renderIn(<StoreSnapshots name="tar1"/>);
        const table = await screen.findByRole('table', {name: 'Snapshots of the store tar1'});
        const ids = () => [...table.querySelectorAll('[data-snapshot]')].map((r) => r.getAttribute('data-snapshot'));
        expect(ids()).toEqual(['s2', 's1', 's3']);
        expect(requests.filter((r) => r.url.startsWith('/api/store/snapshot?')).map((r) => r.url)).toEqual(['/api/store/snapshot?store=tar1&limit=100']);
        expect(screen.getByText('3 snapshots')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Read .* older/})).toBeNull();
        expect(table.querySelector('[data-snapshot=s2]')).toHaveTextContent('1 min 30 s');
        expect(table.querySelector('[data-snapshot=s2]')).toHaveTextContent('3 KiB');
        // No completion stamp, no size: none said.
        expect(table.querySelector('[data-snapshot=s1]')).toHaveTextContent(/–.*–/);
        expect(table.querySelector('[data-snapshot=s2]')).toHaveTextContent('n2 of dev2');
        expect(table.querySelector('[data-snapshot=s2]')).toHaveTextContent('before upgrade');
        expect(within(table.querySelector('[data-snapshot=s2]')).getByText('Protected: the retention keeps it')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the snapshots'}), {target: {value: 'web'}});
        await waitFor(() => expect(ids()).toEqual(['s3']));
        fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the snapshots'}), {target: {value: ''}});
        await waitFor(() => expect(ids()).toHaveLength(3));

        // The delete out of the table, acting on the selection: none selected, nothing to delete.
        const tools = screen.getByRole('toolbar', {name: 'Selected snapshots'});
        expect(within(tools).getByRole('button', {name: 'Delete 0 snapshots'})).toBeDisabled();
        expect(within(table).queryAllByRole('button', {name: /^Delete/})).toEqual([]);
        fireEvent.click(within(table).getByRole('checkbox', {name: 'Select the snapshot s2 of tbackup'}));
        fireEvent.click(within(table).getByRole('checkbox', {name: 'Select the snapshot s3 of ns/svc/web'}));
        expect(tools).toHaveTextContent('2 selected');
        fireEvent.click(within(tools).getByRole('button', {name: 'Delete 2 snapshots'}));
        const dialog = screen.getByRole('dialog', {name: 'Delete 2 snapshots?'});
        expect(dialog).toHaveTextContent('These 2 snapshots are removed from the store, for good:');
        expect(dialog).toHaveTextContent('s2 tbackup');
        expect(dialog).toHaveTextContent('s3 ns/svc/web');
        expect(dialog).toHaveTextContent('1 of them is protected');
        expect(requests.filter((r) => r.method === 'DELETE')).toEqual([]);
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete 2 snapshots'}));
        await waitFor(() => expect(requests.filter((r) => r.method === 'DELETE').map((r) => r.url)).toEqual([
            '/api/store/snapshot?store=tar1&id=s2',
            '/api/store/snapshot?store=tar1&id=s3',
        ]));
        await waitFor(() => expect(screen.queryByRole('dialog', {name: 'Delete 2 snapshots?'})).toBeNull());
        // Deleted: out of those read and of the selection, the pages read not read again.
        expect(ids()).toEqual(['s1']);
        expect(within(tools).getByRole('button', {name: 'Delete 0 snapshots'})).toBeDisabled();
    });

    test('an object chosen by its id; the presets and a date ask the daemon a period', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true, toFake: ['Date']});
        vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
        try {
            const history = [
                {id: 'h1', path: 'tbackup', created_at: '2026-10-23T10:00:00Z', node: 'n1', members: ['config']},
                {id: 'h2', path: 'tbackup', created_at: '2026-10-20T10:00:00Z', node: 'n1', members: ['config']},
                {id: 'h3', path: 'tbackup', created_at: '2026-09-01T10:00:00Z', node: 'n1', members: ['config'], protected: true},
                {id: 'h4', path: 'tbackup', created_at: '2025-03-01T10:00:00Z', node: 'n1', members: ['config']},
            ];
            // The daemon, filtering by object, period and order, as the store records allow.
            global.fetch.mockImplementation(async (url, options = {}) => {
                const u = String(url);
                requests.push({url: u, method: options.method ?? 'GET'});
                const json = (body) => new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
                const query = new URLSearchParams(u.split('?')[1] ?? '');
                if (u.startsWith('/api/store/object')) return json({items: OBJECTS});
                if (u.startsWith('/api/store/snapshot')) {
                    let items = query.get('object_id') === 'o1' ? [...history] : [...SORTED];
                    const since = query.get('since') ? Date.parse(query.get('since')) : null;
                    const until = query.get('until') ? Date.parse(query.get('until')) : null;
                    items = items.filter((x) => (since === null || Date.parse(x.created_at) >= since) && (until === null || Date.parse(x.created_at) < until));
                    if (query.get('order') === 'asc') items.reverse();
                    return json({items: items.slice(0, Number(query.get('limit') || 100))});
                }
                return json({items: STORES});
            });
            renderIn(<StoreSnapshots name="tar1"/>);
            const table = await screen.findByRole('table', {name: 'Snapshots of the store tar1'});
            const ids = () => [...table.querySelectorAll('[data-snapshot]')].map((r) => r.getAttribute('data-snapshot'));
            const when = screen.getByRole('region', {name: 'When'});
            await waitFor(() => expect(within(when).getByRole('combobox', {name: 'Object'})).toHaveTextContent('tbackup (2)'));
            fireEvent.change(within(when).getByRole('combobox', {name: 'Object'}), {target: {value: 'o1'}});
            await waitFor(() => expect(ids()).toEqual(['h1', 'h2', 'h3', 'h4']));
            expect(requests.some((r) => r.url === '/api/store/snapshot?store=tar1&limit=100&object_id=o1')).toBe(true);

            // The presets: a span back from now, asked of the daemon; the latest alone.
            const presets = within(when).getByRole('group', {name: 'Periods'});
            fireEvent.click(within(presets).getByRole('button', {name: '7 d'}));
            await waitFor(() => expect(ids()).toEqual(['h1', 'h2']));
            expect(requests.some((r) => r.url.includes('object_id=o1&since=2026-10-16T12%3A00%3A00.000Z'))).toBe(true);
            expect(within(presets).getByRole('button', {name: '7 d'})).toHaveAttribute('aria-pressed', 'true');
            fireEvent.click(within(presets).getByRole('button', {name: 'Latest'}));
            await waitFor(() => expect(ids()).toEqual(['h1']));
            fireEvent.click(within(presets).getByRole('button', {name: 'All'}));
            await waitFor(() => expect(ids()).toHaveLength(4));

            // Around a date: the daemon's last before it and first after, those two shown.
            fireEvent.change(within(when).getByLabelText('Around'), {target: {value: '2026-10-01T00:00'}});
            await waitFor(() => expect(when.querySelector('[data-around]')).toHaveTextContent(/^Last before: h3, .* · first after: h2, /));
            await waitFor(() => expect(ids()).toEqual(['h2', 'h3']));
            expect(requests.some((r) => r.url.includes('limit=1&object_id=o1&since=') && r.url.endsWith('&order=asc'))).toBe(true);
            fireEvent.click(within(when).getByRole('button', {name: 'Clear the period'}));
            await waitFor(() => expect(ids()).toHaveLength(4));

        } finally {
            vi.useRealTimers();
        }
    });

    test('the snapshots of an object, across the stores: each its store, no object to pick, deleted from its store', async () => {
        global.fetch.mockImplementation(async (url, options = {}) => {
            const u = String(url);
            requests.push({url: u, method: options.method ?? 'GET'});
            const json = (body) => new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
            if (options.method === 'DELETE') return json({});
            return json({items: [
                {id: 'b1', store: 'tar1', path: 'tbackup', created_at: '2026-10-21T10:00:00Z', node: 'n1', members: ['config']},
                {id: 'b2', store: 'from test/sec/stores store#tar2', path: 'tbackup', created_at: '2026-10-20T10:00:00Z', node: 'n2', members: ['config']},
            ]});
        });
        renderIn(<StoreSnapshots path="tbackup"/>);
        const table = await screen.findByRole('table', {name: 'Snapshots of tbackup'});
        expect(requests[0].url).toBe('/api/store/snapshot?limit=100&path=tbackup');
        expect(within(table).getAllByRole('columnheader')[2]).toHaveTextContent('Store');
        expect(table.querySelector('[data-snapshot=b2]')).toHaveTextContent(/tar2/);
        expect(within(screen.getByRole('region', {name: 'When'})).queryByRole('combobox', {name: 'Object'})).toBeNull();
        // The store of a row opens its panel.
        fireEvent.click(within(table.querySelector('[data-snapshot=b2]')).getByRole('button', {name: 'tar2'}));
        expect(new URLSearchParams(screen.getByTestId('search').textContent).get('peek')).toBe('store:from test/sec/stores store#tar2');
        // Deleted, each from its own store.
        fireEvent.click(within(table).getByRole('checkbox', {name: 'Select the snapshots shown'}));
        fireEvent.click(within(screen.getByRole('toolbar', {name: 'Selected snapshots'})).getByRole('button', {name: 'Delete 2 snapshots'}));
        fireEvent.click(within(screen.getByRole('dialog', {name: 'Delete 2 snapshots?'})).getByRole('button', {name: 'Delete 2 snapshots'}));
        await waitFor(() => expect(requests.filter((r) => r.method === 'DELETE').map((r) => r.url)).toEqual([
            '/api/store/snapshot?store=tar1&id=b1',
            '/api/store/snapshot?store=from%20test%2Fsec%2Fstores%20store%23tar2&id=b2',
        ]));
    });

    test('each its short id, the whole copied; all those shown selected at once; one refused said, kept selected', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
        const {shortId} = await import('../StorePanel');
        expect(shortId('79193a03-b0e2-4a19-8a6a-6050af0f39d8')).toBe('79193a03');
        global.fetch.mockImplementation(async (url, options = {}) => {
            const u = String(url);
            requests.push({url: u, method: options.method ?? 'GET'});
            const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
            if (options.method === 'DELETE') return u.endsWith('id=s3') ? json({detail: 'not an admin of ns'}, 403) : json({});
            if (u.startsWith('/api/store/object')) return json({items: []});
            return json({items: SORTED});
        });
        renderIn(<StoreSnapshots name="tar1"/>);
        const table = await screen.findByRole('table', {name: 'Snapshots of the store tar1'});
        expect(within(table).getAllByRole('columnheader')[1]).toHaveTextContent('ID');
        const row = table.querySelector('[data-snapshot=s2]');
        fireEvent.click(within(row).getByRole('button', {name: 'Copy the id s2'}));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('s2'));

        // The box of the head: those shown, the filter applied.
        fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the snapshots'}), {target: {value: 'tbackup'}});
        await waitFor(() => expect(table.querySelectorAll('[data-snapshot]')).toHaveLength(2));
        fireEvent.click(within(table).getByRole('checkbox', {name: 'Select the snapshots shown'}));
        fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the snapshots'}), {target: {value: ''}});
        await waitFor(() => expect(table.querySelectorAll('[data-snapshot]')).toHaveLength(3));
        const all = within(table).getByRole('checkbox', {name: 'Select the snapshots shown'});
        expect(all.indeterminate).toBe(true);
        fireEvent.click(all);
        const tools = screen.getByRole('toolbar', {name: 'Selected snapshots'});
        expect(tools).toHaveTextContent('3 selected');
        fireEvent.click(within(tools).getByRole('button', {name: 'Delete 3 snapshots'}));
        const dialog = screen.getByRole('dialog', {name: 'Delete 3 snapshots?'});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete 3 snapshots'}));
        expect(await within(dialog).findByText('1 not deleted, still selected:')).toBeInTheDocument();
        expect(dialog).toHaveTextContent(/s3: .*not an admin of ns/);
        expect([...table.querySelectorAll('[data-snapshot]')].map((r) => r.getAttribute('data-snapshot'))).toEqual(['s3']);
        expect(tools).toHaveTextContent('1 selected');
    });

    test('older snapshots read on demand, following the token of the last page', async () => {
        const module = await import('../StorePanel');
        const many = Array.from({length: module.SNAPSHOT_PAGE + 5}, (_, i) => ({
            id: `m${String(i).padStart(3, '0')}`, store: 'tar1', path: 'big', created_at: new Date(Date.UTC(2026, 9, 22) - i * 60000).toISOString(),
            node: 'n1', members: ['config'],
        }));
        SORTED.splice(0, SORTED.length, ...many);
        try {
            renderIn(<StoreSnapshots name="tar1"/>);
            const table = await screen.findByRole('table', {name: 'Snapshots of the store tar1'});
            expect(table.querySelectorAll('[data-snapshot]')).toHaveLength(100);
            expect(screen.getByText('The latest 100 read')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', {name: 'Read 100 older'}));
            await waitFor(() => expect(table.querySelectorAll('[data-snapshot]')).toHaveLength(105));
            expect(requests.filter((r) => r.url.startsWith('/api/store/snapshot?')).map((r) => r.url)[1])
                .toBe('/api/store/snapshot?store=tar1&limit=100&before=m099');
            expect(screen.queryByRole('button', {name: 'Read 100 older'})).toBeNull();
        } finally {
            SORTED.splice(0, SORTED.length, ...[...SNAPSHOTS].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
        }
    });

    test('the configuration of a store of the cluster: its section, root editing, modifying, deleting it, said its snapshots', async () => {
        mockGrants.value = {root: null};
        const onDeleted = vi.fn();
        renderIn(<StoreConfig name="tar1" onDeleted={onDeleted}/>);
        expect(await screen.findByLabelText('Configuration of the store tar1')).toHaveTextContent('[store#tar1] type = tar');
        expect(screen.getByRole('button', {name: 'Edit the configuration of the store tar1'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Modify the store tar1 in the wizard'})).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Delete the store'}));
        const dialog = screen.getByRole('dialog', {name: 'Delete the store tar1?'});
        expect(await within(dialog).findByText(/It holds 3 snapshots/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete the store'}));
        await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('tar1'));
        expect(requests.filter((r) => r.method === 'PATCH')).toEqual([{method: 'PATCH', url: '/api/cluster/config?delete=store%23tar1'}]);
    });

    test('the configuration of a store of a secret: configured there, no tool here', async () => {
        mockGrants.value = {root: null};
        renderIn(<StoreConfig name="from test/sec/stores store#tar2"/>);
        expect(screen.getByText(/The store tar2 is declared, and configured, in the secret/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'test/sec/stores'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Edit the configuration/})).toBeNull();
    });

    test('the wizard: the one type chosen, where it is required, a name of the cluster stores taken, a secret\'s apart', async () => {
        const onSaved = vi.fn();
        render(<StoreWizard stores={STORES} nodes={['n1']} onClose={() => {}} onSaved={onSaved}/>);
        expect(await screen.findByRole('radio', {name: 'tar'})).toBeChecked();
        fireEvent.change(screen.getByRole('textbox', {name: 'Name'}), {target: {value: 'tar1'}});
        expect(screen.getByText('A store tar1 exists already.')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', {name: 'Name'}), {target: {value: 'tar2'}});
        expect(screen.queryByText(/exists already/)).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Next'}));
        expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', {name: 'url (required)'}), {target: {value: '/srv/backups'}});
        fireEvent.click(screen.getByRole('button', {name: 'Next'}));
        expect(screen.getByTestId('store-preview')).toHaveTextContent('[store#tar2] type = tar url = /srv/backups');
        fireEvent.click(screen.getByRole('button', {name: 'Add the store'}));
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith('tar2'));
        expect(requests.filter((r) => r.method === 'PATCH').map((r) => r.url)).toEqual([
            '/api/cluster/config?set=store%23tar2.type%3Dtar&set=store%23tar2.url%3D%2Fsrv%2Fbackups',
        ]);
    });

    /** The answers from now on: `override(u)` a Response, or undefined for the usual one. */
    const answer = (override) => {
        const usual = global.fetch.getMockImplementation();
        global.fetch.mockImplementation(async (url, options = {}) => {
            const response = await override(String(url));
            if (!response) return usual(url, options);
            requests.push({url: String(url), method: options.method ?? 'GET'});
            return response;
        });
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    const failed = () => json({detail: 'down'}, 500);
    const reads = (prefix) => requests.filter((r) => r.url.startsWith(prefix)).length;
    const POLL = 30_000;

    test('the overview read again on each poll, kept shown; a failure keeping it', async () => {
        renderIn(<StoreOverview name="tar1"/>);
        const snapshots = await screen.findByRole('region', {name: 'Snapshots'});
        await screen.findByRole('table', {name: 'Snapshots by object'});
        const runs = () => snapshots.querySelector('[data-figure=runs]');
        expect(runs()).toHaveTextContent('3snapshots');
        answer((u) => {
            if (u === '/api/store') return json({items: STORES.map((s) => (s.ref === 'tar1' ? {...s, stats: {...s.stats, runs: 4}} : s))});
            if (u.startsWith('/api/store/object')) return json({items: [...OBJECTS, {...OBJECTS[1], object_id: 'o3', path: 'ns/svc/db'}]});
            return undefined;
        });
        await bump((c) => { c.poll[POLL] = 1; });
        await waitFor(() => expect(runs()).toHaveTextContent('4snapshots'));
        await waitFor(() => expect(document.querySelector('[data-object="ns/svc/db"]')).not.toBeNull());
        expect(screen.queryByText('Reading the store')).toBeNull();

        answer((u) => (u.startsWith('/api/store') ? failed() : undefined));
        const before = reads('/api/store');
        await bump((c) => { c.poll[POLL] += 1; });
        await waitFor(() => expect(reads('/api/store')).toBe(before + 2));
        expect(runs()).toHaveTextContent('4snapshots');
        expect(document.querySelector('[data-object="ns/svc/db"]')).not.toBeNull();
        expect(screen.queryByText(/Could not read/)).toBeNull();
    });

    test('the snapshots read again as many as read, older pages and the selection kept; a failure keeping them', async () => {
        const module = await import('../StorePanel');
        const at = (i) => new Date(Date.UTC(2026, 9, 22) - i * 60000).toISOString();
        const many = Array.from({length: module.SNAPSHOT_PAGE + 5}, (_, i) => ({
            id: `m${String(i).padStart(3, '0')}`, store: 'tar1', path: 'big', created_at: at(i), node: 'n1', members: ['config'],
        }));
        SORTED.splice(0, SORTED.length, ...many);
        try {
            renderIn(<StoreSnapshots name="tar1"/>);
            const table = await screen.findByRole('table', {name: 'Snapshots of the store tar1'});
            const ids = () => [...table.querySelectorAll('[data-snapshot]')].map((r) => r.getAttribute('data-snapshot'));
            fireEvent.click(screen.getByRole('button', {name: 'Read 100 older'}));
            await waitFor(() => expect(ids()).toHaveLength(105));
            fireEvent.click(within(table).getByRole('checkbox', {name: 'Select the snapshot m002 of big'}));
            fireEvent.click(within(table).getByRole('checkbox', {name: 'Select the snapshot m103 of big'}));
            fireEvent.click(within(table).getByRole('checkbox', {name: 'Select the snapshot m104 of big'}));
            fireEvent.change(screen.getByRole('searchbox', {name: 'Filter the snapshots'}), {target: {value: 'big'}});

            // A run done, the oldest pruned: the latest first, every page read again.
            SORTED.splice(0, SORTED.length, {...many[0], id: 'new', created_at: at(-1)}, ...many.slice(0, -1));
            const pages = reads('/api/store/snapshot?');
            await bump((c) => { c.poll[POLL] = 1; });
            await waitFor(() => expect(ids()[0]).toBe('new'));
            expect(reads('/api/store/snapshot?') - pages).toBe(2);
            expect(ids()).toHaveLength(105);
            expect(ids().at(-1)).toBe('m103');
            expect(screen.getByRole('searchbox', {name: 'Filter the snapshots'})).toHaveValue('big');
            expect(within(table).getByRole('checkbox', {name: 'Select the snapshot m002 of big'})).toBeChecked();
            expect(within(table).getByRole('checkbox', {name: 'Select the snapshot m103 of big'})).toBeChecked();
            expect(screen.getByRole('toolbar', {name: 'Selected snapshots'})).toHaveTextContent('2 selected');
            expect(screen.queryByText('Reading the store')).toBeNull();

            answer((u) => (u.startsWith('/api/store') ? failed() : undefined));
            await bump((c) => { c.poll[POLL] += 1; });
            await waitFor(() => expect(reads('/api/store/snapshot?') - pages).toBe(3));
            expect(ids()).toHaveLength(105);
            expect(screen.queryByText(/Could not read the snapshots/)).toBeNull();
        } finally {
            SORTED.splice(0, SORTED.length, ...[...SNAPSHOTS].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
        }
    }, 60_000);
});
