import {useEffect, useState} from "react";
import {readClusterStatus, resetClusterStatus} from "./clusterStatusOnce";

/*
 * The largest key the API takes: `node.max_key_size` of the node serving it, the
 * one a key is posted to, read in the cluster status.
 */

/** Forgets the size read, for the tests. */
export const resetMaxKeySize = resetClusterStatus;

/**
 * The largest key, in bytes, once read while `enabled`; null while read or when it
 * could not be: the API then says it alone, refusing a key too large (413).
 */
export function useMaxKeySize(enabled = true) {
    const [max, setMax] = useState(null);
    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        readClusterStatus().then((status) => {
            const size = status?.cluster?.node?.[status?.daemon?.nodename]?.config?.max_key_size;
            if (live) setMax(typeof size === "number" && size > 0 ? size : null);
        });
        return () => {
            live = false;
        };
    }, [enabled]);
    return max;
}
