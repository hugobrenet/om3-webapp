import {create} from "zustand";
import {persist, createJSONStorage} from "zustand/middleware";
import logger from '../utils/logger.js';

const parseObjectPath = (objName) => {
    if (!objName || typeof objName !== "string") {
        return {namespace: "root", kind: "svc", name: ""};
    }
    const parts = objName.split("/");
    const name = parts.length === 3 ? parts[2] : parts[0];
    const kind = name === "cluster" ? "ccfg" : parts.length === 3 ? parts[1] : "svc";
    const namespace = parts.length === 3 ? parts[0] : "root";
    return {namespace, kind, name};
};

const shallowEqual = (obj1, obj2) => {
    if (obj1 === obj2) return true;
    if (!obj1 || !obj2) return false;
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;
    for (let i = 0; i < keys1.length; i++) {
        const key = keys1[i];
        if (obj1[key] !== obj2[key]) return false;
    }
    return true;
};

const PERSIST_DEBOUNCE_MS = 800;

const createDebouncedLocalStorage = (delayMs = PERSIST_DEBOUNCE_MS) => {
    let pendingKey = null;
    let pendingValue = null;
    let timeoutId = null;

    const flush = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (pendingKey !== null) {
            try {
                window.localStorage.setItem(pendingKey, pendingValue);
            } catch (e) {
                logger.warn('Failed to persist event store to localStorage:', e);
            }
            pendingKey = null;
            pendingValue = null;
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
    }

    return {
        getItem: (name) => {
            if (pendingKey === name) return pendingValue;
            return window.localStorage.getItem(name);
        },
        setItem: (name, value) => {
            pendingKey = name;
            pendingValue = value;
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(flush, delayMs);
        },
        removeItem: (name) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            pendingKey = null;
            pendingValue = null;
            window.localStorage.removeItem(name);
        },
    };
};

const useEventStore = create(
    persist(
        (set, get) => ({
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

            removePendingDelete: (objectPath, node) => {
                const key = `${objectPath}:${node}`;
                set((state) => {
                    const newPending = {...state.pendingDeletes};
                    delete newPending[key];
                    return {pendingDeletes: newPending};
                });
            },

            removeObject: (objectName) => get().removeObjects([objectName]),

            /**
             * Drops objects and everything held for their instances: their status,
             * their instances' status, config and monitor (keyed `node:path`).
             */
            removeObjects: (objectNames) =>
                set((state) => {
                    const names = new Set(objectNames);
                    const gone = [...names].filter((name) =>
                        state.objectStatus[name] || state.objectInstanceStatus[name] || state.instanceConfig[name]
                    );
                    const goneMonitors = Object.keys(state.instanceMonitor)
                        .filter((key) => names.has(key.slice(key.indexOf(':') + 1)));
                    if (gone.length === 0 && goneMonitors.length === 0) return state;
                    const without = (map, keys) => {
                        const next = {...map};
                        for (const key of keys) delete next[key];
                        return next;
                    };
                    return {
                        objectStatus: without(state.objectStatus, gone),
                        objectInstanceStatus: without(state.objectInstanceStatus, gone),
                        instanceConfig: without(state.instanceConfig, gone),
                        instanceMonitor: without(state.instanceMonitor, goneMonitors),
                    };
                }),

            removeInstanceFromObject: (objectPath, node) =>
                set((state) => {
                    logger.debug(`🗑️ removeInstanceFromObject: path=${objectPath} node=${node}`);
                    const newObjectInstanceStatus = {...state.objectInstanceStatus};
                    const newInstanceConfig = {...state.instanceConfig};
                    const newInstanceMonitor = {...state.instanceMonitor};
                    let hasChanges = false;

                    if (newObjectInstanceStatus[objectPath] && newObjectInstanceStatus[objectPath][node]) {
                        newObjectInstanceStatus[objectPath] = {...newObjectInstanceStatus[objectPath]};
                        delete newObjectInstanceStatus[objectPath][node];
                        hasChanges = true;
                    }
                    if (newInstanceConfig[objectPath] && newInstanceConfig[objectPath][node]) {
                        newInstanceConfig[objectPath] = {...newInstanceConfig[objectPath]};
                        delete newInstanceConfig[objectPath][node];
                        hasChanges = true;
                    }
                    const monitorKey = `${node}:${objectPath}`;
                    if (newInstanceMonitor[monitorKey]) {
                        delete newInstanceMonitor[monitorKey];
                        hasChanges = true;
                    }
                    if (!hasChanges) return state;
                    return {
                        objectInstanceStatus: newObjectInstanceStatus,
                        instanceConfig: newInstanceConfig,
                        instanceMonitor: newInstanceMonitor,
                    };
                }),

            setObjectStatuses: (objectStatus) =>
                set((state) => {
                    const isEqual = shallowEqual(state.objectStatus, objectStatus);
                    if (isEqual) {
                        logger.debug('⏭️ setObjectStatuses: REJECTED (no actual changes)', {
                            numKeys: Object.keys(objectStatus).length
                        });
                        return state;
                    }
                    logger.debug('✅ setObjectStatuses: ACCEPTED - UPDATING', {
                        changedKeys: Object.keys(objectStatus).filter(k => state.objectStatus[k] !== objectStatus[k]).length
                    });
                    return {objectStatus};
                }),

            setInstanceStatuses: (instanceStatuses, replace = false) =>
                set((state) => {
                    let hasChanges = false;
                    const newObjectInstanceStatus = {...state.objectInstanceStatus};
                    for (const path in instanceStatuses) {
                        if (!instanceStatuses.hasOwnProperty(path)) continue;
                        const incomingNodes = instanceStatuses[path];
                        if (replace) {
                            const rebuilt = {};
                            for (const node in incomingNodes) {
                                if (!incomingNodes.hasOwnProperty(node)) continue;
                                const newStatus = incomingNodes[node];
                                rebuilt[node] = {node, path, ...newStatus};
                            }
                            if (!shallowEqual(newObjectInstanceStatus[path], rebuilt)) {
                                newObjectInstanceStatus[path] = rebuilt;
                                hasChanges = true;
                            }
                            continue;
                        }
                        if (!newObjectInstanceStatus[path]) {
                            newObjectInstanceStatus[path] = {};
                            hasChanges = true;
                        } else {
                            newObjectInstanceStatus[path] = {...newObjectInstanceStatus[path]};
                        }
                        // An instance status event carries the whole status: it replaces the
                        // one known. The daemon omits a field once empty (resources, running,
                        // encap, rpo_breached_at...): merged, its old value stayed.
                        for (const node in incomingNodes) {
                            if (!incomingNodes.hasOwnProperty(node)) continue;
                            const next = {node, path, ...incomingNodes[node]};
                            const existingData = newObjectInstanceStatus[path][node];
                            if (existingData && shallowEqual(existingData, next)) continue;
                            hasChanges = true;
                            newObjectInstanceStatus[path][node] = next;
                        }
                    }
                    if (!hasChanges) return state;
                    return {objectInstanceStatus: newObjectInstanceStatus};
                }),

            // The instances of the nodes no longer in the cluster, as a cluster status
            // read tells its nodes: kept from an earlier session (localStorage), they
            // would show a node dropped meanwhile as it was, where a "?" is due.
            pruneInstancesOfNodes: (liveNodes) =>
                set((state) => {
                    if (!Array.isArray(liveNodes) || liveNodes.length === 0) return state;
                    const live = new Set(liveNodes);
                    const keep = (byNode) => {
                        const gone = Object.keys(byNode ?? {}).filter((node) => !live.has(node));
                        if (gone.length === 0) return byNode;
                        const next = {...byNode};
                        for (const node of gone) delete next[node];
                        return next;
                    };
                    const pruneByPath = (map) => {
                        let changed = false;
                        const next = {};
                        for (const [path, byNode] of Object.entries(map ?? {})) {
                            next[path] = keep(byNode);
                            if (next[path] !== byNode) changed = true;
                        }
                        return changed ? next : map;
                    };
                    const objectInstanceStatus = pruneByPath(state.objectInstanceStatus);
                    const instanceConfig = pruneByPath(state.instanceConfig);
                    // The monitors are keyed "node:path".
                    const monitorKeys = Object.keys(state.instanceMonitor ?? {});
                    const goneMonitors = monitorKeys.filter((key) => !live.has(key.slice(0, key.indexOf(":"))));
                    let instanceMonitor = state.instanceMonitor;
                    if (goneMonitors.length > 0) {
                        instanceMonitor = {...state.instanceMonitor};
                        for (const key of goneMonitors) delete instanceMonitor[key];
                    }
                    if (objectInstanceStatus === state.objectInstanceStatus && instanceConfig === state.instanceConfig
                        && instanceMonitor === state.instanceMonitor) return state;
                    return {objectInstanceStatus, instanceConfig, instanceMonitor};
                }),

            // A node the cluster dropped: what it reported goes, until it rejoins.
            removeNode: (node) =>
                set((state) => {
                    const without = (map) => {
                        if (!map || !(node in map)) return map;
                        const next = {...map};
                        delete next[node];
                        return next;
                    };
                    const nodeStatus = without(state.nodeStatus);
                    const nodeMonitor = without(state.nodeMonitor);
                    const nodeStats = without(state.nodeStats);
                    if (nodeStatus === state.nodeStatus && nodeMonitor === state.nodeMonitor && nodeStats === state.nodeStats) return state;
                    return {nodeStatus, nodeMonitor, nodeStats};
                }),

            setNodeStatuses: (nodeStatus) =>
                set((state) => shallowEqual(state.nodeStatus, nodeStatus) ? state : {nodeStatus}),

            setNodeMonitors: (nodeMonitor) =>
                set((state) => shallowEqual(state.nodeMonitor, nodeMonitor) ? state : {nodeMonitor}),

            setNodeStats: (nodeStats) =>
                set((state) => shallowEqual(state.nodeStats, nodeStats) ? state : {nodeStats}),

            setHeartbeatStatuses: (heartbeatStatus) =>
                set((state) => shallowEqual(state.heartbeatStatus, heartbeatStatus) ? state : {heartbeatStatus}),

            setInstanceMonitors: (instanceMonitor) =>
                set((state) => shallowEqual(state.instanceMonitor, instanceMonitor) ? state : {instanceMonitor}),

            setInstanceConfig: (path, node, config) =>
                set((state) => {
                    if (state.instanceConfig[path]?.[node] && shallowEqual(state.instanceConfig[path][node], config))
                        return state;
                    const newInstanceConfig = {...state.instanceConfig};
                    if (!newInstanceConfig[path]) newInstanceConfig[path] = {};
                    newInstanceConfig[path] = {...newInstanceConfig[path], [node]: config};
                    return {instanceConfig: newInstanceConfig};
                }),

            setConfigUpdated: (updates) => {
                const existingState = get();
                const existingKeys = new Set(
                    existingState.configUpdates.map((u) => `${u.fullName}:${u.node}`)
                );
                const newUpdates = [];
                for (const update of updates) {
                    let name, fullName, node;
                    if (typeof update === "object" && update !== null) {
                        if (update.name && update.node) {
                            name = update.name;
                            node = update.node;
                            const namespace = "root";
                            const kind = name === "cluster" ? "ccfg" : "svc";
                            fullName = `${namespace}/${kind}/${name}`;
                        } else if (update.kind === "InstanceConfigUpdated") {
                            name = update.data?.path || "";
                            const namespace = update.data?.labels?.namespace || "root";
                            const kind = name === "cluster" ? "ccfg" : "svc";
                            fullName = `${namespace}/${kind}/${name}`;
                            node = update.data?.node || "";
                        } else continue;
                    } else if (typeof update === "string") {
                        try {
                            const parsed = JSON.parse(update);
                            if (parsed && parsed.name && parsed.node) {
                                name = parsed.name;
                                const {namespace, kind} = parseObjectPath(name);
                                fullName = `${namespace}/${kind}/${name}`;
                                node = parsed.node;
                            } else continue;
                        } catch (e) {
                            logger.warn("[useEventStore] Invalid JSON in setConfigUpdated:", update);
                            continue;
                        }
                    }
                    if (name && node && !existingKeys.has(`${fullName}:${node}`)) {
                        newUpdates.push({name, fullName, node});
                        existingKeys.add(`${fullName}:${node}`);
                    }
                }
                if (newUpdates.length > 0) {
                    set((state) => ({
                        configUpdates: [...state.configUpdates, ...newUpdates]
                    }));
                }
            },

            clearConfigUpdate: (objectName) =>
                set((state) => {
                    const {name} = parseObjectPath(objectName);
                    const filtered = state.configUpdates.filter(
                        (u) => u.name !== name && u.fullName !== objectName
                    );
                    return filtered.length === state.configUpdates.length ? state : {configUpdates: filtered};
                }),
        }),
        {
            name: 'om3-event-storage',
            storage: createJSONStorage(() => createDebouncedLocalStorage()),
            partialize: (state) => ({
                objectStatus: state.objectStatus,
                objectInstanceStatus: state.objectInstanceStatus,
                instanceMonitor: state.instanceMonitor,
                instanceConfig: state.instanceConfig,
            }),
        }
    )
);

/**
 * Forgets the objects held, in memory and in localStorage: on logout, so the next
 * user of the browser does not see the objects of the previous one.
 */
export const clearObjectCache = () => {
    useEventStore.setState({objectStatus: {}, objectInstanceStatus: {}, instanceMonitor: {}, instanceConfig: {}});
    useEventStore.persist.clearStorage();
};

export default useEventStore;
