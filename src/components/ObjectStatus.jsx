import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager.jsx";
import {URL_CLUSTER_STATUS, URL_OBJECT} from "../config/apiPath.js";
import {apiFetch} from "../services/api.jsx";
import {isActionAllowedForSelection, parseObjectPath} from "../utils/objectUtils.jsx";
import {buildBoard} from "../app/statusboard";
import {StatusBoard, rowNodes} from "../app/StatusBoard";
import {usePanelHeader} from "../app/panel-header";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {MenuButton} from "../ui/components/MenuButton";
import {Spinner} from "../ui/components/Spinner";
import {BoltIcon, CloseIcon} from "../ui/icons";
import {INSTANCE_ACTIONS, OBJECT_ACTIONS, RESOURCE_ACTIONS, actionLabel, objectActionsFor} from "../constants/actions";
import {OrchestrationBadge, orchestrationOf} from "./OrchestrationBadge";
import {PolicyTag} from "../ui/components/PolicyTag";
import ActionDialogManager from "./ActionDialogManager";
import ConsoleTerminal from "./ConsoleTerminal.jsx";
import {CLEAR_ACTION, postAction, resourceActions} from "./objectActions";
import {DatastoreLinks, RefreshStatusButton, datastoresOf, volumesOf} from "./InstanceActions";
import logger from "../utils/logger.js";

/** Icon of an action in a menu: the action icons are sized to the menu line. */
const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";


/** Every action the dialogs may have to confirm. */
const SUPPORTED_ACTIONS = [...new Set([...OBJECT_ACTIONS, ...INSTANCE_ACTIONS, ...RESOURCE_ACTIONS, CLEAR_ACTION].map((a) => a.name))];

const actionIcon = ({icon, color}) => (
    <span aria-hidden="true" className={color === "red" ? DANGER_ICON : ICON}>{icon}</span>
);

/** The events of the object, which the stream carries for it alone. */
const OBJECT_EVENTS = [
    "ObjectStatusUpdated",
    "InstanceStatusUpdated",
    "ObjectDeleted",
    "InstanceMonitorUpdated",
    "InstanceConfigUpdated",
    "InstanceConfigDeleted",
];

/** The events of the nodes: their freeze. */
const NODE_EVENTS = ["NodeStatusUpdated"];

/** A burst of events reads the object once. */
const REFRESH_DELAY_MS = 300;

/**
 * The status of an object, as `om <path> status` shows it (StatusBoard), read
 * from the daemon as om reads it: the object with its instances, and the cluster
 * status for the frozen nodes and the agent versions. Read again on each event
 * about the object.
 */
const ObjectStatus = ({path, onOrchestrationLogs, linkNode, linkResource, openCell}) => {
    const {t} = useTranslation();
    const [digest, setDigest] = useState(null);
    const [error, setError] = useState(null);
    const timer = useRef(null);

    const load = useCallback(async () => {
        const token = localStorage.getItem("authToken");
        const headers = {Authorization: `Bearer ${token}`};
        const {namespace, kind, name} = parseObjectPath(path);
        const url = `${URL_OBJECT}/${encodeURIComponent(namespace)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
        try {
            const [object, cluster] = await Promise.all([
                apiFetch(url, {headers, cache: "no-cache"}),
                // Without it, the board misses the frozen nodes and the agent versions only.
                apiFetch(URL_CLUSTER_STATUS, {headers, cache: "no-cache"}).catch((err) => {
                    logger.warn("[ObjectStatus] cluster status not read:", err);
                    return null;
                }),
            ]);
            const nodes = cluster?.cluster?.node ?? {};
            const frozenNodes = new Set(
                Object.entries(nodes)
                    .filter(([, n]) => n?.status?.frozen_at && !n.status.frozen_at.startsWith("0001-01-01"))
                    .map(([n]) => n)
            );
            setDigest({
                path,
                object: object?.data ?? {},
                frozenNodes,
                isCompat: cluster?.cluster?.status?.is_compat ?? true,
            });
            setError(null);
        } catch (err) {
            logger.error("[ObjectStatus] object not read:", err);
            setError(err.message || String(err));
        }
    }, [path]);

    const refresh = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void load(), REFRESH_DELAY_MS);
    }, [load]);

    // Another object starts from nothing; the stream carries its events while shown.
    useEffect(() => {
        setDigest(null);
        setError(null);
        void load();
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, OBJECT_EVENTS, path) : null;
        // The cluster object's board shows the frozen nodes: their freeze, which brings
        // no event about the object, reads it again too.
        const releaseNodes = token && parseObjectPath(path).kind === "ccfg"
            ? retainEventReception(token, NODE_EVENTS)
            : null;
        return () => {
            release?.();
            releaseNodes?.();
            if (timer.current) clearTimeout(timer.current);
        };
    }, [path, load]);

    // What the events bring about the object, for the board to be read again.
    const objectStatus = useEventStore((s) => s.objectStatus?.[path]);
    const instances = useEventStore((s) => s.objectInstanceStatus?.[path]);
    const configs = useEventStore((s) => s.instanceConfig?.[path]);
    const monitors = useEventStore((s) => Object.entries(s.instanceMonitor ?? {})
        .filter(([key]) => key.endsWith(`:${path}`))
        .map(([key, m]) => `${key}=${m?.state}/${m?.global_expect}/${m?.local_expect}/${m?.updated_at}`)
        .join(","));
    // The orchestration in progress, by the monitors of the instances: said as a
    // string, for the selector to give the same value while it does not change.
    const orchestration = useEventStore((s) => {
        const {globalExpect, orchestrationId} = orchestrationOf(Object.entries(s.instanceMonitor ?? {})
            .filter(([key]) => key.endsWith(`:${path}`))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, m]) => m));
        return globalExpect === null ? "" : `${globalExpect} ${orchestrationId ?? ""}`;
    });
    // The frozen nodes, for the cluster object alone (see NODE_EVENTS).
    const isCluster = parseObjectPath(path).kind === "ccfg";
    const frozenNodes = useEventStore((s) => (isCluster
        ? Object.entries(s.nodeStatus ?? {}).map(([node, st]) => `${node}=${st?.frozen_at}`).sort().join(",")
        : ""));
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        refresh();
    }, [objectStatus, instances, configs, monitors, frozenNodes, refresh]);

    const board = useMemo(() => (digest === null ? null : buildBoard(digest)), [digest]);

    // The title bar of the panel, for what concerns the whole object: its policies, its actions.
    const header = usePanelHeader();

    // The actions: the one waiting for its confirmation, the ones being asked. What
    // comes of them, accepted or refused, the actions tray says (postAction).
    const [pending, setPending] = useState(null);
    const [running, setRunning] = useState(false);
    const [consoleTarget, setConsoleTarget] = useState(null);
    // The instances and the resources picked on the board, to act on together: the
    // nodes of the instances, and the resources as `node/rid`, one per node.
    const [pickedNodes, setPickedNodes] = useState([]);
    const [pickedCells, setPickedCells] = useState([]);


    /**
     * Asks for the action, confirmed first. `targets` are what it runs on: none for
     * the object, else one entry per node, with the resources it runs on there, if
     * any, as a selector (`rid=a,b`); `subject` says it in words. A console opens a
     * terminal on its resource at once: no action to confirm.
     */
    const ask = useCallback((action, {targets = [], subject, fromSelection = false} = {}) => {
        if (action === "console") {
            const {namespace, kind, name} = parseObjectPath(path);
            setConsoleTarget({node: targets[0].node, namespace, kind, name, rid: targets[0].rid});
            return;
        }
        // The actions on the cluster object are the cluster's, on all its nodes (actionUrl).
        const object = parseObjectPath(path).kind === "ccfg" ? t("statusBoard.subjects.cluster") : path;
        setPending({action, targets, subject: subject ?? object, fromSelection});
    }, [path, t]);

    const run = useCallback(async () => {
        if (pending === null) return;
        const {action, fromSelection} = pending;
        setPending(null);
        setRunning(true);
        const targets = pending.targets.length === 0
            ? [{path, action}]
            : pending.targets.map(({node, rid}) => ({path, action, node, rid}));
        await Promise.all(targets.map((target) => postAction(target)));
        if (fromSelection) {
            setPickedNodes([]);
            setPickedCells([]);
        }
        setRunning(false);
        refresh();
    }, [pending, path, refresh]);

    if (error !== null && board === null) {
        return <Alert tone="error">{t("statusBoard.loadError", {message: error})}</Alert>;
    }
    if (board === null) {
        return (
            <div className="flex justify-center py-8">
                <Spinner label={t("statusBoard.loading")}/>
            </div>
        );
    }
    const {kind} = parseObjectPath(path);
    const allNodes = board.nodes.map((n) => n.name);

    /** The nodes, in words: one, all of them, or a list. */
    const where = (nodes) => (nodes.length === 1
        ? nodes[0]
        : nodes.length === allNodes.length ? t("statusBoard.actions.allNodes") : nodes.join(", "));
    const onInstances = (nodes) => ({
        targets: nodes.map((node) => ({node})),
        // On the cluster object, the instances are the nodes themselves (actionUrl).
        subject: kind === "ccfg" ? where(nodes) : t("statusBoard.subjects.instance", {path, where: where(nodes)}),
    });
    /** The resources on the nodes, each node given the ones it has of them. */
    const onResources = (rows, nodes) => ({
        targets: nodes
            .map((node) => ({node, rid: rows.filter((r) => rowNodes(board, r).includes(node)).map((r) => r.name).join(",")}))
            .filter((target) => target.rid !== ""),
        subject: t("statusBoard.subjects.resource", {rid: rows.map((r) => r.name).join(", "), path, where: where(nodes)}),
    });

    /** What an instance is: frozen, its monitor failed. */
    const instanceOf = (node) => {
        const index = allNodes.indexOf(node);
        const cell = board.rows.find((r) => r.kind === "instance")?.cells[index] ?? [];
        return {
            frozen: cell.some((s) => s.mark === "*"),
            // A failed monitor is cleared for the orchestration to try again, as its note says.
            failed: (board.rows.find((r) => r.kind === "monitor")?.cells[index] ?? []).some((s) => s.text.endsWith("failed")),
        };
    };
    /** The instance actions for these instances: freeze where one is not, clear where one failed. */
    const instanceActions = (nodes) => {
        // The cluster object's instances stand for their nodes: the node is frozen or not.
        if (kind === "ccfg") {
            const frozen = nodes.map((node) => board.nodes.find((n) => n.name === node)?.frozen ?? false);
            return INSTANCE_ACTIONS.filter((a) => (a.name === "freeze"
                ? frozen.some((f) => !f)
                : a.name === "unfreeze" && frozen.some((f) => f)));
        }
        const l = nodes.map(instanceOf);
        return [
            ...(l.some((i) => i.failed) ? [CLEAR_ACTION] : []),
            ...INSTANCE_ACTIONS.filter((a) => (a.name === "freeze"
                ? l.some((i) => !i.frozen)
                : a.name === "unfreeze" ? l.some((i) => i.frozen) : true)),
        ];
    };
    const menuItems = (actions, onSelect) => actions.map((a) => ({
        key: a.name,
        label: actionLabel(a.name),
        icon: actionIcon(a),
        onSelect: () => onSelect(a.name),
    }));

    // What the selection still names: an instance or a resource gone is no longer in it.
    const resourceRows = board.rows.filter((r) => r.kind === "resource");
    const cellKey = (rid, node) => `${node}/${rid}`;
    const nodesPicked = pickedNodes.filter((n) => allNodes.includes(n));
    /** The resources picked, node by node, in the order of the board. */
    const cellsPicked = allNodes.flatMap((node) => resourceRows
        .filter((r) => pickedCells.includes(cellKey(r.name, node)) && rowNodes(board, r).includes(node))
        .map((r) => ({node, row: r})));
    /** The resources picked, on one node or more: each counted once. */
    const resourcesPicked = new Set(cellsPicked.map((c) => c.row.name)).size;
    const toggle = (setter, value) => setter((l) => (l.includes(value) ? l.filter((v) => v !== value) : [...l, value]));
    const clearSelection = () => {
        setPickedNodes([]);
        setPickedCells([]);
    };
    // The instances or the resources, not both: picking one kind drops the other.
    const selection = {
        isNode: (node) => nodesPicked.includes(node),
        toggleNode: (node) => {
            setPickedCells([]);
            toggle(setPickedNodes, node);
        },
        isCell: (rid, node) => pickedCells.includes(cellKey(rid, node)),
        toggleCell: (rid, node) => {
            setPickedNodes([]);
            toggle(setPickedCells, cellKey(rid, node));
        },
        toggleRow: (rid) => {
            setPickedNodes([]);
            const row = resourceRows.find((r) => r.name === rid);
            const keys = rowNodes(board, row).map((node) => cellKey(rid, node));
            setPickedCells((l) => (keys.every((k) => l.includes(k))
                ? l.filter((k) => !keys.includes(k))
                : [...new Set([...l, ...keys])]));
        },
    };

    // The cluster is frozen node by node: nothing to freeze once all of them are, nor
    // to unfreeze while none is.
    const clusterIdle = (action) => kind === "ccfg" && (
        (action === "freeze" && board.nodes.every((n) => n.frozen))
        || (action === "unfreeze" && !board.nodes.some((n) => n.frozen)));
    // In the title bar of the panel, solid: "Actions" in a wide window, the bolt alone
    // in a narrow one; elsewhere, a solid pill.
    const inHeader = header.title !== null && header.actions !== null;
    const objectMenu = (
        <MenuButton
            prominent={!inHeader}
            solid
            icon={<BoltIcon className="h-3.5 w-3.5"/>}
            label={t("statusBoard.actions.object")}
            align="end"
            disabled={running}
            items={objectActionsFor(kind)
                .map((a) => ({
                    key: a.name,
                    label: actionLabel(a.name),
                    icon: actionIcon(a),
                    disabled: !isActionAllowedForSelection(a.name, [path]) || clusterIdle(a.name),
                    onSelect: () => ask(a.name),
                }))}
        />
    );

    const [globalExpect, orchestrationId] = orchestration === "" ? [null, null] : orchestration.split(" ");
    const orchestrationBadge = (
        <OrchestrationBadge
            globalExpect={globalExpect}
            orchestrationId={orchestrationId || null}
            onLogs={onOrchestrationLogs}
            onAbort={() => ask("abort")}
            disabled={running}
        />
    );

    // The status of all its instances refreshed; the cluster object has none of its own.
    const refreshTool = kind === "ccfg" ? null : <RefreshStatusButton path={path} nodes={Object.keys(instances ?? {}).sort()}/>;

    // The datastores and the volumes its instances use, a badge each, in the summary after the instances up.
    const resourcesOfInstances = Object.values(instances ?? {}).flatMap((i) => Object.values(i?.resources ?? {}));
    const datastores = datastoresOf(resourcesOfInstances);
    const volumes = volumesOf(resourcesOfInstances);
    const facts = [
        ...(datastores.length > 0 ? [{label: t("statusBoard.datastores"), value: <DatastoreLinks paths={datastores}/>}] : []),
        ...(volumes.length > 0 ? [{label: t("statusBoard.volumes"), value: <DatastoreLinks paths={volumes}/>}] : []),
    ];

    // The policies of the object over its status board, its actions at the right of the title of its panel.
    const policies = board.facts.length > 0 ? (
        <span className="flex flex-wrap gap-1" aria-label={t("statusBoard.policies")}>
            {board.facts.map((f) => <PolicyTag key={f.name} name={f.name} value={f.value}/>)}
        </span>
    ) : null;

    /**
     * The actions on the resources picked: the ones every one of them takes, each
     * node given the ones picked on it. A console opens on one resource of one node.
     */
    const resourceItems = (() => {
        if (cellsPicked.length === 0) return [];
        const rows = resourceRows.filter((r) => cellsPicked.some((c) => c.row === r));
        const nodes = allNodes.filter((n) => cellsPicked.some((c) => c.node === n));
        const targets = nodes.map((node) => ({
            node,
            rid: cellsPicked.filter((c) => c.node === node).map((c) => c.row.name).join(","),
        }));
        // Said by resource, with its nodes: all of them, or the ones picked.
        const nodesOf = (row) => cellsPicked.filter((c) => c.row === row).map((c) => c.node);
        const uniform = rows.every((r) => nodesOf(r).join() === nodesOf(rows[0]).join());
        const subject = uniform
            ? t("statusBoard.subjects.resource", {rid: rows.map((r) => r.name).join(", "), path, where: where(nodesOf(rows[0]))})
            : t("statusBoard.subjects.cells", {
                list: rows.map((r) => t("statusBoard.subjects.cell", {rid: r.name, where: where(nodesOf(r))})).join(", "),
                path,
            });
        return RESOURCE_ACTIONS
            .filter((a) => (a.name === "console" ? cellsPicked.length === 1 : true)
                && rows.every((r) => resourceActions(r.name).some((b) => b.name === a.name)))
            .map((a) => ({
                key: a.name,
                label: actionLabel(a.name),
                icon: actionIcon(a),
                onSelect: () => ask(a.name, {targets, subject, fromSelection: true}),
            }));
    })();
    const instanceItems = nodesPicked.length === 0
        ? []
        : menuItems(instanceActions(nodesPicked), (action) => ask(action, {...onInstances(nodesPicked), fromSelection: true}));
    // One kind picked at a time: its actions.
    const selectionItems = cellsPicked.length > 0 ? resourceItems : instanceItems;
    const picked = nodesPicked.length + cellsPicked.length;
    // Nothing selected, no action to offer: the help says how to select. Both on a
    // row as high as the buttons, so that the table does not move from one to the other.
    const toolbar = (
        <div className="flex min-h-7 flex-wrap items-center gap-3">
            {picked > 0 ? (
                <>
                    <MenuButton
                        // The actions: a solid pill.
                        prominent
                        icon={<BoltIcon className="h-3.5 w-3.5"/>}
                        label={cellsPicked.length > 0
                            ? t("statusBoard.actions.selectionResources", {count: resourcesPicked})
                            : t("statusBoard.actions.selectionInstances", {count: nodesPicked.length})}
                        disabled={running || selectionItems.length === 0}
                        items={selectionItems}
                    />
                    <Button size="sm" variant="secondary" icon={<CloseIcon/>} onClick={clearSelection}>
                        {t("statusBoard.actions.clearSelection")}
                    </Button>
                </>
            ) : (
                <p className="text-ink-muted">{t("statusBoard.actions.selectionHelp")}</p>
            )}
        </div>
    );

    return (
        <div className="space-y-3">
            {inHeader ? (
                <>
                    <div className="flex items-start justify-between gap-2">
                        {policies ?? <span/>}
                        {refreshTool}
                    </div>
                    {createPortal(<>{orchestrationBadge}{objectMenu}</>, header.actions)}
                </>
            ) : (
                <div className="flex items-center justify-between gap-2">{policies}<span className="flex items-center gap-2">{refreshTool}{orchestrationBadge}{objectMenu}</span></div>
            )}
            <StatusBoard
                board={board}
                selection={selection}
                toolbar={toolbar}
                linkNode={linkNode}
                linkResource={linkResource}
                openCell={openCell}
                facts={facts}
            />
            <ActionDialogManager
                pendingAction={pending}
                handleConfirm={run}
                target={pending?.subject ?? ""}
                instances={(pending?.targets?.length ?? 0) > 0}
                supportedActions={SUPPORTED_ACTIONS}
                onClose={() => setPending(null)}
            />
            <ConsoleTerminal open={consoleTarget !== null} target={consoleTarget} onClose={() => setConsoleTarget(null)}/>
        </div>
    );
};

export default ObjectStatus;
