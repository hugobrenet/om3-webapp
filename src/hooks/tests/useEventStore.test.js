import useEventStore, {clearObjectCache} from '../useEventStore.js';
import {act} from '@testing-library/react';

vi.mock('../../utils/logger.js', () => ({
    default: {
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import logger from '../../utils/logger.js';

describe('useEventStore', () => {
    beforeEach(() => {
        act(() => {
            useEventStore.setState({
                nodeStatus: {},
                nodeMonitor: {},
                nodeStats: {},
                objectStatus: {},
                objectInstanceStatus: {},
                heartbeatStatus: {},
                instanceMonitor: {},
                instanceConfig: {},
                configUpdates: [],
                pendingDeletes: {},
            });
        });
        vi.clearAllMocks();
    });

    test('should initialize with default state', () => {
        const s = useEventStore.getState();
        expect(s.nodeStatus).toEqual({});
        expect(s.nodeMonitor).toEqual({});
        expect(s.nodeStats).toEqual({});
        expect(s.objectStatus).toEqual({});
        expect(s.objectInstanceStatus).toEqual({});
        expect(s.heartbeatStatus).toEqual({});
        expect(s.instanceMonitor).toEqual({});
        expect(s.instanceConfig).toEqual({});
        expect(s.configUpdates).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Simple setters guarded by shallowEqual
    // -----------------------------------------------------------------------
    describe('simple setters (shallowEqual guard)', () => {
        const cases = [
            ['setNodeStatuses', 'nodeStatus'],
            ['setNodeMonitors', 'nodeMonitor'],
            ['setNodeStats', 'nodeStats'],
            ['setHeartbeatStatuses', 'heartbeatStatus'],
            ['setInstanceMonitors', 'instanceMonitor'],
            ['setObjectStatuses', 'objectStatus'],
        ];

        test.each(cases)('%s updates state when data differs', (method, key) => {
            const data = {k1: {a: 1}};
            act(() => {
                useEventStore.getState()[method](data);
            });
            expect(useEventStore.getState()[key]).toEqual(data);
        });

        test.each(cases)('%s does not update when shallow equal', (method, key) => {
            const data = {k1: {a: 1}};
            act(() => {
                useEventStore.getState()[method](data);
            });
            const first = useEventStore.getState();
            act(() => {
                useEventStore.getState()[method](data);
            });
            const second = useEventStore.getState();
            expect(second[key]).toBe(first[key]);
        });

        test('setObjectStatuses logs ACCEPTED / REJECTED', () => {
            const {setObjectStatuses} = useEventStore.getState();
            const data = {obj: {x: 1}};
            act(() => {
                setObjectStatuses(data);
            });
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('ACCEPTED'),
                expect.any(Object)
            );
            logger.debug.mockClear();
            act(() => {
                setObjectStatuses(data);
            });
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('REJECTED'),
                expect.any(Object)
            );
        });
    });

    // -----------------------------------------------------------------------
    // setInstanceConfig
    // -----------------------------------------------------------------------
    describe('setInstanceConfig', () => {
        test('sets config', () => {
            act(() => {
                useEventStore.getState().setInstanceConfig('o1', 'n1', {a: 1});
            });
            expect(useEventStore.getState().instanceConfig).toEqual({o1: {n1: {a: 1}}});
        });

        test('does not update when identical', () => {
            const cfg = {a: 1};
            act(() => {
                useEventStore.getState().setInstanceConfig('o1', 'n1', cfg);
            });
            const first = useEventStore.getState().instanceConfig;
            act(() => {
                useEventStore.getState().setInstanceConfig('o1', 'n1', cfg);
            });
            expect(useEventStore.getState().instanceConfig).toBe(first);
        });
    });

    // -----------------------------------------------------------------------
    // setInstanceStatuses (merge & replace)
    // -----------------------------------------------------------------------
    describe('setInstanceStatuses', () => {
        describe('merge mode (replace = false)', () => {
            test('adds new path and node', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n1: {status: 'up'}}});
                });
                expect(useEventStore.getState().objectInstanceStatus.svc.n1).toMatchObject({
                    node: 'n1', path: 'svc', status: 'up',
                });
            });

            test('skips update when existing node is shallow equal', () => {
                const data = {svc: {n1: {status: 'up'}}};
                act(() => {
                    useEventStore.getState().setInstanceStatuses(data);
                });
                const first = useEventStore.getState().objectInstanceStatus;
                act(() => {
                    useEventStore.getState().setInstanceStatuses(data);
                });
                expect(useEventStore.getState().objectInstanceStatus).toEqual(first);
            });

            test('an encap container whose resources went empty has none', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        svc: {n1: {encap: {c1: {resources: {cpu: 100}}}}}
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        svc: {n1: {encap: {c1: {resources: {}}}}}
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus.svc.n1.encap.c1.resources)
                    .toEqual({});
            });

            test('uses incoming resources when non-empty', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        svc: {n1: {encap: {c1: {resources: {memory: 256}}}}}
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus.svc.n1.encap.c1.resources)
                    .toEqual({memory: 256});
            });

            test('handles undefined encap', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n1: {encap: undefined}}});
                });
                expect(useEventStore.getState().objectInstanceStatus.svc.n1.encap).toBeUndefined();
            });

            test('skips inherited node properties', () => {
                const proto = {inheritedNode: {status: 'p'}};
                const nodes = Object.create(proto);
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: nodes});
                });
                expect(useEventStore.getState().objectInstanceStatus.svc).toEqual({});
            });

            test('a field the new status omits is gone', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n1: {status: 'old', val: 1}}});
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n1: {status: 'new'}}});
                });
                expect(useEventStore.getState().objectInstanceStatus.svc.n1).toEqual({
                    node: 'n1', path: 'svc', status: 'new',
                });
            });

            test('does not update state when nothing changed', () => {
                const data = {svc: {n1: {status: 'ok'}}};
                act(() => {
                    useEventStore.getState().setInstanceStatuses(data);
                });
                const first = useEventStore.getState().objectInstanceStatus;
                act(() => {
                    useEventStore.getState().setInstanceStatuses(data);
                });
                expect(useEventStore.getState().objectInstanceStatus).toEqual(first);
            });

            test('a container gone from encap is gone', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        svc: {n1: {encap: {c1: {resources: {cpu: 100}}, c2: {resources: {cpu: 50}}}}}
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        svc: {n1: {encap: {c1: {resources: {cpu: 100}}}}}
                    });
                });
                expect(Object.keys(useEventStore.getState().objectInstanceStatus.svc.n1.encap)).toEqual(['c1']);
            });

            test('an encap container that reports no resources has none', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        svc: {n1: {encap: {c1: {resources: {cpu: 100}}}}}
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        svc: {n1: {encap: {c1: {}}}}
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus.svc.n1.encap.c1.resources)
                    .toBeUndefined();
            });
        });

        describe('replace mode (replace = true)', () => {
            test('replaces entire path', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n1: {status: 'old'}}});
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n2: {status: 'new'}}}, true);
                });
                expect(useEventStore.getState().objectInstanceStatus.svc).toEqual({
                    n2: {node: 'n2', path: 'svc', status: 'new'},
                });
            });

            test('skips inherited properties', () => {
                const nodes = {n1: {status: 'a'}};
                Object.setPrototypeOf(nodes, {inherited: {status: 'p'}});
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: nodes}, true);
                });
                expect(useEventStore.getState().objectInstanceStatus.svc.inherited).toBeUndefined();
            });

            test('does not update if shallow equal', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n1: {status: 'up'}}}, true);
                });
                const first = useEventStore.getState().objectInstanceStatus.svc;
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {n1: {status: 'up'}}}, true);
                });
                expect(useEventStore.getState().objectInstanceStatus.svc).toEqual(first);
            });

            test('handles empty nodes', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({svc: {}}, true);
                });
                expect(useEventStore.getState().objectInstanceStatus.svc).toEqual({});
            });
        });

        // Each InstanceStatusUpdated carries the whole status (om3 msgbus: the
        // instance.Status value), a field omitted once empty or zero (rpo_breached_at
        // omitzero, resources and running omitempty): a field it lacks is gone.
        describe('a status replaces the one known: a field it omits is gone', () => {
            test('rpo_breached_at omitted once the breach is over: no breach kept', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {
                                avail: 'up',
                                rpo_breached_at: '2025-05-16T10:00:00Z',
                            },
                        },
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {avail: 'up', stopped_at: '0001-01-01T00:00:00Z'},
                        },
                    });
                });
                const node = useEventStore.getState().objectInstanceStatus['root/svc/foo'].dev1n1;
                expect(node).not.toHaveProperty('rpo_breached_at');
                expect(node.avail).toBe('up');
            });

            test('resources omitted once the instance has none: none kept', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {dev1n1: {avail: 'up', resources: {'fs#1': {status: 'up'}}}},
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {dev1n1: {avail: 'n/a'}},
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus['root/svc/foo'].dev1n1)
                    .toEqual({node: 'dev1n1', path: 'root/svc/foo', avail: 'n/a'});
            });

            test('running omitted once the action ended: nothing running kept', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {dev1n1: {avail: 'up', running: [{rid: 'task#1'}]}},
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {dev1n1: {avail: 'up'}},
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus['root/svc/foo'].dev1n1)
                    .not.toHaveProperty('running');
            });

            test('an explicit stopped_at in the incoming payload overrides the previous value', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {stopped_at: '2025-05-16T10:00:00Z'},
                        },
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {stopped_at: '2025-05-16T11:00:00Z'},
                        },
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus['root/svc/foo'].dev1n1.stopped_at)
                    .toBe('2025-05-16T11:00:00Z');
            });

            test('an explicit rpo_breached_at in the incoming payload overrides the previous value', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {rpo_breached_at: '2025-05-16T10:00:00Z'},
                        },
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {rpo_breached_at: '2025-05-16T11:00:00Z'},
                        },
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus['root/svc/foo'].dev1n1.rpo_breached_at)
                    .toBe('2025-05-16T11:00:00Z');
            });

            test('the zero sentinel from the API is stored verbatim and overwrites a previous value', () => {
                // The UI-side `hasTimestamp` helper is what treats the sentinel
                // as "not set". The store itself stores whatever the API sends.
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {stopped_at: '2025-05-16T10:00:00Z'},
                        },
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {stopped_at: '0001-01-01T00:00:00Z'},
                        },
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus['root/svc/foo'].dev1n1.stopped_at)
                    .toBe('0001-01-01T00:00:00Z');
            });

            test('the last of several statuses is the status', () => {
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {
                            dev1n1: {
                                avail: 'down',
                                stopped_at: '2025-05-16T10:00:00Z',
                                rpo_breached_at: '2025-05-16T10:05:00Z',
                            },
                        },
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {dev1n1: {avail: 'down', stopped_at: '2025-05-16T10:00:00Z'}},
                    });
                });
                act(() => {
                    useEventStore.getState().setInstanceStatuses({
                        'root/svc/foo': {dev1n1: {avail: 'up', stopped_at: '0001-01-01T00:00:00Z'}},
                    });
                });
                expect(useEventStore.getState().objectInstanceStatus['root/svc/foo'].dev1n1).toEqual({
                    node: 'dev1n1', path: 'root/svc/foo', avail: 'up', stopped_at: '0001-01-01T00:00:00Z',
                });
            });
        });
    });

    // -----------------------------------------------------------------------
    // setConfigUpdated & clearConfigUpdate
    // -----------------------------------------------------------------------
    describe('setConfigUpdated', () => {
        test('handles direct {name, node} objects', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([
                    {name: 'svc1', node: 'n1'},
                    {name: 'cluster', node: 'n2'},
                ]);
            });
            const updates = useEventStore.getState().configUpdates;
            expect(updates).toHaveLength(2);
            expect(updates[0]).toMatchObject({name: 'svc1', fullName: 'root/svc/svc1', node: 'n1'});
            expect(updates[1]).toMatchObject({name: 'cluster', fullName: 'root/ccfg/cluster', node: 'n2'});
        });

        test('handles SSE InstanceConfigUpdated format', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{
                    kind: 'InstanceConfigUpdated',
                    data: {path: 'svc1', node: 'n1', labels: {namespace: 'ns'}},
                }]);
            });
            expect(useEventStore.getState().configUpdates[0]).toMatchObject({
                name: 'svc1', fullName: 'ns/svc/svc1', node: 'n1',
            });
        });

        test('handles SSE format with missing data fields', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{kind: 'InstanceConfigUpdated'}]);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles SSE format with missing labels.namespace', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{
                    kind: 'InstanceConfigUpdated',
                    data: {path: 'svc1', node: 'n1', labels: {}},
                }]);
            });
            expect(useEventStore.getState().configUpdates[0].fullName).toBe('root/svc/svc1');
        });

        test('ignores objects with unknown kind', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{kind: 'SomethingElse'}]);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('ignores empty objects', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{}]);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles JSON strings', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated(['{"name":"svc1","node":"n1"}']);
            });
            expect(useEventStore.getState().configUpdates).toHaveLength(1);
        });

        test('handles invalid JSON strings', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated(['not-json']);
            });
            expect(logger.warn).toHaveBeenCalled();
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles JSON string that parses to null', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated(['null']);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles JSON string missing node', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated(['{"name":"svc1"}']);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles JSON string missing name', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated(['{"node":"n1"}']);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles JSON string parsing to array', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated(['[{"name":"svc1","node":"n1"}]']);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles null / undefined entries', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([null, undefined]);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('ignores entries with empty name or node', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([
                    {name: '', node: 'n1'},
                    {name: 'svc', node: ''},
                ]);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('ignores parsed JSON without required fields', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated(['{"foo":"bar"}']);
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('avoids duplicates', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{name: 'svc1', node: 'n1'}]);
            });
            act(() => {
                useEventStore.getState().setConfigUpdated([{name: 'svc1', node: 'n1'}]);
            });
            expect(useEventStore.getState().configUpdates).toHaveLength(1);
        });
    });

    describe('clearConfigUpdate', () => {
        test('removes by name', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([
                    {name: 'svc1', node: 'n1'},
                    {name: 'svc2', node: 'n2'},
                ]);
            });
            act(() => {
                useEventStore.getState().clearConfigUpdate('svc1');
            });
            expect(useEventStore.getState().configUpdates).toHaveLength(1);
        });

        test('removes by fullName', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{name: 'svc1', node: 'n1'}]);
            });
            act(() => {
                useEventStore.getState().clearConfigUpdate('root/svc/svc1');
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('removes by fullName with namespace', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{
                    kind: 'InstanceConfigUpdated',
                    data: {path: 'svc1', node: 'n1', labels: {namespace: 'ns'}},
                }]);
            });
            act(() => {
                useEventStore.getState().clearConfigUpdate('ns/svc/svc1');
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles cluster path', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{name: 'cluster', node: 'n1'}]);
            });
            act(() => {
                useEventStore.getState().clearConfigUpdate('cluster');
            });
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('does not mutate state when nothing matched', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{name: 'svc1', node: 'n1'}]);
            });
            const before = useEventStore.getState().configUpdates;
            act(() => {
                useEventStore.getState().clearConfigUpdate('ghost');
            });
            expect(useEventStore.getState().configUpdates).toBe(before);
        });

        test('handles non‑string input gracefully', () => {
            expect(() => act(() => {
                useEventStore.getState().clearConfigUpdate(123);
            })).not.toThrow();
            expect(() => act(() => {
                useEventStore.getState().clearConfigUpdate({});
            })).not.toThrow();
        });

        test('handles null and undefined input', () => {
            expect(() => act(() => {
                useEventStore.getState().clearConfigUpdate(null);
            })).not.toThrow();
            expect(() => act(() => {
                useEventStore.getState().clearConfigUpdate(undefined);
            })).not.toThrow();
            expect(useEventStore.getState().configUpdates).toEqual([]);
        });

        test('handles empty string input', () => {
            act(() => {
                useEventStore.getState().setConfigUpdated([{name: 'svc1', node: 'n1'}]);
            });
            act(() => {
                useEventStore.getState().clearConfigUpdate('');
            });
            expect(useEventStore.getState().configUpdates).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // removeObject / removePendingDelete / removeInstanceFromObject
    // -----------------------------------------------------------------------
    describe('removeObject', () => {
        test('removes object from all slices', () => {
            act(() => {
                useEventStore.getState().setObjectStatuses({o1: {a: 1}, o2: {b: 2}});
            });
            act(() => {
                useEventStore.getState().removeObject('o1');
            });
            expect(useEventStore.getState().objectStatus).toEqual({o2: {b: 2}});
        });

        test('removes object from a single slice only', () => {
            act(() => {
                useEventStore.setState({
                    objectStatus: {o1: {a: 1}},
                    objectInstanceStatus: {},
                    instanceConfig: {},
                });
            });
            act(() => {
                useEventStore.getState().removeObject('o1');
            });
            expect(useEventStore.getState().objectStatus).toEqual({});
            expect(useEventStore.getState().objectInstanceStatus).toEqual({});
            expect(useEventStore.getState().instanceConfig).toEqual({});
        });

        test('returns unchanged state when object not found', () => {
            const initialState = useEventStore.getState();
            act(() => {
                useEventStore.getState().removeObject('ghost');
            });
            expect(useEventStore.getState()).toBe(initialState);
        });
    });

    describe('removeObjects', () => {
        test('removes the objects from every slice, their instance monitors included', () => {
            act(() => {
                useEventStore.setState({
                    objectStatus: {o1: {a: 1}, o2: {b: 2}, o3: {c: 3}},
                    objectInstanceStatus: {o1: {n1: {}}, o2: {n1: {}}},
                    instanceConfig: {o1: {n1: {}}},
                    instanceMonitor: {'n1:o1': {}, 'n2:o1': {}, 'n1:o2': {}, 'n1:ns/svc/o1': {}},
                });
            });
            act(() => {
                useEventStore.getState().removeObjects(['o1', 'o3']);
            });
            const state = useEventStore.getState();
            expect(state.objectStatus).toEqual({o2: {b: 2}});
            expect(state.objectInstanceStatus).toEqual({o2: {n1: {}}});
            expect(state.instanceConfig).toEqual({});
            expect(state.instanceMonitor).toEqual({'n1:o2': {}, 'n1:ns/svc/o1': {}});
        });

        test('removes the monitors left of an object otherwise gone', () => {
            act(() => {
                useEventStore.setState({objectStatus: {}, objectInstanceStatus: {}, instanceConfig: {}, instanceMonitor: {'n1:o1': {}}});
            });
            act(() => {
                useEventStore.getState().removeObjects(['o1']);
            });
            expect(useEventStore.getState().instanceMonitor).toEqual({});
        });
    });

    describe('clearObjectCache', () => {
        test('forgets the objects held, and their copy in localStorage', () => {
            const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
            act(() => {
                useEventStore.setState({
                    objectStatus: {o1: {}}, objectInstanceStatus: {o1: {}},
                    instanceConfig: {o1: {}}, instanceMonitor: {'n1:o1': {}},
                });
            });
            act(() => clearObjectCache());
            const state = useEventStore.getState();
            expect(state.objectStatus).toEqual({});
            expect(state.objectInstanceStatus).toEqual({});
            expect(state.instanceConfig).toEqual({});
            expect(state.instanceMonitor).toEqual({});
            expect(removeItem).toHaveBeenCalledWith('om3-event-storage');
            removeItem.mockRestore();
        });
    });

    describe('removePendingDelete', () => {
        test('removes existing key', () => {
            act(() => {
                useEventStore.setState({pendingDeletes: {'obj:n1': true, 'obj:n2': true}});
            });
            act(() => {
                useEventStore.getState().removePendingDelete('obj', 'n1');
            });
            expect(useEventStore.getState().pendingDeletes).toEqual({'obj:n2': true});
        });

        test('does nothing for missing key', () => {
            act(() => {
                useEventStore.setState({pendingDeletes: {'obj:n1': true}});
            });
            act(() => {
                useEventStore.getState().removePendingDelete('obj', 'n2');
            });
            expect(useEventStore.getState().pendingDeletes).toEqual({'obj:n1': true});
        });
    });

    describe('pruneInstancesOfNodes', () => {
        test('forgets the instances of the nodes no longer in the cluster', () => {
            useEventStore.setState({
                objectInstanceStatus: {svc1: {n1: {avail: 'up'}, n2: {avail: 'down'}}, svc2: {n1: {avail: 'up'}}},
                instanceConfig: {svc1: {n1: {}, n2: {}}},
                instanceMonitor: {'n1:svc1': {state: 'idle'}, 'n2:svc1': {state: 'idle'}},
            });
            useEventStore.getState().pruneInstancesOfNodes(['n1']);
            const s = useEventStore.getState();
            expect(s.objectInstanceStatus).toEqual({svc1: {n1: {avail: 'up'}}, svc2: {n1: {avail: 'up'}}});
            expect(s.instanceConfig).toEqual({svc1: {n1: {}}});
            expect(s.instanceMonitor).toEqual({'n1:svc1': {state: 'idle'}});
        });

        test('all nodes live, or none told: nothing changes', () => {
            useEventStore.setState({objectInstanceStatus: {svc1: {n1: {avail: 'up'}}}});
            const before = useEventStore.getState();
            useEventStore.getState().pruneInstancesOfNodes(['n1', 'n2']);
            useEventStore.getState().pruneInstancesOfNodes([]);
            useEventStore.getState().pruneInstancesOfNodes(undefined);
            expect(useEventStore.getState()).toBe(before);
        });
    });

    describe('removeNode', () => {
        test('drops what a node reported, the other nodes kept', () => {
            useEventStore.setState({
                nodeStatus: {n1: {agent: 'a'}, n2: {agent: 'b'}},
                nodeMonitor: {n1: {state: 'idle'}, n2: {state: 'idle'}},
                nodeStats: {n1: {score: 1}},
            });
            useEventStore.getState().removeNode('n1');
            const s = useEventStore.getState();
            expect(s.nodeStatus).toEqual({n2: {agent: 'b'}});
            expect(s.nodeMonitor).toEqual({n2: {state: 'idle'}});
            expect(s.nodeStats).toEqual({});
        });

        test('a node not known changes nothing', () => {
            const before = useEventStore.getState();
            useEventStore.getState().removeNode('nope');
            expect(useEventStore.getState()).toBe(before);
        });
    });

    describe('removeInstanceFromObject', () => {
        test('removes instance from all three maps', () => {
            act(() => {
                useEventStore.setState({
                    objectInstanceStatus: {svc1: {nA: {node: 'nA', path: 'svc1'}}},
                    instanceConfig: {svc1: {nA: {cfg: 1}}},
                    instanceMonitor: {'nA:svc1': {mon: 1}},
                });
            });
            act(() => {
                useEventStore.getState().removeInstanceFromObject('svc1', 'nA');
            });
            const s = useEventStore.getState();
            expect(s.objectInstanceStatus.svc1).toEqual({});
            expect(s.instanceConfig.svc1).toEqual({});
            expect(s.instanceMonitor['nA:svc1']).toBeUndefined();
        });

        test('handles partial existence (only objectInstanceStatus)', () => {
            act(() => {
                useEventStore.setState({
                    objectInstanceStatus: {svc1: {nA: {node: 'nA', path: 'svc1'}}},
                });
            });
            act(() => {
                useEventStore.getState().removeInstanceFromObject('svc1', 'nA');
            });
            expect(useEventStore.getState().objectInstanceStatus.svc1).toEqual({});
            expect(useEventStore.getState().instanceConfig).toEqual({});
            expect(useEventStore.getState().instanceMonitor).toEqual({});
        });

        test('handles partial existence (path exists but node missing)', () => {
            act(() => {
                useEventStore.setState({
                    instanceConfig: {svc1: {nB: {cfg: 1}}},
                    objectInstanceStatus: {svc1: {nB: {node: 'nB', path: 'svc1'}}},
                });
            });
            act(() => {
                useEventStore.getState().removeInstanceFromObject('svc1', 'nA');
            });
            const s = useEventStore.getState();
            expect(s.objectInstanceStatus.svc1).toEqual({nB: {node: 'nB', path: 'svc1'}});
            expect(s.instanceConfig.svc1).toEqual({nB: {cfg: 1}});
        });

        test('returns unchanged state when nothing to remove', () => {
            const initialState = useEventStore.getState();
            act(() => {
                useEventStore.getState().removeInstanceFromObject('svc1', 'nA');
            });
            expect(useEventStore.getState()).toBe(initialState);
        });
    });

    // -----------------------------------------------------------------------
    // shallowEqual edge cases (via setNodeStatuses)
    // -----------------------------------------------------------------------
    describe('shallowEqual edge cases', () => {
        test('handles null / undefined', () => {
            const {setNodeStatuses} = useEventStore.getState();
            act(() => {
                setNodeStatuses(null);
            });
            expect(useEventStore.getState().nodeStatus).toBeNull();
            act(() => {
                setNodeStatuses(undefined);
            });
            expect(useEventStore.getState().nodeStatus).toBeUndefined();
        });

        test('empty objects do not replace reference', () => {
            const {setNodeStatuses} = useEventStore.getState();
            act(() => {
                setNodeStatuses({});
            });
            const first = useEventStore.getState().nodeStatus;
            act(() => {
                setNodeStatuses({});
            });
            expect(useEventStore.getState().nodeStatus).toBe(first);
        });

        test('objects with different keys length do not replace reference', () => {
            const {setNodeStatuses} = useEventStore.getState();
            act(() => {
                setNodeStatuses({a: 1});
            });
            const first = useEventStore.getState().nodeStatus;
            act(() => {
                setNodeStatuses({a: 1, b: 2});
            });
            expect(useEventStore.getState().nodeStatus).not.toBe(first);
        });

        test('objects with same keys but different values do not replace reference', () => {
            const {setNodeStatuses} = useEventStore.getState();
            act(() => {
                setNodeStatuses({a: 1});
            });
            const first = useEventStore.getState().nodeStatus;
            act(() => {
                setNodeStatuses({a: 2});
            });
            expect(useEventStore.getState().nodeStatus).not.toBe(first);
        });
    });

    describe('localStorage persistence (debounced)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            });
            vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            });
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => null);
        });

        afterEach(() => {
            vi.restoreAllMocks();
            vi.useRealTimers();
        });

        test('setItem debounces and flushes after delay', () => {
            act(() => {
                useEventStore.getState().setObjectStatuses({obj1: {status: 'up'}});
            });
            expect(Storage.prototype.setItem).not.toHaveBeenCalled();
            vi.advanceTimersByTime(800);
            expect(Storage.prototype.setItem).toHaveBeenCalledTimes(1);
            const [key, value] = Storage.prototype.setItem.mock.calls[0];
            expect(key).toBe('om3-event-storage');
            const parsed = JSON.parse(value);
            expect(parsed.state.objectStatus).toEqual({obj1: {status: 'up'}});
        });

        test('flush clears pending and does not call setItem if no pending', () => {
            act(() => {
                useEventStore.getState().setObjectStatuses({obj1: {status: 'up'}});
            });
            vi.advanceTimersByTime(800);
            act(() => {
                useEventStore.getState().setObjectStatuses({obj2: {status: 'down'}});
            });
            expect(Storage.prototype.setItem).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(800);
            expect(Storage.prototype.setItem).toHaveBeenCalledTimes(2);
        });

        test('clearStorage calls removeItem and clears pending timeout', () => {
            act(() => {
                useEventStore.getState().setObjectStatuses({obj1: {status: 'up'}});
            });
            act(() => {
                useEventStore.persist.clearStorage();
            });
            expect(Storage.prototype.removeItem).toHaveBeenCalledWith('om3-event-storage');
            vi.advanceTimersByTime(1000);
            expect(Storage.prototype.setItem).not.toHaveBeenCalled();
        });

        test('flush catches localStorage.setItem errors and logs warning', () => {
            Storage.prototype.setItem.mockImplementation(() => {
                throw new Error('quota exceeded');
            });
            act(() => {
                useEventStore.getState().setObjectStatuses({obj1: {status: 'up'}});
            });
            vi.advanceTimersByTime(800);
            expect(logger.warn).toHaveBeenCalled();
        });

        test('getItem returns pending value if name matches pendingKey', () => {
            act(() => {
                useEventStore.getState().setObjectStatuses({obj1: {status: 'up'}});
            });
            const storage = useEventStore.persist.getOptions().storage;
            const pendingValue = storage.getItem('om3-event-storage');
            expect(pendingValue).toBeTruthy();
            expect(pendingValue.state.objectStatus).toEqual({obj1: {status: 'up'}});
        });

        test('flush when no pending does nothing', () => {
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });
            expect(Storage.prototype.setItem).not.toHaveBeenCalled();
        });

        test('flush on visibilitychange hidden when pending exists', () => {
            // Set pending
            act(() => {
                useEventStore.getState().setObjectStatuses({obj1: {status: 'up'}});
            });
            // Mock visibilityState to 'hidden'
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'hidden',
            });
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });
            // Flush should be called immediately, no need to advance timers
            expect(Storage.prototype.setItem).toHaveBeenCalledTimes(1);
            const [key, value] = Storage.prototype.setItem.mock.calls[0];
            expect(key).toBe('om3-event-storage');
            const parsed = JSON.parse(value);
            expect(parsed.state.objectStatus).toEqual({obj1: {status: 'up'}});
            // Clean up
            delete document.visibilityState;
        });
    });
});
