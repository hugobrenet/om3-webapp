import React, {useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_POOL} from "../config/apiPath.js";
import {poolSketchLayout} from "../app/pool-sketch";
import {usePeek} from "../app/panel-search";
import {CrossLink} from "../app/CrossLink";
import {sectionValues} from "../app/heartbeat-config";
import {formatBytes} from "../ui/lib/format";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {TOUCH_QUERY, useMediaQuery} from "../ui/lib/media";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {PoolWizard} from "./PoolWizard";
import {SectionConfig, read, readNodes, useClusterSection} from "./SectionConfig";
import {Sketch} from "./Sketch";
import {UsageRing} from "./UsageRing";
import {anyOf, useClusterConfigChanges, usePoolChanges} from "../hooks/useLiveChanges";

const URL_POOL_VOLUME = `${URL_POOL}/volume`;

/** A size in bytes, readable; nothing, zero. */
const useBytes = () => {
    const {i18n} = useTranslation();
    return (n) => formatBytes(n, i18n.language) || "0";
};

/**
 * The volumes of a pool (GET /api/pool/volume), undefined while read; read again on
 * `changes`, a failure then keeping those read.
 */
function usePoolVolumes(name, changes) {
    const [volumes, setVolumes] = useState(undefined);
    const [error, setError] = useState(null);
    const shown = useRef(false);
    useEffect(() => {
        let live = true;
        const again = changes > 0 && shown.current;
        read(`${URL_POOL_VOLUME}?name=${encodeURIComponent(name)}`).then(
            (data) => live && (shown.current = true, setError(null), setVolumes((data.items ?? []).filter((v) => v.pool === name))),
            (err) => live && !again && (setError(err.message), setVolumes([])),
        );
        return () => {
            live = false;
        };
    }, [name, changes]);
    return {volumes, error};
}

/**
 * The sketch of a pool (`pool-sketch.ts`): what it is in a band over the nodes, what it
 * is on each node, as the node reports it, the volumes it made under the boxes, each
 * opening its object.
 */
function PoolSketch({pool, perNode, section, nodes, volumes}) {
    const {t} = useTranslation();
    const peek = usePeek();
    const bytes = useBytes();
    const touch = useMediaQuery(TOUCH_QUERY);
    const values = useMemo(() => sectionValues(section ?? null), [section]);
    const layout = poolSketchLayout({pool, perNode, values, nodes, volumes, touch}, bytes);
    return (
        <Sketch
            layout={layout}
            title={`${pool.name} · ${pool.type}`}
            caption={t("pools.sketch.label", {name: pool.name, count: nodes.length})}
            computed=""
            texts={{
                count: (count) => t("pools.sketch.volumes", {count}),
                shared: (count) => t("pools.sketch.sharedOn", {count}),
                group: (block) => t("pools.sketch.shared", {count: block.count, unused: block.unplaced}),
                object: (o) => t("pools.sketch.object", {path: o.path, node: o.node, size: o.detail ?? ""}),
                sharedObject: (o) => (o.nodes.length > 0
                    ? t("pools.sketch.sharedObject", {path: o.path, size: o.detail ?? "", nodes: o.nodes.join(", ")})
                    : t("pools.sketch.unusedObject", {path: o.path, size: o.detail ?? ""})),
                more: (count) => t("pools.sketch.more", {count}),
            }}
            onOpen={(path) => peek("object", path)}
        />
    );
}

/**
 * What a pool holds: its usage, as a ring, the share of its space used, how much used
 * and free; and its sketch, the volumes on each node.
 */
export function PoolOverview({name}) {
    const {t} = useTranslation();
    const bytes = useBytes();
    const [pool, setPool] = useState(undefined);
    const [perNode, setPerNode] = useState(null);
    const [nodes, setNodes] = useState(null);
    const [error, setError] = useState(null);
    const changes = anyOf(usePoolChanges(), useClusterConfigChanges());
    const {volumes} = usePoolVolumes(name, changes);
    const {section} = useClusterSection("pool", name);
    const shown = useRef(false);

    useEffect(() => {
        let live = true;
        // Read again: a failure keeps what was read, said only when nothing was.
        const again = changes > 0 && shown.current;
        const query = `name=${encodeURIComponent(name)}`;
        read(`${URL_POOL}?${query}`).then(
            (data) => live && (shown.current = true, setError(null), setPool((data.items ?? []).find((p) => p.name === name) ?? null)),
            (err) => live && !again && (setError(err.message), setPool(null)),
        );
        // The pool as each node reports it: its head and its use there.
        read(`${URL_POOL}?${query}&node=*`).then(
            (data) => live && setPerNode(Object.fromEntries((data.items ?? []).filter((p) => p.name === name && p.node).map((p) => [p.node, p]))),
            () => live && setPerNode((p) => (again && p !== null ? p : {})),
        );
        readNodes().then((list) => live && setNodes(list), () => live && setNodes((n) => (again && n !== null ? n : [])));
        return () => {
            live = false;
        };
    }, [name, changes]);

    if (pool === undefined) return <Spinner label={t("pools.panel.loading")}/>;
    if (pool === null) return <Alert tone="error">{error ? t("pools.panel.readFailed", {message: error}) : t("pools.panel.none", {name})}</Alert>;

    const used = pool.used ?? 0;
    return (
        <div className="space-y-5">
            {/* Its type and head in the band of the sketch. */}
            <section aria-labelledby={`pool-usage-${name}`} className="space-y-2">
                <h3 id={`pool-usage-${name}`} className="font-semibold">{t("pools.panel.usage")}</h3>
                <UsageRing
                    used={used}
                    size={pool.size}
                    label={t("pools.usageOf", {name})}
                    usedText={t("pools.panel.used", {value: bytes(used)})}
                    freeText={t("pools.panel.free", {value: bytes(pool.free ?? 0)})}
                />
            </section>

            {volumes !== undefined && perNode !== null && nodes !== null && section !== undefined && (
                <section aria-labelledby={`pool-sketch-${name}`} className="space-y-2">
                    <h3 id={`pool-sketch-${name}`} className="font-semibold">{t("pools.sketch.title")}</h3>
                    <PoolSketch pool={pool} perNode={perNode} section={section} nodes={nodes} volumes={volumes}/>
                </section>
            )}
        </div>
    );
}

/**
 * The volumes a pool made: each its object, its size, the instances of the services
 * using it, each opening its panel; one its service gone, an orphan, said so.
 */
export function PoolVolumes({name}) {
    const {t} = useTranslation();
    const bytes = useBytes();
    const {volumes, error} = usePoolVolumes(name, usePoolChanges());
    if (volumes === undefined) return <Spinner label={t("pools.panel.loading")}/>;
    const rows = [...volumes].sort((a, b) => a.path.localeCompare(b.path));
    return (
        <div className="space-y-3">
            {error && <Alert tone="error">{t("pools.panel.readFailed", {message: error})}</Alert>}
            <Table sticky>
                <caption className="sr-only">{t("pools.volumes.caption", {name})}</caption>
                <thead>
                    <HeaderRow>
                        <HeaderCell>{t("pools.volumes.volume")}</HeaderCell>
                        <HeaderCell className="text-right">{t("pools.volumes.size")}</HeaderCell>
                        <HeaderCell>{t("pools.volumes.usedBy")}</HeaderCell>
                    </HeaderRow>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <EmptyRow colSpan={3}>{t("pools.volumes.empty")}</EmptyRow>
                    ) : rows.map((v) => (
                        <Row key={v.path} data-volume={v.path}>
                            <Cell className="font-medium"><CrossLink kind="object" id={v.path}>{v.path}</CrossLink></Cell>
                            <Cell numeric>{v.size ? bytes(v.size) : "–"}</Cell>
                            <Cell>
                                <span className="flex flex-wrap items-center gap-1">
                                    {(v.children ?? []).map((child) => (
                                        <CrossLink key={child} kind={child.includes("@") ? "instance" : "object"} id={child}>{child}</CrossLink>
                                    ))}
                                    {v.is_orphan && <span className="text-state-warn">{t("pools.volumes.orphan")}</span>}
                                    {!v.is_orphan && (v.children ?? []).length === 0 && <span className="text-ink-muted">{t("pools.volumes.unused")}</span>}
                                </span>
                            </Cell>
                        </Row>
                    ))}
                </tbody>
            </Table>
        </div>
    );
}

/** The volumes a pool still holds, said before it is deleted. */
const volumesInUse = async (name) => (await read(`${URL_POOL}?name=${encodeURIComponent(name)}`)).items?.find((p) => p.name === name)?.volume_count ?? 0;

/**
 * The section of a pool in the cluster configuration (`SectionConfig`): root edits it,
 * modifies it in the pool wizard, deletes it (`onDeleted`, then).
 */
export function PoolConfig({name, onDeleted}) {
    return (
        <SectionConfig
            section="pool"
            name={name}
            prefix="pools.panel"
            listUrl={URL_POOL}
            inUse={volumesInUse}
            onDeleted={onDeleted}
            renderWizard={({items, ...props}) => <PoolWizard pools={items} {...props}/>}
        />
    );
}
