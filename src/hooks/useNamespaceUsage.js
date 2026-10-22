import {useCallback, useEffect, useMemo, useState} from "react";
import {URL_NETWORK, URL_NETWORK_IP, URL_OBJECT, URL_POOL} from "../config/apiPath.js";
import {namespaceOf, networkHoldings, parseClaims, poolHoldings} from "../app/namespace-usage";
import {namespacesUsage} from "../app/pg-usage";
import {useClusterNodes, usePgUsage} from "./usePgUsage";
import logger from "../utils/logger.js";

/** How often the pools, networks and claims are read again. */
export const USAGE_REFRESH_MS = 60000;

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

async function readJson(url) {
    const response = await fetch(url, {headers: authHeaders(), cache: "no-cache"});
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
}

/**
 * The configuration file of a namespace, which holds its claims: its claims, and
 * whether it exists; none when it has no nscfg.
 */
async function readClaims(namespace) {
    const response = await fetch(`${URL_OBJECT}/${encodeURIComponent(namespace)}/nscfg/namespace/config/file`, {
        headers: authHeaders(),
        cache: "no-cache",
    });
    if (response.status === 404) return {claims: [], exists: false};
    if (!response.ok) throw new Error(`${namespace}/nscfg/namespace: HTTP ${response.status}`);
    return {claims: parseClaims(await response.text()), exists: true};
}

/**
 * The pools and networks of the cluster, what each namespace holds of them, and
 * the claims of each namespace of `namespaces`, read again every minute, and at
 * once on `reload`, after a change of the claims. `configured` says which have a
 * namespace configuration, where the claims are written.
 */
export function useNamespaceClaims(namespaces) {
    const [state, setState] = useState({pools: [], networks: [], poolsHeld: new Map(), networksHeld: new Map(), claims: {}, configured: {}, error: null, loaded: false});
    const [generation, setGeneration] = useState(0);
    const reload = useCallback(() => setGeneration((n) => n + 1), []);
    const key = namespaces.join(",");
    useEffect(() => {
        let cancelled = false;
        const read = async () => {
            try {
                const [pools, volumes, networks, addresses] = await Promise.all(
                    [URL_POOL, `${URL_POOL}/volume`, URL_NETWORK, URL_NETWORK_IP].map(readJson)
                );
                const read = Object.fromEntries(await Promise.all(
                    namespaces.map(async (ns) => [ns, await readClaims(ns).catch((error) => {
                        logger.warn("Failed to read the claims of", ns, error);
                        return {claims: [], exists: undefined};
                    })])
                ));
                const claims = Object.fromEntries(Object.entries(read).map(([ns, r]) => [ns, r.claims]));
                const configured = Object.fromEntries(Object.entries(read).map(([ns, r]) => [ns, r.exists]));
                if (cancelled) return;
                setState({
                    pools: pools.items ?? [],
                    networks: networks.items ?? [],
                    poolsHeld: poolHoldings(volumes.items ?? []),
                    networksHeld: networkHoldings(addresses.items ?? []),
                    claims,
                    configured,
                    error: null,
                    loaded: true,
                });
            } catch (error) {
                if (!cancelled) setState((previous) => ({...previous, error: error.message, loaded: true}));
            }
        };
        void read();
        const timer = setInterval(read, USAGE_REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, generation]);
    return useMemo(() => ({...state, reload}), [state, reload]);
}

/**
 * The cpu and memory the objects of each namespace use, summed over their cgroups
 * on every node of the cluster (usePgUsage): the cpu in cpus, null until a second
 * reading tells it, the memory in bytes.
 */
export function useNamespacePg() {
    const nodes = useClusterNodes();
    const usage = usePgUsage(nodes);
    return useMemo(() => namespacesUsage(usage, namespaceOf), [usage]);
}
