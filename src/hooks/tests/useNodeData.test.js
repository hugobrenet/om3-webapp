import {renderHook} from '@testing-library/react';
import useEventStore from '../useEventStore';
import {useNodeData} from '../useNodeData';

// Mock the useEventStore module
vi.mock('../useEventStore');

describe('useNodeData', () => {
    // Simulated store state, modifiable in each test
    let mockState;

    beforeEach(() => {
        mockState = {};
        // Mock useEventStore to execute the selector with the current state
        useEventStore.mockImplementation((selector) => selector(mockState));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    const objectName = 'testObject';
    const node = 'testNode';
    const monitorKey = `${node}:${objectName}`;

    // -----------------------------------------------------------------
    // Existing test (covers reference stability when data unchanged)
    // -----------------------------------------------------------------
    test('returns the same reference when data does not change', () => {
        mockState = {
            objectInstanceStatus: {
                [objectName]: {
                    [node]: {
                        avail: 'available',
                        frozen_at: '2023-01-01T00:00:00Z',
                        provisioned: true,
                    },
                },
            },
            instanceMonitor: {
                [monitorKey]: {
                    state: 'running',
                },
            },
        };

        const {result, rerender} = renderHook(() => useNodeData(objectName, node));
        const firstResult = result.current;

        // Irrelevant store change that does not affect extracted data
        mockState = {
            ...mockState,
            extraProperty: 'some value',
        };

        rerender();
        const secondResult = result.current;

        expect(secondResult).toBe(firstResult); // same reference
        expect(secondResult).toEqual({
            avail: 'available',
            frozen: 'frozen',
            state: 'running',
            provisioned: true,
        });
    });

    describe('when instanceStatus is missing', () => {
        test('returns default empty data and stores it (initial empty)', () => {
            // No objectInstanceStatus at all
            mockState = {};
            const {result} = renderHook(() => useNodeData(objectName, node));

            expect(result.current).toEqual({
                avail: null,
                frozen: 'unfrozen',
                state: null,
                provisioned: null,
            });
        });

        test('maintains reference to the stored empty data on subsequent renders', () => {
            mockState = {};
            const {result, rerender} = renderHook(() => useNodeData(objectName, node));
            const initialEmpty = result.current;

            // Change an unrelated part of the state
            mockState = {unrelated: 'changed'};
            rerender();

            expect(result.current).toBe(initialEmpty);
            expect(result.current).toEqual({
                avail: null,
                frozen: 'unfrozen',
                state: null,
                provisioned: null,
            });
        });

        test('an instance deleted while shown: said gone, not as it was', () => {
            // Start with a real instance
            mockState = {
                objectInstanceStatus: {
                    [objectName]: {
                        [node]: {
                            avail: 'up',
                            frozen_at: '2023-01-01T00:00:00Z',
                            provisioned: true,
                        },
                    },
                },
                instanceMonitor: {
                    [monitorKey]: {state: 'running'},
                },
            };
            const {result, rerender} = renderHook(() => useNodeData(objectName, node));
            const initialData = result.current;
            expect(initialData.frozen).toBe('frozen');

            // The daemon deletes its status: its column shows the "?" of no instance.
            mockState = {...mockState, objectInstanceStatus: {}};
            rerender();

            expect(result.current).not.toBe(initialData);
            expect(result.current).toEqual({
                avail: null,
                frozen: 'unfrozen',
                state: null,
                provisioned: null,
            });

            // After that, further renders with still missing status keep the same reference
            const stableRef = result.current;
            mockState = {...mockState, another: 'irrelevant'};
            rerender();
            expect(result.current).toBe(stableRef);
        });
    });

    describe('frozen property', () => {
        test('is "unfrozen" when frozen_at is the zero date "0001-01-01T00:00:00Z"', () => {
            mockState = {
                objectInstanceStatus: {
                    [objectName]: {
                        [node]: {
                            avail: 'ok',
                            frozen_at: '0001-01-01T00:00:00Z',
                            provisioned: false,
                        },
                    },
                },
                instanceMonitor: {[monitorKey]: {}},
            };
            const {result} = renderHook(() => useNodeData(objectName, node));
            expect(result.current.frozen).toBe('unfrozen');
        });

        test('is "unfrozen" when frozen_at is missing or undefined', () => {
            mockState = {
                objectInstanceStatus: {
                    [objectName]: {
                        [node]: {
                            avail: 'ok',
                            // frozen_at not present
                            provisioned: true,
                        },
                    },
                },
                instanceMonitor: {[monitorKey]: {}},
            };
            const {result} = renderHook(() => useNodeData(objectName, node));
            expect(result.current.frozen).toBe('unfrozen');
        });

        test('is "frozen" when frozen_at is a valid non‑zero date', () => {
            mockState = {
                objectInstanceStatus: {
                    [objectName]: {
                        [node]: {
                            avail: 'nok',
                            frozen_at: '2026-08-06T12:00:00Z',
                            provisioned: true,
                        },
                    },
                },
                instanceMonitor: {[monitorKey]: {}},
            };
            const {result} = renderHook(() => useNodeData(objectName, node));
            expect(result.current.frozen).toBe('frozen');
        });
    });

    describe('state property', () => {
        test('is the monitor state when state is not "idle"', () => {
            mockState = {
                objectInstanceStatus: {
                    [objectName]: {[node]: {avail: 'up'}},
                },
                instanceMonitor: {
                    [monitorKey]: {state: 'running'},
                },
            };
            const {result} = renderHook(() => useNodeData(objectName, node));
            expect(result.current.state).toBe('running');
        });

        test('is null when monitor state is "idle"', () => {
            mockState = {
                objectInstanceStatus: {
                    [objectName]: {[node]: {avail: 'up'}},
                },
                instanceMonitor: {
                    [monitorKey]: {state: 'idle'},
                },
            };
            const {result} = renderHook(() => useNodeData(objectName, node));
            expect(result.current.state).toBeNull();
        });

        test('is undefined when monitor is missing entirely', () => {
            // No instanceMonitor at all → state will be undefined (matching implementation)
            mockState = {
                objectInstanceStatus: {
                    [objectName]: {[node]: {avail: 'up'}},
                },
                // instanceMonitor absent
            };
            const {result} = renderHook(() => useNodeData(objectName, node));
            expect(result.current.state).toBeUndefined();
        });
    });
});
