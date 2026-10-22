import React, {useCallback, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {formatBytes} from "../utils/cgroupMetrics";
import {formatCpuPercent, namespaceOf} from "../app/namespace-usage";
import {namespaceUsage} from "../app/pg-usage";
import {PG_POLL_MS, useClusterNodes, usePgReadings} from "../hooks/usePgUsage";
import {Table, HeaderRow, SortHeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {Spinner} from "../ui/components/Spinner";
import {CrossLink} from "../app/CrossLink";
import {Alert} from "../ui/components/Alert";

/** A cpu in cpus as a percentage of one, "-" until a second reading tells it. */
export const cpuText = (cpus) => formatCpuPercent(cpus === null || cpus === undefined ? null : cpus * 100);

/** The value a column sorts a row by; none, a figure not read yet, goes last. */
const SORT = {
    path: (row) => row.path,
    instances: (row) => row.instances.length,
    cpu: (row) => row.cpu,
    memory: (row) => row.memory,
    limit: (row) => row.limit,
};

const COLUMNS = [
    {key: "path", labelKey: "metrics.columns.object"},
    {key: "instances", labelKey: "metrics.columns.instances"},
    {key: "cpu", labelKey: "metrics.columns.cpu"},
    {key: "memory", labelKey: "metrics.columns.memory"},
    {key: "limit", labelKey: "metrics.columns.limit"},
];

/** A figure read; an unlimited limit, infinite, the largest of all. */
const isFigure = (value) => typeof value === "number" && !Number.isNaN(value);

/** The nodes that could not be read, and why, in a line each; nothing while all are. */
export const ReadErrors = ({errors}) => {
    const {t} = useTranslation();
    const entries = Object.entries(errors);
    if (entries.length === 0) return null;
    return (
        <Alert tone="warning">
            {entries.map(([node, message]) => (
                <span key={node} className="block">{t("metrics.fetchError", {error: `${node}: ${message}`})}</span>
            ))}
        </Alert>
    );
};

/** A figure of a whole, over its table. */
export const TotalTile = ({label, value}) => (
    <div className="rounded-(--radius-panel) border border-line bg-surface-sunken px-3 py-2">
        <dt className="text-ink-muted">{label}</dt>
        <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
);

/**
 * The CPU and memory the objects of a namespace use, each summed over its instances
 * on every node of the cluster, and the namespace as a whole: the memory limits add
 * up too, unlimited if one is. The CPU is the rate between two readings of a node,
 * so it shows on the second one.
 */
const NamespaceMetrics = ({namespace}) => {
    const {t} = useTranslation();
    const nodes = useClusterNodes();
    const {usage, errors} = usePgReadings(nodes);
    // Read once every node answered, or failed to: the figures of those that answered.
    const read = Object.keys(usage).length + Object.keys(errors).length > 0;
    const total = useMemo(() => namespaceUsage(usage, namespaceOf, namespace), [usage, namespace]);

    // The busiest first: by cpu, descending. A figure from the largest, a name from A.
    const [sortColumn, setSortColumn] = useState("cpu");
    const [sortDirection, setSortDirection] = useState("desc");
    const handleSort = useCallback((column) => {
        if (column === sortColumn) {
            setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
            return;
        }
        setSortColumn(column);
        setSortDirection(column === "path" ? "asc" : "desc");
    }, [sortColumn]);

    const sortedRows = useMemo(() => {
        const key = SORT[sortColumn];
        const sign = sortDirection === "asc" ? 1 : -1;
        return total.objects.slice().sort((a, b) => {
            const [x, y] = [key(a), key(b)];
            if (sortColumn !== "path") {
                // A figure not read yet, the cpu before a second reading say, last whatever the direction.
                if (isFigure(x) !== isFigure(y)) return isFigure(x) ? -1 : 1;
                const diff = isFigure(x) ? (x - y) * sign : 0;
                return diff || a.path.localeCompare(b.path);
            }
            return x.localeCompare(y) * sign;
        });
    }, [total, sortColumn, sortDirection]);

    return (
        <div className="flex flex-col gap-3">
            <ReadErrors errors={errors}/>
            {!read ? (
                <div className="flex justify-center">
                    <Spinner label={t("metrics.loading")}/>
                </div>
            ) : (
                <>
                {sortedRows.length > 0 && (
                    <section aria-label={t("metrics.totals.label")}>
                        <dl className="grid grid-cols-2 gap-3">
                            <TotalTile label={t("metrics.totals.cpu")} value={cpuText(total.cpu)}/>
                            <TotalTile label={t("metrics.totals.memory")} value={formatBytes(total.memory)}/>
                        </dl>
                    </section>
                )}
                <Table>
                    <thead>
                        <HeaderRow>
                            {COLUMNS.map(({key, labelKey}) => (
                                <SortHeaderCell
                                    key={key}
                                    label={t(labelKey)}
                                    active={sortColumn === key}
                                    direction={sortDirection}
                                    onSort={() => handleSort(key)}
                                />
                            ))}
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {sortedRows.length > 0 ? sortedRows.map((row) => (
                            <Row key={row.path}>
                                <Cell className="whitespace-nowrap"><CrossLink kind="object" id={row.path}>{row.path}</CrossLink></Cell>
                                <Cell numeric title={row.instances.map((i) => i.node).join(", ")}>{row.instances.length}</Cell>
                                <Cell numeric>{cpuText(row.cpu)}</Cell>
                                <Cell numeric>{formatBytes(row.memory)}</Cell>
                                <Cell numeric>{formatBytes(row.limit)}</Cell>
                            </Row>
                        )) : (
                            <EmptyRow colSpan={COLUMNS.length}>{t("metrics.empty", {namespace})}</EmptyRow>
                        )}
                    </tbody>
                </Table>
                </>
            )}
            <p className="text-ink-muted">
                {t("metrics.footer", {seconds: PG_POLL_MS / 1000})}
            </p>
        </div>
    );
};

export default NamespaceMetrics;
