import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {vi} from 'vitest';
import HeartbeatRelays, {RELAY_POLL_MS} from '../HeartbeatRelays';
import {resetClusterStatus} from '../../hooks/clusterStatusOnce';

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

describe('HeartbeatRelays', () => {
    let served;

    beforeEach(() => {
        resetClusterStatus();
        localStorage.setItem('authToken', 'tok');
        served = () => json({kind: 'RelayStatusList', items: []});
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u === '/api/cluster/status?selector=cluster') return json({daemon: {nodename: 'dev3n1'}, cluster: {config: {id: 'c1', name: 'dev3', nodes: ['dev3n1']}}});
            if (u === '/api/relay/status') return served();
            return json({detail: 'not found'}, 404);
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    test('the node answering a relay: the slots it holds, of every cluster, each active or stale', async () => {
        served = () => json({kind: 'RelayStatusList', items: [
            {relay: 'dev3n1', cluster_id: 'c9', cluster_name: 'prod', nodename: 'p1', node_addr: '10.0.0.9:4000', msg_len: 900, updated_at: ago(2), username: 'prod', status: ''},
            {relay: 'dev3n1', cluster_id: 'c9', cluster_name: 'prod', nodename: 'p2', node_addr: '10.0.0.8:4000', msg_len: 900, updated_at: ago(90), username: 'prod', status: ''},
        ]});
        render(<HeartbeatRelays/>);
        const table = await screen.findByRole('table', {name: 'Slots held by dev3n1'});
        const rows = within(table).getAllByRole('row').slice(1);
        expect(rows.map((r) => [r.getAttribute('data-served'), r.getAttribute('data-state')])).toEqual([['prod/p1', 'active'], ['prod/p2', 'stale']]);
        expect(rows[0]).toHaveTextContent('prodp1active10.0.0.9:4000');
        // The relays this cluster's heartbeats use: not read, not shown.
        expect(global.fetch.mock.calls.some(([u]) => String(u).includes('remote=true') || String(u).startsWith('/api/cluster/config'))).toBe(false);
    });

    test('not a relay: said plainly, nothing in warn nor down', async () => {
        render(<HeartbeatRelays/>);
        expect(await screen.findByText(/This node is not a relay/)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(document.querySelector('[data-state]')).toBeNull();
    });

    test('a user the daemon refuses the relay: told, no error, never asked again', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        try {
            served = () => json({title: 'Forbidden', detail: 'need one of [heartbeat root] grant', status: 403}, 403);
            render(<HeartbeatRelays/>);
            const reads = () => global.fetch.mock.calls.filter(([u]) => String(u) === '/api/relay/status').length;
            await waitFor(() => expect(reads()).toBeGreaterThan(0));
            const asked = reads();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(3 * RELAY_POLL_MS);
            });
            expect(screen.getByText('The relays are not shown to your grants.')).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(reads()).toBe(asked);
        } finally {
            vi.useRealTimers();
        }
    });

    test('the slots not read said; refreshed on demand', async () => {
        served = () => json({detail: 'boom'}, 500);
        render(<HeartbeatRelays/>);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the relays');
        served = () => json({kind: 'RelayStatusList', items: []});
        fireEvent.click(screen.getByRole('button', {name: 'Refresh'}));
        expect(await screen.findByText(/This node is not a relay/)).toBeInTheDocument();
    });
});
