import React, {useEffect, useId, useMemo, useState} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
import {RecordPanel} from "../app/RecordPanel";
import {usePanelHeader} from "../app/panel-header";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {URL_NODE} from "../config/apiPath.js";
import {authHeaders, getResponseErrorMessage} from "../services/api.jsx";
import {nodeActionRequest, nodeMenuItems, postNodeAction} from "../app/node-actions";
import {useApiNode} from "../hooks/useApiNode";
import {NodeActionDialog} from "./NodeActionDialog";
import LogsViewer from "./LogsViewer";
import {EventLog, NODE_EVENT_TYPES} from "./EventLogger";
import {ConfigText} from "./ConfigText";
import {MonitorState} from "./NodeRow";
import {MenuButton} from "../ui/components/MenuButton";
import {OrchestrationBadge, orchestrationOf} from "./OrchestrationBadge";
import {OrchestrationLogsFilter} from "./OrchestrationLogsFilter";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {Button, IconButton} from "../ui/components/Button";
import {Input, Select, Textarea} from "../ui/components/Field";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {FrozenMark} from "../ui/components/FrozenMark";
import {RelativeTime} from "../ui/components/RelativeTime";
import {BoltIcon, CodeIcon, EyeIcon, EyeOffIcon, PencilIcon, RefreshIcon, ResetIcon, SearchIcon} from "../ui/icons";
import ConfigEvalDialog from "./ConfigEvalDialog";
import {ConfigValidationResult, ValidateButton, useConfigValidation} from "./ConfigValidation";
import {formatSeconds, useAutoHide} from "../ui/lib/reveal";
import {formatBytes, formatSizeMiB} from "../ui/lib/format";
import {NodeDaemon} from "./NodeDaemon";
import {InstanceLink} from "./RecordLinks";
import {CategoryCount, CategoryTabs} from "../ui/components/CategoryTabs";
import {tabPanelProps} from "../ui/components/tabs-ids";
import {Pager} from "../ui/components/Pager";
import {useLocalPaging} from "../app/paging";
import {usePanelSearch} from "../app/panel-search";
import {trackDone, trackRefused, trackResponse, useActionTracker} from "../app/action-tracker";
import {driverCap, driverRows, nodeTools} from "../app/driver-caps";
import {Term} from "../app/Term";
import {refusalReason} from "./objectActions";
import {MIN_AVAIL, MinAvailDialog, thresholdPct, useMinAvail} from "./NodeMinAvail";
import {useGrants} from "../hooks/useGrants";
import {propertyKeyword, useOrgEdit} from "./NodeOrgEdit";
import {NodeLabels} from "./NodeLabels";
import {RawDataButton} from "./JsonCode";
import {matches} from "../app/facets";
import {useEditDraft} from "../app/edit-drafts";

/*
 * The record panel of a cluster node, as oc3 gives its nodes one: its state and
 * properties, then one tab per kind of related data, read from the daemon API
 * (`/api/node/name/{node}/…`) as `om node` reads them.
 */

const ZERO_TIME = "0001-01-01T00:00:00Z";
export const isSet = (time) => !!time && time !== ZERO_TIME;

/** The facts of a node named by a word of the glossary, its key by fact. */
const NODE_TERMS = {
    state: "monitor",
    globalExpect: "globalExpect",
    localExpect: "localExpect",
    orchestration: "orchestration",
    frozen: "frozen",
    leader: "leader",
    score: "score",
    overloaded: "overloaded",
};

/** The events that keep the state of the nodes current, the Nodes view's. */
const NODE_EVENTS = ["NodeStatusUpdated", "NodeMonitorUpdated", "NodeStatsUpdated"];

export const nodeUrl = (node, path) => `${URL_NODE}/${encodeURIComponent(node)}/${path}`;
// The header of the session, from services/api.jsx: here too for the views reading the node.
export {authHeaders};

/*
 * The helpers of the tabs below are shared with the tabs of the object panel
 * (ObjectTabs): a read endpoint, its table, its filter.
 */

const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

/**
 * Reads an endpoint of the daemon: the JSON it answers, or its text with `text`.
 * `reload` reads it again.
 */
export function useApiResource(url, {text = false} = {}) {
    const [state, setState] = useState({data: null, error: null, loading: true});
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setState((previous) => ({...previous, loading: true, error: null}));
        fetch(url, {headers: authHeaders(), cache: "no-cache"})
            .then(async (response) => {
                if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
                return text ? response.text() : response.json();
            })
            .then((data) => {
                if (!cancelled) setState({data, error: null, loading: false});
            })
            .catch((error) => {
                if (!cancelled) setState({data: null, error: error.message, loading: false});
            });
        return () => {
            cancelled = true;
        };
    }, [url, text, version]);
    return {...state, reload: () => setVersion((v) => v + 1)};
}

/** Reads an endpoint of the node (`/api/node/name/{node}/…`). */
const useNodeResource = (node, path, options) => useApiResource(nodeUrl(node, path), options);

/** The records of a list the daemon answers: `items`, each one's `data` when it has one. */
export const itemsOf = (resource) => (resource.data?.items ?? []).map((item) => item?.data ?? item);

/** A section of a tab: its title and how many it holds. */
export function Section({id, title, count, children, tools}) {
    return (
        <section aria-labelledby={id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <h3 id={id} className="font-semibold">
                    {title}
                    {count !== undefined && <span className="ml-1.5 font-normal text-ink-muted tabular-nums">{count}</span>}
                </h3>
                {tools}
            </div>
            {children}
        </section>
    );
}

/** What a resource holds once read: a spinner while it is read, its error if it failed. */
export function Loaded({resource, children}) {
    const {t} = useTranslation();
    if (resource.loading && resource.data === null) return <Spinner label={t("nodePanel.loading")}/>;
    if (resource.error) return <Alert tone="error">{t("nodePanel.loadError", {message: resource.error})}</Alert>;
    return children;
}

/** A plain table of records: a column per key, the empty text when there is none. */
export function DataTable({label, columns, rows, rowKey, empty}) {
    const {t} = useTranslation();
    return (
        <Table aria-label={label}>
            <thead>
            <HeaderRow>
                {columns.map((column) => <HeaderCell key={column.key}>{column.label}</HeaderCell>)}
            </HeaderRow>
            </thead>
            <tbody>
            {rows.map((row, index) => (
                <Row key={rowKey ? rowKey(row, index) : index}>
                    {columns.map((column) => (
                        <Cell key={column.key} numeric={column.numeric} className={column.className}>
                            {column.render ? column.render(row) : String(row[column.key] ?? "")}
                        </Cell>
                    ))}
                </Row>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={columns.length}>{empty ?? t("nodePanel.none")}</EmptyRow>}
            </tbody>
        </Table>
    );
}

/**
 * A filter field, for the long lists. As wide as its label, which is its placeholder,
 * the search icon and the clear button of the browser: a label longer in one
 * language than in another is never cut.
 */
export function FilterField({label, value, onChange}) {
    return (
        <span className="relative ml-auto flex max-w-full items-center">
            <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ink-muted"/>
            <Input
                type="search"
                aria-label={label}
                placeholder={label}
                className="h-7 max-w-full min-w-56 pl-7"
                style={{width: `calc(${label.length}ch + 3.5rem)`}}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </span>
    );
}

// The words searched, as on the lists (app/facets): here too for the panels using it.
export {matches};

/**
 * The actions on the node, in the title bar of its panel as oc3 places them: the
 * node actions of the Nodes view, by group, each confirmed first. Freeze or unfreeze,
 * by its state. Abort is no action of the menu: the badge of the orchestration in
 * progress offers it, with its logs.
 */
function NodeActions({node, monitor, onOrchestrationLogs}) {
    const {t} = useTranslation();
    const [pending, setPending] = useState(null);
    const {globalExpect, orchestrationId} = orchestrationOf([monitor]);
    const apiNode = useApiNode();
    const items = nodeMenuItems({
        t,
        nodes: [node],
        apiNode,
        renderIcon: ({icon, color}) => <span aria-hidden="true" className={color === "red" ? DANGER_ICON : ICON}>{icon}</span>,
        onSelect: (name) => setPending({action: name, node}),
    });

    const run = async (action) => {
        setPending(null);
        // What comes of it, accepted or refused, the actions tray says.
        await postNodeAction(node, action, authHeaders());
    };

    return (
        <>
            <OrchestrationBadge
                globalExpect={globalExpect}
                orchestrationId={orchestrationId}
                onLogs={onOrchestrationLogs}
                onAbort={() => setPending({action: "abort", node})}
            />
            <MenuButton
                // In the title bar, solid: "Actions" in a wide window, the bolt alone in a narrow one.
                solid
                text={t("statusBoard.actions.object")}
                icon={<BoltIcon className="h-3.5 w-3.5"/>}
                label={t("nodePanel.actions")}
                align="end"
                // The node, its inventory, its daemon: a column each in a wide window.
                columns={2}
                filterable
                filterLabel={t("actionMenus.filter")}
                filterEmpty={t("actionMenus.noMatch")}
                items={items}
            />
            <NodeActionDialog
                pending={pending}
                onConfirm={run}
                target={t("nodes.target.node", {node})}
                onClose={() => setPending(null)}
            />
        </>
    );
}

/**
 * The node in a masonry of sections: its monitor, its health (its free memory and
 * swap with the minimum below which it is overloaded, set here by root), then its
 * properties (`om node system property`), those the agent discovered apart from
 * those the organisation gives it. Kept current by its events.
 */
function NodeStatusTab({node, onOrchestrationLogs}) {
    const {t, i18n} = useTranslation();
    const status = useEventStore((s) => s.nodeStatus?.[node]);
    const monitor = useEventStore((s) => s.nodeMonitor?.[node]);
    const stats = useEventStore((s) => s.nodeStats?.[node]);
    const properties = useNodeResource(node, "system/property");
    const header = usePanelHeader();

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, NODE_EVENTS) : null;
        return () => release?.();
    }, []);

    const mayConfigure = Object.prototype.hasOwnProperty.call(useGrants(), "root");
    const {thresholds, reload: reloadThresholds} = useMinAvail(node);
    const [editing, setEditing] = useState(null);

    const frozen = isSet(status?.frozen_at);
    const none = "–";
    // A fact named by a word of OpenSVC: its definition on demand.
    const fact = (key, value) => [key, NODE_TERMS[key] ? <Term term={NODE_TERMS[key]}>{t(`nodePanel.status.${key}`)}</Term> : t(`nodePanel.status.${key}`), value];
    // When a value of the monitor was set, muted after it.
    const since = (at) => (isSet(at) ? <span className="text-ink-muted"><RelativeTime value={at} locale={i18n.language}/></span> : null);
    const withSince = (value, at) => <span className="inline-flex flex-wrap items-baseline gap-x-1.5">{value}{since(at)}</span>;
    // An expect: none, quiet; one set, bold, a target the node is moving to.
    const expectOf = (value, at) => (!value || value === "none"
        ? <span className="text-ink-muted">{t("nodePanel.status.noExpect")}</span>
        : withSince(<span className="font-semibold">{value}</span>, at));
    const orchestrationId = monitor?.orchestration_id;
    const orchestration = orchestrationId && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(orchestrationId) ? (
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            {/* Its logs a click away. */}
            <button
                type="button"
                aria-label={t("nodePanel.status.orchestrationLogs", {id: orchestrationId})}
                onClick={() => onOrchestrationLogs?.(orchestrationId)}
                className="font-mono text-accent hover:underline"
            >
                {orchestrationId.slice(0, 8)}
            </button>
            <span className="text-ink-muted">
                {monitor.orchestration_is_done ? t("nodePanel.status.orchestrationDone") : t("nodePanel.status.orchestrationOngoing")}
            </span>
        </span>
    ) : <span className="text-ink-muted">{t("nodePanel.status.noOrchestration")}</span>;
    const monitorFacts = [
        fact("state", withSince(<MonitorState monitor={monitor}/>, monitor?.state_updated_at)),
        fact("globalExpect", expectOf(monitor?.global_expect, monitor?.global_expect_updated_at)),
        fact("localExpect", expectOf(monitor?.local_expect, monitor?.local_expect_updated_at)),
        fact("orchestration", orchestration),
        fact("frozen", frozen ? (
            <span className="inline-flex items-center gap-1.5">
                <FrozenMark frozen/>
                <RelativeTime value={status.frozen_at} locale={i18n.language}/>
            </span>
        ) : t("common.no")),
        fact("leader", status?.is_leader ? t("common.yes") : t("common.no")),
    ];
    /** The free share of memory or swap, of its total, with the minimum below which the node is overloaded. */
    const freeOf = (kind) => {
        const pct = stats?.[`${kind}_avail`];
        const total = stats?.[`${kind}_total`];
        // A dash rather than a percent of nothing, as in the nodes table: no value reported, or no swap.
        if (typeof pct !== "number" || total === 0) return "-";
        const threshold = thresholds?.[kind];
        const min = threshold ? thresholdPct(threshold.text, total, MIN_AVAIL[kind].cap) : null;
        const low = min !== null && min > 0 && pct < min;
        return (
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
                {/* The totals are in mebibytes. */}
                <span className={low ? "text-state-warn" : undefined}>
                    {t("nodePanel.status.ofTotal", {pct, total: formatSizeMiB(total, i18n.language) || none})}
                </span>
                {threshold && (
                    <span className="text-ink-muted">
                        {min === 0 ? t("nodeHealth.minimumOff") : t("nodeHealth.minimumIs", {value: threshold.text})}
                    </span>
                )}
                {threshold && mayConfigure && (
                    <IconButton size="sm" label={t(`nodeHealth.${kind}.edit`)} onClick={() => setEditing(kind)}>
                        <PencilIcon className="h-3 w-3"/>
                    </IconButton>
                )}
            </span>
        );
    };
    const healthFacts = [
        fact("score", stats?.score ?? none),
        fact("load15m", stats?.load_15m ?? none),
        fact("memAvail", freeOf("mem")),
        fact("swapAvail", freeOf("swap")),
        fact("overloaded", status?.is_overloaded ? <span className="text-state-warn">{t("common.yes")}</span> : t("common.no")),
    ];
    // What the agent found on the node, apart from what the organisation says of it, each in its groups.
    // A property by its label, the title the api gives the unknown ones.
    const labelOf = (p) => t(`nodeProperties.${p.name}`, {defaultValue: p.title || p.name});
    const groups = propertyGroups(itemsOf(properties), labelOf);
    // The properties of the organisation, edited in a buffer, applied in one write of the node configuration.
    const organisationItems = groups.filter((g) => g.family === "organisation").flatMap((g) => g.items);
    const org = useOrgEdit(node, {reload: properties.reload, t});
    const orgField = (p) => {
        const kw = propertyKeyword(p.name);
        const changed = org.changed(kw);
        return (
            <span className="flex items-center gap-1">
                <Input
                    aria-label={labelOf(p)}
                    value={org.valueOf(kw)}
                    // Not set, its default as a hint: emptied, the keyword is unset, back to it.
                    placeholder={p.source === "default" && p.value ? String(p.value) : none}
                    onChange={(e) => org.change(kw, e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    data-changed={changed ? "" : undefined}
                    className={`h-7 ${changed ? "border-accent bg-accent-soft" : ""}`}
                />
                {changed && (
                    <IconButton size="sm" label={t("nodePanel.orgEdit.revert", {name: labelOf(p)})} onClick={() => org.revert(kw)}>
                        <ResetIcon className="h-3 w-3"/>
                    </IconButton>
                )}
            </span>
        );
    };
    // A section with no value to show, folded into one line: its title, "not set", its pencil.
    // Unfolded while the organisation is edited, for its fields; the first field of the one
    // whose pencil was clicked then focused.
    const isUnset = (p) => p.value === "" || p.value === undefined || p.value === null;
    const [focusGroup, setFocusGroup] = useState(null);
    useEffect(() => {
        if (!org.editing || focusGroup === null) return;
        document.querySelector(`[aria-labelledby="${focusGroup}"] input`)?.focus();
        setFocusGroup(null);
    }, [org.editing, focusGroup]);
    const editOrganisation = (sectionId) => {
        org.start(organisationItems);
        setFocusGroup(sectionId);
    };
    const valueOf = (p) => {
        // The agent the node runs, as its status says it: the properties are a cache the
        // daemon writes when it pushes the asset, an upgrade since still told the old one.
        if (p.name === "version" && status?.agent) return status.agent;
        if (p.error) return <span className="text-ink-muted">{p.error}</span>;
        if (isUnset(p)) return <span className="text-ink-muted">{none}</span>;
        // The memory in bytes, readable.
        if (p.name === "mem_bytes" && Number(p.value) > 0) return formatBytes(Number(p.value));
        // The last boot, as an age.
        if (p.name === "last_boot") return <RelativeTime value={String(p.value)} locale={i18n.language}/>;
        return String(p.value);
    };

    return (
        // A masonry of its sections: side by side where the panel is wide, each whole.
        <div className="@container">
            {header.actions !== null && createPortal(
                <NodeActions node={node} monitor={monitor} onOrchestrationLogs={onOrchestrationLogs}/>,
                header.actions,
            )}
            {org.editing && (
                <div role="region" aria-label={t("nodePanel.orgEdit.bar")}
                     className="mb-4 flex flex-wrap items-center gap-2 rounded-(--radius-panel) border border-accent bg-accent-soft px-3 py-2">
                    <span className="mr-auto">{t("nodePanel.orgEdit.pending", {count: org.count})}</span>
                    <Button size="sm" onClick={org.discard} disabled={org.applying}>{t("nodePanel.orgEdit.discard")}</Button>
                    <Button size="sm" onClick={org.apply} disabled={org.count === 0 || org.applying}>
                        {org.applying ? t("nodePanel.orgEdit.applying") : t("nodePanel.orgEdit.apply", {count: org.count})}
                    </Button>
                    {org.error && <Alert className="w-full">{t("nodePanel.orgEdit.refused", {message: org.error})}</Alert>}
                </div>
            )}
            <div className="gap-x-6 @3xl:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
                <Section id={`node-monitor-${node}`} title={t("nodePanel.status.monitor")}
                         tools={<RawDataButton title={t("nodePanel.status.monitor")} data={monitor}/>}>
                    <Facts facts={monitorFacts}/>
                </Section>
                <Section id={`node-health-${node}`} title={t("nodePanel.status.health")}
                         tools={<RawDataButton title={t("nodePanel.status.health")} data={stats}/>}>
                    <Facts facts={healthFacts}/>
                </Section>
                <NodeLabels node={node} mayEdit={mayConfigure}/>
                {properties.data === null || properties.error ? (
                    <Section id={`node-properties-${node}`} title={t("nodePanel.status.discovered")}>
                        <Loaded resource={properties}>{null}</Loaded>
                    </Section>
                ) : ["discovered", "organisation"].flatMap((family) => {
                    const own = groups.filter((g) => g.family === family);
                    const editing = org.editing && family === "organisation";
                    const editable = mayConfigure && !org.editing && family === "organisation";
                    const sectionId = (group) => `node-${family}-${group}-${node}`;
                    const pencil = (group) => editable && (
                        <IconButton size="sm" label={t("nodePanel.orgEdit.edit")} onClick={() => editOrganisation(sectionId(group))}>
                            <PencilIcon className="h-3 w-3"/>
                        </IconButton>
                    );
                    const folded = editing ? [] : own.filter((g) => g.items.every(isUnset));
                    const shown = own.filter((g) => !folded.includes(g));
                    return [
                        ...shown.map(({group, items}) => (
                            <Section
                                key={`${family}-${group}`}
                                id={sectionId(group)}
                                title={t(`nodePanel.properties.${group}`)}
                                tools={(
                                    <>
                                        <span className="text-data text-ink-muted">{t(`nodePanel.status.${family}Tag`)}</span>
                                        {/* Root edits the properties of the organisation, from any of their blocks: all of them at once. */}
                                        {pencil(group)}
                                    </>
                                )}
                            >
                                <Facts facts={items.map((p) => (editing
                                    // Edited, the keyword written under its label.
                                    ? [p.name, (
                                        <span className="block">
                                            {labelOf(p)}
                                            <span className="block font-mono text-data text-ink-muted/70">{propertyKeyword(p.name)}</span>
                                        </span>
                                    ), orgField(p)]
                                    : [p.name, labelOf(p), valueOf(p)]))}/>
                            </Section>
                        )),
                        // The sections with nothing to show, a line each, together after the others of their family.
                        ...(folded.length === 0 ? [] : [(
                            <div key={`${family}-folded`} data-folded={family} className="space-y-1">
                                {folded.map(({group}) => (
                                    <section key={group} aria-labelledby={sectionId(group)} className="flex flex-wrap items-center gap-x-1.5">
                                        <h3 id={sectionId(group)} className="font-semibold">{t(`nodePanel.properties.${group}`)}</h3>
                                        <span aria-hidden="true" className="-ml-1.5">:</span>
                                        <span className="text-ink-muted">{t(`nodePanel.status.${family}Unset`)}</span>
                                        {pencil(group)}
                                    </section>
                                ))}
                            </div>
                        )]),
                    ];
                })}
            </div>
            {editing !== null && (
                <MinAvailDialog
                    node={node}
                    kind={editing}
                    written={thresholds?.[editing]?.written}
                    freePct={stats?.[`${editing}_avail`]}
                    totalMiB={stats?.[`${editing}_total`]}
                    onClose={() => setEditing(null)}
                    onSaved={reloadThresholds}
                />
            )}
        </div>
    );
}

/** Facts of the node, a label and its value a line: named by the section holding them. */
function Facts({facts}) {
    return (
        // The labels in a column of one width in every block: the values aligned from one block to the next.
        // Narrow, a narrower one: the room to the values, a version or an id on its line.
        <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1 max-md:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] max-md:gap-x-3">
            {facts.map(([key, label, value]) => (
                <React.Fragment key={key}>
                    <dt className="break-words text-ink-muted">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                </React.Fragment>
            ))}
        </dl>
    );
}

/**
 * The groups of the properties of a node, by their name: those the agent
 * discovers (`probe`), then those the organisation gives the node (`default`,
 * `config`). A property of no group known goes to the other ones of its family.
 */
const PROPERTY_GROUPS = {
    discovered: [
        ["node", (n) => ["nodename", "fqdn", "cluster_id", "version", "last_boot", "boot_id", "tz"].includes(n)],
        ["os", (n) => n.startsWith("os_")],
        ["cpu", (n) => n.startsWith("cpu_")],
        ["memory", (n) => n.startsWith("mem_")],
        ["hardware", (n) => ["manufacturer", "model", "serial", "bios_version", "enclosure", "sp_version"].includes(n)],
    ],
    organisation: [
        ["location", (n) => n.startsWith("loc_")],
        ["team", (n) => n.startsWith("team_")],
        ["asset", (n) => ["asset_env", "node_env", "sec_zone"].includes(n)],
        ["network", (n) => ["connect_to", "listener_port"].includes(n)],
        ["hardware", (n) => ["manufacturer", "model", "serial", "bios_version", "enclosure", "sp_version"].includes(n)],
    ],
};

/**
 * The properties in their groups, in order, those left empty dropped; in a group, by
 * their label (`labelOf`, the title the api gives by default): the order the api
 * answers them in is not kept, so that a reload on an event does not shuffle them.
 */
export function propertyGroups(properties, labelOf = (p) => p.title ?? p.name) {
    const out = [];
    const byTitle = (a, b) => String(labelOf(a)).localeCompare(String(labelOf(b))) || String(a.name).localeCompare(String(b.name));
    for (const family of ["discovered", "organisation"]) {
        const own = properties.filter((p) => (family === "discovered") === (p.source === "probe")).sort(byTitle);
        const placed = new Set();
        for (const [group, test] of PROPERTY_GROUPS[family]) {
            const items = own.filter((p) => !placed.has(p.name) && test(p.name));
            items.forEach((p) => placed.add(p.name));
            if (items.length > 0) out.push({family, group, items});
        }
        const rest = own.filter((p) => !placed.has(p.name));
        if (rest.length > 0) out.push({family, group: "other", items: rest});
    }
    return out;
}

/** The views of the inventory, the hardware first. */
const INVENTORY_VIEWS = ["hardware", "disks", "addresses", "san", "packages", "accounts"];

/**
 * What the node is made of, as the agent pushes it to the collector (`om node
 * system …`): its hardware, disks, addresses, SAN, packages, users and groups. A
 * view at a time, as the daemon tab shows its own, chosen from a strip of chips
 * that count each; the long lists filtered and paged, the addresses grouped by
 * interface. The view is in the URL (`view`), as the tab is.
 */
function NodeInventory({node}) {
    const {t, i18n} = useTranslation();
    const hardware = useNodeResource(node, "system/hardware");
    const disks = useNodeResource(node, "system/disk");
    const addresses = useNodeResource(node, "system/ipaddress");
    const initiators = useNodeResource(node, "system/san/initiator");
    const paths = useNodeResource(node, "system/san/path");
    const packages = useNodeResource(node, "system/package");
    const users = useNodeResource(node, "system/user");
    const groups = useNodeResource(node, "system/group");
    const [packageFilter, setPackageFilter] = useState("");
    const [addressFilter, setAddressFilter] = useState("");
    const panel = usePanelSearch();
    const view = INVENTORY_VIEWS.includes(panel.view) ? panel.view : INVENTORY_VIEWS[0];
    const viewsId = useId();
    const id = (key) => `node-${key}-${node}`;
    const count = (resource) => (resource.data ? itemsOf(resource).length : undefined);

    const packageRows = useMemo(
        () => itemsOf(packages)
            .filter((p) => matches(packageFilter, p.name, p.version))
            .sort((a, b) => String(a.name).localeCompare(String(b.name))),
        [packages, packageFilter],
    );
    // By interface, then address: the addresses of an interface together, under its line.
    const addressRows = useMemo(
        () => itemsOf(addresses)
            .filter((a) => matches(addressFilter, a.intf, a.address, a.type, a.mac))
            .sort((a, b) => String(a.intf).localeCompare(String(b.intf)) || String(a.address).localeCompare(String(b.address))),
        [addresses, addressFilter],
    );
    const packagePaging = useLocalPaging("node-packages", packageRows.length);
    const addressPaging = useLocalPaging("node-addresses", addressRows.length);

    // Each view counted on its chip; red when it could not be read.
    const chip = (key, resources, mark) => ({
        key,
        label: t(`nodePanel.inventory.views.${key}`),
        mark,
        tone: resources.some((r) => r.error) ? "error" : "muted",
    });
    const countOf = (resource) => (resource.data ? <CategoryCount count={itemsOf(resource).length}/> : null);
    const chips = [
        chip("hardware", [hardware], countOf(hardware)),
        chip("disks", [disks], countOf(disks)),
        chip("addresses", [addresses], countOf(addresses)),
        chip("san", [initiators, paths], paths.data ? <CategoryCount count={itemsOf(paths).length}/> : null),
        chip("packages", [packages], countOf(packages)),
        chip("accounts", [users, groups], users.data || groups.data
            ? <CategoryCount count={itemsOf(users).length + itemsOf(groups).length}/> : null),
    ];

    const addressPage = addressPaging.page(addressRows);
    const views = {
        hardware: (
            <Loaded resource={hardware}>
                <DataTable label={t("nodePanel.inventory.hardware")} rows={itemsOf(hardware)} columns={[
                    {key: "type", label: t("common.type")},
                    {key: "class", label: t("nodePanel.columns.class")},
                    {key: "description", label: t("nodePanel.columns.description")},
                    {key: "driver", label: t("nodePanel.columns.driver"), className: "text-ink-muted"},
                    {key: "path", label: t("nodePanel.columns.path"), className: "font-mono text-data"},
                ]}/>
            </Loaded>
        ),
        disks: (
            <Loaded resource={disks}>
                <DataTable label={t("nodePanel.inventory.disks")} rowKey={(d) => d.id} rows={itemsOf(disks)} columns={[
                    {key: "devpath", label: t("nodePanel.columns.device"), className: "font-mono text-data"},
                    {key: "type", label: t("common.type")},
                    {key: "model", label: t("nodePanel.columns.model"), render: (d) => [String(d.vendor ?? "").trim(), d.model].filter(Boolean).join(" ")},
                    {key: "size", label: t("nodePanel.columns.size"), numeric: true, render: (d) => formatBytes(d.size, i18n.language)},
                    {
                        key: "objects",
                        label: t("nodePanel.columns.objects"),
                        // Each the badge of its instance on this node.
                        render: (d) => (
                            <span className="inline-flex flex-wrap gap-1">
                                {[...new Set((d.regions ?? []).map((r) => r.object).filter(Boolean))].map((path) => (
                                    <InstanceLink key={path} path={path} node={node} label={path}/>
                                ))}
                            </span>
                        ),
                    },
                ]}/>
            </Loaded>
        ),
        addresses: (
            <div className="space-y-3">
                {addresses.data && (
                    <div className="flex">
                        <FilterField label={t("nodePanel.inventory.filterAddresses")} value={addressFilter} onChange={(value) => {
                            setAddressFilter(value);
                            addressPaging.setOffset(0);
                        }}/>
                    </div>
                )}
                <Loaded resource={addresses}>
                    <Pager paging={addressPaging}/>
                    <Table aria-label={t("nodePanel.inventory.addresses")}>
                        <thead>
                            <HeaderRow>
                                <HeaderCell>{t("nodePanel.columns.address")}</HeaderCell>
                                <HeaderCell>{t("common.type")}</HeaderCell>
                                <HeaderCell>{t("nodePanel.columns.mac")}</HeaderCell>
                            </HeaderRow>
                        </thead>
                        <tbody>
                            {addressPage.map((a, i) => (
                                <React.Fragment key={`${a.intf} ${a.address} ${i}`}>
                                    {/* A line opening the addresses of an interface, and the page, which may start inside them. */}
                                    {(i === 0 || addressPage[i - 1].intf !== a.intf) && (
                                        <tr data-interface-row={a.intf} className="h-[1.875rem] border-b border-line bg-surface-sunken">
                                            <th scope="rowgroup" colSpan={3} className="px-2 py-1 text-left font-semibold text-ink">{a.intf}</th>
                                        </tr>
                                    )}
                                    <Row>
                                        <Cell className="font-mono text-data">{a.mask ? `${a.address}/${a.mask}` : a.address}</Cell>
                                        <Cell>{a.type}</Cell>
                                        <Cell className="font-mono text-data text-ink-muted">{a.mac}</Cell>
                                    </Row>
                                </React.Fragment>
                            ))}
                            {addressPage.length === 0 && <EmptyRow colSpan={3}>{t("nodePanel.none")}</EmptyRow>}
                        </tbody>
                    </Table>
                </Loaded>
            </div>
        ),
        san: (
            <div className="space-y-6">
                <Section id={id("initiators")} title={t("nodePanel.inventory.initiators")} count={count(initiators)}>
                    <Loaded resource={initiators}>
                        <DataTable label={t("nodePanel.inventory.initiators")} rows={itemsOf(initiators)} columns={[
                            {key: "name", label: t("nodePanel.columns.initiator"), className: "font-mono text-data"},
                            {key: "type", label: t("common.type")},
                        ]}/>
                    </Loaded>
                </Section>
                <Section id={id("paths")} title={t("nodePanel.inventory.paths")} count={count(paths)}>
                    <Loaded resource={paths}>
                        <DataTable label={t("nodePanel.inventory.paths")} rows={itemsOf(paths)} columns={[
                            {key: "initiator", label: t("nodePanel.columns.initiator"), className: "font-mono text-data", render: (p) => p.initiator?.name ?? ""},
                            {key: "target", label: t("nodePanel.columns.target"), className: "font-mono text-data", render: (p) => p.target?.name ?? ""},
                            {key: "type", label: t("common.type"), render: (p) => p.target?.type ?? p.initiator?.type ?? ""},
                        ]}/>
                    </Loaded>
                </Section>
            </div>
        ),
        packages: (
            <div className="space-y-3">
                {packages.data && (
                    <div className="flex">
                        <FilterField label={t("nodePanel.inventory.filterPackages")} value={packageFilter} onChange={(value) => {
                            setPackageFilter(value);
                            packagePaging.setOffset(0);
                        }}/>
                    </div>
                )}
                <Loaded resource={packages}>
                    <Pager paging={packagePaging}/>
                    <DataTable label={t("nodePanel.inventory.packages")} rows={packagePaging.page(packageRows)} columns={[
                        {key: "name", label: t("common.name")},
                        {key: "version", label: t("nodePanel.columns.version"), className: "font-mono text-data"},
                        {key: "arch", label: t("nodePanel.columns.arch"), className: "text-ink-muted"},
                        {key: "type", label: t("common.type"), className: "text-ink-muted"},
                    ]}/>
                </Loaded>
            </div>
        ),
        accounts: (
            <div className="grid gap-6 md:grid-cols-2">
                <Section id={id("users")} title={t("nodePanel.inventory.users")} count={count(users)}>
                    <Loaded resource={users}>
                        <DataTable label={t("nodePanel.inventory.users")} rows={itemsOf(users)} columns={[
                            {key: "name", label: t("common.name")},
                            {key: "id", label: t("nodePanel.columns.id"), numeric: true},
                        ]}/>
                    </Loaded>
                </Section>
                <Section id={id("groups")} title={t("nodePanel.inventory.groups")} count={count(groups)}>
                    <Loaded resource={groups}>
                        <DataTable label={t("nodePanel.inventory.groups")} rows={itemsOf(groups)} columns={[
                            {key: "name", label: t("common.name")},
                            {key: "id", label: t("nodePanel.columns.id"), numeric: true},
                        ]}/>
                    </Loaded>
                </Section>
            </div>
        ),
    };

    return (
        <div className="space-y-4">
            <CategoryTabs
                label={t("nodePanel.inventory.views.label")}
                idPrefix={viewsId}
                tabs={chips}
                active={view}
                onSelect={(next) => panel.setView(next === INVENTORY_VIEWS[0] ? undefined : next)}
            />
            <div {...tabPanelProps(viewsId, view)}>
                {views[view]}
            </div>
        </div>
    );
}

/**
 * The configuration file of the node (`om node config show` / `edit`), edited in
 * place. Shown, its secrets are redacted, node.uuid say, as the object configuration
 * shows its own: the daemon redacts them (`redact-secrets`), until the eye shows
 * them for a while. Edited, it is read whole. The daemon writes the whole file: one
 * changed since the edit started is not overwritten.
 */
function NodeConfig({node}) {
    const {t} = useTranslation();
    const [showSecrets, setShowSecrets] = useState(false);
    const secondsLeft = useAutoHide(showSecrets, () => setShowSecrets(false));
    const file = useNodeResource(node, `config/file?redact-secrets=${!showSecrets}`, {text: true});
    // The edit in progress, kept when a tab of the panel is left: found again on coming back.
    const [edit, setEdit] = useEditDraft(`node\u0000${node}`);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [evalOpen, setEvalOpen] = useState(false);
    // The configuration validated on the node, the cluster's merged (om node config
    // validate): stale once the file is written.
    const validation = useConfigValidation(nodeUrl(node, "config/validate"));

    // The file as stored, its secrets in clear: what an edit starts from and writes back.
    const read = async () => {
        const response = await fetch(nodeUrl(node, "config/file?redact-secrets=false"), {headers: authHeaders(), cache: "no-cache"});
        if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
        return response.text();
    };

    const startEdit = async () => {
        setError(null);
        try {
            const text = await read();
            setEdit({base: text, text});
        } catch (err) {
            setError(t("nodePanel.config.readFailed", {message: err.message}));
        }
    };

    const write = {action: "config", label: t("actionTray.writes.configFile"), subject: node};

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            if ((await read()) !== edit.base) {
                setError(t("config.feedback.conflict"));
                return;
            }
            const response = await fetch(nodeUrl(node, "config/file"), {
                method: "PUT",
                headers: {...authHeaders(), "Content-Type": "application/octet-stream"},
                body: edit.text,
            });
            // What came of it, the actions tray says; refused, the editor stays open and says why.
            if (!response.ok) {
                const detail = await getResponseErrorMessage(response);
                trackRefused({...write, reason: refusalReason({status: response.status, detail})});
                setError(t("config.feedback.updateFailed", {message: detail || `HTTP ${response.status}`}));
                return;
            }
            trackDone(write);
            setEdit(null);
            validation.reset();
            file.reload();
        } catch (err) {
            trackRefused({...write, reason: err.message});
            setError(t("config.feedback.updateFailed", {message: err.message}));
        } finally {
            setSaving(false);
        }
    };

    if (edit !== null) {
        return (
            <div className="space-y-2">
                {error && <Alert tone="error">{error}</Alert>}
                <Textarea
                    aria-label={t("nodePanel.config.file")}
                    value={edit.text}
                    onChange={(e) => setEdit({...edit, text: e.target.value})}
                    disabled={saving}
                    spellCheck={false}
                    rows={Math.min(30, Math.max(10, edit.text.split("\n").length + 1))}
                    className="font-mono text-data whitespace-pre"
                />
                <div className="flex justify-end gap-2">
                    <Button onClick={() => {
                        setEdit(null);
                        setError(null);
                    }} disabled={saving}>{t("common.cancel")}</Button>
                    <Button onClick={save} disabled={saving || edit.text === edit.base}
                            icon={saving ? <Spinner label={t("config.view.saving")}/> : undefined}>
                        {t("common.save")}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {/* Each button its word beside its icon, as in the configuration of an object. */}
            <div className="flex flex-wrap items-center justify-end gap-1.5">
                {file.data !== null && !file.loading && (
                    <p className="mr-auto text-data text-ink-muted">
                        {showSecrets
                            ? t("config.view.secretsMaskedIn", {time: formatSeconds(secondsLeft)})
                            : t("config.view.secretsHidden")}
                    </p>
                )}
                <Button
                    size="sm"
                    aria-label={showSecrets ? t("config.view.hideSecrets") : t("config.view.showSecrets")}
                    aria-pressed={showSecrets}
                    icon={showSecrets ? <EyeOffIcon/> : <EyeIcon/>}
                    onClick={() => setShowSecrets((shown) => !shown)}
                    disabled={file.loading}
                >
                    {showSecrets ? t("config.view.hideSecretsShort") : t("config.view.showSecretsShort")}
                </Button>
                <Button size="sm" aria-label={t("nodePanel.config.edit")} icon={<PencilIcon/>} onClick={startEdit} disabled={file.loading}>
                    {t("config.view.editShort")}
                </Button>
                <Button size="sm" aria-label={t("configEval.open")} icon={<CodeIcon/>} onClick={() => setEvalOpen(true)}>
                    {t("config.view.evaluateShort")}
                </Button>
                <ValidateButton onClick={() => void validation.validate()} disabled={validation.result?.loading === true}/>
            </div>
            <ConfigValidationResult result={validation.result} onClose={validation.reset}/>
            {/* The node's own configuration, evaluated on it: no other node to impersonate. */}
            <ConfigEvalDialog open={evalOpen} onClose={() => setEvalOpen(false)} configUrl={nodeUrl(node, "config")}
                              subject={node} nodes={null}/>
            {error && <Alert tone="error">{error}</Alert>}
            <Loaded resource={file}>
                <ConfigText text={file.data ?? ""} label={t("nodePanel.config.file")}
                            keywordsUrl={nodeUrl(node, "config/keywords")}/>
            </Loaded>
        </div>
    );
}

/** The tasks the daemon schedules on the node (`om node schedule list`). */
function NodeSchedules({node}) {
    const {t, i18n} = useTranslation();
    const schedules = useNodeResource(node, "schedule");
    const when = (value) => (isSet(value) ? <RelativeTime value={value} locale={i18n.language}/> : "–");
    const requirements = (s) => [
        s.require,
        s.require_collector ? t("nodePanel.schedules.collector") : "",
        s.require_provisioned ? t("nodePanel.schedules.provisioned") : "",
    ].filter(Boolean).join(", ");
    return (
        <Loaded resource={schedules}>
            <DataTable label={t("nodePanel.tabs.schedules")} rowKey={(s) => s.key} rows={itemsOf(schedules)} columns={[
                {key: "action", label: t("nodePanel.columns.action"), className: "font-medium"},
                {key: "schedule", label: t("nodePanel.columns.schedule"), className: "font-mono text-data", render: (s) => s.schedule || t("nodePanel.schedules.unscheduled")},
                {key: "last_run_at", label: t("nodePanel.columns.lastRun"), render: (s) => when(s.last_run_at)},
                {key: "next_run_at", label: t("nodePanel.columns.nextRun"), render: (s) => when(s.next_run_at)},
                {key: "require", label: t("nodePanel.columns.requires"), className: "text-ink-muted", render: requirements},
                {key: "key", label: t("nodePanel.columns.keyword"), className: "font-mono text-data text-ink-muted"},
            ]}/>
        </Loaded>
    );
}

/** Which drivers the chips show: every one, those the node can run, those it cannot. */
const DRIVER_VIEWS = ["all", "usable", "unusable"];
/** The views of the drivers tab, each on its chip: the drivers first. */
const DRIVER_SECTIONS = ["drivers", "tools", "capabilities"];

/**
 * The drivers built in the agent (`om node drivers`), each usable on the node or
 * not as its capabilities say (`om node capabilities list`, app/driver-caps), what
 * each can do there besides; the tools of the node, and every capability as the
 * node lists it, each a view on its chip at the head of the tab, its count on it,
 * the filter reading them all. Scanned again on demand (`om node capabilities scan`), read
 * again once the scan is done; what comes of it, the actions tray says.
 */
function NodeDrivers({node}) {
    const {t} = useTranslation();
    const drivers = useNodeResource(node, "drivers");
    const capabilities = useNodeResource(node, "capabilities");
    const [filter, setFilter] = useState("");
    const [view, setView] = useState(DRIVER_VIEWS[0]);
    const panel = usePanelSearch();
    const section = DRIVER_SECTIONS.includes(panel.view) ? panel.view : DRIVER_SECTIONS[0];
    const sectionsId = useId();
    // The scan asked: `{execId}`, its exec followed in the tray, null when none runs.
    const [scan, setScan] = useState(null);
    const scanState = useActionTracker((s) => (scan?.execId ? s.tracked.find((e) => e.followedId === scan.execId)?.state : undefined));
    const reloadCapabilities = capabilities.reload;
    useEffect(() => {
        if (scan?.execId && scanState !== undefined && scanState !== "running") {
            setScan(null);
            reloadCapabilities();
        }
    }, [scan, scanState, reloadCapabilities]);

    const rescan = async () => {
        const action = "capabilities";
        const {url} = nodeActionRequest(node, action);
        setScan({execId: null});
        try {
            const response = await fetch(url, {method: "POST", headers: {...authHeaders(), "Content-Type": "application/json"}});
            if (!response.ok) {
                const detail = await getResponseErrorMessage(response);
                trackRefused({action, subject: node, reason: refusalReason({status: response.status, detail})});
                setScan(null);
                return;
            }
            const body = await response.clone().json().catch(() => null);
            await trackResponse(response, {action, subject: node, node});
            if (body?.exec_id) {
                setScan({execId: body.exec_id});
            } else {
                // Scanned before the daemon answered: read again now.
                setScan(null);
                reloadCapabilities();
            }
        } catch (error) {
            trackRefused({action, subject: node, reason: error.message});
            setScan(null);
        }
    };

    const caps = itemsOf(capabilities).map((c) => c.name);
    const rows = driverRows(itemsOf(drivers).map((d) => d.name), caps);
    const counts = {
        all: rows.length,
        usable: rows.filter((r) => r.usable).length,
        unusable: rows.filter((r) => !r.usable).length,
    };
    const shown = rows.filter((r) => (view === "all" || r.usable === (view === "usable"))
        && matches(filter, r.id, driverCap(r.id), ...r.features));
    const tools = nodeTools(caps).filter((name) => matches(filter, name));
    const allCaps = caps.filter((name) => matches(filter, name)).sort();
    // The count of each view, what the filter keeps of it, once read.
    const sectionCounts = {
        drivers: drivers.data && capabilities.data ? rows.filter((r) => matches(filter, r.id, driverCap(r.id), ...r.features)).length : undefined,
        tools: capabilities.data ? tools.length : undefined,
        capabilities: capabilities.data ? allCaps.length : undefined,
    };
    const sections = DRIVER_SECTIONS.map((key) => ({
        key,
        label: t(`nodePanel.drivers.${key}`),
        mark: sectionCounts[key] === undefined ? undefined : <CategoryCount count={sectionCounts[key]}/>,
    }));
    const list = (label, items) => (
        <ul aria-label={label} className="flex flex-wrap gap-1">
            {items.map((name) => (
                <li key={name} className="rounded-(--radius-control) border border-line bg-surface-raised px-1.5 font-mono text-data">{name}</li>
            ))}
            {items.length === 0 && <li className="text-ink-muted">{t("nodePanel.none")}</li>}
        </ul>
    );
    const scanning = scan !== null;
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" icon={scanning ? <Spinner label={t("nodePanel.drivers.scanning")}/> : <RefreshIcon className="h-3.5 w-3.5"/>}
                        onClick={rescan} disabled={scanning}>
                    {scanning ? t("nodePanel.drivers.scanning") : t("nodePanel.drivers.rescan")}
                </Button>
                <FilterField label={t("nodePanel.drivers.filter")} value={filter} onChange={setFilter}/>
            </div>
            <CategoryTabs
                label={t("nodePanel.drivers.sections")}
                idPrefix={sectionsId}
                tabs={sections}
                active={section}
                onSelect={(next) => panel.setView(next === DRIVER_SECTIONS[0] ? undefined : next)}
            />
            <div {...tabPanelProps(sectionsId, section)} className="space-y-3">
                {section === "drivers" && (
                    <Loaded resource={drivers}>
                        <Loaded resource={capabilities}>
                            <p className="text-ink-muted">{t("nodePanel.drivers.intro")}</p>
                            {/* Which drivers, a filter of the table: a select, not chips, apart from the views of the tab. */}
                            <label className="flex w-fit items-center gap-2 text-ink-muted">
                                {t("nodePanel.drivers.views.label")}
                                <Select className="h-7" value={view} onChange={(e) => setView(e.target.value)}>
                                    {DRIVER_VIEWS.map((key) => (
                                        <option key={key} value={key}>{t(`nodePanel.drivers.views.${key}`)} ({counts[key]})</option>
                                    ))}
                                </Select>
                            </label>
                            <div>
                                <DataTable
                                    label={t("nodePanel.drivers.drivers")}
                                    rows={shown}
                                    rowKey={(r) => r.id}
                                    columns={[
                                        {key: "id", label: t("nodePanel.drivers.columns.driver"), className: "font-mono text-data"},
                                        {
                                            key: "usable",
                                            label: t("nodePanel.drivers.columns.usable"),
                                            render: (r) => (r.usable
                                                ? <span className="text-state-up">{t("nodePanel.drivers.usable")}</span>
                                                : <span className="text-ink-muted">{t("nodePanel.drivers.unusable")}</span>),
                                        },
                                        {key: "features", label: t("nodePanel.drivers.columns.features"), className: "font-mono text-data text-ink-muted", render: (r) => r.features.join(" ")},
                                    ]}
                                />
                            </div>
                        </Loaded>
                    </Loaded>
                )}
                {section === "tools" && (
                    <Loaded resource={capabilities}>
                        <p className="text-ink-muted">{t("nodePanel.drivers.toolsIntro")}</p>
                        {list(t("nodePanel.drivers.tools"), tools)}
                    </Loaded>
                )}
                {section === "capabilities" && (
                    <Loaded resource={capabilities}>
                        <p className="text-ink-muted">{t("nodePanel.drivers.capabilitiesIntro")}</p>
                        {list(t("nodePanel.drivers.capabilities"), allCaps)}
                    </Loaded>
                )}
            </div>
        </div>
    );
}

/**
 * A node: its state, properties and actions, then its inventory, configuration,
 * schedules, drivers, daemon, events and logs, a tab each, as oc3 gives a node its tabs. The state
 * tab stays mounted under the others: its event stream and its actions hold.
 */
export function NodeDetailPanel({node, tab, onTabChange, onClose}) {
    const {t} = useTranslation();
    const open = node !== undefined;
    // The orchestration whose logs the badge asked for: the logs tab shows its only.
    const [logsOrchestration, setLogsOrchestration] = useState(null);
    useEffect(() => setLogsOrchestration(null), [node]);
    const showOrchestrationLogs = (id) => {
        setLogsOrchestration(id);
        onTabChange("logs");
    };
    // As every panel: its own views, then its configuration, its logs, its events (RecordPanel).
    const tabs = ["status", "inventory", "schedules", "drivers", "daemon", "config", "logs", "events"]
        .map((key) => ({key, label: t(`nodePanel.tabs.${key}`)}));
    return (
        <RecordPanel
            open={open}
            kind="node"
            recordId={node}
            title={node ?? ""}
            onClose={onClose}
            tabs={tabs}
            tab={tab}
            onTabChange={onTabChange}
            closeOnOutsideClick={false}
        >
            {(active) => (
                <>
                    <div hidden={active !== "status"}>
                        <NodeStatusTab key={node} node={node} onOrchestrationLogs={showOrchestrationLogs}/>
                    </div>
                    {active === "inventory" && <NodeInventory key={node} node={node}/>}
                    {active === "config" && <NodeConfig key={node} node={node}/>}
                    {active === "schedules" && <NodeSchedules key={node} node={node}/>}
                    {active === "drivers" && <NodeDrivers key={node} node={node}/>}
                    {active === "daemon" && <NodeDaemon key={node} node={node}/>}
                    {active === "events" && (
                        <div className="h-[calc(100dvh-10rem)]">
                            <EventLog key={node} eventTypes={NODE_EVENT_TYPES} nodeName={node} label={t("nodePanel.tabs.events")}/>
                        </div>
                    )}
                    {active === "logs" && (
                        <div className="flex h-[calc(100dvh-10rem)] flex-col gap-2">
                            <OrchestrationLogsFilter id={logsOrchestration} onClear={() => setLogsOrchestration(null)}/>
                            <div className="min-h-0 flex-1">
                                <LogsViewer
                                    key={`${node}/${logsOrchestration}`}
                                    nodename={node}
                                    type="node"
                                    height="100%"
                                    filters={logsOrchestration ? [`ORCHESTRATION_ID=${logsOrchestration}`] : []}
                                />
                            </div>
                        </div>
                    )}
                </>
            )}
        </RecordPanel>
    );
}
