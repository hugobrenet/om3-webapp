import React from 'react';
import {act, render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import Stores from '../Stores';

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
// The panel and the wizard, on their own tested elsewhere: here, what they are given.
vi.mock('../RecordPanels', () => ({
    StoreDetailPanel: ({name}) => (name ? <div data-testid="store-panel">{name}</div> : null),
}));
vi.mock('../StoreWizard', () => ({
    StoreWizard: ({onSaved, nodes}) => (
        <div role="dialog" aria-label="New store" data-nodes={nodes.join(' ')}>
            <button onClick={() => onSaved('tar3')}>save tar3</button>
        </div>
    ),
}));

const GiB = 2 ** 30;
const STORES = [
    {
        ref: 'tar1', type: 'tar', url: '/var/tmp/om-store-tar1', share: ['*'],
        stats: {runs: 6, incomplete: 1, protected: 0, objects: 3, logical_bytes: 0, last_created_at: '2026-10-20T16:47:42Z', updated_at: '2026-10-23T19:50:16Z', clusters: []},
        // A store of each node's own: the least free a node has.
        node_stats: {n1: {free_bytes: 12 * GiB}, n2: {free_bytes: 10 * GiB}},
    },
    {
        ref: 'from test/sec/stores store#tar2', type: 'tar', url: 'sftp://backup@n1:2222/data', share: ['tbk', 'test'],
        stats: {runs: 11, incomplete: 0, protected: 0, objects: 6, logical_bytes: 0, free_bytes: 13 * GiB, check_error: 'connection refused', updated_at: '2026-10-23T19:50:16Z', clusters: []},
    },
    // Its figures not computed yet.
    {ref: 'tar0', type: 'tar', url: '/srv/tar0', share: ['*']},
];

describe('Stores', () => {
    let items;
    let requests;

    beforeEach(() => {
        mockLive.counts = {pool: 0, cluster: 0, poll: {}};
        items = STORES;
        requests = [];
        mockGrants.value = {};
        vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
            const u = String(url);
            requests.push(u);
            const json = (body) => new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
            if (u === '/api/node') return json({items: [{meta: {node: 'n1'}}, {meta: {node: 'n2'}}]});
            return json({items});
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('a card a store: its name, type, where, whom it serves, where declared; opening its panel', async () => {
        render(<Stores/>, {wrapper: MemoryRouter});
        const list = await screen.findByRole('list', {name: 'Stores'});
        const cards = [...list.querySelectorAll('[data-store]')];
        expect(cards.map((c) => c.getAttribute('data-store'))).toEqual(['from test/sec/stores store#tar2', 'tar0', 'tar1']);
        // Its name and type over where it is; its figures as the daemon sums them; whom it serves, where declared.
        const figure = (card, name) => card.querySelector(`[data-figure=${name}]`);
        expect(cards[2]).toHaveTextContent(/^tar1tar\/var\/tmp\/om-store-tar1/);
        expect(figure(cards[2], 'runs')).toHaveTextContent('6snapshots');
        expect(figure(cards[2], 'objects')).toHaveTextContent('3objects');
        expect(figure(cards[2], 'free')).toHaveTextContent('10 GiBfree on n2');
        expect(cards[2]).toHaveTextContent('1 incomplete run');
        expect(cards[2]).toHaveTextContent(/cluster configurationevery namespace$/);
        expect(figure(cards[0], 'free')).toHaveTextContent('13 GiBfree');
        expect(cards[0]).toHaveTextContent('Not reached at its last attempt');
        expect(cards[0]).toHaveTextContent(/secret test\/sec\/storestbktest$/);
        expect(cards[1]).toHaveTextContent('Its figures are being computed.');
        // Its snapshots never read for it: a store holds thousands.
        expect(requests.some((u) => u.startsWith('/api/store/snapshot'))).toBe(false);
        // No plus card but for root.
        expect(list.querySelector('[data-new-store]')).toBeNull();
        fireEvent.click(within(cards[2]).getByRole('button', {name: 'Open the store tar1'}));
        expect(screen.getByTestId('store-panel')).toHaveTextContent('tar1');
    });

    test('root adds a store from the plus card, given the nodes: the list read until it has it, its panel then opened', async () => {
        mockGrants.value = {root: null};
        render(<Stores/>, {wrapper: MemoryRouter});
        const plus = await screen.findByRole('button', {name: 'Add store'});
        expect(plus).toHaveAttribute('data-new-store');
        fireEvent.click(plus);
        const wizard = await screen.findByRole('dialog', {name: 'New store'});
        expect(wizard).toHaveAttribute('data-nodes', 'n1 n2');
        items = [...STORES, {ref: 'tar3', type: 'tar', url: '/srv', share: ['*']}];
        fireEvent.click(within(wizard).getByRole('button', {name: 'save tar3'}));
        await waitFor(() => expect(screen.getByTestId('store-panel')).toHaveTextContent('tar3'));
        expect(screen.getByRole('list', {name: 'Stores'}).querySelector('[data-store=tar3]')).not.toBeNull();
    });

    test('read again on each poll and each change of the cluster configuration, the panel kept; a failure keeping the cards, no error', async () => {
        render(<Stores/>, {wrapper: MemoryRouter});
        const list = await screen.findByRole('list', {name: 'Stores'});
        fireEvent.click(within(list.querySelector('[data-store=tar1]')).getByRole('button', {name: 'Open the store tar1'}));
        const runs = () => list.querySelector('[data-store=tar1] [data-figure=runs]');
        expect(runs()).toHaveTextContent('6snapshots');
        items = STORES.map((s) => (s.ref === 'tar1' ? {...s, stats: {...s.stats, runs: 7}} : s));
        await bump((c) => { c.poll[30_000] = 1; });
        await waitFor(() => expect(runs()).toHaveTextContent('7snapshots'));
        expect(screen.queryByText('Reading the stores')).toBeNull();
        items = STORES.filter((s) => s.ref !== 'tar0');
        await bump((c) => { c.cluster += 1; });
        await waitFor(() => expect(list.querySelector('[data-store=tar0]')).toBeNull());
        expect(screen.getByTestId('store-panel')).toHaveTextContent('tar1');

        const count = requests.length;
        global.fetch.mockImplementation(async (url) => {
            requests.push(String(url));
            return new Response(JSON.stringify({detail: 'down'}), {status: 500, headers: {'Content-Type': 'application/json'}});
        });
        await bump((c) => { c.poll[30_000] += 1; });
        await waitFor(() => expect(requests.length).toBe(count + 1));
        expect(list.querySelectorAll('[data-store]')).toHaveLength(2);
        expect(screen.queryByText(/Could not read the stores/)).toBeNull();
    });
});
