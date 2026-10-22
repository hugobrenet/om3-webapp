import {useEffect, useMemo, useSyncExternalStore} from "react";
import useEventStore from "./useEventStore.js";
import {URL_NODE} from "../config/apiPath.js";
import {nodeUsage, readPg} from "../app/pg-usage";
import logger from "../utils/logger.js";

/**
 * How often each node is read. The daemon keeps a reading of its cgroups for up to
 * 15 seconds: read more often, it answers the same, and the cpu used between two
 * readings would be nothing. A little over, each reading is a fresh one.
 */
export const PG_POLL_MS = 16000;

/*
 * One reader for every view: the nodes asked for, each by how many views, are read
 * every PG_POLL_MS, a node newly asked for at once. The state is the usage of the
 * instances of each node read (`ClusterUsage`), and the error of each node whose
 * last reading failed.
 */
const wanted = new Map();
const readings = {};
let state = {usage: {}, errors: {}};
const listeners = new Set();
let timer = null;

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

function publish(next) {
    state = next;
    for (const listener of listeners) listener();
}

async function readNode(node) {
    try {
        const response = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/metrics/pg`, {
            headers: authHeaders(),
            cache: "no-cache",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const current = {at: Date.now(), byPath: readPg(await response.text())};
        const usage = nodeUsage(readings[node], current);
        readings[node] = current;
        // A node no longer asked for while it was read is dropped.
        if (!wanted.has(node)) return;
        const {[node]: _cleared, ...errors} = state.errors;
        publish({usage: {...state.usage, [node]: usage}, errors});
    } catch (error) {
        logger.warn(`Failed to read the cgroup metrics of ${node}:`, error);
        if (!wanted.has(node)) return;
        publish({...state, errors: {...state.errors, [node]: error.message || String(error)}});
    }
}

function readAll() {
    for (const node of wanted.keys()) void readNode(node);
}

function want(nodes) {
    for (const node of nodes) {
        const count = wanted.get(node) ?? 0;
        wanted.set(node, count + 1);
        if (count === 0) void readNode(node);
    }
    if (timer === null && wanted.size > 0) timer = setInterval(readAll, PG_POLL_MS);
}

function release(nodes) {
    for (const node of nodes) {
        const count = (wanted.get(node) ?? 1) - 1;
        if (count > 0) {
            wanted.set(node, count);
            continue;
        }
        wanted.delete(node);
        delete readings[node];
        if (state.usage[node] || state.errors[node]) {
            const {[node]: _gone, ...usage} = state.usage;
            const {[node]: _error, ...errors} = state.errors;
            publish({usage, errors});
        }
    }
    if (wanted.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
    }
}

/** Forgets every reading: for the tests. */
export function resetPgUsage() {
    wanted.clear();
    for (const node of Object.keys(readings)) delete readings[node];
    if (timer !== null) clearInterval(timer);
    timer = null;
    state = {usage: {}, errors: {}};
    listeners.clear();
}

const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
const snapshot = () => state;

const pick = (byNode, key) => {
    const list = key === "" ? [] : key.split(",");
    return Object.fromEntries(list.filter((node) => byNode[node] !== undefined).map((node) => [node, byNode[node]]));
};

/**
 * The cgroup usage of the instances on `nodes` (`ClusterUsage`): the cpu in cpus,
 * from the second reading of a node, the memory and its limit. Read while asked.
 * `errors`: why the last reading of a node failed, by node.
 */
export function usePgReadings(nodes) {
    const key = [...new Set(nodes)].sort().join(",");
    useEffect(() => {
        const list = key === "" ? [] : key.split(",");
        want(list);
        return () => release(list);
    }, [key]);
    const {usage, errors} = useSyncExternalStore(subscribe, snapshot);
    return useMemo(() => ({usage: pick(usage, key), errors: pick(errors, key)}), [usage, errors, key]);
}

/** The cgroup usage of the instances on `nodes` (usePgReadings), without the errors. */
export function usePgUsage(nodes) {
    return usePgReadings(nodes).usage;
}

const selectNodeStatus = (s) => s.nodeStatus;
const selectInstances = (s) => s.objectInstanceStatus;

/** The nodes of the cluster: those the store knows, and those running an instance. */
export function useClusterNodes() {
    const nodeStatus = useEventStore(selectNodeStatus);
    const instances = useEventStore(selectInstances);
    return useMemo(() => {
        const nodes = new Set(Object.keys(nodeStatus ?? {}));
        for (const byNode of Object.values(instances ?? {})) {
            for (const node of Object.keys(byNode ?? {})) nodes.add(node);
        }
        return [...nodes].sort();
    }, [nodeStatus, instances]);
}
