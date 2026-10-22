import React, {useEffect, useState, useMemo} from "react";
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus.jsx";
import {retainEventReception} from "../eventSourceManager";
import useEventStore from "../hooks/useEventStore.js";
import {useClusterNodeOrder} from "../hooks/useClusterNodeOrder";
import {trackRefused, trackResponse} from "../app/action-tracker";
import {refusalReason} from "./objectActions";
import {getResponseErrorMessage} from "../services/api.jsx";
import NodeRow from "../components/NodeRow.jsx";
import logger from '../utils/logger.js';
import {NODE_ACTIONS} from "../constants/actions";
import {nodeActionRequest, nodeMenuItems} from "../app/node-actions";
import {useTranslation} from "react-i18next";
import {NodeActionDialog} from "./NodeActionDialog";
import {Table, HeaderRow, HeaderCell, SortHeaderCell} from "../ui/components/Table";
import {Checkbox} from "../ui/components/Field";
import {IconButton} from "../ui/components/Button";
import {MenuButton} from "../ui/components/MenuButton";
import {usePanelSearch} from "../app/panel-search";
import {NodeDetailPanel} from "./NodePanel";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {BoltIcon, CloseIcon} from "../ui/icons";

const ZERO_DATE = "0001-01-01T00:00:00Z";

/** How long a feedback message stays, as the snackbar it replaces. */
const FEEDBACK_DURATION_MS = 4000;

const isNodeFrozen = (status) => !!status?.frozen_at && status?.frozen_at !== ZERO_DATE;

const SORT_COLUMNS = [
    {key: "name", labelKey: "common.name"},
    {key: "state", labelKey: "common.state"},
    {key: "score", labelKey: "nodes.columns.score"},
    {key: "load_15m", labelKey: "nodes.columns.load15m"},
    {key: "mem_avail", labelKey: "nodes.columns.memAvail"},
    {key: "swap_avail", labelKey: "nodes.columns.swapAvail"},
    {key: "version", labelKey: "nodes.columns.version"},
    {key: "booted_at", labelKey: "nodes.columns.bootedAt"},
    {key: "updated_at", labelKey: "nodes.columns.updatedAt"},
];

/** Feedback tones, from the severities of the snackbar it replaces. */
const TONES = {info: "info", success: "success", warning: "warning", error: "error"};

/** Class names of the bulk menu: aligned on the right edge of its button, at the end of the toolbar. */
const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

const NodesTable = () => {
    const {t} = useTranslation();
    const {daemon, fetchNodes} = useFetchDaemonStatus();
    const nodeStatus = useEventStore((state) => state.nodeStatus);
    const nodeStats = useEventStore((state) => state.nodeStats);
    const nodeMonitor = useEventStore((state) => state.nodeMonitor);

    const [selectedNodes, setSelectedNodes] = useState([]);
    const [snackbar, setSnackbar] = useState({open: false, message: "", severity: "info"});
    const [pendingAction, setPendingAction] = useState(null);
    const [sortColumn, setSortColumn] = useState("name");
    const [sortDirection, setSortDirection] = useState("asc");

    // The node whose panel is open, and its tab, in the URL as on the other views.
    const panel = usePanelSearch();

    const nodeEventTypes = useMemo(() => [
        "NodeStatusUpdated",
        "NodeMonitorUpdated",
        "NodeStatsUpdated",
        // A node dropped by the cluster: its line turns to "?", as om mon shows it.
        "NodeMonitorDeleted",
        "CONNECTION_OPENED",
        "CONNECTION_ERROR",
        "RECONNECTION_ATTEMPT",
        "MAX_RECONNECTIONS_REACHED",
        "CONNECTION_CLOSED"
    ], []);

    const handleAction = (action) => {
        setPendingAction({action, node: null});
    };

    // A row opens its node's panel; its logs are on a tab of it.
    const handleOpenNode = (nodename) => panel.select(nodename);

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        let release = null;
        if (token) {
            // Start event reception immediately
            release = retainEventReception(token, nodeEventTypes);
            // Fetch daemon status in parallel
            fetchNodes(token).catch(error => {
                logger.error("Failed to fetch nodes:", error);
            });
        }

        return () => {
            release?.();
        };
    }, [fetchNodes, nodeEventTypes]);

    // The feedback message hides itself after a while, as the snackbar did.
    useEffect(() => {
        if (!snackbar.open) return;
        const timer = setTimeout(() => {
            setSnackbar((prev) => ({...prev, open: false}));
        }, FEEDBACK_DURATION_MS);
        return () => clearTimeout(timer);
    }, [snackbar]);

    const closeSnackbar = () => setSnackbar((prev) => ({...prev, open: false}));

    const handleSelectNode = (event, nodename) => {
        if (event.target.checked) {
            setSelectedNodes((prev) => [...prev, nodename]);
        } else {
            setSelectedNodes((prev) => prev.filter((node) => node !== nodename));
        }
    };

    const handleDialogConfirm = async (action) => {
        if (!pendingAction) return;

        const token = localStorage.getItem("authToken");
        if (!token) {
            setSnackbar({
                open: true,
                message: t("nodes.feedback.noToken"),
                severity: "error",
            });
            return;
        }

        // What comes of each node, accepted, refused or left alone, the actions tray says.
        const nodesToProcess = pendingAction.node
            ? [pendingAction.node]
            : selectedNodes;
        const refuse = (node, reason) => trackRefused({action, subject: node, reason});

        const promises = nodesToProcess.map(async (node) => {
            const isFrozen = isNodeFrozen(nodeStatus[node]);
            if (action === "freeze" && isFrozen) {
                refuse(node, t("actionTray.reasons.alreadyFrozen"));
                return;
            }
            if (action === "unfreeze" && !isFrozen) {
                refuse(node, t("actionTray.reasons.alreadyUnfrozen"));
                return;
            }
            const {url, body} = nodeActionRequest(node, action);
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    ...(body === undefined ? {} : {body}),
                });
                if (!response.ok) {
                    logger.error(`Failed to execute ${action} on ${node}: HTTP error! status: ${response.status}`);
                    refuse(node, refusalReason({status: response.status, detail: await getResponseErrorMessage(response)}));
                    return;
                }
                await trackResponse(response, {action, subject: node, node});
            } catch (error) {
                logger.error(`Failed to execute ${action} on ${node}: ${error.message}`);
                refuse(node, error.message);
            }
        });

        await Promise.all(promises);
        setSelectedNodes([]);
        setPendingAction(null);
    };

    const filteredMenuItems = NODE_ACTIONS.filter(({name}) => {
        if (selectedNodes.length === 0) return false;
        return selectedNodes.some((nodename) => {
            const isFrozen = isNodeFrozen(nodeStatus[nodename]);
            if (name === "freeze" && isFrozen) return false;
            return !(name === "unfreeze" && !isFrozen);
        });
    });

    // The nodes of the cluster configuration too: a node dropped keeps its line.
    const clusterNodes = useClusterNodeOrder();
    const sortedNodes = React.useMemo(() => {
        const names = [...new Set([...(clusterNodes ?? []), ...Object.keys(nodeStatus)])];
        return names.sort((a, b) => {
            let diff = 0;
            if (sortColumn === "name") {
                diff = a.localeCompare(b);
            } else if (sortColumn === "state") {
                const stateA = nodeMonitor[a]?.state || "idle";
                const stateB = nodeMonitor[b]?.state || "idle";
                diff = stateA.localeCompare(stateB);
            } else if (sortColumn === "score") {
                diff = (nodeStats[a]?.score || 0) - (nodeStats[b]?.score || 0);
            } else if (sortColumn === "load_15m") {
                diff = (nodeStats[a]?.load_15m || 0) - (nodeStats[b]?.load_15m || 0);
            } else if (sortColumn === "mem_avail") {
                diff = (nodeStats[a]?.mem_avail || 0) - (nodeStats[b]?.mem_avail || 0);
            } else if (sortColumn === "swap_avail") {
                diff = (nodeStats[a]?.swap_avail || 0) - (nodeStats[b]?.swap_avail || 0);
            } else if (sortColumn === "version") {
                diff = (nodeStatus[a]?.agent || '').localeCompare(nodeStatus[b]?.agent || '');
            } else if (sortColumn === "booted_at") {
                const bootedA = nodeStatus[a]?.booted_at || ZERO_DATE;
                const bootedB = nodeStatus[b]?.booted_at || ZERO_DATE;
                diff = new Date(bootedA).getTime() - new Date(bootedB).getTime();
            } else if (sortColumn === "updated_at") {
                const updatedA = nodeMonitor[a]?.updated_at || ZERO_DATE;
                const updatedB = nodeMonitor[b]?.updated_at || ZERO_DATE;
                diff = new Date(updatedA).getTime() - new Date(updatedB).getTime();
            }
            return sortDirection === "asc" ? diff : -diff;
        });
    }, [clusterNodes, nodeStatus, nodeStats, nodeMonitor, sortColumn, sortDirection]);

    const handleSort = (column) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortColumn(column);
            setSortDirection("asc");
        }
    };

    const nodeCount = Object.keys(nodeStatus).length;

    return (
        <div className="p-4 space-y-3">
            {/* The actions on the nodes selected; on one node, its panel's. Nothing selected,
                how to select, in the place of the actions. */}
            <div className="flex min-h-7 flex-wrap items-center justify-end gap-3">
                {selectedNodes.length > 0 ? (
                    <>
                        <span className="whitespace-nowrap text-ink-muted">{t("common.selected", {count: selectedNodes.length})}</span>
                        <MenuButton
                            // The actions: a solid pill.
                            prominent
                            icon={<BoltIcon className="h-3.5 w-3.5"/>}
                            label={t("nodes.bulkActions")}
                            align="end"
                            // The node, its inventory, its daemon: a column each in a wide window.
                            columns={3}
                            items={nodeMenuItems({
                                t,
                                nodes: selectedNodes,
                                offered: (name) => filteredMenuItems.some((action) => action.name === name),
                                apiNode: daemon?.nodename,
                                renderIcon: ({icon, color}) => <span aria-hidden="true" className={color === "red" ? DANGER_ICON : ICON}>{icon}</span>,
                                onSelect: handleAction,
                            })}
                        />
                    </>
                ) : (
                    <span className="text-ink-muted">{t("nodes.selectHint")}</span>
                )}
            </div>

            {snackbar.open && (
                <Alert
                    tone={TONES[snackbar.severity] ?? "info"}
                    action={
                        <IconButton label={t("common.close")} onClick={closeSnackbar}>
                            <CloseIcon className="h-4 w-4"/>
                        </IconButton>
                    }
                >
                    {snackbar.message}
                </Alert>
            )}

            {nodeCount === 0 ? (
                <div className="flex justify-center py-8">
                    <Spinner label={t("nodes.loading")}/>
                </div>
            ) : (
                // Visible overflow, the panel as wide as the table: the row menus are not clipped,
                // the header sticks to the top of the page scroll, which scrolls sideways if need be.
                <Table sticky className="max-h-[calc(100dvh-12rem)]">
                    <thead>
                    <HeaderRow>
                        <HeaderCell className="w-8">
                            <Checkbox
                                aria-label={t("nodes.selectAll")}
                                checked={selectedNodes.length === nodeCount}
                                onChange={(e) =>
                                    setSelectedNodes(e.target.checked ? Object.keys(nodeStatus) : [])
                                }
                            />
                        </HeaderCell>
                        {SORT_COLUMNS.map(({key, labelKey}) => (
                            <SortHeaderCell
                                key={key}
                                label={t(labelKey)}
                                active={sortColumn === key}
                                direction={sortDirection}
                                onSort={() => handleSort(key)}
                            />
                        ))}
                    </HeaderRow>
                    </thead>
                    <tbody>
                    {sortedNodes.map((nodename) => (
                        <NodeRow
                            key={nodename}
                            nodename={nodename}
                            stats={nodeStats[nodename]}
                            status={nodeStatus[nodename]}
                            monitor={nodeMonitor[nodename]}
                            isSelected={selectedNodes.includes(nodename)}
                            daemonNodename={daemon.nodename}
                            onSelect={handleSelectNode}
                            onOpen={handleOpenNode}
                            isOpen={panel.sel === nodename}
                        />
                    ))}
                    </tbody>
                </Table>
            )}

            <NodeActionDialog
                pending={pendingAction}
                onConfirm={handleDialogConfirm}
                target={pendingAction?.node
                    ? t("nodes.target.node", {node: pendingAction.node})
                    : t("nodes.target.selected", {count: selectedNodes.length})}
                onClose={() => setPendingAction(null)}
            />

            <NodeDetailPanel
                node={panel.sel}
                tab={panel.tab}
                onTabChange={panel.setTab}
                onClose={() => panel.select(undefined)}
            />

        </div>
    );
};

export default NodesTable;
