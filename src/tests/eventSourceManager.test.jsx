import * as eventSourceManager from '../eventSourceManager';
import {EventSourcePolyfill} from 'event-source-polyfill';
import useEventStore from '../hooks/useEventStore.js';
import useEventLogStore from '../hooks/useEventLogStore.js';
import {URL_NODE_EVENT, URL_OBJECT} from '../config/apiPath.js';
import {vi, beforeAll, afterAll, beforeEach, afterEach, describe, test, expect} from 'vitest';

vi.mock('event-source-polyfill', () => ({
    EventSourcePolyfill: vi.fn(),
}));
vi.mock('../hooks/useEventStore.js', () => ({
    __esModule: true,
    default: Object.assign(vi.fn(), {
        getState: vi.fn(),
        setState: vi.fn(),
        subscribe: vi.fn(),
    }),
}));
vi.mock('../hooks/useEventLogStore.js', () => ({
    __esModule: true,
    default: Object.assign(vi.fn(), {
        getState: vi.fn(),
    }),
}));

let mockNow = 0;
const originalPerformance = global.performance;

beforeAll(() => {
    global.performance = {now: () => mockNow};
});

afterAll(() => {
    global.performance = originalPerformance;
});

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

const mockShallowEqual = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    return keysA.every(key => a[key] === b[key]);
};

const getHandler = (eventSource, eventType) =>
    eventSource.addEventListener.mock.calls.find(c => c[0] === eventType)[1];

const createES = (token = 'fake-token') => eventSourceManager.createEventSource(URL_NODE_EVENT, token);

const fire = (handler, data) => handler({data: JSON.stringify(data)});

describe('eventSourceManager', () => {
    let mockStore, mockLogStore, mockEventSource, mockLoggerEventSource;
    let localStorageMock;
    let consoleSpies;

    beforeEach(() => {
        vi.clearAllMocks();
        mockNow += 1_000_000;

        const makeSetter = (prop, isEqualFn = mockShallowEqual) => vi.fn((v) => {
            if (!isEqualFn(mockStore[prop], v)) mockStore[prop] = v;
        });

        mockStore = {
            nodeStatus: {}, nodeMonitor: {}, nodeStats: {}, objectStatus: {},
            objectInstanceStatus: {}, heartbeatStatus: {}, instanceMonitor: {},
            instanceConfig: {}, configUpdates: [],
            pendingDeletes: {},
            removeObject: vi.fn((name) => {
                delete mockStore.objectStatus[name];
                delete mockStore.objectInstanceStatus[name];
                delete mockStore.instanceConfig[name];
            }),
            setConfigUpdated: vi.fn((v) => {
                mockStore.configUpdates = v || [];
            }),
            setInstanceConfig: vi.fn((path, node, config) => {
                if (!mockStore.instanceConfig[path]) mockStore.instanceConfig[path] = {};
                if (!mockShallowEqual(mockStore.instanceConfig[path][node], config))
                    mockStore.instanceConfig[path][node] = config;
            }),
            setInstanceStatuses: vi.fn((v) => {
                if (JSON.stringify(mockStore.objectInstanceStatus) !== JSON.stringify(v)) mockStore.objectInstanceStatus = v;
            }),
            removeInstanceFromObject: vi.fn(),
            removeNode: vi.fn(),
            removePendingDelete: vi.fn(),
            removeObjects: vi.fn(),
        };
        mockStore.setNodeStatuses = makeSetter('nodeStatus');
        mockStore.setNodeMonitors = makeSetter('nodeMonitor');
        mockStore.setNodeStats = makeSetter('nodeStats');
        mockStore.setObjectStatuses = makeSetter('objectStatus');
        mockStore.setHeartbeatStatuses = makeSetter('heartbeatStatus');
        mockStore.setInstanceMonitors = makeSetter('instanceMonitor');

        vi.mocked(useEventStore.getState).mockReturnValue(mockStore);

        mockLogStore = {addEventLog: vi.fn()};
        vi.mocked(useEventLogStore.getState).mockReturnValue(mockLogStore);

        mockEventSource = {
            onopen: vi.fn(), onerror: null, addEventListener: vi.fn(),
            close: vi.fn(), readyState: 1,
            url: URL_NODE_EVENT + '?cache=true&filter=NodeStatusUpdated',
        };
        mockLoggerEventSource = {
            onopen: vi.fn(), onerror: null, addEventListener: vi.fn(),
            close: vi.fn(), readyState: 1,
            url: URL_NODE_EVENT + '?cache=true&filter=ObjectStatusUpdated',
        };
        vi.mocked(EventSourcePolyfill).mockImplementation(() => mockEventSource);

        localStorageMock = {getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn()};
        Object.defineProperty(global, 'localStorage', {value: localStorageMock, writable: true});

        consoleSpies = {
            log: vi.spyOn(console, 'log').mockImplementation(() => {
            }),
            error: vi.spyOn(console, 'error').mockImplementation(() => {
            }),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => {
            }),
            info: vi.spyOn(console, 'info').mockImplementation(() => {
            }),
            debug: vi.spyOn(console, 'debug').mockImplementation(() => {
            }),
        };

        Object.defineProperty(window, 'location', {configurable: true, value: {href: ''}});
        window.oidcUserManager = null;
        window.dispatchEvent = vi.fn();
        global.EventSource = {CLOSED: 2};
        global.requestAnimationFrame = vi.fn((cb) => {
            setTimeout(cb, 0);
            return 1;
        });
    });

    afterEach(() => {
        vi.runAllTimers();
        eventSourceManager.setPageActive(false);
        eventSourceManager.setPageActive(true);
        vi.clearAllTimers();
        Object.values(consoleSpies).forEach(spy => spy.mockRestore());
        eventSourceManager.closeEventSource();
        eventSourceManager.closeLoggerEventSource();
        delete window.oidcUserManager;
    });

    // ==================== EventSource lifecycle ====================
    describe('EventSource lifecycle and management', () => {
        test('should create an EventSource and attach event listeners', () => {
            const es = createES();
            expect(EventSourcePolyfill).toHaveBeenCalled();
            expect(es.addEventListener).toHaveBeenCalledTimes(11);
        });

        test('should close existing EventSource before creating a new one', () => {
            createES();
            vi.mocked(EventSourcePolyfill).mockImplementationOnce(() => ({...mockEventSource}));
            createES();
            expect(mockEventSource.close).toHaveBeenCalled();
        });

        test('should not create EventSource if no token', () => {
            expect(eventSourceManager.createEventSource(URL_NODE_EVENT, '')).toBeNull();
            expect(console.error).toHaveBeenCalledWith('❌ Missing token for EventSource!');
        });

        test('should close EventSource and not throw on missing source', () => {
            createES();
            eventSourceManager.closeEventSource();
            expect(mockEventSource.close).toHaveBeenCalled();
            expect(() => eventSourceManager.closeEventSource()).not.toThrow();
        });

        test('should call and handle errors in _cleanup', () => {
            createES();
            const cleanupSpy = vi.fn();
            mockEventSource._cleanup = cleanupSpy;
            eventSourceManager.closeEventSource();
            expect(cleanupSpy).toHaveBeenCalled();

            createES();
            mockEventSource._cleanup = () => {
                throw new Error('cleanup error');
            };
            expect(() => eventSourceManager.closeEventSource()).not.toThrow();
            expect(console.debug).toHaveBeenCalledWith('Error during eventSource cleanup', expect.any(Error));
        });

        test('should return token from localStorage or currentToken', () => {
            localStorageMock.getItem.mockReturnValue('local-storage-token');
            expect(eventSourceManager.getCurrentToken()).toBe('local-storage-token');

            localStorageMock.getItem.mockReturnValue(null);
            createES('current-token');
            expect(eventSourceManager.getCurrentToken()).toBe('current-token');
        });

        test('should not update if no new token in updateEventSourceToken', () => {
            createES('old-token');
            eventSourceManager.updateEventSourceToken('');
            expect(mockEventSource.close).not.toHaveBeenCalled();
        });

        test('should not restart when currentEventSource is null', () => {
            eventSourceManager.closeEventSource();
            eventSourceManager.updateEventSourceToken('new-token');
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(0);
        });

        test('should configure EventSource with and without objectName', () => {
            eventSourceManager.configureEventSource('fake-token', 'test-object', ['NodeStatusUpdated']);
            expect(EventSourcePolyfill).toHaveBeenCalled();

            vi.clearAllMocks();
            eventSourceManager.configureEventSource('fake-token');
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('cache=true');
            expect(EventSourcePolyfill.mock.calls[0][0]).not.toContain('path=');
        });

        test('should handle missing token in configureEventSource and startEventReception', () => {
            eventSourceManager.configureEventSource('');
            expect(console.error).toHaveBeenCalledWith('❌ No token provided for SSE!');
            eventSourceManager.startEventReception('');
            expect(console.error).toHaveBeenCalledWith('❌ No token provided for SSE!');
        });

        test('should startEventReception with valid and custom filters', () => {
            eventSourceManager.startEventReception('fake-token', ['NodeStatusUpdated', 'ObjectStatusUpdated']);
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('filter=NodeStatusUpdated');
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('filter=ObjectStatusUpdated');
        });

        test('should handle connection open event and log it', () => {
            createES();
            mockEventSource.onopen();
            expect(console.info).toHaveBeenCalledWith('✅ EventSource connection established');
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('CONNECTION_OPENED', {
                url: expect.any(String), timestamp: expect.any(String),
            });
        });

        test('should log connection error with correct data', () => {
            createES();
            mockEventSource.onerror({status: 500, message: 'Test error'});
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('CONNECTION_ERROR', {
                error: 'Test error', status: 500, url: expect.any(String), timestamp: expect.any(String),
            });
        });

        test('should ignore onerror if not current EventSource', () => {
            createES();
            eventSourceManager.closeEventSource();
            mockEventSource.onerror({status: 500});
            expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Reconnecting'));
        });

        test('should log reconnection attempt and max reconnections reached', () => {
            createES();
            mockEventSource.onerror({status: 500});
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('RECONNECTION_ATTEMPT', expect.any(Object));

            for (let i = 0; i < 10; i++) {
                mockEventSource.onerror({status: 500});
                vi.advanceTimersByTime(2000);
            }
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('MAX_RECONNECTIONS_REACHED', expect.any(Object));
        });

        test('should handle auth error: same token, no oidcUserManager', () => {
            localStorageMock.getItem.mockReturnValue('old-token');
            createES('old-token');
            mockEventSource.onerror({status: 401});
            expect(console.warn).toHaveBeenCalledWith('🔐 Authentication error detected');
            expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
        });

        test('should handle auth error: new token from storage', () => {
            localStorageMock.getItem.mockReturnValue('new-token');
            createES('old-token');
            mockEventSource.onerror({status: 401});
            expect(console.info).toHaveBeenCalledWith('🔄 New token available, updating EventSource');
        });

        test('should handle silent renew success and failure', async () => {
            const mockUser = {access_token: 'silent-renewed-token', expires_at: Date.now() + 3600000};
            window.oidcUserManager = {signinSilent: vi.fn().mockResolvedValue(mockUser)};
            localStorageMock.getItem.mockReturnValue(null);
            createES('old-token');
            mockEventSource.onerror({status: 401});
            await vi.runAllTimersAsync();
            expect(localStorageMock.setItem).toHaveBeenCalledWith('authToken', 'silent-renewed-token');

            window.oidcUserManager = {signinSilent: vi.fn().mockRejectedValue(new Error('renew fail'))};
            createES('old-token');
            mockEventSource.onerror({status: 401});
            await vi.runAllTimersAsync();
            expect(console.error).toHaveBeenCalledWith('❌ Silent renew failed:', expect.any(Error));
            expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
        });

        test('should handle onerror without status property', () => {
            createES();
            mockEventSource.onerror({});
            expect(console.error).toHaveBeenCalled();
            expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Reconnecting in'));
        });

        test('should log connection closed on closeEventSource', () => {
            createES();
            eventSourceManager.closeEventSource();
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('CONNECTION_CLOSED', expect.any(Object));
        });

        test('should restart EventSource when updateEventSourceToken called with open connection', () => {
            createES();
            const recreatedMock = {...mockEventSource, close: vi.fn(), addEventListener: vi.fn()};
            vi.mocked(EventSourcePolyfill).mockImplementation(() => recreatedMock);
            localStorageMock.getItem.mockReturnValue('new-token');
            eventSourceManager.updateEventSourceToken('new-token');
            expect(mockEventSource.close).toHaveBeenCalled();
            vi.advanceTimersByTime(200);
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(2);
        });

        test('should restart EventSource when connection is already closed: the polyfill closes one refused', () => {
            createES('old-token');
            mockEventSource.readyState = 2;
            eventSourceManager.updateEventSourceToken('new-token');
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(2);
            expect(EventSourcePolyfill.mock.calls[1][1].headers.Authorization).toBe('Bearer new-token');
        });
    });

    // ==================== A token refused, the reconnections ====================
    describe('a token refused, and the reconnections', () => {
        // A new source for each connection, as the polyfill makes, on its address.
        const sources = [];
        const opened = () => vi.mocked(EventSourcePolyfill).mock.calls;
        const last = () => sources[sources.length - 1];

        beforeEach(() => {
            sources.length = 0;
            vi.mocked(EventSourcePolyfill).mockImplementation((url) => {
                const source = {onopen: null, onerror: null, addEventListener: vi.fn(), close: vi.fn(), readyState: 1, url};
                sources.push(source);
                return source;
            });
        });

        /** The daemon refuses the token: the polyfill closes the source, then says why. */
        const refuse = (source) => {
            source.readyState = 2;
            source.onerror({status: 401});
        };

        test('a 401 with a newer token stored opens the stream again with it', () => {
            localStorageMock.getItem.mockReturnValue('new-token');
            createES('old-token');
            refuse(last());
            expect(opened()).toHaveLength(2);
            expect(opened()[1][0]).toBe(URL_NODE_EVENT);
            expect(opened()[1][1].headers.Authorization).toBe('Bearer new-token');
        });

        test('the stream dead on a 401 that follows its own reconnection comes back, whatever the order', () => {
            // A refresh the stream missed: the newer token stored, the stream on the old one.
            localStorageMock.getItem.mockReturnValue('new-token');
            const url = `${URL_NODE_EVENT}?cache=true&filter=InstanceStatusUpdated`;
            eventSourceManager.createEventSource(url, 'old-token', ['InstanceStatusUpdated']);
            // Given up on (a 502), reopened by our timer still on the old token, refused.
            last().readyState = 2;
            last().onerror({status: 502});
            vi.advanceTimersByTime(30000);
            expect(opened()).toHaveLength(2);
            refuse(last());
            expect(opened()).toHaveLength(3);
            expect(opened()[2][0]).toBe(url);
            expect(opened()[2][1].headers.Authorization).toBe('Bearer new-token');
        });

        test('an error while the polyfill reconnects on its own opens no second connection', () => {
            createES();
            last().readyState = 0;
            last().onerror({message: 'No activity within 45000 milliseconds. Reconnecting.'});
            vi.advanceTimersByTime(60000);
            expect(opened()).toHaveLength(1);
        });

        test('a reconnection planned is cancelled by the stream closed', () => {
            localStorageMock.getItem.mockReturnValue('tok');
            createES('tok');
            last().readyState = 2;
            last().onerror({status: 502});
            eventSourceManager.closeEventSource();
            vi.advanceTimersByTime(60000);
            expect(opened()).toHaveLength(1);
        });

        test('a reconnection planned does not bring back the address of a stream replaced since', () => {
            localStorageMock.getItem.mockReturnValue('tok');
            eventSourceManager.createEventSource(`${URL_NODE_EVENT}?filter=A`, 'tok', []);
            last().readyState = 2;
            last().onerror({status: 502});
            eventSourceManager.createEventSource(`${URL_NODE_EVENT}?filter=B`, 'tok', []);
            vi.advanceTimersByTime(60000);
            expect(opened().map(([url]) => url)).toEqual([`${URL_NODE_EVENT}?filter=A`, `${URL_NODE_EVENT}?filter=B`]);
        });

        test('the logger stream opened does not reset the count of the main one', () => {
            localStorageMock.getItem.mockReturnValue('tok');
            createES('tok');
            const main = last();
            eventSourceManager.createLoggerEventSource(`${URL_NODE_EVENT}?filter=ObjectStatusUpdated`, 'tok', ['ObjectStatusUpdated']);
            const feed = last();
            for (let i = 0; i < 11; i++) {
                main.readyState = 2;
                main.onerror({status: 502});
                feed.onopen();
            }
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('MAX_RECONNECTIONS_REACHED', expect.any(Object));
        });

        test('a token updated opens the logger stream again too', () => {
            createES('old-token');
            eventSourceManager.createLoggerEventSource(`${URL_NODE_EVENT}?filter=ObjectStatusUpdated`, 'old-token', ['ObjectStatusUpdated']);
            eventSourceManager.updateEventSourceToken('new-token');
            const tokens = opened().slice(2).map(([url, options]) => [url, options.headers.Authorization]);
            expect(tokens).toEqual([
                [URL_NODE_EVENT, 'Bearer new-token'],
                [`${URL_NODE_EVENT}?filter=ObjectStatusUpdated`, 'Bearer new-token'],
            ]);
        });

        test('the same claims on a stream given up on open it again', async () => {
            localStorageMock.getItem.mockReturnValue('tok');
            const release = eventSourceManager.retainEventReception('tok', ['ObjectStatusUpdated']);
            await Promise.resolve();
            expect(opened()).toHaveLength(1);
            last().readyState = 2;
            const again = eventSourceManager.retainEventReception('tok', ['ObjectStatusUpdated']);
            await Promise.resolve();
            expect(opened()).toHaveLength(2);
            again();
            release();
            await Promise.resolve();
        });
    });

    // ==================== Event processing and buffer management ====================
    describe('Event processing and buffer management', () => {
        test.each([
            ['NodeStatusUpdated', 'node_status', 'setNodeStatuses', {status: 'up'}],
            ['NodeMonitorUpdated', 'node_monitor', 'setNodeMonitors', {monitor: 'active'}],
            ['NodeStatsUpdated', 'node_stats', 'setNodeStats', {cpu: 50, memory: 70}],
        ])('should process %s events', (eventType, field, setter, value) => {
            const es = createES();
            const handler = getHandler(es, eventType);
            fire(handler, {node: 'node1', [field]: value});
            vi.runAllTimers();
            expect(mockStore[setter]).toHaveBeenCalledWith(expect.objectContaining({node1: value}));
        });

        test('should skip store update when value is unchanged', () => {
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            fire(handler, {node: 'node1', node_status: {status: 'up'}});
            vi.runAllTimers();
            mockStore.nodeStatus = {node1: {status: 'up'}};
            fire(handler, {node: 'node1', node_status: {status: 'up'}});
            vi.runAllTimers();
            expect(mockStore.nodeStatus).toEqual({node1: {status: 'up'}});
        });

        test('should merge multiple entries from the same buffer into a single flush', () => {
            const es = createES();
            const handler = getHandler(es, 'NodeMonitorUpdated');
            fire(handler, {node: 'node1', node_monitor: {monitor: 'active'}});
            fire(handler, {node: 'node2', node_monitor: {monitor: 'inactive'}});
            vi.runAllTimers();
            expect(mockStore.setNodeMonitors).toHaveBeenCalledWith(expect.objectContaining({
                node1: {monitor: 'active'}, node2: {monitor: 'inactive'},
            }));
        });

        test('should process ObjectStatusUpdated with path, labels.path, and handle missing fields', () => {
            const es = createES();
            const handler = getHandler(es, 'ObjectStatusUpdated');
            fire(handler, {path: 'object1', object_status: {status: 'active'}});
            fire(handler, {labels: {path: 'object2'}, object_status: {status: 'ok'}});
            vi.runAllTimers();
            expect(mockStore.setObjectStatuses).toHaveBeenCalledWith(expect.objectContaining({
                object1: {status: 'active'}, object2: {status: 'ok'},
            }));

            vi.clearAllMocks();
            fire(handler, {object_status: {status: 'active'}});
            fire(handler, {path: 'object1'});
            vi.runAllTimers();
            expect(mockStore.setObjectStatuses).not.toHaveBeenCalled();
        });

        test('should merge objectStatus updates in buffer preserving all fields', () => {
            const es = createES();
            const handler = getHandler(es, 'ObjectStatusUpdated');
            fire(handler, {path: 'obj1', object_status: {avail: 'up', frozen: false}});
            fire(handler, {path: 'obj1', object_status: {avail: 'down', provisioned: true}});
            vi.runAllTimers();
            expect(mockStore.setObjectStatuses).toHaveBeenCalledWith(expect.objectContaining({
                obj1: expect.objectContaining({avail: 'down', frozen: false, provisioned: true}),
            }));
        });

        test('should process InstanceStatusUpdated with path, labels.path, handle missing and skip equal', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceStatusUpdated');
            fire(handler, {path: 'object1', node: 'node1', instance_status: {status: 'running'}});
            fire(handler, {labels: {path: 'object1'}, node: 'node2', instance_status: {status: 'stopped'}});
            vi.runAllTimers();
            expect(mockStore.setInstanceStatuses).toHaveBeenCalledWith(expect.objectContaining({
                object1: {node1: {status: 'running'}, node2: {status: 'stopped'}},
            }));

            vi.clearAllMocks();
            fire(handler, {node: 'node1', instance_status: {status: 'running'}});
            fire(handler, {path: 'object1', instance_status: {status: 'running'}});
            fire(handler, {path: 'object1', node: 'node1'});
            vi.runAllTimers();
            expect(mockStore.setInstanceStatuses).not.toHaveBeenCalled();

            mockStore.objectInstanceStatus = {object1: {node1: {status: 'running'}}};
            fire(handler, {path: 'object1', node: 'node1', instance_status: {status: 'running'}});
            vi.runAllTimers();
            expect(mockStore.objectInstanceStatus).toEqual({object1: {node1: {status: 'running'}}});
        });

        test('should process DaemonHeartbeatUpdated with node, labels.node, and handle missing', () => {
            const es = createES();
            const handler = getHandler(es, 'DaemonHeartbeatUpdated');

            fire(handler, {node: 'node1', heartbeat: {status: 'alive'}});
            eventSourceManager.forceFlush();
            expect(mockStore.setHeartbeatStatuses).toHaveBeenCalledWith(expect.objectContaining({node1: {status: 'alive'}}));

            vi.clearAllMocks();
            mockNow += 100;
            fire(handler, {labels: {node: 'node2'}, heartbeat: {status: 'alive'}});
            eventSourceManager.forceFlush();
            expect(mockStore.setHeartbeatStatuses).toHaveBeenCalledWith(expect.objectContaining({node2: {status: 'alive'}}));

            vi.clearAllMocks();
            mockNow += 100;
            fire(handler, {heartbeat: {status: 'alive'}});
            fire(handler, {node: 'node1'});
            eventSourceManager.forceFlush();
            expect(mockStore.setHeartbeatStatuses).not.toHaveBeenCalled();
        });

        test('should process ObjectDeleted with path, labels.path, and handle missing name', () => {
            const es = createES();
            const handler = getHandler(es, 'ObjectDeleted');
            fire(handler, {});
            expect(console.warn).toHaveBeenCalledWith('⚠️ ObjectDeleted event missing objectName:', {});
            expect(mockStore.removeObject).not.toHaveBeenCalled();

            fire(handler, {path: 'object1'});
            expect(mockStore.removeObject).toHaveBeenCalledWith('object1');

            fire(handler, {labels: {path: 'object2'}});
            expect(mockStore.removeObject).toHaveBeenCalledWith('object2');
        });

        test('should process InstanceMonitorUpdated with and without missing fields, skip equal', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceMonitorUpdated');
            fire(handler, {node: 'node1', path: 'object1', instance_monitor: {monitor: 'active'}});
            vi.runAllTimers();
            expect(mockStore.setInstanceMonitors).toHaveBeenCalledWith(
                expect.objectContaining({'node1:object1': {monitor: 'active'}})
            );

            vi.clearAllMocks();
            fire(handler, {path: 'object1', instance_monitor: {monitor: 'active'}});
            fire(handler, {node: 'node1', instance_monitor: {monitor: 'active'}});
            fire(handler, {node: 'node1', path: 'object1'});
            vi.runAllTimers();
            expect(mockStore.setInstanceMonitors).not.toHaveBeenCalled();

            mockStore.instanceMonitor = {'node1:object1': {monitor: 'active'}};
            fire(handler, {node: 'node1', path: 'object1', instance_monitor: {monitor: 'active'}});
            vi.runAllTimers();
            expect(mockStore.instanceMonitor).toEqual({'node1:object1': {monitor: 'active'}});
        });

        test('should process InstanceConfigUpdated with config, labels.path, missing fields, and multiple nodes', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigUpdated');

            fire(handler, {path: 'object1', node: 'node1', instance_config: {config: 'v1'}});
            fire(handler, {path: 'object1', node: 'node2', instance_config: {config: 'v2'}});
            eventSourceManager.forceFlush();
            expect(mockStore.setInstanceConfig).toHaveBeenCalledWith('object1', 'node1', {config: 'v1'});
            expect(mockStore.setInstanceConfig).toHaveBeenCalledWith('object1', 'node2', {config: 'v2'});
            expect(mockStore.setConfigUpdated).toHaveBeenCalled();

            vi.clearAllMocks();
            mockNow += 100;
            fire(handler, {labels: {path: 'object1'}, node: 'node1'});
            eventSourceManager.forceFlush();
            expect(mockStore.setConfigUpdated).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]));

            vi.clearAllMocks();
            mockNow += 100;
            fire(handler, {node: 'node1'});
            fire(handler, {path: 'object1'});
            eventSourceManager.forceFlush();
            expect(console.warn).toHaveBeenCalledWith('⚠️ InstanceConfigUpdated event missing name or node:', expect.any(Object));
            expect(mockStore.setConfigUpdated).not.toHaveBeenCalled();
        });

        test('should process InstanceConfigDeleted event', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigDeleted');
            fire(handler, {path: 'obj1', node: 'node1'});
            vi.runAllTimers();
            expect(mockStore.removeInstanceFromObject).toHaveBeenCalledWith('obj1', 'node1');
            expect(mockStore.removePendingDelete).toHaveBeenCalledWith('obj1', 'node1');
        });

        test('a node dropped by the cluster (NodeMonitorDeleted) leaves the store', () => {
            const es = createES();
            const handler = getHandler(es, 'NodeMonitorDeleted');
            fire(handler, {node: 'node1'});
            fire(handler, {labels: {node: 'node2'}});
            fire(handler, {});
            vi.runAllTimers();
            expect(mockStore.removeNode.mock.calls).toEqual([['node1'], ['node2']]);
        });

        test('should warn on InstanceConfigDeleted missing path or node', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigDeleted');
            fire(handler, {path: 'obj1'});
            fire(handler, {node: 'node1'});
            vi.runAllTimers();
            expect(console.warn).toHaveBeenCalledWith('⚠️ InstanceConfigDeleted event missing path or node:', expect.any(Object));
            expect(mockStore.removeInstanceFromObject).not.toHaveBeenCalled();
        });

        test('should use labels.path and labels.node fallback in InstanceConfigDeleted', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigDeleted');
            fire(handler, {labels: {path: 'obj1', node: 'node1'}});
            vi.runAllTimers();
            expect(mockStore.removeInstanceFromObject).toHaveBeenCalledWith('obj1', 'node1');
            expect(mockStore.removePendingDelete).toHaveBeenCalledWith('obj1', 'node1');
            expect(console.warn).not.toHaveBeenCalledWith(
                '⚠️ InstanceConfigDeleted event missing path or node:', expect.any(Object)
            );
        });

        test('should handle invalid JSON in events', () => {
            const es = createES();
            getHandler(es, 'NodeStatusUpdated')({data: 'invalid json {['});
            expect(console.warn).toHaveBeenCalledWith('⚠️ Invalid JSON in NodeStatusUpdated event:', 'invalid json {[');
        });

        test('should call logger.debug when DEBUG_BUFFERS is enabled (line 61)', () => {
            eventSourceManager.setDebugBuffers(true);
            try {
                const es = createES();
                const handler = getHandler(es, 'NodeStatusUpdated');
                fire(handler, {node: 'node1', node_status: {status: 'up'}});

                // debugLog is invoked from updateBuffer with the merged value.
                // The real logger wraps console.debug, which is already spied.
                expect(console.debug).toHaveBeenCalled();

                // flush to drain buffers cleanly
                vi.runAllTimers();
            } finally {
                eventSourceManager.setDebugBuffers(false);
            }
        });

        test('should handle empty buffers gracefully', () => {
            createES();
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).not.toHaveBeenCalled();
            eventSourceManager.forceFlush();
            expect(console.error).not.toHaveBeenCalled();
        });

        test('should handle errors during buffer flush', () => {
            mockStore.setNodeStatuses.mockImplementation(() => {
                throw new Error('Test error');
            });
            const es = createES();
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            vi.runAllTimers();
            expect(console.error).toHaveBeenCalledWith('Error during buffer flush:', expect.any(Error));
        });

        test('should clear all buffers and reset state via setPageActive', () => {
            const es = createES();
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            eventSourceManager.setPageActive(false);
            eventSourceManager.setPageActive(true);
            eventSourceManager.forceFlush();
            expect(mockStore.setNodeStatuses).not.toHaveBeenCalled();
        });

        test('should not flush when page not active', () => {
            const es = createES();
            eventSourceManager.setPageActive(false);
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).not.toHaveBeenCalled();
        });

        test('should clear existing timeout when eventCount reaches BATCH_SIZE', () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            for (let i = 0; i < 100; i++) fire(handler, {node: `node${i}`, node_status: {status: 'up'}});
            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });

        test('should reschedule flush when MIN_FLUSH_INTERVAL not elapsed', () => {
            const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            fire(handler, {node: 'node1', node_status: {status: 'up'}});
            vi.clearAllTimers();
            const flushTime = mockNow;
            eventSourceManager.forceFlush();
            mockNow = flushTime + 2;
            fire(handler, {node: 'node2', node_status: {status: 'down'}});
            vi.clearAllTimers();
            setTimeoutSpy.mockClear();
            eventSourceManager.forceFlush();
            expect(setTimeoutSpy).toHaveBeenCalled();
            mockNow = flushTime + 100000;
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).toHaveBeenCalled();
            setTimeoutSpy.mockRestore();
        });

        test('should clear pending flushTimeoutId when flushBuffers starts', () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
            const es = createES();
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            clearTimeoutSpy.mockClear();
            eventSourceManager.forceFlush();
            expect(clearTimeoutSpy).toHaveBeenCalled();
            expect(mockStore.setNodeStatuses).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });

        test('should set needsFlush when event arrives during active flush', () => {
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            let callCount = 0;
            const originalSetNodeStatuses = mockStore.setNodeStatuses;
            mockStore.setNodeStatuses = vi.fn((v) => {
                originalSetNodeStatuses(v);
                if (++callCount === 1) fire(handler, {node: 'node99', node_status: {status: 'up'}});
            });
            fire(handler, {node: 'node1', node_status: {status: 'up'}});
            vi.clearAllTimers();
            eventSourceManager.forceFlush();
            mockNow += 20;
            vi.advanceTimersByTime(100);
            expect(mockStore.setNodeStatuses).toHaveBeenCalledTimes(2);
            expect(mockStore.setNodeStatuses).toHaveBeenLastCalledWith(
                expect.objectContaining({node1: {status: 'up'}, node99: {status: 'up'}})
            );
            mockStore.setNodeStatuses = originalSetNodeStatuses;
        });

        test('should early-return from flushBuffers when isFlushing is true (line 173)', () => {
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            const originalSetNodeStatuses = mockStore.setNodeStatuses;
            let reentered = false;
            mockStore.setNodeStatuses = vi.fn((v) => {
                originalSetNodeStatuses(v);
                if (!reentered) {
                    reentered = true;
                    // flushBuffers is now running with isFlushing=true.
                    // Calling forceFlush → flushBuffers → hits the `|| isFlushing` branch.
                    eventSourceManager.forceFlush();
                }
            });
            try {
                fire(handler, {node: 'node1', node_status: {status: 'up'}});
                vi.clearAllTimers();
                eventSourceManager.forceFlush();
                expect(reentered).toBe(true);
                // The re-entrant call returned early, so setNodeStatuses ran only once
                expect(mockStore.setNodeStatuses).toHaveBeenCalledTimes(1);
            } finally {
                mockStore.setNodeStatuses = originalSetNodeStatuses;
            }
        });

        test('should debounce multiple rapid events into a single flush', () => {
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            fire(handler, {node: 'n1', node_status: {status: 'up'}});
            fire(handler, {node: 'n2', node_status: {status: 'down'}});
            fire(handler, {node: 'n3', node_status: {status: 'up'}});
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).toHaveBeenCalledTimes(1);
            expect(mockStore.setNodeStatuses).toHaveBeenCalledWith(
                expect.objectContaining({n1: {status: 'up'}, n2: {status: 'down'}, n3: {status: 'up'}})
            );
        });

        test('should skip debounce callback when eventCount already drained', () => {
            const es = createES();
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            eventSourceManager.forceFlush();
            mockStore.setNodeStatuses.mockClear();
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).not.toHaveBeenCalled();
        });

        test('should use requestAnimationFrame for non-Safari BATCH_SIZE flush', () => {
            const rafSpy = vi.spyOn(global, 'requestAnimationFrame');
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            for (let i = 0; i < 50; i++) fire(handler, {node: `node${i}`, node_status: {status: 'up'}});
            expect(rafSpy).toHaveBeenCalled();
            rafSpy.mockRestore();
            vi.runAllTimers();
        });

        test('should flush immediately on reconnect if buffered', () => {
            const es = createES();
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            mockEventSource.onopen();
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).toHaveBeenCalled();
        });

        test('should handle Safari batch updates', () => {
            const originalUA = navigator.userAgent;
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/14.0 Safari/605.1.15',
                writable: true, configurable: true,
            });
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            for (let i = 0; i < 150; i++) fire(handler, {node: `node${i}`, node_status: {status: 'up'}});
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).toHaveBeenCalled();
            Object.defineProperty(navigator, 'userAgent', {value: originalUA, writable: true, configurable: true});
        });

        test('should handle isEqual comparison with null values', () => {
            const es = createES();
            mockStore.nodeStatus = {node1: null};
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            vi.runAllTimers();
            expect(mockStore.setNodeStatuses).toHaveBeenCalled();
        });

        test('should remove buffered instanceStatus if pending delete exists', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceStatusUpdated');
            fire(handler, {path: 'obj1', node: 'node1', instance_status: {status: 'running'}});
            mockStore.pendingDeletes = {'obj1:node1': true};
            vi.runAllTimers();
            expect(mockStore.setInstanceStatuses).toHaveBeenCalled();
            expect(mockStore.setInstanceStatuses.mock.calls[0][0].obj1).toEqual({});
        });

        test('should remove buffered instanceConfig if pending delete exists', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigUpdated');
            fire(handler, {path: 'obj1', node: 'node1', instance_config: {cfg: 1}});
            mockStore.pendingDeletes = {'obj1:node1': true};
            vi.runAllTimers();
            expect(mockStore.setInstanceConfig).not.toHaveBeenCalled();
        });

        test('should handle configUpdated event with missing name/node', () => {
            const es = createES();
            fire(getHandler(es, 'InstanceConfigUpdated'), {instance_config: {cfg: 1}});
            vi.runAllTimers();
            expect(mockStore.setConfigUpdated).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith('⚠️ InstanceConfigUpdated event missing name or node:', expect.any(Object));
        });

        test('should not flush when eventCount is zero', () => {
            createES();
            eventSourceManager.forceFlush();
            expect(mockStore.setNodeStatuses).not.toHaveBeenCalled();
        });

        test('should handle JSON parse error in configUpdated during flush', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigUpdated');
            fire(handler, {path: 'obj1', node: 'node1', instance_config: {x: 1}});

            const originalParse = JSON.parse;
            JSON.parse = vi.fn((str) => {
                if (str.includes('"node":"node1"')) throw new Error('parse error');
                return originalParse(str);
            });
            eventSourceManager.forceFlush();
            JSON.parse = originalParse;

            expect(mockStore.setConfigUpdated).toHaveBeenCalled();
            expect(mockStore.setConfigUpdated.mock.calls[0][0].length).toBeGreaterThanOrEqual(1);
        });

        test('should keep configUpdated entries that parse without name or node', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigUpdated');
            fire(handler, {path: 'obj1', node: 'node1', instance_config: {x: 1}});

            const originalParse = JSON.parse;
            JSON.parse = vi.fn((str) => {
                if (str.includes('"node":"node1"')) return {foo: 'bar'};
                return originalParse(str);
            });
            try {
                eventSourceManager.forceFlush();
            } finally {
                JSON.parse = originalParse;
            }

            expect(mockStore.setConfigUpdated).toHaveBeenCalled();
            const updates = mockStore.setConfigUpdated.mock.calls[0][0];
            expect(updates).toContain(JSON.stringify({name: 'obj1', node: 'node1'}));
        });

        test('should skip configUpdated entries matching a pending delete by node and path', () => {
            const es = createES();
            const handler = getHandler(es, 'InstanceConfigUpdated');
            fire(handler, {path: 'my-service/obj1', node: 'node1', instance_config: {x: 1}});
            mockStore.pendingDeletes = {'my-service/obj1:node1': true};
            eventSourceManager.forceFlush();
            expect(mockStore.setConfigUpdated).not.toHaveBeenCalled();
        });

        test('should handle store with undefined pendingDeletes (line 194)', () => {
            const saved = mockStore.pendingDeletes;
            mockStore.pendingDeletes = undefined;
            try {
                const es = createES();
                fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
                vi.runAllTimers();
                expect(mockStore.setNodeStatuses).toHaveBeenCalledWith(
                    expect.objectContaining({node1: {status: 'up'}})
                );
            } finally {
                mockStore.pendingDeletes = saved;
            }
        });

        test('should keep the last instanceStatus, merge repeated buffer updates for instanceConfig, instanceMonitor, and catch-all', () => {
            {
                const es = createES();
                const h = getHandler(es, 'InstanceStatusUpdated');
                // Each event the whole status: the last one, nothing of the first kept.
                fire(h, {path: 'obj1', node: 'n1', instance_status: {a: 1}});
                fire(h, {path: 'obj1', node: 'n1', instance_status: {b: 2}});
                eventSourceManager.forceFlush();
                expect(mockStore.setInstanceStatuses).toHaveBeenCalledWith(
                    expect.objectContaining({obj1: {n1: {b: 2}}})
                );
                eventSourceManager.closeEventSource();
            }
            vi.clearAllMocks();
            mockNow += 1_000_000;

            {
                const es = createES();
                const h = getHandler(es, 'InstanceConfigUpdated');
                fire(h, {path: 'obj1', node: 'n1', instance_config: {a: 1}});
                fire(h, {path: 'obj1', node: 'n1', instance_config: {b: 2}});
                eventSourceManager.forceFlush();
                expect(mockStore.setInstanceConfig).toHaveBeenCalledWith('obj1', 'n1', {a: 1, b: 2});
                eventSourceManager.closeEventSource();
            }
            vi.clearAllMocks();
            mockNow += 1_000_000;

            {
                const es = createES();
                const h = getHandler(es, 'InstanceMonitorUpdated');
                fire(h, {node: 'n1', path: 'obj1', instance_monitor: {a: 1}});
                fire(h, {node: 'n1', path: 'obj1', instance_monitor: {b: 2}});
                eventSourceManager.forceFlush();
                expect(mockStore.setInstanceMonitors).toHaveBeenCalledWith(
                    expect.objectContaining({'n1:obj1': {a: 1, b: 2}})
                );
                eventSourceManager.closeEventSource();
            }
            vi.clearAllMocks();
            mockNow += 1_000_000;

            {
                const es = createES();
                const h = getHandler(es, 'NodeStatusUpdated');
                fire(h, {node: 'n1', node_status: {a: 1}});
                fire(h, {node: 'n1', node_status: {b: 2}});
                eventSourceManager.forceFlush();
                expect(mockStore.setNodeStatuses).toHaveBeenCalledWith(
                    expect.objectContaining({n1: {a: 1, b: 2}})
                );
            }
        });

        test('should flush in setTimeout callback when eventCount > 0', () => {
            const es = createES();
            const handler = getHandler(es, 'NodeStatusUpdated');
            fire(handler, {node: 'node1', node_status: {status: 'up'}});
            vi.advanceTimersByTime(5);
            fire(handler, {node: 'node2', node_status: {status: 'down'}});
            vi.advanceTimersByTime(10);
            expect(mockStore.setNodeStatuses).toHaveBeenCalledWith(
                expect.objectContaining({node1: {status: 'up'}, node2: {status: 'down'}})
            );
        });

        test('should hit second scheduleFlush branch when flushTimeoutId is null and eventCount > 1', () => {
            const perf = global.performance;
            const originalNow = perf.now;
            let shouldThrow = false;
            perf.now = () => {
                if (shouldThrow) throw new Error('mock perf error');
                return mockNow;
            };

            try {
                const es = createES();
                const handler = getHandler(es, 'NodeStatusUpdated');

                fire(handler, {node: 'node1', node_status: {status: 'up'}});

                shouldThrow = true;
                try {
                    vi.advanceTimersByTime(10);
                } catch (e) {}
                shouldThrow = false;

                const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
                fire(handler, {node: 'node2', node_status: {status: 'up'}});

                const tenMsCalls = setTimeoutSpy.mock.calls.filter(c => c[1] === 10);
                expect(tenMsCalls.length).toBeGreaterThan(0);
                setTimeoutSpy.mockRestore();

                vi.advanceTimersByTime(1000);
            } finally {
                perf.now = originalNow;
            }
        });

        test('should hit !isPageActive early return in scheduleFlush (line 325)', () => {
            const es = createES();
            const originalParse = JSON.parse;
            let toggled = false;
            JSON.parse = vi.fn((str) => {
                if (!toggled) {
                    toggled = true;
                    eventSourceManager.setPageActive(false);
                }
                return originalParse(str);
            });
            try {
                const handler = getHandler(es, 'NodeStatusUpdated');
                fire(handler, {node: 'node1', node_status: {status: 'up'}});
                expect(mockStore.setNodeStatuses).not.toHaveBeenCalled();
            } finally {
                JSON.parse = originalParse;
                eventSourceManager.setPageActive(true);
            }
        });
    });

    // ==================== Error handling and reconnection ====================
    describe('Error handling and reconnection', () => {
        test('should handle errors and try to reconnect with exponential backoff', () => {
            const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
            createES();
            mockEventSource.onerror({status: 500});
            expect(console.error).toHaveBeenCalled();
            expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Reconnecting in'));
            const delay = setTimeoutSpy.mock.calls[0][1];
            expect(delay).toBeGreaterThanOrEqual(1000);
            expect(delay).toBeLessThanOrEqual(30000);
            setTimeoutSpy.mockRestore();
        });

        test('should not redirect if page not active on max attempts', () => {
            eventSourceManager.setPageActive(false);
            createES();
            let currentMock = mockEventSource;
            for (let i = 0; i < 10; i++) {
                currentMock.onerror({status: 500});
                vi.advanceTimersByTime(1000);
                currentMock = {
                    onopen: vi.fn(), onerror: vi.fn(), addEventListener: vi.fn(),
                    close: vi.fn(), readyState: 1,
                };
                vi.mocked(EventSourcePolyfill).mockImplementation(() => currentMock);
            }
            currentMock.onerror({status: 500});
            expect(window.dispatchEvent).not.toHaveBeenCalled();
        });

        test('should not reconnect when no current token', () => {
            localStorageMock.getItem.mockReturnValue(null);
            createES();
            mockEventSource.onerror({status: 500});
            vi.advanceTimersByTime(2000);
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(1);
        });
    });

    // ==================== Utility functions and helpers ====================
    describe('Utility functions and helpers', () => {
        test('should handle valid, invalid, and empty filters in createQueryString', () => {
            eventSourceManager.configureEventSource('fake-token');
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('cache=true');

            vi.clearAllMocks();
            eventSourceManager.configureEventSource('fake-token', null, ['InvalidFilter', 'NodeStatusUpdated']);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid filters detected'));
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('filter=NodeStatusUpdated');

            vi.clearAllMocks();
            eventSourceManager.configureEventSource('fake-token', null, []);
            expect(console.warn).toHaveBeenCalledWith('No valid API event filters provided, using default filters');
            expect(EventSourcePolyfill).toHaveBeenCalled();
        });

        test('should dispatch auth redirect event', () => {
            eventSourceManager.navigationService.redirectToAuth();
            expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
            const event = vi.mocked(window.dispatchEvent).mock.calls[0][0];
            expect(event.type).toBe('om3:auth-redirect');
            expect(event.detail).toBe('/auth-choice');
        });

        test('should export prepareForNavigation as alias for forceFlush', () => {
            expect(typeof eventSourceManager.prepareForNavigation).toBe('function');
            const es = createES();
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            vi.clearAllTimers();
            eventSourceManager.prepareForNavigation();
            expect(mockStore.setNodeStatuses).toHaveBeenCalled();
        });

        test('should configure EventSource with objectName - adds path to filter URL', () => {
            eventSourceManager.configureEventSource('fake-token', 'my-service/svc1');
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('path');
        });

        test('should create URL with cache=false when useCache is false', () => {
            eventSourceManager.configureEventSource('fake-token', null, ['NodeStatusUpdated'], false);
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('cache=false');
        });

        test('clearEventBuffers should reset buffers and state', () => {
            const es = createES();
            fire(getHandler(es, 'NodeStatusUpdated'), {node: 'node1', node_status: {status: 'up'}});
            eventSourceManager.clearEventBuffers();
            eventSourceManager.forceFlush();
            expect(mockStore.setNodeStatuses).not.toHaveBeenCalled();
        });
    });

    // ==================== Logger EventSource ====================
    describe('Logger EventSource', () => {
        beforeEach(() => {
            vi.mocked(EventSourcePolyfill).mockImplementation(() => mockLoggerEventSource);
        });

        test('should create logger EventSource and attach listeners for valid filters only', () => {
            const ls = eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token',
                ['ObjectStatusUpdated', 'InstanceStatusUpdated', 'Invalid']);
            expect(ls.addEventListener).toHaveBeenCalledTimes(2);
            expect(ls.addEventListener.mock.calls[0][0]).toBe('ObjectStatusUpdated');
        });

        test('should close existing logger before creating new, and not throw if none', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', []);
            vi.mocked(EventSourcePolyfill).mockImplementationOnce(() => ({...mockLoggerEventSource}));
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', []);
            expect(mockLoggerEventSource.close).toHaveBeenCalled();
            expect(() => eventSourceManager.closeLoggerEventSource()).not.toThrow();
        });

        test('should not create logger if no token', () => {
            expect(eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, '', [])).toBeNull();
            expect(console.error).toHaveBeenCalledWith('❌ Missing token for Logger EventSource!');
        });

        test('should handle open and error events without logging them', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', []);
            mockLoggerEventSource.onopen();
            expect(console.info).toHaveBeenCalledWith('✅ Logger EventSource connection established');
            expect(mockLogStore.addEventLog).not.toHaveBeenCalledWith('CONNECTION_OPENED', expect.any(Object));

            mockLoggerEventSource.onerror({message: 'test error', status: 500});
            expect(console.error).toHaveBeenCalled();
            expect(mockLogStore.addEventLog).not.toHaveBeenCalledWith('CONNECTION_ERROR', expect.any(Object));
        });

        test('should handle 401 in logger: new token, silent renew success and failure', async () => {
            localStorageMock.getItem.mockReturnValue('new-token');
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'old-token', []);
            mockLoggerEventSource.onerror({status: 401});
            expect(console.info).toHaveBeenCalledWith('🔄 New token available, updating Logger EventSource');

            const mockUser = {access_token: 'new-logger-token', expires_at: Date.now() + 3600000};
            window.oidcUserManager = {signinSilent: vi.fn().mockResolvedValue(mockUser)};
            localStorageMock.getItem.mockReturnValue(null);
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'old-token', []);
            mockLoggerEventSource.onerror({status: 401});
            await vi.runAllTimersAsync();
            expect(localStorageMock.setItem).toHaveBeenCalledWith('authToken', 'new-logger-token');

            window.oidcUserManager = {signinSilent: vi.fn().mockRejectedValue(new Error('logger renew fail'))};
            localStorageMock.getItem.mockReturnValue(null);
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'old-token', []);
            mockLoggerEventSource.onerror({status: 401});
            await vi.runAllTimersAsync();
            expect(console.error).toHaveBeenCalledWith('❌ Silent renew failed for logger:', expect.any(Error));
        });

        test('should handle max reconnections in logger without connection logging', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', []);
            for (let i = 0; i < 15; i++) {
                mockLoggerEventSource.onerror({status: 500});
                vi.advanceTimersByTime(1000);
            }
            expect(console.error).toHaveBeenCalledWith('❌ Max reconnection attempts reached for logger');
            expect(mockLogStore.addEventLog).not.toHaveBeenCalledWith('MAX_RECONNECTIONS_REACHED', expect.any(Object));
            expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
        });

        test('should process events and log them, handle invalid JSON', () => {
            eventSourceManager.setPageActive(true);
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', ['ObjectStatusUpdated']);
            const handler = mockLoggerEventSource.addEventListener.mock.calls[0][1];
            fire(handler, {path: 'test'});
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('ObjectStatusUpdated', expect.any(Object));

            handler({data: 'not valid json'});
            expect(mockLogStore.addEventLog).toHaveBeenCalledWith('ObjectStatusUpdated_PARSE_ERROR',
                expect.objectContaining({error: expect.any(String), rawData: 'not valid json'})
            );
        });

        test('should ignore events when page not active', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', ['ObjectStatusUpdated']);
            eventSourceManager.setPageActive(false);
            fire(mockLoggerEventSource.addEventListener.mock.calls[0][1], {path: 'test'});
            expect(mockLogStore.addEventLog).not.toHaveBeenCalled();
        });

        test('should call and handle errors in logger _cleanup', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', []);
            const cleanupSpy = vi.fn();
            mockLoggerEventSource._cleanup = cleanupSpy;
            eventSourceManager.closeLoggerEventSource();
            expect(cleanupSpy).toHaveBeenCalled();

            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', []);
            mockLoggerEventSource._cleanup = () => {
                throw new Error('logger cleanup error');
            };
            expect(() => eventSourceManager.closeLoggerEventSource()).not.toThrow();
            expect(console.debug).toHaveBeenCalledWith('Error during logger eventSource cleanup', expect.any(Error));
        });

        test('should not update logger if no new token', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'old-token', []);
            eventSourceManager.updateLoggerEventSourceToken('');
            expect(mockLoggerEventSource.close).not.toHaveBeenCalled();
        });

        test('should handle missing token in configureLoggerEventSource and startLoggerReception', () => {
            eventSourceManager.configureLoggerEventSource('');
            expect(console.error).toHaveBeenCalledWith('❌ No token provided for Logger SSE!');
            eventSourceManager.startLoggerReception('');
            expect(console.error).toHaveBeenCalledWith('❌ No token provided for Logger SSE!');
        });

        test('should ignore onerror if not current logger EventSource', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', []);
            eventSourceManager.closeLoggerEventSource();
            mockLoggerEventSource.onerror({status: 500});
            expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Logger reconnecting'));
        });

        test('should restart logger EventSource when updateLoggerEventSourceToken called with open connection', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'old-token', ['ObjectStatusUpdated']);
            const nextMock = {...mockLoggerEventSource, close: vi.fn(), addEventListener: vi.fn()};
            vi.mocked(EventSourcePolyfill).mockImplementation(() => nextMock);
            localStorageMock.getItem.mockReturnValue('new-token');
            eventSourceManager.updateLoggerEventSourceToken('new-token');
            expect(mockLoggerEventSource.close).toHaveBeenCalled();
            vi.advanceTimersByTime(200);
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(2);
        });

        test('should restart logger EventSource when connection is already closed: the polyfill closes one refused', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'old-token', []);
            mockLoggerEventSource.readyState = 2;
            eventSourceManager.updateLoggerEventSourceToken('new-token');
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(2);
            expect(EventSourcePolyfill.mock.calls[1][1].headers.Authorization).toBe('Bearer new-token');
        });

        test('should configure and start logger with objectName', () => {
            eventSourceManager.configureLoggerEventSource('fake-token', 'my-service/svc1');
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('path');

            vi.clearAllMocks();
            eventSourceManager.startLoggerReception('fake-token', eventSourceManager.DEFAULT_FILTERS, 'my-service/svc1');
            expect(EventSourcePolyfill.mock.calls[0][0]).toContain('path');
        });

        test('should start logger for one node, filtering its events by node label', () => {
            eventSourceManager.startLoggerReception('fake-token', ['NodeStatusUpdated'], null, 'dev3n1');
            const url = EventSourcePolyfill.mock.calls[0][0];
            expect(url).toContain('filter=NodeStatusUpdated,node=dev3n1');
            expect(url).not.toContain('path=');
        });

        test('should reconnect logger EventSource after timeout with valid token', () => {
            // reset global reconnectAttempts
            eventSourceManager.createEventSource(URL_NODE_EVENT, 'temp-token');
            eventSourceManager.closeEventSource();
            vi.clearAllMocks();

            localStorageMock.getItem.mockReturnValue('fake-token');
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', ['ObjectStatusUpdated']);
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(1);

            mockLoggerEventSource.onerror({status: 500});
            vi.advanceTimersByTime(5000);

            expect(EventSourcePolyfill).toHaveBeenCalledTimes(2);
            const secondCallUrl = vi.mocked(EventSourcePolyfill).mock.calls[1][0];
            expect(secondCallUrl).toBe(URL_NODE_EVENT);

            const secondES = vi.mocked(EventSourcePolyfill).mock.results[1].value;
            const attachedEvents = secondES.addEventListener.mock.calls.map(c => c[0]);
            expect(attachedEvents).toContain('ObjectStatusUpdated');
        });

        test('should not reconnect logger when no current token in setTimeout callback', () => {
            eventSourceManager.createLoggerEventSource(URL_NODE_EVENT, 'fake-token', ['ObjectStatusUpdated']);
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(1);

            // Simulate logout between error and reconnect
            localStorageMock.getItem.mockReturnValue(null);
            mockLoggerEventSource.onerror({status: 500});
            // Clear current logger so getCurrentToken returns null
            eventSourceManager.closeLoggerEventSource();
            vi.advanceTimersByTime(5000);
            // createLoggerEventSource should not have been called again
            expect(EventSourcePolyfill).toHaveBeenCalledTimes(1);
        });
    });

    // ==================== Safari-specific branch coverage ====================
    describe('Safari optimizations (isSafari true)', () => {
        let SafariESManager;
        let originalUA;
        let polyfillMock;

        beforeEach(async () => {
            vi.resetModules();
            originalUA = navigator.userAgent;
            Object.defineProperty(navigator, 'userAgent', {
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15',
                writable: true, configurable: true,
            });

            vi.doMock('event-source-polyfill', () => ({EventSourcePolyfill: vi.fn()}));
            vi.doMock('../hooks/useEventStore.js', () => ({__esModule: true, default: {getState: vi.fn()}}));
            vi.doMock('../hooks/useEventLogStore.js', () => ({__esModule: true, default: {getState: vi.fn()}}));
            vi.doMock('../utils/logger.js', () => ({
                default: {
                    info: vi.fn(),
                    warn: vi.fn(),
                    error: vi.fn(),
                    debug: vi.fn(),
                },
            }));

            SafariESManager = await import('../eventSourceManager');
            const useEventStoreModule = await import('../hooks/useEventStore.js');
            vi.mocked(useEventStoreModule.default.getState).mockReturnValue({...mockStore, pendingDeletes: {}});
            const useEventLogStoreModule = await import('../hooks/useEventLogStore.js');
            vi.mocked(useEventLogStoreModule.default.getState).mockReturnValue({addEventLog: vi.fn()});

            const polyfill = await import('event-source-polyfill');
            polyfillMock = polyfill;
            vi.mocked(polyfill.EventSourcePolyfill).mockImplementation(() => ({
                onopen: vi.fn(), onerror: null, addEventListener: vi.fn(),
                close: vi.fn(), readyState: 1,
                url: URL_NODE_EVENT + '?cache=true&filter=NodeStatusUpdated',
            }));
        });

        afterEach(() => {
            Object.defineProperty(navigator, 'userAgent', {value: originalUA, writable: true, configurable: true});
            vi.resetModules();
        });

        test('should use setTimeout instead of requestAnimationFrame for batch flush', () => {
            const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
            SafariESManager.createEventSource(URL_NODE_EVENT, 'fake-token');
            const esMock = polyfillMock.EventSourcePolyfill.mock.results[0].value;
            const handler = esMock.addEventListener.mock.calls.find(c => c[0] === 'NodeStatusUpdated')[1];
            for (let i = 0; i < 150; i++) fire(handler, {node: `node${i}`, node_status: {status: 'up'}});
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
            setTimeoutSpy.mockRestore();
            vi.runAllTimers();
        });

        test('should set BATCH_SIZE to 150', () => {
            const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
            SafariESManager.createEventSource(URL_NODE_EVENT, 'fake-token');
            const esMock = polyfillMock.EventSourcePolyfill.mock.results[0].value;
            const handler = esMock.addEventListener.mock.calls.find(c => c[0] === 'NodeStatusUpdated')[1];
            for (let i = 0; i < 149; i++) fire(handler, {node: `node${i}`, node_status: {status: 'up'}});
            expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 0);
            fire(handler, {node: 'node149', node_status: {status: 'up'}});
            expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
            setTimeoutSpy.mockRestore();
            vi.runAllTimers();
        });
    });

    // ==================== isEqual function ====================
    describe('isEqual function', () => {
        const isEqual = eventSourceManager.isEqual;

        test.each([
            ['identical primitives', 1, 1, true],
            ['different primitives', 1, 2, false],
            ['identical strings', 'a', 'a', true],
            ['different strings', 'a', 'b', false],
            ['null vs object', null, {}, false],
            ['object vs null', {}, null, false],
            ['undefined vs object', undefined, {}, false],
            ['object vs string', {}, 'string', false],
            ['number vs object', 123, {}, false],
            ['shallow equal objects', {a: 1, b: 2}, {a: 1, b: 2}, true],
            ['different key counts', {a: 1}, {a: 1, b: 2}, false],
            ['different values', {a: 1, b: 2}, {a: 1, b: 3}, false],
            ['nested equal objects', {a: {x: 1}}, {a: {x: 1}}, true],
            ['nested different objects', {a: {x: 1}}, {a: {x: 2}}, false],
            ['nested different key counts', {a: {x: 1, y: 2}}, {a: {x: 1}}, false],
            ['equal arrays', {a: [1, 2]}, {a: [1, 2]}, true],
            ['different arrays', {a: [1, 2]}, {a: [1, 3]}, false],
            ['type mismatch at top level', {a: 1}, {a: '1'}, false],
            ['type mismatch nested', {a: {b: 1}}, {a: {b: '1'}}, false],
        ])('%s', (_label, a, b, expected) => {
            expect(isEqual(a, b)).toBe(expected);
        });
    });

    describe('reconcileObjects', () => {
        const answer = (paths, ok = true) => vi.fn(() => Promise.resolve({
            ok, status: ok ? 200 : 500, json: () => Promise.resolve(paths),
        }));

        beforeEach(() => {
            mockStore.objectStatus = {'root/svc/kept': {}, 'root/svc/gone': {}};
            mockStore.objectInstanceStatus = {'root/svc/gone': {}};
            mockStore.instanceConfig = {};
            mockStore.instanceMonitor = {'n1:root/svc/stale': {}};
        });

        test('drops the objects the daemon no longer lists', async () => {
            global.fetch = answer(['root/svc/kept', 'root/svc/other']);
            await eventSourceManager.reconcileObjects('tok');
            expect(global.fetch).toHaveBeenCalledWith(`${URL_OBJECT}?path=**`, expect.objectContaining({
                headers: {Authorization: 'Bearer tok'},
            }));
            expect(mockStore.removeObjects).toHaveBeenCalledWith(['root/svc/gone', 'root/svc/stale']);
        });

        test('keeps an object created while the list was asked for', async () => {
            global.fetch = vi.fn(() => {
                mockStore.objectStatus = {...mockStore.objectStatus, 'root/svc/new': {}};
                return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(['root/svc/kept'])});
            });
            await eventSourceManager.reconcileObjects('tok');
            expect(mockStore.removeObjects).toHaveBeenCalledWith(['root/svc/gone', 'root/svc/stale']);
        });

        test('drops nothing when every object is listed', async () => {
            global.fetch = answer(['root/svc/kept', 'root/svc/gone', 'root/svc/stale']);
            await eventSourceManager.reconcileObjects('tok');
            expect(mockStore.removeObjects).not.toHaveBeenCalled();
        });

        test.each([
            ['a refused request', () => answer(null, false)],
            ['a network error', () => vi.fn(() => Promise.reject(new Error('offline')))],
            ['an unexpected answer', () => answer({items: []})],
        ])('drops nothing on %s', async (_label, makeFetch) => {
            global.fetch = makeFetch();
            await eventSourceManager.reconcileObjects('tok');
            expect(mockStore.removeObjects).not.toHaveBeenCalled();
        });

        test('asks nothing while no object is held', async () => {
            mockStore.objectStatus = {};
            mockStore.objectInstanceStatus = {};
            mockStore.instanceMonitor = {};
            global.fetch = answer([]);
            await eventSourceManager.reconcileObjects('tok');
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('runs each time the stream opens', async () => {
            global.fetch = answer(['root/svc/kept']);
            createES('tok');
            mockEventSource.onopen();
            await vi.waitFor(() => expect(mockStore.removeObjects).toHaveBeenCalledWith(['root/svc/gone', 'root/svc/stale']));
            expect(global.fetch).toHaveBeenCalledWith(`${URL_OBJECT}?path=**`, expect.anything());
        });
    });

    // ==================== Stream claims ====================
    describe('stream claims', () => {
        // The claims of one render are applied together, once its microtasks run.
        const settle = () => Promise.resolve();
        const openedUrls = () => vi.mocked(EventSourcePolyfill).mock.calls.map(([url]) => url);

        test('the union of the claims is the query', () => {
            const {query, types} = eventSourceManager.claimsQuery([
                {filters: ['ObjectStatusUpdated', 'InstanceStatusUpdated'], objectName: null},
                {filters: ['InstanceStatusUpdated', 'Bogus'], objectName: null},
            ]);
            expect(query).toBe('cache=true&filter=InstanceStatusUpdated&filter=ObjectStatusUpdated');
            expect(types).toEqual(['ObjectStatusUpdated', 'InstanceStatusUpdated']);
        });

        test('a claim on an object asks for the events of that object only', () => {
            const {query} = eventSourceManager.claimsQuery([
                {filters: ['ObjectStatusUpdated'], objectName: 'ns1/svc/web'},
            ]);
            expect(query).toContain('filter=ObjectStatusUpdated,path=ns1%2Fsvc%2Fweb');
            expect(query).toContain('filter=InstanceConfigUpdated,path=ns1%2Fsvc%2Fweb');
            expect(query).not.toMatch(/filter=ObjectStatusUpdated(&|$)/);
        });

        test('a panel over a list widens the stream, and closing it narrows it back', async () => {
            const releaseList = eventSourceManager.retainEventReception('tok', ['ObjectStatusUpdated']);
            await settle();
            expect(openedUrls()).toEqual([`${URL_NODE_EVENT}?cache=true&filter=ObjectStatusUpdated`]);

            const releasePanel = eventSourceManager.retainEventReception('tok', ['InstanceConfigUpdated'], 'ns1/svc/web');
            await settle();
            expect(openedUrls()).toHaveLength(2);
            expect(openedUrls()[1]).toContain('filter=ObjectStatusUpdated&');
            expect(openedUrls()[1]).toContain('path=ns1%2Fsvc%2Fweb');

            releasePanel();
            await settle();
            expect(openedUrls()).toHaveLength(3);
            expect(openedUrls()[2]).toBe(`${URL_NODE_EVENT}?cache=true&filter=ObjectStatusUpdated`);

            releaseList();
            await settle();
            expect(mockEventSource.close).toHaveBeenCalled();
            expect(openedUrls()).toHaveLength(3);
        });

        test('the claims released and made by one render open the stream once', async () => {
            const release = eventSourceManager.retainEventReception('tok', ['NodeStatusUpdated']);
            await settle();
            release();
            const again = eventSourceManager.retainEventReception('tok', ['NodeStatusUpdated']);
            await settle();
            expect(openedUrls()).toHaveLength(1);
            again();
            await settle();
        });

        test('a claim released twice releases once', async () => {
            const releaseA = eventSourceManager.retainEventReception('tok', ['NodeStatusUpdated']);
            const releaseB = eventSourceManager.retainEventReception('tok', ['NodeStatusUpdated']);
            await settle();
            releaseA();
            releaseA();
            await settle();
            expect(mockEventSource.close).not.toHaveBeenCalled();
            releaseB();
            await settle();
            expect(mockEventSource.close).toHaveBeenCalled();
        });

        test('no token, no claim', async () => {
            const release = eventSourceManager.retainEventReception('', ['NodeStatusUpdated']);
            await settle();
            expect(EventSourcePolyfill).not.toHaveBeenCalled();
            expect(() => release()).not.toThrow();
        });
    });
});
