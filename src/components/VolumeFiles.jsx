import React, {useCallback, useEffect, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {deleteFile, listFiles, uploadFile} from "../services/volume-files.js";
import {formatBytes} from "../utils/cgroupMetrics.js";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {ConfirmButton} from "../ui/components/ConfirmButton";
import {Select} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {Table, HeaderRow, HeaderCell, Row, Cell} from "../ui/components/Table";
import {Section} from "./NodePanel";

/** The kinds holding files of their users. */
export const FILES_KINDS = ["vol"];

/** The avails a volume is read and written with. */
const AVAILABLE = ["up", "stdby up", "n/a"];

/**
 * The files at the top of a volume, a tab of its panel: what a guest is installed
 * from (`image`, `cdrom`), sent from the browser with no root grant, within the size of
 * the volume. On a node where it is available, a replicated volume there being one.
 */
export function VolumeFiles({path}) {
    const {t} = useTranslation();
    const instances = useEventStore((s) => s.objectInstanceStatus?.[path]);
    const nodes = Object.entries(instances ?? {}).filter(([, st]) => AVAILABLE.includes(st?.avail)).map(([n]) => n).sort();
    const [picked, setPicked] = useState("");
    const node = nodes.includes(picked) ? picked : nodes[0];
    const [files, setFiles] = useState(null);
    const [error, setError] = useState("");
    const [sending, setSending] = useState(null);
    const [deleting, setDeleting] = useState("");
    const upload = useRef(null);
    const input = useRef(null);

    const refresh = useCallback(async () => {
        if (!node) return;
        try {
            setFiles(await listFiles(path, node));
            setError("");
        } catch (err) {
            setError(err.message);
        }
    }, [path, node]);

    useEffect(() => {
        setFiles(null);
        refresh();
    }, [refresh]);

    // A transfer lasts as long as the tab showing it.
    useEffect(() => () => upload.current?.abort(), []);

    const send = async (file) => {
        setError("");
        setSending({name: file.name, part: 0});
        const transfer = uploadFile(path, node, file, (part) => setSending({name: file.name, part}));
        upload.current = transfer;
        try {
            await transfer.done;
            await refresh();
        } catch (err) {
            if (err.name !== "AbortError") setError(t("volumeFiles.failed", {name: file.name, message: err.message}));
        } finally {
            upload.current = null;
            setSending(null);
            if (input.current) input.current.value = "";
        }
    };

    const remove = async (name) => {
        setDeleting(name);
        try {
            await deleteFile(path, node, name);
            await refresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeleting("");
        }
    };

    if (nodes.length === 0) {
        return <Alert tone="info">{t("volumeFiles.notAvailable")}</Alert>;
    }
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
                </>
            }
        >
            <p className="text-ink-muted">{t("volumeFiles.hint")}</p>
            {error && <Alert tone="error">{error}</Alert>}
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
            {files === null && !error && <Spinner/>}
            {files?.length === 0 && <p className="text-ink-muted">{t("volumeFiles.none")}</p>}
            {files?.length > 0 && (
                <Table>
                    <thead>
                        <HeaderRow>
                            <HeaderCell>{t("volumeFiles.name")}</HeaderCell>
                            <HeaderCell>{t("volumeFiles.size")}</HeaderCell>
                            <HeaderCell/>
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {files.map((f) => (
                            <Row key={f.name}>
                                <Cell className="font-mono">{f.name}</Cell>
                                <Cell className="tabular-nums">{formatBytes(f.size)}</Cell>
                                <Cell>
                                    <ConfirmButton
                                        inline
                                        label={t("volumeFiles.delete")}
                                        question={t("volumeFiles.deleteQuestion", {name: f.name})}
                                        confirmLabel={t("volumeFiles.delete")}
                                        cancelLabel={t("volumeFiles.cancel")}
                                        pendingLabel={t("volumeFiles.deleting")}
                                        pending={deleting === f.name}
                                        onConfirm={() => remove(f.name)}
                                    />
                                </Cell>
                            </Row>
                        ))}
                    </tbody>
                </Table>
            )}
        </Section>
    );
}
