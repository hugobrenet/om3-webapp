import React from 'react';
import {render, screen, fireEvent, waitFor, act, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import Namespaces, {pooled} from '../Namespaces';
import {useFitLevel} from '../../ui/lib/fit-level';
import useEventStore from '../../hooks/useEventStore';
import {PG_POLL_MS, resetPgUsage} from '../../hooks/usePgUsage';
import i18n from '../../i18n';

const {mockNavigate, mockRetain, mockRelease} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockRetain: vi.fn(),
    mockRelease: vi.fn(),
}));

// The layout the room chooses, said by each test: jsdom lays nothing out.
vi.mock('../../ui/lib/fit-level', () => ({useFitLevel: vi.fn(() => 0)}));

vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal()),
    useNavigate: () => mockNavigate,
}));

vi.mock('../../eventSourceManager.jsx', () => ({
    retainEventReception: (...args) => {
        mockRetain(...args);
        return mockRelease;
    },
    startLoggerReception: vi.fn(),
    closeLoggerEventSource: vi.fn(),
}));

vi.mock('../NamespacePanel', () => ({
    NamespaceUsage: ({namespace}) => <div data-testid="namespace-usage">{namespace}</div>,
    NamespaceConfig: ({namespace}) => <div data-testid="namespace-config">{namespace}</div>,
}));
vi.mock('../NamespaceClaims', () => ({
    NamespaceClaims: ({namespace}) => <div data-testid="namespace-claims">{namespace}</div>,
}));

const GiB = 1024 ** 3;

const OBJECTS = {
    'prod/svc/web': {avail: 'up'},
    'prod/svc/db': {avail: 'up'},
    'prod/svc/api': {avail: 'down'},
    'prod/vol/data': {avail: 'up'},
    'prod/vol/cache': {avail: 'warn'},
    'prod/sec/tls': {avail: 'n/a'},
    'prod/cfg/app': {avail: 'n/a'},
    'prod/cfg/env': {avail: 'n/a'},
    // The configuration of prod, which holds its claims; dev and root have none.
    'prod/': {avail: 'n/a'},
    'foo': {avail: 'warn'},
    'cluster': {avail: 'n/a'},
    'dev/svc/x': {avail: 'n/a'},
};

/** The claims of prod: 20 GiB of the default pool, 10 addresses, 8 cpus and 4 GiB of memory. */
const PROD_NSCFG = `[DEFAULT]
id = 1

[claim#1]
type = pool
name = default
limit = 20g

[claim#2]
type = network
name = default
limit = 10

[claim#3]
type = cpu
limit = 800%

[claim#4]
type = memory
limit = 4g
limit@dev3n1 = 1g
`;

/** The cgroup metrics, the cpu counter growing between two readings. */
const pg = (usec) => [
    '# HELP opensvc_pg_cgroup_cpu_usage_usec cpu',
    `opensvc_pg_cgroup_cpu_usage_usec{namespace="prod",path="prod/svc/web"} ${usec}`,
    // dev, which caps no cpu, barely uses any: a hundredth of what prod uses.
    `opensvc_pg_cgroup_cpu_usage_usec{namespace="dev",path="dev/svc/x"} ${usec / 100}`,
    `opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/web"} ${GiB / 2}`,
    `opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/db"} ${GiB / 2}`,
].join('\n');

let pgReadings;

const API = {
    '/api/pool': {items: [{name: 'default', size: 100 * GiB}, {name: 'shm', size: 4 * GiB}]},
    '/api/pool/volume': {items: [
        {path: 'prod/vol/data', pool: 'default', size: 10 * GiB},
        {path: 'prod/vol/cache', pool: 'shm', size: GiB},
    ]},
    '/api/network': {items: [{name: 'default', size: 65536}]},
    '/api/network/ip': {items: [
        // The same address on two nodes: one address taken.
        {ip: '10.0.0.1', path: 'prod/svc/web', network: {name: 'default'}, node: 'n1'},
        {ip: '10.0.0.1', path: 'prod/svc/web', network: {name: 'default'}, node: 'n2'},
        {ip: '10.0.0.2', path: 'prod/svc/api', network: {name: 'default'}, node: 'n1'},
    ]},
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('authToken', 'tok');
    pgReadings = 0;
    resetPgUsage();
    // One node, read through the API.
    useEventStore.setState({objectStatus: structuredClone(OBJECTS), nodeStatus: {n1: {}}, objectInstanceStatus: {}});
    global.fetch = vi.fn(async (url) => {
        if (url === '/api/node/name/n1/metrics/pg') {
            pgReadings += 1;
            // Five seconds of cpu between two readings a period apart: a third of a cpu.
            return new Response(pg(pgReadings * 5000000), {status: 200});
        }
        if (url === '/api/object/path/prod/nscfg/namespace/config/file') return new Response(PROD_NSCFG, {status: 200});
        if (url.endsWith('/nscfg/namespace/config/file')) return new Response('{"detail":"not found"}', {status: 404});
        const body = API[url];
        return body
            ? new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}})
            : new Response('{}', {status: 404});
    });
});

afterEach(() => {
    resetPgUsage();
    localStorage.clear();
    vi.useRealTimers();
});

const renderNamespaces = () => render(<MemoryRouter><Namespaces/></MemoryRouter>);
const table = () => screen.getByRole('table', {name: 'Namespaces'});
const bodyRows = () => within(table()).getAllByRole('row').slice(1);
const names = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);
const row = (name) => bodyRows().find((r) => within(r).getAllByRole('cell')[0].textContent === name);
const cell = (name, column) => {
    const headers = within(table()).getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim());
    return within(row(name)).getAllByRole('cell')[headers.indexOf(column)];
};
/** The networks figure of a usage, as a cell says it. */
const pooledOf = (usage) => pooled({
    t: i18n.t.bind(i18n), usage, kind: 'nets', locale: 'en',
    format: (n) => i18n.t('namespaces.usage.addresses', {count: n, value: String(n)}), plain: String, title: 'Networks',
});
const loaded = () => waitFor(() => expect(within(cell('prod', 'Pools')).getByRole('img')).toBeInTheDocument());
describe('Namespaces', () => {
    test('the columns: name, objects, pools, networks, cpu, memory', async () => {
        renderNamespaces();
        expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim()))
            .toEqual(['Name', 'Objects', 'Pools', 'Networks', 'CPU', 'Memory']);
        expect(names()).toEqual(['dev', 'prod', 'root']);
        await loaded();
    });

    test('the objects: a chip a kind, its count, its name, a pie of the availabilities of the services and volumes', async () => {
        renderNamespaces();
        const kinds = [...cell('prod', 'Objects').querySelectorAll('[data-kind]')];
        expect(kinds.map((k) => k.textContent)).toEqual(['3svc', '2vol', '2cfg', '1sec']);
        expect(kinds[0]).toHaveAccessibleName('Show the 3 services of prod: 2 up, 1 down');
        expect(kinds[3]).toHaveAccessibleName('Show the 1 secret of prod');
        // The pie: a slice an availability, as large as its share, in its tint; none for a secret.
        const slices = [...kinds[0].querySelectorAll('[data-avail]')];
        expect(slices.map((s) => s.dataset.avail)).toEqual(['up', 'down']);
        const round = 2 * Math.PI * 25;
        expect(Number(slices[0].getAttribute('stroke-dasharray').split(' ')[0])).toBeCloseTo((round * 2) / 3);
        expect(Number(slices[1].getAttribute('stroke-dashoffset'))).toBeCloseTo(-(round * 2) / 3);
        expect(slices[1]).toHaveClass('stroke-state-down');
        expect(kinds[3].querySelector('svg')).toBeNull();
        // The cluster object is no service, no volume, no secret, no configuration.
        expect([...cell('root', 'Objects').querySelectorAll('[data-kind]')].map((k) => k.textContent)).toEqual(['1svc']);
        // A slot a kind, kept empty when none, every chip as wide: the kinds of the rows in columns.
        expect([...cell('root', 'Objects').querySelectorAll('[data-empty-kind]')].map((k) => k.dataset.emptyKind)).toEqual(['vol', 'cfg', 'sec']);
        expect(kinds.every((k) => k.classList.contains('w-[9.5ch]'))).toBe(true);
        await loaded();
    });

    test('a chip opens the tab of its kind, filtered by the namespace; not the row', async () => {
        renderNamespaces();
        const chart = cell('prod', 'Objects');
        fireEvent.click(within(chart).getByRole('button', {name: /^Show the 3 services of prod/}));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod');
        fireEvent.click(within(chart).getByRole('button', {name: /^Show the 2 volumes of prod/}));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod&list=volumes');
        fireEvent.click(within(chart).getByRole('button', {name: 'Show the 1 secret of prod'}));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod&list=secrets');
        fireEvent.click(within(chart).getByRole('button', {name: 'Show the 2 configurations of prod'}));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod&list=configs');
        expect(screen.queryByRole('dialog', {name: 'prod'})).not.toBeInTheDocument();
        await loaded();
    });

    test('the pools: what is held in all and in how many on top; under it, the claim nearest to filling, in its heat', async () => {
        renderNamespaces();
        await loaded();
        // default: 10 GiB of a 20 GiB claim; shm, claimed by nothing: 1 GiB of its 4 GiB, no cap to fill.
        const pools = cell('prod', 'Pools');
        expect(pools.querySelector('[data-usage] > span').textContent).toBe('11 GiB in 2 pools, hottest claim:');
        expect(pools).toHaveTextContent(/^11 GiB in 2 pools, hottest claim:\s*default\s*50%\s*of 20 GiB$/);
        const bar = within(pools).getByRole('img');
        // Every pool said to the screen readers, the bar drawing the hottest claim alone, in its heat.
        expect(bar).toHaveAccessibleName('Pools: default: 10 GiB of 20 GiB claimed (50%), shm: 1 GiB of 4 GiB, no claim (25%)');
        const segments = [...bar.querySelectorAll('[data-segment]')];
        expect(segments.map((s) => [s.dataset.segment, s.style.width])).toEqual([['default', '50%']]);
        expect(segments[0]).toHaveClass('bg-state-up');
        expect(cell('dev', 'Pools')).toHaveTextContent('–');
    });

    test('in how many: those it holds something of, not those it claims and holds nothing of', () => {
        const usage = {used: 2, total: 30, free: 28, segments: [
            {name: 'a', used: 2, total: 10, claimed: true},
            {name: 'b', used: 0, total: 10, claimed: true},
            {name: 'c', used: 0, total: 10, claimed: true},
        ]};
        expect(pooledOf(usage).value).toBe('2 addresses in 1 network');
        expect(pooledOf({...usage, used: 0, segments: usage.segments.map((s) => ({...s, used: 0}))}).value).toBe('0 addresses');
    });

    test('the heat of the cpu and the memory: warn past half the cap, down past 80%, the bar and its part alike', async () => {
        renderNamespaces();
        await loaded();
        const memory = cell('prod', 'Memory');
        // 1 GiB of 4: cool, the part in plain ink.
        await waitFor(() => expect(within(memory).getByRole('img').querySelector('[data-segment]')).toHaveClass('bg-state-up'));
        expect(within(memory).getByText('25%')).not.toHaveClass('text-state-warn', 'text-state-down');
        // The hottest claim of the pools in its heat too: a claim alone in the bar.
        expect(within(cell('prod', 'Pools')).getByRole('img').querySelector('[data-segment]').className).not.toMatch(/bg-series-/);
    });

    test('every line one height, two lines high: the figures on top, the bars under them', async () => {
        renderNamespaces();
        await loaded();
        expect(bodyRows().every((r) => r.classList.contains('h-12'))).toBe(true);
        const bar = within(cell('prod', 'Pools')).getByRole('img');
        expect(bar.closest('[data-usage]')).toHaveClass('flex-col');
    });

    test('the networks: the addresses held, each once, on top, their share of the claim under it', async () => {
        renderNamespaces();
        await loaded();
        // In addresses, as the other columns say their unit, said once: the cap and the bar's words in plain numbers.
        expect(cell('prod', 'Networks')).toHaveTextContent(/^2 addresses in 1 network, hottest claim:\s*default\s*20%\s*of 10$/);
        expect(within(cell('prod', 'Networks')).getByRole('img')).toHaveAccessibleName('Networks: default: 2 of 10 claimed (20%)');
        expect(cell('dev', 'Networks')).toHaveTextContent('–');
    });

    test('the cpu and the memory used on top, their part of the cap under it; none measured, a dash; no sparkline', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        renderNamespaces();
        await loaded();
        // The memory on the first reading; a cpu rate needs a second one.
        await waitFor(() => expect(cell('prod', 'Memory')).toHaveTextContent(/^1 GiB\s*25%\s*of 4 GiB$/));
        expect(within(cell('prod', 'Memory')).getByRole('img', {name: 'Memory used by prod, of its cap'})).toBeInTheDocument();
        // A single segment, in its heat rather than a series tint: 25%, cool.
        expect(within(cell('prod', 'Memory')).getByRole('img').querySelector('[data-segment]')).toHaveClass('bg-state-up');
        // Not measured yet: a dash, once, not a share of nothing.
        expect(cell('prod', 'CPU')).toHaveTextContent(/^–\s*of 8 cpu$/);
        // The rate shows on the second reading, a couple of seconds after the first.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(PG_POLL_MS);
        });
        // About half a cpu of 8, in cpu, mcpu or µcpu, three significant digits at most (formatCpu).
        await waitFor(() => expect(cell('prod', 'CPU')).toHaveTextContent(/^\d+(\.\d+)? [mµ]?cpu\s*(<1|\d+)%\s*of 8 cpu$/));
        // No claim: the memory used alone, no cap; dev's cgroup reports none: a dash, not a zero.
        expect(cell('dev', 'Memory')).toHaveTextContent(/^–$/);
        expect(within(cell('dev', 'Memory')).queryByRole('img')).toBeNull();
        // No cpu cap: the cpu it uses now, however little, not a share of nothing.
        expect(cell('dev', 'CPU')).toHaveTextContent(/^\d+(\.\d+)? [mµ]?cpu$/);
    });

    describe('narrower, the claims in one column', () => {
        const claimsLoaded = () => waitFor(() => expect(within(cell('prod', 'Claims')).getAllByRole('img').length).toBeGreaterThan(0));
        afterEach(() => {
            vi.mocked(useFitLevel).mockReturnValue(0);
        });

        test('name, objects, claims: the kinds side by side, a line a claim, its figures lined up', async () => {
            vi.mocked(useFitLevel).mockReturnValue(1);
            renderNamespaces();
            await claimsLoaded();
            expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim()))
                .toEqual(['Name', 'Objects', 'Claims']);
            // Claims sorts by nothing: no button in its title.
            expect(within(screen.getByRole('columnheader', {name: 'Claims'})).queryByRole('button')).toBeNull();
            expect(cell('prod', 'Objects').querySelector('[data-kinds]').dataset.kinds).toBe('');
            const claims = cell('prod', 'Claims');
            expect([...claims.querySelectorAll('[data-figure]')].map((f) => f.textContent)).toEqual(['Pools', 'Networks', 'CPU', 'Memory']);
            expect(claims).toHaveTextContent(/Pools\s*11 GiB in 2 pools\s*50% of 20 GiB · default/);
            expect(claims).toHaveTextContent(/Networks\s*2 addresses in 1 network\s*20% of 10 · default/);
            // The cpu not measured yet: a dash, once, before its cap.
            expect(claims).toHaveTextContent(/CPU\s*–\s*of 8 cpu/);
            expect(within(claims).getByRole('img', {name: /^Pools: default/})).toBeInTheDocument();
            expect(table()).not.toHaveAttribute('data-cards');
        });

        test('narrower still, the kinds stacked, those held alone', async () => {
            vi.mocked(useFitLevel).mockReturnValue(2);
            renderNamespaces();
            await claimsLoaded();
            const kinds = cell('prod', 'Objects').querySelector('[data-kinds]');
            expect(kinds.dataset.kinds).toBe('stacked');
            expect(kinds.querySelectorAll('[data-empty-kind]')).toHaveLength(0);
            expect(cell('root', 'Objects').querySelectorAll('[data-kind]')).toHaveLength(1);
        });

        test('narrowest, cards: the cells of the full table, each under the title of its column', async () => {
            vi.mocked(useFitLevel).mockReturnValue(3);
            renderNamespaces();
            await loaded();
            expect(table()).toHaveAttribute('data-cards');
            expect(within(row('prod')).getAllByRole('cell').map((c) => c.dataset.label)).toEqual(['Name', 'Objects', 'Pools', 'Networks', 'CPU', 'Memory']);
        });

        test('cards: a figure beside its title, its bar line wrapped in the room left, not put under the title', async () => {
            vi.mocked(useFitLevel).mockReturnValue(3);
            renderNamespaces();
            const usage = await waitFor(() => within(cell('prod', 'Pools')).getByRole('img').closest('[data-usage]'));
            expect(usage).toHaveClass('min-w-0', 'flex-1');
            expect(usage).not.toHaveClass('whitespace-nowrap');
            expect(usage.lastElementChild).toHaveClass('flex-wrap');
            // Its title beside its first line.
            expect(cell('prod', 'Pools')).toHaveClass('!items-start');
        });

        test('wider, a figure on its lines whole', async () => {
            renderNamespaces();
            const usage = await waitFor(() => within(cell('prod', 'Pools')).getByRole('img').closest('[data-usage]'));
            expect(usage).toHaveClass('whitespace-nowrap');
            expect(usage.lastElementChild).not.toHaveClass('flex-wrap');
        });
    });

    test('a row opens the panel of its namespace, on its usage, without leaving the list', async () => {
        renderNamespaces();
        await loaded();
        fireEvent.click(cell('prod', 'Name'));
        const panel = screen.getByRole('dialog', {name: 'prod'});
        // The claims second, between the usage and the configuration.
        // Its objects by kind after them, each its count, a service down a red alert; then, as
        // every panel, its configuration, then its events.
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Usage', 'Claims', 'Services3!', 'Volumes2', 'Configurations2', 'Secrets1', 'Configuration', 'Events']);
        expect(within(panel).getByTestId('ns-tab-alert-services')).toHaveAttribute('data-level', 'down');
        expect(within(panel).getByTestId('namespace-usage')).toHaveTextContent('prod');
        expect(row('prod')).toHaveAttribute('aria-current', 'true');
        expect(mockNavigate).not.toHaveBeenCalled();
        fireEvent.click(within(panel).getByRole('tab', {name: 'Claims'}));
        expect(within(panel).getByTestId('namespace-claims')).toHaveTextContent('prod');
        fireEvent.click(within(panel).getByRole('tab', {name: 'Configuration'}));
        expect(within(panel).getByTestId('namespace-config')).toHaveTextContent('prod');
        // Another row opens on the usage again, whatever tab was open.
        fireEvent.click(cell('dev', 'Name'));
        const next = screen.getByRole('dialog', {name: 'dev'});
        expect(within(next).getByRole('tab', {name: 'Usage'})).toHaveAttribute('aria-selected', 'true');
        expect(within(next).getByTestId('namespace-usage')).toHaveTextContent('dev');
    });

    test('sorted by a column, a figure from the largest, ties in the order of the names', async () => {
        renderNamespaces();
        await loaded();
        fireEvent.click(screen.getByRole('button', {name: 'Objects'}));
        expect(names()).toEqual(['prod', 'dev', 'root']);
        fireEvent.click(screen.getByRole('button', {name: 'Objects'}));
        expect(names()).toEqual(['dev', 'root', 'prod']);
        // A name reads from A.
        fireEvent.click(screen.getByRole('button', {name: 'Name'}));
        expect(names()).toEqual(['dev', 'prod', 'root']);
        fireEvent.click(screen.getByRole('button', {name: 'Name'}));
        expect(names()).toEqual(['root', 'prod', 'dev']);
    });

    test('sorted by name by default', async () => {
        renderNamespaces();
        await loaded();
        expect(screen.getByRole('columnheader', {name: /^Name/})).toHaveAttribute('aria-sort', 'ascending');
        expect(names()).toEqual(['dev', 'prod', 'root']);
    });

    test('reads the claims of the namespaces the cluster lists a configuration of, the others claiming nothing, not asked', async () => {
        renderNamespaces();
        await loaded();
        const read = global.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/nscfg/'));
        // dev and root listed without one: no 404 asked for.
        expect([...new Set(read)]).toEqual(['/api/object/path/prod/nscfg/namespace/config/file']);
    });

    test('a configuration appearing, its claims read then', async () => {
        renderNamespaces();
        await loaded();
        const reads = () => global.fetch.mock.calls.filter(([url]) => url === '/api/object/path/dev/nscfg/namespace/config/file').length;
        expect(reads()).toBe(0);
        act(() => useEventStore.setState((state) => ({objectStatus: {...state.objectStatus, 'dev/': {avail: 'n/a'}}})));
        await waitFor(() => expect(reads()).toBe(1));
    });

    test('the first 100 namespaces drawn, more on demand, the count said', async () => {
        const many = {};
        for (let i = 0; i < 160; i++) many[`ns${String(i).padStart(3, '0')}/svc/s`] = {avail: 'up'};
        useEventStore.setState({objectStatus: many});
        renderNamespaces();
        const drawn = () => bodyRows().filter((r) => !r.hasAttribute('data-more-rows'));
        expect(drawn()).toHaveLength(100);
        expect(screen.getByText('160 namespaces')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Show 60 more'}));
        expect(drawn()).toHaveLength(160);
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/pool', expect.anything()));
    });

    test('no namespace: says so', async () => {
        useEventStore.setState({objectStatus: {}});
        renderNamespaces();
        expect(screen.getByTestId('no-namespaces-message')).toHaveTextContent('No namespaces available');
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/pool', expect.anything()));
    });

    test('speaks French to a French browser', async () => {
        await i18n.changeLanguage('fr');
        try {
            renderNamespaces();
            expect(screen.getByRole('button', {name: 'Réseaux'})).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Mémoire'})).toBeInTheDocument();
            expect(screen.getByText('3 namespaces')).toBeInTheDocument();
            await waitFor(() => expect(within(cell('prod', 'Réseaux')).getByRole('img')).toHaveAccessibleName(/^Réseaux : default/));
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('keeps the events of the objects coming while shown', async () => {
        const {unmount} = renderNamespaces();
        expect(mockRetain).toHaveBeenCalledWith('tok', expect.arrayContaining(['ObjectStatusUpdated', 'ObjectDeleted']));
        await loaded();
        unmount();
        expect(mockRelease).toHaveBeenCalled();
    });
});
