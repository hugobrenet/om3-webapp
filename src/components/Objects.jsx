import React, {useEffect, useState, useMemo, useCallback, useRef, useDeferredValue} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import useEventStore from "../hooks/useEventStore.js";
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus";
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
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow, toggleCheckbox} from "../ui/components/Table";
import {NotProvisionedMark as PMark, StoppedMark, RpoBreachedMark} from "../ui/components/StateMarks";
import {StatusMark} from "../ui/components/StatusMark";
import {isQuietDown} from "../ui/components/status";
import {FrozenMark} from "../ui/components/FrozenMark";
import {MenuButton} from "../ui/components/MenuButton";
import {Button, IconButton} from "../ui/components/Button";
import {cn} from "../ui/cn";
import {Checkbox, Input} from "../ui/components/Field";
import {useMediaQuery} from "../ui/lib/media";
import {BADGE, KeyCells, NotProvisionedMark, OrchestrateBadge, PropertyCells, SideText, StatusMarks, markState} from "./ObjectCells";
import {useGrants} from "../hooks/useGrants";
import {canWriteClaims} from "../app/namespace-claims";
import {Pager} from "../ui/components/Pager";
import {usePaging} from "../app/paging";
import {ALL_LIST, OBJECT_LISTS, OBJECTS_TABS, listOfKind} from "../utils/objectLists";
import {BoltIcon, ChevronDownIcon, FilterIcon, GearIcon, PlusIcon, SearchIcon} from "../ui/icons";

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
            <span title={t("objects.noInstanceStatus", {node})} data-node={node} className="inline-flex w-4 justify-center font-semibold text-state-down">
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
            <StatusMark state={markState(nodeData.avail)} label={nodeData.avail} muted={isQuietDown(nodeData.avail, objectAvail)}/>
            {isStopped && <StoppedMark stoppedAt={stoppedAt}/>}
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
            title={t("objects.openInstance", {node})}
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
    {key: "orchestrate", labelKey: "objects.columns.orchestrate", value: (status) => status?.orchestrate},
    {key: "topology", labelKey: "objects.columns.topology", value: (status) => status?.topology},
];

/**
 * The property columns of a narrow list: the orchestrate and the topology a badge by
 * the path there, the instances up out of the target in their place.
 */
const NARROW_PROPERTY_COLUMNS = [
    {key: "up", labelKey: "objects.columns.up", value: (status) => status?.up_instances_count},
];

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
 * A button of the line of a namespace, outlined, or of the accent fill when it
 * creates (`create`), low enough for the line to stay as high as the others: its icon and word, its icon alone when narrow; not a click of
 * the line.
 */
const RowButton = ({narrow, icon, text, label, onClick, create = false}) => {
    const click = (event) => {
        event.stopPropagation();
        onClick();
    };
    return narrow ? (
        <IconButton label={label} tone={create ? "create" : undefined} className="h-6 w-6" onClick={click} onKeyDown={stopPropagation}>{icon}</IconButton>
    ) : (
        <Button size="sm" variant={create ? "create" : "secondary"} className="h-6 font-normal" icon={icon} aria-label={label} title={label} onClick={click} onKeyDown={stopPropagation}>
            {text}
        </Button>
    );
};

const NamespaceRow = ({namespace, colSpan, selectedCount, total, onToggle, onOpen, mayConfigure, onCreate, narrow}) => {
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
            title={exists ? t("objects.openNamespaceConfig", {namespace}) : undefined}
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
                exists && "cursor-pointer hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)",
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
            {/* The name alone names the line; its buttons in the last cell, out of its name. */}
            <th scope="rowgroup" colSpan={colSpan - 1} className="px-2 py-1 text-left font-semibold text-ink">
                {narrow ? (
                    <span className="flex flex-col items-start gap-0.5">
                        <span className="flex h-4 items-center"><span className={cn(BADGE, "font-normal")}>{t("objects.badges.namespace")}</span></span>
                        {namespace}
                    </span>
                ) : namespace}
            </th>
            <td className="px-2 py-1">
                <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                    {(exists || mayConfigure) && (
                        <RowButton
                            narrow={narrow}
                            icon={<GearIcon/>}
                            text={t("objects.configure")}
                            label={t("objects.configureNamespace", {namespace})}
                            onClick={open}
                        />
                    )}
                    <RowButton
                        narrow={narrow}
                        create
                        icon={<PlusIcon/>}
                        text={t("objects.createIn")}
                        label={t("objects.createInNamespace", {namespace})}
                        onClick={() => onCreate(namespace)}
                    />
                </span>
            </td>
        </tr>
    );
};

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
                        </span>
                    )
                    : objectName}
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
            {/* A line before the instances: the columns past it are per node. */}
            {!namesOnly && isWideScreen &&
                allNodes.map((node, i) => (
                    <Cell key={node} className={i === 0 ? "whitespace-nowrap border-l border-line" : "whitespace-nowrap"}>
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

/**
 * A multi-valued filter of the toolbar: a popover of checkboxes, as oc3 does for its
 * column picker. The summary tells the filter and what it keeps; a click outside or
 * Escape closes the popover.
 */
const FilterPopover = ({label, options, selected, onToggle}) => {
    const {t} = useTranslation();
    const ref = useRef(null);

    useEffect(() => {
        const onPointerDown = (event) => {
            const details = ref.current;
            if (details?.open && !details.contains(event.target)) details.open = false;
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, []);

    const onKeyDown = (event) => {
        const details = ref.current;
        if (event.key !== "Escape" || !details?.open) return;
        event.preventDefault();
        event.stopPropagation();
        details.open = false;
        details.querySelector("summary")?.focus();
    };

    const labelOf = (value) => options.find((option) => option.value === value)?.text ?? value;
    const summary = selected.length === 0 ? t("common.all") : selected.map(labelOf).join(", ");

    return (
        <details ref={ref} className="relative" onKeyDown={onKeyDown}>
            <summary
                className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-(--radius-control) border border-line bg-surface px-2 whitespace-nowrap text-ink-muted hover:border-line-strong [&::-webkit-details-marker]:hidden">
                {label}
                <span className="max-w-40 truncate text-ink">{summary}</span>
                <ChevronDownIcon className="h-3.5 w-3.5"/>
            </summary>
            <div
                role="group"
                aria-label={label}
                className="absolute top-full left-0 z-30 mt-1 flex max-h-72 min-w-44 flex-col gap-1 overflow-auto rounded-(--radius-panel) border border-line bg-surface-raised p-2 shadow-lg"
            >
                {options.length === 0 && <span className="text-ink-muted">{t("common.none")}</span>}
                {options.map((option) => (
                    <Checkbox
                        key={option.value}
                        checked={selected.includes(option.value)}
                        onChange={() => onToggle(option.value)}
                        label={
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                {option.mark && <span aria-hidden="true" className="inline-flex">{option.mark}</span>}
                                {option.text}
                            </span>
                        }
                    />
                ))}
            </div>
        </details>
    );
};

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

    const {daemon} = useFetchDaemonStatus();
    const objectStatus = useEventStore(selectObjectStatus);
    const objectInstanceStatus = useEventStore(selectObjectInstanceStatus);
    const [selectedObjects, setSelectedObjects] = useState([]);
    // The actions on the selection: the Actions menu, its dialog, and the feedback strip.
    const clearSelection = useCallback(() => setSelectedObjects([]), []);
    const {items: bulkActions, feedback, dialog: actionDialog, notify} = useObjectBulkActions({selectedObjects, onDone: clearSelection});
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

    const [showFilters, setShowFilters] = useState(() => isWideScreen ? true : !isMobile);

    const deferredSearchQuery = useDeferredValue(searchQuery);
    const deferredSelectedGlobalStates = useDeferredValue(selectedGlobalStates);
    const deferredSelectedNamespaces = useDeferredValue(selectedNamespaces);
    const deferredSelectedKinds = useDeferredValue(selectedKinds);


    const filtersId = React.useId();

    const objects = useMemo(
        () => (Object.keys(objectStatus).length ? objectStatus : daemon?.cluster?.object || {}),
        [objectStatus, daemon]
    );

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

    // Always in the order of their paths, namespace by namespace: a line opens each
    // namespace (NamespaceRow). The root namespace's short paths ("cluster",
    // "svc/x") are kept together under it, in the order of the namespaces.
    const sortedObjectNames = useMemo(() => [...filteredObjectNames].sort((a, b) =>
        extractNamespace(a).localeCompare(extractNamespace(b)) || a.localeCompare(b)
    ), [filteredObjectNames]);

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

    // The rows of the page shown, as oc3 pages its lists.
    const paging = usePaging("objects", rowObjectNames.length);
    const {page: pageOf} = paging;
    const visibleObjectNames = useMemo(() => pageOf(rowObjectNames), [pageOf, rowObjectNames]);

    const handleSelectObject = useCallback((event, objectName) => {
        setSelectedObjects((prev) =>
            event.target.checked ? [...prev, objectName] : prev.filter((obj) => obj !== objectName)
        );
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

    const toggleShowFilters = useCallback(() => {
        setShowFilters(prev => !prev);
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

    // All, the rows of the page shown: not those of the other pages, nor the
    // configuration of a namespace its line stands for, unless that line is ticked.
    // Unticked, the rows of the page leave the selection, those of others stay.
    const handleSelectAll = useCallback((e) => {
        const {checked} = e.target;
        setSelectedObjects((prev) => (checked
            ? [...new Set([...prev, ...visibleObjectNames])]
            : prev.filter((name) => !visibleObjectNames.includes(name))));
    }, [visibleObjectNames]);
    const allSelected = visibleObjectNames.length > 0
        && visibleObjectNames.every((name) => selectedObjects.includes(name));

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

    // Narrow, the orchestrate is a badge by the path: no column for it.
    const propertyColumns = isMobile ? NARROW_PROPERTY_COLUMNS : PROPERTY_COLUMNS;
    const columnCount = namesOnly ? 4 : 3 + propertyColumns.length + (isWideScreen ? allNodes.length : 0);

    return (
        <div className="flex h-full flex-col gap-3 p-4">
            <div className="flex shrink-0 flex-wrap items-center gap-3">
                {isMobile && (
                    <Button
                        size="sm"
                        icon={<FilterIcon className="h-4 w-4"/>}
                        onClick={toggleShowFilters}
                        aria-label={showFilters ? t("objects.filters.hide") : t("objects.filters.show")}
                        aria-expanded={showFilters}
                        aria-controls={filtersId}
                    >
                        <span className="hidden sm:inline">{t("common.filters")}</span>
                        <ChevronDownIcon className={showFilters ? "h-4 w-4 rotate-180" : "h-4 w-4"}/>
                    </Button>
                )}
                {(!isMobile || showFilters) && (
                    <div id={filtersId} className="flex flex-wrap items-center gap-3">
                        {hasGlobalState && (
                            <FilterPopover
                                label={t("objects.filters.globalState")}
                                options={globalStateOptions}
                                selected={selectedGlobalStates}
                                onToggle={handleGlobalStateChange}
                            />
                        )}
                        {hasChoice(namespaces, selectedNamespaces) && (
                            <FilterPopover
                                label={t("objects.filters.namespace")}
                                options={namespaceOptions}
                                selected={selectedNamespaces}
                                onToggle={handleNamespaceChange}
                            />
                        )}
                        {hasKindFilter && hasChoice(kinds, selectedKinds) && (
                            <FilterPopover
                                label={t("objects.filters.kind")}
                                options={kindOptions}
                                selected={selectedKinds}
                                onToggle={handleKindChange}
                            />
                        )}
                        <label className="flex items-center gap-1 text-ink-muted">
                            {t("common.name")}
                            <span className="relative flex items-center">
                                <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5"/>
                                <Input
                                    type="search"
                                    className="h-7 w-48 pl-7"
                                    value={searchQuery}
                                    onChange={handleSearchChange}
                                />
                            </span>
                        </label>
                    </div>
                )}
                <div className="ml-auto flex items-center gap-3">
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
                            <MenuButton
                                // The actions: a solid pill.
                                prominent
                                icon={<BoltIcon className="h-3.5 w-3.5"/>}
                                label={t("objects.actionsMenu")}
                                align="end"
                                items={bulkActions}
                            />
                        </>
                    ) : (
                        <span className="whitespace-nowrap text-ink-muted">{t("objects.selectHint")}</span>
                    )}
                </div>
            </div>

            {feedback}

            <Pager paging={paging}/>

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
                        {/* Fixed titles: the list is always in the order of the paths. */}
                        <HeaderCell>{t("objects.columns.object")}</HeaderCell>
                        {namesOnly && (
                            <>
                                <HeaderCell className="text-right">{t("objects.columns.keys")}</HeaderCell>
                                <HeaderCell className="text-right" title={t("objects.columns.keysSizeHint")}>{t("objects.columns.keysSize")}</HeaderCell>
                            </>
                        )}
                        {!namesOnly && propertyColumns.map(({key, labelKey}) => (
                            <HeaderCell key={key}>{t(labelKey)}</HeaderCell>
                        ))}
                        {!namesOnly && <HeaderCell>{t("common.status")}</HeaderCell>}
                        {!namesOnly && isWideScreen && allNodes.map((node, i) => (
                            <HeaderCell key={node} className={i === 0 ? "border-l border-line" : undefined}>{node}</HeaderCell>
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
                    {visibleObjectNames.length === 0 && (
                        <EmptyRow colSpan={columnCount}>
                            {t("objects.empty")}
                        </EmptyRow>
                    )}
                </tbody>
            </Table>

            {actionDialog}
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
    );
};

export default Objects;
