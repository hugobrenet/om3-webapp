import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import {ClusterTombstones, TOMBSTONES_EVERY_MS, groupTombstones} from '../ClusterTombstones';
import useEventStore from '../../hooks/useEventStore';
import i18n from '../../i18n';

const record = (node, path, extra = {}) => ({
    orchestration_id: `orch-${path}`, node, path, kind: 'deleted', object_id: `id-${path}`,
    version: '2026-11-20T09:00:00Z', deleted_at: '2026-11-20T09:05:00Z', holders: [], ...extra,
});

describe('groupTombstones', () => {
    test('a delete, a record per node: one line, its nodes, the holders over them all, the latest moments', () => {
        expect(groupTombstones([
            record('n2', 'prod/svc/web', {holders: ['n3'], version: '2026-11-20T09:00:01Z'}),
            record('n1', 'prod/svc/web', {holders: ['n3', 'n1'], deleted_at: '2026-11-20T09:05:02Z'}),
        ])).toEqual([{
            key: 'orch-prod/svc/web\u0000prod/svc/web',
            path: 'prod/svc/web',
            kind: 'deleted',
            orchestrationId: 'orch-prod/svc/web',
            objectId: 'id-prod/svc/web',
            nodes: ['n1', 'n2'],
            holders: ['n1', 'n3'],
            version: '2026-11-20T09:00:01Z',
            deletedAt: '2026-11-20T09:05:02Z',
        }]);
    });

    test('the most recent first, then by path; two orchestrations of one path apart; a purge recorded by one node a purge', () => {
        const lines = groupTombstones([
            record('n1', 'prod/svc/b', {deleted_at: '2026-11-20T08:00:00Z'}),
            record('n1', 'prod/svc/a', {deleted_at: '2026-11-20T08:00:00Z'}),
            record('n1', 'prod/svc/a', {orchestration_id: 'again', deleted_at: '2026-11-20T10:00:00Z'}),
            record('n2', 'prod/svc/a', {orchestration_id: 'again', kind: 'purged', deleted_at: '2026-11-20T10:00:00Z'}),
        ]);
        expect(lines.map((l) => [l.orchestrationId, l.path, l.kind])).toEqual([
            ['again', 'prod/svc/a', 'purged'],
            ['orch-prod/svc/a', 'prod/svc/a', 'deleted'],
            ['orch-prod/svc/b', 'prod/svc/b', 'deleted'],
        ]);
        expect(groupTombstones(undefined)).toEqual([]);
    });
});

describe('ClusterTombstones', () => {
    let items;
    let answer;

    const renderTab = () => render(<MemoryRouter><ClusterTombstones/></MemoryRouter>);
    const lines = () => within(screen.getByRole('table', {name: 'Tombstones'})).getAllByRole('row').slice(1);
    const line = (path) => screen.getByRole('table', {name: 'Tombstones'}).querySelector(`[data-tombstone="${path}"]`);
    const cells = (path) => within(line(path)).getAllByRole('cell').map((c) => c.textContent);

    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        localStorage.setItem('authToken', 'tok');
        useEventStore.setState({objectStatus: {}});
        answer = null;
        items = [
            record('n1', 'prod/svc/web', {holders: ['n2']}),
            record('n2', 'prod/svc/web', {holders: ['n2']}),
            record('n1', 'prod/vol/data', {kind: 'purged', deleted_at: '2026-11-20T08:00:00Z'}),
        ];
        global.fetch = vi.fn(async (url) => {
            if (answer) return answer();
            expect(url).toBe('/api/cluster/tombstone');
            return new Response(JSON.stringify({kind: 'TombstoneList', items}), {status: 200, headers: {'Content-Type': 'application/json'}});
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        localStorage.clear();
    });

    test('a line per delete or purge: its nodes, those still publishing the configuration deleted, its orchestration', async () => {
        renderTab();
        await screen.findByRole('table', {name: 'Tombstones'});
        expect(global.fetch).toHaveBeenCalledWith('/api/cluster/tombstone', expect.objectContaining({
            headers: expect.objectContaining({Authorization: 'Bearer tok'}),
        }));
        expect(lines().map((row) => row.getAttribute('data-tombstone'))).toEqual(['prod/svc/web', 'prod/vol/data']);
        const web = cells('prod/svc/web');
        expect(web[0]).toBe('prod/svc/webid-prod/svc/web');
        expect(web[1]).toBe('deleted');
        expect(web[4]).toBe('n1, n2');
        expect(web[5]).toBe('n2');
        expect(web[6]).toBe('orch-prod/svc/web');
        expect(line('prod/svc/web').querySelector('[data-holders]')).toHaveClass('text-state-warn');
        // The nodes open their panels.
        expect(within(line('prod/svc/web')).getAllByRole('button', {name: 'n2'})).toHaveLength(2);
        const data = cells('prod/vol/data');
        expect(data[1]).toBe('purged');
        expect(data[5]).toBe('none');
        // Gone: its path, no link.
        expect(within(line('prod/vol/data')).queryByRole('button', {name: 'prod/vol/data'})).toBeNull();
    });

    test('a path created again since: a link to the object there now, said recreated', async () => {
        useEventStore.setState({objectStatus: {'prod/vol/data': {avail: 'up'}}});
        renderTab();
        await screen.findByRole('table', {name: 'Tombstones'});
        expect(within(line('prod/vol/data')).getByRole('button', {name: 'prod/vol/data'})).toBeInTheDocument();
        expect(line('prod/vol/data')).toHaveTextContent('recreated');
        expect(line('prod/svc/web')).not.toHaveTextContent('recreated');
    });

    test('read again while shown: a record gone, a holder caught up', async () => {
        renderTab();
        await screen.findByRole('table', {name: 'Tombstones'});
        items = [record('n1', 'prod/svc/web'), record('n2', 'prod/svc/web')];
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TOMBSTONES_EVERY_MS);
        });
        await waitFor(() => expect(lines()).toHaveLength(1));
        expect(cells('prod/svc/web')[5]).toBe('none');
    });

    test('none: said so', async () => {
        items = [];
        renderTab();
        expect(await screen.findByText(/^No tombstone/)).toBeInTheDocument();
    });

    test('a read failing: what was read kept, said not current; refreshed on demand', async () => {
        renderTab();
        await screen.findByRole('table', {name: 'Tombstones'});
        answer = () => new Response(JSON.stringify({detail: 'node speaking restarting'}), {status: 503, headers: {'Content-Type': 'application/problem+json'}});
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TOMBSTONES_EVERY_MS);
        });
        expect(await screen.findByRole('alert')).toHaveTextContent(/^Not read again/);
        expect(lines()).toHaveLength(2);
        answer = null;
        fireEvent.click(screen.getByRole('button', {name: 'Refresh'}));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    test('refused to the session: nothing shown but why', async () => {
        answer = () => new Response(JSON.stringify({detail: 'forbidden'}), {status: 403, headers: {'Content-Type': 'application/problem+json'}});
        renderTab();
        expect(await screen.findByRole('alert')).toHaveTextContent('Reading the tombstones is refused to this session.');
        expect(screen.queryByRole('table', {name: 'Tombstones'})).toBeNull();
    });

    test('speaks French to a French browser', async () => {
        await i18n.changeLanguage('fr');
        try {
            renderTab();
            await screen.findByRole('table', {name: 'Tombstones'});
            expect(screen.getByRole('columnheader', {name: 'Encore publiée par'})).toBeInTheDocument();
            expect(cells('prod/vol/data')[1]).toBe('purgé');
        } finally {
            await i18n.changeLanguage('en');
        }
    });
});
