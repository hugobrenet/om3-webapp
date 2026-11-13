import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_STORE, URL_STORE_OBJECT, URL_STORE_SNAPSHOT} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {trackDone, trackRefused} from "../app/action-tracker";
import {CrossLink} from "../app/CrossLink";
import {storeSource} from "../app/store-config";
import {formatBytes} from "../ui/lib/format";
import {refusalReason} from "./objectActions";
import {FilterField, matches} from "./NodePanel";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Checkbox, Input, Select} from "../ui/components/Field";
import {ALL, PRESETS, presetOf, presetPeriod} from "../app/snapshot-timeline";
import {CopyButton} from "../ui/components/CopyButton";
import {Dialog} from "../ui/components/Dialog";
import {Spinner} from "../ui/components/Spinner";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {LockIcon, TrashIcon} from "../ui/icons";
import {SectionConfig, read, useClusterSection} from "./SectionConfig";
import {sectionValues} from "../app/heartbeat-config";
import {AgeTime, formatAge} from "./AgeTime";
import {StoreWizard} from "./StoreWizard";

const headers = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

/** The snapshots read a page at a time, the latest first. */
export const SNAPSHOT_PAGE = 100;

/** A size in bytes, readable; nothing for none. */
export const useBytes = () => {
    const {i18n} = useTranslation();
    return (n) => formatBytes(n, i18n.language) || "0";
};

/**
 * A store as the store list gives it, by its reference, its figures in `stats` (and
 * `node_stats`, a store of each node's own); null, none of it, undefined while read.
 */
export function useStore(ref) {
    const [store, setStore] = useState(undefined);
    const [error, setError] = useState(null);
    useEffect(() => {
        let live = true;
        read(URL_STORE).then(
            (data) => live && setStore((data.items ?? []).find((s) => s.ref === ref) ?? null),
            (err) => live && (setError(err.message), setStore(null)),
        );
        return () => {
            live = false;
        };
    }, [ref]);
    return {store, error};
}

/** The objects a store holds snapshots of, summed up by the daemon, the latest first; undefined while read. */
export function useStoreObjects(ref) {
    const [state, setState] = useState({objects: undefined, error: null});
    useEffect(() => {
        if (!ref) {
            setState({objects: [], error: null});
            return undefined;
        }
        let live = true;
        read(`${URL_STORE_OBJECT}?store=${encodeURIComponent(ref)}`).then(
            (data) => live && setState({objects: data.items ?? [], error: null}),
            (err) => live && setState({objects: [], error: err.message}),
        );
        return () => {
            live = false;
        };
    }, [ref]);
    return state;
}

/**
 * The query of the snapshot list of a period of an object, by its id in a store or by
 * its path across them: its bounds as instants, the daemon filtering.
 */
const snapshotQuery = ({objectId, path, since, until} = {}) => [
    objectId ? `&object_id=${encodeURIComponent(objectId)}` : "",
    path ? `&path=${encodeURIComponent(path)}` : "",
    since !== null && since !== undefined ? `&since=${encodeURIComponent(new Date(since).toISOString())}` : "",
    until !== null && until !== undefined ? `&until=${encodeURIComponent(new Date(until).toISOString())}` : "",
].join("");

/**
 * The snapshots of a store, the latest first, a page at a time: a store holds
 * thousands. Of an object (`objectId`), of a period (`since`, `until`, ms), as the
 * daemon filters them. `more`, the next page, older, while the last answer said there
 * is one (`next`); `drop(id)`, one deleted out of those read. The rows read are kept
 * while others come: the controls stay where they are.
 */
export function useSnapshotPages(ref, filters = {}) {
    const [state, setState] = useState({items: undefined, next: null, error: null, loading: true});
    const query = snapshotQuery(filters);
    const load = useCallback(async (before) => {
        setState((s) => ({...s, loading: true}));
        // A store's, or, none given, every store's.
        const url = `${URL_STORE_SNAPSHOT}?${ref ? `store=${encodeURIComponent(ref)}&` : ""}limit=${SNAPSHOT_PAGE}${query}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
        try {
            const data = await read(url);
            setState((s) => ({
                items: [...(before ? s.items ?? [] : []), ...(data.items ?? [])],
                next: data.next || null,
                error: null,
                loading: false,
            }));
        } catch (err) {
            setState((s) => ({...s, items: s.items ?? [], error: err.message, loading: false}));
        }
    }, [ref, query]);
    useEffect(() => {
        void load(null);
    }, [load]);
    const more = useCallback(() => state.next && load(state.next), [state.next, load]);
    const drop = useCallback((id) => setState((s) => ({...s, items: (s.items ?? []).filter((x) => x.id !== id)})), []);
    return {...state, more, drop};
}

/**
 * The restore point around a date, asked of the daemon: the last snapshot taken before
 * it and the first after, of an object or of the store.
 */
async function aroundDate(ref, filters, date) {
    const base = `${URL_STORE_SNAPSHOT}?${ref ? `store=${encodeURIComponent(ref)}&` : ""}limit=1${snapshotQuery(filters)}`;
    const at = encodeURIComponent(new Date(date).toISOString());
    const [before, after] = await Promise.all([read(`${base}&until=${at}`), read(`${base}&since=${at}&order=asc`)]);
    return {before: before.items?.[0] ?? null, after: after.items?.[0] ?? null};
}

/** The namespaces a store serves: every one, or those it names. */
function shareText(t, share) {
    if (!share?.length) return t("stores.none");
    return share.includes("*") ? t("stores.everyNamespace") : share.join(", ");
}

/** Where a store is declared: the cluster configuration, or a sec, opening it. */
export function StoreSourceText({source}) {
    const {t} = useTranslation();
    if (source.kind === "cluster") return t("stores.source.cluster");
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {t("stores.source.sec")}
            <CrossLink kind="object" id={source.sec} tab="config">{source.sec}</CrossLink>
        </span>
    );
}

/** A figure of the overview: its number, its name under it. */
const Figure = ({name, label, children}) => (
    <div data-figure={name} className="min-w-0 rounded-(--radius-control) bg-surface-sunken px-3 py-2">
        <div className="truncate text-xl font-semibold tabular-nums">{children}</div>
        <div className="truncate text-data text-ink-muted">{label}</div>
    </div>
);

/** An age said within a sentence, `key` its words around `{{age}}`. */
function AgeSentence({value, k}) {
    const {t, i18n} = useTranslation();
    return <span>{t(k, {age: formatAge(value, i18n.language)})}</span>;
}

/**
 * A store unreached at its last attempt, said with when and why; its figures, those of
 * its last reach, kept.
 */
export function StoreCheck({stats}) {
    const {t} = useTranslation();
    if (!stats?.check_error) return null;
    return (
        <Alert tone="warning">
            {t("stores.check.failed", {message: stats.check_error})}
            {stats.checked_at && <> · <AgeSentence value={stats.checked_at} k="stores.check.reachedAgo"/></>}
        </Alert>
    );
}

/** A table of figures by node or by cluster: snapshots, objects, the latest, saved or free. */
function StatsTable({label, head, rows, bytesColumn}) {
    const {t} = useTranslation();
    const bytes = useBytes();
    return (
        <Table>
            <caption className="sr-only">{label}</caption>
            <thead>
                <HeaderRow>
                    <HeaderCell>{head}</HeaderCell>
                    <HeaderCell className="text-right">{t("stores.columns.snapshots")}</HeaderCell>
                    <HeaderCell className="text-right">{t("stores.columns.objects")}</HeaderCell>
                    <HeaderCell>{t("stores.columns.latest")}</HeaderCell>
                    <HeaderCell className="text-right">{t(`stores.columns.${bytesColumn}`)}</HeaderCell>
                </HeaderRow>
            </thead>
            <tbody>
                {rows.map(([key, s]) => (
                    <Row key={key} data-row={key}>
                        <Cell className="font-medium">{key}</Cell>
                        <Cell numeric>{s.runs}</Cell>
                        <Cell numeric>{s.objects}</Cell>
                        <Cell className="whitespace-nowrap"><AgeTime value={s.last_created_at}/></Cell>
                        <Cell numeric>
                            {bytesColumn === "free"
                                ? (s.free_bytes !== undefined ? bytes(s.free_bytes) : "–")
                                : (s.logical_bytes > 0 ? bytes(s.logical_bytes) : "–")}
                        </Cell>
                    </Row>
                ))}
            </tbody>
        </Table>
    );
}

/**
 * What a store is and holds, as the daemon sums it up (`stats`), never reading its
 * snapshots: where it is and whom it serves; how many snapshots, of how many objects,
 * the latest, the space they take and that left; on each node for a store of each
 * node's own, by cluster for one several clusters write; and each object, its
 * snapshots, its latest, the nodes taking them.
 */
export function StoreOverview({name}) {
    const {t} = useTranslation();
    const bytes = useBytes();
    // The ids of its headings its own: a reference may hold spaces, which an id may not.
    const id = useId();
    const {store, error} = useStore(name);
    const {objects, error: objectsError} = useStoreObjects(name);
    const source = storeSource(name);
    // Of a store of the cluster configuration, what it keeps and when it pushes, as set.
    const {section} = useClusterSection("store", source.name);
    const kept = useMemo(() => {
        if (source.kind !== "cluster" || !section) return {};
        // Read as om3 reads them, a value continued on its lines whole.
        const {keep, schedule} = sectionValues(section);
        return Object.fromEntries(Object.entries({keep, schedule}).filter(([, value]) => value !== undefined));
    }, [source.kind, section]);

    if (store === undefined) return <Spinner label={t("stores.panel.loading")}/>;
    if (store === null) return <Alert tone="error">{error ? t("stores.panel.readFailed", {message: error}) : t("stores.panel.none", {name})}</Alert>;

    const facts = [
        ["type", store.type],
        ["url", <span key="url" className="font-mono break-all">{store.url}</span>],
        ["share", shareText(t, store.share)],
        ["source", <StoreSourceText key="source" source={source}/>],
        ...(kept.keep ? [["keep", <span key="keep" className="font-mono whitespace-pre-line">{kept.keep}</span>]] : []),
        ...(kept.schedule ? [["schedule", <span key="schedule" className="font-mono whitespace-pre-line">{kept.schedule}</span>]] : []),
    ];
    const stats = store.stats;
    const nodes = Object.entries(store.node_stats ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const clusters = (stats?.clusters ?? []).map((c) => [c.cluster_name || c.cluster_id, c]);

    return (
        <div className="space-y-5">
            <section aria-labelledby={`${id}-facts`} className="space-y-2">
                <h3 id={`${id}-facts`} className="font-semibold">{t("stores.panel.store")}</h3>
                <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1 max-md:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] max-md:gap-x-3">
                    {facts.map(([key, value]) => (
                        <React.Fragment key={key}>
                            <dt className="text-ink-muted">{t(`stores.facts.${key}`)}</dt>
                            <dd className="min-w-0 break-words">{value}</dd>
                        </React.Fragment>
                    ))}
                </dl>
            </section>

            <section aria-labelledby={`${id}-snapshots`} className="space-y-2">
                <h3 id={`${id}-snapshots`} className="font-semibold">{t("stores.panel.snapshots")}</h3>
                <StoreCheck stats={stats}/>
                {!stats ? <p className="text-ink-muted">{t("stores.panel.noStats")}</p> : (
                    <>
                        {/* As many columns as figures while they fit: no figure left alone on a row of its own. */}
                        <div data-figures="" className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
                            <Figure name="runs" label={t("stores.figures.snapshots", {count: stats.runs})}>{stats.runs}</Figure>
                            <Figure name="objects" label={t("stores.figures.objects", {count: stats.objects})}>{stats.objects}</Figure>
                            <Figure name="protected" label={t("stores.figures.protected", {count: stats.protected})}>{stats.protected}</Figure>
                            {stats.incomplete > 0 && (
                                <Figure name="incomplete" label={t("stores.figures.incomplete", {count: stats.incomplete})}>
                                    <span className="text-state-warn">{stats.incomplete}</span>
                                </Figure>
                            )}
                            <Figure name="latest" label={t("stores.figures.latest")}>
                                <AgeTime value={stats.last_created_at}/>
                            </Figure>
                            {stats.logical_bytes > 0 && <Figure name="saved" label={t("stores.figures.saved")}>{bytes(stats.logical_bytes)}</Figure>}
                            {stats.stored_bytes !== undefined && <Figure name="stored" label={t("stores.figures.stored")}>{bytes(stats.stored_bytes)}</Figure>}
                            {stats.free_bytes !== undefined && <Figure name="free" label={t("stores.figures.free")}>{bytes(stats.free_bytes)}</Figure>}
                        </div>
                        <p className="text-data text-ink-muted">
                            <AgeSentence value={stats.updated_at} k="stores.panel.figuresComputed"/>
                        </p>
                    </>
                )}
            </section>

            {/* A store of each node's own: its figures on each node, the space each has left. */}
            {nodes.length > 0 && (
                <section aria-labelledby={`${id}-nodes`} className="space-y-2">
                    <h3 id={`${id}-nodes`} className="font-semibold">{t("stores.panel.byNode")}</h3>
                    <StatsTable label={t("stores.panel.byNode")} head={t("common.node")} rows={nodes} bytesColumn="free"/>
                </section>
            )}
            {/* A store several clusters write: each one's share. */}
            {clusters.length > 1 && (
                <section aria-labelledby={`${id}-clusters`} className="space-y-2">
                    <h3 id={`${id}-clusters`} className="font-semibold">{t("stores.panel.byCluster")}</h3>
                    <StatsTable label={t("stores.panel.byCluster")} head={t("stores.panel.cluster")} rows={clusters} bytesColumn="saved"/>
                </section>
            )}

            <section aria-labelledby={`${id}-objects`} className="space-y-2">
                <h3 id={`${id}-objects`} className="font-semibold">
                    {t("stores.panel.byObject")}
                    {objects && <span className="ml-1.5 font-normal text-ink-muted tabular-nums">{objects.length}</span>}
                </h3>
                {objectsError && <Alert tone="error">{t("stores.panel.objectsFailed", {message: objectsError})}</Alert>}
                {objects === undefined ? <Spinner/> : objects.length === 0 ? (
                    <p className="text-ink-muted">{t("stores.panel.noSnapshot")}</p>
                ) : (
                    <Table>
                        <caption className="sr-only">{t("stores.panel.byObject")}</caption>
                        <thead>
                            <HeaderRow>
                                <HeaderCell>{t("stores.snapshots.object")}</HeaderCell>
                                {clusters.length > 1 && <HeaderCell>{t("stores.panel.cluster")}</HeaderCell>}
                                <HeaderCell className="text-right">{t("stores.columns.snapshots")}</HeaderCell>
                                <HeaderCell>{t("stores.columns.latest")}</HeaderCell>
                                <HeaderCell>{t("stores.columns.nodes")}</HeaderCell>
                                <HeaderCell className="text-right">{t("stores.columns.saved")}</HeaderCell>
                                <HeaderCell className="text-right">{t("stores.columns.protected")}</HeaderCell>
                                <HeaderCell className="text-right">{t("stores.columns.incomplete")}</HeaderCell>
                            </HeaderRow>
                        </thead>
                        <tbody>
                            {objects.map((o) => (
                                <Row key={`${o.cluster_id}/${o.object_id}`} data-object={o.path}>
                                    <Cell className="font-medium whitespace-nowrap"><CrossLink kind="object" id={o.path}>{o.path}</CrossLink></Cell>
                                    {clusters.length > 1 && <Cell>{o.cluster_name}</Cell>}
                                    <Cell numeric>{o.runs}</Cell>
                                    <Cell className="whitespace-nowrap"><AgeTime value={o.last_created_at}/></Cell>
                                    <Cell>{(o.nodes ?? []).join(", ") || "–"}</Cell>
                                    <Cell numeric className="whitespace-nowrap">{o.logical_bytes > 0 ? bytes(o.logical_bytes) : "–"}</Cell>
                                    <Cell numeric>{o.protected || "–"}</Cell>
                                    <Cell numeric>{o.incomplete > 0 ? <span className="text-state-warn">{o.incomplete}</span> : "–"}</Cell>
                                </Row>
                            ))}
                        </tbody>
                    </Table>
                )}
            </section>
        </div>
    );
}

/** How long a run took, from its start to its last member saved; nothing known, nothing. */
function duration(s) {
    if (!s.completed_at) return null;
    const ms = Date.parse(s.completed_at) - Date.parse(s.created_at);
    if (!(ms > 0)) return null;
    if (ms < 1000) return `${ms} ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The short id of a snapshot, as the listings show it: its first eight characters. */
export const shortId = (id) => String(id).slice(0, 8);

/** The box selecting every snapshot shown: checked, all; mixed, some. */
function SelectAll({count, total, onChange, label}) {
    const box = useRef(null);
    const all = total > 0 && count === total;
    const some = count > 0 && !all;
    useEffect(() => {
        if (box.current) box.current.indeterminate = some;
    }, [some]);
    return <Checkbox ref={box} aria-label={label} checked={all} disabled={total === 0} onChange={(e) => onChange(e.target.checked)}/>;
}

/**
 * The snapshots a store holds, the latest first, a page at a time: each its id, its
 * object, when it was taken and how long it took, its size, where it was taken, what
 * it holds, protected or not, its note. Selected by their boxes, those shown at once
 * from the head of the table; the selection deleted from the store, confirmed first,
 * one by one as the api deletes them, the daemon judging who may. The filter applies
 * to those read; the selection stays across it.
 */
export function StoreSnapshots({name, path: objectPath}) {
    const {t, i18n} = useTranslation();
    const bytes = useBytes();
    // Of an object (`path`), across the stores, no store given: each row its store.
    const ofObject = Boolean(objectPath) && !name;
    // The object whose snapshots are shown, by its id; none, the whole store. The period, from
    // the presets or around a date: the daemon filters the snapshots by them.
    const {objects} = useStoreObjects(name);
    const [objectId, setObjectId] = useState("");
    const [period, setPeriod] = useState(ALL);
    const [date, setDate] = useState("");
    const [point, setPoint] = useState(null);
    const [now] = useState(() => Date.now());
    const {items: snapshots, next, error, loading, more, drop} = useSnapshotPages(name, {objectId, path: objectPath, since: period.since, until: period.until});
    // The newest snapshot of an object, read with no period: the one its latest preset starts from.
    const newest = useRef(null);
    if (ofObject && period === ALL && snapshots?.length) newest.current = Math.max(...snapshots.map((s) => Date.parse(s.created_at)));
    const [filter, setFilter] = useState("");
    const [selected, setSelected] = useState(() => new Set());
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failures, setFailures] = useState([]);

    const chosen = (snapshots ?? []).filter((s) => selected.has(s.id));
    const toggle = (id, on) => setSelected((current) => {
        const nextSet = new Set(current);
        if (on) nextSet.add(id);
        else nextSet.delete(id);
        return nextSet;
    });

    const remove = async () => {
        const targets = chosen;
        setBusy(true);
        setFailures([]);
        const failed = [];
        for (const s of targets) {
            try {
                // From the store holding it: the one of the panel, or its own across them.
                const query = `store=${encodeURIComponent(s.store ?? name)}&id=${encodeURIComponent(s.id)}`;
                const response = await fetch(`${URL_STORE_SNAPSHOT}?${query}`, {method: "DELETE", headers: headers()});
                if (response.ok) {
                    drop(s.id);
                    toggle(s.id, false);
                } else {
                    const detail = await getResponseErrorMessage(response);
                    failed.push({snapshot: s, reason: refusalReason({status: response.status, detail}) || detail || `HTTP ${response.status}`});
                }
            } catch (err) {
                failed.push({snapshot: s, reason: err.message});
            }
        }
        // One entry in the tray for the whole selection: its deletions done, or those refused said.
        const write = {action: "delete", label: t("stores.snapshots.trayMany", {count: targets.length}), subject: name ?? objectPath};
        if (failed.length === 0) {
            trackDone(write);
            setConfirming(false);
        } else {
            trackRefused({...write, reason: failed.map((f) => `${shortId(f.snapshot.id)}: ${f.reason}`).join("; ")});
            setFailures(failed);
        }
        setBusy(false);
    };

    if (snapshots === undefined) return <Spinner label={t("stores.panel.loading")}/>;
    // The latest snapshot, the one the latest preset starts from: of the object, or the newest of them all.
    const times = ofObject
        ? (newest.current !== null ? [newest.current] : [])
        : (objects ?? [])
            .filter((o) => (!objectId || o.object_id === objectId) && o.last_created_at)
            .map((o) => Date.parse(o.last_created_at));
    const preset = presetOf(period, now, times);
    const rows = snapshots.filter((s) => matches(filter, s.path, s.node, s.note, s.id));
    /** Around a date: the period from the last snapshot before it to the first after it, both shown. */
    const chooseDate = async (value) => {
        setDate(value);
        setPoint(null);
        if (!value) {
            setPeriod(ALL);
            return;
        }
        try {
            const found = await aroundDate(name, {objectId, path: objectPath}, Date.parse(value));
            setPoint(found);
            setPeriod({
                since: found.before ? Date.parse(found.before.created_at) : null,
                until: found.after ? Date.parse(found.after.created_at) + 1 : null,
            });
        } catch {
            setPoint({before: null, after: null});
        }
    };
    const choosePeriod = (p) => {
        setDate("");
        setPoint(null);
        setPeriod(p);
    };
    const shownSelected = rows.filter((s) => selected.has(s.id)).length;
    const protectedChosen = chosen.filter((s) => s.protected).length;
    return (
        <div className="space-y-3">
            {error && <Alert tone="error">{t("stores.panel.snapshotsFailed", {message: error})}</Alert>}
            {/* When: an object's or the store's; a period from the presets, or around a date. */}
            <section aria-label={t("stores.timeline.when")} className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                    {/* An object's, its own: no object to pick. */}
                    {!ofObject && (
                        <label className="flex items-center gap-1.5 text-ink-muted">
                            {t("stores.timeline.object")}
                            <Select className="h-7 max-w-64" value={objectId} onChange={(e) => {
                                setObjectId(e.target.value);
                                choosePeriod(ALL);
                            }}>
                                <option value="">{t("stores.timeline.allObjects")}</option>
                                {(objects ?? []).map((o) => (
                                    <option key={`${o.cluster_id}/${o.object_id}`} value={o.object_id}>{`${o.path} (${o.runs})`}</option>
                                ))}
                            </Select>
                        </label>
                    )}
                    <span role="group" aria-label={t("stores.timeline.presets")} className="flex flex-wrap gap-1">
                        {PRESETS.map((p) => (
                            <button
                                key={p}
                                type="button"
                                aria-pressed={preset === p}
                                onClick={() => choosePeriod(presetPeriod(p, now, times))}
                                className={`rounded-full border px-2 text-data ${preset === p ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-muted hover:border-line-strong"}`}
                            >
                                {t(`stores.timeline.preset.${p}`)}
                            </button>
                        ))}
                    </span>
                    <label className="flex items-center gap-1.5 text-ink-muted">
                        {t("stores.timeline.around")}
                        <Input type="datetime-local" className="h-7 w-auto" value={date} onChange={(e) => void chooseDate(e.target.value)}/>
                    </label>
                    {preset === null && period !== ALL && (
                        <Button size="sm" variant="secondary" onClick={() => choosePeriod(ALL)}>{t("stores.timeline.clear")}</Button>
                    )}
                </div>
                {point && (
                    <p data-around="" className="text-data text-ink-muted">
                        {point.before
                            ? t("stores.timeline.before", {id: shortId(point.before.id), date: new Date(point.before.created_at).toLocaleString(i18n.language)})
                            : t("stores.timeline.noneBefore")}
                        {" · "}
                        {point.after
                            ? t("stores.timeline.after", {id: shortId(point.after.id), date: new Date(point.after.created_at).toLocaleString(i18n.language)})
                            : t("stores.timeline.noneAfter")}
                    </p>
                )}
            </section>
            <div className="flex flex-wrap items-center gap-3">
                <FilterField label={t("stores.snapshots.filter")} value={filter} onChange={setFilter}/>
                <span className="text-data text-ink-muted">
                    {next ? t("stores.snapshots.readSome", {count: snapshots.length}) : t("stores.snapshots.readAll", {count: snapshots.length})}
                </span>
                {/* What acts on the selection, out of the table. */}
                <span role="toolbar" aria-label={t("stores.snapshots.selection")} className="ml-auto flex items-center gap-2">
                    {chosen.length > 0 && (
                        <>
                            <span className="text-data text-ink-muted">{t("stores.snapshots.selected", {count: chosen.length})}</span>
                            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>{t("stores.snapshots.clear")}</Button>
                        </>
                    )}
                    <Button size="sm" variant="delete" icon={<TrashIcon className="h-3.5 w-3.5"/>} disabled={chosen.length === 0}
                            onClick={() => {
                                setFailures([]);
                                setConfirming(true);
                            }}>
                        {t("stores.snapshots.deleteSelected", {count: chosen.length})}
                    </Button>
                </span>
            </div>
            <Table sticky>
                <caption className="sr-only">{ofObject ? t("stores.snapshots.captionOf", {path: objectPath}) : t("stores.snapshots.caption", {name})}</caption>
                <thead>
                    <HeaderRow>
                        <HeaderCell className="w-8">
                            <SelectAll
                                count={shownSelected}
                                total={rows.length}
                                label={t("stores.snapshots.selectAll")}
                                onChange={(on) => setSelected((current) => {
                                    const nextSet = new Set(current);
                                    rows.forEach((s) => (on ? nextSet.add(s.id) : nextSet.delete(s.id)));
                                    return nextSet;
                                })}
                            />
                        </HeaderCell>
                        <HeaderCell>{t("stores.snapshots.id")}</HeaderCell>
                        {ofObject
                            ? <HeaderCell>{t("stores.snapshots.store")}</HeaderCell>
                            : <HeaderCell>{t("stores.snapshots.object")}</HeaderCell>}
                        <HeaderCell>{t("stores.snapshots.taken")}</HeaderCell>
                        <HeaderCell className="text-right">{t("stores.snapshots.took")}</HeaderCell>
                        <HeaderCell className="text-right">{t("stores.snapshots.size")}</HeaderCell>
                        <HeaderCell>{t("common.node")}</HeaderCell>
                        <HeaderCell>{t("stores.snapshots.holds")}</HeaderCell>
                        <HeaderCell>{t("stores.snapshots.note")}</HeaderCell>
                    </HeaderRow>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <EmptyRow colSpan={9}>{t("stores.panel.noSnapshot")}</EmptyRow>
                    ) : rows.map((s) => (
                        <Row key={s.id} data-snapshot={s.id} selected={selected.has(s.id)}>
                            <Cell className="w-8">
                                <Checkbox
                                    aria-label={t("stores.snapshots.select", {id: shortId(s.id), path: s.path})}
                                    checked={selected.has(s.id)}
                                    onChange={(e) => toggle(s.id, e.target.checked)}
                                />
                            </Cell>
                            <Cell className="whitespace-nowrap">
                                <span className="inline-flex items-center gap-1">
                                    <span className="font-mono text-data">{shortId(s.id)}</span>
                                    <CopyButton text={s.id} label={t("stores.snapshots.copyId", {id: s.id})}/>
                                </span>
                            </Cell>
                            {ofObject
                                ? <Cell className="font-medium whitespace-nowrap"><CrossLink kind="store" id={s.store}>{storeSource(s.store ?? "").name}</CrossLink></Cell>
                                : <Cell className="font-medium whitespace-nowrap"><CrossLink kind="object" id={s.path}>{s.path}</CrossLink></Cell>}
                            <Cell className="whitespace-nowrap">
                                <span className="inline-flex items-center gap-1">
                                    <AgeTime value={s.created_at}/>
                                    {s.protected && (
                                        <span role="img" aria-label={t("stores.snapshots.protected")} className="text-ink-muted">
                                            <LockIcon className="h-3.5 w-3.5" aria-hidden="true"/>
                                            <span className="sr-only">{t("stores.snapshots.protected")}</span>
                                        </span>
                                    )}
                                </span>
                            </Cell>
                            <Cell numeric className="whitespace-nowrap">{duration(s) ?? "–"}</Cell>
                            <Cell numeric className="whitespace-nowrap">{s.logical_bytes > 0 ? bytes(s.logical_bytes) : "–"}</Cell>
                            <Cell>{s.cluster_name && s.node ? t("stores.snapshots.on", {node: s.node, cluster: s.cluster_name}) : s.node || "–"}</Cell>
                            <Cell className="font-mono text-data text-ink-muted">{(s.members ?? []).join(" ")}</Cell>
                            <Cell className="text-ink-muted">{s.note || ""}</Cell>
                        </Row>
                    ))}
                </tbody>
            </Table>
            {next && (
                <div className="flex justify-center">
                    <Button size="sm" onClick={more} disabled={loading}>
                        {loading ? t("stores.snapshots.reading") : t("stores.snapshots.older", {count: SNAPSHOT_PAGE})}
                    </Button>
                </div>
            )}
            <Dialog
                open={confirming}
                size="sm"
                title={t("stores.snapshots.confirmManyTitle", {count: chosen.length})}
                onClose={() => !busy && setConfirming(false)}
                footer={(
                    <>
                        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>{t("common.cancel")}</Button>
                        <Button variant="delete" onClick={remove} disabled={busy || chosen.length === 0}>
                            {busy ? t("stores.snapshots.deleting") : t("stores.snapshots.deleteSelected", {count: chosen.length})}
                        </Button>
                    </>
                )}
            >
                <div className="space-y-3">
                    <p>{t("stores.snapshots.confirmMany", {count: chosen.length})}</p>
                    <ul className="max-h-40 overflow-auto font-mono text-data text-ink-muted">
                        {chosen.map((s) => (
                            <li key={s.id}>{`${shortId(s.id)} ${s.path} · ${new Date(s.created_at).toLocaleString(i18n.language)}`}</li>
                        ))}
                    </ul>
                    {protectedChosen > 0 && <Alert tone="warning">{t("stores.snapshots.protectedMany", {count: protectedChosen})}</Alert>}
                    {failures.length > 0 && (
                        <Alert tone="error">
                            {t("stores.snapshots.failedMany", {count: failures.length})}
                            <ul className="mt-1 font-mono text-data">
                                {failures.map((f) => <li key={f.snapshot.id}>{`${shortId(f.snapshot.id)}: ${f.reason}`}</li>)}
                            </ul>
                        </Alert>
                    )}
                </div>
            </Dialog>
        </div>
    );
}

/** The snapshots a store still holds, as its figures say, said before it is deleted. */
const snapshotsInUse = async (ref) => ((await read(URL_STORE)).items ?? []).find((s) => s.ref === ref)?.stats?.runs ?? 0;

/**
 * The configuration of a store: one of the cluster configuration its section
 * (`SectionConfig`), root editing it, modifying it in the store wizard, deleting it;
 * one of a sec said so, opening the sec, where it is configured.
 */
export function StoreConfig({name, onDeleted}) {
    const {t} = useTranslation();
    const source = storeSource(name);
    if (source.kind === "sec") {
        return (
            <p className="text-ink-muted">
                {t("stores.panel.ofSec", {name: source.name})}{" "}
                <CrossLink kind="object" id={source.sec} tab="config">{source.sec}</CrossLink>
            </p>
        );
    }
    return (
        <SectionConfig
            section="store"
            name={source.name}
            prefix="stores.panel"
            listUrl={URL_STORE}
            inUse={snapshotsInUse}
            onDeleted={onDeleted}
            renderWizard={({items, ...props}) => <StoreWizard stores={items} {...props}/>}
        />
    );
}
