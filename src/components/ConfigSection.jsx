import React, {useState, useEffect, useRef, useMemo, useReducer, useCallback} from "react";
import {Dialog} from "../ui/components/Dialog";
import {Button, IconButton} from "../ui/components/Button";
import {Checkbox, Textarea} from "../ui/components/Field";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {CodeIcon, EyeIcon, EyeOffIcon, FileIcon, PencilIcon, SlidersIcon, UploadIcon} from "../ui/icons";
import {formatSeconds, useAutoHide} from "../ui/lib/reveal";
import {URL_OBJECT} from "../config/apiPath.js";
import {parseObjectPath} from "../utils/objectUtils";
import {useTranslation} from "react-i18next";
import {ConfigText} from "./ConfigText";
import {CopyButton} from "../ui/components/CopyButton";
import {extractSection, replaceSection} from "../utils/configSections";
import {trackRefused, trackWrite} from "../app/action-tracker";
import {PROBLEM_TITLE_HELD, forceLifts, readProblem, withWriteParams} from "../app/config-write";
import {useIsRoot} from "../hooks/useGrants";
import {ForceRefusal} from "./ConfigWriteControls";
import ConfigEvalDialog from "./ConfigEvalDialog";
import useEventStore from "../hooks/useEventStore.js";
import {newId, withId} from "../app/object-create";
import {designChanges, designStart, parseDesign, rootOnlyKind} from "../app/object-design";
import {ObjectDesigner} from "./ObjectDesigner";
import {useEditDraft} from "../app/edit-drafts";

/**
 * The object configuration file, its secrets redacted unless `showSecrets`: the
 * object endpoint takes `redact-secrets` (the instance endpoint ignores it), and
 * forwards the request to a node holding an instance when the one answering has none.
 */
const useConfig = (decodedObjectName, configNode, setConfigNode, refreshTrigger, showSecrets = false) => {
    const initialState = {
        data: null,
        loading: false,
        error: null,
    };
    const reducer = (state, action) => {
        switch (action.type) {
            case "FETCH_START":
                return {...state, loading: true, error: null};
            case "FETCH_SUCCESS":
                return {...state, loading: false, data: action.payload};
            case "FETCH_ERROR":
                return {...state, loading: false, error: action.payload};
            case "RESET":
                return initialState;
            /* istanbul ignore next */
            default:
                return state;
        }
    };
    const {t} = useTranslation();
    const [state, dispatch] = useReducer(reducer, initialState);
    const lastFetch = useRef({});
    // The read in flight: a newer one aborts it, and its answer, late, is dropped. A
    // revealed config answering after a hide must not be shown as hidden.
    const inFlight = useRef(null);

    const fetchConfig = useCallback(async (node, forceBypassThrottle = false) => {
        /* istanbul ignore next */
        if (!node) {
            dispatch({type: "RESET"});
            return;
        }
        // The redaction is part of the key: switching it must not be throttled away.
        const key = `${decodedObjectName}:${node}:${showSecrets}`;
        const now = Date.now();
        if (!forceBypassThrottle && lastFetch.current[key] && now - lastFetch.current[key] < 1000) return;
        lastFetch.current[key] = now;
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        const token = localStorage.getItem("authToken") || "";
        inFlight.current?.abort();
        const controller = new AbortController();
        inFlight.current = controller;
        const superseded = () => inFlight.current !== controller;
        dispatch({type: "FETCH_START"});
        setConfigNode(node);
        try {
            const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file?redact-secrets=${!showSecrets}`, {
                headers: {Authorization: `Bearer ${token}`},
                cache: "no-cache",
                signal: controller.signal,
            });
            if (superseded()) return;
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                dispatch({type: "FETCH_ERROR", payload: t("config.errors.fetchConfig", {message: error.message})});
                return;
            }
            const text = await response.text();
            if (superseded()) return;
            dispatch({type: "FETCH_SUCCESS", payload: text});
        } catch (err) {
            if (superseded()) return;
            dispatch({type: "FETCH_ERROR", payload: t("config.errors.fetchConfig", {message: err.message})});
        }
    }, [decodedObjectName, setConfigNode, showSecrets, t]);

    // Gone, the read in flight is of no use.
    useEffect(() => () => {
        inFlight.current?.abort();
        inFlight.current = null;
    }, []);

    // Showing or hiding the secrets always reloads, throttle or not, and drops the
    // text first: a revealed secret must not stay on screen while hiding them.
    const prevShowSecrets = useRef(showSecrets);
    useEffect(() => {
        const secretsToggled = prevShowSecrets.current !== showSecrets;
        prevShowSecrets.current = showSecrets;
        if (secretsToggled) dispatch({type: "RESET"});
        if (configNode) {
            void fetchConfig(configNode, secretsToggled);
        } else {
            dispatch({type: "RESET"});
        }
    }, [configNode, decodedObjectName, fetchConfig, showSecrets]);

    const prevRefreshTrigger = useRef(refreshTrigger);
    useEffect(() => {
        if (refreshTrigger === prevRefreshTrigger.current) return;
        prevRefreshTrigger.current = refreshTrigger;
        if (configNode) {
            void fetchConfig(configNode, true);
        }
    }, [refreshTrigger, configNode, fetchConfig]);

    return {...state, fetchConfig};
};

/** The configuration file of an object as stored, its secrets in clear, for editing. */
const fetchRawConfigFile = async (decodedObjectName) => {
    const {namespace, kind, name} = parseObjectPath(decodedObjectName);
    const token = localStorage.getItem("authToken") || "";
    const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file?redact-secrets=false`, {
        headers: {Authorization: `Bearer ${token}`},
        cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
};

/** What the daemon says of a refused request: the detail of its problem, else the status. */
const problemMessage = async (response) => {
    try {
        const problem = await response.json();
        if (problem?.detail) return problem.detail;
    } catch {
        // Not a problem document: the status says enough.
    }
    return `HTTP ${response.status}`;
};

/** A refusal in words, for the actions tray: its status, and the detail the daemon gave. */
const refusal = async (response) => {
    const message = await problemMessage(response);
    return message.startsWith("HTTP ") ? message : `HTTP ${response.status} ${message}`;
};

/**
 * File picker: the native input, hidden but focusable, behind a label drawn as a
 * secondary button; the chosen file name beside it.
 */
const FilePicker = ({id, file, onChange, disabled, emptyText}) => {
    const {t} = useTranslation();
    return (
    <div className="flex items-center gap-3">
        <input
            id={id}
            type="file"
            className="peer sr-only"
            onChange={(e) => onChange(e.target.files[0])}
            disabled={disabled}
        />
        <label
            htmlFor={id}
            className={
                disabled
                    ? "inline-flex h-8 items-center rounded-(--radius-control) border border-line bg-surface-raised px-3 font-medium opacity-60"
                    : "inline-flex h-8 cursor-pointer items-center rounded-(--radius-control) border border-line bg-surface-raised px-3 font-medium hover:bg-surface-sunken peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus-ring)"
            }
        >
            {t("config.filePicker.choose")}
        </label>
        <span className={file ? "text-ink" : "text-ink-muted"}>{file ? file.name : emptyText}</span>
    </div>
    );
};

// `refused`, why the daemon refused the file, written anyway on demand when force
// lifts it. The write waits for the configuration to reach the nodes (withWriteParams).
const UpdateConfigDialog = ({
                                open,
                                onClose,
                                newConfigFile,
                                setNewConfigFile,
                                actionLoading,
                                handleUpdateConfig,
                                refused,
                                isRoot,
                            }) => {
    const {t} = useTranslation();
    return (
    <Dialog
        open={open}
        onClose={onClose}
        title={t("config.update.title")}
        size="md"
        footer={
            <>
                <Button onClick={onClose} disabled={actionLoading}>{t("common.cancel")}</Button>
                <Button
                    onClick={() => handleUpdateConfig()}
                    disabled={actionLoading || !newConfigFile}
                    icon={actionLoading ? <Spinner label={t("config.update.updating")}/> : undefined}
                >
                    {t("config.update.submit")}
                </Button>
            </>
        }
    >
        <div className="space-y-3">
            <FilePicker
                id="update-config-file-upload"
                file={newConfigFile}
                onChange={setNewConfigFile}
                disabled={actionLoading}
                emptyText={t("config.filePicker.noFile")}
            />
            <ForceRefusal
                messages={refused?.messages}
                lifts={refused?.lifts}
                isRoot={isRoot}
                onForce={() => handleUpdateConfig(true)}
                disabled={actionLoading}
            />
        </div>
    </Dialog>
    );
};

/**
 * The configuration changed in the designer, seeded with the file as stored: its
 * sections on the left, the keywords of the one picked on the right, each
 * documented. Applied, the changes made, in one request; refused, the daemon's
 * words, the design kept, written anyway on demand when force lifts the refusal.
 */
const DesignConfigDialog = ({
                                open,
                                onClose,
                                kind,
                                namespace,
                                keywordsUrl,
                                design,
                                onChange,
                                loading,
                                error,
                                changes,
                                actionLoading,
                                onSubmit,
                                refused,
                                isRoot,
                            }) => {
    const {t} = useTranslation();
    // Root's choice of the keywords only root may set, by the buttons.
    const [showRoot, setShowRoot] = useState(false);
    const lines = [
        ...changes.delete.map((section) => t("actionTray.writes.deleteSection", {section})),
        ...changes.unset.map((keyword) => t("actionTray.writes.unset", {keyword})),
        ...changes.set.map(({keyword, value}) => t("actionTray.writes.set", {keyword, value})),
    ];
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t("config.design.title")}
            size="xl"
            // Changes designed: not lost to an Escape, in the search of a picker or anywhere.
            dirty={changes.set.length + changes.unset.length + changes.delete.length > 0}
            footer={
                <>
                    <div className="mr-auto self-center">
                        {/* No choice where every keyword is root's: the cluster configuration. */}
                        {isRoot && !rootOnlyKind(kind) && <Checkbox label={t("objectDesigner.showRoot")} checked={showRoot} onChange={(e) => setShowRoot(e.target.checked)}/>}
                    </div>
                    <Button onClick={onClose} disabled={actionLoading}>{t("common.cancel")}</Button>
                    <Button
                        onClick={() => onSubmit()}
                        disabled={actionLoading || lines.length === 0}
                        icon={actionLoading ? <Spinner label={t("config.design.applying")}/> : undefined}
                    >
                        {lines.length === 0 ? t("config.design.noChange") : t("config.design.apply", {count: lines.length})}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                {loading && <Spinner label={t("config.design.loading")}/>}
                {/* Refused, nothing written: why, the design kept, forced on demand when force lifts it. */}
                <ForceRefusal
                    messages={refused?.messages}
                    lifts={refused?.lifts}
                    isRoot={isRoot}
                    onForce={() => onSubmit(true)}
                    disabled={actionLoading}
                />
                {error && <Alert>{error}</Alert>}
                {design && (
                    <ObjectDesigner
                        kind={kind}
                        namespace={namespace}
                        sections={design}
                        onChange={onChange}
                        keywordsUrl={keywordsUrl}
                        isRoot={isRoot}
                        showRoot={showRoot}
                        onShowRoot={setShowRoot}
                    />
                )}
                {/* The changes applied, as the actions tray will say them. */}
                {lines.length > 0 && (
                    <section aria-label={t("config.design.changes")} className="rounded-(--radius-panel) border border-line bg-surface-sunken p-2">
                        <h3 className="mb-1 font-semibold">{t("config.design.changes")}</h3>
                        <ul className="space-y-0.5 font-mono text-data">
                            {lines.map((line, i) => <li key={i} className="break-all">{line}</li>)}
                        </ul>
                    </section>
                )}
            </div>
        </Dialog>
    );
};

const ConfigSection = ({
                           decodedObjectName,
                           configNode,
                           setConfigNode,
                           openSnackbar,
                           configDialogOpen,
                           setConfigDialogOpen,
                           configRefreshTrigger = 0,
                           inline = false,
                           section = null,
                           absent: absentProp = false,
                       }) => {
    const {t} = useTranslation();
    // `absent`, the object has no configuration yet: the file starts empty, and the
    // first change written creates the object with it. Created, it is written as any.
    const [created, setCreated] = useState(false);
    const absent = absentProp && !created;
    // Secrets stay hidden until asked for, and hidden again each time the dialog opens.
    const [showSecrets, setShowSecrets] = useState(false);
    useEffect(() => {
        if (configDialogOpen) setShowSecrets(false);
    }, [configDialogOpen]);
    // Shown secrets are masked again on their own after a few seconds.
    const secondsLeft = useAutoHide(showSecrets, () => setShowSecrets(false));
    const {data: configData, loading: configLoading, error: configError, fetchConfig} = useConfig(
        decodedObjectName,
        configNode,
        setConfigNode,
        configRefreshTrigger,
        showSecrets,
    );

    const [updateConfigDialogOpen, setUpdateConfigDialogOpen] = useState(false);
    // The keywords evaluated, as on a node of the object (om config eval --impersonate).
    const [evalOpen, setEvalOpen] = useState(false);
    const scope = useEventStore((s) => s.objectStatus?.[decodedObjectName]?.scope);
    const [newConfigFile, setNewConfigFile] = useState(null);
    // Why the daemon refused the file uploaded, and who may write it anyway.
    const [uploadRefused, setUploadRefused] = useState(null);
    const [manageParamsDialogOpen, setManageParamsDialogOpen] = useState(false);
    // The design the dialog started from, the file as stored, and as changed since.
    const [designBase, setDesignBase] = useState(null);
    const [design, setDesign] = useState(null);
    const [designLoading, setDesignLoading] = useState(false);
    const [designError, setDesignError] = useState(null);
    const designChanged = useMemo(
        () => (designBase && design ? designChanges(designBase, design) : {set: [], unset: [], delete: []}),
        [designBase, design],
    );
    // The changes refused that force would lift: the daemon's words, and who may force them.
    const [paramsRefused, setParamsRefused] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);

    // Direct edition of the file: `file` is the file the edit started from, `base`
    // the text edited as it started, `text` as edited: the whole file, or its
    // `section` alone. Kept when the dialog closes, and when the editor unmounts (a tab
    // of its panel left): mounted again, the edit is where it was left.
    const [edit, setEdit] = useEditDraft(`object\u0000${decodedObjectName}\u0000${section ?? ""}`);
    const [editLoading, setEditLoading] = useState(false);
    const [editError, setEditError] = useState(null);
    const [editConflict, setEditConflict] = useState(false);
    // Who may write the edit refused anyway (forceLifts), null when force changes nothing of it.
    const [editLifts, setEditLifts] = useState(null);
    const isRoot = useIsRoot();
    const editDirty = edit !== null && edit.text !== edit.base;

    const startEdit = async () => {
        // The shown text is redacted: written back, it would replace every secret
        // with asterisks. The edit starts from the file as stored.
        setShowSecrets(false);
        setEditError(null);
        setEditConflict(false);
        if (absent) {
            setEdit({file: "", base: "", text: ""});
            return;
        }
        setEditLoading(true);
        try {
            const file = await fetchRawConfigFile(decodedObjectName);
            const text = section === null ? file : extractSection(file, section) ?? `[${section}]\n`;
            setEdit({file, base: text, text});
        } catch (err) {
            setEditError(t("config.errors.fetchConfig", {message: err.message}));
        } finally {
            setEditLoading(false);
        }
    };

    const cancelEdit = () => {
        setEdit(null);
        setEditError(null);
        setEditConflict(false);
        setEditLifts(null);
    };

    // `force`, written anyway past a refusal force lifts (ForceRefusal).
    const saveEdit = async (force = false) => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        setEditError(null);
        setEditConflict(false);
        setEditLifts(null);
        setActionLoading(true);
        try {
            // The daemon writes the whole file: a change landed since the edit
            // started would be undone without a word.
            const current = absent ? "" : await fetchRawConfigFile(decodedObjectName);
            if (current !== edit.file) {
                setEditConflict(true);
                setEditError(t("config.feedback.conflict"));
                return;
            }
            const response = await fetch(withWriteParams(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file`, {force}), {
                // None yet: created with the file, an id of its own.
                method: absent ? "POST" : "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/octet-stream",
                },
                // A section edited goes back in its place in the file as it was.
                body: absent ? withId(edit.text, newId()) : section === null ? edit.text : replaceSection(edit.file, section, edit.text),
            });
            // What came of it, the actions tray says; refused, the editor stays open and says why.
            const label = t(absent ? "actionTray.writes.configCreate" : "actionTray.writes.configFile");
            // A wait that expired (408) is a write done: said so in the actions tray.
            if (!response.ok && response.status !== 408) {
                const problem = await readProblem(response);
                // Changed meanwhile: started over. Held by another object: forced, if at all.
                if (response.status === 409 && problem.title !== PROBLEM_TITLE_HELD) setEditConflict(true);
                setEditLifts(forceLifts(problem, {creating: absent}));
                const message = await problemMessage(response);
                const reason = message.startsWith("HTTP ") ? message : `HTTP ${response.status} ${message}`;
                trackRefused({action: "config", label, subject: decodedObjectName, reason});
                setEditError(t("config.feedback.updateFailed", {message}));
                return;
            }
            await trackWrite(response, {action: "config", label, subject: decodedObjectName, path: decodedObjectName}, refusal);
            if (absent) setCreated(true);
            setEdit(null);
            if (configNode) await fetchConfig(configNode, true);
        } catch (err) {
            trackRefused({action: "config", label: t("actionTray.writes.configFile"), subject: decodedObjectName, reason: err.message});
            setEditError(t("config.feedback.updateFailed", {message: err.message}));
        } finally {
            setActionLoading(false);
        }
    };

    /**
     * The designer opened on the file as stored, read again each time: its secrets
     * in clear, as an edit, the keys of a datastore left out. None yet: the sections
     * every design starts with, env for a service or a volume.
     */
    const openDesign = async () => {
        const start = designStart(["svc", "vol"].includes(parseObjectPath(decodedObjectName).kind));
        setParamsRefused(null);
        setDesignError(null);
        setDesignBase(null);
        setDesign(null);
        setManageParamsDialogOpen(true);
        if (absent) {
            setDesignBase(start);
            setDesign(start);
            return;
        }
        setDesignLoading(true);
        try {
            const seeded = parseDesign(await fetchRawConfigFile(decodedObjectName), start);
            setDesignBase(seeded);
            setDesign(seeded);
        } catch (err) {
            setDesignError(t("config.errors.fetchConfig", {message: err.message}));
        } finally {
            setDesignLoading(false);
        }
    };

    // `force`, written anyway past a refusal force lifts.
    const handleUpdateConfig = async (force = false) => {
        /* istanbul ignore next */
        if (!newConfigFile) {
            openSnackbar(t("config.feedback.fileRequired"), "error");
            return;
        }
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        setActionLoading(true);
        setUploadRefused(null);
        // What came of it, the actions tray says; refused, the dialog stays open and says why.
        const write = {action: "config", label: t(absent ? "actionTray.writes.configCreate" : "actionTray.writes.configFile"), subject: decodedObjectName, path: decodedObjectName};
        let done = true;
        try {
            const response = await fetch(withWriteParams(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file`, {force}), {
                method: absent ? "POST" : "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/octet-stream",
                },
                body: absent ? withId(await newConfigFile.text(), newId()) : newConfigFile,
            });
            const problem = response.ok || response.status === 408 ? null : await readProblem(response);
            if (!(await trackWrite(response, write, refusal))) {
                done = false;
                setUploadRefused({messages: [problem.detail || `HTTP ${problem.status}`], lifts: forceLifts(problem, {creating: absent})});
                return;
            }
            if (absent) setCreated(true);
            if (configNode) {
                await fetchConfig(configNode, true);
                setConfigDialogOpen(true);
            }
        } catch (err) {
            trackRefused({...write, reason: err.message});
        } finally {
            setActionLoading(false);
            if (done) {
                setUpdateConfigDialogOpen(false);
                setNewConfigFile(null);
            }
        }
    };

    /**
     * Writes the changes designed in one request, as om config update does: the
     * sections deleted, the keywords unset, then set, the daemon applying them in
     * that order, all or none; one wait for the nodes. The object none yet: created
     * with the keywords set. Done, the dialog closes; refused, nothing is written,
     * the dialog stays open with the changes and the daemon's words, written anyway
     * (`force`) by whom may when force lifts the refusal.
     */
    const handleManageParamsSubmit = async (force = false) => {
        const {set: sets, unset: unsets, delete: paramsToDelete} = designChanged;
        if (!sets.length && !unsets.length && !paramsToDelete.length) {
            openSnackbar(t("config.feedback.noSelection"), "error");
            return;
        }
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        // As om writes them: set=<keyword>=<value>, the keyword and the value each encoded.
        const query = [
            ...sets.map(({keyword, value}) => `set=${encodeURIComponent(keyword)}=${encodeURIComponent(value)}`),
            // None yet: nothing to unset nor delete.
            ...(absent ? [] : unsets.map((keyword) => `unset=${encodeURIComponent(keyword)}`)),
            ...(absent ? [] : paramsToDelete.map((section) => `delete=${encodeURIComponent(section)}`)),
        ].join("&");
        // What it does, in the actions tray: each change, in the order applied.
        const label = absent
            ? t("actionTray.writes.configCreate")
            : [
                ...paramsToDelete.map((section) => t("actionTray.writes.deleteSection", {section})),
                ...unsets.map((keyword) => t("actionTray.writes.unset", {keyword})),
                ...sets.map(({keyword, value}) => t("actionTray.writes.set", {keyword, value})),
            ].join("; ");
        const info = {action: "config", label, subject: decodedObjectName, path: decodedObjectName};
        const base = `${URL_OBJECT}/${namespace}/${kind}/${name}`;
        setParamsRefused(null);
        setActionLoading(true);
        try {
            const response = await fetch(withWriteParams(`${base}/${absent ? "config/file" : "config"}?${query}`, {force}), absent
                ? {method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream"}, body: withId("", newId())}
                : {method: "PATCH", headers: {Authorization: `Bearer ${token}`}});
            const problem = response.ok || response.status === 408 ? null : await readProblem(response);
            if (!(await trackWrite(response, info, refusal))) {
                setParamsRefused({
                    messages: [problem.detail || `HTTP ${problem.status}`],
                    lifts: forceLifts(problem, {creating: absent}),
                });
                return;
            }
            if (absent) setCreated(true);
            setManageParamsDialogOpen(false);
            setDesignBase(null);
            setDesign(null);
            if (configNode) {
                await fetchConfig(configNode, true);
                setConfigDialogOpen(true);
            }
        } catch (err) {
            trackRefused({...info, reason: err.message});
            setParamsRefused({messages: [err.message], lifts: null});
        } finally {
            setActionLoading(false);
        }
    };

    const closeConfigDialog = () => setConfigDialogOpen(false);
    // The file, or its section alone.
    const shownText = configData === null || section === null ? configData : extractSection(configData, section);
    const keywordsPath = (() => {
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        return [namespace, kind, name].map(encodeURIComponent).join("/");
    })();

    // The file, its tools and the edit in progress: in a dialog opened by a button,
    // or `inline`, in place, as in the configuration tab of an object.
    const body = edit ? (
                    <div className="space-y-2">
                        <p className="text-data text-ink-muted">
                            {t("config.view.editNotice")}
                        </p>
                        {editError && editConflict && (
                            <Alert
                                action={
                                    <Button size="sm" onClick={startEdit} disabled={actionLoading || editLoading}>
                                        {t("config.view.startOver")}
                                    </Button>
                                }
                            >
                                {editError}
                            </Alert>
                        )}
                        {editError && !editConflict && (
                            <ForceRefusal
                                messages={[editError]}
                                lifts={editLifts}
                                isRoot={isRoot}
                                onForce={() => saveEdit(true)}
                                disabled={actionLoading}
                            />
                        )}
                        <Textarea
                            aria-label={t("config.view.fileLabel")}
                            value={edit.text}
                            onChange={(e) => setEdit({...edit, text: e.target.value})}
                            disabled={actionLoading}
                            spellCheck={false}
                            rows={Math.min(30, Math.max(10, edit.text.split("\n").length + 1))}
                            className="font-mono text-data whitespace-pre"
                        />
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-end gap-1">
                            {configData !== null && !configLoading && (
                                <p className="mr-auto text-data text-ink-muted">
                                    {showSecrets
                                        ? t("config.view.secretsMaskedIn", {time: formatSeconds(secondsLeft)})
                                        : t("config.view.secretsHidden")}
                                </p>
                            )}
                            {/* The text shown copied: its secrets masked unless shown. */}
                            {shownText !== null && !configLoading && (
                                <CopyButton size="md" text={shownText} label={t("config.view.copy")}/>
                            )}
                            {!absent && <IconButton
                                label={showSecrets ? t("config.view.hideSecrets") : t("config.view.showSecrets")}
                                aria-pressed={showSecrets}
                                onClick={() => setShowSecrets((shown) => !shown)}
                                // Hidden at any time, a slow read in clear dropped.
                                disabled={configLoading && !showSecrets}
                            >
                                {showSecrets ? <EyeOffIcon/> : <EyeIcon/>}
                            </IconButton>}
                            <IconButton
                                label={t("config.view.editFile")}
                                onClick={startEdit}
                                disabled={actionLoading || editLoading || (!configNode && !absent)}
                            >
                                {/* The file edited: the pencil. */}
                                <PencilIcon/>
                            </IconButton>
                            {/* The whole file uploaded, its parameters set: not from a section. */}
                            {section === null && (
                                <>
                                    <IconButton
                                        label={t("config.view.uploadFile")}
                                        onClick={() => setUpdateConfigDialogOpen(true)}
                                        disabled={actionLoading}
                                    >
                                        <UploadIcon/>
                                    </IconButton>
                                    <IconButton
                                        label={t("config.view.manageParams")}
                                        onClick={openDesign}
                                        disabled={actionLoading}
                                    >
                                        {/* The configuration designed, its sections and keywords: the sliders. */}
                                        <SlidersIcon/>
                                    </IconButton>
                                    {/* None yet: nothing to evaluate. */}
                                    {!absent && (
                                        <IconButton label={t("configEval.open")} onClick={() => setEvalOpen(true)}>
                                            <CodeIcon/>
                                        </IconButton>
                                    )}
                                </>
                            )}
                        </div>
                        {absent && <p className="text-ink-muted">{t("config.view.absent")}</p>}
                        {!absent && !configNode && !configLoading && !configError && (
                            <p className="text-ink-muted">{t("config.view.noInstance")}</p>
                        )}
                        {editLoading && <Spinner label={t("config.view.loadingForEdit")}/>}
                        {editError && !editLoading && <Alert>{editError}</Alert>}
                        {configLoading && <Spinner label={t("config.view.loading")}/>}
                        {configError && <Alert>{configError}</Alert>}
                        {!configLoading && !configError && configData === null && configNode && (
                            <p className="text-ink-muted">{t("config.view.empty")}</p>
                        )}
                        {!configLoading && !configError && configData !== null && shownText === null && (
                            <p className="text-ink-muted">{t("config.view.noSection", {section})}</p>
                        )}
                        {!configLoading && !configError && configData !== null && shownText !== null && (
                            <ConfigText
                                text={shownText}
                                path={decodedObjectName}
                                openSnackbar={openSnackbar}
                                label={t("config.view.fileLabel")}
                                keywordsUrl={`${URL_OBJECT}/${keywordsPath}/config/keywords`}
                            />
                        )}
                    </>
                );
    const footer = (edit ? (
                    <>
                        <Button onClick={cancelEdit} disabled={actionLoading}>{t("common.cancel")}</Button>
                        <Button
                            onClick={() => saveEdit()}
                            disabled={actionLoading || !editDirty}
                            icon={actionLoading ? <Spinner label={t("config.view.saving")}/> : undefined}
                        >
                            {t("common.save")}
                        </Button>
                    </>
                ) : (
                    <Button onClick={closeConfigDialog}>{t("common.close")}</Button>
                ));
    const subDialogs = (
        <>
            <ConfigEvalDialog
                open={evalOpen}
                onClose={() => setEvalOpen(false)}
                configUrl={`${URL_OBJECT}/${keywordsPath}/config`}
                subject={decodedObjectName}
                nodes={scope ?? []}
            />

            <UpdateConfigDialog
                open={updateConfigDialogOpen}
                onClose={() => {
                    setUpdateConfigDialogOpen(false);
                    setUploadRefused(null);
                }}
                newConfigFile={newConfigFile}
                setNewConfigFile={(file) => {
                    setNewConfigFile(file);
                    setUploadRefused(null);
                }}
                actionLoading={actionLoading}
                handleUpdateConfig={handleUpdateConfig}
                refused={uploadRefused}
                isRoot={isRoot}
            />
            <DesignConfigDialog
                open={manageParamsDialogOpen}
                onClose={() => {
                    setManageParamsDialogOpen(false);
                    setParamsRefused(null);
                }}
                kind={parseObjectPath(decodedObjectName).kind}
                namespace={parseObjectPath(decodedObjectName).namespace}
                keywordsUrl={`${URL_OBJECT}/${keywordsPath}/config/keywords`}
                design={design}
                onChange={setDesign}
                loading={designLoading}
                error={designError}
                changes={designChanged}
                actionLoading={actionLoading}
                onSubmit={handleManageParamsSubmit}
                refused={paramsRefused}
                isRoot={isRoot}
            />
        </>
    );

    if (inline) {
        return (
            <div className="space-y-2">
                {body}
                {edit && <div className="flex justify-end gap-2">{footer}</div>}
                {subDialogs}
            </div>
        );
    }

    return (
        <div className="inline-flex">
            <Button
                size="sm"
                icon={<FileIcon/>}
                onClick={() => setConfigDialogOpen(true)}
            >
                {t("config.view.button")}
            </Button>

            <Dialog
                open={configDialogOpen}
                onClose={closeConfigDialog}
                title={t("config.view.title")}
                size="lg"
                footer={footer}
                dirty={editDirty}
            >
                {body}
            </Dialog>
            {subDialogs}
        </div>
    );
};

export default ConfigSection;
