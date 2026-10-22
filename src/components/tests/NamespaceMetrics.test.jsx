import React from 'react';
import {render as renderInDom, screen, within, act} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import NamespaceMetrics from '../NamespaceMetrics';
import useEventStore from '../../hooks/useEventStore';
import {PG_POLL_MS, resetPgUsage} from '../../hooks/usePgUsage';
import i18n from '../../i18n';

vi.mock('../../utils/logger.js', () => ({
    default: {error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn()},
}));

/** Rendered in a router: its badges open their records over the view. */
const render = (ui) => renderInDom(<MemoryRouter>{ui}</MemoryRouter>);

const MiB = 1024 * 1024;

/**
 * A /metrics/pg page of a node: prod/svc/web with its cpu counter, prod/svc/db
 * with its own, an object of another namespace, and one known without a cgroup.
 */
const page = ({web, db = 0, webMemory = MiB, dbMemory = 2 * MiB, webMax = '+Inf', dbMax}) => [
    `opensvc_pg_cgroup_exists{namespace="prod",path="prod/svc/web"} 1`,
    `opensvc_pg_cgroup_cpu_usage_usec{namespace="prod",path="prod/svc/web"} ${web}`,
    `opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/web"} ${webMemory}`,
    `opensvc_pg_cgroup_memory_max_bytes{namespace="prod",path="prod/svc/web"} ${webMax}`,
    ...(db === null ? [] : [
        `opensvc_pg_cgroup_cpu_usage_usec{namespace="prod",path="prod/svc/db"} ${db}`,
        `opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/db"} ${dbMemory}`,
        ...(dbMax === undefined ? [] : [`opensvc_pg_cgroup_memory_max_bytes{namespace="prod",path="prod/svc/db"} ${dbMax}`]),
    ]),
    `opensvc_pg_cgroup_exists{namespace="prod",path="prod/svc/gone"} 0`,
    `opensvc_pg_cgroup_cpu_usage_usec{namespace="dev",path="dev/svc/web"} 1`,
    '',
].join('\n');

const respond = (text, ok = true, status = 200) =>
    Promise.resolve({ok, status, text: () => Promise.resolve(text)});

/** The pages of each node, the next one served on each reading of it. */
let pages;

const rows = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
const paths = () => rows().map((cells) => cells[0]);
const row = (path) => rows().find((cells) => cells[0] === path);
const nextReading = () => act(async () => {
    await vi.advanceTimersByTimeAsync(PG_POLL_MS);
});

describe('NamespaceMetrics', () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        resetPgUsage();
        localStorage.setItem('authToken', 'tok');
        useEventStore.setState({nodeStatus: {n1: {}, n2: {}}, objectInstanceStatus: {}});
        pages = {n1: [page({web: 0})], n2: [page({web: 0, db: null})]};
        global.fetch = vi.fn((url) => {
            const node = /\/api\/node\/name\/([^/]+)\/metrics\/pg$/.exec(url)?.[1];
            const list = pages[node];
            if (!list) return respond('', false, 404);
            // The next page once queued; the last one again until then.
            if (list.length > 1) list.shift();
            const text = list[0];
            return text instanceof Error ? Promise.reject(text) : respond(text);
        });
    });

    afterEach(() => {
        resetPgUsage();
        vi.useRealTimers();
        localStorage.clear();
    });

    test('reads every node of the cluster through the API, with the token', async () => {
        render(<NamespaceMetrics namespace="prod"/>);
        await screen.findByRole('row', {name: /prod\/svc\/web/});
        expect(global.fetch).toHaveBeenCalledWith('/api/node/name/n1/metrics/pg', expect.objectContaining({
            headers: {Authorization: 'Bearer tok'},
        }));
        expect(global.fetch).toHaveBeenCalledWith('/api/node/name/n2/metrics/pg', expect.anything());
    });

    test('each object summed over its instances: the memory and the limits add up, unlimited if one is', async () => {
        render(<NamespaceMetrics namespace="prod"/>);
        await screen.findByRole('row', {name: /prod\/svc\/web/});
        // web on both nodes, db on n1 only; dev's objects and the one without a cgroup left out.
        expect(paths().sort()).toEqual(['prod/svc/db', 'prod/svc/web']);
        expect(row('prod/svc/web')).toEqual(['prod/svc/web', '2', '-', '2.0 MiB', 'unlimited']);
        expect(row('prod/svc/db')).toEqual(['prod/svc/db', '1', '-', '2.0 MiB', '-']);
    });

    test('the cpu from the second reading of the nodes, summed over them', async () => {
        render(<NamespaceMetrics namespace="prod"/>);
        await screen.findByRole('row', {name: /prod\/svc\/web/});
        // Half a cpu on n1, a quarter on n2, over the period.
        pages.n1.push(page({web: PG_POLL_MS * 500}));
        pages.n2.push(page({web: PG_POLL_MS * 250, db: null}));
        await nextReading();
        expect(Math.abs(parseFloat(row('prod/svc/web')[2]) - 75)).toBeLessThan(3);
        const totals = screen.getByRole('region', {name: 'Namespace total'});
        expect(Math.abs(parseFloat(within(totals).getByText('Namespace cpu').nextElementSibling.textContent) - 75)).toBeLessThan(3);
        expect(within(totals).getByText('Namespace memory').nextElementSibling).toHaveTextContent('4.0 MiB');
    });

    test('the busiest first by default; the columns sort, a figure from the largest', async () => {
        render(<NamespaceMetrics namespace="prod"/>);
        await screen.findByRole('row', {name: /prod\/svc\/web/});
        expect(screen.getByRole('columnheader', {name: /^CPU/})).toHaveAttribute('aria-sort', 'descending');
        // No rate yet: in the order of the paths.
        expect(paths()).toEqual(['prod/svc/db', 'prod/svc/web']);
        pages.n1.push(page({web: PG_POLL_MS * 100, db: PG_POLL_MS * 500}));
        pages.n2.push(page({web: 0, db: null}));
        await nextReading();
        expect(paths()).toEqual(['prod/svc/db', 'prod/svc/web']);
        act(() => within(screen.getByRole('columnheader', {name: /^Instances/})).getByRole('button').click());
        expect(paths()).toEqual(['prod/svc/web', 'prod/svc/db']);
        act(() => within(screen.getByRole('columnheader', {name: /^Limit/})).getByRole('button').click());
        expect(paths()).toEqual(['prod/svc/web', 'prod/svc/db']);
    });

    test('a node that could not be read is said, the others shown', async () => {
        pages.n2 = [new Error('HTTP 503')];
        render(<NamespaceMetrics namespace="prod"/>);
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch metrics: n2: HTTP 503');
        await screen.findByRole('row', {name: /prod\/svc\/web/});
        expect(row('prod/svc/web')).toEqual(['prod/svc/web', '1', '-', '1.0 MiB', 'unlimited']);
    });

    test('says when the namespace has no cgroup, without a total', async () => {
        render(<NamespaceMetrics namespace="empty"/>);
        expect(await screen.findByText('No cgroup metrics for the objects of empty')).toBeInTheDocument();
        expect(screen.queryByRole('region', {name: 'Namespace total'})).not.toBeInTheDocument();
    });

    test('speaks French to a French browser', async () => {
        await i18n.changeLanguage('fr');
        try {
            render(<NamespaceMetrics namespace="prod"/>);
            await screen.findByRole('row', {name: /prod\/svc\/web/});
            expect(screen.getByRole('columnheader', {name: /^Mémoire/})).toBeInTheDocument();
            expect(screen.getByText(/Additionné sur les nœuds du cluster/)).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('stops reading once unmounted', async () => {
        const {unmount} = render(<NamespaceMetrics namespace="prod"/>);
        await screen.findByRole('row', {name: /prod\/svc\/web/});
        unmount();
        const calls = global.fetch.mock.calls.length;
        await nextReading();
        expect(global.fetch.mock.calls.length).toBe(calls);
    });
});
