import React from 'react';
import {render, screen, fireEvent, waitFor, within, act} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import Arrays from '../Arrays';
import {ArrayOverview} from '../ArrayPanel';
import {useMenuState} from '../../hooks/useSidebarAlerts';

const mockGrants = vi.hoisted(() => ({value: {root: null}}));
vi.mock('../../hooks/useGrants', () => ({
    useGrants: () => mockGrants.value,
    useIsRoot: () => Object.prototype.hasOwnProperty.call(mockGrants.value, 'root'),
}));
// The panel and the wizard, on their own tested elsewhere: here, what they are given.
vi.mock('../RecordPanels', () => ({
    ArrayDetailPanel: ({name}) => (name ? <div data-testid="array-panel">{name}</div> : null),
}));
vi.mock('../SectionWizard', () => ({
    SectionWizard: ({section, items, nodes, onSaved}) => (
        <div role="dialog" aria-label="New array" data-section={section} data-taken={items.map((i) => i.name).join(' ')} data-nodes={nodes.join(' ')}>
            <button onClick={() => onSaved('xt1')}>save xt1</button>
        </div>
    ),
}));
const mockPeek = vi.hoisted(() => vi.fn());
vi.mock('../../app/CrossLink', () => ({
    CrossLink: ({kind, id, children}) => <button onClick={() => mockPeek(kind, id)}>{children}</button>,
}));

const CONFIG = `[array#pure1]
type = pure
api = https://pure1.example.com/api
client_id = 1234
secret = ********

[array#emc1]
type = symmetrix
symcli_connect = emc1_conn

[pool#gold]
type = pure
array = pure1

[pool#silver]
type = pure
array@n1 = pure1
`;

describe('Arrays', () => {
    let items;
    // The configuration as read now, or a failure to read it.
    let config;
    let fails;

    beforeEach(() => {
        mockGrants.value = {root: null};
        items = [{name: 'emc1', type: 'symmetrix'}, {name: 'pure1', type: 'pure'}];
        config = CONFIG;
        fails = false;
        vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
            const u = String(url);
            const json = (body) => new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
            if (u === '/api/node') return json({items: [{meta: {node: 'n1'}}, {meta: {node: 'n2'}}]});
            if (fails) return new Response('down', {status: 500});
            if (u === '/api/array') return json({kind: 'ArrayList', items});
            if (u === '/api/cluster/config/file?redact-secrets=true') return new Response(config, {status: 200});
            return new Response('not found', {status: 404});
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const cards = (list) => [...list.querySelectorAll('[data-array]')];

    test('a card an array: its name and type, where it is reached, the pools on it; opening its panel', async () => {
        render(<Arrays/>, {wrapper: MemoryRouter});
        const list = await screen.findByRole('list', {name: 'Arrays'});
        expect(cards(list).map((c) => c.getAttribute('data-array'))).toEqual(['emc1', 'pure1']);
        expect(cards(list)[0]).toHaveTextContent(/^emc1symmetrixemc1_conn0 pools on it$/);
        // A pool naming it on one node only, on it all the same.
        expect(cards(list)[1]).toHaveTextContent(/^pure1purehttps:\/\/pure1\.example\.com\/api2 pools on itgoldsilver$/);
        fireEvent.click(screen.getByRole('button', {name: 'Open the array pure1'}));
        expect(screen.getByTestId('array-panel')).toHaveTextContent('pure1');
    });

    test('added from the plus card, in the wizard of an array section, the names taken said', async () => {
        render(<Arrays/>, {wrapper: MemoryRouter});
        const list = await screen.findByRole('list', {name: 'Arrays'});
        fireEvent.click(list.querySelector('[data-new-array]'));
        const wizard = await screen.findByRole('dialog', {name: 'New array'});
        expect(wizard).toHaveAttribute('data-section', 'array');
        expect(wizard).toHaveAttribute('data-taken', 'emc1 pure1');
        expect(wizard).toHaveAttribute('data-nodes', 'n1 n2');
        // Written: the list read until it holds it, its panel opened.
        items = [...items, {name: 'xt1', type: 'xtremio'}];
        fireEvent.click(screen.getByRole('button', {name: 'save xt1'}));
        await waitFor(() => expect(screen.getByTestId('array-panel')).toHaveTextContent('xt1'));
        await waitFor(() => expect(cards(list).map((c) => c.getAttribute('data-array'))).toContain('xt1'));
    });

    test('none declared, said', async () => {
        items = [];
        render(<Arrays/>, {wrapper: MemoryRouter});
        expect(await screen.findByText('No array: the cluster configuration declares none.')).toBeInTheDocument();
    });

    test('root only: said, nothing asked of the daemon', () => {
        mockGrants.value = {};
        render(<Arrays/>, {wrapper: MemoryRouter});
        expect(screen.getByText(/needs the root grant/)).toBeInTheDocument();
        expect(fetch).not.toHaveBeenCalled();
    });

    test('its overview: its type, where it is reached, as whom, the pools on it opening their panel', async () => {
        render(<ArrayOverview name="pure1"/>, {wrapper: MemoryRouter});
        const pool = await screen.findByRole('button', {name: 'gold'});
        const facts = pool.closest('dl');
        expect(within(facts).getAllByRole('definition').map((d) => d.textContent))
            .toEqual(['pure', 'https://pure1.example.com/api', '1234', 'goldsilver']);
        fireEvent.click(pool);
        expect(mockPeek).toHaveBeenCalledWith('pool', 'gold');
    });

    test('its overview, an array gone: said', async () => {
        render(<ArrayOverview name="gone"/>, {wrapper: MemoryRouter});
        expect(await screen.findByText('No array gone.')).toBeInTheDocument();
    });

    // The cluster configuration changed, as the stream of the menu says it.
    const changed = () => act(() => useMenuState.setState({clusterConfig: {changed: Math.random()}}));
    const configReads = () => fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/cluster/config/file')).length;

    test('read again as the cluster configuration changes: an array and a pool added elsewhere shown', async () => {
        render(<Arrays/>, {wrapper: MemoryRouter});
        const list = await screen.findByRole('list', {name: 'Arrays'});
        items = [...items, {name: 'xt1', type: 'xtremio'}];
        config = CONFIG.concat('\n[pool#bronze]\ntype = pure\narray = pure1\n');
        changed();
        await waitFor(() => expect(cards(list).map((c) => c.getAttribute('data-array'))).toEqual(['emc1', 'pure1', 'xt1']));
        expect(cards(list)[1]).toHaveTextContent('3 pools on it');
    });

    test('a failed read again keeps the cards shown, no error', async () => {
        render(<Arrays/>, {wrapper: MemoryRouter});
        const list = await screen.findByRole('list', {name: 'Arrays'});
        fails = true;
        const before = configReads();
        changed();
        await waitFor(() => expect(configReads()).toBeGreaterThan(before));
        await act(async () => {});
        expect(cards(list).map((c) => c.getAttribute('data-array'))).toEqual(['emc1', 'pure1']);
        expect(screen.queryByText(/Could not read the arrays/)).toBeNull();
    });

    test('its overview read again as the cluster configuration changes, kept on a failure', async () => {
        render(<ArrayOverview name="pure1"/>, {wrapper: MemoryRouter});
        await screen.findByRole('button', {name: 'gold'});
        config = CONFIG.replace('api = https://pure1.example.com/api', 'api = https://pure2.example.com/api');
        changed();
        expect(await screen.findByText('https://pure2.example.com/api')).toBeInTheDocument();
        fails = true;
        const before = configReads();
        changed();
        await waitFor(() => expect(configReads()).toBeGreaterThan(before));
        await act(async () => {});
        expect(screen.getByText('https://pure2.example.com/api')).toBeInTheDocument();
        expect(screen.queryByText(/Could not read the arrays/)).toBeNull();
    });
});
