import {useEffect, useState} from "react";
import {readClusterStatus} from "./clusterStatusOnce";
import {useMenuState} from "./useSidebarAlerts";

/**
 * The nodes of the cluster in the order of its configuration (`cluster.nodes`), the
 * order om numbers them in, live: from the cluster configuration the menu stream
 * reads (ClusterConfigUpdated), a node leaving the cluster leaving it; until then,
 * from the cluster status read once. Null while read or when it could not be,
 * while `enabled`.
 */
export function useClusterNodeOrder(enabled = true) {
    const live = useMenuState((s) => s.clusterConfig?.nodes);
    const [read, setRead] = useState(null);
    const hasLive = Array.isArray(live);
    useEffect(() => {
        if (!enabled || hasLive) return undefined;
        let current = true;
        readClusterStatus().then((status) => {
            const nodes = status?.cluster?.config?.nodes;
            if (current) setRead(Array.isArray(nodes) ? nodes : null);
        });
        return () => {
            current = false;
        };
    }, [enabled, hasLive]);
    if (!enabled) return null;
    return hasLive ? live : read;
}
