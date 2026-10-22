import React, {useId, useMemo} from "react";
import {useTranslation} from "react-i18next";
import {cn} from "../ui/cn";
import {InfoIcon, PlusIcon, StopIcon} from "../ui/icons";
import {heartbeatsOf, nodesOf, routinesOf} from "../app/heartbeat-summary";
import {meshLinks} from "../app/heartbeat-mesh";

const TONE = {up: "text-state-up", warn: "text-state-warn", down: "text-state-down"};
const PART = {up: "bg-state-up", down: "bg-state-down", stopped: "bg-line"};

/**
 * The ground, border and corners of the cards of the heartbeats, the routines and the
 * streams, alike.
 */
export const CARD = "rounded-(--radius-control) border border-transparent bg-surface-sunken";

/** The most links a gauge draws a segment each: more, thinner than a pixel, its parts only. */
export const SEGMENTS_MAX = 24;

/**
 * The links of a card as a gauge as wide as the card, a thin rounded bar: those
 * beating, those not on a running stream, those of a stopped stream, in that order,
 * the red always at the same place. A segment a link up to SEGMENTS_MAX, the parts in
 * proportion above. The same for the heartbeats and the routines, their bars alike.
 */
const Gauge = ({beating, stopped, total}) => {
    const parts = [["up", beating], ["down", total - beating - stopped], ["stopped", stopped]];
    return (
        <span aria-hidden="true" data-gauge="" className="flex h-1 w-full gap-0.5 overflow-hidden rounded-full">
            {total <= SEGMENTS_MAX
                ? parts.flatMap(([part, count]) => Array.from({length: count}, (_, i) => (
                    <span key={`${part}${i}`} data-part={part} className={cn("flex-1", PART[part])}/>
                )))
                : parts.filter(([, count]) => count > 0).map(([part, count]) => (
                    <span key={part} data-part={part} className={PART[part]} style={{flexGrow: count, flexBasis: 0}}/>
                ))}
        </span>
    );
};

/** The slices of a pie, as the parts of a gauge. */
const SLICE = {up: "stroke-state-up", down: "stroke-state-down", stopped: "stroke-line"};

/**
 * The links of a routine as a pie as big as a character: those beating, those not on
 * a running stream, those of a stopped stream, in that order round from the top, in
 * the colours of the gauges. A circle of a radius half its stroke draws each slice.
 */
const Pie = ({beating, stopped, total}) => {
    const round = 2 * Math.PI * 4;
    let start = 0;
    const slices = [["up", beating], ["down", total - beating - stopped], ["stopped", stopped]]
        .filter(([, count]) => count > 0)
        .map(([part, count]) => {
            const length = (round * count) / total;
            const slice = {part, length, start};
            start += length;
            return slice;
        });
    return (
        <svg aria-hidden="true" data-pie="" viewBox="0 0 16 16" className="size-[1em] shrink-0 -rotate-90">
            <circle cx="8" cy="8" r="8" className="fill-line"/>
            {slices.map(({part, length, start: from}) => (
                <circle
                    key={part}
                    data-slice={part}
                    cx="8"
                    cy="8"
                    r="4"
                    fill="none"
                    strokeWidth="8"
                    strokeDasharray={`${length} ${round}`}
                    strokeDashoffset={-from}
                    className={SLICE[part]}
                />
            ))}
        </svg>
    );
};

/**
 * A card of the heartbeats: its name, its links beating out of all as its label, what it
 * is, a gauge. Clicked, `onOpen`: its configuration.
 */
function SummaryCard({cardKey, title, detail, counts, onOpen, openLabel}) {
    return (
        <li data-card={cardKey} className={cn("relative flex min-w-0 flex-col gap-1 px-2 py-1.5", CARD)}>
            {onOpen && (
                <button
                    type="button"
                    aria-label={openLabel}
                    onClick={onOpen}
                    className="absolute inset-0 rounded-(--radius-control) hover:bg-line/40"
                />
            )}
            <span className="pointer-events-none relative flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{title}</span>
                <span className={cn("shrink-0 tabular-nums", TONE[counts.state])} data-counts="">
                    {counts.beating}/{counts.total}
                </span>
            </span>
            <span className="pointer-events-none relative truncate text-ink-muted">{detail}</span>
            <span className="pointer-events-none relative"><Gauge beating={counts.beating} stopped={counts.stopped} total={counts.total}/></span>
        </li>
    );
}

/**
 * The routines of the nodes, a zone a node: a rectangle, a border around, the name
 * of the node on it, its routines inside, receiving on the left, sending on the right,
 * a grey card each, in as many columns as fit: the heartbeat and a pie of its links, their
 * counts in its popup with its whole name, type and state. For root, a card clicked stops its routine started,
 * starts it otherwise, once confirmed: `onToggle`; `busy`, the card of the routine
 * whose request runs ("n1 hb#1.tx").
 */
function RoutineZones({routines, nodes, onToggle, busy}) {
    const {t} = useTranslation();
    const routineWord = (state) => (state === "running" || state === "stopped" ? t(`heartbeats.routine.${state}`) : (state || t("common.unknown")));
    return (
        <div className="flex flex-col gap-3 pt-2">
            {nodes.map((node) => (
                // A fieldset, its legend on its border, broken under the name.
                <fieldset key={node.node} data-zone-box={node.node} className="min-w-0 rounded-(--radius-panel) border border-line px-2 pb-2">
                    <legend data-zone={node.node} className="flex items-center gap-1.5 px-2 text-xs leading-5 font-semibold text-ink">
                        <span className="truncate">{node.node}</span>
                        <span className={cn("shrink-0 font-normal tabular-nums", TONE[node.state])}>{node.beating}/{node.total}</span>
                    </legend>
                    {/* Its routines receiving on the left, sending on the right, a half each, a
                        light line between: the cards say their heartbeat only. */}
                    <div className="grid grid-cols-2 divide-x divide-line">
                        {["rx", "tx"].map((dir) => (
                            <div key={dir} data-dir={dir} className={cn("min-w-0", dir === "rx" ? "pr-2" : "pl-2")}>
                                <p className="mb-1 text-xs text-ink-muted">{t(`heartbeats.summary.side.${dir}`)}</p>
                                {/* As many columns as the half holds. */}
                                <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
                                    {routines.filter((r) => r.node === node.node && r.dir === dir).map((r) => {
                                        const key = `${r.node} ${r.id}`;
                                        const name = `${r.node} ${r.hb} ${r.dir}`;
                                        const action = r.streamState === "running" ? "stop" : "start";
                                        const isBusy = busy === key;
                                        const stopped = r.streamState !== "running";
                                        return (
                                            <li
                                                key={key}
                                                data-card={key}
                                                aria-busy={isBusy || undefined}
                                                title={`${name} · ${r.type} · ${routineWord(r.streamState)} · ${t("heartbeats.summary.beatingOf", {beating: r.beating, count: r.total})}`}
                                                data-stopped={stopped || undefined}
                                                className={cn("relative flex min-w-0 flex-col gap-1 px-2 py-1.5", CARD, isBusy && "animate-pulse")}
                                            >
                                                {/* For root, the whole card stopping its routine, or starting it. */}
                                                {onToggle && (
                                                    <button
                                                        type="button"
                                                        data-action={action}
                                                        aria-label={t(`heartbeats.actions.${action}Routine`, {name})}
                                                        disabled={isBusy}
                                                        onClick={() => onToggle(r)}
                                                        className="absolute inset-0 rounded-(--radius-control) hover:bg-line/40"
                                                    />
                                                )}
                                                <span className="pointer-events-none relative flex items-center justify-between gap-1.5">
                                                    <span className="min-w-0 truncate font-medium" data-name="">{r.hb}</span>
                                                    {/* Stopped, a red stop in place of its pie: none of its links beats. */}
                                                    {stopped
                                                        ? <StopIcon aria-hidden="true" data-stopped-icon="" className="size-[1em] shrink-0 text-state-down"/>
                                                        : <Pie beating={r.beating} stopped={r.stopped} total={r.total}/>}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </div>
                </fieldset>
            ))}
        </div>
    );
}

/** A box of the page, on the ground of the tables. */
const BOX = "rounded-(--radius-panel) border border-line bg-surface-raised p-2 text-data";

/**
 * The heartbeats and the routines at a glance, a box each, beside the mesh in the
 * boxes of the page: a card for each heartbeat over the cluster, its type and its
 * layer; a card for each routine, the daemon thread of a stream of a node, a
 * heartbeat and a direction, in the zone of its node, the node named on its border
 * with all its streams' counts. A card says its links beating out of all, and shows
 * them as a gauge.
 *
 * `onToggle`, for root: a routine clicked, stopped when started, started otherwise,
 * once confirmed, a hint over the zones saying so; `busy`, the routine whose request
 * runs. `onOpenHeartbeat`, a heartbeat clicked, its configuration; `onNewHeartbeat`,
 * for root, a light card after them, the wizard of a new one.
 */
export function HeartbeatSummary({heartbeatStatus, onToggle, busy, onOpenHeartbeat, onNewHeartbeat}) {
    const {t} = useTranslation();
    const heartbeatsId = useId();
    const routinesId = useId();
    const links = useMemo(() => meshLinks(heartbeatStatus ?? {}), [heartbeatStatus]);
    const heartbeats = useMemo(() => heartbeatsOf(links), [links]);
    const nodes = useMemo(() => nodesOf(links), [links]);
    const routines = useMemo(() => routinesOf(links), [links]);
    if (heartbeats.length === 0) return null;
    return (
        <>
            <section aria-labelledby={heartbeatsId} className="min-w-0 space-y-2" data-box="heartbeats">
                <h2 id={heartbeatsId} className="font-semibold">{t("heartbeats.summary.list")}</h2>
                <ul className={cn(BOX, "grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2")}>
                    {heartbeats.map((h) => (
                        <SummaryCard
                            key={h.hb}
                            cardKey={h.hb}
                            title={h.hb}
                            detail={`${h.type} · ${t(`heartbeats.summary.layer.${h.layer}`)}`}
                            counts={h}
                            onOpen={onOpenHeartbeat && (() => onOpenHeartbeat(h.hb))}
                            openLabel={t("heartbeats.config.open", {name: h.hb})}
                        />
                    ))}
                    {/* A new one, root only: a light card, its wizard. A plus card adding to a card list keeps this look, out of the rule of the buttons (`Button`). */}
                    {onNewHeartbeat && (
                        <li className="min-w-0">
                            <button
                                type="button"
                                data-new-heartbeat=""
                                onClick={onNewHeartbeat}
                                className="flex h-full w-full items-center justify-center gap-1.5 rounded-(--radius-control) border border-dashed border-line px-2 py-1.5 text-ink-muted hover:border-accent hover:text-accent"
                            >
                                <PlusIcon className="h-4 w-4"/>
                                {t("heartbeats.config.new")}
                            </button>
                        </li>
                    )}
                </ul>
            </section>
            <section aria-labelledby={routinesId} className="min-w-0 space-y-2" data-box="routines">
                {/* Its title, and how to act on a routine at the right of it, light; in an icon
                    when the box is too narrow for it, the hint hovered. */}
                <div className="@container flex items-baseline justify-between gap-3">
                    <h2 id={routinesId} className="font-semibold">{t("heartbeats.summary.routines")}</h2>
                    {onToggle && (
                        <>
                            <p className="hidden truncate text-data text-ink-muted @md:block" data-hint="">{t("heartbeats.summary.toggleHint")}</p>
                            <span
                                role="img"
                                aria-label={t("heartbeats.summary.toggleHint")}
                                title={t("heartbeats.summary.toggleHint")}
                                className="self-center text-ink-muted @md:hidden"
                                data-hint-icon=""
                            >
                                <InfoIcon className="h-4 w-4"/>
                            </span>
                        </>
                    )}
                </div>
                {/* As high as its zones, all of them shown: the page scrolls, not the box. */}
                <div className={BOX} data-routines-box="">
                    <RoutineZones routines={routines} nodes={nodes} onToggle={onToggle} busy={busy}/>
                </div>
            </section>
        </>
    );
}
