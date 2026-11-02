import React, {useEffect, useState} from "react";
import {Trans, useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {Button, IconButton} from "../ui/components/Button";
import {CopyButton} from "../ui/components/CopyButton";
import {Dialog} from "../ui/components/Dialog";
import {Checkbox, Textarea} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {DownloadIcon} from "../ui/icons";
import {formatBytes} from "../utils/cgroupMetrics.js";
import {downloadFile, readFileHead, uploadFile} from "../services/volume-files.js";
import {parseBlobContent} from "../utils/blob-content";
import {hasPemCertificate} from "../utils/x509";
import CertificateDetails from "./CertificateDetails";
import {CrossLink} from "../app/CrossLink";

/** What is read of a file to show it, and of a binary one the bytes dumped in hex. */
const SHOWN = 1024 * 1024;
const HEX_SHOWN = 64 * 1024;

/** Where an installed file comes from: its datastore a way to its keys, its key shown in place by `onKey`. */
export function InstalledFrom({origin, onKey}) {
    const {t} = useTranslation();
    return (
        <Trans
            i18nKey="volumeFiles.installedFrom"
            values={{from: origin.from, key: origin.key}}
            components={{
                store: <CrossLink kind="object" id={origin.from} tab="keys"/>,
                key: <button type="button" onClick={() => onKey(origin)} className="font-mono text-accent underline decoration-dotted underline-offset-2" aria-label={t("volumeFiles.openKey", {key: origin.key})}/>,
            }}
        />
    );
}

/** The text written: its line feeds at the end dropped, or one there, as asked. */
export const withEnding = (text, noTrailingLineFeed) =>
    noTrailingLineFeed ? text.replace(/\n+$/, "") : text.endsWith("\n") ? text : `${text}\n`;

/**
 * A file of a volume in a dialog, as a key is: text shown as it is, else in hex, a
 * certificate decoded on demand; its first MiB read alone, the rest left to Download,
 * a download of its own on the console port. Text read whole is edited in place, then
 * written back over it (an upload, `replace`), unless its lines end in CR LF, which a
 * text box would turn into LF unasked; its last line ended by a line feed or not, as
 * a box set from the file read says, a text box hiding it. Installed from a key of a
 * datastore (`origin`), it is not edited: the next install would write it again, and
 * its key, shown by `onKey`, is what changes it. Removed from here as from its row
 * (`onDelete`).
 */
export function VolumeFileDialog({path, node, dir, name, origin = null, onKey, onClose, onDelete, onSaved}) {
    const {t} = useTranslation();
    const [read, setRead] = useState(null);
    const [error, setError] = useState(null);
    const [showCertificate, setShowCertificate] = useState(false);
    const [editing, setEditing] = useState(null);
    // Whether the text written ends without a line feed: as the file read, then as asked.
    const [noTrailingLineFeed, setNoTrailingLineFeed] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let live = true;
        readFileHead(path, node, name, dir, SHOWN)
            .then(async ({blob, total, partial}) => {
                const content = await parseBlobContent(blob, {hexLimit: HEX_SHOWN});
                if (live) {
                    setRead({...content, total, partial, hexPartial: content.type === "binary" && blob.size > HEX_SHOWN});
                    setNoTrailingLineFeed(content.type === "text" && !content.content.endsWith("\n"));
                }
            })
            .catch((err) => live && setError(err));
        return () => {
            live = false;
        };
    }, [path, node, dir, name]);

    const text = read?.type === "text";
    const installed = origin?.kind === "installed";
    const editable = text && !installed && !read.partial && !read.content.includes("\r");
    const isCertificate = text && hasPemCertificate(read.content);

    const save = async () => {
        setSaving(true);
        const written = withEnding(editing, noTrailingLineFeed);
        try {
            await uploadFile(path, node, new File([written], name), undefined, {replace: true, dir}).done;
            setRead((r) => ({...r, content: written, total: new Blob([written]).size}));
            setEditing(null);
            onSaved?.();
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    const changed = editing !== null && withEnding(editing, noTrailingLineFeed) !== read?.content;
    const cancel = () => {
        setEditing(null);
        setNoTrailingLineFeed(!read.content.endsWith("\n"));
    };
    return (
        <Dialog
            open
            onClose={onClose}
            dirty={changed}
            title={<span className="font-mono">{name}</span>}
            size="lg"
            footer={editing !== null ? (
                <>
                    <span className="mr-auto">
                        <Checkbox
                            label={t("volumeFiles.view.noTrailingLineFeed")}
                            checked={noTrailingLineFeed}
                            onChange={(e) => setNoTrailingLineFeed(e.target.checked)}
                            disabled={saving}
                        />
                    </span>
                    <Button onClick={cancel} disabled={saving}>{t("volumeFiles.cancel")}</Button>
                    <Button variant="change" onClick={save} disabled={saving || !changed}>
                        {saving ? t("volumeFiles.view.saving") : t("volumeFiles.view.save")}
                    </Button>
                </>
            ) : (
                <>
                    <Button variant="delete" className="mr-auto" onClick={onDelete}>{t("volumeFiles.delete")}</Button>
                    {editable && <Button onClick={() => setEditing(read.content)}>{t("volumeFiles.view.edit")}</Button>}
                    <Button onClick={onClose}>{t("volumeFiles.view.close")}</Button>
                </>
            )}
        >
            {error && (
                <Alert tone="error">
                    {error.message}
                    {error.certificateUrl && (
                        <>
                            {" "}
                            <Trans
                                i18nKey="console.certificateHint"
                                values={{url: error.certificateUrl}}
                                components={{certLink: <a href={error.certificateUrl} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline"/>}}
                            />
                        </>
                    )}
                </Alert>
            )}
            {!read && !error && (
                <div className="flex justify-center p-6"><Spinner label={t("volumeFiles.view.loading")}/></div>
            )}
            {read && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-data text-ink-muted" data-file-type={read.type}>
                            {text ? t("keys.view.typeText") : t("keys.view.typeBinary")}
                            {/* In the units of its row in the list. */}
                            {" · "}{formatBytes(read.total)}
                            {read.partial && text && ` · ${t("volumeFiles.view.partial", {size: formatBytes(SHOWN)})}`}
                            {read.hexPartial && ` · ${t("volumeFiles.view.partial", {size: formatBytes(HEX_SHOWN)})}`}
                            {text && !installed && !read.partial && !editable && ` · ${t("volumeFiles.view.crlf")}`}
                        </p>
                        <div className="flex items-center gap-1">
                            {isCertificate && editing === null && (
                                <Button size="sm" onClick={() => setShowCertificate((shown) => !shown)}>
                                    {showCertificate ? t("keys.view.showContent") : t("keys.view.decodeCertificate")}
                                </Button>
                            )}
                            {text && <CopyButton text={editing ?? read.content} label={t("keys.view.copy")}/>}
                            <IconButton
                                size="sm"
                                label={t("volumeFiles.view.download")}
                                onClick={() => downloadFile(path, node, name, dir).catch(setError)}
                            >
                                <DownloadIcon/>
                            </IconButton>
                        </div>
                    </div>
                    {installed && (
                        <p className="text-data text-ink-muted" data-installed="">
                            <InstalledFrom origin={origin} onKey={onKey}/>
                            {" · "}{t("volumeFiles.installed.notEdited")}
                        </p>
                    )}
                    {isCertificate && showCertificate && editing === null ? (
                        <CertificateDetails text={read.content}/>
                    ) : (
                        <Textarea
                            aria-label={t("volumeFiles.view.contentAria")}
                            readOnly={editing === null}
                            value={editing ?? read.content}
                            onChange={(e) => setEditing(e.target.value)}
                            rows={16}
                            className="resize-y font-mono text-data"
                        />
                    )}
                </div>
            )}
        </Dialog>
    );
}
