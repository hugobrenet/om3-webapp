import React, {useCallback, useEffect, useRef, useState} from "react";
import {Trans, useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {deleteFile, isFileExists, listFiles, makeDirectory, uploadFile} from "../services/volume-files.js";
import {formatBytes} from "../utils/cgroupMetrics.js";
import {usePanelSearch} from "../app/panel-search";
import {Alert} from "../ui/components/Alert";
import {Button, IconButton} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Field, Input, Select} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {Table, HeaderRow, HeaderCell, Row, Cell} from "../ui/components/Table";
import {formatDateTime} from "../ui/lib/format";
import {cn} from "../ui/cn";
import {FolderIcon, LinkIcon, TrashIcon} from "../ui/icons";
import {BADGE} from "./ObjectCells";
import {Section} from "./NodePanel";

/** The kinds holding files of their users. */
export const FILES_KINDS = ["vol"];

/** The avails a volume is read and written with. */
const AVAILABLE = ["up", "stdby up", "n/a"];

/** The mark is set after the last byte, by the node, on its clock: written later, the file was changed since. */
const CHANGED_AFTER_MS = 0;

/**
 * Where a file comes from, as the node tells it: uploaded here, by whom and when,
 * changed since or not; else not known to be, which the services using the volume
 * may have written.
 */
export function fileOrigin(file) {
    if (!file?.uploaded_at) return null;
    const changed = Date.parse(file.modified_at) - Date.parse(file.uploaded_at) > CHANGED_AFTER_MS;
    return {by: file.uploaded_by, at: file.uploaded_at, changed};
}

/** A name of an entry of a directory, as the node takes one: no path, not hidden. */
export const isEntryName = (name) => name !== "" && !name.startsWith(".") && !/[/\\\0]/.test(name) && name.length <= 255;

/** A directory under another, "" the top of the volume. */
const join = (dir, name) => (dir ? `${dir}/${name}` : name);

/** The directories first, then the others, each by name. */
const byKind = (a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name);

/**
 * The files of a volume, a tab of its panel, its directories walked down from its top
 * and up a breadcrumb, the directory shown in the URL (`view`), a reload or Back
 * keeping it: what the services using it write, and what is uploaded there from the
 * browser with no root grant, within the size of the volume, a guest's image or
 * installer say (`image`, `cdrom`); on a node where it is available, a replicated
 * volume there being one. A file of the name of one is replaced only once asked, one
 * not uploaded here deleted on a warning, a directory only empty.
 */
export function VolumeFiles({path}) {
    const {t, i18n} = useTranslation();
    const {view, setView} = usePanelSearch();
    const dir = view ?? "";
    const instances = useEventStore((s) => s.objectInstanceStatus?.[path]);
    const nodes = Object.entries(instances ?? {}).filter(([, st]) => AVAILABLE.includes(st?.avail)).map(([n]) => n).sort();
    const [picked, setPicked] = useState("");
    const node = nodes.includes(picked) ? picked : nodes[0];
    const [listing, setListing] = useState(null);
    const files = listing?.items ?? null;
    const [error, setError] = useState("");
    const [certificateUrl, setCertificateUrl] = useState("");
    const [sending, setSending] = useState(null);
    const [deleting, setDeleting] = useState("");
    // An entry to delete, asked in a dialog: the row keeps its width.
    const [deleteAsked, setDeleteAsked] = useState(null);
    // A file to send whose name is taken: replacing it asked first.
    const [replacing, setReplacing] = useState(null);
    // A directory to create: its name as typed, and why it was refused.
    const [creating, setCreating] = useState(null);
    const upload = useRef(null);
    const input = useRef(null);

    const refresh = useCallback(async () => {
        if (!node) return;
        try {
            setListing(await listFiles(path, node, dir));
            setError("");
        } catch (err) {
            setListing({items: [], truncated: false});
            setError(err.message);
        }
    }, [path, node, dir]);

    useEffect(() => {
        setListing(null);
        refresh();
    }, [refresh]);

    // A transfer lasts as long as the tab showing it.
    useEffect(() => () => upload.current?.abort(), []);

    const open = (next) => {
        setError("");
        setView(next || undefined);
    };

    const send = async (file, {replace = false} = {}) => {
        setError("");
        setCertificateUrl("");
        // Known there already: asked before anything is sent.
        if (!replace && files?.some((f) => f.name === file.name)) {
            setReplacing(file);
            if (input.current) input.current.value = "";
            return;
        }
        setSending({name: file.name, part: 0});
        const transfer = uploadFile(path, node, file, (part) => setSending({name: file.name, part}), {replace, dir});
        upload.current = transfer;
        try {
            await transfer.done;
            await refresh();
        } catch (err) {
            if (isFileExists(err) && !replace) {
                // There since the listing, or written meanwhile: asked as well.
                setReplacing(file);
                void refresh();
            } else if (err.name !== "AbortError") {
                setError(t("volumeFiles.failed", {name: file.name, message: err.message}));
                setCertificateUrl(err.certificateUrl ?? "");
            }
        } finally {
            upload.current = null;
            setSending(null);
            if (input.current) input.current.value = "";
        }
    };

    const remove = async (name) => {
        setDeleting(name);
        try {
            await deleteFile(path, node, name, dir);
            await refresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeleting("");
            setDeleteAsked(null);
        }
    };

    const create = async () => {
        const name = creating.name.trim();
        if (!isEntryName(name)) {
            setCreating((c) => ({...c, error: t("volumeFiles.mkdir.invalid")}));
            return;
        }
        try {
            await makeDirectory(path, node, name, dir);
            setCreating(null);
            await refresh();
        } catch (err) {
            setCreating((c) => ({...c, error: err.message}));
        }
    };

    if (nodes.length === 0) {
        return <Alert tone="info">{t("volumeFiles.notAvailable")}</Alert>;
    }
    const parts = dir ? dir.split("/") : [];
    // An entry of no type, from a node telling none, a file.
    const entries = files ? files.map((f) => ({type: "file", ...f})).sort(byKind) : null;
    return (
        <Section
            id="volume-files"
            title={t("volumeFiles.title")}
            count={files?.length}
            tools={
                <>
                    {nodes.length > 1 && (
                        <Select aria-label={t("volumeFiles.node")} className="h-7" value={node} onChange={(e) => setPicked(e.target.value)}>
                            {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
                        </Select>
                    )}
                    <input
                        ref={input}
                        type="file"
                        aria-label={t("volumeFiles.choose")}
                        className="sr-only"
                        onChange={(e) => e.target.files?.[0] && send(e.target.files[0])}
                    />
                    <Button size="sm" variant="create" disabled={sending !== null} onClick={() => input.current?.click()}>
                        {t("volumeFiles.upload")}
                    </Button>
                    <Button size="sm" variant="create" onClick={() => setCreating({name: "", error: ""})}>
                        {t("volumeFiles.mkdir.open")}
                    </Button>
                </>
            }
        >
            <p className="text-ink-muted">{t("volumeFiles.hint")}</p>
            {/* Where the list stands, as a path: the top of the volume "/", the object named by the
                panel already, then each directory down to the one shown. */}
            <nav aria-label={t("volumeFiles.where")} className="flex flex-wrap items-center gap-1 font-mono text-data">
                {[{label: "/", to: ""}, ...parts.map((part, i) => ({label: part, to: parts.slice(0, i + 1).join("/")}))].map((crumb, i, all) => (
                    <React.Fragment key={crumb.to}>
                        {i > 1 && <span aria-hidden="true" className="text-ink-muted">/</span>}
                        {i === all.length - 1 ? (
                            <span aria-current="page" className="font-semibold">{crumb.label}</span>
                        ) : (
                            <button type="button" onClick={() => open(crumb.to)} className="text-accent hover:underline">{crumb.label}</button>
                        )}
                    </React.Fragment>
                ))}
            </nav>
            {error && (
                <Alert tone="error">
                    {error}
                    {certificateUrl && (
                        <>
                            {" "}
                            <Trans
                                i18nKey="console.certificateHint"
                                values={{url: certificateUrl}}
                                components={{
                                    certLink: <a
                                        href={certificateUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all text-accent underline"
                                    />,
                                }}
                            />
                        </>
                    )}
                </Alert>
            )}
            {sending && (
                <div className="flex items-center gap-2">
                    <progress
                        aria-label={t("volumeFiles.sending", {name: sending.name})}
                        className="h-2 flex-1"
                        max={1}
                        value={sending.part}
                    />
                    <span className="text-data text-ink-muted tabular-nums">{Math.round(sending.part * 100)}%</span>
                    <Button size="sm" onClick={() => upload.current?.abort()}>{t("volumeFiles.cancel")}</Button>
                </div>
            )}
            {entries === null && !error && <Spinner/>}
            {entries?.length === 0 && !error && <p className="text-ink-muted">{t(dir ? "volumeFiles.emptyDir" : "volumeFiles.none")}</p>}
            {listing?.truncated && <Alert tone="info">{t("volumeFiles.truncated", {count: files.length})}</Alert>}
            {entries?.length > 0 && (
                <Table>
                    <thead>
                        <HeaderRow>
                            <HeaderCell>{t("volumeFiles.name")}</HeaderCell>
                            <HeaderCell>{t("volumeFiles.size")}</HeaderCell>
                            <HeaderCell>{t("volumeFiles.origin")}</HeaderCell>
                            <HeaderCell/>
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {entries.map((f) => {
                            const origin = f.type === "file" ? fileOrigin(f) : null;
                            return (
                                <Row key={f.name}>
                                    <Cell className="font-mono" data-entry={f.type}>
                                        {f.type === "dir" ? (
                                            <button type="button" onClick={() => open(join(dir, f.name))} className="inline-flex items-center gap-1.5 text-left text-accent hover:underline">
                                                <FolderIcon className="h-3.5 w-3.5 shrink-0"/>
                                                {f.name}/
                                            </button>
                                        ) : f.type === "link" ? (
                                            <span className="inline-flex flex-wrap items-center gap-1.5">
                                                <LinkIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted"/>
                                                {f.name}
                                                {f.target && <span className="text-ink-muted">→ {f.target}</span>}
                                            </span>
                                        ) : f.name}
                                    </Cell>
                                    <Cell className="whitespace-nowrap tabular-nums">{f.type === "file" ? formatBytes(f.size) : ""}</Cell>
                                    <Cell data-origin={origin ? "uploaded" : "unknown"}>
                                        {f.type !== "file" ? null : origin ? (
                                            <span className="inline-flex flex-wrap items-center gap-x-1.5">
                                                <span className={cn(BADGE, "border-accent text-accent")}>{t("volumeFiles.uploaded")}</span>
                                                <span className="text-ink-muted">
                                                    {t(origin.by ? "volumeFiles.uploadedByAt" : "volumeFiles.uploadedAt", {by: origin.by, at: formatDateTime(origin.at, i18n.language)})}
                                                    {origin.changed && ` · ${t("volumeFiles.changedSince")}`}
                                                </span>
                                            </span>
                                        ) : <span className="text-ink-muted">{t("volumeFiles.notUploaded")}</span>}
                                    </Cell>
                                    <Cell className="w-8 text-right">
                                        <IconButton
                                            size="sm"
                                            label={t("volumeFiles.deleteOne", {name: f.name})}
                                            disabled={deleting === f.name}
                                            onClick={() => setDeleteAsked({name: f.name, type: f.type, uploaded: origin !== null})}
                                        >
                                            <TrashIcon className="h-3.5 w-3.5"/>
                                        </IconButton>
                                    </Cell>
                                </Row>
                            );
                        })}
                    </tbody>
                </Table>
            )}
            <Dialog
                open={deleteAsked !== null}
                onClose={() => setDeleteAsked(null)}
                title={t("volumeFiles.deleteQuestion", {name: deleteAsked?.name ?? ""})}
                footer={(
                    <>
                        <Button onClick={() => setDeleteAsked(null)}>{t("volumeFiles.cancel")}</Button>
                        <Button variant="delete" disabled={deleting !== ""} onClick={() => remove(deleteAsked.name)}>
                            {deleting !== "" ? t("volumeFiles.deleting") : t("volumeFiles.delete")}
                        </Button>
                    </>
                )}
            >
                {deleteAsked && t(deleteAsked.type === "dir" ? "volumeFiles.deleteDirText"
                    : deleteAsked.type === "link" ? "volumeFiles.deleteLinkText"
                    : deleteAsked.uploaded ? "volumeFiles.deleteText" : "volumeFiles.deleteForeignText")}
            </Dialog>
            <Dialog
                open={replacing !== null}
                onClose={() => setReplacing(null)}
                title={t("volumeFiles.replace.title", {name: replacing?.name ?? ""})}
                footer={(
                    <>
                        <Button onClick={() => setReplacing(null)}>{t("volumeFiles.cancel")}</Button>
                        <Button
                            variant="delete"
                            onClick={() => {
                                const file = replacing;
                                setReplacing(null);
                                void send(file, {replace: true});
                            }}
                        >
                            {t("volumeFiles.replace.confirm")}
                        </Button>
                    </>
                )}
            >
                {t("volumeFiles.replace.text", {name: replacing?.name ?? ""})}
            </Dialog>
            <Dialog
                open={creating !== null}
                onClose={() => setCreating(null)}
                title={t("volumeFiles.mkdir.title", {dir: `/${dir}`})}
                footer={(
                    <>
                        <Button onClick={() => setCreating(null)}>{t("volumeFiles.cancel")}</Button>
                        <Button variant="create" disabled={!creating?.name.trim()} onClick={create}>{t("volumeFiles.mkdir.confirm")}</Button>
                    </>
                )}
            >
                <form onSubmit={(e) => {
                    e.preventDefault();
                    if (creating?.name.trim()) void create();
                }} className="space-y-2">
                    <Field label={t("volumeFiles.mkdir.name")}>
                        {(control) => (
                            <Input {...control} autoComplete="off" value={creating?.name ?? ""} onChange={(e) => setCreating({name: e.target.value, error: ""})}/>
                        )}
                    </Field>
                    {creating?.error && <Alert>{creating.error}</Alert>}
                </form>
            </Dialog>
        </Section>
    );
}
