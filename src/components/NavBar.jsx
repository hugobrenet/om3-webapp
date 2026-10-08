import {Link, useLocation} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {ChatIcon, SidebarIcon, UserIcon} from "../ui/icons";
import {AlertMark} from "../ui/components/AlertMark";
import {cn} from "../ui/cn";
import {GlobalSearch} from "../app/GlobalSearch";
import {loadSearchIndex} from "./searchIndex";
import {StateGlyph} from "../ui/components/StateGlyph";
import {ProductTag} from "../ui/components/ProductTag";
import {useAuth} from "../context/AuthProvider.jsx";
import {useEffect, useState, useCallback} from "react";
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus";
import useOnlineStatus from "../hooks/useOnlineStatus";
import logger from '../utils/logger.js';
import {getAiAgentConfig} from "../config/ai-agent.js";

// Header icon buttons: outlined, as every button that neither creates nor deletes; muted ink, darker on hover.
const HEADER_BUTTON =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink";

/** First path segments named after a view: their breadcrumb is translated, the others are names. */
const SEGMENTS = new Set(["about", "cluster", "glossary", "heartbeats", "kinds", "namespaces", "network", "nodes", "objects", "pools", "resources", "stores", "whoami"]);

/** Breadcrumb item of a path segment; `key` is the catalog key of its label, translated at render. */
const crumb = (part, index, path) => ({
    name: part,
    path,
    key: index === 0 && SEGMENTS.has(part) ? `nav.breadcrumb.segments.${part}` : undefined,
});

const NavBar = ({sidebarOpen = false, onToggleSidebar, showSidebarToggle = false, menuAlert = null}) => {
    const auth = useAuth();
    const location = useLocation();
    const {clusterName, fetchNodes, loading} = useFetchDaemonStatus();
    const [breadcrumb, setBreadcrumb] = useState([]);
    const [storedClusterName, setStoredClusterName] = useState(null);
    const online = useOnlineStatus();
    const {t} = useTranslation();
    // Built once: the AI entry depends on the build configuration only.
    const aiEnabled = getAiAgentConfig().enabled;

    const getPathBreadcrumbs = useCallback(() => {
        const pathParts = location.pathname.split("/").filter(Boolean);
        const breadcrumbItems = [];
        if (pathParts[0] !== "login" && pathParts.length > 1) {
            if (pathParts[0] === "network" && pathParts.length === 2) {
                breadcrumbItems.push(crumb("network", 0, "/network"));
                breadcrumbItems.push({name: pathParts[1], path: `/network/${pathParts[1]}`});
            } else if (pathParts[0] === "objects" && pathParts.length === 2) {
                breadcrumbItems.push({name: "Objects", path: "/objects", key: "nav.routes.objects"});
                breadcrumbItems.push({name: pathParts[1], path: `/objects/${pathParts[1]}`});
            } else {
                pathParts.forEach((part, index) => {
                    const fullPath = "/" + pathParts.slice(0, index + 1).join("/");
                    if (part !== "cluster") {
                        breadcrumbItems.push(crumb(part, index, fullPath));
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
                    {name: "Cluster", path: "/", key: "nav.breadcrumb.cluster"},
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

    // The tab names the cluster and the product, as the header does.
    useEffect(() => {
        const product = t("ui.productTag.name");
        document.title = storedClusterName
            ? t("nav.documentTitle", {cluster: storedClusterName, product})
            : t("nav.documentTitleNoCluster", {product});
    }, [storedClusterName, t]);

    // Breadcrumb generation
    useEffect(() => {
        const pathParts = location.pathname.split("/").filter(Boolean);
        const breadcrumbItems = [];

        if (pathParts[0] !== "login") {
            breadcrumbItems.push(storedClusterName ? {name: storedClusterName, path: "/"} : {
                name: loading ? "Loading..." : "Cluster",
                path: "/",
                key: loading ? "nav.breadcrumb.loading" : "nav.breadcrumb.cluster",
            });

            if (pathParts.length > 1 || (pathParts.length === 1 && pathParts[0] !== "cluster")) {
                if (pathParts[0] === "nodes" && pathParts.length >= 4 && pathParts[2] === "objects") {
                    const node = decodeURIComponent(pathParts[1]);
                    const objectName = decodeURIComponent(pathParts.slice(3).join("/"));

                    breadcrumbItems.push(crumb("objects", 0, "/objects"));
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
                    breadcrumbItems.push(crumb("objects", 0, "/objects"));
                    breadcrumbItems.push({
                        name: objectName,
                        path: location.pathname
                    });
                } else if (pathParts[0] === "network" && pathParts.length === 2) {
                    breadcrumbItems.push(crumb("network", 0, "/network"));
                    breadcrumbItems.push({name: pathParts[1], path: `/network/${pathParts[1]}`});
                } else if (pathParts[0] === "network" && pathParts.length === 1) {
                    breadcrumbItems.push(crumb("network", 0, "/network"));
                } else {
                    pathParts.forEach((part, index) => {
                        const fullPath = "/" + pathParts.slice(0, index + 1).join("/");
                        if (part !== "cluster") {
                            breadcrumbItems.push(crumb(part, index, fullPath));
                        }
                    });
                }
            }
        }

        setBreadcrumb(breadcrumbItems);
    }, [location.pathname, storedClusterName, loading]);

    return (
        <header className="brand-bar flex h-11 shrink-0 items-center gap-4 border-b border-line px-3 text-ink">
            {showSidebarToggle && (
                <button
                    type="button"
                    onClick={onToggleSidebar}
                    aria-expanded={sidebarOpen}
                    aria-controls="app-sidebar"
                    aria-label={sidebarOpen ? t("nav.hideMenu") : t("nav.showMenu")}
                    title={sidebarOpen ? t("nav.hideMenu") : t("nav.showMenu")}
                    className={cn(HEADER_BUTTON, "relative")}
                >
                    <SidebarIcon open={sidebarOpen} width={18} height={18}/>
                    {/* Folded, the alerts of its entries on the button: the worst of them. */}
                    {menuAlert && (
                        <AlertMark
                            level={menuAlert.level}
                            text={menuAlert.text}
                            testId="menu-alert"
                            className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 text-[0.625rem]"
                        />
                    )}
                </button>
            )}

            {/* The tag of this frontend, not to be taken for the collector; the product
                name in the About page of the menu. Short of room, as the menu folds
                (COMPACT_QUERY), left out: the breadcrumb and the search need the bar. */}
            <div data-testid="brand" className="hidden shrink-0 items-center gap-2 min-[1200px]:flex">
                {/* The tag says which frontend this is, not the collector's: a label, not a
                    button, for "Cluster" to be the overview of the menu alone. The cluster
                    object opens from the overview, as "Configuration and actions". */}
                <ProductTag/>
            </div>

            {breadcrumb.length > 0 && location.pathname !== '/login' && (
                <nav aria-label={t("nav.breadcrumb.label")} className="flex min-w-0 items-center gap-1 overflow-hidden font-medium whitespace-nowrap">
                    {breadcrumb.map((item, index) => {
                        const label = item.key ? t(item.key) : item.name;
                        return (
                            <span key={index} className="flex min-w-0 items-center gap-1">
                                {item.path ? (
                                    <Link
                                        to={item.path}
                                        aria-label={t("nav.breadcrumb.navigateTo", {name: label})}
                                        className="truncate hover:underline"
                                    >
                                        {label}
                                    </Link>
                                ) : (
                                    <span className="truncate">{label}</span>
                                )}
                                {index < breadcrumb.length - 1 && (
                                    <span aria-hidden="true" className="text-ink-muted">{">"}</span>
                                )}
                            </span>
                        );
                    })}
                </nav>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-2">
                {!online && (
                    <span
                        title={t("nav.offlineTitle")}
                        className="inline-flex items-center gap-1 rounded-(--radius-control) bg-state-down-soft px-2 py-0.5 text-data font-semibold text-state-down"
                    >
                        <StateGlyph state="down" className="h-2 w-2"/>
                        {t("nav.offline")}
                    </span>
                )}


                {showSidebarToggle && (
                    <>
                        {/* The shortcuts list opens with the "?" key: no button for it, which read as a help. */}
                        <GlobalSearch loadIndex={loadSearchIndex}/>
                    </>
                )}

                {aiEnabled && (
                    <Link to="/ai" aria-label="Open the AI assistant" title="Open the AI assistant" className={HEADER_BUTTON}>
                        <ChatIcon width={16} height={16}/>
                    </Link>
                )}

                <Link to="/whoami" aria-label={t("nav.viewUser")} title={t("nav.viewUser")} className={HEADER_BUTTON}>
                    <UserIcon width={16} height={16}/>
                </Link>
            </div>
        </header>
    );
};

export default NavBar;
