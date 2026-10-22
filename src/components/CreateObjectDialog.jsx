import React, {useEffect, useId, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {Dialog} from "../ui/components/Dialog";
import {Button} from "../ui/components/Button";
import {Checkbox, Field, Input, Select, Textarea} from "../ui/components/Field";
import {Combobox} from "../ui/components/Combobox";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {URL_OBJECT} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import useEventStore from "../hooks/useEventStore.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {postAction, refusalReason} from "./objectActions";
import {trackDone, trackRefused} from "../app/action-tracker";
import {
    CREATABLE_KINDS,
    NSCFG_NAME,
    PROVISIONABLE_KINDS,
    objectPath,
    pathErrors,
    newId,
    withId,
} from "../app/object-create";

/** How long the new object is waited for before its provisioning is given up. */
const APPEAR_TIMEOUT_MS = 30000;

const SOURCES = ["empty", "copy", "file"];


/** The configuration file of an object, its secrets in clear: what a copy starts from. */
const fetchConfigFile = async (path) => {
    const {namespace, kind, name} = parseObjectPath(path);
    const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file?redact-secrets=false`, {
        headers: {Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`},
        cache: "no-cache",
    });
    if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
    return response.text();
};

/**
 * Resolves when the daemon reports the object and its instances, as `ox create
 * --provision` waits for the instance monitors before provisioning; rejects after
 * a while.
 */
const waitForObject = (path) => new Promise((resolve, reject) => {
    const ready = (s) => s.objectStatus?.[path] !== undefined && Object.keys(s.objectInstanceStatus?.[path] ?? {}).length > 0;
    if (ready(useEventStore.getState())) {
        resolve();
        return;
    }
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("timeout"));
    }, APPEAR_TIMEOUT_MS);
    unsubscribe = useEventStore.subscribe((s) => {
        if (!ready(s)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve();
    });
});

/**
 * Creates an object, as `ox <path> create` does through the daemon: its kind,
 * namespace and name checked as om checks them, its configuration started empty,
 * from a copy of an object or from a file, and edited in place before it is sent.
 * The new object gets an id of its own. A service or a volume can be provisioned
 * once created.
 *
 * `paths` are the objects known, offered as sources and refused as new paths;
 * `namespaces` are offered for the new one. `onCreated` receives the path created;
 * the creation and the provisioning, the actions tray says.
 */
const CreateObjectDialog = ({open, onClose, defaultKind = "svc", defaultNamespace = "root", namespaces = [], paths = [], onCreated}) => {
    const {t} = useTranslation();
    const ids = useId();
    const [kind, setKind] = useState(defaultKind);
    // A cfg or a sec: created empty, its keys added in its panel.
    const datastore = kind === "cfg" || kind === "sec";
    const [namespace, setNamespace] = useState(defaultNamespace);
    const [name, setName] = useState("");
    const [source, setSource] = useState("empty");
    const [copyFrom, setCopyFrom] = useState("");
    const [fileName, setFileName] = useState("");
    const [config, setConfig] = useState("");
    const [loadingSource, setLoadingSource] = useState(false);
    const [provision, setProvision] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    // Errors show once a field was left, or a submit tried.
    const [touched, setTouched] = useState({});
    const nameRef = useRef(null);

    // Each opening starts over, on the kind of the list it was opened from.
    useEffect(() => {
        if (!open) return;
        setKind(defaultKind);
        setNamespace(defaultNamespace);
        setName("");
        setSource("empty");
        setCopyFrom("");
        setFileName("");
        setConfig("");
        setProvision(false);
        setError(null);
        setTouched({});
    }, [open, defaultKind, defaultNamespace]);

    const path = objectPath(namespace.trim(), kind, name.trim());
    const errors = pathErrors(namespace.trim(), kind, name.trim());
    const exists = paths.includes(path);
    const nameError = errors.name
        ? t(`createObject.errors.${errors.name}`)
        : exists ? t("createObject.errors.exists", {path}) : null;
    const namespaceError = errors.namespace ? t(`createObject.errors.${errors.namespace}`) : null;
    const invalid = nameError !== null || namespaceError !== null;
    const canProvision = PROVISIONABLE_KINDS.includes(kind);

    const copyOptions = useMemo(
        () => [...paths].sort((a, b) => a.localeCompare(b)).map((p) => ({value: p, label: p})),
        [paths]
    );

    const chooseSource = (next) => {
        setSource(next);
        setError(null);
        if (next === "empty") setConfig("");
    };

    const copy = async (from) => {
        setCopyFrom(from);
        if (from === "") return;
        setLoadingSource(true);
        setError(null);
        try {
            setConfig(await fetchConfigFile(from));
        } catch (err) {
            setError(t("createObject.feedback.copyFailed", {path: from, message: err.message}));
        } finally {
            setLoadingSource(false);
        }
    };

    const readFile = async (file) => {
        if (!file) return;
        setFileName(file.name);
        setError(null);
        try {
            setConfig(await file.text());
        } catch (err) {
            setError(t("createObject.feedback.readFailed", {message: err.message}));
        }
    };

    const submit = async (event) => {
        event?.preventDefault();
        setTouched({name: true, namespace: true});
        if (invalid || submitting) {
            if (nameError !== null) nameRef.current?.focus();
            return;
        }
        setSubmitting(true);
        setError(null);
        const {namespace: ns, kind: k, name: n} = parseObjectPath(path);
        const creation = {action: "create", label: t("actionTray.writes.objectCreate"), subject: path, path};
        try {
            const response = await fetch(`${URL_OBJECT}/${ns}/${k}/${n}/config/file`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
                    "Content-Type": "application/octet-stream",
                },
                body: withId(config, newId()),
            });
            // What came of it, the actions tray says; refused, the dialog stays open and says why.
            if (!response.ok) {
                const detail = await getResponseErrorMessage(response);
                trackRefused({...creation, reason: refusalReason({status: response.status, detail})});
                setError(response.status === 409
                    ? t("createObject.errors.exists", {path})
                    : t("createObject.feedback.failed", {message: detail || `HTTP ${response.status}`}));
                return;
            }
            trackDone(creation);
            // Provisioned once the daemons know it: followed, or said refused, in the actions tray.
            if (provision && canProvision) {
                try {
                    await waitForObject(path);
                    await postAction({path, action: "provision"});
                } catch (err) {
                    trackRefused({action: "provision", subject: path, reason: err.message});
                }
            }
            onCreated?.(path);
        } catch (err) {
            trackRefused({...creation, reason: err.message});
            setError(t("createObject.feedback.failed", {message: err.message}));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={submitting ? () => {} : onClose}
            title={t("createObject.title")}
            size="lg"
            initialFocus={nameRef}
            footer={
                <>
                    {/* Pressed, it keeps the focus where it is: a field left would say its error, the
                        dialog growing, the button moved from under the pointer before it is released. */}
                    <Button onMouseDown={(e) => e.preventDefault()} onClick={onClose} disabled={submitting}>{t("common.cancel")}</Button>
                    <Button
                        variant="create"
                        type="submit"
                        form={`${ids}-form`}
                        disabled={submitting || loadingSource}
                        icon={submitting ? <Spinner label={t("createObject.creating")}/> : undefined}
                    >
                        {t("createObject.submit")}
                    </Button>
                </>
            }
        >
            <form id={`${ids}-form`} onSubmit={submit} noValidate className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem_1fr]">
                    <Field label={t("createObject.namespace")} error={touched.namespace ? namespaceError : null}>
                        {(control) => (
                            <>
                                <Input
                                    {...control}
                                    list={`${ids}-namespaces`}
                                    value={namespace}
                                    onChange={(e) => setNamespace(e.target.value)}
                                    onBlur={() => setTouched((v) => ({...v, namespace: true}))}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                                <datalist id={`${ids}-namespaces`}>
                                    {namespaces.map((ns) => <option key={ns} value={ns}/>)}
                                </datalist>
                            </>
                        )}
                    </Field>
                    <Field label={t("createObject.kind")}>
                        {(control) => (
                            <Select {...control} value={kind} onChange={(e) => setKind(e.target.value)} className="w-full">
                                {CREATABLE_KINDS.map((k) => (
                                    <option key={k} value={k}>{k}</option>
                                ))}
                            </Select>
                        )}
                    </Field>
                    <Field
                        label={t("common.name")}
                        hint={kind === "nscfg" ? t("createObject.nscfgName", {name: NSCFG_NAME}) : undefined}
                        error={touched.name || exists ? nameError : null}
                    >
                        {(control) => (
                            <Input
                                {...control}
                                ref={nameRef}
                                value={kind === "nscfg" ? NSCFG_NAME : name}
                                disabled={kind === "nscfg"}
                                onChange={(e) => setName(e.target.value)}
                                onBlur={() => setTouched((v) => ({...v, name: true}))}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        )}
                    </Field>
                </div>
                <p className="text-ink-muted">
                    {t("createObject.path")} <code className="font-mono text-ink">{path}</code>
                </p>

                {/* A datastore starts empty, its keys added next, in its panel: no source to choose. */}
                {datastore ? (
                    <p className="text-ink-muted">{t("createObject.datastoreHint")}</p>
                ) : (
                <>
                <fieldset className="space-y-2">
                    <legend className="mb-1 font-medium">{t("createObject.source")}</legend>
                    <div className="flex flex-wrap gap-4">
                        {SOURCES.map((s) => (
                            <label key={s} className="inline-flex items-center gap-2">
                                <input
                                    type="radio"
                                    name={`${ids}-source`}
                                    value={s}
                                    checked={source === s}
                                    onChange={() => chooseSource(s)}
                                    className="h-4 w-4 accent-(--accent)"
                                />
                                {t(`createObject.sources.${s}`)}
                            </label>
                        ))}
                    </div>
                    {source === "copy" && (
                        <div className="flex items-center gap-2">
                            <Combobox
                                options={copyOptions}
                                value={copyFrom}
                                onChange={copy}
                                label={t("createObject.copyFrom")}
                                placeholder={t("createObject.copyFrom")}
                                emptyText={t("createObject.noObject")}
                                className="w-80"
                            />
                            {loadingSource && <Spinner label={t("createObject.reading")}/>}
                        </div>
                    )}
                    {source === "file" && (
                        <div className="flex items-center gap-3">
                            <input
                                id={`${ids}-file`}
                                type="file"
                                className="peer sr-only"
                                onChange={(e) => readFile(e.target.files?.[0])}
                            />
                            <label
                                htmlFor={`${ids}-file`}
                                className="inline-flex h-8 cursor-pointer items-center rounded-(--radius-control) border border-line bg-surface-raised px-3 font-medium hover:bg-surface-sunken peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus-ring)"
                            >
                                {t("config.filePicker.choose")}
                            </label>
                            <span className={fileName ? "text-ink" : "text-ink-muted"}>
                                {fileName || t("createObject.noFile")}
                            </span>
                        </div>
                    )}
                </fieldset>

                <Field label={t("createObject.config")} hint={t("createObject.configHint")}>
                    {(control) => (
                        <Textarea
                            {...control}
                            value={config}
                            onChange={(e) => setConfig(e.target.value)}
                            spellCheck={false}
                            rows={Math.min(20, Math.max(8, config.split("\n").length + 1))}
                            className="font-mono text-data whitespace-pre"
                        />
                    )}
                </Field>
                </>
                )}

                {canProvision && (
                    <Checkbox
                        label={t("createObject.provision")}
                        checked={provision}
                        onChange={(e) => setProvision(e.target.checked)}
                    />
                )}

                {error !== null && <Alert tone="error">{error}</Alert>}
            </form>
        </Dialog>
    );
};

export default CreateObjectDialog;
