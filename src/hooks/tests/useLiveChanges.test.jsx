import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {
    anyOf,
    useChangeCount,
    useClusterConfigChanges,
    useInstanceConfigChanges,
    useInstanceStatusChanges,
    useNodeConfigChanges,
    usePollTicks,
    usePoolChanges,
} from '../useLiveChanges';
import {useMenuState} from '../useSidebarAlerts';
import useEventStore from '../useEventStore.js';

const {retainEventReception, release} = vi.hoisted(() => {
    const release = vi.fn();
    return {release, retainEventReception: vi.fn(() => release)};
});
vi.mock('../../eventSourceManager', () => ({retainEventReception}));

const menu = (state) => act(() => {
    useMenuState.setState(state);
});

beforeEach(() => {
    localStorage.setItem('authToken', 'tok');
    useMenuState.setState({clusterConfig: null, nodeConfig: {}, pools: [], objects: {}});
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useChangeCount', () => {
    test('0 at first, one more on each change after, none for the same value', () => {
        const {result, rerender} = renderHook(({value}) => useChangeCount(value), {initialProps: {value: 'a'}});
        expect(result.current).toBe(0);
        rerender({value: 'a'});
        expect(result.current).toBe(0);
        rerender({value: 'b'});
        rerender({value: 'c'});
        expect(result.current).toBe(2);
    });

    test('anyOf: the changes of any', () => {
        expect(anyOf(0, 2, 1)).toBe(3);
    });
});

describe('the changes of the configurations, as the stream of the menu says them', () => {
    test('of the cluster: each ClusterConfigUpdated, whatever section changed', () => {
        const {result} = renderHook(() => useClusterConfigChanges());
        menu({clusterConfig: {name: 'dev3'}});
        // The same values, another event: cluster.conf written again, an array section say.
        menu({clusterConfig: {name: 'dev3'}});
        expect(result.current).toBe(2);
    });

    test('of a node: its own only, by value, a replay of the same reading nothing', () => {
        menu({nodeConfig: {n1: {env: 'TST'}, n2: {env: 'TST'}}});
        const {result} = renderHook(() => useNodeConfigChanges('n1'));
        const all = renderHook(() => useNodeConfigChanges());
        menu({nodeConfig: {n1: {env: 'TST'}, n2: {env: 'PRD'}}});
        expect(result.current).toBe(0);
        expect(all.result.current).toBe(1);
        menu({nodeConfig: {n1: {env: 'TST'}, n2: {env: 'PRD'}}});
        menu({nodeConfig: {n1: {env: 'PRD'}, n2: {env: 'PRD'}}});
        expect(result.current).toBe(1);
        expect(all.result.current).toBe(2);
    });
});

describe('usePoolChanges', () => {
    test('the usage polled, by value; a vol created or deleted; another object nothing', () => {
        menu({pools: [{name: 'default', used: 1}], objects: {'ns/svc/a': {}}});
        const {result} = renderHook(() => usePoolChanges());
        menu({pools: [{name: 'default', used: 1}]});
        expect(result.current).toBe(0);
        menu({pools: [{name: 'default', used: 2}]});
        menu({objects: {'ns/svc/a': {}, 'ns/vol/v': {}}});
        menu({objects: {'ns/svc/a': {avail: 'up'}, 'ns/vol/v': {}}});
        menu({objects: {'ns/svc/a': {}}});
        expect(result.current).toBe(3);
    });
});

describe('usePollTicks', () => {
    test('one every period while the page is seen, none hidden, one at once seen again', () => {
        vi.useFakeTimers();
        let state = 'visible';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
        const {result} = renderHook(() => usePollTicks(1000));
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(result.current).toBe(2);
        state = 'hidden';
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(result.current).toBe(2);
        state = 'visible';
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(result.current).toBe(3);
    });
});

describe('the changes of an object, from the stream of the views', () => {
    test('its configuration: the event claimed for it while shown', () => {
        const {result, unmount} = renderHook(() => useInstanceConfigChanges('ns/svc/a'));
        expect(retainEventReception).toHaveBeenCalledWith('tok', ['InstanceConfigUpdated'], 'ns/svc/a');
        act(() => {
            useEventStore.setState({instanceConfig: {'ns/svc/a': {n1: {checksum: '1'}}}});
        });
        expect(result.current).toBe(1);
        unmount();
        expect(release).toHaveBeenCalled();
    });

    test('the status of one resource: its own changes only, by value', () => {
        const status = (fs, ip) => ({'ns/svc/a': {n1: {resources: {'fs#1': {status: fs}, 'ip#1': {status: ip}}}}});
        act(() => {
            useEventStore.setState({objectInstanceStatus: status('up', 'up')});
        });
        const {result} = renderHook(() => useInstanceStatusChanges('ns/svc/a', 'fs#1'));
        act(() => {
            useEventStore.setState({objectInstanceStatus: status('up', 'down')});
        });
        expect(result.current).toBe(0);
        act(() => {
            useEventStore.setState({objectInstanceStatus: status('down', 'down')});
        });
        expect(result.current).toBe(1);
    });
});
