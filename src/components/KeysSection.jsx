import React, {useState, useEffect, useCallback, useId, useRef} from "react";
import {Dialog} from "../ui/components/Dialog";
import {Button, IconButton} from "../ui/components/Button";
import {Checkbox, Field, Input, Textarea} from "../ui/components/Field";
import {Table, HeaderRow, HeaderCell, SortHeaderCell, Row, Cell} from "../ui/components/Table";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {CloseIcon, DownloadIcon, EyeIcon, EyeOffIcon, KeyIcon, LockIcon, PlusIcon, TrashIcon} from "../ui/icons";
import {CopyButton} from "../ui/components/CopyButton";
import {formatBytes} from "../ui/lib/format";
import {useMaxKeySize} from "../hooks/useMaxKeySize";
import {useAutoHide} from "../ui/lib/reveal";
import {URL_OBJECT} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import logger from '../utils/logger.js';
import {parseObjectPath} from '../utils/objectUtils';
import {KEY_KINDS} from "../constants/actions";
import {trackRefused, trackWrite} from "../app/action-tracker";
import {refusalReason} from "./objectActions";
import {hasPemCertificate} from "../utils/x509";
import CertificateDetails from "./CertificateDetails";
import {SecCertificate} from "./SecCertificate";
import {Trans, useTranslation} from "react-i18next";

const getAuthToken = () => {
    const token = localStorage.getItem("authToken");
    if (!token) {
        logger.error("Auth token not found.");
        return null;
    }
    return token;
};

const buildObjectUrl = (decodedObjectName) => {
    const {namespace, kind, name} = parseObjectPath(decodedObjectName);
    return `${URL_OBJECT}/${namespace}/${kind}/${name}`;
};

/** A refusal in words, for the actions tray: its status, and the detail the daemon gave. */
const keyRefusal = async (response) => refusalReason({status: response.status, detail: await getResponseErrorMessage(response)});

const formatResponseError = async (response, defaultMessage) => {
    const serverError = await getResponseErrorMessage(response);
    return `${defaultMessage}${serverError ? ` - ${serverError}` : ''}`;
};

const parseBlobContent = async (blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let isText = true;
    let textContent = "";
    try {
        textContent = new TextDecoder('utf-8', {fatal: true}).decode(uint8Array);
        for (let i = 0; i < textContent.length; i++) {
            const code = textContent.charCodeAt(i);
            if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
                isText = false;
                break;
            }
        }
    } catch (e) {
        isText = false;
    }

    if (isText && textContent.length > 0) {
        return {type: "text", content: textContent};
    } else {
        const hexLines = [];
        for (let i = 0; i < uint8Array.length; i += 16) {
            const chunk = uint8Array.slice(i, i + 16);
            const hex = Array.from(chunk)
                .map(b => b.toString(16).padStart(2, '0'))
                .join(' ');
            const ascii = Array.from(chunk)
                .map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.')
                .join('');
            hexLines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48, ' ')}  ${ascii}`);
        }
        return {type: "binary", content: hexLines.join('\n')};
    }
};


/**
 * The largest key, in the unit it is a round number of: om3 sizes are decimal
 * ("1mb", 1000000 bytes) or binary ("1mib"); a size in neither in KiB or MiB.
 */
const formatKeyLimit = (bytes, locale) => {
    const units = [[1024 ** 2, "MiB"], [1000 ** 2, "MB"], [1024, "KiB"], [1000, "kB"]];
    const unit = units.find(([size]) => bytes % size === 0);
    return unit ? `${(bytes / unit[0]).toLocaleString(locale)} ${unit[1]}` : formatBytes(bytes, locale);
};

/** Saves a key as it is stored, its bytes in a file of its name. */
const downloadKey = (name, blob) => {
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

/** A file as a key holds it: its text, when it reads as text, else the file itself, sent as is. */
const readKeyFile = async (file) => {
    if (file.size === 0) return {text: ""};
    // Read by a FileReader where a file has no arrayBuffer of its own.
    const bytes = typeof file.arrayBuffer === "function"
        ? await file.arrayBuffer()
        : await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    const parsed = await parseBlobContent({arrayBuffer: async () => bytes});
    return parsed.type === "text" ? {text: parsed.content} : {file};
};

/**
 * The form of a key, to create or to update it. Its content is typed or pasted in
 * place, or read from a file dropped on it or browsed for: a text file in place, to
 * edit before sending, a binary one shown by its name and sent as is. Empty, the key
 * is empty. The name of a new key is that of the file, when not typed first.
 *
 * `hidden` is why the content of the key to update is not in the form: "secret", a
 * secret is never read back; "binary", it does not read as text; "unread", it could
 * not be read. The update then waits for new content: an empty form never empties
 * a key it does not show. `maxSize`, the largest key the API takes, in bytes: a
 * larger one is said, and not sent.
 */
const KeyFormDialog = ({
                           open,
                           onClose,
                           onSubmit,
                           mode,
                           initialName = "",
                           initialContent = "",
                           hidden = null,
                           title,
                           loading = false,
                           initialLoading = false,
                           maxSize = null,
                           onRemove,
                       }) => {
    const {t, i18n} = useTranslation();
    const [name, setName] = useState(initialName);
    const [text, setText] = useState(initialContent);
    const [file, setFile] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const browse = useRef(null);
    const hintId = useId();

    useEffect(() => {
        if (open) {
            setName(initialName);
            setText(initialContent);
            setFile(null);
            setDragOver(false);
            setFullscreen(false);
        }
    }, [open, initialName, initialContent]);

    const load = async (picked) => {
        if (!picked) return;
        if (mode === "create" && !name) setName(picked.name);
        const read = await readKeyFile(picked);
        setFile(read.file ?? null);
        if (read.text !== undefined) setText(read.text);
    };

    const size = file ? file.size : new TextEncoder().encode(text).length;
    const tooLarge = maxSize !== null && size > maxSize;
    // The content of the key not shown: new content, typed or from a file, to update it.
    const waiting = hidden !== null && file === null && text === "";

    const handleSubmit = () => {
        if (!name || tooLarge || waiting) return;
        const contentBlob = file ?? new Blob([text], {type: "application/octet-stream"});
        onSubmit({name, contentBlob});
    };

    const close = () => {
        onClose();
        setFullscreen(false);
    };

    const placeholder = hidden === "secret"
        ? t("keys.form.hiddenSecret")
        : hidden === "binary" ? t("keys.form.hiddenBinary")
            : hidden === "unread" ? t("keys.form.hiddenUnread") : t("keys.form.contentPlaceholder");

    const sizeLine = (
        <p className={tooLarge ? "text-data text-state-down" : "text-data text-ink-muted"} aria-live="polite">
            {tooLarge
                ? t("keys.form.tooLarge", {size: t("keys.bytes", {size}), max: formatKeyLimit(maxSize, i18n.language)})
                : maxSize !== null
                    ? t("keys.form.sizeOfMax", {size: t("keys.bytes", {size}), max: formatKeyLimit(maxSize, i18n.language)})
                    : t("keys.bytes", {size})}
        </p>
    );

    // The content, typed in place or dropped on it; a binary file in its place, by its name.
    const content = (
        <div
            onDragOver={(e) => {
                e.preventDefault();
                if (!loading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!loading) void load(e.dataTransfer?.files?.[0]);
            }}
            data-drop-zone=""
            data-drag-over={dragOver ? "" : undefined}
            className={dragOver
                ? "relative rounded-(--radius-control) outline-2 outline-dashed outline-accent"
                : "relative rounded-(--radius-control)"}
        >
            {file ? (
                <div className="flex min-h-24 items-center gap-2 rounded-(--radius-control) border border-line bg-surface-sunken px-3">
                    <span className="font-mono">{file.name}</span>
                    <span className="text-ink-muted">· {t("keys.bytes", {size: file.size})} · {t("keys.form.binary")}</span>
                    <IconButton
                        size="sm"
                        className="ml-auto"
                        label={t("keys.form.dropFile")}
                        onClick={() => setFile(null)}
                        disabled={loading}
                    >
                        <CloseIcon/>
                    </IconButton>
                </div>
            ) : (
                <Textarea
                    aria-label={t("keys.form.content")}
                    aria-describedby={hintId}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={loading}
                    placeholder={placeholder}
                    spellCheck={false}
                    rows={fullscreen ? 24 : 8}
                    className={fullscreen ? "h-[60vh] resize-none font-mono text-data" : "resize-y font-mono text-data"}
                />
            )}
            {dragOver && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-(--radius-control) bg-accent-soft/80 font-medium text-accent">
                    {t("keys.form.dropHere")}
                </div>
            )}
        </div>
    );

    return (
        <Dialog
            open={open}
            onClose={close}
            title={title}
            size={fullscreen ? "lg" : "md"}
            footer={
                <>
                    {/* The key edited, removed from here: the confirmation in the place of this dialog. */}
                    {onRemove && (
                        <Button variant="delete" className="mr-auto" onClick={onRemove} disabled={loading}>
                            {t("common.remove")}
                        </Button>
                    )}
                    <Button onClick={close} disabled={loading}>{t("common.cancel")}</Button>
                    <Button
                        variant={mode === 'create' ? "create" : "secondary"}
                        onClick={handleSubmit}
                        disabled={loading || initialLoading || !name || tooLarge || waiting}
                    >
                        {mode === 'create' ? t("keys.form.create") : t("keys.form.update")}
                    </Button>
                </>
            }
        >
            {initialLoading ? (
                <div className="flex justify-center p-6">
                    <Spinner label={t("keys.loadingContent")}/>
                </div>
            ) : (
                <div className="space-y-2">
                    {!fullscreen && (
                        <Field label={t("keys.form.name")}>
                            {(control) => (
                                <Input
                                    {...control}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    disabled={loading}
                                />
                            )}
                        </Field>
                    )}
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{t("keys.form.content")}</span>
                        {!file && (
                            <Button size="sm" onClick={() => setFullscreen((f) => !f)}>
                                {fullscreen ? t("keys.form.exitFullScreen") : t("keys.form.fullScreen")}
                            </Button>
                        )}
                    </div>
                    {content}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p id={hintId} className="text-data text-ink-muted">
                            {t("keys.form.dropHint")}{" "}
                            <button
                                type="button"
                                className="text-accent underline-offset-2 hover:underline disabled:opacity-60"
                                onClick={() => browse.current?.click()}
                                disabled={loading}
                            >
                                {t("keys.form.browse")}
                            </button>
                        </p>
                        {sizeLine}
                    </div>
                    <input
                        ref={browse}
                        type="file"
                        className="sr-only"
                        tabIndex={-1}
                        aria-label={t("keys.form.browse")}
                        data-testid="key-file-input"
                        onChange={(e) => {
                            void load(e.target.files?.[0]);
                            e.target.value = "";
                        }}
                        disabled={loading}
                    />
                </div>
            )}
        </Dialog>
    );
};

/** The checkbox selecting all the keys: mixed when some of them only are checked. */
const SelectAll = ({all, some, onChange, label}) => {
    const box = useRef(null);
    useEffect(() => {
        if (box.current) box.current.indeterminate = some;
    }, [some]);
    return <Checkbox ref={box} checked={all} onChange={(e) => onChange(e.target.checked)} aria-label={label}/>;
};

/**
 * The keys of a cfg, sec or usr object. `refreshKey` changes with its configuration
 * (InstanceConfigUpdated): the keys are read again, a key added in the file, or by
 * om, listed without reopening the panel, kept mounted under its other tabs.
 */
const KeysSection = ({decodedObjectName, openSnackbar, refreshKey}) => {
    const {t} = useTranslation();
    const {kind} = parseObjectPath(decodedObjectName);
    // A usr key, a password or a private key, is masked as a sec one.
    const isSecret = kind === "sec" || kind === "usr";
    const showKeys = KEY_KINDS.includes(kind);

    const [keys, setKeys] = useState([]);
    const [keysLoading, setKeysLoading] = useState(false);
    const [keysError, setKeysError] = useState(null);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
    const [viewDialogOpen, setViewDialogOpen] = useState(false);
    // The keys to delete once confirmed: the one of a line or of its dialog, or the keys checked.
    const [keysToDelete, setKeysToDelete] = useState([]);
    const [picked, setPicked] = useState([]);
    // The order of the list: by name at first; by size, the largest first.
    const [sort, setSort] = useState({by: "name", direction: "asc"});
    const sortBy = (by) => setSort((current) => (current.by === by
        ? {by, direction: current.direction === "asc" ? "desc" : "asc"}
        : {by, direction: by === "size" ? "desc" : "asc"}));
    const [keyToView, setKeyToView] = useState(null);
    const [keyViewContent, setKeyViewContent] = useState(null);
    // The certificates of the key shown decoded, in the place of its text.
    const [showCertificate, setShowCertificate] = useState(false);
    const [keyViewLoading, setKeyViewLoading] = useState(false);
    const [revealSecret, setRevealSecret] = useState(false);
    // A revealed secret is masked again on its own after a few seconds.
    const secondsLeft = useAutoHide(revealSecret, () => setRevealSecret(false));
    const [actionLoading, setActionLoading] = useState(false);

    const [updateInitialName, setUpdateInitialName] = useState("");
    const [updateInitialContent, setUpdateInitialContent] = useState("");
    // Why the content of the key to update is not in its form: "secret", "binary" or "unread".
    const [updateHidden, setUpdateHidden] = useState(null);
    // The last update form opened: the content read for one before it, arriving late, is dropped.
    const updateRequest = useRef(0);
    const maxKeySize = useMaxKeySize(createDialogOpen || updateDialogOpen);
    const [updateContentLoading, setUpdateContentLoading] = useState(false);
    const titleId = useId();

    const fetchKeys = useCallback(async () => {
        const {kind} = parseObjectPath(decodedObjectName);
        if (!KEY_KINDS.includes(kind)) {
            setKeys([]);
            return;
        }

        const token = getAuthToken();
        if (!token) {
            setKeysError(t("keys.errors.noToken"));
            return;
        }

        setKeysLoading(true);
        setKeysError(null);
        try {
            const baseUrl = buildObjectUrl(decodedObjectName);
            const url = `${baseUrl}/data/keys`;
            const response = await fetch(url, {
                headers: {Authorization: `Bearer ${token}`},
                cache: "no-cache",
            });
            if (!response.ok) {
                const errorMessage = await formatResponseError(response, t("keys.errors.fetchKeys", {status: response.status}));
                setKeysError(errorMessage);
                openSnackbar(errorMessage, "error");
                return;
            }
            const data = await response.json();
            setKeys(data.items || []);
        } catch (err) {
            logger.error(`💥 [fetchKeys] Error: ${err.message}`);
            setKeysError(err.message);
        } finally {
            setKeysLoading(false);
        }
    }, [decodedObjectName, openSnackbar, t]);

    const fetchKeyContent = useCallback(async (keyName) => {
        const token = getAuthToken();
        if (!token) {
            openSnackbar(t("keys.errors.noToken"), "error");
            return {type: 'error', content: null};
        }

        try {
            const baseUrl = buildObjectUrl(decodedObjectName);
            const url = `${baseUrl}/data/key?name=${encodeURIComponent(keyName)}`;
            const response = await fetch(url, {
                headers: {Authorization: `Bearer ${token}`},
            });
            if (!response.ok) {
                const errorMessage = await formatResponseError(response, t("keys.errors.fetchContent", {status: response.status}));
                openSnackbar(errorMessage, "error");
                return {type: 'error', content: null};
            }

            let blob;
            if (typeof response.blob === 'function') {
                blob = await response.blob();
            } else {
                const text = await response.text();
                blob = new Blob([text], {type: 'text/plain'});
            }
            // The bytes kept too, for the key to be saved as it is stored.
            return {...(await parseBlobContent(blob)), blob};
        } catch (err) {
            openSnackbar(t("keys.errors.generic", {message: err.message}), "error");
            return {type: 'error', content: null};
        }
    }, [decodedObjectName, openSnackbar, t]);

    /** A key written, as the actions tray says it. */
    const keyWrite = (kind, key) => ({
        action: "config", label: t(`actionTray.writes.${kind}`, {key}), subject: decodedObjectName, path: decodedObjectName,
    });

    /** Deletes the keys confirmed, one after the other, each said in the actions tray: one refused, the others still go. */
    const handleDeleteKey = async () => {
        if (keysToDelete.length === 0) return;
        const token = getAuthToken();
        if (!token) {
            openSnackbar(t("keys.errors.noToken"), "error");
            setDeleteDialogOpen(false);
            return;
        }

        // What came of each key, the actions tray says.
        setActionLoading(true);
        try {
            const baseUrl = buildObjectUrl(decodedObjectName);
            const deleted = [];
            for (const name of keysToDelete) {
                const write = keyWrite("keyDelete", name);
                try {
                    const response = await fetch(`${baseUrl}/data/key?name=${encodeURIComponent(name)}`, {
                        method: "DELETE",
                        headers: {Authorization: `Bearer ${token}`},
                    });
                    if (await trackWrite(response, write, keyRefusal)) deleted.push(name);
                } catch (err) {
                    trackRefused({...write, reason: err.message});
                }
            }
            setPicked((l) => l.filter((name) => !deleted.includes(name)));
            await fetchKeys();
        } finally {
            setActionLoading(false);
            setDeleteDialogOpen(false);
            setKeysToDelete([]);
        }
    };

    const handleCreateKey = async ({name, contentBlob}) => {
        const token = getAuthToken();
        if (!token) {
            openSnackbar(t("keys.errors.noToken"), "error");
            setCreateDialogOpen(false);
            return;
        }

        // What came of it, the actions tray says.
        setActionLoading(true);
        const write = keyWrite("keyCreate", name);
        try {
            const baseUrl = buildObjectUrl(decodedObjectName);
            const response = await fetch(`${baseUrl}/data/key?name=${encodeURIComponent(name)}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/octet-stream",
                },
                body: contentBlob,
            });
            if (await trackWrite(response, write, keyRefusal)) await fetchKeys();
        } catch (err) {
            trackRefused({...write, reason: err.message});
        } finally {
            setActionLoading(false);
            setCreateDialogOpen(false);
        }
    };

    const handleUpdateKey = async ({name, contentBlob}) => {
        const token = getAuthToken();
        if (!token) {
            openSnackbar(t("keys.errors.noToken"), "error");
            setUpdateDialogOpen(false);
            return;
        }

        // What came of it, the actions tray says.
        setActionLoading(true);
        const write = keyWrite("keyUpdate", name);
        try {
            const baseUrl = buildObjectUrl(decodedObjectName);
            const response = await fetch(`${baseUrl}/data/key?name=${encodeURIComponent(name)}`, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/octet-stream",
                },
                body: contentBlob,
            });
            if (await trackWrite(response, write, keyRefusal)) await fetchKeys();
        } catch (err) {
            trackRefused({...write, reason: err.message});
        } finally {
            setActionLoading(false);
            setUpdateDialogOpen(false);
        }
    };

    const handleViewKey = async (keyName) => {
        setKeyToView(keyName);
        setKeyViewLoading(true);
        setViewDialogOpen(true);
        setKeyViewContent(null);
        setShowCertificate(false);
        setRevealSecret(false);

        const result = await fetchKeyContent(keyName);
        if (result.type !== 'error') {
            setKeyViewContent(result);
            // Asked for, the value shows at once; the timer masks it again.
            setRevealSecret(true);
        } else {
            setViewDialogOpen(false);
        }
        setKeyViewLoading(false);
    };

    // A key holding PEM certificates, a chain or one with its private key, offers to decode them.
    const isCertificate = keyViewContent?.type === "text" && hasPemCertificate(keyViewContent.content);

    // Closed, a revealed value is masked: it is not shown again on reopening before it is read.
    const closeViewDialog = () => {
        setViewDialogOpen(false);
        setRevealSecret(false);
    };

    const openUpdateDialog = async (keyName) => {
        const request = ++updateRequest.current;
        setUpdateInitialName(keyName);
        setUpdateDialogOpen(true);
        setUpdateInitialContent("");
        setUpdateHidden(null);

        if (isSecret) {
            // Never fetch secret content to the client: the form says it waits for new content.
            setUpdateHidden("secret");
            setUpdateContentLoading(false);
            return;
        }

        setUpdateContentLoading(true);
        const result = await fetchKeyContent(keyName);
        if (request !== updateRequest.current) return;
        if (result.type === "text") {
            setUpdateInitialContent(result.content);
        } else if (result.type === "binary") {
            setUpdateHidden("binary");
        } else {
            // Not read: the form shows none of it, and waits for new content to replace it.
            setUpdateHidden("unread");
        }
        setUpdateContentLoading(false);
    };

    useEffect(() => {
        if (getAuthToken()) {
            fetchKeys().catch((error) => {
                logger.error("Error in fetchKeys:", error);
            });
        }
    }, [decodedObjectName, fetchKeys, refreshKey]);

    if (!showKeys) return null;

    const hasKeysError = Boolean(keysError);
    const safeKeys = Array.isArray(keys) ? keys : [];
    const sortedKeys = [...safeKeys].sort((a, b) => {
        const order = sort.by === "size"
            ? (a.size ?? 0) - (b.size ?? 0) || a.name.localeCompare(b.name)
            : a.name.localeCompare(b.name);
        return sort.direction === "asc" ? order : -order;
    });
    // A key gone is no longer checked.
    const pickedKeys = picked.filter((name) => safeKeys.some((key) => key.name === name));
    const togglePicked = (name) => setPicked((l) => (l.includes(name) ? l.filter((n) => n !== name) : [...l, name]));

    return (
        <section
            aria-labelledby={titleId}
            className="rounded-(--radius-panel) border border-line bg-surface-raised"
        >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <KeyIcon className="text-ink-muted"/>
                <h2 id={titleId} className="font-semibold">
                    {t("keys.title", {total: safeKeys.length})}
                </h2>
                {/* Nothing checked, the help says how; the keys checked, their removal. */}
                <div className="ml-auto flex items-center">
                    {!keysLoading && !hasKeysError && safeKeys.length > 0 && (pickedKeys.length > 0 ? (
                        <Button
                            size="sm"
                            variant="delete"
                            icon={<TrashIcon/>}
                            disabled={actionLoading}
                            onClick={() => {
                                setKeysToDelete(pickedKeys);
                                setDeleteDialogOpen(true);
                            }}
                        >
                            {t("keys.removeSelected", {count: pickedKeys.length})}
                        </Button>
                    ) : (
                        <p className="text-data text-ink-muted">{t("keys.selectionHelp")}</p>
                    ))}
                </div>
                {kind === "sec" && (
                    <SecCertificate
                        path={decodedObjectName}
                        keyNames={safeKeys.map((key) => key.name)}
                        disabled={actionLoading || keysLoading}
                        onWritten={fetchKeys}
                    />
                )}
                <IconButton
                    label={t("keys.add")}
                    text={t("common.add")}
                    solid
                    onClick={() => setCreateDialogOpen(true)}
                    disabled={actionLoading}
                >
                    <PlusIcon/>
                </IconButton>
            </div>

            {(keysLoading || hasKeysError || safeKeys.length === 0) && (
                <div className="space-y-2 p-3">
                    {keysLoading && <Spinner label={t("keys.loading")}/>}
                    {hasKeysError && <Alert>{String(keysError)}</Alert>}
                    {!keysLoading && !hasKeysError && safeKeys.length === 0 && (
                        <p className="text-ink-muted">{t("keys.empty")}</p>
                    )}
                </div>
            )}
            {!keysLoading && !hasKeysError && safeKeys.length > 0 && (
                <Table aria-label={t("keys.tableAria")} className="rounded-none border-0">
                    <thead>
                    <HeaderRow>
                        <HeaderCell className="w-8">
                            <SelectAll
                                all={pickedKeys.length === safeKeys.length}
                                some={pickedKeys.length > 0 && pickedKeys.length < safeKeys.length}
                                onChange={(checked) => setPicked(checked ? safeKeys.map((key) => key.name) : [])}
                                label={t("keys.selectAll")}
                            />
                        </HeaderCell>
                        <SortHeaderCell
                            label={t("common.name")}
                            active={sort.by === "name"}
                            direction={sort.direction}
                            onSort={() => sortBy("name")}
                        />
                        <SortHeaderCell
                            label={t("keys.size")}
                            active={sort.by === "size"}
                            direction={sort.direction}
                            onSort={() => sortBy("size")}
                        />
                    </HeaderRow>
                    </thead>
                    <tbody>
                    {sortedKeys.map((key) => (
                        // The line shows the content of its key; its tools edit and delete it.
                        <Row
                            key={key.name}
                            onActivate={actionLoading ? undefined : () => handleViewKey(key.name)}
                            title={t("keys.view.action", {key: key.name})}
                            selected={pickedKeys.includes(key.name)}
                        >
                            <Cell className="w-8">
                                <Checkbox
                                    checked={pickedKeys.includes(key.name)}
                                    onChange={() => togglePicked(key.name)}
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label={t("keys.selectKey", {key: key.name})}
                                />
                            </Cell>
                            <th scope="row" className="px-2 py-1 text-left font-normal">
                                {key.name}
                            </th>
                            <Cell numeric className="whitespace-nowrap">{t("keys.bytes", {size: key.size})}</Cell>
                        </Row>
                    ))}
                    </tbody>
                </Table>
            )}

            <Dialog
                open={viewDialogOpen}
                onClose={closeViewDialog}
                title={t("keys.view.title", {key: keyToView ?? ""})}
                size="lg"
                footer={
                    // The key shown, edited or removed from here: its dialog then in the place of this one.
                    <>
                        <Button
                            variant="delete"
                            className="mr-auto"
                            disabled={actionLoading || keyToView === null}
                            onClick={() => {
                                const name = keyToView;
                                closeViewDialog();
                                setKeysToDelete([name]);
                                setDeleteDialogOpen(true);
                            }}
                        >
                            {t("common.remove")}
                        </Button>
                        <Button
                            disabled={actionLoading || keyToView === null}
                            onClick={() => {
                                const name = keyToView;
                                closeViewDialog();
                                openUpdateDialog(name);
                            }}
                        >
                            {t("common.edit")}
                        </Button>
                        <Button onClick={closeViewDialog}>{t("common.close")}</Button>
                    </>
                }
            >
                {keyViewLoading && (
                    <div className="flex justify-center p-6">
                        <Spinner label={t("keys.loadingContent")}/>
                    </div>
                )}
                {!keyViewLoading && keyViewContent && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-data text-ink-muted">
                                {keyViewContent.type === "text" ? t("keys.view.typeText") : t("keys.view.typeBinary")}
                                {isSecret && revealSecret && ` · ${t("keys.view.maskedAgain", {count: secondsLeft})}`}
                            </p>
                            <div className="flex items-center gap-1">
                                {isCertificate && (
                                    <Button size="sm" onClick={() => setShowCertificate((shown) => !shown)}>
                                        {showCertificate ? t("keys.view.showContent") : t("keys.view.decodeCertificate")}
                                    </Button>
                                )}
                                {/* A secret copied masked too: pasted where needed, never shown. */}
                                {keyViewContent.type === "text" && (
                                    <CopyButton text={keyViewContent.content} label={t("keys.view.copy")}/>
                                )}
                                {keyViewContent.blob && (
                                    <IconButton
                                        size="sm"
                                        label={t("keys.view.download")}
                                        onClick={() => downloadKey(keyToView, keyViewContent.blob)}
                                    >
                                        <DownloadIcon/>
                                    </IconButton>
                                )}
                                {isSecret && (
                                    <IconButton
                                        size="sm"
                                        label={revealSecret ? t("keys.view.hide") : t("keys.view.reveal")}
                                        onClick={() => setRevealSecret(v => !v)}
                                    >
                                        {revealSecret ? <EyeOffIcon/> : <EyeIcon/>}
                                    </IconButton>
                                )}
                            </div>
                        </div>
                        {/* A certificate is public: decoded, it is shown even with the secret masked. */}
                        {isCertificate && showCertificate ? (
                            <CertificateDetails text={keyViewContent.content}/>
                        ) : isSecret && !revealSecret ? (
                            <div className="flex flex-col items-center gap-1 rounded-(--radius-control) border border-dashed border-line bg-surface-sunken p-6 text-center text-ink-muted">
                                <LockIcon/>
                                <p>{t("keys.view.hidden")}</p>
                                <p>{t("keys.view.revealHint")}</p>
                            </div>
                        ) : (
                            <Textarea
                                aria-label={t("keys.view.contentAria")}
                                readOnly
                                value={keyViewContent.content}
                                rows={16}
                                className="resize-y font-mono text-data"
                            />
                        )}
                    </div>
                )}
            </Dialog>

            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                title={t("keys.deleteDialog.title")}
                footer={
                    <>
                        <Button onClick={() => setDeleteDialogOpen(false)} disabled={actionLoading}>{t("common.cancel")}</Button>
                        <Button
                            variant="delete"
                            icon={<TrashIcon/>}
                            onClick={handleDeleteKey}
                            disabled={actionLoading}
                        >
                            {t("common.delete")}
                        </Button>
                    </>
                }
            >
                <p>
                    <Trans
                        i18nKey={keysToDelete.length > 1 ? "keys.deleteDialog.messageMany" : "keys.deleteDialog.message"}
                        values={keysToDelete.length > 1
                            ? {count: keysToDelete.length, list: keysToDelete.join(", ")}
                            : {key: keysToDelete[0]}}
                        components={{strong: <strong className="font-mono"/>}}
                    />
                </p>
            </Dialog>

            <KeyFormDialog
                open={createDialogOpen}
                onClose={() => setCreateDialogOpen(false)}
                onSubmit={handleCreateKey}
                mode="create"
                title={t("keys.form.createTitle")}
                loading={actionLoading}
                maxSize={maxKeySize}
            />

            <KeyFormDialog
                open={updateDialogOpen}
                onClose={() => setUpdateDialogOpen(false)}
                onSubmit={handleUpdateKey}
                mode="update"
                initialName={updateInitialName}
                initialContent={updateInitialContent}
                hidden={updateHidden}
                title={t("keys.form.updateTitle")}
                loading={actionLoading}
                maxSize={maxKeySize}
                initialLoading={updateContentLoading}
                onRemove={() => {
                    setUpdateDialogOpen(false);
                    setKeysToDelete([updateInitialName]);
                    setDeleteDialogOpen(true);
                }}
            />
        </section>
    );
};

export default KeysSection;
