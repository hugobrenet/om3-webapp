import React, {useCallback, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_CLUSTER} from "../config/apiPath.js";
import {apiFetch, authHeaders, problemOf} from "../services/api.jsx";
import {refusalReason} from "./objectActions";
import {usePagePoll} from "../hooks/usePagePoll";
import useEventStore from "../hooks/useEventStore";
import {CrossLink} from "../app/CrossLink";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Spinner} from "../ui/components/Spinner";
import {RelativeTime} from "../ui/components/RelativeTime";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {RefreshIcon} from "../ui/icons";
import {BADGE} from "./ObjectCells";

/*
 * The tombstones of the cluster (GET /api/cluster/tombstone): the record each node
 * writes of a delete or a purge before its instance goes, the version of the
 * config it deleted, so that a node still holding that version does not bring
 * the object back; with the nodes still publishing it. A node removes its record
 * once every node it may concern was seen deleting its instance, or a day later.
 * The daemon shows a user other than root the ones of the namespaces it is guest of.
 *
 * Read again a few seconds after each read ends, while shown and the page seen
 * (usePagePoll): the nodes still publishing the version deleted are told by no
 * event, but read from the configurations of the instances at each read.
 */

/** How long after a read ends the tombstones are read again, while shown. */
export const TOMBSTONES_EVERY_MS = 10_000;

const URL_TOMBSTONES = `${URL_CLUSTER}/tombstone`;

/** A refusal saying the session may not read them: the tombstones are not shown, no matter what was read before. */
const denied = (err) => err.status === 401 || err.status === 403;

/** The later of two dates as the daemon writes them, either missing. */
const later = (a, b) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);

/**
 * The records of one delete or purge of an object, one per node, as one line: the
 * nodes that wrote it; those still publishing the version deleted, over them all;
 * the latest version and moment told. The most recent first, then by path.
 */
export function groupTombstones(items = []) {
    const groups = new Map();
    for (const item of items) {
        const key = `${item.orchestration_id}\u0000${item.path}`;
        const group = groups.get(key) ?? {
            key,
            path: item.path,
            kind: item.kind,
            orchestrationId: item.orchestration_id,
            objectId: item.object_id,
            nodes: [],
            holders: [],
            version: undefined,
            deletedAt: undefined,
        };
        if (item.node && !group.nodes.includes(item.node)) group.nodes.push(item.node);
        for (const holder of item.holders ?? []) if (!group.holders.includes(holder)) group.holders.push(holder);
        // A purge recorded by one node, a delete by another: the purge says more.
        if (item.kind === "purged") group.kind = "purged";
        group.objectId ??= item.object_id;
        group.version = later(group.version, item.version);
        group.deletedAt = later(group.deletedAt, item.deleted_at);
        groups.set(key, group);
    }
    return [...groups.values()]
        .map((g) => ({...g, nodes: g.nodes.sort(), holders: g.holders.sort()}))
        .sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0) || a.path.localeCompare(b.path));
}

/** Nodes as links to their panels, comma separated; "–" for none. */
function Nodes({nodes}) {
    if (nodes.length === 0) return "–";
    return nodes.map((node, i) => (
        <React.Fragment key={node}>
            {i > 0 && ", "}
            <CrossLink kind="node" id={node}>{node}</CrossLink>
        </React.Fragment>
    ));
}

export function ClusterTombstones() {
    const {t, i18n} = useTranslation();
    const [tombstones, setTombstones] = useState(null);
    // The last read failing: the tombstones read before kept, said not current.
    const [error, setError] = useState("");
    const [reads, setReads] = useState(0);
    const reload = useCallback(() => setReads((n) => n + 1), []);
    // A path deleted and created again since: its panel opens on the object there now.
    const objects = useEventStore((s) => s.objectStatus);

    usePagePoll(async (live) => {
        try {
            const body = await apiFetch(URL_TOMBSTONES, {headers: authHeaders(), cache: "no-cache"});
            if (!live()) return;
            setTombstones(groupTombstones(body?.items));
            setError("");
        } catch (err) {
            if (!live()) return;
            if (denied(err)) {
                setTombstones(null);
                setError(t("clusterTombstones.forbidden"));
            } else {
                setError(refusalReason({status: err.status, detail: problemOf(err)}));
            }
        }
    }, TOMBSTONES_EVERY_MS, [reads, t]);

    const when = (value) => <RelativeTime value={value} locale={i18n.language}/>;
    const stale = tombstones !== null && error !== "";

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
                <p className="min-w-0 flex-1 text-ink-muted">{t("clusterTombstones.intro")}</p>
                <Button size="sm" icon={<RefreshIcon className="h-3.5 w-3.5"/>} onClick={reload}>
                    {t("clusterTombstones.refresh")}
                </Button>
            </div>
            {error && (
                <Alert tone={stale ? "warning" : "error"}>
                    {stale ? t("clusterTombstones.stale", {message: error}) : error}
                </Alert>
            )}
            {tombstones === null ? (
                !error && <div className="flex justify-center py-4"><Spinner label={t("clusterTombstones.loading")}/></div>
            ) : (
                <Table aria-label={t("clusterTombstones.table")}>
                    <thead>
                        <HeaderRow>
                            <HeaderCell>{t("clusterTombstones.object")}</HeaderCell>
                            <HeaderCell>{t("clusterTombstones.kind")}</HeaderCell>
                            <HeaderCell>{t("clusterTombstones.deletedAt")}</HeaderCell>
                            <HeaderCell>{t("clusterTombstones.version")}</HeaderCell>
                            <HeaderCell>{t("clusterTombstones.recordedBy")}</HeaderCell>
                            <HeaderCell>{t("clusterTombstones.holders")}</HeaderCell>
                            <HeaderCell>{t("clusterTombstones.orchestration")}</HeaderCell>
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {tombstones.map((tomb) => (
                            <Row key={tomb.key} data-tombstone={tomb.path}>
                                <Cell className="whitespace-nowrap font-mono font-medium">
                                    {objects?.[tomb.path] !== undefined ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            <CrossLink kind="object" id={tomb.path}>{tomb.path}</CrossLink>
                                            <span className={BADGE}>{t("clusterTombstones.recreated")}</span>
                                        </span>
                                    ) : tomb.path}
                                    {tomb.objectId && <span className="block text-data font-normal text-ink-muted">{tomb.objectId}</span>}
                                </Cell>
                                <Cell>
                                    <span className={tomb.kind === "purged" ? "font-medium text-state-down" : undefined}>
                                        {t(`clusterTombstones.kinds.${tomb.kind}`, {defaultValue: tomb.kind})}
                                    </span>
                                </Cell>
                                <Cell className="whitespace-nowrap">{when(tomb.deletedAt)}</Cell>
                                <Cell className="whitespace-nowrap">{when(tomb.version)}</Cell>
                                <Cell><Nodes nodes={tomb.nodes}/></Cell>
                                <Cell>
                                    {tomb.holders.length === 0
                                        ? <span className="text-ink-muted">{t("clusterTombstones.noHolder")}</span>
                                        : <span className="text-state-warn" data-holders=""><Nodes nodes={tomb.holders}/></span>}
                                </Cell>
                                <Cell className="font-mono text-data text-ink-muted">{tomb.orchestrationId}</Cell>
                            </Row>
                        ))}
                        {tombstones.length === 0 && <EmptyRow colSpan={7}>{t("clusterTombstones.none")}</EmptyRow>}
                    </tbody>
                </Table>
            )}
            <p className="text-ink-muted">{t("clusterTombstones.footer", {seconds: TOMBSTONES_EVERY_MS / 1000})}</p>
        </div>
    );
}
