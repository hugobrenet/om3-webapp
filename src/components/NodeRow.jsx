import React from "react";
import {Row, Cell} from "../ui/components/Table";
import {Checkbox} from "../ui/components/Field";
import {StatusMark} from "../ui/components/StatusMark";
import {FrozenMark} from "../ui/components/FrozenMark";
import {UsageBar} from "../ui/components/UsageBar";
import {RssIcon} from "../ui/icons";
import {useTranslation} from "react-i18next";
import {AgeTime, ZERO_DATE} from "./AgeTime";

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

/**
 * A node of the Nodes view. It opens the node's panel, whose title bar holds the
 * actions on it: the row has no menu of its own.
 */
const NodeRow = ({
                     nodename,
                     stats,
                     status,
                     monitor,
                     isSelected,
                     daemonNodename,
                     onSelect,
                     onOpen,
                     isOpen = false,
                 }) => {
    const {t} = useTranslation();
    const notAvailable = t("common.notAvailable");
    const isFrozen = !!status?.frozen_at && status.frozen_at !== ZERO_DATE;
    const isDaemonNode = daemonNodename === nodename;
    const mark = monitorMark(monitor);

    const loadState = stats?.load_15m > 4 ? "down" : stats?.load_15m > 2 ? "warn" : "up";
    const memState = stats?.mem_avail < 20 ? "down" : stats?.mem_avail < 50 ? "warn" : "up";

    // A node of the cluster that reports nothing, dropped or not heard from yet: a
    // "?" for each of its values, as om mon shows it; no action reaches it.
    if (status === undefined && monitor === undefined && stats === undefined) {
        const unknown = <span className="text-ink-muted">?</span>;
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
                    <span title={t("nodes.row.lost")} className="flex justify-center font-semibold text-state-down">
                        <span aria-hidden="true">?</span>
                        <span className="sr-only">{t("nodes.row.lost")}</span>
                    </span>
                </Cell>
                <Cell numeric>{unknown}</Cell>
                <Cell numeric>{unknown}</Cell>
                <Cell numeric>{unknown}</Cell>
                <Cell numeric>{unknown}</Cell>
                <Cell>{unknown}</Cell>
                <Cell>{unknown}</Cell>
                <Cell>{unknown}</Cell>
            </Row>
        );
    }

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
            <Cell className="font-medium whitespace-nowrap">{nodename || "-"}</Cell>
            <Cell className="whitespace-nowrap">
                <span className="flex items-center justify-center gap-1.5">
                    <StatusMark state={mark.state} label={mark.label}/>
                    {monitor && monitor.state !== "idle" && <span>{monitor.state}</span>}
                    {isDaemonNode && (
                        <span
                            role="img"
                            title={t("nodes.row.connected")}
                            aria-label={t("nodes.row.connected")}
                            className="text-state-up"
                        >
                            <RssIcon className="h-3.5 w-3.5"/>
                        </span>
                    )}
                    <FrozenMark frozen={isFrozen}/>
                </span>
            </Cell>
            <Cell numeric>{stats?.score || notAvailable}</Cell>
            <Cell numeric className="whitespace-nowrap">
                <UsageBar
                    value={stats?.load_15m ? Math.min(stats.load_15m * 20, 100) : undefined}
                    text={String(stats?.load_15m)}
                    missing={notAvailable}
                    state={loadState}
                    label={t("nodes.columns.load15m")}
                />
            </Cell>
            <Cell numeric className="whitespace-nowrap">
                <UsageBar
                    value={stats?.mem_avail ? stats.mem_avail : undefined}
                    text={`${stats?.mem_avail}%`}
                    missing={notAvailable}
                    state={memState}
                    label={t("nodes.columns.memAvail")}
                />
            </Cell>
            {/* A dash rather than a percent of nothing: no value reported, or no swap. */}
            <Cell numeric>
                {typeof stats?.swap_avail === "number" && stats?.swap_total !== 0 ? `${stats.swap_avail}%` : "-"}
            </Cell>
            <Cell className="whitespace-nowrap">{status?.agent || notAvailable}</Cell>
            <Cell className="whitespace-nowrap"><AgeTime value={status?.booted_at}/></Cell>
            <Cell className="whitespace-nowrap"><AgeTime value={monitor?.updated_at}/></Cell>
        </Row>
    );
};

export default React.memo(NodeRow);
