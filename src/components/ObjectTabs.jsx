import React, {useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_OBJECT} from "../config/apiPath.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {Table, HeaderRow, HeaderCell, Row, Cell} from "../ui/components/Table";
import {RelativeTime} from "../ui/components/RelativeTime";
import {DataTable, FilterField, Loaded, isSet, matches, useApiResource} from "./NodePanel";
import {InstanceLink, ResourceLink} from "./RecordLinks";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager.jsx";

/*
 * Tabs of the object panel, read from the daemon API as om reads them: the daemon
 * answers for all the instances of the object, each item telling its node.
 */

const objectUrl = (path, suffix) => {
    const {namespace, kind, name} = parseObjectPath(path);
    return `${URL_OBJECT}/${[namespace, kind, name].map(encodeURIComponent).join("/")}/${suffix}`;
};

/** A list long enough to need a filter. */
const FILTER_FROM = 10;

/** The tasks the daemon schedules for the object, on each node (`om <path> schedule list`). */
export function ObjectSchedules({path}) {
    const {t, i18n} = useTranslation();
    const schedules = useApiResource(objectUrl(path, "schedule"));
    const [filter, setFilter] = useState("");
    const when = (value) => (isSet(value) ? <RelativeTime value={value} locale={i18n.language}/> : "–");
    const requirements = (s) => [
        s.require,
        s.require_collector ? t("nodePanel.schedules.collector") : "",
        s.require_provisioned ? t("nodePanel.schedules.provisioned") : "",
    ].filter(Boolean).join(", ");

    // Each item is one task on one node: by task, then by node.
    const all = useMemo(
        () => (schedules.data?.items ?? [])
            .map((item) => ({...item.data, node: item.meta?.node ?? ""}))
            .sort((a, b) => String(a.action).localeCompare(String(b.action)) || a.node.localeCompare(b.node)),
        [schedules.data],
    );
    const rows = all.filter((s) => matches(filter, s.action, s.node, s.schedule, s.key));

    return (
        <div className="space-y-2">
            {all.length >= FILTER_FROM && (
                <div className="flex">
                    <FilterField label={t("objectTabs.schedules.filter")} value={filter} onChange={setFilter}/>
                </div>
            )}
            <Loaded resource={schedules}>
                <DataTable
                    label={t("panel.tabs.schedules")}
                    rowKey={(s) => `${s.node}/${s.key}`}
                    rows={rows}
                    empty={t("objectTabs.schedules.none")}
                    columns={[
                        {key: "action", label: t("nodePanel.columns.action"), className: "font-medium"},
                        {key: "node", label: t("common.node"), render: (s) => (s.node ? <InstanceLink path={path} node={s.node}/> : "")},
                        {key: "schedule", label: t("nodePanel.columns.schedule"), className: "font-mono text-data", render: (s) => s.schedule || t("nodePanel.schedules.unscheduled")},
                        {key: "last_run_at", label: t("nodePanel.columns.lastRun"), render: (s) => when(s.last_run_at)},
                        {key: "next_run_at", label: t("nodePanel.columns.nextRun"), render: (s) => when(s.next_run_at)},
                        {key: "require", label: t("nodePanel.columns.requires"), className: "text-ink-muted", render: requirements},
                        {key: "key", label: t("nodePanel.columns.keyword"), className: "font-mono text-data text-ink-muted"},
                    ]}
                />
            </Loaded>
        </div>
    );
}

/**
 * What the resources of an object report on each node (`om <path> resource info
 * list`): one plain table, a line per key, a column per node, for the values of
 * the nodes to be compared at a glance; a line opening each resource, its badge,
 * as the objects table opens each namespace. With `rid`, that resource alone: the
 * info tab of its own panel. With `node`, that node alone: the resources tab of an
 * instance. The filter keeps a resource whole by its name, else the keys and the
 * values that match.
 *
 * The daemon reads these from a cache of each instance, which a change of its
 * configuration does not refresh: a resource deleted stays in it. The resources
 * configured on a node, as its instance configuration says (InstanceConfigUpdated),
 * are the ones shown there; a change of a configuration reads the key-values again.
 */
export function ObjectResources({path, rid: only, node: onNode}) {
    const {t} = useTranslation();
    const info = useApiResource(objectUrl(path, "resource/info"));
    const [filter, setFilter] = useState("");

    // The configurations of the instances, carried by the stream while shown.
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, ["InstanceConfigUpdated"], path) : null;
        return () => release?.();
    }, [path]);
    const configs = useEventStore((s) => s.instanceConfig?.[path]);
    // Their checksums, one string: it changes with a configuration, not with each render.
    const checksums = Object.entries(configs ?? {}).map(([node, c]) => `${node}=${c?.csum ?? ""}`).sort().join(",");
    const seen = useRef(checksums);
    const {reload} = info;
    useEffect(() => {
        // The first configurations known are those of the key-values just read.
        if (seen.current !== "" && seen.current !== checksums) reload();
        seen.current = checksums;
    }, [checksums, reload]);

    const items = useMemo(
        () => (info.data?.items ?? []).filter((item) =>
            (only === undefined || item.rid === only) && (onNode === undefined || item.node === onNode)
            // A node whose configuration is not known yet: all it reports.
            && (configs?.[item.node]?.resources === undefined || item.rid in configs[item.node].resources)),
        [info.data, only, onNode, configs],
    );
    const nodes = useMemo(() => [...new Set(items.map((i) => i.node))].sort(), [items]);
    // rid → key → node → value, the resources and their keys in their order.
    const resources = useMemo(() => {
        const byRid = new Map();
        for (const {rid, key, node, value} of items) {
            if (!byRid.has(rid)) byRid.set(rid, new Map());
            const keys = byRid.get(rid);
            if (!keys.has(key)) keys.set(key, {});
            keys.get(key)[node] = value;
        }
        return [...byRid.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([rid, keys]) => ({rid, keys: [...keys.entries()].sort(([a], [b]) => a.localeCompare(b))}));
    }, [items]);

    // A resource whose name matches shows all its keys; otherwise, the keys that match.
    const shown = resources
        .map(({rid, keys}) => ({
            rid,
            keys: matches(filter, rid) ? keys : keys.filter(([key, values]) => matches(filter, key, ...Object.values(values))),
        }))
        .filter(({keys}) => keys.length > 0);

    return (
        <div className="space-y-3">
            {resources.length > 0 && (
                <div className="flex">
                    <FilterField label={t("objectTabs.resources.filter")} value={filter} onChange={setFilter}/>
                </div>
            )}
            <Loaded resource={info}>
                {resources.length === 0 && (
                    <p className="text-ink-muted">{only === undefined ? t("objectTabs.resources.none") : t("objectTabs.resources.noneOf", {rid: only})}</p>
                )}
                {resources.length > 0 && shown.length === 0 && <p className="text-ink-muted">{t("objectTabs.resources.noMatch")}</p>}
                {shown.length > 0 && (
                    <Table aria-label={t("objectTabs.resources.table")}>
                        <thead>
                        <HeaderRow>
                            <HeaderCell>{t("objectTabs.resources.key")}</HeaderCell>
                            {nodes.map((node) => <HeaderCell key={node}><InstanceLink path={path} node={node}/></HeaderCell>)}
                        </HeaderRow>
                        </thead>
                        <tbody>
                        {shown.map(({rid, keys}) => (
                            <React.Fragment key={rid}>
                                {/* The line opening the keys of a resource, its badge across the row. */}
                                <tr data-resource-row={rid} className="h-[1.875rem] border-b border-line bg-surface-sunken">
                                    <th scope="rowgroup" colSpan={nodes.length + 1} className="px-2 py-1 text-left font-semibold text-ink">
                                        <ResourceLink path={path} rid={rid}/>
                                    </th>
                                </tr>
                                {keys.map(([key, values]) => (
                                    <Row key={key}>
                                        <Cell className="font-medium">{key}</Cell>
                                        {nodes.map((node) => (
                                            <Cell key={node} className="font-mono text-data break-all">
                                                {values[node] ?? <span className="text-ink-muted">–</span>}
                                            </Cell>
                                        ))}
                                    </Row>
                                ))}
                            </React.Fragment>
                        ))}
                        </tbody>
                    </Table>
                )}
            </Loaded>
        </div>
    );
}
