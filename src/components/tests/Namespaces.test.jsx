import React from 'react';
import {render, screen, fireEvent, waitFor, act, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import Namespaces from '../Namespaces';
import useEventStore from '../../hooks/useEventStore';
import {PG_POLL_MS, resetPgUsage} from '../../hooks/usePgUsage';
import i18n from '../../i18n';

const {mockNavigate, mockRetain, mockRelease} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockRetain: vi.fn(),
    mockRelease: vi.fn(),
}));

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
const loaded = () => waitFor(() => expect(within(cell('prod', 'Pools')).getByRole('img')).toBeInTheDocument());
/**
 * The hover card of a cell, opened from the keyboard: its figures, label then value,
 * and its notes; closed again once read, unless `keepOpen`.
 */
const cardOf = (element, {keepOpen = false} = {}) => {
    fireEvent.focus(element);
    const card = screen.getByRole('tooltip');
    const read = {
        card,
        figures: Object.fromEntries([...card.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])),
        notes: [...card.querySelectorAll('li')].map((li) => li.textContent),
    };
    if (!keepOpen) fireEvent.blur(element);
    return read;
};

describe('Namespaces', () => {
    test('the columns: name, services, volumes, secrets, configs, pools, networks, cpu, memory', async () => {
        renderNamespaces();
        expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim()))
            .toEqual(['Name', 'Services', 'Volumes', 'Secrets', 'Configs', 'Pools', 'Networks', 'CPU', 'Memory']);
        expect(names()).toEqual(['dev', 'prod', 'root']);
        await loaded();
    });

    test('the services and volumes by availability, a pill in its tint each; secrets and configs in grey', async () => {
        renderNamespaces();
        const services = within(cell('prod', 'Services')).getAllByRole('button');
        expect(services.map((b) => [b.textContent, b.dataset.tone])).toEqual([['2', 'up'], ['1', 'down']]);
        expect(services[0]).toHaveClass('border-state-up', 'text-state-up');
        expect(services[0]).toHaveAccessibleName('Show the 2 up services of prod');
        expect(within(cell('prod', 'Volumes')).getAllByRole('button').map((b) => [b.textContent, b.dataset.tone]))
            .toEqual([['1', 'up'], ['1', 'warn']]);
        const secrets = within(cell('prod', 'Secrets')).getByRole('button');
        expect([secrets.textContent, secrets.dataset.tone]).toEqual(['1', 'neutral']);
        expect(secrets).toHaveClass('border-line', 'text-ink-muted');
        expect(within(cell('prod', 'Configs')).getByRole('button')).toHaveTextContent('2');
        // The cluster object is no service, no volume, no secret, no configuration.
        expect(within(cell('root', 'Services')).getByRole('button')).toHaveAccessibleName('Show the 1 warn service of root');
        expect(cell('root', 'Configs')).toHaveTextContent('–');
        await loaded();
    });

    test('a count opens the tab of its kind, filtered by the namespace', async () => {
        renderNamespaces();
        fireEvent.click(within(cell('prod', 'Services')).getByRole('button', {name: /down/}));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod&globalState=down');
        fireEvent.click(within(cell('prod', 'Volumes')).getByRole('button', {name: /warn/}));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod&list=volumes&globalState=warn');
        fireEvent.click(within(cell('prod', 'Secrets')).getByRole('button'));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod&list=secrets');
        fireEvent.click(within(cell('prod', 'Configs')).getByRole('button'));
        expect(mockNavigate).toHaveBeenLastCalledWith('/objects?namespace=prod&list=configs');
        await loaded();
    });

    test('the pools: free, used and total out of the claim, else the pool size, a segment per pool', async () => {
        renderNamespaces();
        await loaded();
        // default: 10 GiB of a 20 GiB claim; shm, claimed of by nothing: 1 GiB of its 4 GiB.
        // The bar alone in the cell, its figures in the card.
        expect(cell('prod', 'Pools').textContent).toBe('');
        const bar = within(cell('prod', 'Pools')).getByRole('img');
        expect(bar).toHaveAccessibleName('Pools: default: 10 GiB of 20 GiB claimed (50%), shm: 1 GiB of 4 GiB, no claim (25%)');
        // The figures behind it in its hover card, reached from the keyboard too.
        const target = cell('prod', 'Pools').querySelector('[tabindex="0"]');
        const {card, figures, notes} = cardOf(target, {keepOpen: true});
        expect(figures).toEqual({Share: '46%', Free: '13 GiB', Used: '11 GiB', Total: '24 GiB'});
        expect(notes).toEqual(['default: 10 GiB of 20 GiB claimed (50%)', 'shm: 1 GiB of 4 GiB, no claim (25%)']);
        expect(target).toHaveAttribute('aria-describedby', card.id);
        fireEvent.blur(target);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        expect([...bar.querySelectorAll('[data-segment]')].map((s) => [s.dataset.segment, s.style.width]))
            .toEqual([['default', `${(10 / 24) * 100}%`], ['shm', `${(1 / 24) * 100}%`]]);
        expect(cell('dev', 'Pools')).toHaveTextContent('–');
    });

    test('every line one height, the bars beside their share rather than under it', async () => {
        renderNamespaces();
        await loaded();
        expect(bodyRows().every((r) => r.classList.contains('h-9'))).toBe(true);
        const bar = within(cell('prod', 'Pools')).getByRole('img');
        expect(bar.parentElement).toHaveClass('items-center');
        expect(bar.parentElement).not.toHaveClass('flex-col');
    });

    test('the networks: the addresses held, each once, out of the claim', async () => {
        renderNamespaces();
        await loaded();
        expect(cell('prod', 'Networks').textContent).toBe('');
        expect(within(cell('prod', 'Networks')).getByRole('img')).toHaveAccessibleName('Networks: default: 2 of 10 claimed (20%)');
        expect(cardOf(cell('prod', 'Networks').querySelector('[tabindex="0"]')).figures).toEqual({Share: '20%', Free: '8', Used: '2', Total: '10'});
        expect(cell('dev', 'Networks')).toHaveTextContent('–');
    });

    test('the cpu used of the claimed cap and the memory free, used and capped, no sparkline in the list', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        renderNamespaces();
        await loaded();
        // The memory on the first reading; a cpu rate needs a second one.
        await waitFor(() => expect(cell('prod', 'Memory')).toHaveTextContent('25% of 4 GiB'));
        expect(cardOf(cell('prod', 'Memory').querySelector('[tabindex="0"]')).figures).toEqual({Used: '1 GiB', Cap: '4 GiB', Free: '3 GiB'});
        expect(cell('prod', 'CPU')).toHaveTextContent('– of 8 cpu');
        // The rate shows on the second reading, a couple of seconds after the first.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(PG_POLL_MS);
        });
        // About half a cpu of 8.
        // In cpu, mcpu or µcpu, three significant digits at most (formatCpu), of the 8 cpu cap.
        await waitFor(() => expect(cell('prod', 'CPU')).toHaveTextContent(/^\d+(\.\d+)? [mµ]?cpu of 8 cpu$/));
        // The trends are in the panel of the namespace, not in its line.
        expect(within(cell('prod', 'Memory')).queryByRole('img')).not.toBeInTheDocument();
        expect(within(cell('prod', 'CPU')).queryByRole('img')).not.toBeInTheDocument();
        // No claim: the memory used alone, no cap; dev's cgroup reports none: a dash, not a zero.
        expect(cell('dev', 'Memory')).toHaveTextContent('– used');
        // No cpu cap: the cpu it uses now, however little, not a share of nothing.
        expect(cell('dev', 'CPU')).toHaveTextContent(/^\d+(\.\d+)? [mµ]?cpu$/);
        expect(cardOf(cell('dev', 'CPU').querySelector('[tabindex="0"]')).figures).toEqual({
            Used: cell('dev', 'CPU').textContent, Cap: 'no claim',
        });
    });

    test('a row opens the panel of its namespace, on its usage, without leaving the list', async () => {
        renderNamespaces();
        await loaded();
        fireEvent.click(cell('prod', 'Name'));
        const panel = screen.getByRole('dialog', {name: 'prod'});
        // The claims second, between the usage and the configuration.
        // Its objects by kind after them, each its count, a service down a red alert; its configuration last.
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Usage', 'Claims', 'Services3!', 'Volumes2', 'Configurations2', 'Secrets1', 'Events', 'Configuration']);
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
        fireEvent.click(screen.getByRole('button', {name: 'Services'}));
        expect(names()).toEqual(['prod', 'dev', 'root']);
        fireEvent.click(screen.getByRole('button', {name: 'Services'}));
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

    test('reads the claims of each namespace, a namespace without nscfg claiming nothing', async () => {
        renderNamespaces();
        await loaded();
        const read = global.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/nscfg/'));
        expect([...new Set(read)].sort()).toEqual([
            '/api/object/path/dev/nscfg/namespace/config/file',
            '/api/object/path/prod/nscfg/namespace/config/file',
            '/api/object/path/root/nscfg/namespace/config/file',
        ]);
    });

    test('pages the namespaces, 50 a page, as oc3 does', async () => {
        const many = {};
        for (let i = 0; i < 60; i++) many[`ns${String(i).padStart(2, '0')}/svc/s`] = {avail: 'up'};
        useEventStore.setState({objectStatus: many});
        renderNamespaces();
        expect(bodyRows()).toHaveLength(50);
        fireEvent.click(screen.getByRole('button', {name: 'Next'}));
        expect(bodyRows()).toHaveLength(10);
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
            expect(screen.getByLabelText('Par page')).toBeInTheDocument();
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
