import React, {createContext, useContext, useEffect, useState, useMemo, useCallback, useRef, useDeferredValue} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {usePanelSearch, usePeek} from "../app/panel-search";
import {instanceId} from "../app/peek";
import {ObjectDetailPanel} from "./RecordPanels";
import {extractNamespace} from "../utils/objectUtils";
import {useTranslation} from "react-i18next";
import {useObjectBulkActions} from "./useObjectBulkActions";
import CreateObjectDialog from "./CreateObjectDialog";
import {useObjectData} from "../hooks/useObjectData";
import {useNodeData} from "../hooks/useNodeData";
import {useClusterNodeOrder} from "../hooks/useClusterNodeOrder";
import {Table, HeaderRow, HeaderCell, SortHeaderCell, Row, Cell, EmptyRow, toggleCheckbox, LIST_RAIL_QUERY} from "../ui/components/Table";
import {NotProvisionedMark as PMark, StoppedMark, RpoBreachedMark} from "../ui/components/StateMarks";
import {StatusMark} from "../ui/components/StatusMark";
import {isQuietDown} from "../ui/components/status";
import {FrozenMark} from "../ui/components/FrozenMark";
import {MenuButton} from "../ui/components/MenuButton";
import {Button, IconButton} from "../ui/components/Button";
import {cn} from "../ui/cn";
import {Checkbox} from "../ui/components/Field";
import {useMediaQuery} from "../ui/lib/media";
import {objectFacets} from "../app/object-facets";
import {FilterRail, FilterToolbar} from "./FilterRail";
import {BADGE, KeyCells, NotProvisionedMark, OrchestrateBadge, PropertyCells, SideText, StatusMarks, markState} from "./ObjectCells";
import {useGrants} from "../hooks/useGrants";
import {canWriteClaims} from "../app/namespace-claims";
import {MoreRows, useRowsOnDemand} from "../ui/components/RowsOnDemand";
import {ALL_LIST, OBJECT_LISTS, OBJECTS_TABS, listOfKind} from "../utils/objectLists";
import {AlertTriangleIcon, BoltIcon, CheckIcon, GearIcon, InfoIcon, PlusIcon} from "../ui/icons";
import {cachedReason, needsReason} from "../app/object-reason";
import {childrenDown} from "../app/statusboard";
import {menuColumns, menuFilter} from "../app/action-menu";
import {Term} from "../app/Term";
import {SymbolLegend} from "../app/StatusBoard";
import {Dialog} from "../ui/components/Dialog";
import ActionDialogManager from "./ActionDialogManager";
import {CLEAR_ACTION, noteFixAction, postAction} from "./objectActions";
import {INSTANCE_ACTIONS, OBJECT_ACTIONS, actionLabel} from "../constants/actions";
import {rangeSelect, withShift} from "../app/range-select";

// The breakpoints of the MUI theme the view used: below md (900px) the filters fold
// behind a button, from lg (1200px) the node columns are shown.
const MOBILE_QUERY = "(max-width:899.95px)";
const WIDE_QUERY = "(min-width:1200px)";

/** The zero timestamp of the API reads as "not set". */
const ZERO_TIME = "0001-01-01T00:00:00Z";
const hasTimestamp = (value) => !!value && value !== ZERO_TIME;

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const parseObjectName = (objectName) => {
    // A namespace configuration, as om3 writes it: "<namespace>/", "/" for the root one.
    if (objectName.endsWith("/")) {
        return {namespace: objectName === "/" ? "root" : objectName.slice(0, -1), kind: "nscfg", name: "namespace"};
    }
    const parts = objectName.split("/");
    if (parts.length === 3) {
        return {namespace: parts[0], kind: parts[1], name: parts[2]};
    } else if (parts.length === 2) {
        return {namespace: "root", kind: parts[0], name: parts[1]};
    }
    return {
        namespace: "root",
        kind: objectName === "cluster" ? "ccfg" : "svc",
        name: parts[0],
    };
};

/** The tab an object is listed in (objectLists). */
const listOf = (objectName) => listOfKind(parseObjectName(objectName).kind);
/** The kind a new object takes by default, from the tab it is created from. */
const LIST_KIND = {services: "svc", volumes: "vol", configs: "cfg", secrets: "sec", users: "usr", [ALL_LIST]: "svc"};
/**
 * The lists of objects held on all the nodes, with no status nor placement: their
 * names and their keys only (how many, how big), the status, orchestrate, topology
 * and node columns telling nothing, and no global state filter.
 */
const NAMES_ONLY_LISTS = ["configs", "secrets", "users"];

const selectObjectStatus = (state) => state.objectStatus;
const selectObjectInstanceStatus = (state) => state.objectInstanceStatus;

/** The kinds of the objects that run, an instance on each of their nodes. */
const ACTOR_KINDS = ["svc", "vol"];

const NodeStatus = React.memo(({objectName, node}) => {
    const {t} = useTranslation();
    const nodeData = useNodeData(objectName, node);
    // Stopped and RPO breached come straight from the instance status: one string each.
    const stoppedAt = useEventStore((s) => s.objectInstanceStatus?.[objectName]?.[node]?.stopped_at);
    const rpoBreachedAt = useEventStore((s) => s.objectInstanceStatus?.[objectName]?.[node]?.rpo_breached_at);
    const objectAvail = useEventStore((s) => s.objectStatus?.[objectName]?.avail);
    // A vol down that nothing uses, its children down too: its downs gray.
    const isChildrenDown = useEventStore((s) => childrenDown(
        objectName,
        s.objectStatus?.[objectName]?.avail,
        Object.keys(s.objectInstanceStatus?.[objectName] ?? {}).map((n) => s.instanceMonitor?.[`${n}:${objectName}`]),
    ));
    // A node of the object that tells nothing of its instance, gone or not heard
    // from: a "?" in its place, as om mon draws it.
    const expected = useEventStore((s) => Boolean(
        s.objectStatus?.[objectName]?.scope?.includes(node) || s.instanceConfig?.[objectName]?.[node]
    ));
    const peek = usePeek();
    const hasData = Boolean(nodeData?.avail);
    if (!hasData) {
        if (!expected) return null;
        return (
            <span data-node={node} className="inline-flex w-4 justify-center font-semibold text-state-down">
                <span aria-hidden="true">?</span>
                <span className="sr-only">{t("objects.noInstanceStatus", {node})}</span>
            </span>
        );
    }
    const isNodeNotProvisioned = nodeData.provisioned === "false" || nodeData.provisioned === false;
    const isStopped = hasTimestamp(stoppedAt);
    const isLagging = hasTimestamp(rpoBreachedAt);

    const marks = (
        <span className="inline-flex items-center gap-1.5" data-node={node}>
            <StatusMark state={markState(nodeData.avail)} label={nodeData.avail} muted={isQuietDown(nodeData.avail, objectAvail, isChildrenDown)}/>
            {isStopped && <StoppedMark/>}
            {/* A breached RPO takes the place of the frozen mark, as in the other views. */}
            {isLagging ? <RpoBreachedMark/> : <FrozenMark frozen={nodeData.frozen === "frozen"}/>}
            {isNodeNotProvisioned && <NotProvisionedMark/>}
            {nodeData.state && <SideText>{nodeData.state}</SideText>}
        </span>
    );
    // The instance of a service or a volume opens its own panel, not the object's.
    if (!ACTOR_KINDS.includes(parseObjectName(objectName).kind)) return marks;
    return (
        <button
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                peek("instance", instanceId(objectName, node));
            }}
            aria-label={t("objects.openInstanceOf", {node, name: objectName})}
            className="inline-flex rounded-(--radius-control) hover:underline focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
        >
            {marks}
        </button>
    );
}, (prev, next) => prev.objectName === next.objectName && prev.node === next.node);

/**
 * The columns of the object properties, read from its status: how the daemon
 * orchestrates it and how its instances are laid out. Objects without instances
 * to place (cfg, sec, usr) have no orchestrate nor topology.
 */
export const PROPERTY_COLUMNS = [
    {key: "orchestrate", labelKey: "objects.columns.orchestrate", term: "orchestrate", value: (status) => status?.orchestrate},
    {key: "topology", labelKey: "objects.columns.topology", term: "topology", value: (status) => status?.topology},
];

/**
 * The property columns of a narrow list: the orchestrate and the topology a badge by
 * the path there, the instances up out of the target in their place.
 */
const NARROW_PROPERTY_COLUMNS = [
    {key: "up", labelKey: "objects.columns.up", value: (status) => status?.up_instances_count},
];

/** The availabilities in the order a sort puts them, those worth a look first; another, or none, last. */
const AVAIL_RANK = {down: 0, warn: 1, up: 2, "n/a": 3};
const availRank = (avail) => AVAIL_RANK[avail] ?? 4;

/** The value of an object a column sorts by, undefined when it has none: an instance's by `node:<name>`. */
function sortValue(column, name, status, instances) {
    if (column.startsWith("node:")) {
        const instance = instances?.[name]?.[column.slice(5)];
        return instance === undefined ? undefined : availRank(instance.avail);
    }
    if (column === "status") return status?.[name] === undefined ? undefined : availRank(status[name].avail);
    const property = [...PROPERTY_COLUMNS, ...NARROW_PROPERTY_COLUMNS].find((c) => c.key === column);
    const value = property?.value(status?.[name]);
    return value === "" || value === null ? undefined : value;
}

/**
 * The order of two objects by the value of `column` alone, `direction` "asc" or
 * "desc": a property, the status or an instance's on a node, the worst first
 * ascending. An object without a value last, either way; the same value, 0.
 */
function compareValues(a, b, column, direction, status, instances) {
    const va = sortValue(column, a, status, instances);
    const vb = sortValue(column, b, status, instances);
    if (va === undefined || vb === undefined) return va === vb ? 0 : va === undefined ? 1 : -1;
    const order = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return direction === "asc" ? order : -order;
}

/**
 * The objects namespace by namespace, in the order of `column`: by the object, the
 * namespaces by name, either way, the objects of each by path; by another column,
 * the objects of each namespace by it, then by path, and each namespace by the
 * object of it that column puts first, the worst status first ascending say, one
 * without a value last; then by name. The root namespace's short paths ("cluster",
 * "svc/x") kept together under it.
 */
export function orderObjects(names, column, direction, status, instances) {
    const byNamespace = new Map();
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
        const ns = extractNamespace(name);
        if (!byNamespace.has(ns)) byNamespace.set(ns, []);
        byNamespace.get(ns).push(name);
    }
    if (column !== "object") {
        // Sorted by path already: the order of the column, a path breaking a tie (a stable sort).
        for (const members of byNamespace.values()) members.sort((a, b) => compareValues(a, b, column, direction, status, instances));
    }
    const namespaces = [...byNamespace.keys()].sort((x, y) => {
        if (column === "object") return direction === "asc" ? x.localeCompare(y) : y.localeCompare(x);
        // Its objects sorted, the first of each namespace the one the column puts first.
        return compareValues(byNamespace.get(x)[0], byNamespace.get(y)[0], column, direction, status, instances)
            || x.localeCompare(y);
    });
    return namespaces.flatMap((ns) => byNamespace.get(ns));
}

const stopPropagation = (e) => e.stopPropagation();

/** The path of the configuration of a namespace, as om3 writes it: "<namespace>/", "/" for the root one. */
const nscfgPath = (namespace) => (namespace === "root" ? "/" : `${namespace}/`);
const isNscfg = (objectName) => parseObjectName(objectName).kind === "nscfg";

/**
 * The line opening the objects of a namespace in the list: its name across the
 * row, and a checkbox selecting all its objects the filters keep, on every page;
 * mixed when some of them only are selected. It stands for the configuration of the
 * namespace, which has no line of its own: a click opens it. Configure opens it too,
 * offered with none yet to those who may write it (root, a squatter), created by
 * its first change; Create, the wizard of a new object, in the namespace. Narrow, a
 * small badge over the name, for the line to be as high as the others, the buttons
 * their icons alone.
 */
/**
 * A button of the line of a namespace, its icon alone at the size of a table row,
 * outlined, or of the accent fill when it creates (`create`): the line a separator,
 * its buttons not drawing the eye from the objects. Not a click of the line.
 */
const RowButton = ({icon, label, onClick, create = false}) => {
    const click = (event) => {
        event.stopPropagation();
        onClick();
    };
    return <IconButton size="sm" label={label} tone={create ? "create" : undefined} onClick={click} onKeyDown={stopPropagation}>{icon}</IconButton>;
};

/*
 * The instances of the objects, a column a node, set apart as a table of their own
 * after the status they detail: a gap before them the ground of the table, its row
 * lines hidden, whatever row is selected or hovered; then the nodes, a tinted tile a
 * row, its corners rounded where the rows part, their titles the smaller. A collapsed
 * table rounds no cell: the tile is a layer under the content of the cells.
 */
const NODE_GAP = "w-3 min-w-3 p-0 border-b border-surface-raised bg-surface-raised";
const NODE_TINT = "relative isolate border-b border-b-surface-raised before:absolute before:inset-y-px before:inset-x-0 before:-z-10 before:bg-ink/[0.08]";
const nodeEdge = (i, count) => cn(
    i === 0 && "before:rounded-l-(--radius-control)",
    i === count - 1 && "before:rounded-r-(--radius-control)",
);

const NamespaceRow = ({namespace, colSpan, nodeCount = 0, selectedCount, total, onToggle, onOpen, mayConfigure, onCreate, narrow}) => {
    const {t} = useTranslation();
    const box = useRef(null);
    const exists = useEventStore((s) => s.objectStatus?.[nscfgPath(namespace)] !== undefined);
    const all = total > 0 && selectedCount === total;
    const some = selectedCount > 0 && !all;
    useEffect(() => {
        if (box.current) box.current.indeterminate = some;
    }, [some]);
    const open = () => onOpen(nscfgPath(namespace));
    return (
        <tr
            data-namespace-row={namespace}
            tabIndex={exists ? 0 : undefined}
            onClick={exists ? open : undefined}
            onKeyDown={exists ? (event) => {
                if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                // Space selects its objects, as the checkbox; Enter opens the configuration.
                if (event.key === " ") toggleCheckbox(event.currentTarget);
                else open();
            } : undefined}
            className={cn(
                "h-[1.875rem] border-b border-line bg-surface-sunken",
                // Hovered, a deeper grey of the band, its name underlined as what opens: still a band, not a row.
                exists && "group/band cursor-pointer hover:bg-band-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)",
            )}
        >
            <td className="w-8 px-2 py-1">
                <Checkbox
                    ref={box}
                    checked={all}
                    onChange={(e) => onToggle(namespace, e.target.checked)}
                    onClick={stopPropagation}
                    aria-label={t("objects.selectNamespace", {namespace})}
                />
            </td>
            {/* The name alone names the line, in the column of the names; its buttons in one cell across the
                columns after it, at its end: no column of the objects widened by them. */}
            <th scope="rowgroup" className="px-2 py-1 text-left font-semibold text-ink">
                {narrow ? (
                    <span className="flex flex-col items-start gap-0.5">
                        <span className="flex h-4 items-center"><span className={cn(BADGE, "font-normal")}>{t("objects.badges.namespace")}</span></span>
                        <span className="group-hover/band:underline">{namespace}</span>
                    </span>
                ) : <span className="group-hover/band:underline">{namespace}</span>}
            </th>
            <td colSpan={colSpan - 1 - (nodeCount > 0 ? nodeCount + 1 : 0)} className="px-2 py-1">
                <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                    {(exists || mayConfigure) && (
                        <RowButton
                            icon={<GearIcon/>}
                            label={t("objects.configureNamespace", {namespace})}
                            onClick={open}
                        />
                    )}
                    <RowButton
                        create
                        icon={<PlusIcon/>}
                        label={t("objects.createInNamespace", {namespace})}
                        onClick={() => onCreate(namespace)}
                    />
                </span>
            </td>
            {nodeCount > 0 && (
                <>
                    <td aria-hidden="true" className={NODE_GAP}/>
                    <td colSpan={nodeCount} className={cn(NODE_TINT, nodeEdge(0, 1))}/>
                </>
            )}
        </tr>
    );
};

/** The ink of a reason, by the level of its note. */
const REASON_INK = {error: "text-state-down", warn: "text-state-warn", info: "text-ink-muted"};

/**
 * Why an object is not up, from what the stream holds of it (`object-reason`): the
 * same reason while its object, its instances, their configurations and monitors
 * do not change. Up, or of no status, none.
 */
const selectReason = (objectName) => (s) => {
    const object = s.objectStatus?.[objectName];
    if (!needsReason(object)) return null;
    const instances = s.objectInstanceStatus?.[objectName];
    const configs = s.instanceConfig?.[objectName];
    const monitors = {};
    for (const node of new Set([...Object.keys(instances ?? {}), ...Object.keys(configs ?? {})])) {
        monitors[node] = s.instanceMonitor?.[`${node}:${objectName}`];
    }
    return cachedReason(objectName, {object, instances, monitors, configs});
};

/** Asks for the action a note asks for, on an object of the list (`useNoteFix`); none, no button. */
const NoteFixContext = createContext(null);

/** Every action the confirmation of a note's action may have to say. */
const FIX_ACTIONS = [...new Set([...OBJECT_ACTIONS, ...INSTANCE_ACTIONS, CLEAR_ACTION].map((a) => a.name))];

/**
 * The action a note asks for, run from the list as from the status board: confirmed
 * first, then posted, on the instances it names or on the object; what comes of it
 * the actions tray says. `ask(path, fix)`, and the dialog to render.
 */
function useNoteFix() {
    const {t} = useTranslation();
    const [pending, setPending] = useState(null);
    const ask = useCallback((path, {action, nodes}) => setPending({
        path,
        action,
        targets: nodes.map((node) => ({node})),
        subject: nodes.length > 0 ? t("statusBoard.subjects.instance", {path, where: nodes.join(", ")}) : path,
    }), [t]);
    const run = async (_action, options) => {
        if (pending === null) return;
        const {path, action, targets} = pending;
        setPending(null);
        const on = targets.length > 0 ? targets : [{}];
        await Promise.all(on.map(({node}) => postAction({path, action, node, options})));
    };
    const dialog = (
        <ActionDialogManager
            pendingAction={pending}
            handleConfirm={run}
            target={pending?.subject ?? ""}
            instances={(pending?.targets.length ?? 0) > 0}
            supportedActions={FIX_ACTIONS}
            onClose={() => setPending(null)}
        />
    );
    return {ask, dialog};
}

/** The icon of an action, at the size of the reason line. */
const FIX_ICON = "flex h-3 w-3 items-center justify-center [&>svg]:h-3! [&>svg]:w-3!";

/**
 * Under the name of an object not up, why, in a line: its first note, as its status
 * board says it, the others counted; the board in its panel.
 * The action the note asks for a button at its end, where the menus offer it.
 */
function ObjectReason({objectName}) {
    const {t} = useTranslation();
    const reason = useEventStore(useMemo(() => selectReason(objectName), [objectName]));
    const askFix = useContext(NoteFixContext);
    // Nothing to say: said optimal, for the rows to be as high as those with a reason.
    if (reason === null) {
        return (
            <span data-reason="optimal" className="flex items-center gap-1 text-[0.75rem] font-normal text-ink-muted">
                <CheckIcon aria-hidden="true" className="h-3 w-3 shrink-0"/>
                <span className="truncate">{t("objects.reason.optimal")}</span>
            </span>
        );
    }
    const fix = reason.fix !== undefined && askFix !== null && noteFixAction(objectName, reason.fix) !== undefined
        ? reason.fix
        : null;
    const Icon = reason.level === "info" ? InfoIcon : AlertTriangleIcon;
    const more = reason.more > 0 ? ` ${t("objects.reason.more", {count: reason.more})}` : "";
    return (
        <span
            data-reason={reason.level}
            // No wider than the room of the names on a phone: cut, not past the table.
            className="flex max-w-md min-w-0 items-center gap-1 text-[0.75rem] font-normal text-ink-muted max-md:max-w-[44vw]"
        >
            <Icon aria-hidden="true" className={cn("h-3 w-3 shrink-0", REASON_INK[reason.level])}/>
            <span className="truncate">{reason.text}</span>
            {more && <span className="shrink-0 tabular-nums">{more}</span>}
            {fix !== null && (
                <button
                    type="button"
                    // The row opens the panel: not this click.
                    onClick={(event) => {
                        event.stopPropagation();
                        askFix(objectName, fix);
                    }}
                    onKeyDown={stopPropagation}
                    aria-label={t("objects.reason.fix", {action: actionLabel(fix.action), name: objectName})}
                    className="ml-1 inline-flex h-5 shrink-0 items-center gap-1 rounded-(--radius-control) border border-line bg-surface-raised px-1.5 text-ink hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
                >
                    <span aria-hidden="true" className={FIX_ICON}>{noteFixAction(objectName, fix).icon}</span>
                    {actionLabel(fix.action)}
                </button>
            )}
        </span>
    );
}

const TableRowComponent = React.memo(({
                                          objectName,
                                          isSelected,
                                          isOpen = false,
                                          onSelectObject,
                                          onObjectClick,
                                          allNodes,
                                          isWideScreen,
                                          isNarrow = false,
                                          namesOnly = false,
                                      }) => {
    const {t} = useTranslation();
    const objectData = useObjectData(objectName);
    const isDegraded = useEventStore((s) => s.objectStatus?.[objectName]?.overall === "warn");
    const handleCheckboxChange = useCallback((e) => {
        onSelectObject(e, objectName);
    }, [onSelectObject, objectName]);
    const handleRowClick = useCallback(() => {
        onObjectClick(objectName);
    }, [onObjectClick, objectName]);

    return (
        <Row onActivate={handleRowClick} selected={isOpen} className={isSelected ? "bg-accent-soft" : undefined}>
            <Cell className="w-8">
                <Checkbox
                    checked={isSelected}
                    onChange={handleCheckboxChange}
                    onClick={stopPropagation}
                    aria-label={t("objects.selectObject", {name: objectName})}
                />
            </Cell>
            <Cell className="text-data font-medium whitespace-nowrap">
                {isNarrow && !namesOnly
                    ? (
                        // Narrow, the badge on a line of its own over the path, kept empty
                        // when there is none, for the rows to be as high as one another.
                        <span className="flex flex-col items-start gap-0.5">
                            <span className="flex h-4 items-center" data-badge-line="">
                                <OrchestrateBadge objectName={objectName}/>
                            </span>
                            {objectName}
                            {/* Not up, why, under its name. */}
                            <ObjectReason objectName={objectName}/>
                        </span>
                    )
                    : namesOnly ? objectName : (
                        <span className="flex flex-col items-start">
                            {objectName}
                            <ObjectReason objectName={objectName}/>
                        </span>
                    )}
            </Cell>
            {namesOnly && <KeyCells objectName={objectName}/>}
            {!namesOnly && <PropertyCells objectName={objectName} narrow={isNarrow}/>}
            {!namesOnly && (
                <Cell className="whitespace-nowrap">
                    <StatusMarks
                        avail={objectData.avail}
                        isDegraded={isDegraded}
                        isNotProvisioned={objectData.isNotProvisioned}
                        frozen={objectData.frozen}
                        globalExpect={objectData.globalExpect}
                    />
                </Cell>
            )}
            {/* The instances, a table of their own after the status they detail. */}
            {!namesOnly && isWideScreen && allNodes.length > 0 && <td aria-hidden="true" className={NODE_GAP}/>}
            {!namesOnly && isWideScreen &&
                allNodes.map((node, i) => (
                    <Cell key={node} data-node-cell={node} className={cn("whitespace-nowrap", NODE_TINT, nodeEdge(i, allNodes.length))}>
                        <NodeStatus objectName={objectName} node={node}/>
                    </Cell>
                ))}
        </Row>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.objectName === nextProps.objectName &&
        prevProps.isSelected === nextProps.isSelected &&
        prevProps.isOpen === nextProps.isOpen &&
        prevProps.isWideScreen === nextProps.isWideScreen &&
        prevProps.isNarrow === nextProps.isNarrow &&
        prevProps.namesOnly === nextProps.namesOnly &&
        prevProps.allNodes.length === nextProps.allNodes.length &&
        prevProps.allNodes.every((node, i) => node === nextProps.allNodes[i])
    );
});

/** The values on offer, plus those chosen (from the URL) that the data does not hold. */
const withSelected = (values, selected) => [...values, ...selected.filter((value) => !values.includes(value))];

/**
 * A filter is worth showing with a choice to make: two values or more. With one,
 * every object of the tab has it; shown anyway while it holds a value no object of
 * the tab has, for that filter not to act unseen.
 */
const hasChoice = (values, selected) => values.length > 1 || selected.some((value) => !values.includes(value));

const GLOBAL_STATE_MARKS = {
    up: <StatusMark state="up"/>,
    down: <StatusMark state="down"/>,
    warn: <StatusMark state="warn"/>,
    "n/a": <StatusMark state="na"/>,
    unprovisioned: <PMark decorative/>,
};

const Objects = () => {
    const {t} = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    // The object whose panel is open, and its tab, in the URL as the filters are.
    const panel = usePanelSearch();
    const {select: selectObject} = panel;
    const isMounted = useRef(true);
    const queryParams = new URLSearchParams(location.search);
    const globalStates = useMemo(() => ["up", "down", "warn", "n/a", "unprovisioned"], []);

    // Parse multiple values from URL
    const parseMultipleValues = (param) => {
        const value = queryParams.get(param);
        if (!value || value === "all") return [];
        return value.split(',').filter(Boolean);
    };

    const rawGlobalStates = parseMultipleValues("globalState");
    const rawNamespaces = parseMultipleValues("namespace");
    const rawKinds = parseMultipleValues("kind");
    const rawSearchQuery = queryParams.get("name") || "";
    const list = OBJECTS_TABS.includes(queryParams.get("list")) ? queryParams.get("list") : OBJECT_LISTS[0];
    const namesOnly = NAMES_ONLY_LISTS.includes(list);
    // Their objects have no status: no global state to filter on. One the URL holds,
    // from another tab, is kept for it but filters nothing here.
    const hasGlobalState = !namesOnly;
    // A tab of a kind lists that kind: the kind filter is All's only. One the URL
    // holds, from All, is kept for it but filters nothing here.
    const hasKindFilter = list === ALL_LIST;

    const objectStatus = useEventStore(selectObjectStatus);
    const objectInstanceStatus = useEventStore(selectObjectInstanceStatus);
    const [selectedObjects, setSelectedObjects] = useState([]);
    // The actions on the selection: the Actions menu, its dialog, and the feedback strip.
    const clearSelection = useCallback(() => setSelectedObjects([]), []);
    const {items: bulkActions, feedback, dialog: actionDialog, notify} = useObjectBulkActions({selectedObjects, onDone: clearSelection});
    // The actions the reasons of the objects ask for, a button each.
    const noteFix = useNoteFix();
    const [selectedNamespaces, setSelectedNamespaces] = useState(rawNamespaces);
    const [selectedKinds, setSelectedKinds] = useState(rawKinds);
    const [selectedGlobalStates, setSelectedGlobalStates] = useState(rawGlobalStates);
    const [createOpen, setCreateOpen] = useState(false);
    // The namespace a new object is created in, from the line of a namespace; else that of the filter.
    const [createIn, setCreateIn] = useState(null);
    const createInNamespace = useCallback((namespace) => {
        setCreateIn(namespace);
        setCreateOpen(true);
    }, []);
    // The configuration of a namespace, none yet, offered to those who may write it.
    const mayWriteNscfg = canWriteClaims(useGrants());
    const [searchQuery, setSearchQuery] = useState(rawSearchQuery);
    const isWideScreen = useMediaQuery(WIDE_QUERY);
    const isMobile = useMediaQuery(MOBILE_QUERY);
    const hasRail = useMediaQuery(LIST_RAIL_QUERY);


    const deferredSearchQuery = useDeferredValue(searchQuery);
    const deferredSelectedGlobalStates = useDeferredValue(selectedGlobalStates);
    const deferredSelectedNamespaces = useDeferredValue(selectedNamespaces);
    const deferredSelectedKinds = useDeferredValue(selectedKinds);


    const objects = objectStatus;

    const allObjectNames = useMemo(
        () => Object.keys(objects).filter((key) => key && typeof objects[key] === "object"),
        [objects]
    );

    // The objects of the list shown, the one the menu opened.
    const listObjectNames = useMemo(
        () => (list === ALL_LIST ? allObjectNames : allObjectNames.filter((name) => listOf(name) === list)),
        [allObjectNames, list]
    );

    const {namespaces, kinds} = useMemo(() => {
        const nsSet = new Set();
        const kindSet = new Set();

        for (let i = 0; i < listObjectNames.length; i++) {
            const name = listObjectNames[i];
            nsSet.add(extractNamespace(name));
            kindSet.add(parseObjectName(name).kind);
        }

        return {
            namespaces: Array.from(nsSet).sort(),
            kinds: Array.from(kindSet).sort()
        };
    }, [listObjectNames]);

    // A new object may go in any namespace known, whatever the tab.
    const allNamespaces = useMemo(
        () => [...new Set(allObjectNames.map(extractNamespace))].sort(),
        [allObjectNames]
    );

    // The nodes of the cluster, in the order of its configuration as om mon shows
    // them: a node gone keeps its column. Then the nodes reporting an instance that
    // are not of it.
    const clusterNodes = useClusterNodeOrder();
    const allNodes = useMemo(() => {
        const nodeSet = new Set();
        const objNames = Object.keys(objectInstanceStatus);

        for (let i = 0; i < objNames.length; i++) {
            const nodes = Object.keys(objectInstanceStatus[objNames[i]] || {});
            for (let j = 0; j < nodes.length; j++) {
                nodeSet.add(nodes[j]);
            }
        }

        const known = clusterNodes ?? [];
        return [...known, ...Array.from(nodeSet).filter((node) => !known.includes(node)).sort()];
    }, [objectInstanceStatus, clusterNodes]);

    const filteredObjectNames = useMemo(() => {
        const result = [];
        const searchLower = deferredSearchQuery.toLowerCase();
        const hasSearch = searchLower.length > 0;

        for (let i = 0; i < listObjectNames.length; i++) {
            const name = listObjectNames[i];

            if (hasSearch && !name.toLowerCase().includes(searchLower)) {
                continue;
            }

            // Check namespace filter (multiple selection)
            if (deferredSelectedNamespaces.length > 0 && !deferredSelectedNamespaces.includes(extractNamespace(name))) {
                continue;
            }

            // Check kind filter (multiple selection), on All only
            if (hasKindFilter && deferredSelectedKinds.length > 0 && !deferredSelectedKinds.includes(parseObjectName(name).kind)) {
                continue;
            }

            // Check global state filter (multiple selection), on the lists that have one
            if (hasGlobalState && deferredSelectedGlobalStates.length > 0) {
                const status = objects[name];
                if (!status) continue;

                const rawAvail = status.avail;
                const validStatuses = ["up", "down", "warn"];
                const avail = validStatuses.includes(rawAvail) ? rawAvail : "n/a";
                const provisioned = status.provisioned;

                let matchesAnyGlobalState = false;
                for (let j = 0; j < deferredSelectedGlobalStates.length; j++) {
                    const selectedState = deferredSelectedGlobalStates[j];
                    if (selectedState === "unprovisioned") {
                        if (provisioned === "false" || provisioned === false) {
                            matchesAnyGlobalState = true;
                            break;
                        }
                    } else if (avail === selectedState) {
                        matchesAnyGlobalState = true;
                        break;
                    }
                }

                if (!matchesAnyGlobalState) continue;
            }

            result.push(name);
        }

        return result;
    }, [listObjectNames, hasGlobalState, deferredSelectedGlobalStates, deferredSelectedNamespaces,
        deferredSelectedKinds, hasKindFilter, deferredSearchQuery, objects]);

    // Sorted by a column, its title clicked, as the nodes are: the namespaces by name
    // first. A column gone, the window narrowed or another tab, by name again.
    const [sort, setSort] = useState({column: "object", direction: "asc"});
    const sortColumns = useMemo(() => ["object", ...(namesOnly ? [] : [
        ...(isMobile ? NARROW_PROPERTY_COLUMNS : PROPERTY_COLUMNS).map((c) => c.key),
        "status",
        ...(isWideScreen ? allNodes.map((node) => `node:${node}`) : []),
    ])], [namesOnly, isMobile, isWideScreen, allNodes]);
    const sortColumn = sortColumns.includes(sort.column) ? sort.column : "object";
    const sortDirection = sortColumn === sort.column ? sort.direction : "asc";
    const sortBy = useCallback((column) => setSort((prev) => (prev.column === column
        ? {column, direction: prev.direction === "asc" ? "desc" : "asc"}
        : {column, direction: "asc"})), []);

    // Namespace by namespace, a line opening each (NamespaceRow): the namespaces in
    // the order of the column sorted on, the objects of each by path (orderObjects).
    const sortedObjectNames = useMemo(
        () => orderObjects(filteredObjectNames, sortColumn, sortDirection, objects, objectInstanceStatus),
        [filteredObjectNames, sortColumn, sortDirection, objects, objectInstanceStatus],
    );

    // The objects of each namespace the filters keep: what its line selects.
    const namespaceObjects = useMemo(() => {
        const byNamespace = new Map();
        for (const name of sortedObjectNames) {
            const ns = extractNamespace(name);
            if (!byNamespace.has(ns)) byNamespace.set(ns, []);
            byNamespace.get(ns).push(name);
        }
        return byNamespace;
    }, [sortedObjectNames]);

    // The configuration of a namespace has no line of its own: the line of its
    // namespace stands for it. Alone in its namespace, it stays, for the namespace to
    // be listed, its line drawn alone.
    const rowObjectNames = useMemo(() => sortedObjectNames.filter((name) => !isNscfg(name)
        || (namespaceObjects.get(extractNamespace(name)) ?? []).every(isNscfg)), [sortedObjectNames, namespaceObjects]);

    // The rows drawn as the end of the table nears; the list or a filter changed, the first ones again.
    const drawn = useRowsOnDemand(rowObjectNames.length, [list, deferredSearchQuery, deferredSelectedNamespaces,
        deferredSelectedKinds, deferredSelectedGlobalStates, sortColumn, sortDirection]);
    const {rows: drawnOf} = drawn;
    const visibleObjectNames = useMemo(() => drawnOf(rowObjectNames), [drawnOf, rowObjectNames]);

    // A row ticked alone, or with Shift every row from the one ticked before, in the
    // order shown; the order read when ticked, the handler one for every row.
    const rowOrderRef = useRef(rowObjectNames);
    rowOrderRef.current = rowObjectNames;
    const anchorRef = useRef(null);
    const handleSelectObject = useCallback((event, objectName) => {
        const checked = event.target.checked;
        const shift = withShift(event);
        setSelectedObjects((prev) => {
            const next = rangeSelect(rowOrderRef.current, prev, anchorRef.current, objectName, checked, shift);
            anchorRef.current = next.anchor;
            return next.selected;
        });
    }, []);

    // A row is not rendered again for a new handler (TableRowComponent): one handler,
    // reading the latest URL, or a row opened after a filter changed would bring the
    // URL of before back, the filter dropped.
    const objectClickRef = useRef({objectInstanceStatus, selectObject, openPeek: panel.openPeek});
    objectClickRef.current = {objectInstanceStatus, selectObject, openPeek: panel.openPeek};
    const handleObjectClick = useCallback((objectName) => {
        const {objectInstanceStatus: instances, selectObject: select, openPeek} = objectClickRef.current;
        // A namespace configuration is edited in the panel of its namespace.
        const {kind, namespace} = parseObjectName(objectName);
        if (kind === "nscfg") openPeek({kind: "namespace", id: namespace}, "config");
        else if (instances[objectName]) select(objectName);
    }, []);

    const handleSelectNamespace = useCallback((namespace, checked) => {
        const members = namespaceObjects.get(namespace) ?? [];
        setSelectedObjects((prev) => (checked
            ? [...new Set([...prev, ...members])]
            : prev.filter((name) => !members.includes(name))));
    }, [namespaceObjects]);

    const handleSearchChange = useCallback((e) => {
        setSearchQuery(e.target.value);
    }, []);

    const handleGlobalStateChange = useCallback((state) => {
        setSelectedGlobalStates(prev => {
            if (prev.includes(state)) {
                return prev.filter(s => s !== state);
            } else {
                return [...prev, state];
            }
        });
    }, []);

    const handleNamespaceChange = useCallback((namespace) => {
        setSelectedNamespaces(prev => {
            if (prev.includes(namespace)) {
                return prev.filter(ns => ns !== namespace);
            } else {
                return [...prev, namespace];
            }
        });
    }, []);

    const clearGlobalStates = useCallback(() => setSelectedGlobalStates([]), []);
    const clearNamespaces = useCallback(() => setSelectedNamespaces([]), []);
    const clearKinds = useCallback(() => setSelectedKinds([]), []);

    const handleKindChange = useCallback((kind) => {
        setSelectedKinds(prev => {
            if (prev.includes(kind)) {
                return prev.filter(k => k !== kind);
            } else {
                return [...prev, kind];
            }
        });
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (!isMounted.current) return;
            const currentParams = new URLSearchParams(location.search);
            const currentGlobalStates = parseMultipleValues("globalState");
            const currentNamespaces = parseMultipleValues("namespace");
            const currentKinds = parseMultipleValues("kind");
            const currentName = currentParams.get("name") || "";

            const arraysEqual = (a, b) => {
                if (a.length !== b.length) return false;
                const sortedA = [...a].sort();
                const sortedB = [...b].sort();
                return sortedA.every((val, idx) => val === sortedB[idx]);
            };

            if (arraysEqual(currentGlobalStates, selectedGlobalStates) &&
                arraysEqual(currentNamespaces, selectedNamespaces) &&
                arraysEqual(currentKinds, selectedKinds) &&
                currentName === searchQuery) {
                return;
            }

            // The other parameters, the open panel's, stay as they are; the page goes,
            // the list filtered otherwise starting over from its first one.
            const newQueryParams = new URLSearchParams(location.search);
            ["globalState", "namespace", "kind", "name", "offset"].forEach((key) => newQueryParams.delete(key));
            if (selectedGlobalStates.length > 0) newQueryParams.set("globalState", selectedGlobalStates.join(','));
            if (selectedNamespaces.length > 0) newQueryParams.set("namespace", selectedNamespaces.join(','));
            if (selectedKinds.length > 0) newQueryParams.set("kind", selectedKinds.join(','));
            if (searchQuery.trim()) newQueryParams.set("name", searchQuery.trim());

            const queryString = newQueryParams.toString();
            const newUrl = `${location.pathname}${queryString ? `?${queryString}` : ""}`;
            if (newUrl !== location.pathname + location.search) {
                navigate(newUrl, {replace: true});
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [selectedGlobalStates, selectedNamespaces, selectedKinds, searchQuery, navigate, location.pathname, location.search]);

    useEffect(() => {
        setSelectedGlobalStates(rawGlobalStates);
        setSelectedNamespaces(rawNamespaces);
        setSelectedKinds(rawKinds);
        setSearchQuery(rawSearchQuery);
    }, [location.search]);

    const eventStarted = useRef(false);
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        let release = null;
        if (token && !eventStarted.current) {
            release = retainEventReception(token, [
                "ObjectStatusUpdated",
                "InstanceStatusUpdated",
                "ObjectDeleted",
                "InstanceMonitorUpdated",
                // A node dropped has its instances deleted: their marks give way to a "?".
                "InstanceConfigDeleted",
            ]);
            eventStarted.current = true;
        }
        return () => {
            release?.();
            eventStarted.current = false;
        };
    }, []);

    useEffect(() => {
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Another list, from the menu: the selection was the other list's. Its filters
    // follow its address, read again above.
    useEffect(() => {
        setSelectedObjects([]);
    }, [list]);

    // Created, the object opens in its panel, over the tab it is listed in. Its
    // creation and its provisioning, the actions tray says.
    const handleCreated = useCallback((path) => {
        setCreateOpen(false);
        // All lists it too: kept.
        const next = list === ALL_LIST ? ALL_LIST : listOf(path);
        const params = new URLSearchParams(location.search);
        if (next !== list) {
            setSelectedObjects([]);
            setSelectedKinds([]);
            params.delete("kind");
        }
        if (next === OBJECT_LISTS[0]) params.delete("list");
        else params.set("list", next);
        ["tab", "peek", "peektab"].forEach((key) => params.delete(key));
        params.set("sel", path);
        // A datastore, created empty: on its keys, to add them.
        const {kind} = parseObjectName(path);
        if (kind === "cfg" || kind === "sec") params.set("tab", "keys");
        navigate(`${location.pathname}?${params.toString()}`);
    }, [list, location.pathname, location.search, navigate]);

    // An object a filter hides, or gone, leaves the selection: an action on the
    // selection acts on none the list does not show.
    useEffect(() => {
        const shown = new Set(filteredObjectNames);
        setSelectedObjects((prev) => (prev.every((name) => shown.has(name))
            ? prev
            : prev.filter((name) => shown.has(name))));
    }, [filteredObjectNames]);

    // All, every object the filters keep, drawn yet or not: not the configuration of a
    // namespace its line stands for, unless that line is ticked. Unticked, none.
    const handleSelectAll = useCallback((e) => {
        setSelectedObjects(e.target.checked ? rowObjectNames : []);
    }, [rowObjectNames]);
    const allSelected = rowObjectNames.length > 0
        && rowObjectNames.every((name) => selectedObjects.includes(name));

    const globalStateOptions = useMemo(
        () => withSelected(globalStates, selectedGlobalStates).map((state) => ({
            value: state,
            // The availabilities are daemon values, shown as such; unprovisioned is a word of the view.
            text: state === "unprovisioned" ? t("objects.filters.unprovisioned") : capitalize(state),
            mark: GLOBAL_STATE_MARKS[state],
        })),
        [globalStates, selectedGlobalStates, t]
    );
    const namespaceOptions = useMemo(
        () => withSelected(namespaces, selectedNamespaces).map((namespace) => ({value: namespace, text: namespace})),
        [namespaces, selectedNamespaces]
    );
    const kindOptions = useMemo(
        () => withSelected(kinds, selectedKinds).map((kind) => ({value: kind, text: kind})),
        [kinds, selectedKinds]
    );

    // The filters beside the table, each value counted under the others.
    const facetCounts = useMemo(
        () => objectFacets(listObjectNames, {
            search: deferredSearchQuery,
            namespaces: deferredSelectedNamespaces,
            kinds: deferredSelectedKinds,
            globalStates: deferredSelectedGlobalStates,
        }, {
            objects,
            namespaceOf: extractNamespace,
            kindOf: (name) => parseObjectName(name).kind,
            useGlobalState: hasGlobalState,
            useKind: hasKindFilter,
        }),
        [listObjectNames, deferredSearchQuery, deferredSelectedNamespaces, deferredSelectedKinds,
            deferredSelectedGlobalStates, objects, hasGlobalState, hasKindFilter]
    );
    // The same facets in the rail and in the toolbar, each value counted under the others;
    // in the toolbar, a namespace or a kind with a choice to make only.
    const globalStateFacet = hasGlobalState && {label: t("objects.filters.globalState"), options: globalStateOptions,
        selected: selectedGlobalStates, counts: facetCounts.globalState, onToggle: handleGlobalStateChange, onClear: clearGlobalStates};
    const kindFacet = hasKindFilter && {label: t("objects.filters.kind"), options: kindOptions, selected: selectedKinds,
        counts: facetCounts.kind, onToggle: handleKindChange, onClear: clearKinds};
    const namespaceFacet = {label: t("objects.filters.namespace"), options: namespaceOptions, selected: selectedNamespaces,
        counts: facetCounts.namespace, onToggle: handleNamespaceChange, onClear: clearNamespaces};
    const railFacets = [globalStateFacet, kindFacet, namespaceFacet].filter(Boolean);
    const toolbarFacets = [
        globalStateFacet,
        hasChoice(namespaces, selectedNamespaces) && namespaceFacet,
        kindFacet && hasChoice(kinds, selectedKinds) && kindFacet,
    ].filter(Boolean);

    // What the marks of the objects and of their instances mean, the status board's
    // legend: none for a list of names only, with no marks.
    const [legendOpen, setLegendOpen] = useState(false);
    const legendButton = namesOnly ? null : (
        <Button size="sm" icon={<InfoIcon className="h-4 w-4"/>} onClick={() => setLegendOpen(true)}>
            {t("legend.title")}
        </Button>
    );

    const objectCount = <p className="text-ink-muted tabular-nums">{t("objects.count", {count: rowObjectNames.length})}</p>;

    // A new object, and the actions on the selection: over the table, or at the head of the rail.
    const listActions = (align) => (
        <>
            <Button size="sm" variant="create" icon={<PlusIcon className="h-4 w-4"/>} onClick={() => {
                setCreateIn(null);
                setCreateOpen(true);
            }}>
                {t("createObject.open")}
            </Button>
            {/* Nothing selected, nothing to act on: how to select, in the place of the actions. */}
            {selectedObjects.length > 0 ? (
                <>
                    <span className="whitespace-nowrap text-ink-muted">{t("common.selected", {count: selectedObjects.length})}</span>
                    <Button size="sm" onClick={clearSelection}>{t("objects.clearSelection")}</Button>
                    <MenuButton
                        // The actions: a solid pill.
                        prominent
                        icon={<BoltIcon className="h-3.5 w-3.5"/>}
                        label={t("objects.actionsMenu")}
                        align={align}
                        items={bulkActions}
                        columns={menuColumns(bulkActions)}
                        {...menuFilter(t, bulkActions)}
                    />
                </>
            ) : (
                <span className="text-ink-muted">{t("objects.selectHint")}</span>
            )}
        </>
    );

    // Narrow, the orchestrate is a badge by the path: no column for it.
    const propertyColumns = isMobile ? NARROW_PROPERTY_COLUMNS : PROPERTY_COLUMNS;
    // The nodes past a gap of their own: a column more.
    const nodeColumns = !namesOnly && isWideScreen ? allNodes.length : 0;
    const columnCount = namesOnly ? 4 : 3 + propertyColumns.length + (nodeColumns > 0 ? nodeColumns + 1 : 0);

    return (
        <NoteFixContext.Provider value={noteFix.ask}>
            <div className="flex h-full gap-6 p-4">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
                    {/* Wide, the actions and the pager at the head of the rail: their rows to the table. */}
                    {!hasRail && (
                        <div className="flex shrink-0 flex-wrap items-center gap-3">
                            {/* Wide, the filters stand beside the table, as facets. */}
                            <FilterToolbar
                                facets={toolbarFacets}
                                search={searchQuery}
                                onSearch={handleSearchChange}
                                searchLabel={t("common.name")}
                            />
                            <div className="ml-auto flex items-center gap-3">{legendButton}{listActions("end")}</div>
                        </div>
                    )}

                    {feedback}

                    {!hasRail && objectCount}

                    <Table
                        sticky
                        aria-label={t("objects.tableLabel")}
                        className="min-h-0 flex-1"
                    >
                        <thead>
                            <HeaderRow>
                                <HeaderCell className="w-8">
                                    <Checkbox
                                        checked={allSelected}
                                        onChange={handleSelectAll}
                                        aria-label={t("objects.selectAll")}
                                    />
                                </HeaderCell>
                                {/* Each title sorts the namespaces by its column, their objects kept by path;
                                    the keys, read for the rows shown only, do not. */}
                                <SortHeaderCell
                                    label={t("objects.columns.object")}
                                    active={sortColumn === "object"}
                                    direction={sortDirection}
                                    onSort={() => sortBy("object")}
                                />
                                {namesOnly && (
                                    <>
                                        <HeaderCell className="text-right">{t("objects.columns.keys")}</HeaderCell>
                                        <HeaderCell className="text-right">{t("objects.columns.keysSize")}</HeaderCell>
                                    </>
                                )}
                                {!namesOnly && propertyColumns.map(({key, labelKey, term}) => (
                                    <SortHeaderCell
                                        key={key}
                                        // In the button of the sort, the click is the sort's: the term said on hover alone.
                                        label={term ? <Term term={term} inert>{t(labelKey)}</Term> : t(labelKey)}
                                        active={sortColumn === key}
                                        direction={sortDirection}
                                        onSort={() => sortBy(key)}
                                    />
                                ))}
                                {!namesOnly && (
                                    <SortHeaderCell
                                        label={t("common.status")}
                                        active={sortColumn === "status"}
                                        direction={sortDirection}
                                        onSort={() => sortBy("status")}
                                    />
                                )}
                                {!namesOnly && isWideScreen && allNodes.length > 0 && <th aria-hidden="true" className={NODE_GAP}/>}
                                {!namesOnly && isWideScreen && allNodes.map((node, i) => (
                                    <SortHeaderCell
                                        key={node}
                                        className={cn("text-data text-ink-muted", NODE_TINT, nodeEdge(i, allNodes.length))}
                                        label={node}
                                        active={sortColumn === `node:${node}`}
                                        direction={sortDirection}
                                        onSort={() => sortBy(`node:${node}`)}
                                    />
                                ))}
                            </HeaderRow>
                        </thead>
                        <tbody>
                            {visibleObjectNames.map((objectName, i) => {
                                const ns = extractNamespace(objectName);
                                // A line opens each namespace, and the page, which may start inside one.
                                const opens = i === 0 || extractNamespace(visibleObjectNames[i - 1]) !== ns;
                                const members = namespaceObjects.get(ns) ?? [];
                                return (
                                    <React.Fragment key={objectName}>
                                        {opens && (
                                            <NamespaceRow
                                                namespace={ns}
                                                colSpan={columnCount - 1}
                                                nodeCount={nodeColumns}
                                                total={members.length}
                                                selectedCount={members.filter((name) => selectedObjects.includes(name)).length}
                                                onToggle={handleSelectNamespace}
                                                onOpen={handleObjectClick}
                                                mayConfigure={mayWriteNscfg}
                                                onCreate={createInNamespace}
                                                narrow={isMobile}
                                            />
                                        )}
                                        {/* A configuration alone in its namespace: its line, the namespace's, alone. */}
                                        {!isNscfg(objectName) && <TableRowComponent
                                            objectName={objectName}
                                            isSelected={selectedObjects.includes(objectName)}
                                            isOpen={panel.sel === objectName}
                                            onSelectObject={handleSelectObject}
                                            onObjectClick={handleObjectClick}
                                            allNodes={allNodes}
                                            isWideScreen={isWideScreen}
                                            isNarrow={isMobile}
                                            namesOnly={namesOnly}
                                        />}
                                    </React.Fragment>
                                );
                            })}
                            <MoreRows rows={drawn} colSpan={columnCount}/>
                            {visibleObjectNames.length === 0 && (
                                <EmptyRow colSpan={columnCount}>
                                    {t("objects.empty")}
                                </EmptyRow>
                            )}
                        </tbody>
                    </Table>
                </div>
                {hasRail && (
                    <FilterRail
                        head={(
                            <>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{listActions("start")}{legendButton}</div>
                                {objectCount}
                            </>
                        )}
                        label={t("objects.filters.rail")}
                        search={searchQuery}
                        onSearch={handleSearchChange}
                        searchLabel={t("common.name")}
                        facets={railFacets}
                    />
                )}

                {actionDialog}
                {noteFix.dialog}
                <Dialog open={legendOpen} title={t("legend.toggle")} size="lg" onClose={() => setLegendOpen(false)}>
                    <SymbolLegend/>
                </Dialog>
                <CreateObjectDialog
                    open={createOpen}
                    onClose={() => setCreateOpen(false)}
                    defaultKind={LIST_KIND[list]}
                    defaultNamespace={createIn ?? (selectedNamespaces.length === 1 ? selectedNamespaces[0] : "root")}
                    namespaces={allNamespaces}
                    paths={allObjectNames}
                    onCreated={handleCreated}
                />

                <ObjectDetailPanel
                    path={panel.sel}
                    tab={panel.tab}
                    onTabChange={panel.setTab}
                    onClose={() => selectObject(undefined)}
                />
            </div>
        </NoteFixContext.Provider>
    );
};

export default Objects;
