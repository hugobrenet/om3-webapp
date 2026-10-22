import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {RecordPanel} from "../app/RecordPanel";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import ObjectDetail from "./ObjectDetails";
import ObjectStatus from "./ObjectStatus";
import ObjectConfig from "./ObjectConfig";
import {ObjectSchedules} from "./ObjectTabs";
import NetworkDetails from "./NetworkDetails";
import {NamespaceConfig, NamespaceUsage} from "./NamespacePanel";
import {NamespaceClaims} from "./NamespaceClaims";
import {ObjectUsage} from "./InstanceRecord";
import {CAPACITY_KINDS, ObjectCapacity} from "./ObjectCapacity";
import {InstanceLink, ResourceLink} from "./RecordLinks";
import {CrossLink} from "../app/CrossLink";
import {usePeek} from "../app/panel-search";
import {resourceId} from "../app/peek";
import {NAMESPACE_LISTS, NamespaceObjects, useNamespaceObjectTabs} from "./NamespaceObjects";
import {ObjectLogs} from "./ObjectLogs";
import {EventLog, OBJECT_EVENT_TYPES} from "./EventLogger";
import {createPortal} from "react-dom";
import {usePanelHeader} from "../app/panel-header";
import {MenuButton} from "../ui/components/MenuButton";
import {BoltIcon, TrashIcon} from "../ui/icons";
import {actionIcon, useActionRunner} from "./InstanceActions";
import {useGrants} from "../hooks/useGrants";
import {canWriteClaims} from "../app/namespace-claims";
import {actionLabel} from "../constants/actions";
import {KEY_KINDS} from "../constants/actions";

/*
 * The record panels, one per kind of record (`peek.ts`), as oc3 gives each object its
 * detail panel. A view opens the panel of its own rows (`sel` in the URL); any view
 * opens any of them over itself (`peek`, see `PeekPanel`). Each takes the id of its
 * record (undefined: closed), the tab open and what changes it, and what closes it.
 */

/**
 * An object. A service or a volume shows its status as `om <path> status` does, with
 * its actions (ObjectStatus), then its usage summed over its instances and node by
 * node (ObjectUsage), then the tasks scheduled for it on each node (ObjectTabs), then
 * the logs of its instances merged over their nodes (ObjectLogs), then its
 * configuration (ObjectConfig). What its
 * resources report is in the panels of its instances and of its resources.
 * A configuration, a secret or a user, which om shows no status of, shows its keys
 * (ObjectDetail), then its logs and its configuration, as a service does. The
 * badge of an orchestration in progress opens the logs of that orchestration.
 */
export function ObjectDetailPanel({path, tab, onTabChange, onClose}) {
    const {t} = useTranslation();
    const open = path !== undefined;
    const {kind} = parseObjectPath(path ?? "");
    const keysOnly = KEY_KINDS.includes(kind);
    const instances = useEventStore((s) => (path === undefined ? undefined : s.objectInstanceStatus[path]));
    const nodes = useMemo(() => Object.keys(instances ?? {}).sort(), [instances]);
    // In the status board, the names of the nodes and the resources are badges: the
    // instance on a node, the node itself for the cluster object, whose instances
    // are the nodes; a resource, its panel.
    const linkNode = useCallback((node) => (kind === "ccfg"
        ? <CrossLink kind="node" id={node}>{node}</CrossLink>
        : <InstanceLink path={path} node={node}/>), [kind, path]);
    const linkResource = useCallback((rid) => <ResourceLink path={path} rid={rid}/>, [path]);
    // The value of a resource on a node, its cell: the resource on that instance alone.
    const peek = usePeek();
    const openCell = useCallback((rid, node) => peek("resource", resourceId(path, rid, node)), [peek, path]);
    const [logsOrchestration, setLogsOrchestration] = useState(null);
    useEffect(() => {
        setLogsOrchestration(null);
    }, [path]);
    const showOrchestrationLogs = (id) => {
        setLogsOrchestration(id);
        onTabChange("logs");
    };

    // An object deleted or purged, from the panel or anywhere else, leaves the
    // store: its panel closes. Only once it was seen there, for an object the store
    // does not hold yet to keep its panel.
    const known = useEventStore((s) => path !== undefined && s.objectStatus?.[path] !== undefined);
    const seen = useRef(false);
    useEffect(() => {
        seen.current = false;
    }, [path]);
    useEffect(() => {
        if (known) seen.current = true;
        else if (seen.current) {
            seen.current = false;
            onClose();
        }
    }, [known, onClose]);

    const tabs = keysOnly
        ? [
            {key: "keys", label: t("panel.tabs.keys")},
            {key: "config", label: t("panel.tabs.config")},
            {key: "logs", label: t("panel.tabs.logs")},
            {key: "events", label: t("panel.tabs.events")},
        ]
        : [
            {key: "status", label: t("panel.tabs.status")},
            {key: "usage", label: t("panel.tabs.usage")},
            // Its size and its caps: a service's and a volume's.
            ...(CAPACITY_KINDS.includes(kind) ? [{key: "capacity", label: t("panel.tabs.capacity")}] : []),
            {key: "schedules", label: t("panel.tabs.schedules")},
            {key: "config", label: t("panel.tabs.config")},
            {key: "logs", label: t("panel.tabs.logs")},
            {key: "events", label: t("panel.tabs.events")},
        ];

    return (
        <RecordPanel
            open={open}
            kind="object"
            recordId={path}
            title={path ?? ""}
            onClose={onClose}
            tabs={tabs}
            tab={tab}
            onTabChange={onTabChange}
            closeOnOutsideClick={false}
        >
            {(active) => (
                <>
                    {/* Kept mounted under the other tabs: its stream and its state hold. */}
                    <div hidden={active !== tabs[0].key}>
                        {keysOnly
                            ? <ObjectDetail key={path} path={path} embedded onOrchestrationLogs={showOrchestrationLogs}/>
                            : <ObjectStatus key={path} path={path} onOrchestrationLogs={showOrchestrationLogs}
                                            linkNode={linkNode} linkResource={linkResource} openCell={openCell}/>}
                    </div>
                    {active === "usage" && <ObjectUsage key={path} path={path}/>}
                    {active === "capacity" && <ObjectCapacity key={path} path={path} nodes={nodes}/>}
                    {active === "schedules" && <ObjectSchedules key={path} path={path}/>}
                    {active === "events" && (
                        <div className="h-[calc(100dvh-10rem)]">
                            <EventLog key={path} eventTypes={OBJECT_EVENT_TYPES} objectName={path} label={t("panel.tabs.events")}/>
                        </div>
                    )}
                    {active === "logs" && (
                        <ObjectLogs key={path} path={path} nodes={nodes}
                                    orchestration={logsOrchestration} onClearOrchestration={() => setLogsOrchestration(null)}/>
                    )}
                    {active === "config" && <ObjectConfig path={path}/>}
                </>
            )}
        </RecordPanel>
    );
}

/** A network: the addresses it hands out. */
export function NetworkDetailPanel({name, onClose}) {
    return (
        <RecordPanel open={name !== undefined} kind="network" recordId={name} title={name ?? ""} onClose={onClose} size="wide">
            {() => <NetworkDetails key={name} name={name} embedded/>}
        </RecordPanel>
    );
}

/**
 * The actions on a namespace, in the title bar of its panel: the delete of its
 * configuration, by those who may write it (root, a squatter), confirmed first. Its
 * objects stay: a namespace is no object to delete, its configuration is.
 */
function NamespaceActions({namespace}) {
    const {t} = useTranslation();
    const header = usePanelHeader();
    const path = namespace === "root" ? "/" : `${namespace}/`;
    const exists = useEventStore((s) => s.objectStatus?.[path] !== undefined);
    const mayWrite = canWriteClaims(useGrants());
    const {ask, running, dialogs} = useActionRunner(path);
    const menu = (
        <MenuButton
            solid
            text={t("statusBoard.actions.object")}
            icon={<BoltIcon className="h-3.5 w-3.5"/>}
            label={t("namespaces.panel.actions")}
            align="end"
            disabled={running}
            items={[{
                key: "delete",
                label: actionLabel("delete"),
                icon: actionIcon({icon: <TrashIcon className="h-4 w-4"/>, color: exists && mayWrite ? "red" : undefined}),
                disabled: !exists || !mayWrite,
                onSelect: () => ask("delete", {
                    targets: [{}],
                    subject: t("namespaces.panel.configOf", {namespace}),
                }),
            }]}
        />
    );
    return (
        <>
            {header.actions !== null && createPortal(menu, header.actions)}
            {dialogs}
        </>
    );
}

/**
 * A namespace: what it claims and its objects use, then its configuration object,
 * a tab each. The tab in the URL, as for the other records. Its actions in the title
 * bar (NamespaceActions).
 */
export function NamespaceDetailPanel({name, tab, onTabChange, onClose}) {
    const {t} = useTranslation();
    // Its objects by kind after its usage and claims, its configuration last.
    const kindTabs = useNamespaceObjectTabs(name);
    const tabs = [
        {key: "usage", label: t("namespaces.panel.tabs.usage")},
        {key: "claims", label: t("namespaces.panel.tabs.claims")},
        ...kindTabs,
        {key: "events", label: t("namespaces.panel.tabs.events")},
        {key: "config", label: t("namespaces.panel.tabs.config")},
    ];
    return (
        <RecordPanel
            open={name !== undefined}
            kind="namespace"
            recordId={name}
            title={name ?? ""}
            onClose={onClose}
            tabs={tabs}
            tab={tab}
            onTabChange={onTabChange}
            size="wide"
            closeOnOutsideClick={false}
        >
            {(active) => (
                <>
                <NamespaceActions key={`actions:${name}`} namespace={name}/>
                {active === "config"
                ? <NamespaceConfig key={name} namespace={name}/>
                : active === "events"
                    ? (
                        <div className="h-[calc(100dvh-10rem)]">
                            <EventLog key={name} eventTypes={OBJECT_EVENT_TYPES} namespace={name} label={t("namespaces.panel.tabs.events")}/>
                        </div>
                    )
                : active === "claims"
                    ? <NamespaceClaims key={name} namespace={name}/>
                    : NAMESPACE_LISTS.includes(active)
                        ? <NamespaceObjects key={`${name}:${active}`} namespace={name} list={active}/>
                        : <NamespaceUsage key={name} namespace={name}/>}
                </>
            )}
        </RecordPanel>
    );
}
