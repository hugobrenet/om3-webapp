import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useParams, useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {IconButton} from "../ui/components/Button";
import {MenuButton} from "../ui/components/MenuButton";
import {SlideOver} from "../ui/components/SlideOver";
import {Spinner} from "../ui/components/Spinner";
import {BoltIcon, CloseIcon} from "../ui/icons";
import {useShallow} from "zustand/react/shallow";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager.jsx";
import {URL_OBJECT} from "../config/apiPath.js";
import ActionDialogManager from "../components/ActionDialogManager";
import HeaderSection from "./HeaderSection";
import ConfigSection from "./ConfigSection";
import KeysSection from "./KeysSection";
import InstanceCard from "./InstanceCard.jsx";
import LogsViewer from "./LogsViewer";
import {INSTANCE_ACTIONS, KEY_KINDS, OBJECT_ACTIONS, actionLabel} from "../constants/actions";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {orchestrationOf} from "./OrchestrationBadge";
import {postAction} from "./objectActions";
import logger from "../utils/logger";
import {explainedMenu} from "../app/action-menu";
import {childrenDown} from "../app/statusboard";

/** The feedback message hides itself after a while, as the snackbar did. */
const FEEDBACK_DURATION_MS = 5000;
const TONES = {info: "info", success: "success", warning: "warning", error: "error"};

/** Icon of an action in a menu: the action icons are sized to the menu line. */
const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

const PANEL = "rounded-(--radius-panel) border border-line bg-surface-raised";

const ZERO_TIME = "0001-01-01T00:00:00Z";
const hasTimestamp = (v) => !!v && v !== ZERO_TIME;

export const getResourceType = (rid, nodeData) => {
    if (!rid || !nodeData) return '';
    const topLevelType = nodeData?.resources?.[rid]?.type;
    if (topLevelType) return topLevelType;
    const encapData = nodeData?.encap || {};
    for (const containerId of Object.keys(encapData)) {
        const encapType = encapData[containerId]?.resources?.[rid]?.type;
        if (encapType) return encapType;
    }
    return '';
};

export const parseProvisionedState = (state) => {
    if (typeof state === "string") return state.toLowerCase() === "true";
    return !!state;
};

/**
 * An object: its state and actions, its configuration, its keys, its instances. A
 * page of its own under its route, or, `embedded`, the content of the object record
 * panel (`ObjectDetailPanel`), which gives the path and shows the logs and the
 * configuration in tabs of their own (`onOpenLogs`). An instance opens on a click only where `onViewInstance`
 * says what to do with it: in the panel, the status board shows the instances.
 */
const ObjectDetail = ({path, embedded = false, onOpenLogs, onViewInstance, onOrchestrationLogs} = {}) => {
    const {t} = useTranslation();
    const {objectName} = useParams();
    const decodedObjectName = path ?? decodeURIComponent(objectName);
    const {namespace, kind, name} = parseObjectPath(decodedObjectName);
    const navigate = useNavigate();

    const objectStatus = useEventStore((s) => s.objectStatus[decodedObjectName]);
    const objectInstanceStatus = useEventStore((s) => s.objectInstanceStatus[decodedObjectName]);
    // The monitors of this object's instances alone, by node: the map of them all,
    // replaced at each monitor event in the cluster, would render the page at each.
    const instanceMonitor = useEventStore(useShallow((s) => {
        const monitors = {};
        for (const node of Object.keys(s.objectInstanceStatus[decodedObjectName] ?? {})) {
            const monitor = s.instanceMonitor[`${node}:${decodedObjectName}`];
            if (monitor) monitors[node] = monitor;
        }
        return monitors;
    }));
    const instanceConfig = useEventStore((s) => s.instanceConfig[decodedObjectName]);

    const [configNode, setConfigNode] = useState(/** @type {string | null} */ (null));
    const [configDialogOpen, setConfigDialogOpen] = useState(false);
    const [configRefreshTrigger, setConfigRefreshTrigger] = useState(0);

    const [selectedNodes, setSelectedNodes] = useState(/** @type {string[]} */ ([]));

    const [pendingAction, setPendingAction] = useState(/** @type {any} */ (null));
    const [actionInProgress, setActionInProgress] = useState(false);

    const [snackbar, setSnackbar] = useState({open: false, message: "", severity: "success"});

    const [initialLoading, setInitialLoading] = useState(true);
    const [initialDataError, setInitialDataError] = useState(/** @type {string | null} */ (null));

    const [logsDrawerOpen, setLogsDrawerOpen] = useState(false);
    const [selectedNodeForLogs, setSelectedNodeForLogs] = useState(/** @type {string | null} */ (null));
    const [selectedInstanceForLogs, setSelectedInstanceForLogs] = useState(/** @type {string | null} */ (null));

    const objectEventTypes = useMemo(() => [
        "ObjectStatusUpdated",
        "InstanceStatusUpdated",
        "ObjectDeleted",
        "InstanceMonitorUpdated",
        "InstanceConfigUpdated",
        "InstanceConfigDeleted",
        "CONNECTION_OPENED",
        "CONNECTION_ERROR",
        "RECONNECTION_ATTEMPT",
        "MAX_RECONNECTIONS_REACHED",
        "CONNECTION_CLOSED"
    ], []);

    const fallbackTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
    const hasFallbackFired = useRef(false);
    const [fallbackCompleted, setFallbackCompleted] = useState(false);

    const objectData = useMemo(() => {
        const avail = objectStatus?.avail || "n/a";
        const frozen = objectStatus?.frozen === "frozen" ? "frozen" : "unfrozen";
        let globalExpect = null;
        let orchestrationId = null;
        let hasAnyNodeStopped = false;
        let hasAnyNodeLagging = false;

        if (objectInstanceStatus) {
            for (const node of Object.keys(objectInstanceStatus)) {
                const monitor = instanceMonitor[node] || {};
                if (!globalExpect && monitor.global_expect && monitor.global_expect !== "none") {
                    ({globalExpect, orchestrationId} = orchestrationOf([monitor]));
                }
                const ns = objectInstanceStatus[node] || {};
                if (hasTimestamp(ns.stopped_at)) hasAnyNodeStopped = true;
                if (hasTimestamp(ns.rpo_breached_at)) hasAnyNodeLagging = true;
            }
        }
        return {avail, frozen, globalExpect, orchestrationId, hasAnyNodeStopped, hasAnyNodeLagging};
    }, [objectStatus, objectInstanceStatus, instanceMonitor, decodedObjectName]);

    const nodesList = useMemo(() => {
        if (!objectInstanceStatus) return [];
        return Object.keys(objectInstanceStatus).sort();
    }, [objectInstanceStatus]);

    const memoizedObjectData = useMemo(() => {
        if (!objectInstanceStatus) return {};
        const enhanced = {};
        Object.keys(objectInstanceStatus).forEach(node => {
            enhanced[node] = {
                ...objectInstanceStatus[node],
                instanceConfig: instanceConfig?.[node] || {resources: {}},
                instanceMonitor: instanceMonitor[node] || {resources: {}},
            };
        });
        return enhanced;
    }, [objectInstanceStatus, instanceConfig, instanceMonitor, decodedObjectName]);

    // A vol down that nothing uses, its children down too: the downs of its instances gray.
    const isChildrenDown = childrenDown(
        decodedObjectName,
        objectStatus?.avail,
        nodesList.map((node) => instanceMonitor[node]),
    );

    const fetchFallbackData = useCallback(async () => {
        if (hasFallbackFired.current) return;
        hasFallbackFired.current = true;

        const token = localStorage.getItem("authToken");
        if (!token) {
            setInitialDataError(t("objectDetails.authTokenNotFound"));
            setInitialLoading(false);
            setFallbackCompleted(true);
            return;
        }

        const {namespace, kind, name: objName} = parseObjectPath(decodedObjectName);
        const encodedNamespace = encodeURIComponent(namespace);
        const encodedKind = encodeURIComponent(kind);
        const encodedName = encodeURIComponent(objName);

        try {
            // The object and its instances in one answer: the status of the object in
            // `data`, each instance's status, configuration and monitor under `data.instances`.
            const objRes = await fetch(
                `${URL_OBJECT}/${encodedNamespace}/${encodedKind}/${encodedName}`,
                {headers: {Authorization: `Bearer ${token}`}, cache: "no-cache"}
            );
            if (!objRes.ok) throw new Error(t("objectDetails.fallbackFailed", {status: objRes.status}));
            const {instances = {}, ...objectStatus} = (await objRes.json())?.data ?? {};

            const currentState = useEventStore.getState();
            const hasInstances = currentState.objectInstanceStatus[decodedObjectName] &&
                Object.keys(currentState.objectInstanceStatus[decodedObjectName]).length > 0;

            // The stream may have brought them meanwhile: it is newer. This object alone
            // set, the others kept: a panel stands over a list of them.
            if (!hasInstances) {
                currentState.setObjectStatuses({...currentState.objectStatus, [decodedObjectName]: objectStatus});
                const statuses = {};
                const monitors = {...currentState.instanceMonitor};
                for (const [node, instance] of Object.entries(instances)) {
                    if (instance?.status) statuses[node] = instance.status;
                    if (instance?.config) currentState.setInstanceConfig(decodedObjectName, node, instance.config);
                    if (instance?.monitor) monitors[`${node}:${decodedObjectName}`] = instance.monitor;
                }
                currentState.setInstanceStatuses({[decodedObjectName]: statuses}, true);
                currentState.setInstanceMonitors(monitors);
            }
        } catch (err) {
            logger.error("Fallback fetch failed:", err);
            setInitialDataError(err.message);
        } finally {
            setInitialLoading(false);
            setFallbackCompleted(true);
        }
    }, [decodedObjectName, t]);

    useEffect(() => {
        // The page starts from the replay of the stream. A panel stands over a view
        // that lists the object: dropping it would blink its row.
        if (!embedded) useEventStore.getState().removeObject(decodedObjectName);
        setInitialLoading(true);
        setInitialDataError(null);
        setFallbackCompleted(false);
        hasFallbackFired.current = false;
        setConfigNode(null);

        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, objectEventTypes, decodedObjectName) : null;

        fallbackTimer.current = setTimeout(() => {
            fetchFallbackData().catch((err) => {
                logger.error("[ObjectDetail] fetchFallbackData failed:", err);
            });
        }, 5000);

        return () => {
            if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
            release?.();
        };
    }, [decodedObjectName, objectEventTypes, fetchFallbackData, embedded]);

    useEffect(() => {
        if (initialLoading && (objectInstanceStatus !== undefined || fallbackCompleted)) {
            setInitialLoading(false);
            if (fallbackTimer.current) {
                clearTimeout(fallbackTimer.current);
                fallbackTimer.current = null;
            }
            hasFallbackFired.current = true;
        }
    }, [initialLoading, objectInstanceStatus, fallbackCompleted]);

    useEffect(() => {
        if (configNode || !objectInstanceStatus) return;
        const nodes = Object.keys(objectInstanceStatus);
        if (nodes.length === 0) return;
        const best = nodes.find((node) => {
            const nodeData = objectInstanceStatus[node];
            return nodeData?.encap && Object.values(nodeData.encap).some(
                (container) => container.resources && Object.keys(container.resources).length > 0
            );
        }) || nodes[0];
        setConfigNode(best);
    }, [objectInstanceStatus, configNode]);

    useEffect(() => {
        if (!configNode || !objectInstanceStatus) return;
        const currentNodes = Object.keys(objectInstanceStatus);
        if (currentNodes.length === 0) {
            setConfigNode(null);
            setConfigDialogOpen(false);
            return;
        }
        if (!currentNodes.includes(configNode)) {
            logger.debug(`[ObjectDetail] configNode "${configNode}" removed, switching to "${currentNodes[0]}"`);
            setConfigNode(currentNodes[0]);
        }
    }, [objectInstanceStatus, configNode]);

    const openSnackbar = useCallback((msg, sev = "success") => {
        setSnackbar({open: true, message: msg, severity: sev});
    }, []);

    // The configuration of an instance changed: read again, and said where it was
    // already read, its first reading no update.
    const prevInstanceConfigRef = useRef(instanceConfig);
    useEffect(() => {
        const prev = prevInstanceConfigRef.current;
        if (instanceConfig === prev) return;
        prevInstanceConfigRef.current = instanceConfig;
        setConfigRefreshTrigger((n) => n + 1);
        if (prev && instanceConfig && configNode) openSnackbar(t("objectDetails.feedback.configUpdated"), "info");
    }, [instanceConfig, configNode, openSnackbar, t]);
    const closeSnackbar = useCallback(() => setSnackbar((s) => ({...s, open: false})), []);

    useEffect(() => {
        if (!snackbar.open) return;
        const timer = setTimeout(closeSnackbar, FEEDBACK_DURATION_MS);
        return () => clearTimeout(timer);
    }, [snackbar, closeSnackbar]);

    // An action with the options set in its dialog, posted as the other views post
    // theirs (postAction): what comes of it, accepted or refused, the actions tray says.
    // Busy as long as one is still posting, those of a batch posted together.
    const actionsPosting = useRef(0);
    const runAction = useCallback(async (target) => {
        if (!localStorage.getItem("authToken")) return openSnackbar(t("objectDetails.feedback.authTokenNotFound"), "error");
        actionsPosting.current++;
        setActionInProgress(true);
        try {
            await postAction({path: decodedObjectName, ...target});
        } finally {
            actionsPosting.current--;
            if (actionsPosting.current === 0) setActionInProgress(false);
        }
    }, [decodedObjectName, openSnackbar, t]);

    const postObjectAction = useCallback(({action, options}) => runAction({action, options}), [runAction]);
    const postNodeAction = useCallback(({node, action, options}) => runAction({node, action, options}), [runAction]);

    // The action pending opens its confirmation (ActionDialogManager), its checkboxes its own.
    const openActionDialog = useCallback((action, context = null) => {
        setPendingAction({action, ...(context ? context : {})});
    }, []);

    const handleDialogConfirm = useCallback((_action, options) => {
        if (!pendingAction || !pendingAction.action) {
            setPendingAction(null);
            return;
        }
        if (pendingAction.batch === "nodes") {
            // Only to the instances still listed: one gone since its node was ticked, not.
            selectedNodes.filter((node) => nodesList.includes(node)).forEach(node => {
                postNodeAction({node, action: pendingAction.action, options}).catch((err) => {
                    logger.error("[ObjectDetail] postNodeAction failed:", err);
                });
            });
            setSelectedNodes([]);
        } else if (pendingAction.node && !pendingAction.rid) {
            if (!nodesList.includes(pendingAction.node)) {
                setPendingAction(null);
                return;
            }
            postNodeAction({node: pendingAction.node, action: pendingAction.action, options}).catch((err) => {
                logger.error("[ObjectDetail] postNodeAction failed:", err);
            });
        } else {
            postObjectAction({action: pendingAction.action, options}).catch((err) => {
                logger.error("[ObjectDetail] postObjectAction failed:", err);
            });
        }
        setPendingAction(null);
    }, [pendingAction, selectedNodes, nodesList, postNodeAction, postObjectAction]);

    // An instance gone (deleted, its node dropped): unticked, the batch menu counting
    // only those listed.
    useEffect(() => {
        setSelectedNodes((prev) => {
            const kept = prev.filter((node) => nodesList.includes(node));
            return kept.length === prev.length ? prev : kept;
        });
    }, [nodesList]);

    const toggleNode = useCallback((node) => {
        setSelectedNodes(prev => prev.includes(node) ? prev.filter(n => n !== node) : [...prev, node]);
    }, []);

    const handleBatchNodeActionClick = (action) => {
        openActionDialog(action, {batch: "nodes"});
    };

    const handleIndividualNodeActionClick = useCallback((node, action) => {
        if (!node) return;
        openActionDialog(action, {node});
    }, [openActionDialog]);

    const handleObjectActionClick = (action) => {
        openActionDialog(action);
    };

    const handleViewInstance = useCallback((node) => {
        if (onViewInstance) onViewInstance(node);
        else navigate(`/nodes/${node}/objects/${encodeURIComponent(decodedObjectName)}`);
    }, [decodedObjectName, navigate, onViewInstance]);
    const viewInstance = embedded && !onViewInstance ? undefined : handleViewInstance;

    const handleOpenLogs = useCallback((node, instanceName = null) => {
        if (onOpenLogs) {
            onOpenLogs(node);
            return;
        }
        setSelectedNodeForLogs(node);
        setSelectedInstanceForLogs(instanceName);
        setLogsDrawerOpen(true);
    }, [onOpenLogs]);

    const handleCloseLogsDrawer = useCallback(() => {
        setLogsDrawerOpen(false);
        setSelectedNodeForLogs(null);
        setSelectedInstanceForLogs(null);
    }, []);

    const getNodeState = useCallback((node) => {
        const nodeStatus = objectInstanceStatus?.[node] || {};
        const monitor = instanceMonitor[node] || {};
        const avail = nodeStatus.avail || '';
        const frozen = nodeStatus.frozen_at && nodeStatus.frozen_at !== ZERO_TIME ? "frozen" : "unfrozen";
        const state = monitor.state !== "idle" ? monitor.state : null;
        const isStopped = hasTimestamp(nodeStatus.stopped_at);
        const isLagging = hasTimestamp(nodeStatus.rpo_breached_at);
        return {avail, frozen, state, isStopped, isLagging};
    }, [objectInstanceStatus, instanceMonitor, decodedObjectName]);

    // Freeze and unfreeze both, as on an object: either is harmless where it changes nothing.
    const batchFilteredActions = INSTANCE_ACTIONS;

    const showKeys = KEY_KINDS.includes(kind);

    const feedback = snackbar.open && (
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
    );

    // In the panel, the configuration has a tab of its own.
    const configSection = embedded ? null : (
        <ConfigSection
            decodedObjectName={decodedObjectName}
            configNode={configNode}
            setConfigNode={setConfigNode}
            openSnackbar={openSnackbar}
            configDialogOpen={configDialogOpen}
            setConfigDialogOpen={setConfigDialogOpen}
            configRefreshTrigger={configRefreshTrigger}
        />
    );

    if (initialLoading) {
        return (
            <div className={embedded ? "flex items-center justify-center gap-2 py-8" : "flex min-h-[80dvh] items-center justify-center gap-2 p-4"}>
                <Spinner label={t("objectDetails.loading")}/>
                <span className="text-ink-muted">{t("objectDetails.loadingText")}</span>
            </div>
        );
    }

    if (nodesList.length === 0 && !initialDataError) {
        return (
            <div className={embedded ? "space-y-3" : "p-4 space-y-3"}>
                {!embedded && <h1 className="text-title font-semibold">{decodedObjectName}</h1>}
                {feedback}
                <p className="py-4 text-center text-ink-muted">{t("objectDetails.noInformation")}</p>
                {showKeys && <KeysSection decodedObjectName={decodedObjectName} openSnackbar={openSnackbar}
                                          refreshKey={configRefreshTrigger}/>}
                {configSection}
            </div>
        );
    }

    const logsTitle = selectedInstanceForLogs
        ? t("objectDetails.logs.instanceTitle", {name: selectedInstanceForLogs})
        : selectedNodeForLogs
            ? t("objectDetails.logs.nodeTitle", {node: selectedNodeForLogs})
            : t("objectDetails.logs.title");

    return (
        <div className={embedded ? "space-y-3" : "p-4 space-y-3"}>
            <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                    <HeaderSection
                        embedded={embedded}
                        decodedObjectName={decodedObjectName}
                        kind={kind}
                        globalStatus={objectStatus}
                        actionInProgress={actionInProgress}
                        handleObjectActionClick={handleObjectActionClick}
                        getObjectStatus={() => objectData}
                        onOrchestrationLogs={onOrchestrationLogs}
                    />
                </div>
                {configSection !== null && <div className="shrink-0">{configSection}</div>}
            </div>

            {feedback}

            {pendingAction && (
                <ActionDialogManager
                    pendingAction={pendingAction}
                    handleConfirm={handleDialogConfirm}
                    target={pendingAction?.batch === "nodes"
                        ? t("statusBoard.subjects.instance", {path: decodedObjectName, where: t("nodes.target.selected", {count: selectedNodes.length})})
                        : pendingAction?.node
                            ? t("statusBoard.subjects.instance", {path: decodedObjectName, where: t("nodes.target.node", {node: pendingAction.node})})
                            : t("objectDetails.dialogTarget", {name: decodedObjectName})}
                    names={pendingAction?.batch === "nodes" ? selectedNodes : undefined}
                    instances={pendingAction?.batch === "nodes" || Boolean(pendingAction?.node)}
                    supportedActions={
                        pendingAction?.batch === "nodes" || pendingAction?.node
                            ? INSTANCE_ACTIONS.map(a => a.name)
                            : OBJECT_ACTIONS.map(a => a.name)
                    }
                    nodes={nodesList}
                    onClose={() => setPendingAction(null)}
                />
            )}

            {showKeys && <KeysSection decodedObjectName={decodedObjectName} openSnackbar={openSnackbar}
                                      refreshKey={configRefreshTrigger}/>}

            {!KEY_KINDS.includes(kind) && (
                <section aria-labelledby="object-instances" className={PANEL}>
                    <div className="flex items-center gap-3 border-b border-line px-3 py-2">
                        <h2 id="object-instances" className="font-semibold">
                            {t("objectDetails.instancesHeading", {count: nodesList.length})}
                        </h2>
                        <MenuButton
                            // The actions: a solid pill.
                            prominent
                            icon={<BoltIcon className="h-3.5 w-3.5"/>}
                            label={t("objectDetails.batchActionsMenu", {count: selectedNodes.length})}
                            disabled={selectedNodes.length === 0}
                            className="ml-auto"
                            align="end"
                            {...explainedMenu(t, "instance", batchFilteredActions.map(({name, icon, color}) => ({
                                key: name,
                                label: actionLabel(name),
                                icon: <span aria-hidden="true" className={color === "red" ? DANGER_ICON : ICON}>{icon}</span>,
                                disabled: actionInProgress,
                                onSelect: () => handleBatchNodeActionClick(name),
                            })))}
                        />
                    </div>
                    <div className="divide-y divide-line">
                        {nodesList.map(node => (
                            <InstanceCard
                                key={node}
                                node={node}
                                nodeData={memoizedObjectData[node] || {}}
                                selectedNodes={selectedNodes}
                                toggleNode={toggleNode}
                                actionInProgress={actionInProgress}
                                actions={INSTANCE_ACTIONS}
                                onAction={handleIndividualNodeActionClick}
                                getNodeState={getNodeState}
                                instanceName={name}
                                onOpenLogs={handleOpenLogs}
                                onViewInstance={viewInstance}
                                objectAvail={objectStatus?.avail}
                                childrenDown={isChildrenDown}
                            />
                        ))}
                    </div>
                </section>
            )}

            <SlideOver
                open={logsDrawerOpen && selectedNodeForLogs !== null && !embedded}
                title={logsTitle}
                onClose={handleCloseLogsDrawer}
                closeLabel={t("objectDetails.logs.close")}
                size="wide"
                resizeLabel={t("objectDetails.logs.resize")}
            >
                {logsDrawerOpen && selectedNodeForLogs !== null && (
                    <LogsViewer
                        nodename={selectedNodeForLogs}
                        type={selectedInstanceForLogs ? "instance" : "node"}
                        namespace={namespace}
                        kind={kind}
                        instanceName={selectedInstanceForLogs}
                        height="100%"
                    />
                )}
            </SlideOver>

        </div>
    );
};

export default ObjectDetail;
