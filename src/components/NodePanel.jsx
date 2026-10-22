import React, {useEffect, useId, useMemo, useState} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
import {RecordPanel} from "../app/RecordPanel";
import {usePanelHeader} from "../app/panel-header";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {URL_NODE} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {nodeActionRequest, nodeMenuItems} from "../app/node-actions";
import {useApiNode} from "../hooks/useApiNode";
import {NodeActionDialog} from "./NodeActionDialog";
import LogsViewer from "./LogsViewer";
import {EventLog, NODE_EVENT_TYPES} from "./EventLogger";
import {ConfigText} from "./ConfigText";
import {monitorMark} from "./NodeRow";
import {MenuButton} from "../ui/components/MenuButton";
import {OrchestrationBadge, orchestrationOf} from "./OrchestrationBadge";
import {OrchestrationLogsFilter} from "./OrchestrationLogsFilter";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {Button, IconButton} from "../ui/components/Button";
import {Input, Textarea} from "../ui/components/Field";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {StatusMark} from "../ui/components/StatusMark";
import {FrozenMark} from "../ui/components/FrozenMark";
import {RelativeTime} from "../ui/components/RelativeTime";
import {BoltIcon, EyeIcon, EyeOffIcon, PencilIcon, SearchIcon} from "../ui/icons";
import {formatSeconds, useAutoHide} from "../ui/lib/reveal";
import {formatBytes, formatSizeMiB} from "../ui/lib/format";
import {NodeDaemon} from "./NodeDaemon";
import {InstanceLink} from "./RecordLinks";
import {CategoryCount, CategoryTabs} from "../ui/components/CategoryTabs";
import {tabPanelProps} from "../ui/components/tabs-ids";
import {Pager} from "../ui/components/Pager";
import {useLocalPaging} from "../app/paging";
import {usePanelSearch} from "../app/panel-search";
import {trackDone, trackRefused, trackResponse} from "../app/action-tracker";
import {refusalReason} from "./objectActions";

/*
 * The record panel of a cluster node, as oc3 gives its nodes one: its state and
 * properties, then one tab per kind of related data, read from the daemon API
 * (`/api/node/name/{node}/…`) as `om node` reads them.
 */

const ZERO_TIME = "0001-01-01T00:00:00Z";
export const isSet = (time) => !!time && time !== ZERO_TIME;

/** The events that keep the state of the nodes current, the Nodes view's. */
const NODE_EVENTS = ["NodeStatusUpdated", "NodeMonitorUpdated", "NodeStatsUpdated"];

export const nodeUrl = (node, path) => `${URL_NODE}/${encodeURIComponent(node)}/${path}`;
export const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

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

export const matches = (filter, ...values) => {
    const q = filter.trim().toLowerCase();
    return q === "" || values.some((v) => String(v ?? "").toLowerCase().includes(q));
};

/**
 * The actions on the node, in the title bar of its panel as oc3 places them: the
 * node actions of the Nodes view, by group, each confirmed first. Freeze or unfreeze,
 * by its state. Abort is no action of the menu: the badge of the orchestration in
 * progress offers it, with its logs.
 */
function NodeActions({node, frozen, monitor, onOrchestrationLogs}) {
    const {t} = useTranslation();
    const [pending, setPending] = useState(null);
    const {globalExpect, orchestrationId} = orchestrationOf([monitor]);
    const apiNode = useApiNode();
    const items = nodeMenuItems({
        t,
        nodes: [node],
        offered: (name) => !(name === "freeze" && frozen) && !(name === "unfreeze" && !frozen),
        apiNode,
        renderIcon: ({icon, color}) => <span aria-hidden="true" className={color === "red" ? DANGER_ICON : ICON}>{icon}</span>,
        onSelect: (name) => setPending({action: name, node}),
    });

    const run = async (action) => {
        setPending(null);
        // What comes of it, accepted or refused, the actions tray says.
        const {url, body} = nodeActionRequest(node, action);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {...authHeaders(), "Content-Type": "application/json"},
                ...(body === undefined ? {} : {body}),
            });
            if (!response.ok) {
                const detail = await getResponseErrorMessage(response);
                trackRefused({action, subject: node, reason: refusalReason({status: response.status, detail})});
                return;
            }
            await trackResponse(response, {action, subject: node, node});
        } catch (error) {
            trackRefused({action, subject: node, reason: error.message});
        }
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
                columns={3}
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
 * The state of the node, as the Nodes view tells it and kept current by its events,
 * then its properties as the agent probed them (`om node system property`).
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

    const frozen = isSet(status?.frozen_at);
    const mark = monitorMark(monitor);
    const none = "–";
    const facts = [
        ["state", (
            <span className="inline-flex items-center gap-1.5">
                <StatusMark state={mark.state} label={mark.label}/>
                {monitor?.state ?? t("common.unknown")}
            </span>
        )],
        ["frozen", frozen ? (
            <span className="inline-flex items-center gap-1.5">
                <FrozenMark frozen/>
                <RelativeTime value={status.frozen_at} locale={i18n.language}/>
            </span>
        ) : t("common.no")],
        ["leader", status?.is_leader ? t("common.yes") : t("common.no")],
        ["overloaded", status?.is_overloaded ? t("common.yes") : t("common.no")],
        ["agent", status?.agent || none],
        ["booted", isSet(status?.booted_at) ? <RelativeTime value={status.booted_at} locale={i18n.language}/> : none],
        ["score", stats?.score ?? none],
        ["load15m", stats?.load_15m ?? none],
        // The totals are in mebibytes.
        ["memAvail", stats?.mem_avail !== undefined
            ? t("nodePanel.status.ofTotal", {pct: stats.mem_avail, total: formatSizeMiB(stats.mem_total, i18n.language) || none})
            : none],
        ["swapAvail", stats?.swap_avail !== undefined
            ? t("nodePanel.status.ofTotal", {pct: stats.swap_avail, total: formatSizeMiB(stats.swap_total, i18n.language) || none})
            : none],
    ];

    return (
        <div className="space-y-4">
            {header.actions !== null && createPortal(
                <NodeActions node={node} frozen={frozen} monitor={monitor} onOrchestrationLogs={onOrchestrationLogs}/>,
                header.actions,
            )}
            <dl aria-label={t("nodePanel.status.title")} className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
                {facts.map(([key, value]) => (
                    <React.Fragment key={key}>
                        <dt className="text-ink-muted">{t(`nodePanel.status.${key}`)}</dt>
                        <dd>{value}</dd>
                    </React.Fragment>
                ))}
            </dl>
            <Section id={`node-properties-${node}`} title={t("nodePanel.status.properties")}
                     count={properties.data ? itemsOf(properties).length : undefined}>
                <Loaded resource={properties}>
                    <DataTable
                        label={t("nodePanel.status.properties")}
                        rowKey={(p) => p.name}
                        rows={itemsOf(properties)}
                        columns={[
                            {key: "title", label: t("nodePanel.columns.property")},
                            {
                                key: "value",
                                label: t("nodePanel.columns.value"),
                                className: "break-all",
                                render: (p) => p.error
                                    ? <span className="text-ink-muted">{p.error}</span>
                                    : String(p.value ?? ""),
                            },
                            {key: "source", label: t("nodePanel.columns.source"), className: "text-ink-muted"},
                        ]}
                    />
                </Loaded>
            </Section>
        </div>
    );
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
    const [edit, setEdit] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

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
            <div className="flex items-center justify-end gap-1">
                {file.data !== null && !file.loading && (
                    <p className="mr-auto text-data text-ink-muted">
                        {showSecrets
                            ? t("config.view.secretsMaskedIn", {time: formatSeconds(secondsLeft)})
                            : t("config.view.secretsHidden")}
                    </p>
                )}
                <IconButton
                    label={showSecrets ? t("config.view.hideSecrets") : t("config.view.showSecrets")}
                    aria-pressed={showSecrets}
                    onClick={() => setShowSecrets((shown) => !shown)}
                    disabled={file.loading}
                >
                    {showSecrets ? <EyeOffIcon/> : <EyeIcon/>}
                </IconButton>
                <IconButton label={t("nodePanel.config.edit")} onClick={startEdit} disabled={file.loading}>
                    <PencilIcon/>
                </IconButton>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <Loaded resource={file}>
                <ConfigText text={file.data ?? ""} label={t("nodePanel.config.file")}
                            keywordsUrl={nodeUrl(node, "config/keywords")} cacheKey="node"/>
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

/** What the node can run: the drivers of its agent, and the capabilities it found. */
function NodeDrivers({node}) {
    const {t} = useTranslation();
    const drivers = useNodeResource(node, "drivers");
    const capabilities = useNodeResource(node, "capabilities");
    const [filter, setFilter] = useState("");
    const names = (resource) => itemsOf(resource).map((d) => d.name).filter((name) => matches(filter, name)).sort();
    const list = (label, items) => (
        <ul aria-label={label} className="flex flex-wrap gap-1">
            {items.map((name) => (
                <li key={name} className="rounded-(--radius-control) border border-line bg-surface-raised px-1.5 font-mono text-data">{name}</li>
            ))}
            {items.length === 0 && <li className="text-ink-muted">{t("nodePanel.none")}</li>}
        </ul>
    );
    return (
        <div className="space-y-6">
            <div className="flex">
                <FilterField label={t("nodePanel.drivers.filter")} value={filter} onChange={setFilter}/>
            </div>
            <Section id={`node-drivers-${node}`} title={t("nodePanel.drivers.drivers")} count={drivers.data ? names(drivers).length : undefined}>
                <Loaded resource={drivers}>{list(t("nodePanel.drivers.drivers"), names(drivers))}</Loaded>
            </Section>
            <Section id={`node-capabilities-${node}`} title={t("nodePanel.drivers.capabilities")} count={capabilities.data ? names(capabilities).length : undefined}>
                <Loaded resource={capabilities}>{list(t("nodePanel.drivers.capabilities"), names(capabilities))}</Loaded>
            </Section>
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
    const tabs = ["status", "inventory", "config", "schedules", "drivers", "daemon", "events", "logs"]
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
