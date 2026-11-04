import React, {useEffect, useId, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {Dialog} from "../ui/components/Dialog";
import {Button} from "../ui/components/Button";
import {Checkbox, Field, Input, Select, Textarea} from "../ui/components/Field";
import {ObjectIcon, om3ObjectKind} from "../ui/components/ObjectIcon";
import {useMediaQuery} from "../ui/lib/media";
import {CheckIcon, PlusIcon} from "../ui/icons";
import {Combobox} from "../ui/components/Combobox";
import {Spinner} from "../ui/components/Spinner";
import {URL_OBJECT} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import useEventStore from "../hooks/useEventStore.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {postAction, refusalReason} from "./objectActions";
import {trackRefused, trackWrite} from "../app/action-tracker";
import {PROBLEM_TITLE_HELD, forceLifts, readProblem, withWriteParams} from "../app/config-write";
import {useGrants} from "../hooks/useGrants";
import {ForceRefusal} from "./ConfigWriteControls";
import {ObjectDesigner} from "./ObjectDesigner";
import {designStart, designText} from "../app/object-design";
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

/** How the configuration starts: none, a copy of an object, a text written or dropped, a design. */
const SOURCES = ["empty", "copy", "edit", "design"];

/** The kinds that run, whose design has an env section of free keys. */
const RUNNING_KINDS = ["svc", "vol"];

/** The look of a card of a picker: picked, the accent outline on its soft tint. */
const CARD = "flex min-w-0 flex-col items-start gap-0.5 rounded-(--radius-panel) border border-line bg-surface-raised p-2 text-left hover:border-line-strong aria-pressed:border-accent aria-pressed:bg-accent-soft";

/**
 * The namespaces of the user offered, a card each where there is room, a select in a
 * narrow window; a plus card proposing a new name to who may make a namespace.
 */
function NamespacePicker({namespaces, value, onChange, canCreate, error, onBlur}) {
    const {t} = useTranslation();
    const narrow = useMediaQuery("(max-width: 39.99rem)");
    const isNew = value !== "" && !namespaces.includes(value);
    const [proposing, setProposing] = useState(isNew);
    const propose = () => {
        setProposing(true);
        onChange(isNew ? value : "");
    };
    return (
        <fieldset className="space-y-1.5">
            <legend className="mb-1 font-medium">{t("createObject.namespace")}</legend>
            {narrow ? (
                <Select
                    aria-label={t("createObject.namespace")}
                    className="h-8 w-full"
                    value={proposing ? NEW : value}
                    onChange={(e) => (e.target.value === NEW ? propose() : (setProposing(false), onChange(e.target.value)))}
                >
                    {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
                    {canCreate && <option value={NEW}>{t("createObject.newNamespace")}</option>}
                </Select>
            ) : (
                <div role="group" aria-label={t("createObject.myNamespaces")} className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5 overflow-auto p-0.5">
                    {namespaces.map((ns) => (
                        <button
                            key={ns}
                            type="button"
                            aria-pressed={!proposing && value === ns}
                            onClick={() => {
                                setProposing(false);
                                onChange(ns);
                            }}
                            className={CARD}
                        >
                            <span className="flex w-full items-center gap-1.5">
                                <ObjectIcon kind="namespace" className="h-3.5 w-3.5"/>
                                <span className="truncate font-medium">{ns}</span>
                            </span>
                        </button>
                    ))}
                    {/* A new namespace: a plus card, out of the rule of the buttons as every plus card. */}
                    {canCreate && (
                        <button
                            type="button"
                            aria-pressed={proposing}
                            onClick={propose}
                            className="flex items-center justify-center gap-1 rounded-(--radius-panel) border border-dashed border-line p-2 text-ink-muted hover:border-accent hover:text-accent aria-pressed:border-accent aria-pressed:text-accent"
                        >
                            <PlusIcon className="h-3.5 w-3.5"/>
                            {t("createObject.newNamespace")}
                        </button>
                    )}
                </div>
            )}
            {proposing && (
                <Field label={t("createObject.newNamespaceName")} error={error}>
                    {(control) => (
                        <Input
                            {...control}
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            onBlur={onBlur}
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                        />
                    )}
                </Field>
            )}
            {!proposing && error && <p role="alert" className="text-data text-state-down">{error}</p>}
            {namespaces.length === 0 && !canCreate && <p className="text-data text-ink-muted">{t("createObject.noNamespace")}</p>}
        </fieldset>
    );
}

/** The value of the select of a narrow window proposing a new namespace. */
const NEW = "\u0000new";

/** The kinds, a card each: its name, and a line on its part in an application. */
function KindPicker({value, onChange}) {
    const {t} = useTranslation();
    return (
        <fieldset>
            <legend className="mb-1 font-medium">{t("createObject.kind")}</legend>
            <div role="group" aria-label={t("createObject.kind")} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {CREATABLE_KINDS.map((k) => (
                    <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={CARD} data-kind={k}>
                        <span className="flex items-center gap-1.5">
                            <ObjectIcon kind={om3ObjectKind(k)} className="h-4 w-4"/>
                            <span className="font-medium">{t(`createObject.kinds.${k}.name`)}</span>
                            <span className="font-mono text-data text-ink-muted">{k}</span>
                        </span>
                        <span className="text-data text-ink-muted">{t(`createObject.kinds.${k}.role`)}</span>
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

/**
 * The configuration written or dropped: a text, a file dropped on it or picked read
 * into it, replacing what it holds.
 */
function ConfigDropZone({value, onChange, onFile, fileName}) {
    const {t} = useTranslation();
    const ids = useId();
    const [over, setOver] = useState(false);
    return (
        <div
            data-drop-zone=""
            onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                onFile(e.dataTransfer?.files?.[0]);
            }}
            className={`space-y-1.5 rounded-(--radius-control) border border-dashed p-1.5 ${over ? "border-accent bg-accent-soft" : "border-line"}`}
        >
            <div className="flex flex-wrap items-center gap-2 text-data text-ink-muted">
                <input id={`${ids}-file`} type="file" className="peer sr-only" onChange={(e) => onFile(e.target.files?.[0])}/>
                <label
                    htmlFor={`${ids}-file`}
                    className="inline-flex h-7 cursor-pointer items-center rounded-(--radius-control) border border-line bg-surface-raised px-2.5 font-medium text-ink hover:bg-surface-sunken peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus-ring)"
                >
                    {t("config.filePicker.choose")}
                </label>
                <span>{fileName ? t("createObject.fileRead", {name: fileName}) : t("createObject.dropHint")}</span>
            </div>
            <Textarea
                aria-label={t("createObject.config")}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                rows={Math.min(20, Math.max(8, value.split("\n").length + 1))}
                className="w-full font-mono text-data whitespace-pre"
            />
        </div>
    );
}


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
 * Creates an object, as `ox <path> create` does through the daemon, in two steps.
 * What: its namespace, among those of the user (admin of it, every one for root),
 * or a new one for who may make one; its kind, each said its part in an application;
 * its name, checked as om checks it and against the objects known, as it is typed.
 * Then how its configuration starts: none, a copy of an object, a text written or a
 * file dropped, or a design (ObjectDesigner). A cfg or a sec starts empty, its keys
 * added in its panel: no second step. The new object gets an id of its own; a
 * service or a volume can be provisioned once created. The creation waits for the
 * configuration to reach the nodes, as `om --wait`.
 *
 * `paths` are the objects known, offered as sources and refused as new paths;
 * `namespaces`, those known. `onCreated` receives the path created; the creation and
 * the provisioning, the actions tray says.
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
    // The configuration of the object copied, `from` it, as read then edited; none until
    // read, nor when it could not be: apart from the one written, never another's posted.
    const [copied, setCopied] = useState(null);
    const [design, setDesign] = useState(() => designStart());
    // What it is, then how its configuration starts.
    const [step, setStep] = useState("what");
    const [loadingSource, setLoadingSource] = useState(false);
    const [provision, setProvision] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    // Refused, who may create it anyway (forceLifts): anyone over an object that
    // exists, which is then replaced; root past a value another object holds.
    const [lifts, setLifts] = useState(null);
    const [held, setHeld] = useState(false);
    useEffect(() => {
        if (error === null) setLifts(null);
    }, [error]);
    const grants = useGrants();
    const isRoot = Object.prototype.hasOwnProperty.call(grants, "root");
    // The namespaces the user may create in: every one known for root, else those it administers.
    const mine = useMemo(() => {
        const list = isRoot ? [...new Set(["root", ...namespaces])] : [...(Array.isArray(grants.admin) ? grants.admin : [])];
        return list.sort((a, b) => a.localeCompare(b));
    }, [isRoot, grants, namespaces]);
    const canCreateNamespace = isRoot || Object.prototype.hasOwnProperty.call(grants, "squatter");
    // Errors show once a field was left, or a submit tried.
    const [touched, setTouched] = useState({});
    const nameRef = useRef(null);
    // The object whose copy is read: picked again meanwhile, an answer is not the one asked.
    const copying = useRef("");
    // The design an opening starts from: another one, the user designed it.
    const designAtStart = useRef(null);

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
        setCopied(null);
        const start = designStart(RUNNING_KINDS.includes(defaultKind));
        designAtStart.current = start;
        setDesign(start);
        setStep("what");
        copying.current = "";
        setLoadingSource(false);
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
    // Its kind changed: the env section of the design, for a service or a volume only.
    const pickKind = (next) => {
        setKind(next);
        setDesign((d) => {
            const hasEnv = d.some((sec) => sec.name === "env");
            if (RUNNING_KINDS.includes(next) === hasEnv) return d;
            return hasEnv ? d.filter((sec) => sec.name !== "env") : [d[0], {name: "env", entries: []}, ...d.slice(1)];
        });
    };
    // The keywords of the object made, read from a namespace the user may read.
    const keywordsUrl = `${URL_OBJECT}/${mine.includes(namespace.trim()) ? namespace.trim() : (mine[0] ?? "root")}/${kind}/${name.trim() && !errors.name ? name.trim() : "new"}/config/keywords`;
    // A design's text, edited as a text from then on.
    const toText = () => {
        setConfig(designText(design));
        setSource("edit");
    };
    const next = (event) => {
        event?.preventDefault();
        setTouched({name: true, namespace: true});
        if (invalid) {
            if (nameError !== null) nameRef.current?.focus();
            return;
        }
        setStep("how");
    };
    const canProvision = PROVISIONABLE_KINDS.includes(kind);

    const copyOptions = useMemo(
        () => [...paths].sort((a, b) => a.localeCompare(b)).map((p) => ({value: p, label: p})),
        [paths]
    );

    const chooseSource = (next) => {
        setSource(next);
        setError(null);
        if (next !== "copy") {
            copying.current = "";
            setLoadingSource(false);
        }
    };

    const copy = async (from) => {
        setCopyFrom(from);
        copying.current = from;
        // The one copied before goes: a read failing leaves nothing to create from.
        setCopied(null);
        if (from === "") {
            setLoadingSource(false);
            return;
        }
        setLoadingSource(true);
        setError(null);
        try {
            const text = await fetchConfigFile(from);
            if (copying.current === from) setCopied({from, text});
        } catch (err) {
            if (copying.current === from) setError(t("createObject.feedback.copyFailed", {path: from, message: err.message}));
        } finally {
            if (copying.current === from) setLoadingSource(false);
        }
    };

    /** A file dropped or chosen, its text in the editor shown: `set` it. */
    const readFile = async (file, set = setConfig) => {
        if (!file) return;
        setFileName(file.name);
        setError(null);
        try {
            set(await file.text());
        } catch (err) {
            setError(t("createObject.feedback.readFailed", {message: err.message}));
        }
    };

    // A copy is created from the configuration read of the object picked, and that only:
    // none picked, being read, or not read, nothing to create.
    const hasCopy = copied !== null && copied.from === copyFrom;
    const waitingCopy = source === "copy" && !datastore && !hasCopy;
    const editCopy = (text) => setCopied((c) => (c === null ? c : {...c, text}));

    // `force`, created anyway past a refusal force lifts.
    const submit = async (event, force = false) => {
        event?.preventDefault();
        setTouched({name: true, namespace: true});
        if (invalid || submitting || waitingCopy) {
            if (nameError !== null) nameRef.current?.focus();
            return;
        }
        setSubmitting(true);
        setError(null);
        const {namespace: ns, kind: k, name: n} = parseObjectPath(path);
        const creation = {action: "create", label: t("actionTray.writes.objectCreate"), subject: path, path};
        try {
            const response = await fetch(withWriteParams(`${URL_OBJECT}/${ns}/${k}/${n}/config/file`, {force}), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
                    "Content-Type": "application/octet-stream",
                },
                // A datastore is created empty, as the dialog says: a text left from another
                // kind, hidden, is not sent.
                body: withId(
                    datastore || source === "empty" ? "" : source === "design" ? designText(design) : source === "copy" ? copied.text : config,
                    newId()
                ),
            });
            // What came of it, the actions tray says; refused, the dialog stays open and says why.
            // A wait for the nodes that expired (408) is a creation done, said so.
            if (!response.ok && response.status !== 408) {
                const problem = await readProblem(response);
                const detail = await getResponseErrorMessage(response);
                trackRefused({...creation, reason: refusalReason({status: response.status, detail})});
                // Held by another object is a 409 too: not an object that exists.
                const isHeld = problem.title === PROBLEM_TITLE_HELD;
                setError(response.status === 409 && !isHeld
                    ? t("createObject.errors.exists", {path})
                    : t("createObject.feedback.failed", {message: detail || `HTTP ${response.status}`}));
                setLifts(forceLifts(problem, {creating: true}));
                setHeld(isHeld);
                return;
            }
            await trackWrite(response, creation, async () => "");
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

    // A cfg or a sec has no second step: created at the first.
    const last = datastore || step === "how";
    // Something typed, picked or designed: not lost to a stray Escape or click beside the dialog.
    const dirty = name.trim() !== "" || config !== "" || copied !== null || copyFrom !== "" || fileName !== "" || design !== designAtStart.current;
    return (
        <Dialog
            open={open}
            onClose={submitting ? () => {} : onClose}
            dirty={dirty}
            title={t("createObject.title")}
            size={step === "how" && source === "design" ? "xl" : "lg"}
            initialFocus={nameRef}
            footer={
                <>
                    {/* Pressed, it keeps the focus where it is: a field left would say its error, the
                        dialog growing, the button moved from under the pointer before it is released. */}
                    <Button onMouseDown={(e) => e.preventDefault()} onClick={onClose} disabled={submitting}>{t("common.cancel")}</Button>
                    {step === "how" && !datastore && (
                        <Button onClick={() => setStep("what")} disabled={submitting}>{t("createObject.back")}</Button>
                    )}
                    {last ? (
                        <Button
                            variant="create"
                            type="submit"
                            form={`${ids}-form`}
                            disabled={submitting || loadingSource || waitingCopy}
                            icon={submitting ? <Spinner label={t("createObject.creating")}/> : undefined}
                        >
                            {t("createObject.submit")}
                        </Button>
                    ) : (
                        <Button type="submit" form={`${ids}-form`}>{t("createObject.next")}</Button>
                    )}
                </>
            }
        >
            <form id={`${ids}-form`} onSubmit={last ? submit : next} noValidate className="space-y-4">
                {step === "what" ? (
                    <>
                        <NamespacePicker
                            namespaces={mine}
                            value={namespace}
                            onChange={setNamespace}
                            canCreate={canCreateNamespace}
                            error={touched.namespace || namespace !== "" ? namespaceError : null}
                            onBlur={() => setTouched((v) => ({...v, namespace: true}))}
                        />
                        <KindPicker value={kind} onChange={pickKind}/>
                        <Field
                            label={t("common.name")}
                            hint={kind === "nscfg" ? t("createObject.nscfgName", {name: NSCFG_NAME}) : undefined}
                            error={kind === "nscfg" ? null : (name !== "" || touched.name ? nameError : null)}
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
                        <p className="flex items-center gap-1.5 text-ink-muted">
                            {t("createObject.path")} <code className="font-mono text-ink">{path}</code>
                            {!invalid && name.trim() !== "" && <CheckIcon aria-label={t("createObject.free")} className="h-3.5 w-3.5 text-state-up"/>}
                        </p>
                        {datastore && <p className="text-ink-muted">{t("createObject.datastoreHint")}</p>}
                    </>
                ) : (
                    <>
                        <p className="text-ink-muted">
                            {t("createObject.path")} <code className="font-mono text-ink">{path}</code>
                        </p>
                        <fieldset>
                            <legend className="mb-1 font-medium">{t("createObject.source")}</legend>
                            <div role="group" aria-label={t("createObject.source")} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                {SOURCES.map((src) => (
                                    <button key={src} type="button" aria-pressed={source === src} onClick={() => chooseSource(src)} className={CARD} data-source={src}>
                                        <span className="font-medium">{t(`createObject.sources.${src}`)}</span>
                                        <span className="text-data text-ink-muted">{t(`createObject.sourceHints.${src}`)}</span>
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        {source === "copy" && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Combobox
                                        options={copyOptions}
                                        value={copyFrom}
                                        onChange={copy}
                                        label={t("createObject.copyFrom")}
                                        placeholder={t("createObject.copyFrom")}
                                        emptyText={t("createObject.noObject")}
                                        // 20rem, less on a phone narrower: the spinner beside it, in the dialog.
                                        className="w-80 min-w-0"
                                    />
                                    {loadingSource && <Spinner label={t("createObject.reading")}/>}
                                </div>
                                {hasCopy && !loadingSource && (
                                    <ConfigDropZone
                                        value={copied.text}
                                        onChange={editCopy}
                                        onFile={(file) => readFile(file, editCopy)}
                                        fileName={fileName}
                                    />
                                )}
                            </div>
                        )}
                        {source === "edit" && <ConfigDropZone value={config} onChange={setConfig} onFile={readFile} fileName={fileName}/>}
                        {source === "design" && (
                            <ObjectDesigner kind={kind} namespace={namespace.trim()} sections={design} onChange={setDesign} keywordsUrl={keywordsUrl} isRoot={isRoot} onToText={toText}/>
                        )}
                        {canProvision && (
                            <Checkbox
                                label={t("createObject.provision")}
                                checked={provision}
                                onChange={(e) => setProvision(e.target.checked)}
                            />
                        )}
                    </>
                )}

                {error !== null && (
                    <ForceRefusal
                        messages={[error]}
                        lifts={lifts}
                        isRoot={isRoot}
                        onForce={() => submit(undefined, true)}
                        disabled={submitting}
                        forceLabel={t(held ? "createObject.force.held" : "createObject.force.replace")}
                    />
                )}
            </form>
        </Dialog>
    );
};

export default CreateObjectDialog;
