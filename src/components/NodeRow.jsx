import React from "react";
import {Row, Cell} from "../ui/components/Table";
import {Checkbox} from "../ui/components/Field";
import {FrozenMark} from "../ui/components/FrozenMark";
import {UsageBar} from "../ui/components/UsageBar";
import {RssIcon, TagIcon} from "../ui/icons";
import {useTranslation} from "react-i18next";
import {AgeTime, ZERO_DATE} from "./AgeTime";
import {BADGE} from "./ObjectCells";
import {nodeColumns, nodeLayout} from "../app/node-layout";

/**
 * The node monitor state as a mark: idle is the normal state, a failure is down,
 * anything else is a transition. Without a monitor the state is unknown.
 */
export const monitorMark = (monitor) => {
    const state = monitor?.state;
    if (!state) return {state: "unknown", label: "unknown"};
    if (state === "idle") return {state: "up", label: "idle"};
    if (state.includes("fail")) return {state: "down", label: state};
    return {state: "warn", label: state};
};

const MONITOR_STATE_CLASS = {up: undefined, down: "text-state-down", warn: "font-semibold", unknown: "text-ink-muted"};

/**
 * The node monitor state in words, styled after what it says: idle quiet, a failure
 * red, anything else running, bold; unknown muted.
 */
export function MonitorState({monitor}) {
    const {t} = useTranslation();
    const mark = monitorMark(monitor);
    return <span data-state={mark.state} className={MONITOR_STATE_CLASS[mark.state]}>{monitor?.state || t("common.unknown")}</span>;
}

/** A figure in the tint of its state, as the bars it stands for: quiet when fine. */
const FIGURE_INK = {up: undefined, warn: "text-state-warn", down: "text-state-down"};

/** The whole table: what a row shows when no layout is given. */
const WHOLE = nodeLayout(0);

/**
 * The name of a node, its env a badge by it when the table has no column for it, its
 * dates under it, a line each, when it has none for them.
 */
function NameCell({nodename, env, layout, booted, updated}) {
    const {t} = useTranslation();
    return (
        <Cell className="font-medium whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5">
                {nodename || "-"}
                {!layout.envColumn && env && <span className={BADGE}>{env}</span>}
            </span>
            {layout.datesInName && (
                <span data-dates="" className="block text-data font-normal text-ink-muted">
                    <span className="block">{t("nodes.row.booted")} <AgeTime value={booted}/></span>
                    <span className="block">{t("nodes.row.updated")} <AgeTime value={updated}/></span>
                </span>
            )}
        </Cell>
    );
}

/**
 * A node of the Nodes view. It opens the node's panel, whose title bar holds the
 * actions on it: the row has no menu of its own. Its cells those of `layout`, the
 * table scaled down to its room (`nodeLayout`); its agent version, when the table has
 * no column for it, a mark by its state if not `commonVersion`.
 */
const NodeRow = ({
                     nodename,
                     stats,
                     status,
                     monitor,
                     info,
                     isSelected,
                     daemonNodename,
                     onSelect,
                     onOpen,
                     isOpen = false,
                     layout = WHOLE,
                     commonVersion,
                 }) => {
    const {t} = useTranslation();
    const notAvailable = t("common.notAvailable");
    const isFrozen = !!status?.frozen_at && status.frozen_at !== ZERO_DATE;
    const isDaemonNode = daemonNodename === nodename;

    const loadState = stats?.load_15m > 4 ? "down" : stats?.load_15m > 2 ? "warn" : "up";
    const memState = stats?.mem_avail < 20 ? "down" : stats?.mem_avail < 50 ? "warn" : "up";

    // A node of the cluster that reports nothing, dropped or not heard from yet: a
    // "?" for each of its values, as om mon shows it; no action reaches it.
    if (status === undefined && monitor === undefined && stats === undefined) {
        const unknown = <span className="text-ink-muted">?</span>;
        const others = nodeColumns(layout).slice(2);
        return (
            <Row
                aria-label={t("nodes.row.label", {node: nodename})}
                onActivate={onOpen ? () => onOpen(nodename) : undefined}
                selected={isOpen}
            >
                <Cell className="w-8">
                    <Checkbox
                        checked={false}
                        disabled
                        onChange={() => {}}
                        aria-label={t("nodes.row.select", {node: nodename})}
                        onClick={(e) => e.stopPropagation()}
                    />
                </Cell>
                <Cell className="font-medium whitespace-nowrap">{nodename}</Cell>
                <Cell className="whitespace-nowrap">
                    <span className="flex justify-center font-semibold text-state-down">
                        <span aria-hidden="true">?</span>
                        <span className="sr-only">{t("nodes.row.lost")}</span>
                    </span>
                </Cell>
                {others.map(({key}) => <Cell key={key}>{unknown}</Cell>)}
            </Row>
        );
    }

    // A figure reported, 0 included: none is "n/a", a 0 one is a 0 (no memory left, no load).
    const has = (value) => typeof value === "number";
    const versionDiffers = !layout.version && commonVersion !== undefined && !!status?.agent && status.agent !== commonVersion;
    const load = (
        <UsageBar
            value={has(stats?.load_15m) ? Math.min(stats.load_15m * 20, 100) : undefined}
            text={String(stats?.load_15m)}
            missing={notAvailable}
            state={loadState}
            label={t("nodes.columns.load15m")}
        />
    );
    const mem = (
        <UsageBar
            value={has(stats?.mem_avail) ? stats.mem_avail : undefined}
            text={`${stats?.mem_avail}%`}
            missing={notAvailable}
            state={memState}
            label={t("nodes.columns.memAvail")}
        />
    );
    // A dash rather than a percent of nothing: no value reported, or no swap.
    const swap = typeof stats?.swap_avail === "number" && stats?.swap_total !== 0 ? `${stats.swap_avail}%` : "-";
    const score = has(stats?.score) ? stats.score : notAvailable;

    return (
        <Row
            aria-label={t("nodes.row.label", {node: nodename})}
            onActivate={onOpen ? () => onOpen(nodename) : undefined}
            selected={isOpen}
            className={isSelected ? "bg-accent-soft" : undefined}
        >
            <Cell className="w-8">
                <Checkbox
                    checked={isSelected}
                    onChange={(e) => onSelect(e, nodename)}
                    aria-label={t("nodes.row.select", {node: nodename})}
                    onClick={(e) => e.stopPropagation()}
                />
            </Cell>
            <NameCell nodename={nodename} env={info?.env} layout={layout} booted={status?.booted_at} updated={monitor?.updated_at}/>
            <Cell className="whitespace-nowrap">
                <span className="flex items-center justify-center gap-1.5">
                    <MonitorState monitor={monitor}/>
                    {isDaemonNode && (
                        <span
                            role="img"
                            aria-label={t("nodes.row.connected")}
                            className="text-state-up"
                        >
                            <RssIcon className="h-3.5 w-3.5"/>
                        </span>
                    )}
                    {versionDiffers && (
                        <span
                            role="img"
                            aria-label={t("nodes.row.versionDiff", {version: status.agent, common: commonVersion})}
                            className="text-state-warn"
                        >
                            <TagIcon className="h-3.5 w-3.5"/>
                        </span>
                    )}
                    <FrozenMark frozen={isFrozen}/>
                </span>
            </Cell>
            {layout.metricsGrouped ? (
                // The four figures in one cell, two a line, each after its short name; no bar,
                // the load and the memory in the tint of their state.
                <Cell className="whitespace-nowrap">
                    <span data-metrics="" className="grid grid-cols-[auto_auto_auto_auto] items-center gap-x-2 text-data tabular-nums">
                        <span className="text-ink-muted">{t("nodes.short.score")}</span><span>{score}</span>
                        <span className="text-ink-muted">{t("nodes.short.load")}</span>
                        <span data-state={loadState} className={FIGURE_INK[loadState]}>{stats?.load_15m ?? notAvailable}</span>
                        <span className="text-ink-muted">{t("nodes.short.mem")}</span>
                        <span data-state={memState} className={FIGURE_INK[memState]}>{typeof stats?.mem_avail === "number" ? `${stats.mem_avail}%` : notAvailable}</span>
                        <span className="text-ink-muted">{t("nodes.short.swap")}</span><span>{swap}</span>
                    </span>
                </Cell>
            ) : (
                <>
                    <Cell numeric>{score}</Cell>
                    <Cell numeric className="whitespace-nowrap">{load}</Cell>
                    <Cell numeric className="whitespace-nowrap">{mem}</Cell>
                    <Cell numeric>{swap}</Cell>
                </>
            )}
            {layout.version && <Cell className="whitespace-nowrap">{status?.agent || notAvailable}</Cell>}
            {layout.envColumn && <Cell className="whitespace-nowrap">{info?.env || "-"}</Cell>}
            {/* Its labels, a tag each, as the node configuration sets them, on one line: not fitting, the column dropped (nodeLayout). */}
            {layout.labels && (
                <Cell>
                    {Object.keys(info?.labels ?? {}).length === 0 ? "-" : (
                        <span className="flex gap-1 whitespace-nowrap" aria-label={t("nodes.columns.labels")}>
                            {Object.entries(info.labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                                <span key={k} className={BADGE}>
                                    {v === "" ? k : `${k}=${v}`}
                                </span>
                            ))}
                        </span>
                    )}
                </Cell>
            )}
            {!layout.datesInName && (
                <>
                    <Cell className="whitespace-nowrap"><AgeTime value={status?.booted_at}/></Cell>
                    <Cell className="whitespace-nowrap"><AgeTime value={monitor?.updated_at}/></Cell>
                </>
            )}
        </Row>
    );
};

export default React.memo(NodeRow);
