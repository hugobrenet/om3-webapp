import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {NetworkConfig, NetworkOverview, UsageRing, formatCount} from '../NetworkPanel';
import {act} from '@testing-library/react';
import {useMenuState} from '../../hooks/useSidebarAlerts';
import useEventStore from '../../hooks/useEventStore';

// The stream is tested on its own: here, the events a view claims.
const mockClaims = vi.hoisted(() => ({list: []}));
vi.mock('../../eventSourceManager', async (importOriginal) => ({
    ...(await importOriginal()),
    retainEventReception: (token, filters) => {
        mockClaims.list.push(filters);
        return () => {};
    },
}));

// The grants of the user: root deletes a network.
const mockGrants = vi.hoisted(() => ({value: {}}));
vi.mock('../../hooks/useGrants', () => ({useGrants: () => mockGrants.value}));
// The wizard, on its own tested elsewhere: here, what it is seeded with, and a save.
const mockWizard = vi.hoisted(() => ({props: null}));
vi.mock('../NetworkWizard', () => ({
    NetworkWizard: (props) => {
        mockWizard.props = props;
        return (
            <div role="dialog" aria-label="wizard">
                <button onClick={() => props.onSaved(props.edit.name)}>saved</button>
            </div>
        );
    },
}));
// The help of the keywords is tested with the file view: here, the section given it.
vi.mock('../ConfigText', () => ({
    ConfigText: ({text, label}) => <pre aria-label={label}>{text}</pre>,
}));

const FILE = `[cluster]
name = dev2

[network#backend3]
type = routed_bridge
network = 10.100.0.0/22

[network#huge]
type = routed_bridge
network = fd01::/64
`;

// The URL, to see what a click opened.
const Location = () => <div data-testid="search">{useLocation().search}</div>;
// A drilled-down record opens over the view (peek in the URL): a router around.
const renderIn = (ui) => render(<MemoryRouter initialEntries={['/network']}>{ui}<Location/></MemoryRouter>);

const NETWORKS = {
    backend3: {name: 'backend3', type: 'routed_bridge', network: '10.100.0.0/22', size: 1024, used: 3, free: 1021},
    huge: {name: 'huge', type: 'routed_bridge', network: 'fd01::/64', size: 18446744073709551616, used: 0, free: 18446744073709551615},
    default: {name: 'default', type: 'bridge', network: '10.22.0.0/16', size: 65536, used: 0, free: 65536},
};

const IPS = [
    {ip: '10.100.0.2', node: 'n1', path: 'a', rid: 'ip#1', network: {name: 'backend3'}},
    {ip: '10.100.0.3', node: 'n1', path: 'b', rid: 'ip#1', network: {name: 'backend3'}},
    {ip: '10.100.1.2', node: 'n2', path: 'c', rid: 'ip#1', network: {name: 'backend3'}},
    {ip: '10.22.0.2', node: 'n2', path: 'd', rid: 'ip#1', network: {name: 'default'}},
];

describe('the network panel', () => {
    let requests;
    let patchStatus;
    // The cluster configuration as read now: changed by someone else, said so.
    let file;

    beforeEach(() => {
        requests = [];
        patchStatus = 200;
        file = FILE;
        mockGrants.value = {};
        vi.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
            const u = String(url);
            requests.push({url: u, method: options.method ?? 'GET'});
            const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
            if (options.method === 'PATCH') return patchStatus === 200 ? json({}) : json({detail: 'locked'}, patchStatus);
            if (u.startsWith('/api/cluster/config/file')) return new Response(file, {status: 200});
            if (u.startsWith('/api/network/ip')) return json({items: IPS});
            if (u === '/api/node') return json({items: [{meta: {node: 'n1'}}, {meta: {node: 'n2'}}, {meta: {node: 'n3'}}]});
            if (u === '/api/network') return json({items: Object.values(NETWORKS)});
            if (u.startsWith('/api/network?name=')) {
                const name = decodeURIComponent(u.split('name=')[1]);
                return json({items: NETWORKS[name] ? [NETWORKS[name]] : []});
            }
            return json({}, 404);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('a count too large to be told exactly, as a power of two', () => {
        expect(formatCount(1024, 'en')).toBe('1,024');
        expect(formatCount(18446744073709551616, 'en')).toBe('≈ 2^64');
        expect(formatCount(undefined, 'en')).toBe('–');
    });

    test('the overview: a usage section of a ring alone, its share used, used and free in it; then the sketch', async () => {
        renderIn(<NetworkOverview name="backend3"/>);
        const usage = await screen.findByRole('region', {name: 'Usage'});
        expect(within(usage).getByRole('group', {name: 'Usage of backend3'})).toHaveTextContent('0.3%3 used1,021 free');
        // The ring a sliver, in the colour of a low usage; no other fact of the network in the section.
        expect(usage.querySelector('[data-usage-ring]')).toHaveAttribute('data-usage-ring', 'up');
        expect(usage.querySelectorAll('circle')).toHaveLength(2);
        expect(usage).not.toHaveTextContent('routed_bridge');
        expect(screen.queryByRole('region', {name: 'Network'})).toBeNull();
        await screen.findByRole('group', {name: /^Sketch of the network/});
    });

    test('the ring in the colour of the usage: none used, its track alone', () => {
        const {unmount} = render(<UsageRing used={0} size={256} free={256} label="u"/>);
        expect(document.querySelectorAll('circle')).toHaveLength(1);
        expect(screen.getByRole('group', {name: 'u'})).toHaveTextContent('0.0%0 used256 free');
        unmount();
        render(<UsageRing used={230} size={256} free={26} label="u"/>);
        expect(document.querySelector('[data-usage-ring]')).toHaveAttribute('data-usage-ring', 'down');
    });

    test('the sketch: the range over the nodes, a box a node with its subnet, routed between them, its objects under each opening their panel', async () => {
        renderIn(<NetworkOverview name="backend3"/>);
        // Every node of the cluster, n3 holding no address too.
        const sketch = await screen.findByRole('group', {name: /^Sketch of the network backend3 over 3 nodes/});
        expect(sketch.querySelector('[data-band]')).toHaveTextContent('backend3 · routed_bridge');
        expect(sketch.querySelector('[data-band]')).toHaveTextContent('network 10.100.0.0/22');
        expect([...sketch.querySelectorAll('[data-node]')].map((n) => n.getAttribute('data-node'))).toEqual(['n1', 'n2', 'n3']);
        expect(sketch.querySelector('[data-node=n3]')).toHaveTextContent('0 addresses');
        // No subnet set: the daemon's.
        expect(sketch.querySelector('[data-node=n1]')).toHaveTextContent('n1subnet chosen by the daemondev obr_backend32 addresses');
        // A pipe of two lines across the row, said a tunnel mesh after the last node.
        const route = sketch.querySelector('[data-route=tunnel]');
        expect(route.querySelectorAll('line')).toHaveLength(2);
        expect(route).toHaveTextContent('tunnel mesh');
        const objects = within(sketch).getAllByRole('button');
        expect(objects.map((o) => o.getAttribute('aria-label'))).toEqual(['a, 1 address on n1', 'b, 1 address on n1', 'c, 1 address on n2']);
        fireEvent.click(objects[2]);
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object');
        expect(decodeURIComponent(screen.getByTestId('search').textContent)).toContain('c');
    });

    test('read again as the cluster configuration changes: a subnet the daemon chose for a node shown, no reload of the page', async () => {
        renderIn(<NetworkOverview name="backend3"/>);
        const sketch = await screen.findByRole('group', {name: /^Sketch of the network backend3/});
        expect(sketch.querySelector('[data-node=n1]')).toHaveTextContent('subnet chosen by the daemon');
        // The daemon writes it to the cluster configuration, which the stream says.
        file = FILE.replace('network = 10.100.0.0/22\n', 'network = 10.100.0.0/22\nsubnet@n1 = 10.100.0.0/24\n');
        act(() => useMenuState.setState({clusterConfig: {nodes: ['n1', 'n2', 'n3']}}));
        await waitFor(() => expect(screen.getByRole('group', {name: /^Sketch of the network backend3/}).querySelector('[data-node=n1]'))
            .toHaveTextContent('subnet 10.100.0.0/24'));
    });

    test('read again as the networks polled change: the addresses handed out since shown', async () => {
        renderIn(<NetworkOverview name="backend3"/>);
        await screen.findByRole('group', {name: 'Usage of backend3'});
        NETWORKS.backend3 = {...NETWORKS.backend3, used: 4, free: 1020};
        try {
            act(() => useMenuState.setState({networks: Object.values(NETWORKS)}));
            await waitFor(() => expect(screen.getByRole('group', {name: 'Usage of backend3'})).toHaveTextContent('4 used1,020 free'));
        } finally {
            NETWORKS.backend3 = {...NETWORKS.backend3, used: 3, free: 1021};
        }
    });

    test('read again once the addresses the instances report change, a burst of them settled first; the status of the instances claimed', async () => {
        const ip = (ipaddr) => ({resources: {'ip#0': {status: ipaddr ? 'up' : 'down', type: 'ip.cni', info: ipaddr ? {ipaddr} : {}}}});
        localStorage.setItem('authToken', 'tok');
        useEventStore.setState({objectInstanceStatus: {'t/svc/a': {n1: ip('')}}});
        renderIn(<NetworkOverview name="backend3"/>);
        await screen.findByRole('group', {name: /^Sketch of the network backend3/});
        expect(mockClaims.list).toContainEqual(['InstanceStatusUpdated', 'InstanceStatusDeleted']);
        const reads = () => requests.filter((r) => r.url === '/api/network/ip').length;
        const before = reads();
        // Another state of the instance, no address: nothing read.
        act(() => useEventStore.setState({objectInstanceStatus: {'t/svc/a': {n1: {...ip(''), overall: 'warn'}}}}));
        // The address handed out, reported twice in a row: read once, after it settled.
        act(() => useEventStore.setState({objectInstanceStatus: {'t/svc/a': {n1: ip('10.100.0.9')}}}));
        act(() => useEventStore.setState({objectInstanceStatus: {'t/svc/a': {n1: ip('10.100.0.9')}, 't/svc/b': {n2: ip('10.100.1.9')}}}));
        expect(reads()).toBe(before);
        await waitFor(() => expect(reads()).toBe(before + 1), {timeout: 3000});
        await new Promise((resolve) => setTimeout(resolve, 1200));
        expect(reads()).toBe(before + 1);
        expect(requests.filter((r) => r.url.startsWith('/api/network?name=backend3')).length).toBeGreaterThanOrEqual(2);
        localStorage.removeItem('authToken');
    });

    test('an address reported by several nodes drawn once, a pill across the nodes, dashed over those not reporting it', async () => {
        global.fetch.mockImplementation(async (url) => {
            const u = String(url);
            const json = (body) => new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
            if (u.startsWith('/api/cluster/config/file')) return new Response('[network#san]\ntype = lan\nnetwork = fd01::/64\n', {status: 200});
            if (u.startsWith('/api/network/ip')) {
                return json({items: ['n1', 'n2'].map((node) => ({ip: 'fd01::5', node, path: 'svc11', rid: 'ip#1', network: {name: 'san'}}))});
            }
            if (u === '/api/node') return json({items: [{meta: {node: 'n1'}}, {meta: {node: 'n2'}}, {meta: {node: 'n3'}}]});
            return json({items: [{name: 'san', type: 'lan', network: 'fd01::/64', size: 256, used: 1, free: 255}]});
        });
        renderIn(<NetworkOverview name="san"/>);
        const sketch = await screen.findByRole('group', {name: /^Sketch of the network san/});
        const shared = within(sketch).getByRole('group', {name: '1 address on several nodes'});
        const pill = within(shared).getByRole('button', {name: 'svc11, 1 address on n1, n2'});
        expect([...pill.querySelectorAll('[data-segment]')].map((seg) => [seg.getAttribute('data-segment'), seg.hasAttribute('data-present')]))
            .toEqual([['n1', true], ['n2', true], ['n3', false]]);
        expect(pill.querySelector('[data-segment=n3] path[stroke-dasharray]')).not.toBeNull();
        expect(pill.querySelector('[data-segment=n1] path[stroke-dasharray]')).toBeNull();
        // No more marked than an object held on one node: its fill and line.
        expect(pill.querySelector('[data-segment=n1] path')).toHaveClass('fill-surface');
        expect(pill.querySelector('[data-segment=n1] path[fill=none]')).toHaveClass('stroke-line');
        expect(sketch.querySelector('[data-band]')).not.toHaveTextContent('svc11');
        expect(sketch.querySelector('[data-node=n1]')).toHaveTextContent('0 addresses1 shared');
        expect(within(sketch).getAllByRole('button')).toHaveLength(1);
        fireEvent.keyDown(pill, {key: 'Enter'});
        expect(decodeURIComponent(screen.getByTestId('search').textContent)).toContain('peek=object');
    });

    test('an IPv6 range, its sizes as powers of two', async () => {
        renderIn(<NetworkOverview name="huge"/>);
        expect(await screen.findByRole('group', {name: 'Usage of huge'})).toHaveTextContent('0.0%0 used≈ 2^64 free');
    });

    test('no delete on the overview, root or not: a tool of the configuration', async () => {
        mockGrants.value = {root: null};
        renderIn(<NetworkOverview name="backend3"/>);
        await screen.findByRole('group', {name: /^Sketch of the network/});
        expect(screen.queryByRole('button', {name: 'Delete the network'})).toBeNull();
    });

    test('root deletes it from the configuration: confirmed, said its addresses in use, its section deleted in one write', async () => {
        const {unmount} = renderIn(<NetworkConfig name="backend3"/>);
        await screen.findByLabelText('Configuration of the network backend3');
        expect(screen.queryByRole('button', {name: 'Delete the network'})).toBeNull();
        unmount();

        mockGrants.value = {root: null};
        const onDeleted = vi.fn();
        renderIn(<NetworkConfig name="backend3" onDeleted={onDeleted}/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Delete the network'}));
        const dialog = screen.getByRole('dialog', {name: 'Delete the network backend3?'});
        expect(await within(dialog).findByText('3 addresses of it are in use: the resources holding them lose their network.')).toBeInTheDocument();
        expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete the network'}));
        await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('backend3'));
        expect(requests.filter((r) => r.method === 'PATCH')).toEqual([{method: 'PATCH', url: '/api/cluster/config?delete=network%23backend3'}]);
    });

    test('a delete refused said, the dialog kept', async () => {
        mockGrants.value = {root: null};
        patchStatus = 409;
        const onDeleted = vi.fn();
        renderIn(<NetworkConfig name="backend3" onDeleted={onDeleted}/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Delete the network'}));
        const dialog = screen.getByRole('dialog', {name: 'Delete the network backend3?'});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete the network'}));
        expect(await within(dialog).findByText('Not deleted: locked')).toBeInTheDocument();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    test('a built-in network, of no section, has none to delete', async () => {
        mockGrants.value = {root: null};
        renderIn(<NetworkConfig name="default"/>);
        await screen.findByRole('button', {name: 'Edit the configuration of the network default'});
        expect(screen.queryByRole('button', {name: 'Delete the network'})).toBeNull();
    });

    test('root edits the section in place, its header fixed: written as the keys changed and those gone, in one write', async () => {
        const {unmount} = renderIn(<NetworkConfig name="backend3"/>);
        await screen.findByLabelText('Configuration of the network backend3');
        expect(screen.queryByRole('button', {name: 'Edit the configuration of the network backend3'})).toBeNull();
        unmount();

        mockGrants.value = {root: null};
        renderIn(<NetworkConfig name="backend3"/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Edit the configuration of the network backend3'}));
        const editor = await screen.findByRole('textbox', {name: 'Configuration of the network backend3'});
        expect(editor).toHaveValue('type = routed_bridge\nnetwork = 10.100.0.0/22');
        expect(screen.getByText('[network#backend3]')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();

        // A line that is no key = value: said, nothing written.
        fireEvent.change(editor, {target: {value: 'type = routed_bridge\nnetwork 10.100.0.0/22'}});
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        expect(await screen.findByText('Not a key = value line: network 10.100.0.0/22')).toBeInTheDocument();
        expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);

        fireEvent.change(editor, {target: {value: 'type = routed_bridge\nsubnet@n1 = 10.100.0.0/24\ntunnel = always'}});
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        await waitFor(() => expect(requests.filter((r) => r.method === 'PATCH')).toEqual([{
            method: 'PATCH',
            url: '/api/cluster/config?set=network%23backend3.subnet%40n1%3D10.100.0.0%2F24&set=network%23backend3.tunnel%3Dalways&unset=network%23backend3.network',
        }]));
        // Written: the section shown again, read anew.
        expect(await screen.findByLabelText('Configuration of the network backend3')).toBeInTheDocument();
    });

    test('a section changed since the edit started not overwritten', async () => {
        mockGrants.value = {root: null};
        renderIn(<NetworkConfig name="backend3"/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Edit the configuration of the network backend3'}));
        const editor = await screen.findByRole('textbox', {name: 'Configuration of the network backend3'});
        fireEvent.change(editor, {target: {value: 'type = routed_bridge\nnetwork = 10.100.0.0/21'}});
        file = FILE.replace('network = 10.100.0.0/22', 'network = 10.100.0.0/23');
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        expect(await screen.findByText(/changed by someone else/)).toBeInTheDocument();
        expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);
        expect(editor).toHaveValue('type = routed_bridge\nnetwork = 10.100.0.0/21');
    });

    test('root modifies the network in the wizard, seeded with its section, the networks and the nodes', async () => {
        mockGrants.value = {root: null};
        renderIn(<NetworkConfig name="backend3"/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Modify the network backend3 in the wizard'}));
        const wizard = await screen.findByRole('dialog', {name: 'wizard'});
        expect(mockWizard.props.edit).toEqual({name: 'backend3', values: {type: 'routed_bridge', network: '10.100.0.0/22'}});
        expect(mockWizard.props.networks.map((n) => n.name)).toEqual(['backend3', 'huge', 'default']);
        expect(mockWizard.props.nodes).toEqual(['n1', 'n2', 'n3']);
        const reads = requests.filter((r) => r.url.startsWith('/api/cluster/config/file')).length;
        fireEvent.click(within(wizard).getByRole('button', {name: 'saved'}));
        expect(screen.queryByRole('dialog', {name: 'wizard'})).toBeNull();
        // Saved: the section read again.
        await waitFor(() => expect(requests.filter((r) => r.url.startsWith('/api/cluster/config/file')).length).toBeGreaterThan(reads));
    });

    test('a built-in network: no section to seed the wizard with', async () => {
        mockGrants.value = {root: null};
        renderIn(<NetworkConfig name="default"/>);
        await screen.findByRole('button', {name: 'Edit the configuration of the network default'});
        expect(screen.queryByRole('button', {name: 'Modify the network default in the wizard'})).toBeNull();
    });

    test('a built-in network given a section of its own by root', async () => {
        mockGrants.value = {root: null};
        renderIn(<NetworkConfig name="default"/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Edit the configuration of the network default'}));
        const editor = await screen.findByRole('textbox', {name: 'Configuration of the network default'});
        expect(editor).toHaveValue('');
        fireEvent.change(editor, {target: {value: 'network = 10.30.0.0/16'}});
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        await waitFor(() => expect(requests.filter((r) => r.method === 'PATCH')).toEqual([{
            method: 'PATCH', url: '/api/cluster/config?set=network%23default.network%3D10.30.0.0%2F16',
        }]));
    });

    test('the configuration: its section; a built-in one said so', async () => {
        const {unmount} = renderIn(<NetworkConfig name="backend3"/>);
        expect(await screen.findByLabelText('Configuration of the network backend3'))
            .toHaveTextContent('[network#backend3] type = routed_bridge network = 10.100.0.0/22');
        unmount();
        renderIn(<NetworkConfig name="default"/>);
        expect(await screen.findByText('default is built in: no section of the cluster configuration defines it.')).toBeInTheDocument();
    });
});
