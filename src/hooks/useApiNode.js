import {useEffect, useState} from "react";
import {readClusterStatus} from "./clusterStatusOnce";

/**
 * The node serving the api the webapp asks, read once in the cluster status;
 * undefined while read, null when it could not be.
 */
export function useApiNode() {
    const [node, setNode] = useState(undefined);
    useEffect(() => {
        let live = true;
        readClusterStatus().then((status) => {
            if (live) setNode(status?.daemon?.nodename || null);
        });
        return () => {
            live = false;
        };
    }, []);
    return node;
}
