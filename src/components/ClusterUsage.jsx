import React, {useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {useClusterNodes, usePgReadings} from "../hooks/usePgUsage";
import {sortUsageTree, usageTree} from "../app/pg-tree";
import {IO_FIGURES} from "../app/pg-usage";
import {formatCpu, namespaceOf} from "../app/namespace-usage";
import {CrossLink} from "../app/CrossLink";
import {resourceId} from "../app/peek";
import {InstanceLink} from "./RecordLinks";
import {formatBytes} from "../ui/lib/format";
import {Table, HeaderRow, HeaderCell, Row, Cell} from "../ui/components/Table";
import {Button} from "../ui/components/Button";
import {Select} from "../ui/components/Field";
import {ChevronDownIcon} from "../ui/icons";

/** The orders offered: by cpu and memory always, by tasks and io where the readings tell them, by name. */
const ORDERS = ["cpu", "memory", "tasks", "read", "write", "name"];
const TOLD_ONLY = new Set(["tasks", "read", "write"]);

/** The name of a cgroup of the tree, as systemd names it, and what it stands for. */
function GroupName({node}) {
    const {t} = useTranslation();
    const mono = (name) => <span className="font-mono text-data text-ink-muted">{name}</span>;
    // Two parts, its name and its slice: narrow, the slice under the name rather than past the card.
    const pair = "inline-flex items-center gap-x-2 max-md:min-w-0 max-md:flex-wrap";
    // The root cgroup, as systemd-cgtop names it.
    if (node.kind === "host") return <span className={pair}>{mono("/")}<span>{t("clusterUsage.host")}</span></span>;
    if (node.kind === "slice") return mono(node.name);
    if (node.kind === "rest") return <span className="text-ink-muted">{t("clusterUsage.rest")}</span>;
    const slice = mono(node.kind === "opensvc" ? "opensvc.slice" : `opensvc-ns.${node.name}.slice`);
    if (node.kind === "opensvc") return slice;
    if (node.kind === "namespace") return <span className={pair}><CrossLink kind="namespace" id={node.name}>{node.name}</CrossLink>{slice}</span>;
    if (node.kind === "object") return <CrossLink kind="object" id={node.name}>{node.name}</CrossLink>;
    if (node.kind === "instance") return <InstanceLink path={node.path} node={node.name}/>;
    // A subset of the resources, a group of its own; a resource, its panel on that instance.
    if (node.kind === "subset") return <span className={pair}>{node.name}<span className="text-data text-ink-muted">{t("clusterUsage.subset")}</span></span>;
    if (node.kind === "resource") return <CrossLink kind="resource" id={resourceId(node.path, node.name, node.node)}>{node.name}</CrossLink>;
    return <span className="text-ink-muted">{t("clusterUsage.other")}</span>;
}

/**
 * A figure of a usage beyond the cpu and the memory, in words: the tasks, a count; the
 * io, bytes a second, "…" until a second reading tells it.
 */
export function ioFigure(key, value, locale) {
    if (value === undefined) return "–";
    if (key === "tasks") return value.toLocaleString(locale);
    if (value === null) return "…";
    return `${formatBytes(value, locale) || "0 B"}/s`;
}

/**
 * A tree of cgroups as systemd-cgtop shows them, a line each, depth first: its name,
 * its cpu and memory, its memory limit with `limits`, its tasks and io where the
 * readings tell them; a namespace folded on demand, the group a view is about marked.
 */
export function UsageTreeTable({tree, limits = false}) {
    const {t, i18n} = useTranslation();
    const [folded, setFolded] = useState(() => new Set());
    const cpu = (value) => (value === null || value === undefined ? "…" : formatCpu(value, i18n.language));
    const memory = (value) => formatBytes(value, i18n.language) || "–";
    const limit = (value) => (value === undefined ? "–" : value === Infinity ? t("clusterUsage.unlimited") : memory(value));
    const fold = (key) => setFolded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    });
    // The tasks and the io, columns where the top group tells them.
    const figures = IO_FIGURES.filter((key) => tree.usage[key] !== undefined);
    // The lines of the tree, depth first, the children of a folded group left out.
    const rows = [];
    const walk = (n, depth) => {
        rows.push({n, depth});
        if (!folded.has(n.key)) for (const child of n.children) walk(child, depth + 1);
    };
    walk(tree, 0);
    return (
        <Table aria-label={t("clusterUsage.caption")}>
            <thead>
                <HeaderRow>
                    <HeaderCell>{t("clusterUsage.group")}</HeaderCell>
                    <HeaderCell className="w-28">{t("clusterUsage.cpu")}</HeaderCell>
                    <HeaderCell className="w-28">{t("clusterUsage.memory")}</HeaderCell>
                    {limits && <HeaderCell className="w-28">{t("clusterUsage.limit")}</HeaderCell>}
                    {figures.map((key) => <HeaderCell key={key} className="w-28">{t(`clusterUsage.${key}`)}</HeaderCell>)}
                </HeaderRow>
            </thead>
            <tbody>
                {rows.map(({n, depth}) => {
                    const marked = n.kind === "opensvc" || n.kind === "host" || n.focus;
                    return (
                    <Row
                        key={n.key}
                        data-group={n.key}
                        aria-current={n.focus || undefined}
                        // A line marked, bold; narrow, its rows as cards, its name alone, not
                        // its titles and figures: the cards drawn alike.
                        className={marked ? "font-semibold max-md:font-normal" : undefined}
                    >
                        <Cell className="whitespace-nowrap">
                            {/* Its depth, an indent in a table; narrow, a card each, none: its name
                                beside its title, on its line, a long one wrapped in its room. */}
                            <span
                                className={`inline-flex items-center gap-1.5 max-md:min-w-0 max-md:flex-1 max-md:items-baseline max-md:pl-0! ${marked ? "max-md:font-semibold" : ""}`}
                                style={{paddingLeft: `${depth * 1.25}rem`}}
                            >
                                {n.children.length > 0 && n.kind !== "host" ? (
                                    <button
                                        type="button"
                                        onClick={() => fold(n.key)}
                                        aria-expanded={!folded.has(n.key)}
                                        aria-label={t("clusterUsage.fold", {name: n.name || (n.kind === "opensvc" ? "opensvc.slice" : n.kind)})}
                                        className="text-ink-muted hover:text-ink"
                                    >
                                        <ChevronDownIcon className={folded.has(n.key) ? "h-3.5 w-3.5 -rotate-90" : "h-3.5 w-3.5"}/>
                                    </button>
                                ) : <span className="w-3.5" aria-hidden="true"/>}
                                <GroupName node={n}/>
                            </span>
                        </Cell>
                        <Cell className="tabular-nums">{cpu(n.usage.cpu)}</Cell>
                        <Cell className="tabular-nums">{memory(n.usage.memory)}</Cell>
                        {limits && <Cell className="tabular-nums">{limit(n.usage.limit)}</Cell>}
                        {figures.map((key) => <Cell key={key} className="tabular-nums">{ioFigure(key, n.usage[key], i18n.language)}</Cell>)}
                    </Row>
                    );
                })}
            </tbody>
        </Table>
    );
}

/**
 * What opensvc uses on the nodes, as systemd-cgtop shows the cgroups of a host: the
 * opensvc slice, in it each namespace slice and its objects, the objects of the root
 * namespace, and the rest (the daemon); the cpu and the memory of each, its tasks and
 * its io where the readings tell them, over all the nodes or on one, the most used
 * first. The rates from a second reading on.
 */
export function ClusterUsage() {
    const {t} = useTranslation();
    const nodes = useClusterNodes();
    const readings = usePgReadings(nodes);
    const [node, setNode] = useState("");
    const [order, setOrder] = useState("cpu");
    const chosen = node === "" ? nodes : [node];
    const tree = useMemo(() => {
        const built = usageTree(chosen, readings, namespaceOf);
        return built && sortUsageTree(built, order);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chosen.join(","), readings, order]);

    const read = nodes.filter((n) => readings.usage[n] !== undefined || readings.errors[n] !== undefined);
    const failed = nodes.filter((n) => readings.errors[n] !== undefined);
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1 text-ink-muted">
                    {t("common.node")}
                    <Select className="h-7" value={node} onChange={(e) => setNode(e.target.value)}>
                        <option value="">{t("clusterUsage.allNodes")}</option>
                        {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
                    </Select>
                </label>
                <span className="ml-auto flex items-center gap-1" role="group" aria-label={t("clusterUsage.order")}>
                    <span className="text-ink-muted">{t("clusterUsage.order")}</span>
                    {ORDERS.filter((o) => !TOLD_ONLY.has(o) || tree?.usage[o] !== undefined).map((o) => (
                        <Button key={o} size="sm" aria-pressed={order === o} onClick={() => setOrder(o)}>{t(`clusterUsage.orders.${o}`)}</Button>
                    ))}
                </span>
            </div>
            {tree === null ? (
                <p className="text-ink-muted">
                    {read.length === 0 ? t("clusterView.reading") : failed.length === read.length ? t("clusterView.opensvc.unread") : t("clusterView.opensvc.notShown")}
                </p>
            ) : (
                <UsageTreeTable tree={tree}/>
            )}
            {tree !== null && failed.length > 0 && (
                <p className="text-data text-state-warn">{t("clusterView.opensvc.failed", {nodes: failed.join(", ")})}</p>
            )}
        </div>
    );
}
