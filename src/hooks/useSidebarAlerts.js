import {useEffect, useMemo, useState} from "react";
import axios from "axios";
import {EventSourcePolyfill} from "event-source-polyfill";
import {useTranslation} from "react-i18next";
import i18n from "../i18n";
import {URL_NETWORK, URL_NODE_EVENT, URL_POOL} from "../config/apiPath.js";
import logger from "../utils/logger.js";

/** Pools and networks have no events: their usage is polled at this period. */
export const SIDEBAR_USAGE_REFRESH_MS = 15000;

/** Delay before the sidebar event stream reconnects after an error. */
export const SIDEBAR_RECONNECT_MS = 5000;

/** Delay grouping the bursts of events into one render. */
export const SIDEBAR_FLUSH_MS = 300;

/**
 * Events of the sidebar stream. With `cache=true` the daemon first replays the
 * last event of each object, node and heartbeat, which gives the current state,
 * then sends the changes as they happen.
 */
const SIDEBAR_EVENTS = [
    "ObjectStatusUpdated",
    "ObjectDeleted",
    "NodeStatusUpdated",
    "DaemonHeartbeatUpdated",
];

export const SIDEBAR_EVENTS_URL =
    `${URL_NODE_EVENT}?cache=true&${SIDEBAR_EVENTS.map((event) => `filter=${event}`).join("&")}`;

const ZERO_TIME = "0001-01-01T00:00:00Z";

/** Pools or networks used to their full size. */
export function fullCount(items) {
    return (items || []).filter(
        (item) => typeof item?.size === "number" && item.size > 0 && item.used >= item.size
    ).length;
}

/** Frozen nodes. */
export function frozenCount(nodeStatus) {
    return Object.values(nodeStatus || {}).filter(
        (status) => !!status?.frozen_at && status.frozen_at !== ZERO_TIME
    ).length;
}

const emptyState = () => ({objects: {}, nodeStatus: {}, heartbeatStatus: {}});

/** Applies one event of the sidebar stream to the state maps, in place. */
export function applySidebarEvent(state, type, data) {
    const path = data?.path || data?.labels?.path;
    const node = data?.node || data?.labels?.node;
    switch (type) {
        case "ObjectStatusUpdated":
            if (path && data.object_status) state.objects[path] = data.object_status;
            break;
        case "ObjectDeleted":
            if (path) delete state.objects[path];
            break;
        case "NodeStatusUpdated":
            if (node && data.node_status) state.nodeStatus[node] = data.node_status;
            break;
        case "DaemonHeartbeatUpdated":
            if (node && data.heartbeat) state.heartbeatStatus[node] = data.heartbeat;
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

/** The kind of an object path, as om3 writes it: "ns/kind/name", "kind/name", a bare svc name, "ns/". */
function kindOf(path) {
    if (path.endsWith("/")) return "nscfg";
    const parts = path.split("/");
    if (parts.length >= 2) return parts[parts.length - 2];
    return path === "cluster" ? "ccfg" : "svc";
}

/** The kinds that run: an object of these has an availability of its own. */
const ACTORS = ["svc", "vol"];

/**
 * Objects: red when an actor (svc, vol) is down; else orange when an object's
 * overall state is warn.
 */
export function objectsAlert(objects) {
    let down = 0;
    let warn = 0;
    for (const [path, status] of Object.entries(objects || {})) {
        if (ACTORS.includes(kindOf(path)) && status?.avail === "down") down++;
        else if (status?.overall === "warn") warn++;
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

/** Lines of the mouseover of the Nodes entry: count and frozen ones, in the current language. */
export function nodesDetails(nodeStatus) {
    return [
        i18n.t("alerts.details.node", {count: Object.keys(nodeStatus || {}).length}),
        i18n.t("alerts.details.frozen", {count: frozenCount(nodeStatus)}),
    ];
}

/**
 * Lines of the mouseover of the Pools and Networks entries: count, full ones, top
 * usage, in the current language. `word` is the item kind: "pool" or "network".
 */
export function usageDetails(items, word) {
    const list = items || [];
    const sized = list.filter((item) => typeof item?.size === "number" && item.size > 0);
    const lines = [
        i18n.t(`alerts.details.${word}`, {count: list.length}),
        i18n.t("alerts.details.full", {count: fullCount(list)}),
    ];
    if (sized.length > 0) {
        const top = sized.reduce((max, item) => (item.used / item.size > max.used / max.size ? item : max));
        lines.push(i18n.t("alerts.details.highestUsage", {
            name: top.name ?? "?",
            percent: Math.round((top.used / top.size) * 100),
        }));
    }
    return lines;
}

/** The objects of one kind, out of the objects by path. */
const ofKind = (objects, kind) =>
    Object.fromEntries(Object.entries(objects || {}).filter(([path]) => kindOf(path) === kind));

/**
 * State of the sidebar entries, kept up to date without any user action. For each
 * entry id (`NAV_SECTIONS`), `alert`: what calls for attention, orange or red,
 * `null` when all is well (pools, networks and the lists of keys raise none); and
 * for some entries the `details` lines of their mouseover. All the objects raise
 * the alert of all of them; the services and the volumes, each of theirs only.
 */
export default function useSidebarAlerts({enabled = true} = {}) {
    const {objects, nodeStatus, heartbeatStatus} = useSidebarEventState(enabled);
    const {pools, networks} = useUsageLists(enabled);
    // The alerts and details are text: computed again when the language changes.
    const {i18n: {language}} = useTranslation();

    return useMemo(() => ({
        "objects-any": {alert: objectsAlert(objects)},
        "objects-services": {alert: objectsAlert(ofKind(objects, "svc"))},
        "objects-volumes": {alert: objectsAlert(ofKind(objects, "vol"))},
        links: {alert: heartbeatAlert(heartbeatStatus)},
        pools: {alert: null, details: usageDetails(pools, "pool")},
        networks: {alert: null, details: usageDetails(networks, "network")},
        nodes: {alert: nodesAlert(nodeStatus), details: nodesDetails(nodeStatus)},
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [objects, nodeStatus, heartbeatStatus, pools, networks, language]);
}
