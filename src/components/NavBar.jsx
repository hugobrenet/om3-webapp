import {Link, useNavigate, useLocation} from "react-router-dom";
import {AppBar, Toolbar, Typography, Button, Box, Menu, MenuItem, ListItemIcon, ListItemText} from "@mui/material";
import {
    FaUser,
    FaBars,
    FaHome,
    FaList,
    FaHeartbeat,
    FaServer,
    FaDatabase,
    FaCubes,
    FaNetworkWired,
    FaTag,
    FaRobot
} from "react-icons/fa";
import {useAuth} from "../context/AuthProvider.jsx";
import {useEffect, useState, useMemo, useCallback} from "react";
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus";
import useEventStore from "../hooks/useEventStore.js";
import useOnlineStatus from "../hooks/useOnlineStatus";
import logger from '../utils/logger.js';
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import {red, orange} from "@mui/material/colors";
import Tooltip from "@mui/material/Tooltip";
import {getAiAgentConfig} from "../config/ai-agent.js";

const NavBar = () => {
    const navigate = useNavigate();
    const auth = useAuth();
    const location = useLocation();
    const {clusterName, fetchNodes, loading, daemon} = useFetchDaemonStatus();
    const [breadcrumb, setBreadcrumb] = useState([]);
    const [menuAnchor, setMenuAnchor] = useState(null);
    const objectStatus = useEventStore((state) => state.objectStatus);
    const objectInstanceStatus = useEventStore((state) => state.objectInstanceStatus);
    const instanceMonitor = useEventStore((state) => state.instanceMonitor);
    const [downCount, setDownCount] = useState(0);
    const [warnCount, setWarnCount] = useState(0);
    const [storedClusterName, setStoredClusterName] = useState(null);
    const online = useOnlineStatus();

    const navRoutes = [
        {path: "/cluster", name: "Cluster", icon: <FaHome/>},
        ...(getAiAgentConfig().enabled ? [{path: "/ai", name: "AI Assistant", icon: <FaRobot/>}] : []),
        {path: "/namespaces", name: "Namespaces", icon: <FaList/>},
        {path: "/heartbeats", name: "Heartbeats", icon: <FaHeartbeat/>},
        {path: "/nodes", name: "Nodes", icon: <FaServer/>},
        {path: "/pools", name: "Pools", icon: <FaDatabase/>},
        {path: "/network", name: "Networks", icon: <FaNetworkWired/>},
        {path: "/objects", name: "Objects", icon: <FaCubes/>},
        {path: "/kinds", name: "Kinds", icon: <FaTag/>},
        {path: "/whoami", name: "Who Am I", icon: <FaUser/>},
    ];

    const getObjectStatus = useCallback((objectName, objs) => {
        const obj = objs[objectName] || {};
        const rawAvail = obj?.avail;
        const validStatuses = ["up", "down", "warn"];
        const avail = validStatuses.includes(rawAvail) ? rawAvail : "n/a";
        const frozen = obj?.frozen;
        const provisioned = obj?.provisioned;
        let globalExpect = null;
        const nodes = Object.keys(objectInstanceStatus[objectName] || {});
        for (const node of nodes) {
            const monitorKey = `${node}:${objectName}`;
            const monitor = instanceMonitor[monitorKey] || {};
            if (monitor.global_expect && monitor.global_expect !== "none") {
                globalExpect = monitor.global_expect;
                break;
            }
        }
        return {avail, frozen, globalExpect, provisioned};
    }, [objectInstanceStatus, instanceMonitor]);

    const objects = useMemo(
        () => (Object.keys(objectStatus).length ? objectStatus : daemon?.cluster?.object || {}),
        [objectStatus, daemon]
    );

    useEffect(() => {
        let down = 0;
        let warn = 0;
        Object.keys(objects).forEach((key) => {
            const status = getObjectStatus(key, objects);
            if (status.avail === "down") down++;
            if (status.avail === "warn") warn++;
        });
        setDownCount(down);
        setWarnCount(warn);
    }, [objects, getObjectStatus]);

    const getPathBreadcrumbs = useCallback(() => {
        const pathParts = location.pathname.split("/").filter(Boolean);
        const breadcrumbItems = [];
        if (pathParts[0] !== "login" && pathParts.length > 1) {
            if (pathParts[0] === "network" && pathParts.length === 2) {
                breadcrumbItems.push({name: "network", path: "/network"});
                breadcrumbItems.push({name: pathParts[1], path: `/network/${pathParts[1]}`});
            } else if (pathParts[0] === "objects" && pathParts.length === 2) {
                breadcrumbItems.push({name: "Objects", path: "/objects"});
                breadcrumbItems.push({name: pathParts[1], path: `/objects/${pathParts[1]}`});
            } else {
                pathParts.forEach((part, index) => {
                    const fullPath = "/" + pathParts.slice(0, index + 1).join("/");
                    if (part !== "cluster") {
                        breadcrumbItems.push({name: part, path: fullPath});
                    }
                });
            }
        }
        return breadcrumbItems;
    }, [location.pathname]);

    // Fetch nodes when token is available
    useEffect(() => {
        const fetchClusterData = async () => {
            const token = auth?.authToken || localStorage.getItem("authToken");
            if (!token) {
                setBreadcrumb([
                    {name: "Cluster", path: "/cluster"},
                    ...getPathBreadcrumbs(),
                ]);
                return;
            }

            if (fetchNodes && typeof fetchNodes === 'function') {
                try {
                    await fetchNodes(token);
                    if (!storedClusterName && clusterName) {
                        setStoredClusterName(clusterName);
                    }
                } catch (error) {
                    logger.error("Error while calling fetchNodes:", error);
                }
            }
        };

        if (!storedClusterName) {
            fetchClusterData();
        }
    }, [auth, fetchNodes, getPathBreadcrumbs, storedClusterName, clusterName]);

    // Breadcrumb generation
    useEffect(() => {
        const pathParts = location.pathname.split("/").filter(Boolean);
        const breadcrumbItems = [];

        if (pathParts[0] !== "login") {
            breadcrumbItems.push({
                name: storedClusterName || (loading ? "Loading..." : "Cluster"),
                path: "/cluster",
            });

            if (pathParts.length > 1 || (pathParts.length === 1 && pathParts[0] !== "cluster")) {
                if (pathParts[0] === "nodes" && pathParts.length >= 4 && pathParts[2] === "objects") {
                    const node = decodeURIComponent(pathParts[1]);
                    const objectName = decodeURIComponent(pathParts.slice(3).join("/"));

                    breadcrumbItems.push({name: "objects", path: "/objects"});
                    breadcrumbItems.push({
                        name: objectName,
                        path: `/objects/${encodeURIComponent(objectName)}`
                    });
                    breadcrumbItems.push({
                        name: node,
                        path: null
                    });
                } else if (pathParts[0] === "objects" && pathParts.length >= 2) {
                    const objectName = decodeURIComponent(pathParts.slice(1).join("/"));
                    breadcrumbItems.push({name: "objects", path: "/objects"});
                    breadcrumbItems.push({
                        name: objectName,
                        path: location.pathname
                    });
                } else if (pathParts[0] === "network" && pathParts.length === 2) {
                    breadcrumbItems.push({name: "network", path: "/network"});
                    breadcrumbItems.push({name: pathParts[1], path: `/network/${pathParts[1]}`});
                } else if (pathParts[0] === "network" && pathParts.length === 1) {
                    breadcrumbItems.push({name: "network", path: "/network"});
                } else {
                    pathParts.forEach((part, index) => {
                        const fullPath = "/" + pathParts.slice(0, index + 1).join("/");
                        if (part !== "cluster") {
                            breadcrumbItems.push({name: part, path: fullPath});
                        }
                    });
                }
            }
        }

        setBreadcrumb(breadcrumbItems);
    }, [location.pathname, storedClusterName, loading]);

    const handleMenuOpen = (event) => {
        setMenuAnchor(event.currentTarget);
    };

    const handleMenuClose = () => {
        setMenuAnchor(null);
    };

    const handleMenuItemClick = (path) => {
        navigate(path);
        handleMenuClose();
    };

    return (
        <AppBar
            position="sticky"
            sx={{
                width: "100vw",
                left: 0,
                right: 0,
                boxSizing: "border-box"
            }}
        >
            <Toolbar sx={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                <Box sx={{display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1}}>
                    <Button
                        onClick={handleMenuOpen}
                        aria-label="Open navigation menu"
                        sx={{
                            color: "white",
                            minWidth: "auto",
                            padding: "8px",
                            borderRadius: 2,
                            backgroundColor: "rgba(255, 255, 255, 0.1)",
                            "&:hover": {backgroundColor: "rgba(255, 255, 255, 0.2)"},
                        }}
                    >
                        <FaBars/>
                    </Button>

                    <Menu
                        anchorEl={menuAnchor}
                        open={Boolean(menuAnchor)}
                        onClose={handleMenuClose}
                    >
                        {navRoutes.map(({path, name, icon}) => (
                            <MenuItem
                                key={path}
                                onClick={() => handleMenuItemClick(path)}
                                selected={location.pathname === path}
                                aria-selected={location.pathname === path}
                            >
                                <ListItemIcon>{icon}</ListItemIcon>
                                <ListItemText primary={name}/>
                            </MenuItem>
                        ))}
                    </Menu>

                    {breadcrumb.length > 0 && location.pathname !== '/login' && (
                        <Box sx={{display: "flex", alignItems: "center", flexWrap: "wrap"}}>
                            {breadcrumb.map((item, index) => (
                                <Box key={index} sx={{display: "flex", alignItems: "center"}}>
                                    {item.path ? (
                                        <Typography
                                            component={Link}
                                            to={item.path}
                                            sx={{
                                                color: "inherit",
                                                textDecoration: "none",
                                                fontWeight: 500,
                                                fontSize: "1.1rem",
                                                "&:hover": {textDecoration: "underline"},
                                            }}
                                            aria-label={`Navigate to ${item.name}`}
                                        >
                                            {item.name}
                                        </Typography>
                                    ) : (
                                        <Typography
                                            sx={{
                                                color: "inherit",
                                                textDecoration: "none",
                                                fontWeight: 500,
                                                fontSize: "1.1rem",
                                                cursor: "default",
                                            }}
                                        >
                                            {item.name}
                                        </Typography>
                                    )}

                                    {index < breadcrumb.length - 1 && (
                                        <Typography sx={{mx: 0.5, fontSize: "1.1rem"}}>{">"}</Typography>
                                    )}
                                </Box>
                            ))}
                        </Box>
                    )}

                    {(downCount > 0 || warnCount > 0) && (
                        <Box sx={{display: "flex", alignItems: "center", gap: 2, ml: 2}}>
                            {downCount > 0 && (
                                <Tooltip title="Number of down objects">
                                    <Typography
                                        component={Link}
                                        to="/objects?globalState=down"
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 0.5,
                                            color: "inherit",
                                            textDecoration: "none"
                                        }}
                                    >
                                        <FiberManualRecordIcon sx={{color: red[500]}}/>
                                        {downCount}
                                    </Typography>
                                </Tooltip>
                            )}
                            {warnCount > 0 && (
                                <Tooltip title="Number of warn objects">
                                    <Typography
                                        component={Link}
                                        to="/objects?globalState=warn"
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 0.5,
                                            color: "inherit",
                                            textDecoration: "none"
                                        }}
                                    >
                                        <FiberManualRecordIcon sx={{color: orange[500]}}/>
                                        {warnCount}
                                    </Typography>
                                </Tooltip>
                            )}
                        </Box>
                    )}
                </Box>

                <Box sx={{display: "flex", alignItems: "center", gap: 1}}>
                    {!online && (
                        <Tooltip title="You are offline — some features may be limited">
                            <Typography
                                variant="body2"
                                sx={{
                                    px: 1,
                                    py: 0.5,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    borderRadius: 1,
                                    backgroundColor: 'rgba(255, 0, 0, 0.12)',
                                    color: 'white',
                                    fontWeight: 600,
                                }}
                            >
                                <FiberManualRecordIcon sx={{color: red[500], fontSize: '0.8rem'}}/>
                                Offline
                            </Typography>
                        </Tooltip>
                    )}

                    <Button
                        component={Link}
                        to="/whoami"
                        sx={{
                            color: "white",
                            minWidth: "auto",
                            padding: "8px",
                            borderRadius: 2,
                            backgroundColor: "rgba(255, 255, 255, 0.1)",
                            "&:hover": {backgroundColor: "rgba(255, 255, 255, 0.2)"},
                        }}
                        aria-label="View user information"
                    >
                        <FaUser/>
                    </Button>
                </Box>
            </Toolbar>
        </AppBar>
    );
};

export default NavBar;
