import {renderHook, act} from '@testing-library/react';
import {describe, test, expect, beforeEach, afterEach, vi} from 'vitest';
import axios from 'axios';
import useSidebarAlerts, {
    fullCount,
    frozenCount,
    applySidebarEvent,
    objectsAlert,
    heartbeatAlert,
    nodesAlert,
    nodesDetails,
    usageDetails,
    SIDEBAR_EVENTS_URL,
    SIDEBAR_FLUSH_MS,
    SIDEBAR_RECONNECT_MS,
    SIDEBAR_USAGE_REFRESH_MS,
} from '../useSidebarAlerts';
import {URL_NETWORK, URL_POOL} from '../../config/apiPath.js';

const {sources} = vi.hoisted(() => ({sources: []}));

vi.mock('axios');
vi.mock('event-source-polyfill', () => ({
    EventSourcePolyfill: vi.fn().mockImplementation(function (url, options) {
        this.url = url;
        this.options = options;
        this.listeners = {};
        this.closed = false;
        this.addEventListener = (type, listener) => {
            this.listeners[type] = listener;
        };
        this.close = () => {
            this.closed = true;
        };
        this.emit = (type, data) => this.listeners[type]?.({data: JSON.stringify(data)});
        sources.push(this);
    }),
}));
vi.mock('../../utils/logger.js', () => ({default: {warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn()}}));

describe('objectsAlert', () => {
    test('none while no actor is down and no object warns', () => {
        expect(objectsAlert({})).toBeNull();
        expect(objectsAlert({'ns1/svc/a': {avail: 'up', overall: 'up'}, 'ns1/cfg/c': {avail: 'n/a', overall: 'n/a'}})).toBeNull();
    });

    test('red when an actor, a svc or a vol, is down, whatever warns', () => {
        expect(objectsAlert({
            'ns1/svc/a': {avail: 'down', overall: 'down'},
            web: {avail: 'up', overall: 'warn'},
        })).toEqual({level: 'down', text: '1 object down'});
        expect(objectsAlert({'ns1/vol/v': {avail: 'down'}, 'ns1/vol/w': {avail: 'down'}}))
            .toEqual({level: 'down', text: '2 objects down'});
    });

    test('orange when an object is overall warn and no actor is down', () => {
        expect(objectsAlert({'ns1/svc/a': {avail: 'up', overall: 'warn'}, 'ns1/sec/s': {avail: 'n/a', overall: 'warn'}}))
            .toEqual({level: 'warn', text: '2 objects in warn'});
    });

    test('a down object that is no actor, a cfg say, raises nothing red', () => {
        expect(objectsAlert({'ns1/cfg/c': {avail: 'down'}, cluster: {avail: 'down'}, 'ns1/': {avail: 'down'}})).toBeNull();
    });
});

describe('alert counts', () => {
    test('count the pools or networks used to their full size', () => {
        expect(fullCount([{size: 10, used: 3}, {size: 10, used: 10}, {size: 4, used: 5}])).toBe(2);
        expect(fullCount([{size: 10, used: 9}, {size: 0, used: 0}, {used: 4}])).toBe(0);
        expect(fullCount(undefined)).toBe(0);
    });

    test('count the frozen nodes', () => {
        expect(frozenCount({
            n1: {frozen_at: '0001-01-01T00:00:00Z'},
            n2: {frozen_at: '2026-10-05T10:00:00Z'},
            n3: {frozen_at: '2026-10-05T11:00:00Z'},
            n4: {},
        })).toBe(2);
        expect(frozenCount(undefined)).toBe(0);
    });
});

describe('applySidebarEvent', () => {
    test('applies object, node and heartbeat events, and object deletions', () => {
        const state = {objects: {}, nodeStatus: {}, heartbeatStatus: {}};
        applySidebarEvent(state, 'ObjectStatusUpdated', {path: 'a', object_status: {avail: 'up'}});
        applySidebarEvent(state, 'ObjectStatusUpdated', {labels: {path: 'b'}, object_status: {avail: 'down'}});
        applySidebarEvent(state, 'NodeStatusUpdated', {node: 'n1', node_status: {frozen_at: 'x'}});
        applySidebarEvent(state, 'DaemonHeartbeatUpdated', {labels: {node: 'n1'}, heartbeat: {streams: []}});
        applySidebarEvent(state, 'ObjectDeleted', {path: 'b'});
        applySidebarEvent(state, 'Unknown', {path: 'c'});
        expect(state).toEqual({
            objects: {a: {avail: 'up'}},
            nodeStatus: {n1: {frozen_at: 'x'}},
            heartbeatStatus: {n1: {streams: []}},
        });
    });
});

describe('heartbeatAlert', () => {
    const stream = (state, beating) => ({state, peers: {n2: {is_beating: beating}}});

    test('none while every link, rx and tx of every node, runs and beats', () => {
        expect(heartbeatAlert({})).toBeNull();
        expect(heartbeatAlert({n1: {streams: [stream('running', true), stream('running', true)]}})).toBeNull();
    });

    test('orange when one link is down: stopped or with a peer not beating', () => {
        expect(heartbeatAlert({
            n1: {streams: [stream('running', true), stream('running', false)]},
            n2: {streams: [stream('running', true), stream('running', true)]},
        })).toEqual({level: 'warn', text: '1 of 4 heartbeat links down'});
        expect(heartbeatAlert({n1: {streams: [stream('stopped', true), stream('running', true)]}}).level).toBe('warn');
    });

    test('red when all the links are down', () => {
        expect(heartbeatAlert({n1: {streams: [stream('stopped', true), stream('running', false)]}}))
            .toEqual({level: 'down', text: '2 of 2 heartbeat links down'});
    });
});

describe('alerts in French', () => {
    test('say what they are about in the language of the page', async () => {
        const i18n = (await import('../../i18n')).default;
        await i18n.changeLanguage('fr');
        try {
            expect(nodesAlert({n1: {is_overloaded: true}, n2: {}}).text).toBe('1 nœud sur 2 surchargé');
            expect(objectsAlert({'ns1/svc/a': {avail: 'down'}}).text).toBe('1 objet down');
        } finally {
            await i18n.changeLanguage('en');
        }
    });
});

describe('nodesAlert', () => {
    test('none while no node is overloaded', () => {
        expect(nodesAlert({})).toBeNull();
        expect(nodesAlert({n1: {is_overloaded: false}, n2: {}})).toBeNull();
    });

    test('orange when one node is overloaded, red when all are', () => {
        expect(nodesAlert({n1: {is_overloaded: true}, n2: {is_overloaded: false}}))
            .toEqual({level: 'warn', text: '1 of 2 nodes overloaded'});
        expect(nodesAlert({n1: {is_overloaded: true}, n2: {is_overloaded: true}}))
            .toEqual({level: 'down', text: '2 of 2 nodes overloaded'});
    });
});

describe('mouseover details', () => {
    test('count the nodes and the frozen ones', () => {
        expect(nodesDetails({
            n1: {frozen_at: '0001-01-01T00:00:00Z'},
            n2: {frozen_at: '2026-10-05T10:00:00Z'},
        })).toEqual(['2 nodes', 'frozen: 1']);
        expect(nodesDetails({n1: {}})).toEqual(['1 node', 'frozen: 0']);
    });

    test('count the pools or networks, the full ones, and show the highest usage', () => {
        expect(usageDetails([
            {name: 'a', size: 10, used: 5},
            {name: 'b', size: 4, used: 4},
            {name: 'c'},
        ], 'pool')).toEqual(['3 pools', 'full: 1', 'highest usage: b 100%']);
        expect(usageDetails([], 'network')).toEqual(['0 networks', 'full: 0']);
    });
});

describe('useSidebarAlerts', () => {
    const flush = async () => {
        await act(async () => {
            vi.advanceTimersByTime(SIDEBAR_FLUSH_MS);
        });
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        sources.length = 0;
        localStorage.clear();
        localStorage.setItem('authToken', 'tok');
        axios.get.mockImplementation((url) => Promise.resolve({
            data: {items: url === URL_POOL ? [{size: 10, used: 10}] : [{size: 10, used: 1}]},
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('opens its own event stream, with the cache, and the token', () => {
        renderHook(() => useSidebarAlerts());
        expect(sources).toHaveLength(1);
        expect(sources[0].url).toBe(SIDEBAR_EVENTS_URL);
        expect(sources[0].url).toContain('cache=true');
        for (const filter of ['ObjectStatusUpdated', 'ObjectDeleted', 'NodeStatusUpdated', 'DaemonHeartbeatUpdated']) {
            expect(sources[0].url).toContain(`filter=${filter}`);
        }
        expect(sources[0].options.headers.Authorization).toBe('Bearer tok');
    });

    test('updates the alerts from the events, without any user action', async () => {
        const {result} = renderHook(() => useSidebarAlerts());
        expect(result.current['objects-any'].alert).toBeNull();

        act(() => {
            sources[0].emit('ObjectStatusUpdated', {path: 'a', object_status: {avail: 'up'}});
            sources[0].emit('NodeStatusUpdated', {node: 'n1', node_status: {frozen_at: '2026-10-05T10:00:00Z', is_overloaded: true}});
            sources[0].emit('DaemonHeartbeatUpdated', {
                node: 'n1', heartbeat: {streams: [{state: 'running', peers: {n2: {is_beating: false}}}]},
            });
        });
        await flush();
        expect(result.current['objects-any'].alert).toBeNull();
        expect(result.current.nodes.details).toEqual(['1 node', 'frozen: 1']);
        expect(result.current.nodes.alert).toEqual({level: 'down', text: '1 of 1 nodes overloaded'});
        expect(result.current.links.alert).toEqual({level: 'down', text: '1 of 1 heartbeat links down'});

        act(() => {
            sources[0].emit('ObjectStatusUpdated', {path: 'b', object_status: {avail: 'down'}});
        });
        await flush();
        expect(result.current['objects-any'].alert).toEqual({level: 'down', text: '1 object down'});
        // A service: the services' alert, not the volumes'.
        expect(result.current['objects-services'].alert).toEqual({level: 'down', text: '1 object down'});
        expect(result.current['objects-volumes'].alert).toBeNull();

        act(() => {
            sources[0].emit('ObjectDeleted', {path: 'b'});
        });
        await flush();
        expect(result.current['objects-any'].alert).toBeNull();
    });

    test('ignores an event whose data is not JSON', async () => {
        const {result} = renderHook(() => useSidebarAlerts());
        act(() => {
            sources[0].listeners.ObjectStatusUpdated({data: 'not json'});
        });
        await flush();
        expect(result.current['objects-any'].alert).toBeNull();
    });

    test('reconnects after an error with the current token, and replaces the state', async () => {
        const {result} = renderHook(() => useSidebarAlerts());
        act(() => {
            sources[0].emit('ObjectStatusUpdated', {path: 'a', object_status: {avail: 'down'}});
        });
        await flush();
        expect(result.current['objects-any'].alert?.level).toBe('down');

        localStorage.setItem('authToken', 'tok2');
        act(() => {
            sources[0].onerror({status: 401});
        });
        expect(sources[0].closed).toBe(true);
        // The last known alert stays until the new stream replays the state.
        expect(result.current['objects-any'].alert?.level).toBe('down');

        await act(async () => {
            vi.advanceTimersByTime(SIDEBAR_RECONNECT_MS);
        });
        expect(sources).toHaveLength(2);
        expect(sources[1].options.headers.Authorization).toBe('Bearer tok2');

        act(() => {
            sources[1].emit('ObjectStatusUpdated', {path: 'c', object_status: {avail: 'up'}});
        });
        await flush();
        expect(result.current['objects-any'].alert).toBeNull();
    });

    test('waits for a token before opening the stream', async () => {
        localStorage.clear();
        renderHook(() => useSidebarAlerts());
        expect(sources).toHaveLength(0);
        localStorage.setItem('authToken', 'tok');
        await act(async () => {
            vi.advanceTimersByTime(SIDEBAR_RECONNECT_MS);
        });
        expect(sources).toHaveLength(1);
    });

    test('closes the stream on unmount', () => {
        const {unmount} = renderHook(() => useSidebarAlerts());
        unmount();
        expect(sources[0].closed).toBe(true);
    });

    test('polls pools and networks', async () => {
        const {result} = renderHook(() => useSidebarAlerts());
        await act(async () => {
            await Promise.resolve();
        });
        // Pools and networks raise no alert: their details only.
        expect(result.current.pools.alert).toBeNull();
        expect(result.current.networks.alert).toBeNull();
        expect(result.current.pools.details).toContain('full: 1');
        expect(axios.get).toHaveBeenCalledWith(URL_POOL, {headers: {Authorization: 'Bearer tok'}});
        expect(axios.get).toHaveBeenCalledWith(URL_NETWORK, {headers: {Authorization: 'Bearer tok'}});
        expect(axios.get).toHaveBeenCalledTimes(2);

        axios.get.mockImplementation(() => Promise.resolve({data: {items: []}}));
        await act(async () => {
            vi.advanceTimersByTime(SIDEBAR_USAGE_REFRESH_MS);
        });
        expect(axios.get).toHaveBeenCalledTimes(4);
        expect(result.current.pools.details).toContain('full: 0');
    });

    test('keeps the last lists when a poll fails', async () => {
        const {result} = renderHook(() => useSidebarAlerts());
        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current.pools.details).toContain('full: 1');
        axios.get.mockRejectedValue(new Error('down'));
        await act(async () => {
            vi.advanceTimersByTime(SIDEBAR_USAGE_REFRESH_MS);
        });
        expect(result.current.pools.details).toContain('full: 1');
    });
});
