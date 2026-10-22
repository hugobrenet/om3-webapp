import {useEffect, useState} from "react";
import {readClusterStatus} from "./clusterStatusOnce";

/**
 * The nodes of the cluster in the order of its configuration (`cluster.nodes`), the
 * order om numbers them in; null while read or when it could not be, while `enabled`.
 */
export function useClusterNodeOrder(enabled = true) {
    const [order, setOrder] = useState(null);
    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        readClusterStatus().then((status) => {
            const nodes = status?.cluster?.config?.nodes;
            if (live) setOrder(Array.isArray(nodes) ? nodes : null);
        });
        return () => {
            live = false;
        };
    }, [enabled]);
    return order;
}
