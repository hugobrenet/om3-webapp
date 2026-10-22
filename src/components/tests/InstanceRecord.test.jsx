import React from 'react';
import {render, screen, within, act, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import {InstanceDetailPanel, InstanceStatus, InstanceUsage, ObjectUsage, ResourceDetailPanel, ResourceStatus} from '../InstanceRecord';
import useEventStore from '../../hooks/useEventStore';
import {PG_POLL_MS, resetPgUsage} from '../../hooks/usePgUsage';

// The logs stream is tested on its own: here, the nodes, the instance and the matches it reads.
vi.mock('../LogsViewer', () => ({
    default: ({nodenames = [], namespace, kind, instanceName, filters = []}) => (
        <div data-testid="logs">{`${namespace}/${kind}/${instanceName} on ${nodenames.join('+')}${filters.length ? ` where ${filters.join(', ')}` : ''}`}</div>
    ),
}));
// The container logs are tested on their own: here, the container and the nodes it reads.
vi.mock('../ContainerLogs', async (importOriginal) => ({
    ...(await importOriginal()),
    ContainerLogs: ({path, rid, nodes, upNodes}) => (
        <div data-testid="container-logs">{`${path} ${rid} on ${nodes.join('+')}, up on ${upNodes.join('+')}`}</div>
    ),
}));
// The configuration tab is tested on its own: here, the object and the section it shows.
vi.mock('../ObjectConfig', () => ({
    default: ({path, section}) => <div data-testid="config">{`${path} [${section}]`}</div>,
}));
// The confirmation dialogs are tested on their own: here, the action confirmed.
vi.mock('../ActionDialogManager', () => ({
    default: ({pendingAction, handleConfirm, target}) => (pendingAction === null ? null : (
        <div role="alertdialog" aria-label={`${pendingAction.action} ${target}`}>
            <button type="button" onClick={() => handleConfirm(pendingAction.action)}>Confirm</button>
        </div>
    )),
}));
vi.mock('../../utils/logger.js', () => ({
    default: {error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn()},
}));

const MiB = 1024 * 1024;

const page = (usec, memory, max = '+Inf') => [
    `opensvc_pg_cgroup_cpu_usage_usec{namespace="prod",path="prod/svc/web"} ${usec}`,
    `opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/web"} ${memory}`,
    `opensvc_pg_cgroup_memory_max_bytes{namespace="prod",path="prod/svc/web"} ${max}`,
].join('\n');

let pages;

const Search = () => <span data-testid="search">{useLocation().search}</span>;
const inRouter = (element) => render(<MemoryRouter initialEntries={['/objects']}>{element}<Search/></MemoryRouter>);
const nextReading = () => act(async () => {
    await vi.advanceTimersByTimeAsync(PG_POLL_MS);
});
const tile = (label) => screen.getByText(label, {selector: 'dt'}).nextElementSibling;

beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    resetPgUsage();
    localStorage.setItem('authToken', 'tok');
    useEventStore.setState({
        objectInstanceStatus: {
            'prod/svc/web': {
                n1: {
                    avail: 'up', overall: 'warn', provisioned: 'true', frozen_at: '0001-01-01T00:00:00Z',
                    resources: {
                        'fs#1': {status: 'up', type: 'fs.flag', label: 'flag', datastores: ['prod/sec/web', 'prod/cfg/web']},
                        'app#1': {status: 'down', type: 'app.simple', label: 'run', provisioned: {state: 'false'}, optional: true,
                            log: [{level: 'info', message: 'started'}, {level: 'error', message: 'exit 1'}], datastores: ['prod/cfg/web']},
                    },
                },
                n2: {avail: 'down', overall: 'down', provisioned: 'false', frozen_at: '2026-10-16T10:00:00Z', resources: {}},
                n3: {avail: 'down', resources: {}},
            },
        },
        instanceMonitor: {'n1:prod/svc/web': {state: 'idle'}},
        nodeStatus: {},
    });
    pages = {n1: [page(0, MiB, 64 * MiB)], n2: [page(0, 2 * MiB)], n3: ['']};
    global.fetch = vi.fn((url) => {
        if (url === '/api/object/path/prod/svc/web/resource/info') {
            const item = (node, rid, key, value) => ({node, rid, key, value});
            return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({kind: 'ResourceInfoList', items: [
                item('n1', 'app#1', 'pid', '42'),
                item('n2', 'app#1', 'pid', '43'),
                item('n1', 'fs#1', 'mnt', '/srv'),
            ]})});
        }
        const node = /\/api\/node\/name\/([^/]+)\/metrics\/pg$/.exec(url)?.[1];
        const list = pages[node];
        if (!list) return Promise.resolve({ok: false, status: 404, text: () => Promise.resolve('')});
        if (list.length > 1) list.shift();
        return Promise.resolve({ok: true, status: 200, text: () => Promise.resolve(list[0])});
    });
});

afterEach(() => {
    resetPgUsage();
    vi.useRealTimers();
    localStorage.clear();
});

describe('ObjectUsage', () => {
    test('the object summed over its instances, then each instance by node', async () => {
        inRouter(<ObjectUsage path="prod/svc/web"/>);
        const table = await screen.findByRole('table', {name: 'Usage by instance'});
        // Its instance nodes only are read.
        expect(global.fetch.mock.calls.map(([url]) => url).sort()).toEqual([
            '/api/node/name/n1/metrics/pg', '/api/node/name/n2/metrics/pg', '/api/node/name/n3/metrics/pg',
        ]);
        const rows = within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
        // n3 has no cgroup for it: dashes.
        expect(rows).toEqual([
            ['on n1', '-', '1.0 MiB', '64.0 MiB'],
            ['on n2', '-', '2.0 MiB', 'unlimited'],
            ['on n3', '-', '-', '-'],
        ]);
        expect(tile('Memory')).toHaveTextContent('3.0 MiB');
        expect(tile('Limit')).toHaveTextContent('unlimited');
        // Half a cpu on n1, a quarter on n2.
        pages.n1.push(page(PG_POLL_MS * 500, MiB, 64 * MiB));
        pages.n2.push(page(PG_POLL_MS * 250, 2 * MiB));
        await nextReading();
        expect(Math.abs(parseFloat(tile('CPU').textContent) - 75)).toBeLessThan(3);
    });

    test('each node the badge of its instance, opening it over the view', async () => {
        inRouter(<ObjectUsage path="prod/svc/web"/>);
        await screen.findByRole('table', {name: 'Usage by instance'});
        fireEvent.click(screen.getByRole('button', {name: 'on n2'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=instance%3Aprod%2Fsvc%2Fweb%40n2');
    });
});

describe('InstanceUsage', () => {
    test('the cgroup of the instance on its node alone', async () => {
        inRouter(<InstanceUsage path="prod/svc/web" node="n2"/>);
        expect(await screen.findByText('2.0 MiB')).toBeInTheDocument();
        expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/node/name/n2/metrics/pg']);
        expect(tile('Limit')).toHaveTextContent('unlimited');
    });

    test('no cgroup for it on its node: said so', async () => {
        inRouter(<InstanceUsage path="prod/svc/web" node="n3"/>);
        expect(await screen.findByText('No cgroup for this instance on n3.')).toBeInTheDocument();
    });
});

describe('InstanceStatus', () => {
    test('the state of the instance as its node reports it, then its resources', () => {
        inRouter(<InstanceStatus path="prod/svc/web" node="n1"/>);
        const fact = (label) => screen.getByText(label, {selector: 'dt'}).nextElementSibling;
        expect(fact('Avail')).toHaveTextContent('up');
        expect(fact('Overall')).toHaveTextContent('warn');
        expect(fact('Frozen')).toHaveTextContent('no');
        expect(fact('Monitor')).toHaveTextContent('idle');
        const rows = within(screen.getByRole('table', {name: 'Resources of the instance'})).getAllByRole('row').slice(1);
        expect(rows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual(['app#1', 'fs#1']);
        expect(within(rows[0]).getByRole('img', {name: 'Not provisioned'})).toBeInTheDocument();
        // Its object, its node and its resources, badges opening their records.
        fireEvent.click(within(fact('Object')).getByRole('button', {name: 'prod/svc/web'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object%3Aprod%2Fsvc%2Fweb');
        fireEvent.click(within(fact('Node')).getByRole('button', {name: 'n1'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=node%3An1');
        fireEvent.click(within(rows[0]).getByRole('button', {name: 'app#1'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=resource%3Aprod%2Fsvc%2Fweb%3Aapp%231');
    });

    test('the datastores its resources use, once each, a badge each opening its object', () => {
        inRouter(<InstanceStatus path="prod/svc/web" node="n1"/>);
        const fact = screen.getByText('Datastores', {selector: 'dt'}).nextElementSibling;
        expect(within(fact).getAllByRole('button').map((b) => b.textContent)).toEqual(['prod/cfg/web', 'prod/sec/web']);
        fireEvent.click(within(fact).getByRole('button', {name: 'prod/sec/web'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object%3Aprod%2Fsec%2Fweb');
    });

    test('the volumes its resources use, a badge each opening its object', () => {
        useEventStore.setState((state) => ({objectInstanceStatus: {'prod/svc/web': {
            ...state.objectInstanceStatus['prod/svc/web'],
            n1: {
                ...state.objectInstanceStatus['prod/svc/web'].n1,
                resources: {
                    ...state.objectInstanceStatus['prod/svc/web'].n1.resources,
                    'volume#1': {status: 'up', type: 'volume', label: 'data', volumes: ['prod/vol/data']},
                },
            },
        }}}));
        inRouter(<InstanceStatus path="prod/svc/web" node="n1"/>);
        const fact = screen.getByText('Volumes', {selector: 'dt'}).nextElementSibling;
        expect(within(fact).getAllByRole('button').map((b) => b.textContent)).toEqual(['prod/vol/data']);
        fireEvent.click(within(fact).getByRole('button', {name: 'prod/vol/data'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object%3Aprod%2Fvol%2Fdata');
        // The volume of a volume resource, in its own status too.
        inRouter(<ResourceStatus path="prod/svc/web" rid="volume#1"/>);
        const facts = screen.getAllByText('Volumes', {selector: 'dt'});
        expect(within(facts.at(-1).nextElementSibling).getByRole('button', {name: 'prod/vol/data'})).toBeInTheDocument();
    });

    test('no datastore, no line', () => {
        inRouter(<InstanceStatus path="prod/svc/web" node="n2"/>);
        expect(screen.queryByText('Datastores', {selector: 'dt'})).toBeNull();
        expect(screen.queryByText('Volumes', {selector: 'dt'})).toBeNull();
    });

    test('its actions: freeze as it is not frozen, each confirmed then posted to the instance', async () => {
        inRouter(<InstanceStatus path="prod/svc/web" node="n1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Instance actions'}));
        const menu = screen.getByRole('menu', {name: 'Instance actions'});
        expect(within(menu).getByRole('menuitem', {name: 'Freeze'})).toBeInTheDocument();
        expect(within(menu).queryByRole('menuitem', {name: 'Unfreeze'})).toBeNull();
        expect(within(menu).queryByRole('menuitem', {name: /Clear/})).toBeNull();
        fireEvent.click(within(menu).getByRole('menuitem', {name: 'Start'}));
        fireEvent.click(within(screen.getByRole('alertdialog', {name: 'start prod/svc/web on n1'})).getByRole('button', {name: 'Confirm'}));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/api/node/name/n1/instance/path/prod/svc/web/action/start',
            expect.objectContaining({method: 'POST'}),
        ));
    });

    test('the resources checked, the actions they all take, posted to the instance for them', async () => {
        inRouter(<InstanceStatus path="prod/svc/web" node="n1"/>);
        expect(screen.getByText('Check resources to select them.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select app#1'}));
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select fs#1'}));
        fireEvent.click(screen.getByRole('button', {name: 'Actions on 2 resources'}));
        const menu = screen.getByRole('menu', {name: 'Actions on 2 resources'});
        // No task among them: nothing to run; more than one: no console.
        expect(within(menu).queryByRole('menuitem', {name: 'Run'})).toBeNull();
        fireEvent.click(within(menu).getByRole('menuitem', {name: 'Stop'}));
        fireEvent.click(within(screen.getByRole('alertdialog', {name: 'stop app#1, fs#1 of prod/svc/web on n1'})).getByRole('button', {name: 'Confirm'}));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/api/node/name/n1/instance/path/prod/svc/web/action/stop?rid=app%231%2Cfs%231',
            expect.objectContaining({method: 'POST'}),
        ));
        // Done, the selection is cleared.
        await waitFor(() => expect(screen.getByRole('checkbox', {name: 'Select app#1'})).not.toBeChecked());
    });

    test('its status refreshed on its node, no confirmation', async () => {
        inRouter(<InstanceStatus path="prod/svc/web" node="n1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Refresh the status'}));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/api/node/name/n1/instance/path/prod/svc/web/action/status',
            expect.objectContaining({method: 'POST'}),
        ));
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    test('frozen, not provisioned', () => {
        inRouter(<InstanceStatus path="prod/svc/web" node="n2"/>);
        const fact = (label) => screen.getByText(label, {selector: 'dt'}).nextElementSibling;
        expect(fact('Frozen')).toHaveTextContent('yes');
        expect(within(fact('Provisioned')).getByRole('img', {name: 'Not provisioned'})).toBeInTheDocument();
        expect(screen.getByText('No resource.')).toBeInTheDocument();
    });
});

describe('InstanceDetailPanel', () => {
    test('titled by its object and its node, its status then its usage', () => {
        const onTabChange = vi.fn();
        render(<MemoryRouter><InstanceDetailPanel id="prod/svc/web@n1" tab={undefined} onTabChange={onTabChange} onClose={vi.fn()}/></MemoryRouter>);
        const panel = screen.getByRole('dialog', {name: 'prod/svc/web @ n1'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Status', 'Resources', 'Usage', 'Logs']);
        expect(within(panel).getByTestId('instance-status')).toBeInTheDocument();
        fireEvent.click(within(panel).getByRole('tab', {name: 'Usage'}));
        expect(onTabChange).toHaveBeenCalledWith('usage');
    });

    test('its resources tab: what its resources report on its node alone, a table each', async () => {
        render(<MemoryRouter><InstanceDetailPanel id="prod/svc/web@n1" tab="resources" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
        const panel = screen.getByRole('dialog', {name: 'prod/svc/web @ n1'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Status', 'Resources', 'Usage', 'Logs']);
        const table = await within(panel).findByRole('table', {name: 'Resource information'});
        expect(within(panel).getAllByRole('table')).toHaveLength(1);
        // A line opening each resource, its badge.
        expect([...table.querySelectorAll('[data-resource-row]')].map((row) => row.textContent)).toEqual(['app#1', 'fs#1']);
        expect(within(table).getByRole('button', {name: 'fs#1'})).toBeInTheDocument();
        // n1 alone: n2's value of app#1 left out.
        expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Key', 'on n1']);
        expect(within(table).getByRole('row', {name: /pid/})).toHaveTextContent('pid42');
    });

    test('its logs tab: the logs of the instance on its node alone', () => {
        render(<MemoryRouter><InstanceDetailPanel id="prod/svc/web@n1" tab="logs" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
        expect(screen.getByTestId('logs')).toHaveTextContent(/^prod\/svc\/web on n1$/);
    });

    test('closes once its instance is gone', () => {
        const onClose = vi.fn();
        render(<MemoryRouter><InstanceDetailPanel id="prod/svc/web@n1" onTabChange={vi.fn()} onClose={onClose}/></MemoryRouter>);
        act(() => useEventStore.setState({objectInstanceStatus: {'prod/svc/web': {n2: {}}}}));
        expect(onClose).toHaveBeenCalled();
    });
});

describe('ResourceStatus', () => {
    test('the resource on each node reporting it: status, flags, label, last message; badges to its object and instances', () => {
        // On n4 too; not on n2 nor n3.
        useEventStore.setState((state) => ({objectInstanceStatus: {'prod/svc/web': {
            ...state.objectInstanceStatus['prod/svc/web'],
            n4: {avail: 'up', resources: {'app#1': {status: 'up', type: 'app.simple', label: 'run'}}},
        }}}));
        inRouter(<ResourceStatus path="prod/svc/web" rid="app#1"/>);
        const fact = (label) => screen.getByText(label, {selector: 'dt'}).nextElementSibling;
        expect(fact('Type')).toHaveTextContent('app.simple');
        const rows = within(screen.getByRole('table', {name: 'The resource on each node'})).getAllByRole('row').slice(1)
            .map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
        expect(rows).toEqual([
            ['on n1', 'downdownP', 'optional', 'run', 'exit 1'],
            ['on n4', 'upup', '-', 'run', '-'],
        ]);
        fireEvent.click(screen.getByRole('button', {name: 'on n4'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=instance%3Aprod%2Fsvc%2Fweb%40n4');
        fireEvent.click(within(fact('Object')).getByRole('button', {name: 'prod/svc/web'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object%3Aprod%2Fsvc%2Fweb');
    });

    test('the instances holding the resource refreshed whole, each on its node', async () => {
        useEventStore.setState((state) => ({objectInstanceStatus: {'prod/svc/web': {
            ...state.objectInstanceStatus['prod/svc/web'],
            n4: {avail: 'up', resources: {'app#1': {status: 'up', type: 'app.simple'}}},
        }}}));
        inRouter(<ResourceStatus path="prod/svc/web" rid="app#1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Refresh the status of all the instances'}));
        await waitFor(() => expect(global.fetch.mock.calls.map(([url]) => url).filter((url) => url.endsWith('/action/status'))).toEqual([
            '/api/node/name/n1/instance/path/prod/svc/web/action/status',
            '/api/node/name/n4/instance/path/prod/svc/web/action/status',
        ]));
    });

    test('the datastores the resource uses on any node, a badge each', () => {
        inRouter(<ResourceStatus path="prod/svc/web" rid="app#1"/>);
        const fact = screen.getByText('Datastores', {selector: 'dt'}).nextElementSibling;
        expect(within(fact).getAllByRole('button').map((b) => b.textContent)).toEqual(['prod/cfg/web']);
    });

    test('its configuration tab: its section of the configuration of the object', () => {
        render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1" tab="config" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
        expect(screen.getByTestId('config')).toHaveTextContent('prod/svc/web [app#1]');
    });

    test('a container: what it writes in a tab of its own, on the nodes it is on, up first', () => {
        useEventStore.setState({objectInstanceStatus: {'prod/svc/web': {
            n1: {avail: 'down', resources: {'container#1': {status: 'down', type: 'container.docker'}}},
            n2: {avail: 'up', resources: {'container#1': {status: 'up', type: 'container.docker'}}},
            n3: {avail: 'up', resources: {'app#1': {status: 'up', type: 'app.simple'}}},
        }}});
        render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:container#1" tab="container" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
        const panel = screen.getByRole('dialog', {name: 'container#1 of prod/svc/web'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Status', 'Info', 'Logs', 'Container logs', 'Configuration']);
        expect(screen.getByTestId('container-logs')).toHaveTextContent('prod/svc/web container#1 on n1+n2, up on n2');
    });

    test('a resource not a container: no container logs', () => {
        render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1" tab="container" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
        const panel = screen.getByRole('dialog', {name: 'app#1 of prod/svc/web'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).not.toContain('Container logs');
        expect(screen.queryByTestId('container-logs')).not.toBeInTheDocument();
    });

    test('its logs tab: the logs of the object on all its nodes, merged, of the resource alone', () => {
        render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1" tab="logs" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
        expect(screen.getByTestId('logs')).toHaveTextContent(/^prod\/svc\/web on n1\+n2\+n3 where RID=app#1$/);
    });

    test('its info tab: what the resource alone reports on each node, its table without title nor filter', async () => {
        render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1" tab="info" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
        const panel = screen.getByRole('dialog', {name: 'app#1 of prod/svc/web'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Status', 'Info', 'Logs', 'Configuration']);
        const table = await within(panel).findByRole('table', {name: 'Resource information'});
        expect(within(panel).getAllByRole('table')).toHaveLength(1);
        expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Key', 'on n1', 'on n2']);
        // Its line, then its keys; fs#1 left out.
        expect([...table.querySelectorAll('[data-resource-row]')].map((row) => row.textContent)).toEqual(['app#1']);
        expect(within(table).getByRole('row', {name: /pid/})).toHaveTextContent('pid4243');
        // The full text filter kept.
        expect(within(panel).getByRole('searchbox', {name: 'Filter the resources'})).toBeInTheDocument();
    });

    test('its panel titled by the resource and its object, closed once the object is gone', () => {
        const onClose = vi.fn();
        render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1" onClose={onClose}/></MemoryRouter>);
        expect(screen.getByRole('dialog', {name: 'app#1 of prod/svc/web'})).toBeInTheDocument();
        act(() => useEventStore.setState({objectInstanceStatus: {}}));
        expect(onClose).toHaveBeenCalled();
    });

    describe('on the instance of one node', () => {
        test('titled by the resource, its object and its node; its status there alone, the instance a badge', () => {
            useEventStore.setState((state) => ({objectInstanceStatus: {'prod/svc/web': {
                ...state.objectInstanceStatus['prod/svc/web'],
                n4: {avail: 'up', resources: {'app#1': {status: 'up', type: 'app.simple', label: 'run'}}},
            }}}));
            inRouter(<ResourceDetailPanel id="prod/svc/web:app#1@n4" onTabChange={vi.fn()} onClose={vi.fn()}/>);
            const panel = screen.getByRole('dialog', {name: 'app#1 of prod/svc/web on n4'});
            const rows = within(within(panel).getByRole('table', {name: 'The resource on each node'})).getAllByRole('row').slice(1)
                .map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
            expect(rows).toEqual([['on n4', 'upup', '-', 'run', '-']]);
            const instance = within(panel).getByText('Instance', {selector: 'dt'}).nextElementSibling;
            fireEvent.click(within(instance).getByRole('button', {name: 'on n4'}));
            expect(screen.getByTestId('search')).toHaveTextContent('peek=instance%3Aprod%2Fsvc%2Fweb%40n4');
        });

        test('its info and its logs, of that node alone', async () => {
            const {unmount} = render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1@n2" tab="info" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
            const table = await screen.findByRole('table', {name: 'Resource information'});
            expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Key', 'on n2']);
            expect(within(table).getByRole('row', {name: /pid/})).toHaveTextContent('pid43');
            unmount();
            render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1@n2" tab="logs" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
            expect(screen.getByTestId('logs')).toHaveTextContent(/^prod\/svc\/web on n2 where RID=app#1$/);
        });

        test('a container: what it writes on that node alone', () => {
            useEventStore.setState({objectInstanceStatus: {'prod/svc/web': {
                n1: {avail: 'down', resources: {'container#1': {status: 'down', type: 'container.docker'}}},
                n2: {avail: 'up', resources: {'container#1': {status: 'up', type: 'container.docker'}}},
            }}});
            render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:container#1@n1" tab="container" onTabChange={vi.fn()} onClose={vi.fn()}/></MemoryRouter>);
            expect(screen.getByTestId('container-logs')).toHaveTextContent('prod/svc/web container#1 on n1, up on');
        });

        test('closed once its instance is gone, the others kept', () => {
            const onClose = vi.fn();
            render(<MemoryRouter><ResourceDetailPanel id="prod/svc/web:app#1@n1" onClose={onClose}/></MemoryRouter>);
            act(() => useEventStore.setState((state) => {
                const {n1, ...others} = state.objectInstanceStatus['prod/svc/web'];
                return {objectInstanceStatus: {'prod/svc/web': others}};
            }));
            expect(onClose).toHaveBeenCalled();
        });
    });
});
