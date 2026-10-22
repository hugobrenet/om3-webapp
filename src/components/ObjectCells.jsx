import React from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {useObjectData} from "../hooks/useObjectData";
import {useKeyStats} from "../hooks/useKeyStats";
import {Cell} from "../ui/components/Table";
import {NotProvisionedMark as PMark} from "../ui/components/StateMarks";
import {FrozenMark} from "../ui/components/FrozenMark";
import {HoverCard} from "../ui/components/HoverCard";
import {formatBytes} from "../ui/lib/format";
import {AlertTriangleIcon} from "../ui/icons";
import {Figures} from "./Figures";
import {parseObjectPath} from "../utils/objectUtils.jsx";

/*
 * The cells of an object row, shared by the objects table and the object lists of
 * a namespace panel: its status, its orchestrate and topology, its keys.
 */

/** An availability as a mark state: n/a, or none, is "/", anything else unknown. */
const MARK_STATE = {up: "up", down: "down", warn: "warn", "n/a": "na", "": "na"};
export const markState = (avail) => MARK_STATE[avail ?? ""] ?? "unknown";

/** The not-provisioned mark: an icon in the down colour, named for screen readers. */
export const NotProvisionedMark = () => {
    const {t} = useTranslation();
    return (
        <PMark label={t("objects.notProvisioned")}/>
    );
};

/** Small muted text on one line: a global expect, a monitor state. */
export const SideText = ({children}) => (
    <span title={children} className="text-[0.75rem] whitespace-nowrap text-ink-muted">{children}</span>
);

/** The tint of an availability as text: n/a muted, an unknown value in the unknown tint. */
const AVAIL_INK = {up: "text-state-up", down: "text-state-down", warn: "text-state-warn", na: "text-ink-muted", unknown: "text-state-unknown"};

/** The degraded mark: the overall state of the object is warn, whatever its availability. */
const DegradedMark = () => {
    const {t} = useTranslation();
    return (
        <span role="img" aria-label={t("objects.degraded")} title={t("objects.degraded")}
              className="inline-flex text-state-warn">
            <AlertTriangleIcon className="h-3.5 w-3.5"/>
        </span>
    );
};

/**
 * The availability of the object as a bold word in its tint, the degraded mark when
 * its overall state is warn, then its frozen and not-provisioned marks and global expect.
 */
export const StatusMarks = React.memo(({avail, isDegraded, isNotProvisioned, frozen, globalExpect}) => {
    const state = markState(avail);
    return (
        <span className="inline-flex items-center gap-1.5">
            <span data-state={state} className={`font-semibold ${AVAIL_INK[state]}`}>{avail || "n/a"}</span>
            {isDegraded && <DegradedMark/>}
            <FrozenMark frozen={frozen === "frozen"}/>
            {isNotProvisioned && <NotProvisionedMark/>}
            {globalExpect && <SideText>{globalExpect}</SideText>}
        </span>
    );
}, (prev, next) => prev.avail === next.avail && prev.isDegraded === next.isDegraded &&
    prev.isNotProvisioned === next.isNotProvisioned && prev.frozen === next.frozen &&
    prev.globalExpect === next.globalExpect);

/**
 * The flex parameters of an object in a badge, min-max then the target, each named
 * in its hover card: the badge says them in short, the card what each one is.
 */
export const FlexBadge = ({min, max, target}) => {
    const {t} = useTranslation();
    const hasTarget = target !== undefined && target !== null;
    return (
        <HoverCard
            focusable
            card={
                <Figures
                    title={t("objects.flex.title")}
                    lines={[
                        [t("objects.flex.min"), min],
                        [t("objects.flex.max"), max],
                        ...(hasTarget ? [[t("objects.flex.target"), target]] : []),
                    ]}
                />
            }
        >
            <span data-flex="" className="inline-flex rounded-(--radius-control) border border-line px-1 text-data tabular-nums leading-tight text-ink-muted">
                {hasTarget ? `${min}-${max} · ${target}` : `${min}-${max}`}
            </span>
        </HoverCard>
    );
};

/** The property cells of an object row, each read on its own from the store. */
/** The look of the small badge over a path, or over the name of a namespace. */
export const BADGE = "inline-flex h-4 shrink-0 items-center rounded-sm border border-line-strong px-0.5 text-[0.6875rem] leading-none font-medium text-ink-muted";

/** The kinds of the objects holding keys others install from. */
const DATASTORE_KINDS = ["cfg", "sec"];

/**
 * The orchestrate and the topology of an object as one small badge over its path,
 * where the narrow list has no column for them: "ha · failover", "start · flex"; the
 * topology alone for "no" orchestrate; the flex sizes left out. A cfg or a sec,
 * which has neither, "datastore". None else.
 */
export const OrchestrateBadge = ({objectName}) => {
    const {t} = useTranslation();
    const orchestrate = useEventStore((s) => s.objectStatus?.[objectName]?.orchestrate);
    const topology = useEventStore((s) => s.objectStatus?.[objectName]?.topology);
    const parts = [
        (orchestrate === "ha" || orchestrate === "start") && [t("objects.columns.orchestrate"), orchestrate],
        topology && [t("objects.columns.topology"), topology],
    ].filter(Boolean);
    if (parts.length === 0) {
        if (!DATASTORE_KINDS.includes(parseObjectPath(objectName).kind)) return null;
        const datastore = t("objects.badges.datastore");
        return (
            <span data-mark="datastore" className={BADGE}>{datastore}</span>
        );
    }
    const label = parts.map(([name, value]) => `${name}: ${value}`).join(", ");
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            data-mark="orchestrate"
            className={BADGE}
        >
            <span aria-hidden="true">{parts.map(([, value]) => value).join(" · ")}</span>
        </span>
    );
};

/**
 * The instances of an object up out of its target: "1/1" for a failover, "2/3" for a
 * flex of target 3, its count alone without a target. Short of it, in the warn tint.
 */
export const UpCell = ({objectName}) => {
    const status = (s) => s.objectStatus?.[objectName];
    const up = useEventStore((s) => status(s)?.up_instances_count);
    const topology = useEventStore((s) => status(s)?.topology);
    const flexTarget = useEventStore((s) => status(s)?.flex?.target);
    const target = topology === "failover" ? 1 : topology === "flex" ? flexTarget : undefined;
    const short = up !== undefined && target !== undefined && up < target;
    return (
        <Cell className={short ? "whitespace-nowrap tabular-nums text-state-warn" : "whitespace-nowrap tabular-nums"}>
            {up === undefined ? "" : target === undefined ? up : `${up}/${target}`}
        </Cell>
    );
};

/**
 * The property cells of an object row. `narrow`, the orchestrate and the topology in
 * the badge by the path: the instances up out of the target alone in their place.
 */
export const PropertyCells = ({objectName, narrow = false}) => {
    const status = (s) => s.objectStatus?.[objectName];
    const orchestrate = useEventStore((s) => status(s)?.orchestrate);
    const topology = useEventStore((s) => status(s)?.topology);
    const flexMin = useEventStore((s) => status(s)?.flex?.min);
    const flexMax = useEventStore((s) => status(s)?.flex?.max);
    const flexTarget = useEventStore((s) => status(s)?.flex?.target);
    const isFlex = topology === "flex" && flexMin !== undefined && flexMax !== undefined;

    if (narrow) return <UpCell objectName={objectName}/>;
    return (
        <>
            <Cell className="whitespace-nowrap">{orchestrate}</Cell>
            <Cell className="whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                    {topology}
                    {isFlex && <FlexBadge min={flexMin} max={flexMax} target={flexTarget}/>}
                </span>
            </Cell>
        </>
    );
};

/**
 * How many keys a cfg, sec or usr object holds, and their size as stored: read for
 * the rows shown only (useKeyStats). Nothing while read, a dash for an object
 * without keys of its own, the cluster object say.
 */
export const KeyCells = ({objectName}) => {
    const {i18n} = useTranslation();
    const stats = useKeyStats(objectName);
    const dash = <span className="text-ink-muted">–</span>;
    return (
        <>
            <Cell numeric className="tabular-nums">{stats === null ? "" : stats === undefined ? dash : stats.count}</Cell>
            <Cell numeric className="whitespace-nowrap tabular-nums">
                {stats === null ? "" : stats === undefined ? dash : stats.size > 0 ? formatBytes(stats.size, i18n.language) : "0"}
            </Cell>
        </>
    );
};

/** The status cell of an object row, read on its own from the store: its availability and marks. */
export const ObjectStatusCell = ({objectName}) => {
    const objectData = useObjectData(objectName);
    const isDegraded = useEventStore((s) => s.objectStatus?.[objectName]?.overall === "warn");
    return (
        <Cell className="whitespace-nowrap">
            <StatusMarks
                avail={objectData.avail}
                isDegraded={isDegraded}
                isNotProvisioned={objectData.isNotProvisioned}
                frozen={objectData.frozen}
                globalExpect={objectData.globalExpect}
            />
        </Cell>
    );
};
