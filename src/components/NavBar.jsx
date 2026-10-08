import {Link, useLocation} from "react-router-dom";
import {ChatIcon, SidebarIcon, UserIcon} from "../ui/icons";
import {StateGlyph} from "../ui/components/StateGlyph";
import opensvcLogo from "../ui/assets/opensvc-logo.svg";
import {useAuth} from "../context/AuthProvider.jsx";
import {useEffect, useState, useCallback} from "react";
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus";
import useOnlineStatus from "../hooks/useOnlineStatus";
import logger from '../utils/logger.js';
import {getAiAgentConfig} from "../config/ai-agent.js";

// Header icon buttons, as in the oc3 top bar: muted ink, darker on hover.
const HEADER_BUTTON =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface-sunken hover:text-ink";

const NavBar = ({sidebarOpen = false, onToggleSidebar, showSidebarToggle = false}) => {
    const auth = useAuth();
    const location = useLocation();
    const {clusterName, fetchNodes, loading} = useFetchDaemonStatus();
    const [breadcrumb, setBreadcrumb] = useState([]);
    const [storedClusterName, setStoredClusterName] = useState(null);
    const online = useOnlineStatus();
    // Built once: the AI entry depends on the build configuration only.
    const aiEnabled = getAiAgentConfig().enabled;

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
                    {name: "Cluster", path: "/"},
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
                path: "/",
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

    return (
        // The oc3 top bar (AppShell): 44px, raised, a line under it. No stacking order
        // of its own: side panels and dialogs slide over the whole height, as in oc3.
        <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface-raised px-3 text-ink">
            {showSidebarToggle && (
                <button
                    type="button"
                    onClick={onToggleSidebar}
                    aria-expanded={sidebarOpen}
                    aria-controls="app-sidebar"
                    aria-label={sidebarOpen ? "Hide menu" : "Show menu"}
                    title={sidebarOpen ? "Hide menu" : "Show menu"}
                    className={HEADER_BUTTON}
                >
                    <SidebarIcon open={sidebarOpen} width={18} height={18}/>
                </button>
            )}

            {/* The oc3 top bar link: logo and product name, back to the home view. */}
            <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-ink">
                {/* Decorative: the name that follows already names the link. */}
                <img src={opensvcLogo} alt="" width={24} height={24} className="h-6 w-6"/>
                OpenSVC
            </Link>

            {breadcrumb.length > 0 && location.pathname !== '/login' && (
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 overflow-hidden font-medium whitespace-nowrap">
                    {breadcrumb.map((item, index) => (
                        <span key={index} className="flex min-w-0 items-center gap-1">
                            {item.path ? (
                                <Link
                                    to={item.path}
                                    aria-label={`Navigate to ${item.name}`}
                                    className="truncate hover:underline"
                                >
                                    {item.name}
                                </Link>
                            ) : (
                                <span className="truncate">{item.name}</span>
                            )}
                            {index < breadcrumb.length - 1 && (
                                <span aria-hidden="true" className="text-ink-muted">{">"}</span>
                            )}
                        </span>
                    ))}
                </nav>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-2">
                {!online && (
                    <span
                        title="You are offline — some features may be limited"
                        className="inline-flex items-center gap-1 rounded-(--radius-control) bg-state-down-soft px-2 py-0.5 text-data font-semibold text-state-down"
                    >
                        <StateGlyph state="down" className="h-2 w-2"/>
                        Offline
                    </span>
                )}

                {aiEnabled && (
                    <Link to="/ai" aria-label="Open the AI assistant" title="Open the AI assistant" className={HEADER_BUTTON}>
                        <ChatIcon width={16} height={16}/>
                    </Link>
                )}

                <Link to="/whoami" aria-label="View user information" title="View user information" className={HEADER_BUTTON}>
                    <UserIcon width={16} height={16}/>
                </Link>
            </div>
        </header>
    );
};

export default NavBar;
