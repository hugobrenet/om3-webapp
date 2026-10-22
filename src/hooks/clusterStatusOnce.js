import {URL_CLUSTER_STATUS} from "../config/apiPath.js";
import useEventStore from "./useEventStore.js";
import logger from "../utils/logger.js";

/*
 * The cluster status read once a session, for what changes rarely: the order of the
 * nodes, the configuration of the node serving the API. Read again only when the
 * read failed.
 */

let reading = null;

/** Forgets the status read, for the tests. */
export const resetClusterStatus = () => {
    reading = null;
};

const read = async () => {
    const token = localStorage.getItem("authToken");
    const response = await fetch(URL_CLUSTER_STATUS, {headers: {Authorization: `Bearer ${token}`}});
    if (!response.ok) return null;
    const status = await response.json();
    pruneDroppedNodes(status);
    return status;
};

/**
 * The instances kept of the nodes a cluster status does not hold, dropped while no
 * page heard it, forgotten: their columns show a "?", as om mon does.
 */
export function pruneDroppedNodes(status) {
    const nodes = status?.cluster?.node;
    if (!nodes || typeof nodes !== "object") return;
    try {
        useEventStore.getState().pruneInstancesOfNodes(Object.keys(nodes));
    } catch (err) {
        // The status read stands whatever: a "?" missing is no reason to lose it.
        logger.warn("[clusterStatus] instances of dropped nodes not pruned:", err);
    }
}

/** The cluster status, null when it could not be read. */
export function readClusterStatus() {
    if (reading === null) reading = read().catch(() => null);
    const current = reading;
    return current.then((status) => {
        // Not read: tried again next time.
        if (status === null && reading === current) reading = null;
        return status;
    });
}
