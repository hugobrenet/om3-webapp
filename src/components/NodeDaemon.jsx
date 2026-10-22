import React, {useEffect, useId, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_CLUSTER_STATUS} from "../config/apiPath.js";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {getResponseErrorMessage} from "../services/api.jsx";
import {UNTIL_TIMEOUT_MS, trackDone, trackPoll, trackRefused, trackUntil} from "../app/action-tracker";
import {streamOf, streamReached} from "../app/heartbeat-progress";
import {refusalReason} from "./objectActions";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {MenuButton} from "../ui/components/MenuButton";
import {RelativeTime} from "../ui/components/RelativeTime";
import {StatusMark} from "../ui/components/StatusMark";
import {BoltIcon, RefreshIcon} from "../ui/icons";
import {CategoryCount, CategoryTabs} from "../ui/components/CategoryTabs";
import {Pager} from "../ui/components/Pager";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {tabPanelProps} from "../ui/components/tabs-ids";
import {useLocalPaging} from "../app/paging";
import {usePanelSearch} from "../app/panel-search";
import {CrossLink} from "../app/CrossLink";
import {
    DataTable,
    FilterField,
    Loaded,
    Section,
    authHeaders,
    isSet,
    itemsOf,
    matches,
    nodeUrl,
    useApiResource,
} from "./NodePanel";

/*
 * The daemon of a node, as `om daemon` shows and drives it: its components and
 * their state, its listener, its heartbeats, the orchestrations it
 * runs and the commands it executes, and the DNS zone it serves. Read from the API
 * of om3 main (daemon/*), each action confirmed first.
 *
 * A view at a time, chosen from a strip of chips that sums each up: the overview
 * (the components, the listener among them, and the heartbeats), the executions,
 * the orchestrations and the DNS records, the long lists paged. The view is in the
 * URL (`view`), as the tab is.
 */

/** The views of the tab, the overview first. */
const VIEWS = ["overview", "executions", "orchestrations", "dns"];

/** The components of the daemon the node status reports, in the order of `om daemon status`. */
const COMPONENTS = ["listener", "dns", "scheduler", "runner_imon", "collector", "daemondata"];

/** The listener the API answers start, stop and restart for: api.ux lives as long as the daemon. */
const LISTENER = "api.inet";

/** What a read answers, as JSON; throws on a refusal, for the read to be tried again. */
const readJson = async (url) => {
    const response = await fetch(url, {headers: authHeaders()});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
};

/** A component or a stream state as a mark: running is up, stopped or failed down. */
const markOf = (state) =>
    ["running", "speaker"].includes(state) ? "up" : ["stopped", "failed", "error"].includes(state) ? "down" : "warn";

/** A heartbeat stream id, "hb#1.rx", as the heartbeat it belongs to, "1", which sign and wipe take. */
export const heartbeatOf = (streamId) => streamId.replace(/^hb#/, "").replace(/\.(rx|tx)$/, "");

/** What a component tells beyond its state: its address, its servers, its limits. */
function componentDetail(id, component) {
    if (!component) return "";
    if (id === "listener") return component.addr !== undefined ? `${component.addr}:${component.port}` : "";
    if (id === "dns") return (component.nameservers ?? []).join(", ");
    if (id === "collector") return component.url ?? "";
    if (component.max_running !== undefined) return `max ${component.max_running}`;
    if (component.queue_size !== undefined) return `queue ${component.queue_size}`;
    return "";
}

/** The events that keep the heartbeats current, as on the Heartbeats view. */
const HEARTBEAT_EVENTS = ["DaemonHeartbeatUpdated"];

const byStartDesc = (a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? ""));

export function NodeDaemon({node}) {
    const {t, i18n} = useTranslation();
    const status = useApiResource(URL_CLUSTER_STATUS);
    const orchestrations = useApiResource(nodeUrl(node, "daemon/orchestration"));
    const execs = useApiResource(nodeUrl(node, "daemon/exec"));
    const dns = useApiResource(nodeUrl(node, "daemon/dns/dump"));

    // The action asked for, waiting for its confirmation: its question and its request.
    const [pending, setPending] = useState(null);
    const [busy, setBusy] = useState(false);
    const [execFilter, setExecFilter] = useState("");
    const [dnsFilter, setDnsFilter] = useState("");
    const panel = usePanelSearch();
    const view = VIEWS.includes(panel.view) ? panel.view : VIEWS[0];
    const viewsId = useId();

    const daemon = status.data?.cluster?.node?.[node]?.daemon;
    // The heartbeats, kept current by their events once one came; the cluster status until then.
    const liveHeartbeat = useEventStore((state) => state.heartbeatStatus?.[node]);
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, HEARTBEAT_EVENTS) : null;
        return () => release?.();
    }, []);
    const when = (value) => (isSet(value) ? <RelativeTime value={value} locale={i18n.language}/> : "–");
    const reloadAll = () => [status, orchestrations, execs, dns].forEach((r) => r.reload());

    /**
     * Sends a request of the daemon and reads again what it changed; what comes of it,
     * the actions tray says, followed as `follow` tells: a heartbeat stream until the
     * events show it in the state asked, the listener or an exec until a read again
     * does, a disk heartbeat signed or wiped done when the daemon answers.
     */
    const send = async ({action, label, subject, method = "POST", path, body, reload, follow}) => {
        setBusy(true);
        const info = {action, label, subject};
        const lost = t("actionTray.noNews", {seconds: UNTIL_TIMEOUT_MS / 1000});
        // What a restart is told by, read before it is asked.
        const streamBefore = follow.kind === "stream"
            ? streamOf(useEventStore.getState(), node, follow.id)?.created_at ?? streams.find((s) => s.id === follow.id)?.created_at
            : undefined;
        // A listener restarted keeps its creation time: its update time tells it.
        const listenerBefore = daemon?.listener;
        try {
            const response = await fetch(nodeUrl(node, path), {
                method,
                headers: {...authHeaders(), ...(body ? {"Content-Type": "application/json"} : {})},
                body: body ? JSON.stringify(body) : undefined,
            });
            if (!response.ok) {
                const detail = await getResponseErrorMessage(response);
                trackRefused({...info, reason: refusalReason({status: response.status, detail})});
                return;
            }
            if (follow.kind === "stream") {
                trackUntil(info, streamReached({node, id: follow.id, action, createdBefore: streamBefore}), {lost});
            } else if (follow.kind === "listener") {
                trackPoll(info, async () => {
                    const listener = (await readJson(URL_CLUSTER_STATUS))?.cluster?.node?.[node]?.daemon?.listener;
                    if (action === "stop") return listener?.state === "stopped";
                    return listener?.state === "running" && (action === "start"
                        || listener.created_at !== listenerBefore?.created_at || listener.updated_at !== listenerBefore?.updated_at);
                }, {lost});
            } else if (follow.kind === "exec") {
                // Signaled, it is done once it runs no more; dropped by the daemon (410), long ended.
                trackPoll(info, async () => {
                    const response = await fetch(nodeUrl(node, `daemon/exec/id/${encodeURIComponent(follow.execId)}`), {headers: authHeaders()});
                    if (response.status === 410) return true;
                    return response.ok && (await response.json())?.state !== "running";
                }, {lost});
            } else {
                trackDone(info);
            }
            (reload ?? [status]).forEach((r) => r.reload());
        } catch (error) {
            trackRefused({...info, reason: error.message});
        } finally {
            setBusy(false);
        }
    };

    /** Asks for an action, confirmed before it is sent. */
    const ask = (request) => setPending(request);
    const confirm = () => {
        const request = pending;
        setPending(null);
        void send(request);
    };

    const streams = (liveHeartbeat ?? daemon?.heartbeat)?.streams ?? [];
    // Live, the heartbeats wait for nothing else: neither the cluster status nor its error.
    const heartbeatSource = liveHeartbeat ? {data: liveHeartbeat, loading: false, error: null} : status;

    const execRows = useMemo(
        () => itemsOf(execs)
            .filter((e) => matches(execFilter, e.path, e.command, e.origin, e.state, e.exec_id))
            // The running ones first, the ones a signal can stop; then the latest first.
            .sort((a, b) => (b.state === "running") - (a.state === "running") || byStartDesc(a, b)),
        [execs, execFilter]
    );
    // By name, then type: the records of a name together, under the line of the name.
    const dnsRows = useMemo(
        () => (Array.isArray(dns.data) ? dns.data : [])
            .filter((r) => matches(dnsFilter, r.qname, r.qtype, r.content))
            .sort((a, b) => String(a.qname).localeCompare(String(b.qname)) || String(a.qtype).localeCompare(String(b.qtype))),
        [dns.data, dnsFilter]
    );
    // In progress first, then the latest first.
    const orchestrationRows = useMemo(
        () => [...itemsOf(orchestrations)].sort((a, b) => (!isSet(b.ended_at)) - (!isSet(a.ended_at)) || byStartDesc(a, b)),
        [orchestrations]
    );
    const execPaging = useLocalPaging("node-daemon-execs", execRows.length);
    const dnsPaging = useLocalPaging("node-daemon-dns", dnsRows.length);
    const filterExecs = (value) => {
        setExecFilter(value);
        execPaging.setOffset(0);
    };
    const filterDns = (value) => {
        setDnsFilter(value);
        dnsPaging.setOffset(0);
    };

    const streamActions = (stream) => {
        const target = t("nodeDaemon.heartbeats.target", {id: stream.id, node});
        const items = ["start", "stop", "restart"].map((action) => ({
            key: action,
            label: t(`nodeDaemon.actions.${action}`),
            onSelect: () => ask({
                action,
                label: t(`nodeDaemon.actions.${action}`),
                subject: target,
                question: t(`nodeDaemon.heartbeats.confirm.${action}`, {target}),
                // The name without its "hb#", which om3 accepts too but a URL must escape.
                path: `daemon/hb/name/${encodeURIComponent(stream.id.replace(/^hb#/, ""))}/action/${action}`,
                follow: {kind: "stream", id: stream.id},
            }),
        }));
        // A disk heartbeat is signed and wiped as a whole, both its streams.
        if (stream.type === "disk") {
            const hb = heartbeatOf(stream.id);
            for (const action of ["sign", "wipe"]) {
                items.push({
                    key: action,
                    label: t(`nodeDaemon.actions.${action}`),
                    onSelect: () => ask({
                        action,
                        label: t(`nodeDaemon.actions.${action}`),
                        subject: t("nodeDaemon.heartbeats.diskTarget", {hb, node}),
                        question: t(`nodeDaemon.heartbeats.confirm.${action}`, {target: t("nodeDaemon.heartbeats.diskTarget", {hb, node})}),
                        path: `daemon/hb/name/${encodeURIComponent(hb)}/action/${action}`,
                        follow: {kind: "done"},
                    }),
                });
            }
        }
        return items;
    };

    const listenerItems = ["start", "stop", "restart"].map((action) => ({
        key: action,
        label: t(`nodeDaemon.actions.${action}`),
        onSelect: () => ask({
            action,
            label: t(`nodeDaemon.actions.${action}`),
            subject: t("nodeDaemon.listener.target", {listener: LISTENER, node}),
            question: t(`nodeDaemon.listener.confirm.${action}`, {listener: LISTENER, node}),
            path: `daemon/listener/name/${LISTENER}/action/${action}`,
            follow: {kind: "listener"},
        }),
    }));

    // What each view sums up, on its chip.
    const components = daemon ? COMPONENTS.filter((id) => daemon[id]).map((id) => ({...daemon[id], id})) : [];
    const componentsUp = components.filter((c) => markOf(c.state) === "up").length;
    const streamBeating = (s) => s.state === "running" && Object.values(s.peers ?? {}).every((p) => p.is_beating);
    const beating = streams.filter(streamBeating).length;
    const overviewState = components.length === 0 && streams.length === 0 ? "unknown"
        : components.some((c) => markOf(c.state) === "down") || streams.some((s) => markOf(s.state) === "down") ? "down"
            : componentsUp < components.length || beating < streams.length ? "warn" : "up";
    const execRunning = itemsOf(execs).filter((e) => e.state === "running").length;
    const orchestrationRunning = orchestrationRows.filter((o) => !isSet(o.ended_at)).length;
    const dnsNames = new Set((Array.isArray(dns.data) ? dns.data : []).map((r) => r.qname)).size;
    const running = (count) => (count > 0
        ? <span className="text-data text-state-up">{t("nodeDaemon.summary.running", {count})}</span>
        : null);
    const chips = [
        {
            key: "overview",
            label: t("nodeDaemon.views.overview"),
            mark: <StatusMark state={overviewState} label={overviewState}/>,
            description: t("nodeDaemon.summary.overview", {up: componentsUp, components: components.length, beating, streams: streams.length}),
            tone: overviewState === "up" || overviewState === "unknown" ? "muted" : "strong",
        },
        {
            key: "executions",
            label: t("nodeDaemon.views.executions"),
            mark: <span className="inline-flex items-center gap-1">{running(execRunning)}{execs.data && <CategoryCount count={itemsOf(execs).length}/>}</span>,
            description: t("nodeDaemon.summary.executions", {count: itemsOf(execs).length, running: execRunning}),
            tone: execs.error ? "error" : execRunning > 0 ? "strong" : "muted",
        },
        {
            key: "orchestrations",
            label: t("nodeDaemon.views.orchestrations"),
            mark: <span className="inline-flex items-center gap-1">{running(orchestrationRunning)}{orchestrations.data && <CategoryCount count={orchestrationRows.length}/>}</span>,
            description: t("nodeDaemon.summary.orchestrations", {count: orchestrationRows.length, running: orchestrationRunning}),
            tone: orchestrations.error ? "error" : orchestrationRunning > 0 ? "strong" : "muted",
        },
        {
            key: "dns",
            label: t("nodeDaemon.views.dns"),
            mark: dns.data ? <CategoryCount count={Array.isArray(dns.data) ? dns.data.length : 0}/> : null,
            description: t("nodeDaemon.summary.dns", {count: Array.isArray(dns.data) ? dns.data.length : 0, names: dnsNames}),
            tone: dns.error ? "error" : "muted",
        },
    ];

    /** An object of the daemon's work, a badge opening it; the node's own, said so. */
    const objectOf = (path) => (path ? <CrossLink kind="object" id={path}>{path}</CrossLink> : t("nodeDaemon.orchestrations.node"));

    const overview = (
        <div className="space-y-6">
            <Section id={`daemon-components-${node}`} title={t("nodeDaemon.components.title")}>
                <Loaded resource={status}>
                    <DataTable
                        label={t("nodeDaemon.components.title")}
                        rowKey={(row) => row.id}
                        // Named by its key: the listener reports an empty id of its own.
                        rows={components}
                        columns={[
                            {key: "id", label: t("nodeDaemon.columns.component"), className: "font-medium", render: (c) => t(`nodeDaemon.components.${c.id}`, {defaultValue: c.id})},
                            {key: "state", label: t("common.status"), render: (c) => (
                                <span className="inline-flex items-center gap-1.5"><StatusMark state={markOf(c.state)} label={c.state}/>{c.state}</span>
                            )},
                            {key: "detail", label: t("nodeDaemon.columns.detail"), className: "font-mono text-data text-ink-muted", render: (c) => componentDetail(c.id, c)},
                            {key: "updated_at", label: t("nodeDaemon.columns.updated"), render: (c) => when(c.updated_at)},
                            // The listener started, stopped and restarted from its line.
                            {key: "actions", label: t("nodeDaemon.actions.label"), render: (c) => (c.id === "listener" ? (
                                <MenuButton
                                    solid
                                    text={t("statusBoard.actions.object")}
                                    icon={<BoltIcon className="h-3.5 w-3.5"/>}
                                    label={t("nodeDaemon.listener.actionsOf", {listener: LISTENER})}
                                    align="end"
                                    items={listenerItems}
                                />
                            ) : null)},
                        ]}
                    />
                </Loaded>
            </Section>

            <Section id={`daemon-heartbeats-${node}`} title={t("nodeDaemon.heartbeats.title")} count={liveHeartbeat || daemon ? streams.length : undefined}>
                <Loaded resource={heartbeatSource}>
                    <DataTable
                        label={t("nodeDaemon.heartbeats.title")}
                        rowKey={(s) => s.id}
                        rows={streams}
                        columns={[
                            {key: "id", label: t("nodeDaemon.columns.stream"), className: "font-mono text-data"},
                            {key: "type", label: t("common.type")},
                            {key: "state", label: t("common.status"), render: (s) => (
                                <span className="inline-flex items-center gap-1.5"><StatusMark state={markOf(s.state)} label={s.state}/>{s.state}</span>
                            )},
                            {key: "peers", label: t("nodeDaemon.columns.peers"), render: (s) => (
                                <span className="flex flex-wrap gap-2">
                                    {Object.entries(s.peers ?? {}).map(([peer, p]) => (
                                        <span key={peer} className="inline-flex items-center gap-1">
                                            <StatusMark
                                                state={p.is_beating ? "up" : "down"}
                                                label={p.is_beating ? t("heartbeats.marks.beating") : t("heartbeats.marks.stale")}
                                            />
                                            {peer || "–"}
                                        </span>
                                    ))}
                                </span>
                            )},
                            {key: "actions", label: t("nodeDaemon.actions.label"), render: (s) => (
                                <MenuButton
                                    solid
                                    text={t("statusBoard.actions.object")}
                                    icon={<BoltIcon className="h-3.5 w-3.5"/>}
                                    label={t("nodeDaemon.heartbeats.actionsOf", {id: s.id})}
                                    align="end"
                                    items={streamActions(s)}
                                />
                            )},
                        ]}
                    />
                </Loaded>
            </Section>
        </div>
    );

    const executions = (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <FilterField label={t("nodeDaemon.execs.filter")} value={execFilter} onChange={filterExecs}/>
            </div>
            <Loaded resource={execs}>
                <Pager paging={execPaging}/>
                <DataTable
                    label={t("nodeDaemon.execs.title")}
                    rowKey={(e) => e.exec_id}
                    rows={execPaging.page(execRows)}
                    columns={[
                        {key: "path", label: t("nodeDaemon.columns.object"), className: "whitespace-nowrap", render: (e) => objectOf(e.path)},
                        {key: "command", label: t("nodeDaemon.columns.command"), className: "font-mono text-data text-ink-muted"},
                        {key: "origin", label: t("nodeDaemon.columns.origin")},
                        // An exit in error said in red.
                        {key: "state", label: t("common.status"), render: (e) => {
                            const ended = e.exit_code !== undefined && e.state !== "running";
                            return (
                                <span className={ended && e.exit_code !== 0 ? "text-state-down" : undefined}>
                                    {ended ? `${e.state} (${e.exit_code})` : e.state}
                                </span>
                            );
                        }},
                        {key: "started_at", label: t("nodeDaemon.columns.started"), render: (e) => when(e.started_at)},
                        {key: "ended_at", label: t("nodeDaemon.columns.ended"), render: (e) => when(e.ended_at)},
                        {key: "signal", label: t("nodeDaemon.actions.label"), render: (e) => (e.state === "running" ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => ask({
                                    action: "terminate",
                                    label: t("nodeDaemon.execs.terminate"),
                                    subject: t("nodeDaemon.execs.target", {command: e.command, node}),
                                    question: t("nodeDaemon.execs.confirm", {command: e.command, node}),
                                    method: "DELETE",
                                    path: `daemon/exec?exec_id=${encodeURIComponent(e.exec_id)}&signal=TERM`,
                                    reload: [execs],
                                    follow: {kind: "exec", execId: e.exec_id},
                                })}
                            >
                                {t("nodeDaemon.execs.terminate")}
                            </Button>
                        ) : null)},
                    ]}
                />
            </Loaded>
        </div>
    );

    const orchestrationsView = (
        <Loaded resource={orchestrations}>
            <DataTable
                label={t("nodeDaemon.orchestrations.title")}
                rowKey={(o) => o.orchestration_id}
                rows={orchestrationRows}
                columns={[
                    {key: "path", label: t("nodeDaemon.columns.object"), className: "whitespace-nowrap", render: (o) => objectOf(o.path)},
                    {key: "expect", label: t("nodeDaemon.columns.expect")},
                    {key: "state", label: t("common.status"), render: (o) => (o.error ? `${o.state}: ${o.error}` : o.state)},
                    {key: "started_at", label: t("nodeDaemon.columns.started"), render: (o) => when(o.started_at)},
                    {key: "ended_at", label: t("nodeDaemon.columns.ended"), render: (o) => when(o.ended_at)},
                    {key: "orchestration_id", label: t("nodeDaemon.columns.id"), className: "font-mono text-data text-ink-muted"},
                ]}
            />
        </Loaded>
    );

    const dnsPage = dnsPaging.page(dnsRows);
    const dnsView = (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <FilterField label={t("nodeDaemon.dns.filter")} value={dnsFilter} onChange={filterDns}/>
            </div>
            <Loaded resource={dns}>
                <Pager paging={dnsPaging}/>
                <Table aria-label={t("nodeDaemon.dns.title")}>
                    <thead>
                        <HeaderRow>
                            <HeaderCell>{t("common.type")}</HeaderCell>
                            <HeaderCell className="text-right">{t("nodeDaemon.columns.ttl")}</HeaderCell>
                            <HeaderCell>{t("nodeDaemon.columns.content")}</HeaderCell>
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {dnsPage.map((r, i) => (
                            <React.Fragment key={`${r.qname} ${r.qtype} ${r.content} ${i}`}>
                                {/* A line opening the records of a name, and the page, which may start inside them. */}
                                {(i === 0 || dnsPage[i - 1].qname !== r.qname) && (
                                    <tr data-name-row={r.qname} className="h-[1.875rem] border-b border-line bg-surface-sunken">
                                        <th scope="rowgroup" colSpan={3} className="px-2 py-1 text-left font-mono text-data font-semibold text-ink">
                                            {r.qname}
                                        </th>
                                    </tr>
                                )}
                                <Row>
                                    <Cell>{r.qtype}</Cell>
                                    <Cell numeric className="text-right">{r.ttl}</Cell>
                                    <Cell className="font-mono text-data">{r.content}</Cell>
                                </Row>
                            </React.Fragment>
                        ))}
                        {dnsPage.length === 0 && <EmptyRow colSpan={3}>{t("nodePanel.none")}</EmptyRow>}
                    </tbody>
                </Table>
            </Loaded>
        </div>
    );

    const views = {overview, executions, orchestrations: orchestrationsView, dns: dnsView};

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-ink-muted">
                    {daemon ? (
                        <>
                            {t("nodeDaemon.pid", {pid: daemon.pid})}
                            {" · "}
                            {t("nodeDaemon.startedAt")} {when(daemon.started_at)}
                        </>
                    ) : null}
                </span>
                <Button size="sm" className="ml-auto" icon={<RefreshIcon className="h-3.5 w-3.5"/>} onClick={reloadAll}>
                    {t("nodeDaemon.refresh")}
                </Button>
            </div>

            {/* Each view summed up on its chip: what runs, how many, what is wrong. */}
            <CategoryTabs
                label={t("nodeDaemon.views.label")}
                idPrefix={viewsId}
                tabs={chips}
                active={view}
                onSelect={(next) => panel.setView(next === VIEWS[0] ? undefined : next)}
            />
            <div {...tabPanelProps(viewsId, view)}>
                {views[view]}
            </div>

            <Dialog
                open={pending !== null}
                onClose={() => setPending(null)}
                title={pending ? t("nodeDaemon.confirmTitle", {action: pending.label}) : ""}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setPending(null)}>{t("common.cancel")}</Button>
                        <Button onClick={confirm}>{t("common.confirm")}</Button>
                    </>
                }
            >
                <p className="text-ink">{pending?.question}</p>
            </Dialog>
        </div>
    );
}
