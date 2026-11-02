import {useEffect, useMemo, useState} from "react";
import {create} from "zustand";
import axios from "axios";
import {EventSourcePolyfill} from "event-source-polyfill";
import {useTranslation} from "react-i18next";
import i18n from "../i18n";
import {URL_NETWORK, URL_NODE_EVENT, URL_POOL} from "../config/apiPath.js";
import logger from "../utils/logger.js";
import {childrenDown} from "../app/statusboard";

/** Pools and networks have no events: their usage is polled at this period. */
export const SIDEBAR_USAGE_REFRESH_MS = 15000;

/** Delay before the sidebar event stream reconnects after an error. */
export const SIDEBAR_RECONNECT_MS = 5000;

/** Delay grouping the bursts of events into one render. */
export const SIDEBAR_FLUSH_MS = 300;

/**
 * Events of the sidebar stream. With `cache=true` the daemon first replays the
 * last event of each object, node and heartbeat, and the configuration of the
 * cluster, which gives the current state, then sends the changes as they happen.
 */
const SIDEBAR_EVENTS = [
    "ObjectStatusUpdated",
    "ObjectDeleted",
    "NodeStatusUpdated",
    "DaemonHeartbeatUpdated",
    // For the children of the vols only: a vol down nothing uses is no alert.
    "InstanceMonitorUpdated",
    "InstanceMonitorDeleted",
    "ClusterConfigUpdated",
];

export const SIDEBAR_EVENTS_URL =
    `${URL_NODE_EVENT}?cache=true&${SIDEBAR_EVENTS.map((event) => `filter=${event}`).join("&")}`;

const ZERO_TIME = "0001-01-01T00:00:00Z";

/** Whether a node status says the node is frozen. */
export const isFrozen = (status) => !!status?.frozen_at && status.frozen_at !== ZERO_TIME;

const emptyState = () => ({objects: {}, nodeStatus: {}, heartbeatStatus: {}, volChildren: {}, clusterConfig: null});

/** Applies one event of the sidebar stream to the state maps, in place. */
export function applySidebarEvent(state, type, data) {
    const path = data?.path || data?.labels?.path;
    const node = data?.node || data?.labels?.node;
    switch (type) {
        case "ObjectStatusUpdated":
            if (path && data.object_status) state.objects[path] = data.object_status;
            break;
        case "ObjectDeleted":
            if (path) {
                delete state.objects[path];
                delete state.volChildren[path];
            }
            break;
        case "InstanceMonitorUpdated":
            // The children of a vol instance, by node; the other monitors not kept.
            if (path && node && kindOf(path) === "vol") {
                state.volChildren[path] = {...state.volChildren[path], [node]: data.instance_monitor?.children ?? {}};
            }
            break;
        case "InstanceMonitorDeleted":
            if (path && node && state.volChildren[path]) {
                const {[node]: _gone, ...rest} = state.volChildren[path];
                state.volChildren[path] = rest;
            }
            break;
        case "NodeStatusUpdated":
            if (node && data.node_status) state.nodeStatus[node] = data.node_status;
            break;
        case "DaemonHeartbeatUpdated":
            if (node && data.heartbeat) state.heartbeatStatus[node] = data.heartbeat;
            break;
        case "ClusterConfigUpdated":
            // Its ID, its name and the AI agent it names: some hundred bytes,
            // where the whole cluster status grows with the cluster.
            if (data?.cluster_config && typeof data.cluster_config === "object") state.clusterConfig = data.cluster_config;
            break;
        default:
            break;
    }
}

/**
 * Keeps the object, node and heartbeat state the pills are computed from, fed by
 * an event stream of its own: the views open and close the shared one with their
 * own filters, the sidebar stays live whatever the view.
 */
function useSidebarEventState(enabled) {
    const [state, setState] = useState(emptyState);

    useEffect(() => {
        // No menu, the sign-in screens: nothing to read.
        if (!enabled) return undefined;
        let source = null;
        let reconnectTimer = null;
        let flushTimer = null;
        let closed = false;
        // Built from scratch on every connection: the cache replays the whole
        // state, which drops the objects deleted while disconnected.
        let working = emptyState();
        let replaced = false;

        const flush = () => {
            flushTimer = null;
            const snapshot = {
                objects: {...working.objects},
                nodeStatus: {...working.nodeStatus},
                heartbeatStatus: {...working.heartbeatStatus},
                volChildren: {...working.volChildren},
                clusterConfig: working.clusterConfig,
            };
            setState(snapshot);
        };

        const onEvent = (type) => (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            if (!replaced) {
                working = emptyState();
                replaced = true;
            }
            applySidebarEvent(working, type, data);
            if (flushTimer === null) flushTimer = setTimeout(flush, SIDEBAR_FLUSH_MS);
        };

        const scheduleReconnect = () => {
            if (closed || reconnectTimer !== null) return;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, SIDEBAR_RECONNECT_MS);
        };

        function connect() {
            if (closed) return;
            // Read on every connection: a refreshed token is picked up on reconnect.
            const token = localStorage.getItem("authToken");
            if (!token) {
                scheduleReconnect();
                return;
            }
            replaced = false;
            source = new EventSourcePolyfill(SIDEBAR_EVENTS_URL, {
                headers: {Authorization: `Bearer ${token}`},
                withCredentials: true,
            });
            for (const type of SIDEBAR_EVENTS) {
                source.addEventListener(type, onEvent(type));
            }
            source.onerror = (error) => {
                logger.warn("Sidebar event stream error, reconnecting", error?.status ?? "");
                source?.close();
                source = null;
                scheduleReconnect();
            };
        }

        connect();
        return () => {
            closed = true;
            clearTimeout(reconnectTimer);
            clearTimeout(flushTimer);
            source?.close();
        };
    }, [enabled]);

    return state;
}

/** Pool and network lists, polled; a failed request keeps the last known lists. */
function useUsageLists(enabled) {
    const [pools, setPools] = useState([]);
    const [networks, setNetworks] = useState([]);

    useEffect(() => {
        // No menu, the sign-in screens: nothing to read.
        if (!enabled) return undefined;
        let cancelled = false;
        const refresh = async () => {
            const token = localStorage.getItem("authToken");
            if (!token) return;
            const headers = {Authorization: `Bearer ${token}`};
            const [pool, network] = await Promise.allSettled([
                axios.get(URL_POOL, {headers}),
                axios.get(URL_NETWORK, {headers}),
            ]);
            if (cancelled) return;
            if (pool.status === "fulfilled") setPools(pool.value?.data?.items || []);
            if (network.status === "fulfilled") setNetworks(network.value?.data?.items || []);
        };
        void refresh();
        const timer = setInterval(refresh, SIDEBAR_USAGE_REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [enabled]);

    return {pools, networks};
}

/**
 * The alert of a menu entry: `warn` (orange) or `down` (red), and what it is about,
 * in the current language. None, `null`, while all is well.
 */

/**
 * The state the menu keeps live, shared with the overview of the cluster: the
 * objects, the nodes and their heartbeats, and the configuration of the cluster,
 * from its event stream; the pools and the networks, polled. `ready`, a first
 * state read.
 */
export const useMenuState = create(() => ({
    objects: {}, nodeStatus: {}, heartbeatStatus: {}, volChildren: {}, clusterConfig: null, pools: [], networks: [], ready: false,
}));

/** The kind of an object path, as om3 writes it: "ns/kind/name", "kind/name", a bare svc name, "ns/". */
export function kindOf(path) {
    if (path.endsWith("/")) return "nscfg";
    const parts = path.split("/");
    if (parts.length >= 2) return parts[parts.length - 2];
    return path === "cluster" ? "ccfg" : "svc";
}

/** The kinds that run: an object of these has an availability of its own. */
const ACTORS = ["svc", "vol"];

/** The monitors of a vol's instances as `childrenDown` reads them, out of its children by node. */
export const volMonitors = (volChildren, path) =>
    Object.values(volChildren?.[path] ?? {}).map((children) => ({children}));

/**
 * What an object calls attention for: `down`, an actor (svc, vol) down, but a vol
 * whose children are all down too (`monitors`, its instance monitors); `warn`, its
 * overall state; else `null`.
 */
export function objectAttention(path, status, monitors = []) {
    if (ACTORS.includes(kindOf(path)) && status?.avail === "down" && !childrenDown(path, status.avail, monitors)) return "down";
    if (status?.overall === "warn") return "warn";
    return null;
}

/**
 * Objects: red when an actor (svc, vol) is down, a vol nothing uses aside; else
 * orange when an object's overall state is warn. `monitorsOf`, the instance
 * monitors of a path.
 */
export function objectsAlert(objects, monitorsOf = () => []) {
    let down = 0;
    let warn = 0;
    for (const [path, status] of Object.entries(objects || {})) {
        const attention = objectAttention(path, status, monitorsOf(path));
        if (attention === "down") down++;
        else if (attention === "warn") warn++;
    }
    if (down > 0) return {level: "down", text: i18n.t("alerts.objectsDown", {count: down})};
    if (warn > 0) return {level: "warn", text: i18n.t("alerts.objectsWarn", {count: warn})};
    return null;
}

/**
 * Heartbeats: each rx or tx stream of each node a link, down when it does not run
 * or a peer stopped beating. Orange when one link is down, red when all are.
 */
export function heartbeatAlert(heartbeatStatus) {
    let total = 0;
    let down = 0;
    for (const node of Object.values(heartbeatStatus || {})) {
        for (const stream of node?.streams || []) {
            total++;
            const failing = (stream?.state !== undefined && stream.state !== "running") ||
                Object.values(stream?.peers || {}).some((peer) => peer?.is_beating === false);
            if (failing) down++;
        }
    }
    if (down === 0) return null;
    return {level: down === total ? "down" : "warn", text: i18n.t("alerts.linksDown", {count: down, total})};
}

/** Nodes: orange when one is overloaded, red when all are (is_overloaded of the node status). */
export function nodesAlert(nodeStatus) {
    const nodes = Object.values(nodeStatus || {});
    const overloaded = nodes.filter((status) => status?.is_overloaded === true).length;
    if (overloaded === 0) return null;
    return {
        level: overloaded === nodes.length ? "down" : "warn",
        text: i18n.t("alerts.nodesOverloaded", {count: overloaded, total: nodes.length}),
    };
}

/** The objects of one kind, out of the objects by path. */
const ofKind = (objects, kind) =>
    Object.fromEntries(Object.entries(objects || {}).filter(([path]) => kindOf(path) === kind));

/**
 * The state the sidebar entries are computed from, kept up to date without any
 * user action: the objects by path, the node and heartbeat status by node, the
 * pools and the networks.
 */
export function useSidebarState({enabled = true} = {}) {
    const {objects, nodeStatus, heartbeatStatus, volChildren, clusterConfig} = useSidebarEventState(enabled);
    const {pools, networks} = useUsageLists(enabled);
    // Shared with the overview of the cluster, the header and the assistant: one
    // stream, one poll, for all.
    useEffect(() => {
        useMenuState.setState({objects, nodeStatus, heartbeatStatus, volChildren, clusterConfig, pools, networks, ready: true});
    }, [objects, nodeStatus, heartbeatStatus, volChildren, clusterConfig, pools, networks]);
    return useMemo(
        () => ({objects, nodeStatus, heartbeatStatus, volChildren, clusterConfig, pools, networks}),
        [objects, nodeStatus, heartbeatStatus, volChildren, clusterConfig, pools, networks]
    );
}

/**
 * State of the sidebar entries, out of the state of `useSidebarState`. For each
 * entry id (`NAV_SECTIONS`), `alert`: what calls for attention, orange or red,
 * `null` when all is well (the lists of keys raise none). All the objects raise
 * the alert of all of them; the services and the volumes, each of theirs only.
 */
export function useSidebarAlertsOf({objects, nodeStatus, heartbeatStatus, volChildren}) {
    // The alerts are text: computed again when the language changes.
    const {i18n: {language}} = useTranslation();

    return useMemo(() => {
        const monitorsOf = (path) => volMonitors(volChildren, path);
        return {
            "objects-any": {alert: objectsAlert(objects, monitorsOf)},
            "objects-services": {alert: objectsAlert(ofKind(objects, "svc"), monitorsOf)},
            "objects-volumes": {alert: objectsAlert(ofKind(objects, "vol"), monitorsOf)},
            links: {alert: heartbeatAlert(heartbeatStatus)},
            nodes: {alert: nodesAlert(nodeStatus)},
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [objects, nodeStatus, heartbeatStatus, volChildren, language]);
}

/** The state of the sidebar entries, read from a state of their own. */
export default function useSidebarAlerts(options) {
    return useSidebarAlertsOf(useSidebarState(options));
}
