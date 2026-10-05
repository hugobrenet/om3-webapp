import logger from '../utils/logger.js';
import React, {useEffect, useState, useRef, useMemo, useCallback, memo, useDeferredValue} from "react";
import {useNavigate} from "react-router-dom";
import {Box, Button, Typography} from "@mui/material";
import {FaRobot} from "react-icons/fa";
import {getAiAgentConfig} from "../config/ai-agent.js";
import axios from "axios";
import {
    GridNodes,
    GridObjects,
    GridNamespaces,
    GridHeartbeats,
    GridPools,
    GridNetworks,
    GridKinds
} from "./ClusterStatGrids";
import {URL_POOL, URL_NETWORK} from "../config/apiPath.js";
import {startEventReception, closeEventSource, DEFAULT_FILTERS} from "../eventSourceManager";
import EventLogger from "../components/EventLogger";
import {useNodeStats, useObjectStats, useHeartbeatStats} from "../hooks/useClusterData";
import {useKindData} from "../hooks/useKindData";

const CLUSTER_EVENT_TYPES = [
    "NodeStatusUpdated",
    "NodeMonitorUpdated",
    "NodeStatsUpdated",
    "DaemonHeartbeatUpdated",
    "ObjectStatusUpdated",
    "InstanceStatusUpdated",
    "ObjectDeleted",
    "InstanceMonitorUpdated",
    "CONNECTION_OPENED",
    "CONNECTION_ERROR",
    "RECONNECTION_ATTEMPT",
    "MAX_RECONNECTIONS_REACHED",
    "CONNECTION_CLOSED"
];

const InitialLoader = memo(() => (
    <Box sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        width: '100%'
    }}>
        <Typography variant="h6" color="textSecondary">
            Loading cluster data...
        </Typography>
    </Box>
));

const ClusterOverview = () => {
    const navigate = useNavigate();
    const isMounted = useRef(true);
    const abortControllerRef = useRef(null);

    const nodeStats = useNodeStats();
    const objectStats = useObjectStats();
    const heartbeatStats = useHeartbeatStats();
    const {statusByKind, kinds} = useKindData();

    const deferredNodeStats = useDeferredValue(nodeStats);
    const deferredObjectStats = useDeferredValue(objectStats);
    const deferredHeartbeatStats = useDeferredValue(heartbeatStats);

    const [pools, setPools] = useState([]);
    const [poolCount, setPoolCount] = useState(0);
    const [networks, setNetworks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const handleNavigate = useCallback((path) => () => {
        navigate(path);
    }, [navigate]);

    const handleObjectsClick = useCallback((globalState) => {
        navigate(globalState ? `/objects?globalState=${globalState}` : '/objects');
    }, [navigate]);

    const handleHeartbeatsClick = useCallback((status, state, id) => {
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (state) params.append('state', state);
        if (id) params.append('id', id);
        navigate(`/heartbeats${params.toString() ? `?${params.toString()}` : ''}`);
    }, [navigate]);

    const fetchClusterData = useCallback(async (token) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        try {
            const [poolsRes, networksRes] = await Promise.all([
                axios.get(URL_POOL, {
                    headers: {Authorization: `Bearer ${token}`},
                    timeout: 5000,
                    signal
                }),
                axios.get(URL_NETWORK, {
                    headers: {Authorization: `Bearer ${token}`},
                    timeout: 5000,
                    signal
                })
            ]);

            if (!isMounted.current) return;

            const poolItems = poolsRes.data?.items || [];
            const networkItems = networksRes.data?.items || [];

            setPools(poolItems);
            setPoolCount(poolItems.length);
            setNetworks(networkItems);
            setIsLoading(false);
        } catch (error) {
            if (!isMounted.current || error.name === 'AbortError') return;

            logger.error('Failed to fetch cluster data:', error.message);
            setPools([]);
            setPoolCount(0);
            setNetworks([]);
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        isMounted.current = true;
        const token = localStorage.getItem("authToken");

        if (token) {
            startEventReception(token, DEFAULT_FILTERS);
            fetchClusterData(token);
        }

        return () => {
            isMounted.current = false;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            closeEventSource();
        };
    }, [fetchClusterData]);

    const gridNodesProps = useMemo(() => ({
        nodeCount: deferredNodeStats.count,
        frozenCount: deferredNodeStats.frozen,
        onClick: handleNavigate("/nodes")
    }), [deferredNodeStats.count, deferredNodeStats.frozen, handleNavigate]);

    const gridObjectsProps = useMemo(() => ({
        objectCount: deferredObjectStats.objectCount,
        statusCount: deferredObjectStats.statusCount,
        onClick: handleObjectsClick
    }), [deferredObjectStats.objectCount, deferredObjectStats.statusCount, handleObjectsClick]);

    const gridHeartbeatsProps = useMemo(() => ({
        heartbeatCount: deferredHeartbeatStats.count,
        runningCount: deferredHeartbeatStats.running,
        perHeartbeatStats: deferredHeartbeatStats.perHeartbeatStats,
        nodeCount: deferredNodeStats.count,
        onClick: handleHeartbeatsClick
    }), [deferredHeartbeatStats, deferredNodeStats.count, handleHeartbeatsClick]);

    const gridNamespacesProps = useMemo(() => ({
        namespaceCount: deferredObjectStats.namespaceCount,
        namespaceSubtitle: deferredObjectStats.namespaceSubtitle,
        onClick: (url) => navigate(url || "/namespaces")
    }), [deferredObjectStats.namespaceCount, deferredObjectStats.namespaceSubtitle, navigate]);

    const kindSubtitle = useMemo(() => {
        return kinds.map(kind => ({
            kind,
            status: statusByKind[kind]
        }));
    }, [kinds, statusByKind]);

    const gridKindsProps = useMemo(() => ({
        kindCount: kinds.length,
        kindSubtitle,
        onClick: (url) => navigate(url || "/kinds")
    }), [kinds.length, kindSubtitle, navigate]);

    const gridPoolsProps = useMemo(() => ({
        poolCount,
        pools,
        onClick: handleNavigate("/pools")
    }), [poolCount, pools, handleNavigate]);

    const gridNetworksProps = useMemo(() => ({
        networks,
        onClick: handleNavigate("/network")
    }), [networks, handleNavigate]);

    if (isLoading && (deferredNodeStats.count === 0 && deferredObjectStats.objectCount === 0)) {
        return (
            <Box sx={{
                p: 0,
                width: '100%',
                margin: 0,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '400px'
            }}>
                <InitialLoader/>
            </Box>
        );
    }

    return (
        <Box sx={{
            width: "100%",
            bgcolor: "background.paper",
            border: "2px solid",
            borderColor: "divider",
            borderRadius: 0,
            boxShadow: 3,
            p: 3,
            m: 0,
        }}>
            <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between', mb: 4}}>
                <Typography variant="h4">Cluster Overview</Typography>
                {getAiAgentConfig().enabled && <Button variant="outlined" startIcon={<FaRobot/>} onClick={handleNavigate("/ai")}>AI Assistant</Button>}
            </Box>

            <Box sx={{
                display: 'grid',
                gridTemplateColumns: {xs: '1fr', md: '2fr 1fr'},
                gap: 3,
                alignItems: 'stretch'
            }}>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: {md: '1fr 1fr'},
                    gap: 3,
                    alignContent: 'start'
                }}>
                    <GridNodes {...gridNodesProps} />
                    <GridObjects {...gridObjectsProps} />
                    <GridHeartbeats {...gridHeartbeatsProps} />
                    <GridPools {...gridPoolsProps} />
                    <GridNetworks {...gridNetworksProps} />
                </Box>

                <Box sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    height: '100%',
                    justifyContent: 'flex-start'
                }}>
                    <GridNamespaces {...gridNamespacesProps} />
                    <GridKinds {...gridKindsProps} />
                </Box>
            </Box>
            <EventLogger eventTypes={CLUSTER_EVENT_TYPES} title="Cluster Events Logger"
                         buttonLabel="Cluster Events"/>
        </Box>
    );
};

export default memo(ClusterOverview);
