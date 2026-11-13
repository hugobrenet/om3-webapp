import React, {useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {useShallow} from "zustand/react/shallow";
import {useTranslation} from "react-i18next";
import {URL_CLUSTER_STATUS_NODES, URL_RESOURCES, URL_STORE} from "../config/apiPath.js";
import {servedSlots, slotCounts} from "../app/heartbeat-relays";

/** What the node answering holds as a relay: the slots of the clusters writing to it. */
const URL_RELAY_STATUS = "/api/relay/status";
import {clusterFacts} from "../app/cluster-facts";
import {CopyButton} from "../ui/components/CopyButton";
import {groupState, meshLinks} from "../app/heartbeat-mesh";
import {CrossLink} from "../app/CrossLink";
import {storeSource} from "../app/store-config";
import {kindOf, useMenuState} from "../hooks/useSidebarAlerts";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {DOWN_REASONS, isProblem, quietReason, toLine} from "../app/resource-lines";
import {useClusterNodeOrder} from "../hooks/useClusterNodeOrder";
import {usePgReadings} from "../hooks/usePgUsage";
import {IO_FIGURES, sumUsage} from "../app/pg-usage";
import {ioFigure} from "./ClusterUsage";
import {formatCpu} from "../app/namespace-usage";
import {formatBytes, formatDuration} from "../ui/lib/format";
import {ObjectIcon, om3ObjectKind} from "../ui/components/ObjectIcon";
import {UsageBar} from "../ui/components/UsageBar";
import {FrozenMark} from "../ui/components/FrozenMark";
import {Overall} from "./HeartbeatMesh";
import {RING_INK, StateRing} from "./StateRing";
import {formatAge} from "./AgeTime";
import {read} from "./SectionConfig";

/** The lists read for the overview alone, the stores and the resources, again at this period. */
export const OVERVIEW_REFRESH_MS = 30_000;
/** The items a card lists at most: the worst first. */
const SHOWN = 5;
const ZERO_TIME = "0001-01-01T00:00:00Z";
const ACTORS = ["svc", "vol"];
/** The kinds of objects in the order of the menu: those that run, then the data, then the configurations of the namespaces and the cluster. */
const KIND_ORDER = ["svc", "vol", "cfg", "sec", "usr", "nscfg", "ccfg"];
const kindRank = (kind) => (KIND_ORDER.includes(kind) ? KIND_ORDER.indexOf(kind) : KIND_ORDER.length);

/** The nodes by their state, the worst first: dropped, its status gone; overloaded; optimal. [state, arc, dot, ink] */
const NODE_STATES = [
    ["dropped", "stroke-state-down", "bg-state-down", "text-state-down"],
    ["overloaded", "stroke-state-warn", "bg-state-warn", "text-state-warn"],
    ["optimal", "stroke-state-up", "bg-state-up", ""],
];

/** The services and the volumes by their availability, the worst first, n/a last. [state, arc, dot] */
const AVAIL_STATES = [
    ["down", "stroke-state-down", "bg-state-down"],
    ["warn", "stroke-state-warn", "bg-state-warn"],
    ["up", "stroke-state-up", "bg-state-up"],
    ["na", "stroke-line-strong", "bg-line-strong"],
];

/**
 * The resources: the problems, down or in warn, as the Resources page keeps them; those
 * down for a reason that is none (quietReason), apart, gray, every resource down counted;
 * the others. [state, arc, dot]
 */
const RESOURCE_STATES = [
    ["down", "stroke-state-down", "bg-state-down"],
    ["warn", "stroke-state-warn", "bg-state-warn"],
    ["quiet", "stroke-line-strong", "bg-line-strong"],
    ["ok", "stroke-state-up", "bg-state-up"],
];

/** The resources down of no issue on the resources page: down, for any reason of it (DOWN_REASONS but none). */
const QUIET_URL = `/resources?${new URLSearchParams({status: "down", reason: DOWN_REASONS.filter((r) => r !== "none").join(",")})}`;

/** The reports of the instances, which tell a resource down on a passive node. */
const INSTANCE_EVENTS = ["InstanceStatusUpdated"];

/** The arbitrators, as the nodes see them: up, or not reached. [state, arc, dot] */
const ARBITRATOR_STATES = [
    ["down", "stroke-state-down", "bg-state-down"],
    ["up", "stroke-state-up", "bg-state-up"],
];

/** The tint of a heartbeat in the list of the links card: none of its links beating, some, all. */
const HB_INK = {down: "text-state-down", warn: "text-state-warn", up: ""};

/** A count or a name of the overview as a badge, opening its page filtered on it. */
const FILTER_BADGE = "inline-flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 text-data hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-accent";

/** The address of the objects of all the lists filtered by `params`: a kind, a namespace, a global state. */
const objectsUrl = (params) => `/objects?${new URLSearchParams({list: "any", ...params})}`;
/** The services and the volumes by their global state, as the objects page filters it: n/a so written. */
const availUrl = (state) => objectsUrl({kind: ACTORS.join(","), globalState: state === "na" ? "n/a" : state});

/** The state of a node: dropped without a status, a node of the cluster configuration not heard from; else overloaded or optimal. */
const nodeState = (status) => (status === undefined ? "dropped" : status.is_overloaded ? "overloaded" : "optimal");

/**
 * Things by their state at a glance: a ring, its arcs the `states` ([state, arc, dot],
 * the words of `words`.<state>), and in it how many are in the `shown` ones, the `good`
 * ones unless said, out of all, `label` under, and a word for it, optimal when all are in
 * the `good` ones (a state or several); beside each arc that counts some, its word and count, a link opening
 * its page filtered on its state when `link` gives it an address.
 */
function CountsRing({name, states, counts, good, shown = good, label, words, link}) {
    const {t} = useTranslation();
    const total = states.reduce((sum, [key]) => sum + counts[key], 0);
    const sum = (keys) => [keys].flat().reduce((n, key) => n + counts[key], 0);
    const state = sum(good) === total ? "up" : sum(good) === 0 ? "down" : "warn";
    return (
        <div data-ring={name} data-state={state} className="flex flex-col items-center gap-2 py-1">
            <StateRing
                total={total}
                parts={states.map(([key, stroke]) => {
                    const word = t(`${words}.${key}`);
                    const to = counts[key] > 0 ? link?.(key) : undefined;
                    // Its word and count beside its arc, a link opening its page filtered on it when it has one.
                    return [key, counts[key], stroke, {word, to, title: to ? `${t("clusterView.filtered", {state: word})}: ${counts[key]}` : undefined}];
                })}
            >
                <span className="text-2xl font-semibold tabular-nums">{sum(shown)}/{total}</span>
                <span className="text-ink-muted">{label}</span>
                <span className={`font-semibold ${RING_INK[state]}`}>{t(`heartbeats.mesh.overall.${state}`)}</span>
            </StateRing>
        </div>
    );
}

/**
 * What opensvc uses on the nodes, every opensvc cgroup of each the daemon's included
 * (the opensvc slice, `usePgReadings` totals): the cpu and the memory over all the
 * nodes, then node by node. The cpu from a second reading of a node on; the whole of
 * a node shown to whom the whole node may be, said to the others.
 */
/** The shade of a cell of the heatmap of the least used but not idle: still told apart from none. */
const HEAT_FLOOR = 0.08;

/**
 * Where the figures of the card come from, at a glance: a node a row, a figure a
 * column, a cell the darker the more the node takes of it against the busiest one,
 * in one tint. A column even, the load spread over the nodes; a cell standing out, a
 * node spiking. A figure not read yet (a rate before its second reading), dotted.
 */
function UsageHeatmap({nodes, totals, metrics, format}) {
    const {t, i18n} = useTranslation();
    // The node column as wide as the longest name in its badge; the metric columns
    // sharing the rest evenly, their titles hyphenated rather than widening one.
    const nameWidth = `calc(${Math.max(...nodes.map((n) => n.length), 4)}ch + 1.25rem)`;
    const max = Object.fromEntries(metrics.map((key) => [key, Math.max(0, ...nodes.map((node) => totals[node][key] ?? 0))]));
    return (
        <table aria-label={t("clusterView.opensvc.byNode")} data-heatmap="" lang={i18n.language} className="w-full table-fixed border-separate border-spacing-0.5 text-data">
            <colgroup>
                <col style={{width: nameWidth}}/>
                {metrics.map((key) => <col key={key}/>)}
            </colgroup>
            <thead>
                <tr>
                    <th scope="col" className="sr-only">{t("common.node")}</th>
                    {metrics.map((key) => (
                        <th key={key} scope="col" className="px-0.5 text-center align-bottom leading-tight font-normal break-words text-ink-muted hyphens-auto">{t(`clusterView.opensvc.metrics.${key}`)}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {nodes.map((node) => (
                    <tr key={node} data-node={node}>
                        <th scope="row" className="truncate pr-2 text-left font-normal"><CrossLink kind="node" id={node}>{node}</CrossLink></th>
                        {metrics.map((key) => {
                            const value = totals[node][key];
                            const known = typeof value === "number";
                            const level = known && max[key] > 0 ? Math.max(value > 0 ? HEAT_FLOOR : 0, value / max[key]) : 0;
                            const label = known
                                ? t("clusterView.opensvc.cell", {node, metric: t(`clusterUsage.${key}`), value: format(key, value), share: Math.round(100 * (max[key] > 0 ? value / max[key] : 0))})
                                : t("clusterView.opensvc.cellPending", {node, metric: t(`clusterUsage.${key}`)});
                            return (
                                <td key={key} data-metric={key} data-level={known ? level.toFixed(2) : undefined} aria-label={label} className="p-0">
                                    <span
                                        aria-hidden="true"
                                        className={`relative block h-5 overflow-hidden rounded-[3px] ${known ? "bg-surface-sunken" : "border border-dashed border-line"}`}
                                    >
                                        {/* Always there, from none: a new reading fades to its shade, the first one too. */}
                                        <span className="absolute inset-0 bg-accent transition-opacity duration-700 ease-out motion-reduce:transition-none" style={{opacity: level}}/>
                                    </span>
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function OpensvcUsage({nodes}) {
    const {t, i18n} = useTranslation();
    const {usage, totals, hosts, errors} = usePgReadings(nodes);
    const told = nodes.filter((node) => totals[node] !== undefined);
    const read = nodes.filter((node) => usage[node] !== undefined || errors[node] !== undefined);
    const failed = nodes.filter((node) => errors[node] !== undefined);
    const all = sumUsage(told.map((node) => totals[node]));
    const figures = IO_FIGURES.filter((key) => all[key] !== undefined);
    // The whole hosts, every node told: what opensvc uses of what they use, and of what they have.
    const host = told.every((node) => hosts[node] !== undefined) ? sumUsage(told.map((node) => hosts[node])) : undefined;
    const share = (part, whole) => (typeof part === "number" && typeof whole === "number" && whole > 0
        ? `${(100 * part / whole).toLocaleString(i18n.language, {maximumFractionDigits: part / whole < 0.1 ? 1 : 0})} %`
        : undefined);
    const cpuShare = host && share(all.cpu, host.cpu);
    const memoryShare = host && share(all.memory, host.memory);
    const cpu = (value) => (value === null || value === undefined ? "…" : formatCpu(value, i18n.language));
    const memory = (value) => formatBytes(value, i18n.language) || "-";
    if (told.length === 0) {
        return (
            <p className="text-data text-ink-muted">
                {read.length === 0 ? t("clusterView.reading") : failed.length === read.length ? t("clusterView.opensvc.unread") : t("clusterView.opensvc.notShown")}
            </p>
        );
    }
    return (
        <>
            <dl data-opensvc-total="" className="grid grid-cols-2 gap-3">
                <div>
                    <dt className="text-data text-ink-muted">{t("clusterView.opensvc.cpu")}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{cpu(all.cpu)}</dd>
                    {cpuShare && (
                        <dd data-share="cpu" className="text-data text-ink-muted">
                            {t("clusterView.opensvc.cpuShare", {share: cpuShare, used: cpu(host.cpu), count: host.cpus ?? 0})}
                        </dd>
                    )}
                </div>
                <div>
                    <dt className="text-data text-ink-muted">{t("clusterView.opensvc.memory")}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{memory(all.memory)}</dd>
                    {memoryShare && (
                        <dd data-share="memory" className="text-data text-ink-muted">
                            {t("clusterView.opensvc.memoryShare", {share: memoryShare, used: memory(host.memory), total: memory(host.limit)})}
                        </dd>
                    )}
                </div>
            </dl>
            {/* The tasks and the io, where the readings tell them: a line of their own, under the cpu and the memory. */}
            {figures.length > 0 && (
                <dl data-opensvc-io="" className="grid grid-cols-3 gap-3">
                    {figures.map((key) => (
                        <div key={key} data-figure={key}>
                            <dt className="text-data text-ink-muted">{t(`clusterUsage.${key}`)}</dt>
                            <dd className="text-lg font-semibold tabular-nums">{ioFigure(key, all[key], i18n.language)}</dd>
                        </div>
                    ))}
                </dl>
            )}
            <p className="text-data text-ink-muted">{t("clusterView.opensvc.over", {count: told.length, total: nodes.length})}</p>
            <UsageHeatmap nodes={told} totals={totals} metrics={["cpu", "memory", ...figures]} format={(key, value) => (
                key === "cpu" ? cpu(value) : key === "memory" ? memory(value) : ioFigure(key, value, i18n.language)
            )}/>
            {failed.length > 0 && (
                <p className="text-data text-state-warn">{t("clusterView.opensvc.failed", {nodes: failed.join(", ")})}</p>
            )}
        </>
    );
}

/** A list read for the overview, again every while: its items, undefined while read, or why not. */
function usePolled(url) {
    const [state, setState] = useState({items: undefined, error: null});
    useEffect(() => {
        let live = true;
        const load = () => read(url).then(
            (data) => live && setState({items: data.items ?? [], error: null}),
            (err) => live && setState((s) => ({items: s.items ?? [], error: err.message})),
        );
        void load();
        const timer = setInterval(load, OVERVIEW_REFRESH_MS);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, [url]);
    return state;
}

/** A rotation of the certificate authority this recent, told on the card of the cluster. */
const RECENT_CA_DAYS = 90;

/**
 * What the cluster status tells of the cluster as a whole (`clusterFacts`), its
 * objects selected away (the status of the nodes alone, some 40 KB): read again at
 * the pace of the overview; none until read, nor on an error.
 */
function useClusterFacts() {
    const [facts, setFacts] = useState(null);
    useEffect(() => {
        let live = true;
        const load = () => read(URL_CLUSTER_STATUS_NODES).then(
            (status) => live && setFacts(clusterFacts(status)),
            () => {},
        );
        void load();
        const timer = setInterval(load, OVERVIEW_REFRESH_MS);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, []);
    return facts;
}

/**
 * The cluster in a few lines: the collector it feeds, the agents of its nodes, how
 * long its daemons and machines have run, its environment and id, a recent rotation
 * of its certificate authority.
 */
function ClusterFactsLines({facts}) {
    const {t, i18n} = useTranslation();
    const since = (iso) => formatDuration((Date.now() - Date.parse(iso)) / 1000, i18n.language);
    const {collector, versions} = facts;
    const rotated = facts.ca?.rotatedOn && (Date.now() - Date.parse(facts.ca.rotatedOn)) / 86400000 <= RECENT_CA_DAYS;
    const unlinked = collector.warnings.filter((n) => n !== collector.speaker);
    // The words over the link of the card, selectable; the room around them the link.
    return (
        <dl className="pointer-events-none space-y-1 text-data [&_dd]:pointer-events-auto [&_dd]:relative [&_dd]:inline [&_dd]:select-text [&_dt]:pointer-events-auto [&_dt]:relative [&_dt]:mr-1.5 [&_dt]:inline [&_dt]:select-text [&_dt]:text-ink-muted">
            <div data-fact="collector">
                <dt>{t("clusterView.config.collector")}</dt>
                <dd>
                    {collector.state === "none" ? t("clusterView.config.noCollector")
                        : collector.speaker ? t("clusterView.config.fedBy", {url: collector.url ?? "?", node: collector.speaker})
                            : t("clusterView.config.noSpeaker", {url: collector.url ?? "?"})}
                </dd>
                {collector.state === "failing" && collector.speaker && <dd className="ml-1.5 text-state-warn">{t("clusterView.config.collectorErrors")}</dd>}
                {unlinked.length > 0 && <dd className="ml-1.5 text-state-warn">{t("clusterView.config.unlinked", {nodes: unlinked.join(", ")})}</dd>}
            </div>
            {versions.length > 0 && (
                <div data-fact="agent">
                    <dt>{t("clusterView.config.agent")}</dt>
                    <dd className="font-mono">
                        {versions.length === 1 ? versions[0].version : versions.map((v) => `${v.version} (${v.nodes.join(", ")})`).join(" · ")}
                    </dd>
                    {!facts.compat && <dd className="ml-1.5 text-state-warn">{t("clusterView.config.incompatible")}</dd>}
                </div>
            )}
            {facts.daemonStart && (
                <div data-fact="daemons">
                    <dt>{t("clusterView.config.daemons")}</dt>
                    <dd>{t("clusterView.config.upFor", {duration: since(facts.daemonStart)})}</dd>
                </div>
            )}
            {facts.boots && (
                <div data-fact="nodes">
                    <dt>{t("clusterView.config.nodes")}</dt>
                    <dd>{t("clusterView.config.upFor", {duration: facts.boots[0] === facts.boots[1] ? since(facts.boots[0]) : `${since(facts.boots[1])} – ${since(facts.boots[0])}`})}</dd>
                </div>
            )}
            {facts.envs.length > 0 && (
                <div data-fact="identity">
                    <dt>{t("clusterView.config.identity")}</dt>
                    <dd>{facts.envs.join(", ")}</dd>
                </div>
            )}
            {facts.id && (
                <div data-fact="id" className="whitespace-nowrap">
                    <dt>{t("clusterView.config.id")}</dt>
                    <dd className="font-mono">{facts.id}</dd>
                    <dd className="ml-1 inline-block align-middle"><CopyButton text={facts.id} label={t("clusterView.config.copyId")}/></dd>
                </div>
            )}
            {rotated && (
                <div data-fact="ca">
                    <dt>{t("clusterView.config.ca")}</dt>
                    <dd>{t("clusterView.config.caRotated", {day: facts.ca.rotatedOn, count: facts.ca.formers})}</dd>
                </div>
            )}
        </dl>
    );
}

/**
 * A card of the overview: the pictogram and the name of a menu entry, its count, the
 * name a link to its page, stretched over the whole card; then what it sums up of it.
 * Without `to`, a card of no page: its name alone.
 */
function Card({id, icon, title, to, count, children}) {
    const {t} = useTranslation();
    return (
        <section
            aria-labelledby={`cluster-card-${id}`}
            data-card={id}
            className={`relative mb-3 break-inside-avoid space-y-2 rounded-(--radius-panel) border border-line bg-surface-raised p-3 ${to ? "hover:border-line-strong has-[a[data-card-link]:focus-visible]:outline-2 has-[a[data-card-link]:focus-visible]:outline-accent" : ""}`}
        >
            <h2 id={`cluster-card-${id}`} className="flex items-center gap-2 font-semibold">
                <ObjectIcon kind={icon} className="h-4 w-4"/>
                {/* The whole card its link: stretched over it, under what the card holds that is clicked or hovered on its own. */}
                {to ? (
                    <Link
                        to={to}
                        data-card-link=""
                        className="outline-none after:absolute after:inset-0 after:rounded-(--radius-panel)"
                        aria-label={t("clusterView.open", {page: title})}
                    >
                        {title}
                    </Link>
                ) : <span>{title}</span>}
                {count !== undefined && <span className="ml-auto font-normal text-ink-muted tabular-nums">{count}</span>}
            </h2>
            <div data-card-body="" className="space-y-2 [&_a]:relative [&_button]:relative [&_[title]]:relative">{children}</div>
        </section>
    );
}

/** The fullest of a list of pools or networks, a bar each, the full ones counted. */
function Fullest({items, kind}) {
    const {t} = useTranslation();
    const sized = items.filter((i) => typeof i.size === "number" && i.size > 0);
    const full = sized.filter((i) => i.used >= i.size).length;
    const fullest = [...sized].sort((a, b) => b.used / b.size - a.used / a.size || a.name.localeCompare(b.name)).slice(0, SHOWN);
    if (fullest.length === 0) return <p className="text-ink-muted">{t("clusterView.usage.none")}</p>;
    return (
        <div className="space-y-1">
            {full > 0 && <p className="text-data text-state-down">{t("clusterView.usage.full", {count: full})}</p>}
            <ul aria-label={t("clusterView.usage.fullest")} className="space-y-0.5">
                {fullest.map((i) => (
                    <li key={i.name} className="flex items-center justify-between gap-2">
                        <CrossLink kind={kind} id={i.name}>{i.name}</CrossLink>
                        <UsageBar value={(i.used / i.size) * 100} label={i.name}/>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * The overview of the cluster, the default view: a card for each entry of the menu,
 * what its page holds summed up, in a masonry, as wide as the window lets it:
 *
 * - the configuration of the cluster, the cluster object: its panel opened over the
 *   overview, its keywords, its locks and the actions on the whole cluster; frozen, said;
 * - the links, the ring of the heartbeats page, each heartbeat its links beating;
 * - the nodes, a ring of those dropped, overloaded, optimal; those frozen said;
 * - what opensvc uses, its cpu and memory over the nodes, then node by node;
 * - the arbitrators, a ring of the nodes reaching them, each listed; none, with an even
 *   number of nodes, the risk of a tied vote said;
 * - the objects, a ring of the services and the volumes by availability; the objects by kind;
 * - the namespaces, the busiest;
 * - the networks and the pools, the fullest;
 * - the stores, their snapshots, those unreached said;
 * - the resources, a ring of those in warn and the others, how many in warn in it.
 *
 * Live as the menu is: its event stream and its polls (`useMenuState`); the stores
 * and the resources read here, again every while.
 */
export default function ClusterView() {
    const {t, i18n} = useTranslation();
    const {objects, nodeStatus, heartbeatStatus, pools, networks, volChildren, ready} = useMenuState();
    const stores = usePolled(URL_STORE);
    const relay = usePolled(URL_RELAY_STATUS);
    const relaySlots = slotCounts(servedSlots(relay.items ?? [], Date.now()));
    const clusterInfo = useClusterFacts();
    const resources = usePolled(URL_RESOURCES);

    const links = useMemo(() => meshLinks(heartbeatStatus ?? {}), [heartbeatStatus]);
    // The heartbeats, by name, each its links: the state they make, how many beat out of all.
    const heartbeats = Object.entries(links.reduce((acc, l) => ({...acc, [l.hb]: [...(acc[l.hb] ?? []), l]}), {}))
        .sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
        .map(([hb, hbLinks]) => ({hb, state: groupState(hbLinks), beating: hbLinks.filter((l) => l.state === "up").length, total: hbLinks.length}));
    // The nodes of the cluster configuration and those reporting: one of the first not reporting, dropped.
    const clusterNodes = useClusterNodeOrder();
    const nodes = [...new Set([...(clusterNodes ?? []), ...Object.keys(nodeStatus ?? {})])]
        .sort((a, b) => a.localeCompare(b))
        .map((node) => [node, nodeStatus?.[node]]);
    const nodeCounts = {dropped: 0, overloaded: 0, optimal: 0};
    for (const [, s] of nodes) nodeCounts[nodeState(s)] += 1;
    const frozen = nodes.filter(([, s]) => s?.frozen_at && s.frozen_at !== ZERO_TIME).length;

    // The arbitrators, each as the nodes see it: how many reach it out of all the nodes, a dropped one none.
    const arbitrators = [...new Set(nodes.flatMap(([, s]) => Object.keys(s?.arbitrators ?? {})))]
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))
        .map((name) => {
            const seen = nodes.map(([, s]) => s?.arbitrators?.[name]);
            const up = seen.filter((a) => a?.status === "up").length;
            return {name, url: seen.find((a) => a?.url)?.url, up, total: nodes.length, state: up === nodes.length ? "up" : up === 0 ? "down" : "warn"};
        });
    const arbitratorCounts = {
        up: arbitrators.reduce((sum, a) => sum + a.up, 0),
        down: arbitrators.reduce((sum, a) => sum + a.total - a.up, 0),
    };
    // No arbitrator to break a tie: an even number of nodes split in halves, neither has a majority of the votes.
    const tieRisk = arbitrators.length === 0 && nodes.length > 0 && nodes.length % 2 === 0;

    const paths = Object.keys(objects ?? {}).sort();
    const actors = paths.filter((p) => ACTORS.includes(kindOf(p)));
    const avail = {up: 0, warn: 0, down: 0, na: 0};
    for (const p of actors) {
        const a = objects[p]?.avail;
        if (a === "up" || a === "warn" || a === "down") avail[a] += 1;
        else avail.na += 1;
    }
    // The kinds, those that run first, the configurations after; one unknown last, by name.
    const kinds = Object.entries(paths.reduce((acc, p) => ({...acc, [kindOf(p)]: (acc[kindOf(p)] ?? 0) + 1}), {}))
        .sort(([a], [b]) => kindRank(a) - kindRank(b) || a.localeCompare(b));

    // The namespaces, by the objects they hold, as the objects list counts them: "ns/kind/name" of its namespace,
    // "kind/name" and a bare name of the root one, the cluster one too (root/ccfg/cluster). "ns/" its configuration,
    // of the namespace it names ("/" of the root one): the namespace counted, its objects without it, the configuration
    // the namespace line, no object of its own.
    const byNamespace = paths.reduce((acc, p) => {
        const {namespace} = parseObjectPath(p);
        acc[namespace] = (acc[namespace] ?? 0) + (kindOf(p) === "nscfg" ? 0 : 1);
        return acc;
    }, {});
    const busiest = Object.entries(byNamespace).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).slice(0, SHOWN);

    const storeItems = stores.items ?? [];
    const snapshots = storeItems.reduce((sum, s) => sum + (s.stats?.runs ?? 0), 0);
    const unreached = storeItems.filter((s) => s.stats?.check_error).length;

    // Passive as the Resources page tells it, by the reports of the instances too, read as
    // it reads them: those of the resources down alone, the page not rendered at each
    // event of the others.
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, INSTANCE_EVENTS) : null;
        return () => release?.();
    }, []);
    const resourceItems = resources.items;
    const baseLines = useMemo(
        () => (resourceItems ?? []).map(toLine),
        [resourceItems]
    );
    const downLines = useMemo(() => baseLines.filter((l) => l.status === "down"), [baseLines]);
    // What quietReason reads of each: its availability, when it was stopped.
    const downReports = useEventStore(useShallow((s) => downLines.flatMap((l) => {
        const report = s.objectInstanceStatus?.[l.object]?.[l.hostNode];
        return [report?.avail, report?.stopped_at];
    })));
    const reports = {};
    downLines.forEach((l, i) => {
        const [avail, stopped_at] = downReports.slice(2 * i, 2 * i + 2);
        if (avail !== undefined || stopped_at !== undefined) (reports[l.object] ??= {})[l.hostNode] = {avail, stopped_at};
    });
    const resourceLines = baseLines.map((l) => ({...l, quiet: quietReason(l, {objects, reports, volChildren})}));
    const resourcesDown = resourceLines.filter((l) => isProblem(l) && l.status === "down").length;
    const resourcesQuiet = resourceLines.filter((l) => l.quiet).length;
    const resourcesWarn = resourceLines.filter((l) => l.status === "warn").length;
    const resourceCounts = {
        down: resourcesDown,
        warn: resourcesWarn,
        quiet: resourcesQuiet,
        ok: resourceLines.length - resourcesDown - resourcesWarn - resourcesQuiet,
    };

    return (
        <div className="@container p-4">
            <h1 className="sr-only">{t("clusterView.title")}</h1>
            <div aria-label={t("clusterView.cards")} role="group" className="gap-3 @3xl:columns-2 @6xl:columns-3">
                {/* The cluster itself, a card as the others: its object's panel over the overview. */}
                <Card id="config" icon="cluster" title={t("clusterView.config.title")} to={{pathname: "/cluster", search: "?peek=object:cluster"}}>
                    {clusterInfo && <ClusterFactsLines facts={clusterInfo}/>}
                    {objects?.cluster?.frozen === "frozen" && <p className="pointer-events-none text-data text-state-warn"><span className="pointer-events-auto relative select-text">{t("clusterView.config.frozen")}</span></p>}
                </Card>

                <Card id="links" icon="heartbeat" title={t("nav.routes.heartbeats")} to="/heartbeats" count={links.length}>
                    {ready ? <Overall links={links}/> : <p className="text-ink-muted">{t("clusterView.reading")}</p>}
                    {heartbeats.length > 0 && (
                        <ul aria-label={t("clusterView.links.heartbeats")} className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                            {heartbeats.map(({hb, state, beating, total}) => (
                                <li key={hb} data-hb={hb} data-state={state}>
                                    {/* Its streams on the heartbeats page. */}
                                    <Link
                                        to={`/heartbeats?${new URLSearchParams({view: "data", id: hb})}`}
                                        className={`${FILTER_BADGE} font-medium ${HB_INK[state]}`}
                                    >
                                        {hb}
                                        {state !== "up" && <span className="sr-only">{t(`heartbeats.mesh.overall.${state}`)}</span>}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                <Card id="nodes" icon="node" title={t("nav.routes.nodes")} to="/nodes" count={nodes.length}>
                    {ready ? (
                        <CountsRing name="nodes" states={NODE_STATES} counts={nodeCounts} good="optimal" label={t("clusterView.nodes.operational")} words="clusterView.nodes"/>
                    ) : <p className="text-ink-muted">{t("clusterView.reading")}</p>}
                    {frozen > 0 && <p className="text-center text-data text-ink-muted">{t("clusterView.nodes.frozen", {count: frozen})}</p>}
                    <ul aria-label={t("nav.routes.nodes")} className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                        {nodes.map(([node, s]) => {
                            const state = nodeState(s);
                            return (
                                <li key={node} data-node={node} data-state={state} className={`inline-flex items-center gap-1 ${NODE_STATES.find(([key]) => key === state)[3]}`}>
                                    <CrossLink kind="node" id={node}>{node}</CrossLink>
                                    {state !== "optimal" && <span className="sr-only">{t(`clusterView.nodes.${state}`)}</span>}
                                    <FrozenMark frozen={Boolean(s?.frozen_at && s.frozen_at !== ZERO_TIME)}/>
                                </li>
                            );
                        })}
                    </ul>
                </Card>

                {/* Its tree, as systemd-cgtop shows the cgroups: the usage tab of the cluster's panel. */}
                <Card id="opensvc" icon="chart" title={t("clusterView.opensvc.title")} to={{search: "?peek=object:cluster&peektab=usage"}}>
                    <OpensvcUsage nodes={nodes.filter(([, s]) => s !== undefined).map(([node]) => node)}/>
                </Card>

                {/* The slots this node holds as a relay; not one, the usual case, said plainly. */}
                <Card id="relay" icon="heartbeat" title={t("nav.sections.relay")} to="/relay">
                    {relay.items === undefined ? (
                        <p className="text-data text-ink-muted">{t("clusterView.reading")}</p>
                    ) : relay.error ? (
                        <p className="text-data text-ink-muted">{t("clusterView.relay.unread")}</p>
                    ) : relaySlots.active + relaySlots.stale === 0 ? (
                        <p className="text-data text-ink-muted">{t("clusterView.relay.none")}</p>
                    ) : (
                        <dl data-relay-slots="" className="grid grid-cols-2 gap-3">
                            <div>
                                <dt className="text-data text-ink-muted">{t("clusterView.relay.active")}</dt>
                                <dd className="text-2xl font-semibold tabular-nums">{relaySlots.active}</dd>
                            </div>
                            <div>
                                <dt className="text-data text-ink-muted">{t("clusterView.relay.stale")}</dt>
                                <dd className={`text-2xl font-semibold tabular-nums ${relaySlots.stale > 0 ? "text-state-warn" : ""}`}>{relaySlots.stale}</dd>
                            </div>
                        </dl>
                    )}
                </Card>

                <Card id="arbitrators" icon="cluster" title={t("clusterView.arbitrators.title")} count={arbitrators.length}>
                    {!ready ? <p className="text-ink-muted">{t("clusterView.reading")}</p> : arbitrators.length > 0 ? (
                        <>
                            <CountsRing
                                name="arbitrators"
                                states={ARBITRATOR_STATES}
                                counts={arbitratorCounts}
                                good="up"
                                label={t("clusterView.arbitrators.operational", {count: arbitrators.length})}
                                words="clusterView.arbitrators"
                            />
                            <ul aria-label={t("clusterView.arbitrators.title")} className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                                {arbitrators.map(({name, url, up, total, state}) => (
                                    <li
                                        key={name}
                                        data-arbitrator={name}
                                        data-state={state}
                                        className={`font-medium ${HB_INK[state]}`}
                                    >
                                        {name}
                                        {state !== "up" && <span className="sr-only">{t(`heartbeats.mesh.overall.${state}`)}</span>}
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : tieRisk ? (
                        <p role="alert" data-tie-risk="" className="text-data text-state-warn">{t("clusterView.arbitrators.tieRisk", {count: nodes.length})}</p>
                    ) : <p className="text-data text-ink-muted">{t("clusterView.arbitrators.none")}</p>}
                </Card>

                <Card id="objects" icon="service" title={t("nav.sections.objects")} to="/objects" count={paths.length}>
                    {ready ? (
                        <CountsRing name="objects" states={AVAIL_STATES} counts={avail} good="up" label={t("clusterView.objects.operational")} words="clusterView.objects" link={availUrl}/>
                    ) : <p className="text-ink-muted">{t("clusterView.reading")}</p>}
                    {/* A tile of each kind, a grid apart from the badges of the states over it: its pictogram and its
                        name, its count under them, large; the whole tile its link. */}
                    <dl aria-label={t("clusterView.objects.kinds")} className="grid grid-cols-[repeat(auto-fit,minmax(4rem,1fr))] gap-1.5">
                        {kinds.map(([kind, n]) => (
                            <div
                                key={kind}
                                data-kind={kind}
                                className="relative flex flex-col-reverse items-center rounded-(--radius-control) border border-line bg-surface px-1.5 py-1 hover:border-line-strong hover:bg-surface-sunken has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-accent"
                            >
                                <dt className="flex items-center gap-1 text-data text-ink-muted">
                                    <ObjectIcon kind={om3ObjectKind(kind)} className="h-3.5 w-3.5"/>
                                    {kind}
                                </dt>
                                <dd className="text-lg font-semibold leading-tight tabular-nums">
                                    <Link
                                        to={objectsUrl({kind})}
                                        aria-label={`${t("clusterView.objects.ofKind", {kind})}: ${n}`}
                                        // Static, unlike the card's other links (Card): stretched over the whole tile, not the count alone.
                                        style={{position: "static"}}
                                        className="outline-none after:absolute after:inset-0 after:rounded-(--radius-control)"
                                    >
                                        {n}
                                    </Link>
                                </dd>
                            </div>
                        ))}
                    </dl>
                </Card>

                <Card id="namespaces" icon="namespace" title={t("nav.routes.namespaces")} to="/namespaces" count={Object.keys(byNamespace).length}>
                    <ul aria-label={t("clusterView.namespaces.busiest")} className="space-y-0.5">
                        {busiest.map(([ns, n]) => (
                            <li key={ns} className="flex items-center justify-between gap-2">
                                <CrossLink kind="namespace" id={ns}>{ns}</CrossLink>
                                <Link to={objectsUrl({namespace: ns})} className={`${FILTER_BADGE} text-ink-muted tabular-nums`}>
                                    {t("clusterView.namespaces.objects", {count: n})}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </Card>

                <Card id="networks" icon="network" title={t("nav.routes.networks")} to="/network" count={(networks ?? []).length}>
                    <Fullest items={networks ?? []} kind="network"/>
                </Card>

                <Card id="pools" icon="pool" title={t("nav.routes.pools")} to="/pools" count={(pools ?? []).length}>
                    <Fullest items={pools ?? []} kind="pool"/>
                </Card>

                <Card id="stores" icon="store" title={t("nav.routes.stores")} to="/stores" count={stores.items?.length}>
                    {stores.items === undefined ? <p className="text-ink-muted">{t("clusterView.reading")}</p> : (
                        <>
                            <p className="text-data text-ink-muted">
                                {t("clusterView.stores.snapshots", {count: snapshots})}
                                {unreached > 0 && <span className="text-state-warn">{` · ${t("clusterView.stores.unreached", {count: unreached})}`}</span>}
                            </p>
                            <ul aria-label={t("nav.routes.stores")} className="space-y-0.5">
                                {[...storeItems].sort((a, b) => a.ref.localeCompare(b.ref)).slice(0, SHOWN).map((s) => (
                                    <li key={s.ref} className="flex items-center justify-between gap-2">
                                        <CrossLink kind="store" id={s.ref}>{storeSource(s.ref).name}</CrossLink>
                                        <span className={`text-data tabular-nums ${s.stats?.check_error ? "text-state-warn" : "text-ink-muted"}`}>
                                            {[t("clusterView.stores.snapshots", {count: s.stats?.runs ?? 0}),
                                                s.stats?.last_created_at && t("clusterView.stores.latest", {age: formatAge(s.stats.last_created_at, i18n.language)})]
                                                .filter(Boolean).join(" · ")}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </Card>

                <Card id="resources" icon="app" title={t("nav.routes.resources")} to="/resources" count={resources.items?.length}>
                    {resources.error && <p className="text-data text-state-warn">{t("clusterView.resources.unread", {message: resources.error})}</p>}
                    {resources.items === undefined && !resources.error ? <p className="text-ink-muted">{t("clusterView.reading")}</p> : (
                        <CountsRing
                            name="resources"
                            states={RESOURCE_STATES}
                            counts={resourceCounts}
                            good={["quiet", "ok"]}
                            label={t("clusterView.resources.operational")}
                            words="clusterView.resources"
                            // The problems on the resources page, down or in warn; those down of no issue alone, by
                            // their reasons; the others, of many states, no filter says.
                            link={(state) => (state === "ok" ? undefined : state === "quiet" ? QUIET_URL : `/resources?status=${state}&problems=1`)}
                        />
                    )}
                </Card>
            </div>
        </div>
    );
}
