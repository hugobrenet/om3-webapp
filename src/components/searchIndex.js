import useEventStore from "../hooks/useEventStore.js";
import {URL_CLUSTER_STATUS, URL_NETWORK, URL_OBJECT} from "../config/apiPath.js";
import {apiFetch} from "../services/api.jsx";
import {parseObjectPath} from "../utils/objectUtils.jsx";

/**
 * What the global search searches (`app/search.ts`), read from the daemon when it
 * opens: the paths of the objects, the namespaces they make up, the nodes of the
 * cluster and its networks. Each list is read on its own: one that fails is said
 * in its group, the others are searched all the same.
 */
export async function loadSearchIndex() {
    const headers = {Authorization: `Bearer ${localStorage.getItem("authToken")}`};
    const get = (url) => apiFetch(url, {headers, cache: "no-cache"});
    const [paths, cluster, networks] = await Promise.allSettled([
        get(`${URL_OBJECT}?path=${encodeURIComponent("**")}`),
        get(URL_CLUSTER_STATUS),
        get(URL_NETWORK),
    ]);
    const entries = [];
    const failed = [];

    if (paths.status === "fulfilled" && Array.isArray(paths.value)) {
        // The status the event stream knows, when a view has listened to it.
        const statuses = useEventStore.getState().objectStatus ?? {};
        const namespaces = new Set();
        for (const path of paths.value) {
            const {namespace, kind} = parseObjectPath(path);
            namespaces.add(namespace);
            entries.push({kind: "object", id: path, label: path, context: [kind], status: statuses[path]?.avail});
        }
        for (const namespace of namespaces) {
            entries.push({kind: "namespace", id: namespace, label: namespace, context: []});
        }
    } else {
        failed.push("object", "namespace");
    }

    if (cluster.status === "fulfilled") {
        for (const [name, node] of Object.entries(cluster.value?.cluster?.node ?? {})) {
            const agent = node?.status?.agent;
            entries.push({kind: "node", id: name, label: name, context: agent ? [agent] : []});
        }
    } else {
        failed.push("node");
    }

    if (networks.status === "fulfilled") {
        for (const network of networks.value?.items ?? []) {
            entries.push({
                kind: "network",
                id: network.name,
                label: network.name,
                context: [network.type, network.network].filter(Boolean),
            });
        }
    } else {
        failed.push("network");
    }

    return {entries, failed};
}
