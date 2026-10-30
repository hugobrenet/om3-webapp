import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
import {CrossLink} from "../app/CrossLink";
import {StatusMark} from "../ui/components/StatusMark";
import {toObjectState} from "../ui/components/status";
import {InstanceLink} from "./RecordLinks";
import {useMenuState} from "../hooks/useSidebarAlerts";
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
import {ONE_RESOURCE_ACTIONS, INSTANCE_ACTIONS, OBJECT_ACTIONS, RESOURCE_ACTIONS, actionLabel, objectActionsFor} from "../constants/actions";
import {OrchestrationBadge, orchestrationOf} from "./OrchestrationBadge";
import {cn} from "../ui/cn";
import {PolicyTag} from "../ui/components/PolicyTag";
import {BADGE} from "./ObjectCells";
import ActionDialogManager from "./ActionDialogManager";
import ConsoleTerminal from "./ConsoleTerminal.jsx";
import ConsoleDisplay from "./ConsoleDisplay.jsx";
import {CLEAR_ACTION, noteFixAction, postAction, resourceActions, syncVariant} from "./objectActions";
import {DatastoreLinks, RefreshStatusButton, datastoresOf, volumesOf} from "./InstanceActions";
import logger from "../utils/logger.js";
import {actionDescription, explainedMenu} from "../app/action-menu";

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
/** The availability of a relation: of the instance a `path@node` names, else of the object. */
/**
 * The availability of a relation: of the instance a `path@node` names when the events
 * of its object come here, else of the object, as the menu keeps every object's.
 */
const relationAvail = (state, objects, relation) => {
    const [path, node] = relation.split("@");
    return (node === undefined ? undefined : state.objectInstanceStatus?.[path]?.[node]?.avail) ?? objects?.[path]?.avail ?? "";
};

/**
 * The children or the parents of an object, as its instances' configurations name
 * them: a badge each, the mark of its availability at its left, opening the object, or
 * the instance a `path@node` names. What an orchestration waits for, seen at once.
 */
function RelationLinks({relations}) {
    const {t} = useTranslation();
    // Every object's, the menu's live state; as a string, for the selector to give the same value while nothing changes.
    const objects = useMenuState((s) => s.objects);
    const avails = useEventStore((s) => relations.map((r) => relationAvail(s, objects, r)).join("\n")).split("\n");
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
            {relations.map((relation, i) => {
                const [path, node] = relation.split("@");
                // Its state in the badge, then its name: the relation as written, its node with it.
                const label = (
                    <span data-relation={relation} className="inline-flex items-center gap-1">
                        <StatusMark state={toObjectState(avails[i])} label={avails[i] || t("instance.unknown")}/>
                        {relation}
                    </span>
                );
                return node === undefined
                    ? <CrossLink key={relation} kind="object" id={path}>{label}</CrossLink>
                    : <InstanceLink key={relation} path={path} node={node} label={label}/>;
            })}
        </span>
    );
}

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
    const [displayTarget, setDisplayTarget] = useState(null);
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
        if (ONE_RESOURCE_ACTIONS.includes(action)) {
            const {namespace, kind, name} = parseObjectPath(path);
            const open = action === "console" ? setConsoleTarget : setDisplayTarget;
            open({node: targets[0].node, namespace, kind, name, rid: targets[0].rid});
            return;
        }
        // The actions on the cluster object are the cluster's, on all its nodes (actionUrl).
        const object = parseObjectPath(path).kind === "ccfg" ? t("statusBoard.subjects.cluster") : path;
        setPending({action, targets, subject: subject ?? object, fromSelection});
    }, [path, t]);

    const run = useCallback(async (_action, options) => {
        if (pending === null) return;
        const {action, fromSelection} = pending;
        setPending(null);
        setRunning(true);
        const targets = pending.targets.length === 0
            ? [{path, action, options}]
            : pending.targets.map(({node, rid}) => ({path, action, node, rid, options}));
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

    /** What an instance is: its monitor failed. */
    const instanceOf = (node) => {
        const index = allNodes.indexOf(node);
        return {
            // A failed monitor is cleared for the orchestration to try again, as its note says.
            failed: (board.rows.find((r) => r.kind === "monitor")?.cells[index] ?? []).some((s) => s.text.endsWith("failed")),
        };
    };
    /** The instance actions for these instances: clear where one failed. */
    const instanceActions = (nodes) => {
        // The cluster object's instances stand for their nodes: freezing or unfreezing them.
        if (kind === "ccfg") return INSTANCE_ACTIONS.filter((a) => a.name === "freeze" || a.name === "unfreeze");
        const l = nodes.map(instanceOf);
        // Freeze and unfreeze both, as on an object: either is harmless where it changes nothing.
        return [...(l.some((i) => i.failed) ? [CLEAR_ACTION] : []), ...INSTANCE_ACTIONS];
    };
    /**
     * The button of the action a note asks for, where the menus offer it
     * (`noteFixAction`), the cluster not frozen or unfrozen again. Confirmed first, as
     * from a menu.
     */
    const noteFix = ({action, nodes}) => {
        const def = noteFixAction(path, {action, nodes});
        if (def === undefined || (nodes.length === 0 && clusterIdle(action))) return null;
        return (
            <div className="pt-1">
                <Button
                    size="sm"
                    variant="secondary"
                    icon={actionIcon(def)}
                    disabled={running}
                    onClick={() => ask(action, nodes.length > 0 ? onInstances(nodes) : {})}
                >
                    {actionLabel(action)}
                </Button>
            </div>
        );
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
            {...explainedMenu(t, "object", objectActionsFor(kind)
                .map((a) => ({
                    key: a.name,
                    label: actionLabel(a.name),
                    icon: actionIcon(a),
                    disabled: !isActionAllowedForSelection(a.name, [path]) || clusterIdle(a.name),
                    onSelect: () => ask(a.name),
                })))}
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
    // Its children and parents, as the configurations of its instances name them, once each.
    const relationsOf = (key) => [...new Set(Object.values(configs ?? {}).flatMap((c) => c?.[key] ?? []))].sort();
    const children = relationsOf("children");
    const parents = relationsOf("parents");
    const facts = [
        ...(datastores.length > 0 ? [{label: t("statusBoard.datastores"), value: <DatastoreLinks paths={datastores}/>}] : []),
        ...(volumes.length > 0 ? [{label: t("statusBoard.volumes"), value: <DatastoreLinks paths={volumes}/>}] : []),
        ...(children.length > 0 ? [{label: t("statusBoard.children"), value: <RelationLinks relations={children}/>}] : []),
        ...(parents.length > 0 ? [{label: t("statusBoard.parents"), value: <RelationLinks relations={parents}/>}] : []),
    ];

    // The policies of the object over its status board, in one badge as in the lists; its actions at the
    // right of the title of its panel.
    const policies = board.facts.length > 0 ? (
        <span className={cn(BADGE, "w-fit gap-1 whitespace-nowrap")} data-policies="" aria-label={t("statusBoard.policies")}>
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
        const typeOf = (r) => (r.typ ? `${r.name.split("#")[0]}.${r.typ}` : undefined);
        return RESOURCE_ACTIONS
            .filter((a) => (ONE_RESOURCE_ACTIONS.includes(a.name) ? cellsPicked.length === 1 : true)
                && rows.every((r) => resourceActions(r.name, typeOf(r)).some((b) => b.name === a.name)))
            .map((a) => {
                const variant = syncVariant(a.name, rows.map(typeOf).filter(Boolean));
                return {
                    key: a.name,
                    label: actionLabel(a.name),
                    icon: actionIcon(a),
                    description: actionDescription(t, "resource", a.name, variant),
                    onSelect: () => ask(a.name, {targets, subject, fromSelection: true, variant}),
                };
            });
    })();
    const instanceItems = nodesPicked.length === 0
        ? []
        : menuItems(instanceActions(nodesPicked), (action) => ask(action, {...onInstances(nodesPicked), fromSelection: true}));
    // One kind picked at a time: its actions.
    const selectionMenu = cellsPicked.length > 0
        ? explainedMenu(t, "resource", resourceItems)
        : explainedMenu(t, "instance", instanceItems);
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
                        disabled={running || selectionMenu.items.length === 0}
                        {...selectionMenu}
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
                noteFix={noteFix}
            />
            <ActionDialogManager
                pendingAction={pending}
                handleConfirm={run}
                target={pending?.subject ?? ""}
                instances={(pending?.targets?.length ?? 0) > 0}
                supportedActions={SUPPORTED_ACTIONS}
                nodes={allNodes}
                onClose={() => setPending(null)}
            />
            <ConsoleTerminal open={consoleTarget !== null} target={consoleTarget} onClose={() => setConsoleTarget(null)}/>
            <ConsoleDisplay open={displayTarget !== null} target={displayTarget} onClose={() => setDisplayTarget(null)}/>
        </div>
    );
};

export default ObjectStatus;
