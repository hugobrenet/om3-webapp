import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {anyOf, useInstanceConfigChanges, useInstanceStatusChanges} from "../hooks/useLiveChanges";
import {authHeaders, getResponseErrorMessage} from "../services/api.jsx";
import {DEVICE_ROLES, devicesUrl, resourceDevices, resourceFileUrl, resourceFiles} from "../app/resource-devices";
import {InstanceLink} from "./RecordLinks";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Spinner} from "../ui/components/Spinner";
import {RelativeTime} from "../ui/components/RelativeTime";
import {RefreshIcon} from "../ui/icons";

const ZERO_TIME = "0001-01-01T00:00:00Z";
// What a file shows at most: the files a resource lists are small, a list of disks.
const SHOWN_CHARS = 256 * 1024;
// The status of a resource changing on its nodes one after the other: read again once settled.
export const DEVICES_SETTLE_MS = 1000;

/** An error of the daemon, its status kept. */
async function refusal(response) {
    return Object.assign(new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`), {status: response.status});
}

/**
 * The devices of a resource on the nodes holding it (`om <path> instance device ls`),
 * each node read on its own: a row a device, its node a badge, its role, its path and
 * the driver telling it; the roles said under the table. A node failing said, the
 * others shown. Read again as the configuration of the object or the status of the
 * resource changes, quietly: what was read kept, a node failing then keeping its own.
 */
export function ResourceDevices({path, rid, nodes}) {
    const {t} = useTranslation();
    const [reads, setReads] = useState({});
    const [version, setVersion] = useState(0);
    const key = nodes.join(",");
    const changes = anyOf(useInstanceConfigChanges(path), useInstanceStatusChanges(path, rid));
    const [settled, setSettled] = useState(0);
    useEffect(() => {
        if (changes === 0) return undefined;
        const timer = setTimeout(() => setSettled((n) => n + 1), DEVICES_SETTLE_MS);
        return () => clearTimeout(timer);
    }, [changes]);
    // What is read and asked: one of them alone changed, a change read quietly.
    const shown = useRef({path, key, version});
    useEffect(() => {
        let cancelled = false;
        const quiet = shown.current.path === path && shown.current.key === key && shown.current.version === version;
        shown.current = {path, key, version};
        const list = key === "" ? [] : key.split(",");
        if (!quiet) setReads((previous) => Object.fromEntries(list.map((node) => [node, {...previous[node], loading: true}])));
        for (const node of list) {
            fetch(devicesUrl(path, node), {headers: authHeaders(), cache: "no-cache"})
                .then(async (response) => {
                    if (!response.ok) throw await refusal(response);
                    return response.json();
                })
                .then((data) => ({items: data?.items ?? [], error: null}), (error) => ({items: null, error: error.message}))
                .then((read) => {
                    if (cancelled) return;
                    setReads((previous) => ({
                        ...previous,
                        [node]: quiet && read.error && previous[node]?.items ? previous[node] : {...read, loading: false},
                    }));
                });
        }
        return () => {
            cancelled = true;
        };
    }, [path, key, version, settled]);

    // A node not read yet is being read: its effect is to come.
    const loading = nodes.some((node) => reads[node] === undefined || reads[node].loading);
    const done = nodes.filter((node) => reads[node]?.items !== undefined);
    const rows = useMemo(
        () => resourceDevices(Object.fromEntries(nodes.map((node) => [node, reads[node]?.items])), rid),
        [reads, nodes, rid],
    );
    const errors = nodes.filter((node) => reads[node]?.error).map((node) => [node, reads[node].error]);

    if (nodes.length === 0) return <p className="text-ink-muted">{t("resource.devices.noNode")}</p>;
    if (done.length === 0 && loading) return <div className="flex justify-center"><Spinner label={t("resource.devices.loading")}/></div>;
    return (
        <div className="space-y-3" data-testid="resource-devices">
            <div className="flex items-center justify-end">
                <Button size="sm" variant="secondary" icon={<RefreshIcon/>} disabled={loading} onClick={() => setVersion((v) => v + 1)}>
                    {t("resource.devices.reload")}
                </Button>
            </div>
            {errors.map(([node, message]) => (
                <Alert key={node} tone="error">{t("resource.devices.readFailed", {node, message})}</Alert>
            ))}
            <Table aria-label={t("resource.devices.table")}>
                <thead>
                    <HeaderRow>
                        <HeaderCell>{t("metrics.columns.node")}</HeaderCell>
                        <HeaderCell>{t("resource.devices.role")}</HeaderCell>
                        <HeaderCell>{t("resource.devices.device")}</HeaderCell>
                        <HeaderCell>{t("resource.devices.driver")}</HeaderCell>
                    </HeaderRow>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <Row key={`${row.node}:${row.role}:${row.device}`}>
                            <Cell className="whitespace-nowrap"><InstanceLink path={path} node={row.node}/></Cell>
                            <Cell>{DEVICE_ROLES.includes(row.role) ? t(`resource.devices.roles.${row.role}`) : row.role}</Cell>
                            <Cell className="font-mono text-data break-all">{row.device}</Cell>
                            <Cell className="text-ink-muted">{row.driver}</Cell>
                        </Row>
                    ))}
                    {rows.length === 0 && <EmptyRow colSpan={4}>{t("resource.devices.none")}</EmptyRow>}
                </tbody>
            </Table>
            {/* What each role means, said once under the table. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-muted">
                {DEVICE_ROLES.map((role) => (
                    <React.Fragment key={role}>
                        <dt className="font-medium">{t(`resource.devices.roles.${role}`)}</dt>
                        <dd>{t(`resource.devices.help.${role}`)}</dd>
                    </React.Fragment>
                ))}
            </dl>
        </div>
    );
}

/**
 * A file a resource lists, read from its node on demand: its owner, mode and time as
 * the node says them, then its text. Not there on its node, said so. Read again as
 * its checksum or its time changes (`stamp`), what was read kept on a failure.
 */
function FileContent({path, rid, node, name, stamp}) {
    const {t, i18n} = useTranslation();
    const [state, setState] = useState({loading: true});
    useEffect(() => {
        let cancelled = false;
        fetch(resourceFileUrl(path, node, rid, name), {headers: authHeaders(), cache: "no-cache"})
            .then(async (response) => {
                if (!response.ok) throw await refusal(response);
                const text = await response.text();
                return {
                    text: text.slice(0, SHOWN_CHARS),
                    size: text.length,
                    user: response.headers.get("OM-User"),
                    group: response.headers.get("OM-Group"),
                    perm: response.headers.get("OM-Perm"),
                    modified: response.headers.get("OM-Last-Modified"),
                };
            })
            .then(
                (file) => !cancelled && setState({file}),
                (error) => !cancelled && setState((previous) => (previous.file && error.status !== 404 ? previous : {error})),
            );
        return () => {
            cancelled = true;
        };
    }, [path, rid, node, name, stamp]);

    if (state.loading) return <Spinner label={t("resource.files.reading")}/>;
    if (state.error) {
        return state.error.status === 404
            ? <p className="text-ink-muted">{t("resource.files.missing", {node})}</p>
            : <Alert tone="error">{t("resource.files.readFailed", {message: state.error.message})}</Alert>;
    }
    const {file} = state;
    return (
        <div className="space-y-2">
            <p className="text-ink-muted">
                {t("resource.files.stat", {user: file.user ?? "–", group: file.group ?? "–", perm: file.perm ?? "–"})}
                {file.modified && <> · <RelativeTime value={file.modified} locale={i18n.language}/></>}
            </p>
            {file.size === 0 ? <p className="text-ink-muted">{t("resource.files.empty")}</p> : (
                <pre aria-label={t("resource.files.content", {name})} className="max-h-96 overflow-auto rounded-(--radius-control) bg-surface-sunken p-2 font-mono text-data whitespace-pre">
                    {file.text}
                </pre>
            )}
            {file.size > SHOWN_CHARS && <p className="text-ink-muted">{t("resource.files.cut", {shown: SHOWN_CHARS, size: file.size})}</p>}
        </div>
    );
}

/**
 * The files a resource lists in its status on its nodes (a md disk its disks, for
 * example), which the nodes copy from the one up: a row each, its node a badge, its
 * name, when it changed and its checksum; read on demand from its node (root only).
 */
export function ResourceFiles({path, rid, nodes}) {
    const {t, i18n} = useTranslation();
    const instances = useEventStore((s) => s.objectInstanceStatus?.[path]);
    const files = useMemo(() => resourceFiles(instances, rid, nodes), [instances, rid, nodes]);
    const [open, setOpen] = useState(null);
    const toggle = useCallback((id) => setOpen((current) => (current === id ? null : id)), []);
    return (
        <div className="space-y-3" data-testid="resource-files">
            <p className="text-ink-muted">{t("resource.files.intro")}</p>
            <Table aria-label={t("resource.files.table")}>
                <thead>
                    <HeaderRow>
                        <HeaderCell>{t("metrics.columns.node")}</HeaderCell>
                        <HeaderCell>{t("resource.files.name")}</HeaderCell>
                        <HeaderCell>{t("resource.files.changed")}</HeaderCell>
                        <HeaderCell>{t("resource.files.csum")}</HeaderCell>
                        <HeaderCell/>
                    </HeaderRow>
                </thead>
                <tbody>
                    {files.map((f) => {
                        const id = `${f.node}:${f.name}`;
                        return (
                            <React.Fragment key={id}>
                                <Row selected={open === id}>
                                    <Cell className="whitespace-nowrap"><InstanceLink path={path} node={f.node}/></Cell>
                                    <Cell className="font-mono text-data break-all">{f.name}</Cell>
                                    <Cell className="whitespace-nowrap">
                                        {!f.mtime || f.mtime === ZERO_TIME ? <span className="text-ink-muted">–</span> : <RelativeTime value={f.mtime} locale={i18n.language}/>}
                                    </Cell>
                                    <Cell className="font-mono text-data text-ink-muted break-all">{f.csum || "–"}</Cell>
                                    <Cell className="text-right">
                                        <Button size="sm" variant="secondary" aria-expanded={open === id} onClick={() => toggle(id)}
                                                aria-label={t(open === id ? "resource.files.hideOf" : "resource.files.showOf", {name: f.name, node: f.node})}>
                                            {t(open === id ? "resource.files.hide" : "resource.files.show")}
                                        </Button>
                                    </Cell>
                                </Row>
                                {open === id && (
                                    <tr className="border-b border-line">
                                        <td colSpan={5} className="px-2 py-2">
                                            <FileContent path={path} rid={rid} node={f.node} name={f.name} stamp={`${f.csum}@${f.mtime}`}/>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                    {files.length === 0 && <EmptyRow colSpan={5}>{t("resource.files.none")}</EmptyRow>}
                </tbody>
            </Table>
        </div>
    );
}
