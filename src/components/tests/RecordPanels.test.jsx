import React from 'react';
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import {PeekPanel} from '../PeekPanel';

// The record contents, tested on their own: here, what each panel hands them.
vi.mock('../ObjectDetails', () => ({
    default: ({path, embedded}) => (
        <div data-testid="object-details" data-embedded={String(embedded)}>{path}</div>
    ),
}));
// The board is tested on its own: here, what a click on the value of a resource on a node opens.
vi.mock('../ObjectStatus', () => ({default: ({path, openCell}) => (
    <div data-testid="object-status">
        {path}
        <button type="button" onClick={() => openCell('fs#1', 'n2')}>fs#1 on n2</button>
    </div>
)}));
vi.mock('../ObjectConfig', () => ({default: ({path}) => <div data-testid="object-config">{path}</div>}));
// The locks of the cluster are tested on their own: here, where they show.
vi.mock('../ClusterLocks', () => ({ClusterLocks: () => <div data-testid="cluster-locks">locks</div>}));
vi.mock('../ObjectSnapshots', async (importOriginal) => ({
    ...(await importOriginal()),
    ObjectSnapshots: ({path}) => <div data-testid="object-snapshots">{path}</div>,
}));
// The capacity tab is tested on its own: here, the object and the nodes it is shown for.
vi.mock('../ObjectCapacity', () => ({
    CAPACITY_KINDS: ['svc', 'vol'],
    ObjectCapacity: ({path, nodes}) => <div data-testid="object-capacity">{`${path} on ${nodes.join('+')}`}</div>,
}));
vi.mock('../ObjectTabs', () => ({
    ObjectResources: ({path}) => <div data-testid="object-resources">{path}</div>,
    ObjectSchedules: ({path}) => <div data-testid="object-schedules">{path}</div>,
}));
vi.mock('../NetworkDetails', () => ({default: ({name}) => <div data-testid="network-details">{name}</div>}));
vi.mock('../StorePanel', () => ({
    StoreOverview: ({name}) => <div data-testid="store-overview">{name}</div>,
    StoreSnapshots: ({name}) => <div data-testid="store-snapshots">{name}</div>,
    StoreConfig: ({name}) => <div data-testid="store-config">{name}</div>,
}));
vi.mock('../PoolPanel', () => ({
    PoolOverview: ({name}) => <div data-testid="pool-overview">{name}</div>,
    PoolVolumes: ({name}) => <div data-testid="pool-volumes">{name}</div>,
    PoolConfig: ({name}) => <div data-testid="pool-config">{name}</div>,
}));
vi.mock('../NetworkPanel', () => ({
    NetworkOverview: ({name}) => <div data-testid="network-overview">{name}</div>,
    NetworkConfig: ({name}) => <div data-testid="network-config">{name}</div>,
}));
vi.mock('../NamespacePanel', () => ({
    NamespaceUsage: ({namespace}) => <div data-testid="namespace-usage">{namespace}</div>,
    NamespaceConfig: ({namespace}) => <div data-testid="namespace-config">{namespace}</div>,
}));
vi.mock('../NamespaceClaims', () => ({
    NamespaceClaims: ({namespace}) => <div data-testid="namespace-claims">{namespace}</div>,
}));
vi.mock('../EventLogger', () => ({
    OBJECT_EVENT_TYPES: ['ObjectStatusUpdated'],
    EventLog: ({objectName, namespace}) => <div data-testid="events">{objectName ? `events of ${objectName}` : `events in ${namespace}`}</div>,
}));
vi.mock('../LogsViewer', () => ({
    default: ({nodenames = [], type, namespace, kind, instanceName}) => (
        <div data-testid="logs">{`${type} ${namespace}/${kind}/${instanceName} on ${nodenames.join('+')}`}</div>
    ),
}));
/** The event store, as small as the panels need: a state, changed by the tests. */
const store = vi.hoisted(() => {
    const initial = {objectInstanceStatus: {'ns1/svc/web': {node1: {}, node2: {}}}, objectStatus: {}};
    let state = initial;
    const listeners = new Set();
    return {
        get: () => state,
        set: (next) => {
            state = {...state, ...next};
            listeners.forEach((listener) => listener());
        },
        reset: () => {
            state = initial;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
});
vi.mock('../../hooks/useEventStore.js', async () => {
    const {useSyncExternalStore} = await import('react');
    return {default: (selector) => selector(useSyncExternalStore(store.subscribe, store.get))};
});

const mockGrants = vi.hoisted(() => ({value: {}}));
vi.mock('../../hooks/useGrants', () => ({
    useGrants: () => mockGrants.value,
    useIsRoot: () => Object.prototype.hasOwnProperty.call(mockGrants.value, 'root'),
}));

/** The panels open: a closed one stays mounted for its animation, inert. */
const openDialogs = () => screen.queryAllByRole('dialog').filter((d) => !d.hasAttribute('inert'));

function Search() {
    return <output data-testid="search">{decodeURIComponent(useLocation().search)}</output>;
}

const renderPeek = (url) => render(
    <MemoryRouter initialEntries={[url]}>
        <PeekPanel/>
        <Search/>
    </MemoryRouter>
);

describe('record panels', () => {
    beforeEach(() => {
        sessionStorage.clear();
        store.reset();
    });

    test('an object deleted or purged closes its panel', () => {
        store.set({objectStatus: {'ns1/svc/web': {avail: 'up'}}});
        renderPeek('/nodes?peek=object:ns1/svc/web');
        expect(openDialogs()).toHaveLength(1);
        act(() => store.set({objectStatus: {}}));
        expect(openDialogs()).toHaveLength(0);
        expect(screen.getByTestId('search')).toHaveTextContent(/^$/);
    });

    test('an object the store does not hold yet keeps its panel', () => {
        renderPeek('/nodes?peek=object:ns1/svc/web');
        act(() => store.set({objectStatus: {'ns1/svc/other': {avail: 'up'}}}));
        expect(openDialogs()).toHaveLength(1);
    });

    test('a service opens on its status board, its usage, schedules, logs and configuration on tabs of their own', () => {
        renderPeek('/nodes?peek=object:ns1/svc/web');
        const panel = screen.getByRole('dialog', {name: 'ns1/svc/web'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Status', 'Usage', 'Capacity', 'Schedules', 'Configuration', 'Logs', 'Events']);
        expect(within(panel).queryByRole('tab', {name: 'Locks'})).not.toBeInTheDocument();
        expect(within(panel).getByRole('tab', {name: 'Status'})).toHaveAttribute('aria-selected', 'true');
        expect(within(panel).getByTestId('object-status')).toBeVisible();
        expect(within(panel).queryByTestId('object-details')).not.toBeInTheDocument();
        expect(openDialogs()).toEqual([panel]);

        fireEvent.click(within(panel).getByRole('tab', {name: 'Configuration'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peektab=config');
        expect(within(panel).getByTestId('object-config')).toHaveTextContent('ns1/svc/web');
        expect(within(panel).getByTestId('object-status')).not.toBeVisible();
    });

    test.each([['ns1/svc/web', 7], ['ns1/sec/key', 4]])('the %s tabs are titled by their name alone, no icon', (path, count) => {
        renderPeek(`/nodes?peek=object:${path}`);
        const panel = screen.getByRole('dialog', {name: path});
        const tabs = within(panel).getAllByRole('tab');
        expect(tabs).toHaveLength(count);
        for (const tab of tabs) expect(tab.querySelector('svg')).toBeNull();
    });

    test('a volume has its capacity on a tab, for its nodes', () => {
        store.set({objectInstanceStatus: {'ns1/vol/data': {n1: {}, n2: {}}}});
        renderPeek('/nodes?peek=object:ns1/vol/data&peektab=capacity');
        const panel = screen.getByRole('dialog', {name: 'ns1/vol/data'});
        expect(within(panel).getByRole('tab', {name: 'Capacity'})).toHaveAttribute('aria-selected', 'true');
        expect(within(panel).getByTestId('object-capacity')).toHaveTextContent('ns1/vol/data on n1+n2');
    });

    test('the cluster has its locks on a tab, as om cluster lock list; an object none', () => {
        renderPeek('/nodes?peek=object:cluster&peektab=locks');
        const panel = screen.getByRole('dialog', {name: 'cluster'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Status', 'Usage', 'Schedules', 'Locks', 'Configuration', 'Logs', 'Events']);
        expect(within(panel).getByRole('tab', {name: 'Locks'})).toHaveAttribute('aria-selected', 'true');
        expect(within(panel).getByTestId('cluster-locks')).toBeInTheDocument();
    });

    test('a service with a sync resource keeping snapshots shows and restores them on tabs; one without, neither', () => {
        store.set({objectInstanceStatus: {'ns1/svc/web': {
            node1: {resources: {'fs#1': {type: 'fs.flag'}, 'sync#1': {type: 'sync.store'}}},
            node2: {resources: {'sync#1': {type: 'sync.rsync'}}},
        }}});
        try {
            renderPeek('/objects?peek=object:ns1/svc/web&peektab=restore');
            const panel = screen.getByRole('dialog', {name: 'ns1/svc/web'});
            expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent))
                .toEqual(['Status', 'Usage', 'Capacity', 'Schedules', 'Snapshots', 'Restore', 'Configuration', 'Logs', 'Events']);
            expect(within(panel).getByTestId('object-snapshots')).toHaveTextContent('ns1/svc/web');
        } finally {
            store.reset();
        }
        cleanup();
        renderPeek('/objects?peek=object:ns1/svc/web');
        // Its sync resources none keeping snapshots, or none at all: neither tab.
        expect(within(screen.getByRole('dialog', {name: 'ns1/svc/web'})).queryByRole('tab', {name: 'Restore'})).not.toBeInTheDocument();
        expect(within(screen.getByRole('dialog', {name: 'ns1/svc/web'})).queryByRole('tab', {name: 'Snapshots'})).not.toBeInTheDocument();
        cleanup();
        store.set({objectInstanceStatus: {'ns1/svc/web': {node1: {resources: {'sync#1': {type: 'sync.rsync'}}}}}});
        try {
            renderPeek('/objects?peek=object:ns1/svc/web');
            expect(within(screen.getByRole('dialog', {name: 'ns1/svc/web'})).queryByRole('tab', {name: 'Snapshots'})).not.toBeInTheDocument();
        } finally {
            store.reset();
        }
    });

    test('a datastore has no capacity tab', () => {
        renderPeek('/nodes?peek=object:ns1/cfg/settings');
        const panel = screen.getByRole('dialog', {name: 'ns1/cfg/settings'});
        expect(within(panel).queryByRole('tab', {name: 'Capacity'})).not.toBeInTheDocument();
    });

    test('a resource on a node, from the board: its panel on that instance alone', () => {
        renderPeek('/nodes?peek=object:ns1/svc/web');
        fireEvent.click(within(screen.getByTestId('object-status')).getByRole('button', {name: 'fs#1 on n2'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=resource:ns1/svc/web:fs#1@n2');
    });

    test('the schedules of the object on a tab; what its resources report, in the panels of its instances and resources', () => {
        renderPeek('/nodes?peek=object:ns1/svc/web');
        const panel = screen.getByRole('dialog', {name: 'ns1/svc/web'});
        expect(within(panel).queryByRole('tab', {name: 'Resources'})).not.toBeInTheDocument();
        fireEvent.click(within(panel).getByRole('tab', {name: 'Schedules'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peektab=schedules');
        expect(within(panel).getByTestId('object-schedules')).toHaveTextContent('ns1/svc/web');
        expect(within(panel).queryByTestId('object-resources')).not.toBeInTheDocument();
    });

    test('the logs tab reads the logs of the object on all its nodes, merged: no node to choose', () => {
        renderPeek('/nodes?peek=object:ns1/svc/web&peektab=logs');
        expect(screen.getByTestId('logs')).toHaveTextContent('instance ns1/svc/web on node1+node2');
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        // The status stays mounted under the logs: its stream holds.
        expect(screen.getByTestId('object-status')).not.toBeVisible();
    });

    test.each(['ns1/sec/key', 'ns1/cfg/settings'])('%s, which om shows no status of, shows its keys, its configuration on a tab', (path) => {
        renderPeek(`/nodes?peek=object:${path}`);
        const panel = screen.getByRole('dialog', {name: path});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Keys', 'Configuration', 'Logs', 'Events']);
        expect(within(panel).getByRole('tab', {name: 'Keys'})).toHaveAttribute('aria-selected', 'true');
        expect(within(panel).queryByTestId('object-status')).not.toBeInTheDocument();
        expect(within(panel).getByTestId('object-details')).toHaveAttribute('data-embedded', 'true');

        fireEvent.click(within(panel).getByRole('tab', {name: 'Configuration'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peektab=config');
        expect(within(panel).getByTestId('object-config')).toHaveTextContent(path);
        // Kept mounted under the configuration: its stream holds.
        expect(within(panel).getByTestId('object-details')).not.toBeVisible();
    });

    test.each([
        ['network:lo', 'lo', 'network-overview', 'lo'],
        ['namespace:ns1', 'ns1', 'namespace-usage', 'ns1'],
    ])('%s opens its panel', (peek, title, testId, content) => {
        renderPeek(`/objects?peek=${peek}`);
        const panel = screen.getByRole('dialog', {name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))});
        expect(within(panel).getByTestId(testId)).toHaveTextContent(content);
    });

    test('a namespace opens on its usage, its configuration on a tab of its own', () => {
        renderPeek('/objects?peek=namespace:ns1');
        const panel = screen.getByRole('dialog', {name: 'ns1'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent.replace(/\d+!?$/, '')))
            .toEqual(['Usage', 'Claims', 'Services', 'Volumes', 'Configurations', 'Secrets', 'Configuration', 'Events']);
        fireEvent.click(within(panel).getByRole('tab', {name: 'Configuration'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peektab=config');
        expect(within(panel).getByTestId('namespace-config')).toHaveTextContent('ns1');
        expect(within(panel).queryByTestId('namespace-usage')).not.toBeInTheDocument();
    });

    test('an object has its events on a tab', () => {
        renderPeek('/nodes?peek=object:ns1/svc/web&peektab=events');
        expect(within(screen.getByRole('dialog', {name: 'ns1/svc/web'})).getByTestId('events')).toHaveTextContent('events of ns1/svc/web');
    });

    test('a namespace has the events of its objects on a tab', () => {
        renderPeek('/objects?peek=namespace:ns1&peektab=events');
        expect(within(screen.getByRole('dialog', {name: 'ns1'})).getByTestId('events')).toHaveTextContent('events in ns1');
    });

    test('a namespace: its actions in the title bar, the delete of its configuration for those who may write it', () => {
        mockGrants.value = {squatter: null};
        store.set({objectStatus: {'ns1/': {avail: 'n/a'}}});
        try {
            renderPeek('/objects?peek=namespace:ns1');
            const panel = screen.getByRole('dialog', {name: 'ns1'});
            const actions = within(panel).getByRole('button', {name: 'Namespace actions'});
            expect(actions).toHaveTextContent(/^Actions$/);
            fireEvent.click(actions);
            const remove = within(screen.getByRole('menu', {name: 'Namespace actions'})).getByRole('menuitem', {name: 'Delete'});
            expect(remove).toBeEnabled();
            // The configuration deleted on all the nodes: said so, not as the delete of an instance.
            fireEvent.click(remove);
            const confirm = screen.getByRole('dialog', {name: /delete/i});
            expect(within(confirm).getByText(/orchestrated clusterwide/)).toBeInTheDocument();
            expect(within(confirm).queryByText(/may recreate the configuration from a peer/)).not.toBeInTheDocument();
        } finally {
            mockGrants.value = {};
            store.reset();
        }
    });

    test('a namespace without its configuration, or a user who may not write it: nothing to delete', () => {
        renderPeek('/objects?peek=namespace:ns1');
        fireEvent.click(within(screen.getByRole('dialog', {name: 'ns1'})).getByRole('button', {name: 'Namespace actions'}));
        expect(within(screen.getByRole('menu', {name: 'Namespace actions'})).getByRole('menuitem', {name: 'Delete'})).toBeDisabled();
    });

    test('a network opens on its overview, its addresses and configuration on tabs of their own', () => {
        renderPeek('/objects?peek=network:lo');
        const panel = screen.getByRole('dialog', {name: 'lo'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Addresses', 'Configuration']);
        fireEvent.click(within(panel).getByRole('tab', {name: 'Addresses'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peektab=addresses');
        expect(within(panel).getByTestId('network-details')).toHaveTextContent('lo');
        fireEvent.click(within(panel).getByRole('tab', {name: 'Configuration'}));
        expect(within(panel).getByTestId('network-config')).toHaveTextContent('lo');
    });

    test('a pool opens on its overview, its volumes and configuration on tabs of their own', () => {
        renderPeek('/objects?peek=pool:tank');
        const panel = screen.getByRole('dialog', {name: 'tank'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Volumes', 'Configuration']);
        expect(within(panel).getByTestId('pool-overview')).toHaveTextContent('tank');
        fireEvent.click(within(panel).getByRole('tab', {name: 'Volumes'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peektab=volumes');
        expect(within(panel).getByTestId('pool-volumes')).toHaveTextContent('tank');
    });

    test('a store opens on its overview, its snapshots and configuration on tabs of their own; one of a secret titled by its name', () => {
        renderPeek(`/objects?peek=${encodeURIComponent('store:from test/sec/stores store#tar2')}`);
        const panel = screen.getByRole('dialog', {name: 'tar2'});
        expect(within(panel).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Snapshots', 'Configuration']);
        expect(within(panel).getByTestId('store-overview')).toHaveTextContent('from test/sec/stores store#tar2');
        fireEvent.click(within(panel).getByRole('tab', {name: 'Snapshots'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peektab=snapshots');
    });

    test('closing the panel leaves the view as it was', () => {
        renderPeek('/objects?kind=svc&peek=network:lo');
        fireEvent.click(screen.getAllByRole('button', {name: 'Close'})[0]);
        expect(screen.getByTestId('search')).toHaveTextContent('?kind=svc');
        expect(openDialogs()).toHaveLength(0);
    });
});
