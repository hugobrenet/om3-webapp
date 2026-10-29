import {useState, useRef, useCallback, useEffect} from "react";
import {fetchDaemonStatus} from "../services/api";
import logger from '../utils/logger.js';
import {pruneDroppedNodes} from "./clusterStatusOnce";

const useFetchDaemonStatus = () => {
    const [nodes, setNodes] = useState([]);
    const [daemon, setDaemon] = useState({});
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const cacheRef = useRef([]);
    const [clusterStats, setClusterStats] = useState({});
    const [clusterName, setClusterName] = useState("");

    // Load cached data on mount
    useEffect(() => {
        try {
            const cachedNodes = localStorage.getItem('cachedNodes');
            const cachedDaemon = localStorage.getItem('cachedDaemon');
            const cachedClusterStats = localStorage.getItem('cachedClusterStats');
            const cachedClusterName = localStorage.getItem('cachedClusterName');
            if (cachedNodes) {
                const nodesArray = JSON.parse(cachedNodes);
                setNodes(nodesArray);
                cacheRef.current = nodesArray;
            }
            if (cachedDaemon) {
                setDaemon(JSON.parse(cachedDaemon));
            }
            if (cachedClusterStats) {
                setClusterStats(JSON.parse(cachedClusterStats));
            }
            if (cachedClusterName) {
                setClusterName(JSON.parse(cachedClusterName));
            }
        } catch (err) {
            logger.warn("Failed to load cached data:", err);
        }
    }, []);

    // Memoize refreshDaemonStatus with useCallback
    const refreshDaemonStatus = useCallback(async (token) => {
        if (!token) {
            setError("Token is required to fetch daemon status");
            return;
        }

        const hasCache = cacheRef.current.length > 0;
        if (!hasCache) setLoading(true);
        setError("");

        try {
            const result = await fetchDaemonStatus(token);
            pruneDroppedNodes(result);
            const nodesArray = Object.keys(result.cluster.node).map((key) => ({
                nodename: key,
                ...result.cluster.node[key],
            }));
            setDaemon(result.daemon);
            setNodes(nodesArray);
            setClusterStats({
                nodeCount: nodesArray.length,
            });
            setClusterName(result.cluster.config.name || "Cluster");
            cacheRef.current = nodesArray;
            // Cache in localStorage
            try {
                localStorage.setItem('cachedNodes', JSON.stringify(nodesArray));
                localStorage.setItem('cachedDaemon', JSON.stringify(result.daemon));
                localStorage.setItem('cachedClusterStats', JSON.stringify({nodeCount: nodesArray.length}));
                localStorage.setItem('cachedClusterName', JSON.stringify(result.cluster.config.name || "Cluster"));
            } catch (err) {
                logger.warn("Failed to cache data:", err);
            }
        } catch (err) {
            logger.error("Error while fetching daemon statuses:", err);
            setError("Failed to retrieve daemon statuses.");
            // Clear cached data on error
            setNodes([]);
            setDaemon({});
            setClusterStats({});
            setClusterName("");
            cacheRef.current = [];

            // Clear localStorage on error
            try {
                localStorage.removeItem('cachedNodes');
                localStorage.removeItem('cachedDaemon');
                localStorage.removeItem('cachedClusterStats');
                localStorage.removeItem('cachedClusterName');
            } catch (storageErr) {
                logger.warn("Failed to clear cache on error:", storageErr);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        daemon,
        nodes,
        clusterStats,
        clusterName,
        error,
        loading,
        fetchNodes: refreshDaemonStatus,
    };
};

export default useFetchDaemonStatus;
