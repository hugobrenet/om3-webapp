import React, {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {retainEventReception} from "../eventSourceManager.jsx";
import useEventStore from "../hooks/useEventStore";
import {useNamespaceClaims, useNamespacePg} from "../hooks/useNamespaceUsage";
import {computeLimit, formatCpu, kindCounts, networkUsage, poolUsage} from "../app/namespace-usage";
import {Table, HeaderRow, HeaderCell, SortHeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {useFitLevel} from "../ui/lib/fit-level";
import {SegmentedBar} from "../ui/components/SegmentedBar";
import {formatBytes} from "../ui/lib/format";
import {usePanelSearch} from "../app/panel-search";
import {NamespaceDetailPanel} from "./RecordPanels";
import {MoreRows, useRowsOnDemand} from "../ui/components/RowsOnDemand";

/** The availabilities a service or volume pill counts, in the order they are shown. */
const AVAILS = [["up", "up"], ["warn", "warn"], ["down", "down"], ["n/a", "na"]];

/** The tab of the Objects page listing a kind, absent for the first one, the services. */
const LIST_OF = {svc: undefined, vol: "volumes", sec: "secrets", cfg: "configs"};

const selectObjectStatus = (state) => state.objectStatus;

const objectsUrl = (namespace, {kind, globalState} = {}) => {
    const params = new URLSearchParams({namespace});
    if (LIST_OF[kind]) params.set("list", LIST_OF[kind]);
    if (globalState) params.set("globalState", globalState);
    return `/objects?${params}`;
};

const totalOf = (byAvail) => Object.values(byAvail ?? {}).reduce((n, c) => n + c, 0);

/** A size, "0" rather than nothing for none. */
const size = (bytes, locale) => (bytes > 0 ? formatBytes(bytes, locale) : "0");

/** How much of a total is used, rounded: "<1%" for a little, never "0%" for some. */
const percentOf = (used, total, locale) => {
    if (!(total > 0)) return "–";
    const ratio = used / total;
    if (ratio > 0 && ratio < 0.01) return "<1%";
    return (Math.round(ratio * 100) / 100).toLocaleString(locale, {style: "percent"});
};

/** The kinds a namespace holds, in the order the chart draws them; the services and volumes split by availability. */
const KINDS = ["svc", "vol", "cfg", "sec"];
/** The tint of an availability, written out in full: Tailwind does not see names built at runtime. */
const AVAIL_STROKE = {up: "stroke-state-up", warn: "stroke-state-warn", down: "stroke-state-down", "n/a": "stroke-ink-muted"};

/** The parts of a kind: its availabilities for a service or a volume, none for a secret or a configuration. */
const partsOf = (kind, counts) => (kind === "svc" || kind === "vol"
    ? AVAILS.map(([avail]) => [avail, counts?.[kind]?.[avail] ?? 0]).filter(([, n]) => n > 0)
    : []);
const countOf = (kind, counts) => (kind === "svc" || kind === "vol" ? totalOf(counts?.[kind]) : counts?.[kind] ?? 0);

/**
 * A pie the size of a character, a slice an availability as large as its share: a
 * circle drawn with a stroke as wide as its radius, each slice a dash of it, from the top.
 */
function StatusPie({parts}) {
    const total = parts.reduce((n, [, c]) => n + c, 0);
    // A radius of 25 drawn 50 wide fills the circle of 50; its length, the whole of the pie.
    const round = 2 * Math.PI * 25;
    let at = 0;
    return (
        <svg viewBox="0 0 100 100" aria-hidden="true" className="h-[1em] w-[1em] shrink-0 -rotate-90">
            {parts.map(([avail, c]) => {
                const length = (round * c) / total;
                const slice = (
                    <circle
                        key={avail}
                        data-avail={avail}
                        cx="50"
                        cy="50"
                        r="25"
                        fill="none"
                        strokeWidth="50"
                        strokeDasharray={`${length} ${round}`}
                        strokeDashoffset={-at}
                        className={AVAIL_STROKE[avail]}
                    />
                );
                at += length;
                return slice;
            })}
        </svg>
    );
}

/**
 * What a namespace holds: a chip a kind, its count and its name, and for the services
 * and the volumes a pie of their availabilities; each showing its objects in the
 * Objects page, its availabilities said in its name. A kind in a slot of its own, kept
 * empty when the namespace holds none, every chip as wide: the kinds of the rows in
 * columns, their counts right-aligned.
 */
function KindChart({namespace, counts, onShow, stacked = false}) {
    const {t} = useTranslation();
    const kinds = KINDS.map((kind) => [kind, countOf(kind, counts)]);
    if (kinds.every(([, n]) => n === 0)) return <span className="text-ink-muted">–</span>;
    return (
        // Stacked, a kind a line, those it holds alone.
        <span className={stacked ? "grid grid-cols-1 gap-1" : "grid grid-cols-[repeat(4,max-content)] items-center gap-1"} data-kinds={stacked ? "stacked" : ""}>
            {kinds.map(([kind, n]) => {
                if (n === 0) return stacked ? null : <span key={kind} aria-hidden="true" data-empty-kind={kind} className="w-[9.5ch]"/>;
                const parts = partsOf(kind, counts);
                const said = parts.map(([avail, c]) => t("namespaces.kinds.avail", {count: c, avail})).join(", ");
                const name = t(`namespaces.kinds.show.${kind}`, {count: n, namespace});
                return (
                    <button
                        key={kind}
                        type="button"
                        data-kind={kind}
                        aria-label={said ? `${name}: ${said}` : name}
                        onClick={(e) => {
                            e.stopPropagation();
                            onShow(objectsUrl(namespace, {kind}));
                        }}
                        className="inline-flex h-6 w-[9.5ch] items-center gap-1 rounded-(--radius-control) border border-line px-1.5 whitespace-nowrap hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
                    >
                        <span className="w-[3ch] text-right font-medium tabular-nums">{n}</span>
                        <span className="w-[3ch] text-ink-muted">{t(`namespaces.kinds.short.${kind}`)}</span>
                        {parts.length > 0 ? <StatusPie parts={parts}/> : <span aria-hidden="true" className="w-[1em]"/>}
                    </button>
                );
            })}
        </span>
    );
}

/**
 * A figure of a namespace over a cap: what it uses on top, and under it, a cap there,
 * its part of the cap in a bar of a segment a pool or a network, and the cap. A part
 * past 80% said in red.
 */
function StackedUsage({value, segments, used, cap, format, capFormat = format, label, locale, measured = true}) {
    const {t} = useTranslation();
    const share = cap > 0 ? used / cap : undefined;
    return (
        <span className="flex flex-col gap-0.5 whitespace-nowrap" data-usage="">
            <span className="tabular-nums">{value}</span>
            {share !== undefined && (
                <span className="flex items-center gap-1.5 text-data text-ink-muted tabular-nums">
                    <SegmentedBar segments={segments} total={cap} label={label} width="w-24"/>
                    <span className={measured && share > 0.8 ? "text-state-down" : undefined}>{measured ? percentOf(used, cap, locale) : "–"}</span>
                    <span>{t("namespaces.usage.ofCap", {cap: capFormat(cap)})}</span>
                </span>
            )}
        </span>
    );
}

/**
 * What a namespace holds of the pools or networks: the amount on top, its share of
 * what it may hold under it: the amount in `format`, with its unit; the cap, and the
 * parts said to the screen readers, in `plain`, a unit that never changes said once.
 */
function UsageCell({usage, format, plain = format, title, locale}) {
    const {t} = useTranslation();
    if (usage.segments.length === 0) return <span className="text-ink-muted">–</span>;
    const parts = usage.segments.map((s) => t(s.claimed ? "namespaces.usage.claimed" : "namespaces.usage.unclaimed", {
        name: s.name, used: plain(s.used), total: plain(s.total), percent: percentOf(s.used, s.total, locale),
    }));
    return (
        <StackedUsage
            value={format(usage.used)}
            segments={usage.segments.map((s) => ({name: s.name, value: s.used}))}
            used={usage.used}
            cap={usage.total}
            format={format}
            capFormat={plain}
            label={t("namespaces.usage.barLabel", {title, parts: parts.join(", ")})}
            locale={locale}
        />
    );
}

/** What a namespace uses of the cpu or the memory: the amount on top, its part of the cap under it, a claim capping it. */
function CapCell({used, cap, format, label, locale}) {
    if (used === undefined && cap === undefined) return <span className="text-ink-muted">–</span>;
    return (
        <StackedUsage
            value={used === undefined ? "–" : format(used)}
            segments={[{name: "used", value: used ?? 0}]}
            used={used ?? 0}
            cap={cap}
            format={format}
            label={label}
            locale={locale}
            measured={used !== undefined}
        />
    );
}

/**
 * What a namespace takes of the cluster in one cell, a line a figure: its name, what
 * it takes, and over a cap, its part of it in a bar and the cap; the figures of the
 * rows lined up, each part in a slot of its width.
 */
function ClaimsCell({figures}) {
    return (
        <span className="grid grid-cols-[8ch_11ch_6rem_max-content] items-center gap-x-2 gap-y-0.5 whitespace-nowrap" data-claims="">
            {figures.map((f) => (
                <React.Fragment key={f.key}>
                    <span className="text-ink-muted" data-figure={f.key}>{f.title}</span>
                    <span className="text-right tabular-nums">{f.value}</span>
                    {f.cap !== undefined
                        ? <SegmentedBar segments={f.segments} total={f.cap} label={f.label} width="w-24"/>
                        : <span/>}
                    <span className="text-data text-ink-muted tabular-nums">
                        {f.cap !== undefined && (
                            <>
                                <span className={f.share > 0.8 ? "text-state-down" : undefined}>{f.percent}</span>
                                {" "}{f.ofCap}
                            </>
                        )}
                    </span>
                </React.Fragment>
            ))}
        </span>
    );
}

const NamespaceRow = React.memo(({namespace, counts, pools, networks, cpu, memory, locale, isOpen, onShow, onOpen, layout = "full"}) => {
    const {t} = useTranslation();
    const cpuUsed = cpu.used;
    const memoryUsed = memory.used;
    // In cpu, mcpu or µcpu, three significant digits at most.
    const cpus = (n) => formatCpu(n, locale);
    return (
        // The row opens the panel of the namespace; its counts, the objects they count.
        // One height for every line, whatever its cells hold: pills, bars or a dash.
        // Compact, the claims in one cell; as cards, its cells as in the full table, each under its title.
        layout === "compact" || layout === "narrow" ? (
            <Row onActivate={() => onOpen(namespace)} selected={isOpen} data-namespace={namespace}>
                <Cell className="font-medium">{namespace}</Cell>
                <Cell><KindChart namespace={namespace} counts={counts} onShow={onShow} stacked={layout !== "compact"}/></Cell>
                <Cell><ClaimsCell figures={claimFigures({t, namespace, pools, networks, cpu, memory, locale})}/></Cell>
            </Row>
        ) :
        <Row onActivate={() => onOpen(namespace)} selected={isOpen} className="h-12" data-namespace={namespace}>
            <Cell className="font-medium">{namespace}</Cell>
            <Cell><KindChart namespace={namespace} counts={counts} onShow={onShow}/></Cell>
            <Cell><UsageCell usage={pools} format={(n) => size(n, locale)} title={t("namespaces.columns.pools")} locale={locale}/></Cell>
            <Cell>
                <UsageCell
                    usage={networks}
                    format={(n) => t("namespaces.usage.addresses", {count: n, value: n.toLocaleString(locale)})}
                    plain={(n) => n.toLocaleString(locale)}
                    title={t("namespaces.columns.nets")}
                    locale={locale}
                />
            </Cell>
            <Cell><CapCell used={cpuUsed} cap={cpu.cap} format={cpus} label={t("namespaces.usage.cpuOf", {namespace})} locale={locale}/></Cell>
            <Cell><CapCell used={memoryUsed} cap={memory.cap} format={(n) => size(n, locale)} label={t("namespaces.usage.memoryOf", {namespace})} locale={locale}/></Cell>
        </Row>
    );
});

/** The value a column sorts a row by. */
const SORT = {
    namespace: (row) => row.namespace,
    objects: (row) => KINDS.reduce((n, kind) => n + countOf(kind, row.counts), 0),
    pools: (row) => row.pools.used,
    nets: (row) => row.networks.used,
    cpu: (row) => row.cpu.used ?? -1,
    memory: (row) => row.memory.used ?? -1,
};

const COLUMNS = ["namespace", "objects", "pools", "nets", "cpu", "memory"];

/**
 * The layouts of the table, from the widest, the room choosing (`useFitLevel`): its
 * columns; the claims in one column, the kinds side by side; the kinds stacked; cards.
 */
const LAYOUTS = ["full", "compact", "narrow", "cards"];
const COMPACT_COLUMNS = ["namespace", "objects", "claims"];

/** The figures of the claims cell of a namespace: the pools, the networks, the cpu, the memory. */
function claimFigures({t, namespace, pools, networks, cpu, memory, locale}) {
    const bytes = (n) => size(n, locale);
    const plain = (n) => n.toLocaleString(locale);
    const ofUsage = (key, usage, format, capFormat, title) => {
        if (usage.segments.length === 0) return {key, title, value: "–"};
        const parts = usage.segments.map((s) => t(s.claimed ? "namespaces.usage.claimed" : "namespaces.usage.unclaimed", {
            name: s.name, used: capFormat(s.used), total: capFormat(s.total), percent: percentOf(s.used, s.total, locale),
        }));
        return {
            key, title, value: format(usage.used),
            segments: usage.segments.map((s) => ({name: s.name, value: s.used})), cap: usage.total,
            share: usage.total > 0 ? usage.used / usage.total : 0, percent: percentOf(usage.used, usage.total, locale),
            ofCap: t("namespaces.usage.ofCap", {cap: capFormat(usage.total)}),
            label: t("namespaces.usage.barLabel", {title, parts: parts.join(", ")}),
        };
    };
    const ofCap = (key, {used, cap}, format, title, label) => ({
        key, title, value: used === undefined ? "–" : format(used),
        ...(cap === undefined ? {} : {
            segments: [{name: "used", value: used ?? 0}], cap,
            share: used === undefined ? 0 : used / cap, percent: used === undefined ? "–" : percentOf(used, cap, locale),
            ofCap: t("namespaces.usage.ofCap", {cap: format(cap)}), label,
        }),
    });
    return [
        ofUsage("pools", pools, bytes, bytes, t("namespaces.columns.pools")),
        ofUsage("nets", networks, (n) => t("namespaces.usage.addresses", {count: n, value: plain(n)}), plain, t("namespaces.columns.nets")),
        ofCap("cpu", cpu, (n) => formatCpu(n, locale), t("namespaces.columns.cpu"), t("namespaces.usage.cpuOf", {namespace})),
        ofCap("memory", memory, bytes, t("namespaces.columns.memory"), t("namespaces.usage.memoryOf", {namespace})),
    ];
}

/**
 * The namespaces: what each holds, its services and volumes by availability, its
 * secrets and configurations, and what it takes of the cluster, out of what its
 * claims allow: the pools, the networks, the cpu and the memory.
 */
const Namespaces = () => {
    const {t, i18n} = useTranslation();
    const navigate = useNavigate();
    const locale = i18n.language;

    const [sortColumn, setSortColumn] = useState("namespace");
    const [sortDirection, setSortDirection] = useState("asc");
    // The namespace whose panel is open, and its tab, in the URL.
    const {sel: openNamespace, tab: panelTab, select: selectNamespace, setTab: setPanelTab} = usePanelSearch();

    const objectStatus = useEventStore(selectObjectStatus);
    const counts = useMemo(() => kindCounts(objectStatus ?? {}), [objectStatus]);
    const namespaces = useMemo(() => [...counts.keys()].sort(), [counts]);
    const claims = useNamespaceClaims(namespaces);
    const pg = useNamespacePg();

    const deferredSortColumn = useDeferredValue(sortColumn);
    const deferredSortDirection = useDeferredValue(sortDirection);

    const namespaceEventTypes = useMemo(() => [
        'ObjectStatusUpdated',
        'InstanceStatusUpdated',
        'ObjectDeleted',
        'InstanceConfigUpdated'
    ], []);

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, namespaceEventTypes) : null;
        return () => {
            release?.();
        };
    }, [namespaceEventTypes]);

    const rows = useMemo(() => namespaces.map((namespace) => {
        const own = claims.claims[namespace] ?? [];
        return {
            namespace,
            counts: counts.get(namespace),
            pools: poolUsage(namespace, claims.poolsHeld, claims.pools, own),
            networks: networkUsage(namespace, claims.networksHeld, claims.networks, own),
            // Over every node of the cluster: none until read, the cpu until a second reading.
            cpu: {used: pg[namespace]?.cpu ?? undefined, cap: computeLimit(own, "cpu")},
            memory: {used: pg[namespace]?.memory, cap: computeLimit(own, "memory")},
        };
    }), [namespaces, counts, claims, pg]);

    const sortedRows = useMemo(() => {
        const key = SORT[deferredSortColumn] ?? SORT.namespace;
        const sorted = [...rows].sort((a, b) => {
            const [x, y] = [key(a), key(b)];
            const diff = typeof x === "string" ? x.localeCompare(y) : x - y;
            // Ties in the order of the names, whatever the direction.
            return diff || a.namespace.localeCompare(b.namespace) * (deferredSortDirection === "asc" ? 1 : -1);
        });
        return deferredSortDirection === "asc" ? sorted : sorted.reverse();
    }, [rows, deferredSortColumn, deferredSortDirection]);

    // The rows drawn as the end of the table nears; sorted again, the first ones again.
    const drawn = useRowsOnDemand(sortedRows.length, [deferredSortColumn, deferredSortDirection]);
    const {rows: drawnOf} = drawn;
    const visibleRows = useMemo(() => drawnOf(sortedRows), [drawnOf, sortedRows]);

    const handleSort = useCallback((column) => {
        setSortColumn((prev) => {
            if (prev === column) {
                setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
                return column;
            }
            // A name reads from A, a figure from the largest.
            setSortDirection(column === "namespace" ? "asc" : "desc");
            return column;
        });
    }, []);

    const handleShow = useCallback((url) => navigate(url), [navigate]);
    // The layout the room allows: its columns, the claims in one, the kinds stacked, cards.
    const scroller = useRef(null);
    const layout = LAYOUTS[useFitLevel(LAYOUTS.length, scroller)];
    const columns = layout === "full" || layout === "cards" ? COLUMNS : COMPACT_COLUMNS;
    // A row opens its panel on its first tab, the usage, whatever tab was open before.
    const handleOpen = useCallback((namespace) => selectNamespace(namespace, "usage"), [selectNamespace]);
    const handleClose = useCallback(() => selectNamespace(undefined), [selectNamespace]);

    return (
        <div className="flex h-full flex-col gap-3 p-4">
            <p className="text-ink-muted tabular-nums">{t("namespaces.count", {count: sortedRows.length})}</p>

            <Table
                sticky
                ref={scroller}
                // The rows as cards, the room too narrow for any of its tables.
                cards={layout === "cards" ? "always" : false}
                data-testid="table-container"
                aria-label={t("namespaces.tableLabel")}
                className="min-h-0 flex-1 overflow-auto"
            >
                <thead>
                    <HeaderRow>
                        {columns.map((column) => (SORT[column] ? (
                            <SortHeaderCell
                                key={column}
                                label={t(`namespaces.columns.${column}`)}
                                active={sortColumn === column}
                                direction={sortDirection}
                                onSort={() => handleSort(column)}
                            />
                        ) : <HeaderCell key={column}>{t(`namespaces.columns.${column}`)}</HeaderCell>))}
                    </HeaderRow>
                </thead>
                <tbody>
                    {visibleRows.map((row) => (
                        <NamespaceRow
                            key={row.namespace}
                            {...row}
                            locale={locale}
                            layout={layout}
                            isOpen={openNamespace === row.namespace}
                            onShow={handleShow}
                            onOpen={handleOpen}
                        />
                    ))}
                    <MoreRows rows={drawn} colSpan={columns.length}/>
                    {visibleRows.length === 0 && (
                        <EmptyRow colSpan={columns.length}>
                            <span data-testid="no-namespaces-message">{t("namespaces.empty")}</span>
                        </EmptyRow>
                    )}
                </tbody>
            </Table>
            {claims.error && <p className="text-ink-muted">{t("namespaces.usage.error", {message: claims.error})}</p>}

            <NamespaceDetailPanel
                name={openNamespace ?? undefined}
                tab={panelTab}
                onTabChange={setPanelTab}
                onClose={handleClose}
            />
        </div>
    );
};

export default Namespaces;
