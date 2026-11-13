import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {parseInstanceId, parseResourceId} from "../app/peek";
import {objectUsage} from "../app/pg-usage";
import {objectUsageTree} from "../app/pg-tree";
import {namespaceOf} from "../app/namespace-usage";
import {UsageTreeTable} from "./ClusterUsage";
import {PG_POLL_MS, usePgReadings} from "../hooks/usePgUsage";
import {formatBytes} from "../utils/cgroupMetrics";
import {RecordPanel} from "../app/RecordPanel";
import {CrossLink} from "../app/CrossLink";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {Spinner} from "../ui/components/Spinner";
import {StatusMark} from "../ui/components/StatusMark";
import {FrozenMark} from "../ui/components/FrozenMark";
import {NotProvisionedMark} from "../ui/components/StateMarks";
import {toObjectState} from "../ui/components/status";
import {ReadErrors, TotalTile, cpuText} from "./NamespaceMetrics";
import {ObjectResources} from "./ObjectTabs";
import {ContainerLogs} from "./ContainerLogs";
import {ResourceConsole} from "./ResourceConsole";
import {isContainerResource, isRunning, mayOpenSession, sessionKinds} from "../app/resource-sessions";
import {InstanceLink, ResourceLink, ResourceSessionLinks} from "./RecordLinks";
import {ObjectLogs} from "./ObjectLogs";
import ObjectConfig from "./ObjectConfig";
import {DatastoreLinks, RefreshStatusButton, actionIcon, datastoresOf, useActionRunner, volumesOf} from "./InstanceActions";
import {CLEAR_ACTION, resourceActions, syncVariant} from "./objectActions";
import {usePanelHeader} from "../app/panel-header";
import {resourceNotes} from "../app/statusboard";
import {NotesList} from "../app/StatusBoard";
import {MenuButton} from "../ui/components/MenuButton";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {useGrants} from "../hooks/useGrants";
import {Checkbox} from "../ui/components/Field";
import {BoltIcon, CloseIcon} from "../ui/icons";
import {INSTANCE_ACTIONS, RESOURCE_ACTIONS, actionLabel} from "../constants/actions";
import {actionDescription, explainedMenu} from "../app/action-menu";
import {SymbolHelp} from "../app/SymbolHelp";
import {Term} from "../app/Term";

const ZERO_TIME = "0001-01-01T00:00:00Z";
const EMPTY = {};

/** The nodes an object has an instance on, in the order of their names. */
function useInstanceNodes(path) {
    const instances = useEventStore((s) => (path === undefined ? undefined : s.objectInstanceStatus?.[path]));
    return useMemo(() => Object.keys(instances ?? {}).sort(), [instances]);
}

/** Its cpu, memory and memory limit, a tile each. */
const UsageTiles = ({usage, label}) => {
    const {t} = useTranslation();
    return (
        <section aria-label={label}>
            <dl className="grid grid-cols-3 gap-3">
                <TotalTile label={t("metrics.columns.cpu")} value={cpuText(usage.cpu)}/>
                <TotalTile label={t("metrics.columns.memory")} value={formatBytes(usage.memory)}/>
                <TotalTile label={t("metrics.columns.limit")} value={formatBytes(usage.limit)}/>
            </dl>
        </section>
    );
};

/**
 * The usage of a service or a volume: the cpu, memory and memory limit of its
 * instances summed over the nodes, then the cgroups around it as systemd-cgtop shows
 * them (UsageTreeTable): the opensvc slice and its namespace slice over its nodes, the
 * object, its instances node by node, each a badge opening its own panel, and under
 * each its subsets and resources.
 */
export function ObjectUsage({path}) {
    const {t} = useTranslation();
    const nodes = useInstanceNodes(path);
    // Its subsets and resources too, on each node.
    const readings = usePgReadings(nodes, {paths: [path]});
    const {usage, errors} = readings;
    const read = Object.keys(usage).length + Object.keys(errors).length > 0;
    const total = useMemo(() => objectUsage(usage, path), [usage, path]);
    const tree = useMemo(() => objectUsageTree(nodes, readings, path, namespaceOf, {instances: true}), [nodes, readings, path]);

    if (!read && nodes.length > 0) {
        return <div className="flex justify-center"><Spinner label={t("metrics.loading")}/></div>;
    }
    return (
        <div className="flex flex-col gap-3" data-testid="object-usage">
            <ReadErrors errors={errors}/>
            <UsageTiles usage={total} label={t("metrics.object.total")}/>
            {nodes.length === 0 ? <p className="text-ink-muted">{t("metrics.object.none")}</p>
                : tree === null ? <p className="text-ink-muted">{t("metrics.object.noGroup")}</p>
                    : <UsageTreeTable tree={tree} limits/>}
            <p className="text-ink-muted">{t("metrics.object.footer", {seconds: PG_POLL_MS / 1000})}</p>
        </div>
    );
}

/**
 * The usage of an instance: the cpu, memory and memory limit of its cgroup on its
 * node, then the cgroups around it there as systemd-cgtop shows them: the opensvc
 * slice, its namespace slice, the instance, and in it its subsets and resources.
 */
export function InstanceUsage({path, node}) {
    const {t} = useTranslation();
    const nodes = useMemo(() => [node], [node]);
    // Its subsets and resources too.
    const readings = usePgReadings(nodes, {paths: [path]});
    const {usage, errors} = readings;
    const tree = useMemo(() => objectUsageTree(nodes, readings, path, namespaceOf), [nodes, readings, path]);
    if (usage[node] === undefined && errors[node] === undefined) {
        return <div className="flex justify-center"><Spinner label={t("metrics.loading")}/></div>;
    }
    const u = usage[node]?.[path];
    return (
        <div className="flex flex-col gap-3" data-testid="instance-usage">
            <ReadErrors errors={errors}/>
            {usage[node] === undefined ? null : u === undefined
                ? <p className="text-ink-muted">{t("metrics.instance.none", {node})}</p>
                : <UsageTiles usage={u} label={t("metrics.instance.total")}/>}
            {tree && <UsageTreeTable tree={tree} limits/>}
            <p className="text-ink-muted">{t("metrics.instance.footer", {node, seconds: PG_POLL_MS / 1000})}</p>
        </div>
    );
}

/** A fact of a record: its name, then what it says. */
const Fact = ({label, children}) => (
    <>
        <dt className="text-ink-muted">{label}</dt>
        <dd>{children}</dd>
    </>
);

/** The P of what is not provisioned, said on demand. */
const NotProvisionedHelp = () => {
    const {t} = useTranslation();
    return <SymbolHelp meaning={t("ui.stateMarks.notProvisioned")}><NotProvisionedMark/></SymbolHelp>;
};

/** A status in a word, after its mark, and the P of a resource not provisioned. */
const StatusWord = ({status, notProvisioned = false}) => {
    const {t} = useTranslation();
    return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <SymbolHelp meaning={t("statusBoard.details.status", {status: status || t("instance.unknown")})}>
                <StatusMark state={toObjectState(status)} label={status || t("instance.unknown")}/>
            </SymbolHelp>
            {status || "-"}
            {notProvisioned && <NotProvisionedHelp/>}
        </span>
    );
};

/**
 * The status of an instance, as its node reports it: its object and its node, a
 * badge each, its availability, overall state, provisioning, freeze and monitor
 * state, the datastores its resources use, a badge each, then its resources, each
 * a badge opening its own panel. Its actions in the title bar of its panel; the
 * resources checked, the actions on them over their table.
 */
export function InstanceStatus({path, node}) {
    const {t} = useTranslation();
    const status = useEventStore((s) => s.objectInstanceStatus?.[path]?.[node]) ?? EMPTY;
    const monitor = useEventStore((s) => s.instanceMonitor?.[`${node}:${path}`]) ?? EMPTY;
    const resources = Object.entries(status.resources ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const frozen = !!status.frozen_at && status.frozen_at !== ZERO_TIME;
    const notProvisioned = status.provisioned === "false" || status.provisioned === false;
    const datastores = datastoresOf(resources.map(([, r]) => r));
    const volumes = volumesOf(resources.map(([, r]) => r));
    const header = usePanelHeader();
    const {ask, running, dialogs} = useActionRunner(path);
    const [picked, setPicked] = useState([]);
    // A resource gone is no longer picked.
    const rids = resources.map(([rid]) => rid);
    const pickedRids = picked.filter((rid) => rids.includes(rid));
    const toggle = (rid) => setPicked((l) => (l.includes(rid) ? l.filter((r) => r !== rid) : [...l, rid]));

    // The instance: freeze and unfreeze both, as on an object; its monitor cleared once failed.
    const failed = (monitor.state ?? "").endsWith("failed");
    const onInstance = {targets: [{node}], subject: t("statusBoard.subjects.instance", {path, where: node})};
    const instanceTypes = resources.map(([, r]) => r.type).filter(Boolean);
    const instanceItems = [...(failed ? [CLEAR_ACTION] : []), ...INSTANCE_ACTIONS].map((a) => {
        const variant = syncVariant(a.name, instanceTypes);
        return {
            key: a.name,
            label: actionLabel(a.name),
            icon: actionIcon(a),
            description: actionDescription(t, "instance", a.name, variant),
            onSelect: () => ask(a.name, {...onInstance, variant}),
        };
    });
    const instanceMenu = (
        <MenuButton
            solid
            text={t("statusBoard.actions.object")}
            icon={<BoltIcon className="h-3.5 w-3.5"/>}
            label={t("instance.panel.actions")}
            align="end"
            disabled={running}
            {...explainedMenu(t, "instance", instanceItems)}
        />
    );

    // The resources checked: the actions every one of them takes.
    const onResources = {
        targets: [{node, rid: pickedRids.join(",")}],
        subject: t("statusBoard.subjects.resource", {rid: pickedRids.join(", "), path, where: node}),
        onDone: () => setPicked([]),
    };
    const pickedTypes = pickedRids.map((rid) => status.resources?.[rid]?.type).filter(Boolean);
    const resourceItems = RESOURCE_ACTIONS
        .filter((a) => pickedRids.every((rid) => resourceActions(rid, status.resources?.[rid]?.type).some((b) => b.name === a.name)))
        .map((a) => {
            const variant = syncVariant(a.name, pickedTypes);
            return {
                key: a.name,
                label: actionLabel(a.name),
                icon: actionIcon(a),
                description: actionDescription(t, "resource", a.name, variant),
                onSelect: () => ask(a.name, {...onResources, variant}),
            };
        });

    return (
        <div className="space-y-4" data-testid="instance-status">
            {header.actions !== null ? createPortal(instanceMenu, header.actions) : <div className="flex justify-end">{instanceMenu}</div>}
            <div className="flex items-start justify-between gap-2">
                <dl className="grid w-max grid-cols-[auto_auto] items-center gap-x-3 gap-y-1">
                    <Fact label={<Term term="object">{t("instance.panel.object")}</Term>}><CrossLink kind="object" id={path}>{path}</CrossLink></Fact>
                    <Fact label={<Term term="node">{t("instance.panel.node")}</Term>}><CrossLink kind="node" id={node}>{node}</CrossLink></Fact>
                    <Fact label={<Term term="avail">{t("instance.panel.avail")}</Term>}><StatusWord status={status.avail}/></Fact>
                    <Fact label={<Term term="overall">{t("instance.panel.overall")}</Term>}>{status.overall || "-"}</Fact>
                    <Fact label={<Term term="provisioned">{t("instance.panel.provisioned")}</Term>}>
                        <span className="inline-flex items-center gap-1.5">
                            {String(status.provisioned ?? "-")}
                            {notProvisioned && <NotProvisionedHelp/>}
                        </span>
                    </Fact>
                    <Fact label={<Term term="frozen">{t("instance.panel.frozen")}</Term>}>
                        <span className="inline-flex items-center gap-1.5">
                            {frozen ? t("instance.panel.yes") : t("instance.panel.no")}
                            {frozen ? <SymbolHelp meaning={t("ui.frozen")}><FrozenMark frozen/></SymbolHelp> : <FrozenMark frozen={false}/>}
                        </span>
                    </Fact>
                    <Fact label={<Term term="monitor">{t("instance.panel.monitor")}</Term>}>{monitor.state || "-"}</Fact>
                    {datastores.length > 0 && (
                        <Fact label={t("instance.panel.datastores")}><DatastoreLinks paths={datastores}/></Fact>
                    )}
                    {volumes.length > 0 && (
                        <Fact label={t("instance.panel.volumes")}><DatastoreLinks paths={volumes}/></Fact>
                    )}
                </dl>
                <RefreshStatusButton path={path} nodes={[node]}/>
            </div>
            {/* Nothing checked, the help says how; both as high as the buttons, the table kept in place. */}
            <div className="flex min-h-7 flex-wrap items-center gap-3">
                {pickedRids.length > 0 ? (
                    <>
                        <MenuButton
                            prominent
                            icon={<BoltIcon className="h-3.5 w-3.5"/>}
                            label={t("statusBoard.actions.selectionResources", {count: pickedRids.length})}
                            disabled={running || resourceItems.length === 0}
                            {...explainedMenu(t, "resource", resourceItems)}
                        />
                        <Button size="sm" variant="secondary" icon={<CloseIcon/>} onClick={() => setPicked([])}>
                            {t("statusBoard.actions.clearSelection")}
                        </Button>
                    </>
                ) : (
                    <p className="text-ink-muted">{t("instance.panel.selectionHelp")}</p>
                )}
            </div>
            <Table aria-label={t("instance.panel.resources")}>
                <thead>
                    <HeaderRow>
                        <HeaderCell className="w-8"/>
                        <HeaderCell>{t("instance.panel.rid")}</HeaderCell>
                        <HeaderCell>{t("common.status")}</HeaderCell>
                        <HeaderCell>{t("common.type")}</HeaderCell>
                        <HeaderCell>{t("instance.panel.label")}</HeaderCell>
                    </HeaderRow>
                </thead>
                <tbody>
                    {resources.map(([rid, r]) => (
                        <Row key={rid} selected={pickedRids.includes(rid)}>
                            <Cell className="w-8">
                                <Checkbox
                                    checked={pickedRids.includes(rid)}
                                    onChange={() => toggle(rid)}
                                    aria-label={t("instance.panel.selectResource", {rid})}
                                />
                            </Cell>
                            <Cell className="whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5">
                                    <ResourceLink path={path} rid={rid}/>
                                    <ResourceSessionLinks path={path} rid={rid} node={node} type={r.type}/>
                                </span>
                            </Cell>
                            <Cell><StatusWord status={r.status} notProvisioned={r.provisioned?.state === "false"}/></Cell>
                            <Cell className="text-ink-muted">{r.type}</Cell>
                            <Cell className="break-all">{r.label}</Cell>
                        </Row>
                    ))}
                    {resources.length === 0 && <EmptyRow colSpan={5}>{t("instance.panel.noResource")}</EmptyRow>}
                </tbody>
            </Table>
            {dialogs}
        </div>
    );
}

/** The flags of a resource on a node, in words: how the daemon treats it there. */
const FLAGS = ["disable", "monitor", "optional", "standby", "encap"];

/**
 * A resource of an object on all its nodes: its object, a badge, its type, the
 * datastores it uses, a badge each, then its state node by node, each node the
 * badge of the instance there: its status, provisioning, flags and label; then its
 * notes, all it logged and its RPO breached, by the nodes they are on. With `node`,
 * on the instance of that node alone, a badge too.
 */
export function ResourceStatus({path, rid, node: onNode}) {
    const {t} = useTranslation();
    const instances = useEventStore((s) => s.objectInstanceStatus?.[path]) ?? EMPTY;
    const rows = Object.entries(instances)
        .filter(([node, status]) => (onNode === undefined || node === onNode) && status?.resources?.[rid] !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([node, status]) => ({node, r: status.resources[rid]}));
    const type = rows.find(({r}) => r.type)?.r.type;
    const datastores = datastoresOf(rows.map(({r}) => r));
    const volumes = volumesOf(rows.map(({r}) => r));
    const notes = resourceNotes(rows.map(({node, r}) => [node, r]));
    const notesId = useId();
    return (
        <div className="space-y-4" data-testid="resource-status">
            <div className="flex items-start justify-between gap-2">
                <dl className="grid w-max grid-cols-[auto_auto] items-center gap-x-3 gap-y-1">
                    <Fact label={<Term term="object">{t("instance.panel.object")}</Term>}><CrossLink kind="object" id={path}>{path}</CrossLink></Fact>
                    {onNode !== undefined && (
                        <Fact label={t("resource.panel.instance")}><InstanceLink path={path} node={onNode}/></Fact>
                    )}
                    <Fact label={t("instance.panel.rid")}><span className="font-medium">{rid}</span></Fact>
                    <Fact label={t("common.type")}>{type ?? "-"}</Fact>
                    {datastores.length > 0 && (
                        <Fact label={t("instance.panel.datastores")}><DatastoreLinks paths={datastores}/></Fact>
                    )}
                    {volumes.length > 0 && (
                        <Fact label={t("instance.panel.volumes")}><DatastoreLinks paths={volumes}/></Fact>
                    )}
                </dl>
                {/* A resource has no status of its own: the instances holding it refreshed whole. */}
                <RefreshStatusButton path={path} nodes={rows.map(({node}) => node)}/>
            </div>
            <Table aria-label={t("resource.panel.nodes")}>
                <thead>
                    <HeaderRow>
                        <HeaderCell>{t("metrics.columns.node")}</HeaderCell>
                        <HeaderCell>{t("common.status")}</HeaderCell>
                        <HeaderCell>{t("resource.panel.flags")}</HeaderCell>
                        <HeaderCell>{t("instance.panel.label")}</HeaderCell>
                    </HeaderRow>
                </thead>
                <tbody>
                    {rows.map(({node, r}) => (
                        <Row key={node}>
                            <Cell className="whitespace-nowrap"><InstanceLink path={path} node={node}/></Cell>
                            <Cell><StatusWord status={r.status} notProvisioned={r.provisioned?.state === "false"}/></Cell>
                            <Cell className="text-ink-muted">
                                {FLAGS.filter((flag) => r[flag]).map((flag) => t(`resource.panel.flag.${flag}`)).join(", ") || "-"}
                            </Cell>
                            <Cell className="break-all">{r.label}</Cell>
                        </Row>
                    ))}
                    {rows.length === 0 && <EmptyRow colSpan={4}>{t("resource.panel.none")}</EmptyRow>}
                </tbody>
            </Table>
            {/* What it logged on its nodes and its RPO breached, as the status board says them. */}
            {notes.length > 0 && (
                <section aria-labelledby={`${notesId}-notes`} className="space-y-1">
                    <h3 id={`${notesId}-notes`} className="font-semibold">{t("statusBoard.notes", {count: notes.length})}</h3>
                    <NotesList notes={notes} className="max-w-none"/>
                </section>
            )}
        </div>
    );
}

/**
 * The actions on a resource, in the title bar of its panel: those its driver takes
 * (`resourceActions`), on the instance of its node, or on every node holding it; a
 * console on one node alone. Each confirmed, then posted to the instances for it.
 */
function ResourceActions({path, rid, nodes, type}) {
    const {t} = useTranslation();
    const header = usePanelHeader();
    const {ask, running, dialogs} = useActionRunner(path);
    const on = {
        targets: nodes.map((node) => ({node, rid})),
        subject: t("statusBoard.subjects.resource", {rid, path, where: nodes.join(", ")}),
    };
    const items = resourceActions(rid, type)
        .map((a) => {
            const variant = syncVariant(a.name, type ? [type] : []);
            return {
                key: a.name,
                label: actionLabel(a.name),
                icon: actionIcon(a),
                description: actionDescription(t, "resource", a.name, variant),
                onSelect: () => ask(a.name, {...on, variant}),
            };
        });
    const menu = (
        <MenuButton
            solid
            text={t("statusBoard.actions.object")}
            icon={<BoltIcon className="h-3.5 w-3.5"/>}
            label={t("resource.panel.actions")}
            align="end"
            disabled={running || nodes.length === 0 || items.length === 0}
            {...explainedMenu(t, "resource", items)}
        />
    );
    return (
        <>
            {header.actions !== null && createPortal(menu, header.actions)}
            {dialogs}
        </>
    );
}

/** Closes a panel once its record, seen, is gone. */
function useCloseWhenGone(id, known, onClose) {
    const seen = useRef(false);
    useEffect(() => {
        seen.current = false;
    }, [id]);
    useEffect(() => {
        if (known) seen.current = true;
        else if (seen.current) {
            seen.current = false;
            onClose();
        }
    }, [known, onClose]);
}

/**
 * The instance of a service or a volume on a node, by `path@node`: its status, as
 * its node reports it, what its resources report there (ObjectResources), its
 * usage there, then its logs there. It closes once the instance is gone.
 */
export function InstanceDetailPanel({id, tab, onTabChange, onClose}) {
    const {t} = useTranslation();
    const parsed = id === undefined ? null : parseInstanceId(id);
    const known = useEventStore((s) => parsed !== null && s.objectInstanceStatus?.[parsed.path]?.[parsed.node] !== undefined);
    useCloseWhenGone(id, known, onClose);
    const tabs = [
        {key: "status", label: t("panel.tabs.status")},
        {key: "resources", label: t("panel.tabs.resources")},
        {key: "usage", label: t("panel.tabs.usage")},
        {key: "logs", label: t("panel.tabs.logs")},
    ];
    return (
        <RecordPanel
            open={parsed !== null}
            kind="instance"
            recordId={id}
            title={parsed ? t("instance.panel.title", {path: parsed.path, node: parsed.node}) : ""}
            onClose={onClose}
            tabs={tabs}
            tab={tab}
            onTabChange={onTabChange}
            closeOnOutsideClick={false}
        >
            {(active) => (parsed === null ? null : active === "logs"
                ? <ObjectLogs key={id} path={parsed.path} nodes={[parsed.node]}/>
                : active === "usage"
                ? <InstanceUsage key={id} path={parsed.path} node={parsed.node}/>
                : active === "resources"
                    ? <ObjectResources key={id} path={parsed.path} node={parsed.node}/>
                    : <InstanceStatus key={id} path={parsed.path} node={parsed.node}/>)}
        </RecordPanel>
    );
}

/**
 * A resource of an object, by `path:rid`: its state on each node of the object,
 * then what it reports on each (`om <path> resource info list`, ObjectResources),
 * then its logs on all of them, merged, then its section of the configuration of
 * the object; a container, what it writes too (ContainerLogs), on the nodes it is
 * on, and for who may a session on it (ResourceConsole), kept open from a tab to
 * another, closing the panel on one asked first. By `path:rid@node`, the same on the instance of that node alone. It closes
 * once the object, or that instance, is gone.
 */
export function ResourceDetailPanel({id, tab, onTabChange, onClose}) {
    const {t} = useTranslation();
    const parsed = id === undefined ? null : parseResourceId(id);
    const onNode = parsed?.node;
    const known = useEventStore((s) => parsed !== null && s.objectInstanceStatus?.[parsed.path] !== undefined
        && (onNode === undefined || s.objectInstanceStatus[parsed.path][onNode] !== undefined));
    useCloseWhenGone(id, known, onClose);
    const instances = useEventStore((s) => (parsed === null ? undefined : s.objectInstanceStatus?.[parsed.path]));
    const nodes = useMemo(
        () => Object.keys(instances ?? {}).filter((node) => onNode === undefined || node === onNode).sort(),
        [instances, onNode],
    );
    // The nodes the resource is on, and those where it is up: a container's logs read there.
    const rid = parsed?.rid;
    const resourceNodes = useMemo(() => nodes.filter((node) => instances?.[node]?.resources?.[rid] !== undefined), [nodes, instances, rid]);
    const upNodes = useMemo(() => resourceNodes.filter((node) => instances[node].resources[rid].status === "up"), [resourceNodes, instances, rid]);
    const runningNodes = useMemo(() => resourceNodes.filter((node) => isRunning(instances[node].resources[rid].status)), [resourceNodes, instances, rid]);
    const type = resourceNodes.map((node) => instances[node].resources[rid].type).find(Boolean);
    const container = rid !== undefined && isContainerResource(rid, type);
    const grants = useGrants();
    const sessions = parsed !== null && mayOpenSession(grants, parsed.path) ? sessionKinds(parsed.rid, type) : [];
    // The sessions open, and the panel asked to close on them.
    const [liveSessions, setLiveSessions] = useState([]);
    const [closing, setClosing] = useState(false);
    const markLive = useCallback((session, live) => setLiveSessions((list) => {
        const others = list.filter((s) => s !== session);
        return live ? [...others, session] : others;
    }), []);
    // As every panel: its own views, then its configuration, then its logs (RecordPanel).
    const tabs = [
        {key: "status", label: t("panel.tabs.status")},
        {key: "info", label: t("panel.tabs.info")},
        ...sessions.map((session) => ({key: session, label: t(`panel.tabs.${session}`)})),
        {key: "config", label: t("panel.tabs.config")},
        {key: "logs", label: t("panel.tabs.logs")},
        ...(container ? [{key: "container", label: t("panel.tabs.containerLogs")}] : []),
    ];
    const askClose = () => (liveSessions.length > 0 ? setClosing(true) : onClose());
    const closeSessions = () => {
        setClosing(false);
        onClose();
    };
    return (
        <>
        <RecordPanel
            open={parsed !== null}
            kind="resource"
            recordId={id}
            title={parsed === null ? ""
                : onNode === undefined ? t("resource.panel.title", {path: parsed.path, rid: parsed.rid})
                    : t("resource.panel.titleOnNode", {path: parsed.path, rid: parsed.rid, node: onNode})}
            onClose={askClose}
            tabs={tabs}
            tab={tab}
            onTabChange={onTabChange}
            closeOnOutsideClick={false}
        >
            {(active) => (parsed === null ? null : (
                <>
                    {/* Its actions in the title bar, whatever the tab: on its node, or on the nodes holding it. */}
                    <ResourceActions key={`actions:${id}`} path={parsed.path} rid={parsed.rid} nodes={resourceNodes} type={type}/>
                    {/* Mounted whatever the tab: a session outlives a look at another one. */}
                    {sessions.map((session) => (
                        <ResourceConsole
                            key={`${session}:${id}`}
                            kind={session}
                            path={parsed.path}
                            rid={parsed.rid}
                            nodes={resourceNodes}
                            upNodes={runningNodes}
                            hidden={active !== session}
                            onLive={markLive}
                        />
                    ))}
                    {sessions.includes(active) ? null
                        : active === "config"
                        ? <ObjectConfig key={id} path={parsed.path} section={parsed.rid}/>
                        : active === "logs"
                        ? <ObjectLogs key={id} path={parsed.path} nodes={nodes} filters={[`RID=${parsed.rid}`]}/>
                        : active === "container" && container
                        ? <ContainerLogs key={id} path={parsed.path} rid={parsed.rid} nodes={resourceNodes.length > 0 ? resourceNodes : nodes} upNodes={upNodes}/>
                        : active === "info"
                        ? <ObjectResources key={id} path={parsed.path} rid={parsed.rid} node={onNode}/>
                        : <ResourceStatus key={id} path={parsed.path} rid={parsed.rid} node={onNode}/>}
                </>
            ))}
        </RecordPanel>
        <Dialog
            open={closing}
            onClose={() => setClosing(false)}
            title={t("console.close.title")}
            footer={(
                <>
                    <Button onClick={() => setClosing(false)}>{t("common.cancel")}</Button>
                    <Button variant="change" onClick={closeSessions}>{t("console.close.confirm")}</Button>
                </>
            )}
        >
            {t("console.close.text")}
        </Dialog>
        </>
    );
}
