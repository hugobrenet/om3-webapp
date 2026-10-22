import {afterEach, describe, expect, test, vi} from 'vitest';
import useEventStore from '../useEventStore.js';
import {readClusterStatus, resetClusterStatus} from '../clusterStatusOnce';

describe('readClusterStatus', () => {
    afterEach(() => {
        resetClusterStatus();
        vi.restoreAllMocks();
        useEventStore.setState({objectInstanceStatus: {}, instanceConfig: {}, instanceMonitor: {}});
    });

    test('a node dropped while no page heard it is forgotten, its instances kept from before', async () => {
        // Kept in localStorage from a session when dev3n2 was up.
        useEventStore.setState({
            objectInstanceStatus: {foo: {dev3n1: {avail: 'up'}, dev3n2: {avail: 'down'}}},
            instanceMonitor: {'dev3n2:foo': {state: 'idle'}},
        });
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({cluster: {config: {nodes: ['dev3n1', 'dev3n2']}, node: {dev3n1: {}}}}),
        }));
        const status = await readClusterStatus();
        expect(status.cluster.config.nodes).toEqual(['dev3n1', 'dev3n2']);
        expect(useEventStore.getState().objectInstanceStatus).toEqual({foo: {dev3n1: {avail: 'up'}}});
        expect(useEventStore.getState().instanceMonitor).toEqual({});
    });

    test('not read: nothing forgotten', async () => {
        useEventStore.setState({objectInstanceStatus: {foo: {dev3n2: {avail: 'down'}}}});
        global.fetch = vi.fn(async () => ({ok: false}));
        expect(await readClusterStatus()).toBeNull();
        expect(useEventStore.getState().objectInstanceStatus).toEqual({foo: {dev3n2: {avail: 'down'}}});
    });
});
