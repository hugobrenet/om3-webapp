import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {apiFetch, authHeaders, getResponseErrorMessage, problemOf} from "../services/api.jsx";
import {trackRefused, trackResponse} from "../app/action-tracker";
import {actionSubject, actionUrl, refusalReason} from "./objectActions";
import {InstanceLink, ResourceLink} from "./RecordLinks";
import {nodeUrl} from "./NodePanel";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Checkbox, Field, Input, Select} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {RelativeTime} from "../ui/components/RelativeTime";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {RefreshIcon} from "../ui/icons";
import {useStoreChanges} from "./StorePanel";

/*
 * The snapshots of the sync resources of an object, as `om <path> sync snapshot
 * list` shows them, each restored on demand, as `om <path> sync restore` does:
 * aside, into a directory, the instance left untouched; or in place, into the
 * heads, emptied first. Only a sync.store resource keeps snapshots, in a store
 * every node reads the same: one node is asked.
 */

/** The driver keeping snapshots: the object offers its tab when an instance has one. */
export const SNAPSHOT_TYPE = "sync.store";

/** What a snapshot holds besides the heads: the configuration, and the keys the object references. */
const MEMBER_CONFIG = "config";
const MEMBER_REFS = "refs.json";

/** How the referenced keys are written back in place, as om reads --refs; missing by default. */
const REFS_MODES = ["missing", "skip", "overwrite"];

/** An id short enough to read, as om shows a run: its first 8 characters. */
const shortId = (id) => String(id ?? "").slice(0, 8);

/** The nodes of the object whose instance has a resource keeping snapshots. */
export function useSnapshotNodes(path) {
    const instances = useEventStore((s) => s.objectInstanceStatus?.[path]);
    return useMemo(() => Object.entries(instances ?? {})
        .filter(([, status]) => Object.values(status?.resources ?? {}).some((r) => r?.type === SNAPSHOT_TYPE))
        .map(([node, status]) => ({node, up: status?.avail === "up"}))
        .sort((a, b) => Number(b.up) - Number(a.up) || a.node.localeCompare(b.node)), [instances]);
}

/** The address of an instance endpoint of the object on `node`. */
const instanceUrl = (path, node, suffix) => {
    const {namespace, kind, name} = parseObjectPath(path);
    return nodeUrl(node, `instance/path/${[namespace, kind, name].map(encodeURIComponent).join("/")}/${suffix}`);
};

/**
 * A daemon older than the snapshots answers its router's 404, `{"message": "Not
 * Found"}`, not a problem of its own: said as such, not as a failure.
 */
const unsupported = (err) => err?.status === 404 && err?.body?.message === "Not Found" && !err?.body?.title;

export function ObjectSnapshots({path}) {
    const {t, i18n} = useTranslation();
    const nodes = useSnapshotNodes(path);
    // The node asked: the one running the object, else the first holding a store.
    const [asked, setAsked] = useState("");
    const node = nodes.some((n) => n.node === asked) ? asked : nodes[0]?.node ?? "";
    const [state, setState] = useState({snapshots: null, error: "", unsupported: false, loading: false});
    const [reads, setReads] = useState(0);
    const reload = useCallback(() => setReads((n) => n + 1), []);
    const [restoring, setRestoring] = useState(null);
    // Read again as runs and prunes change them, quietly: the same node, read already, nothing asked.
    const changes = useStoreChanges();
    const shown = useRef(null);

    useEffect(() => {
        if (node === "") return undefined;
        let live = true;
        const key = `${path} ${node} ${reads}`;
        const again = shown.current === key;
        if (!again) setState((s) => ({...s, loading: true, error: ""}));
        apiFetch(instanceUrl(path, node, "sync/snapshots"), {headers: authHeaders(), cache: "no-cache"})
            .then((body) => {
                if (!live) return;
                shown.current = key;
                // Each item holds its snapshot in its data, the node asked in its meta.
                // The latest first: the one a restore is most often asked from.
                const snapshots = (body?.items ?? []).map((item) => item?.data ?? {}).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
                setState({snapshots, error: "", unsupported: false, loading: false});
            })
            .catch((err) => {
                if (!live || again) return;
                setState({
                    snapshots: null,
                    error: unsupported(err) ? "" : refusalReason({status: err.status, detail: problemOf(err) || err.message}),
                    unsupported: unsupported(err),
                    loading: false,
                });
            });
        return () => {
            live = false;
        };
    }, [path, node, reads, changes]);

    if (nodes.length === 0) return <p className="text-ink-muted">{t("snapshots.noStore")}</p>;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
                <p className="min-w-0 flex-1 text-ink-muted">{t("snapshots.intro")}</p>
                {nodes.length > 1 && (
                    <Field label={t("snapshots.askedNode")}>
                        {(control) => (
                            <Select {...control} value={node} onChange={(e) => setAsked(e.target.value)} className="w-40">
                                {nodes.map((n) => <option key={n.node} value={n.node}>{n.node}</option>)}
                            </Select>
                        )}
                    </Field>
                )}
                <Button size="sm" icon={<RefreshIcon className="h-3.5 w-3.5"/>} onClick={reload} disabled={state.loading}>
                    {t("snapshots.refresh")}
                </Button>
            </div>
            {state.unsupported && <Alert tone="warning">{t("snapshots.unsupported", {node})}</Alert>}
            {state.error && <Alert tone="error">{t("snapshots.loadError", {message: state.error})}</Alert>}
            {state.snapshots === null ? (
                state.loading && <div className="flex justify-center py-4"><Spinner label={t("snapshots.loading")}/></div>
            ) : (
                <Table aria-label={t("snapshots.table")}>
                    <thead>
                        <HeaderRow>
                            <HeaderCell>{t("snapshots.id")}</HeaderCell>
                            <HeaderCell>{t("snapshots.resource")}</HeaderCell>
                            <HeaderCell>{t("snapshots.taken")}</HeaderCell>
                            <HeaderCell>{t("snapshots.takenBy")}</HeaderCell>
                            <HeaderCell>{t("snapshots.holds")}</HeaderCell>
                            <HeaderCell>{t("snapshots.store")}</HeaderCell>
                            <HeaderCell><span className="sr-only">{t("snapshots.actions")}</span></HeaderCell>
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {state.snapshots.map((snapshot) => (
                            <Row key={`${snapshot.rid} ${snapshot.id}`}>
                                <Cell className="whitespace-nowrap font-mono">{shortId(snapshot.id)}</Cell>
                                <Cell><ResourceLink path={path} rid={snapshot.rid}/></Cell>
                                <Cell className="whitespace-nowrap"><RelativeTime value={snapshot.created_at} locale={i18n.language}/></Cell>
                                <Cell>{snapshot.node ? <InstanceLink path={path} node={snapshot.node} label={snapshot.node}/> : "–"}</Cell>
                                <Cell className="font-mono text-data">{(snapshot.members ?? []).join(" ")}</Cell>
                                <Cell className="font-mono text-data text-ink-muted">{snapshot.location}</Cell>
                                <Cell className="text-right">
                                    <Button size="sm" variant="secondary"
                                            aria-label={t("snapshots.restoreOne", {id: shortId(snapshot.id), rid: snapshot.rid})}
                                            onClick={() => setRestoring(snapshot)}>
                                        {t("snapshots.restore")}
                                    </Button>
                                </Cell>
                            </Row>
                        ))}
                        {state.snapshots.length === 0 && <EmptyRow colSpan={7}>{t("snapshots.none")}</EmptyRow>}
                    </tbody>
                </Table>
            )}
            <RestoreDialog path={path} snapshot={restoring} nodes={nodes} onClose={() => setRestoring(null)}/>
        </div>
    );
}

/**
 * Restores a snapshot on an instance, as `om <path> sync restore --snapshot <id>`
 * does: aside, into a directory per head, the instance untouched, by default; or in
 * place, every head emptied but its excluded paths and filled with what the snapshot
 * saved, confirmed first, the daemon refusing it while an app, a container or a
 * share using the data is up. The configuration restores aside only, as om does;
 * the referenced keys in place only, where they are not written in clear.
 */
function RestoreDialog({path, snapshot, nodes, onClose}) {
    const {t} = useTranslation();
    const open = snapshot !== null;
    const heads = useMemo(
        () => (snapshot?.members ?? []).filter((m) => m !== MEMBER_CONFIG && m !== MEMBER_REFS),
        [snapshot],
    );
    const hasConfig = (snapshot?.members ?? []).includes(MEMBER_CONFIG);
    const hasRefs = (snapshot?.members ?? []).includes(MEMBER_REFS);
    const [node, setNode] = useState("");
    const [inPlace, setInPlace] = useState(false);
    const [picked, setPicked] = useState([]);
    const [into, setInto] = useState("");
    const [config, setConfig] = useState(false);
    const [refs, setRefs] = useState("missing");
    const [understood, setUnderstood] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    // Each snapshot opened starts over: aside, every head, on the node running the object.
    useEffect(() => {
        if (!open) return;
        setNode(nodes[0]?.node ?? "");
        setInPlace(false);
        setPicked(heads);
        setInto("");
        setConfig(false);
        setRefs("missing");
        setUnderstood(false);
        setError("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, snapshot]);

    const intoError = !inPlace && !into.trim().startsWith("/") ? t("snapshots.dialog.intoRequired") : null;
    const headsError = heads.length > 0 && picked.length === 0 ? t("snapshots.dialog.headsRequired") : null;
    const ready = !submitting && node !== "" && intoError === null && headsError === null && (!inPlace || understood);

    const toggle = (rid) => setPicked((p) => (p.includes(rid) ? p.filter((r) => r !== rid) : [...p, rid]));

    const restore = async (event) => {
        event?.preventDefault();
        if (!ready) return;
        setSubmitting(true);
        setError("");
        const query = new URLSearchParams({rid: snapshot.rid, snapshot: snapshot.id});
        // Every head when all are picked: as om, none named.
        if (picked.length < heads.length) picked.forEach((rid) => query.append("head", rid));
        if (inPlace) {
            if (hasRefs) query.set("refs", refs);
        } else {
            query.set("into", into.trim());
            if (config) query.set("config", "true");
        }
        const subject = actionSubject({path, node});
        try {
            const response = await fetch(`${actionUrl({path, action: "restore", node})}?${query}`, {
                method: "POST",
                headers: authHeaders(),
            });
            if (!response.ok) {
                const reason = refusalReason({status: response.status, detail: await getResponseErrorMessage(response)});
                trackRefused({action: "restore", subject, reason});
                // Said here too, the form kept to change what was asked.
                setError(reason);
                return;
            }
            await trackResponse(response, {action: "restore", subject, node, path});
            onClose();
        } catch (err) {
            trackRefused({action: "restore", subject, reason: err.message});
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const formId = "snapshot-restore";
    return (
        <Dialog
            open={open}
            onClose={submitting ? () => {} : onClose}
            title={open ? t("snapshots.dialog.title", {id: shortId(snapshot.id), rid: snapshot.rid}) : ""}
            size="lg"
            footer={
                <>
                    <Button onClick={onClose} disabled={submitting}>{t("common.cancel")}</Button>
                    {/* In place, what the heads held is lost: red, as what is removed. */}
                    <Button variant={inPlace ? "delete" : "change"} type="submit" form={formId} disabled={!ready}
                            icon={submitting ? <Spinner label={t("snapshots.dialog.restoring")}/> : undefined}>
                        {inPlace ? t("snapshots.dialog.submitInPlace") : t("snapshots.dialog.submitAside")}
                    </Button>
                </>
            }
        >
            {open && (
                <form id={formId} onSubmit={restore} noValidate className="space-y-3 text-ink">
                    <p className="text-ink-muted">{t("snapshots.dialog.taken", {id: snapshot.id, node: snapshot.node, location: snapshot.location})}</p>
                    {nodes.length > 1 && (
                        <Field label={t("snapshots.dialog.node")} hint={t("snapshots.dialog.nodeHint")}>
                            {(control) => (
                                <Select {...control} value={node} onChange={(e) => setNode(e.target.value)} className="w-48">
                                    {nodes.map((n) => (
                                        <option key={n.node} value={n.node}>
                                            {n.up ? t("snapshots.dialog.nodeUp", {node: n.node}) : n.node}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                    )}
                    <fieldset className="space-y-1">
                        <legend className="mb-1 font-medium">{t("snapshots.dialog.where")}</legend>
                        <label className="flex items-start gap-2">
                            <input type="radio" name="restore-where" checked={!inPlace} onChange={() => setInPlace(false)}
                                   className="mt-1 h-4 w-4 accent-(--accent)"/>
                            <span>{t("snapshots.dialog.aside")}</span>
                        </label>
                        <label className="flex items-start gap-2">
                            <input type="radio" name="restore-where" checked={inPlace} onChange={() => setInPlace(true)}
                                   className="mt-1 h-4 w-4 accent-(--accent)"/>
                            <span>{t("snapshots.dialog.inPlace")}</span>
                        </label>
                    </fieldset>
                    {heads.length > 0 && (
                        <fieldset className="space-y-1">
                            <legend className="mb-1 font-medium">{t("snapshots.dialog.heads")}</legend>
                            <div className="flex flex-wrap gap-4">
                                {heads.map((rid) => (
                                    <Checkbox key={rid} label={<span className="font-mono">{rid}</span>}
                                              checked={picked.includes(rid)} onChange={() => toggle(rid)}/>
                                ))}
                            </div>
                            {headsError && <p className="text-state-down">{headsError}</p>}
                        </fieldset>
                    )}
                    {inPlace ? (
                        <>
                            {hasRefs && (
                                <Field label={t("snapshots.dialog.refs")} hint={t(`snapshots.dialog.refsHint.${refs}`)}>
                                    {(control) => (
                                        <Select {...control} value={refs} onChange={(e) => setRefs(e.target.value)} className="w-48">
                                            {REFS_MODES.map((mode) => <option key={mode} value={mode}>{t(`snapshots.dialog.refsMode.${mode}`)}</option>)}
                                        </Select>
                                    )}
                                </Field>
                            )}
                            {hasConfig && <p className="text-ink-muted">{t("snapshots.dialog.configAsideOnly")}</p>}
                            <Alert tone="warning">{t("snapshots.dialog.inPlaceWarning")}</Alert>
                            <Checkbox label={t("snapshots.dialog.understood")} checked={understood}
                                      onChange={(e) => setUnderstood(e.target.checked)}/>
                        </>
                    ) : (
                        <>
                            <Field label={t("snapshots.dialog.into")} hint={t("snapshots.dialog.intoHint")} error={into !== "" ? intoError : null}>
                                {(control) => (
                                    <Input {...control} value={into} onChange={(e) => setInto(e.target.value)}
                                           placeholder="/var/tmp/restore" autoComplete="off" spellCheck={false}/>
                                )}
                            </Field>
                            {hasConfig && (
                                <Checkbox label={t("snapshots.dialog.config")} checked={config}
                                          onChange={(e) => setConfig(e.target.checked)}/>
                            )}
                            {hasRefs && <p className="text-ink-muted">{t("snapshots.dialog.refsInPlaceOnly")}</p>}
                        </>
                    )}
                    {error && <Alert tone="error">{error}</Alert>}
                </form>
            )}
        </Dialog>
    );
}
