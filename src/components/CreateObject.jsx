import React, {useEffect, useId, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {Button} from "../ui/components/Button";
import {Field, Input, Select} from "../ui/components/Field";
import {ObjectIcon, om3ObjectKind} from "../ui/components/ObjectIcon";
import {useMediaQuery} from "../ui/lib/media";
import {CheckIcon, PlusIcon} from "../ui/icons";
import {Combobox} from "../ui/components/Combobox";
import {Spinner} from "../ui/components/Spinner";
import {Alert} from "../ui/components/Alert";
import {URL_OBJECT} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import useEventStore from "../hooks/useEventStore.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {postAction, refusalReason} from "./objectActions";
import {trackRefused, trackWrite} from "../app/action-tracker";
import {PROBLEM_TITLE_HELD, forceLifts, readProblem, withWriteParams} from "../app/config-write";
import {useGrants} from "../hooks/useGrants";
import {ForceRefusal} from "./ConfigWriteControls";
import {DesignViewToggle, ObjectDesigner} from "./ObjectDesigner";
import {ConfigEditor} from "./ConfigEditor";
import {designStart, designText, parseDesign, rootOnlyKind} from "../app/object-design";
import {DraftValidation} from "./ConfigValidation";
import {
    CREATABLE_KINDS,
    NSCFG_NAME,
    PROVISIONABLE_KINDS,
    knownPath,
    objectPath,
    pathErrors,
    newId,
    withId,
} from "../app/object-create";

/** How long the new object is waited for before its provisioning is given up. */
const APPEAR_TIMEOUT_MS = 30000;

/** How the configuration starts: none, a copy of an object, a text written or dropped, a design. */
const SOURCES = ["empty", "copy", "file"];
/** The steps of a creation, a cfg or a sec stopping at the first. */
const STEPS = ["what", "from", "configure"];
/** The two ways one configuration is edited. */

/** The kinds that run, whose design has an env section of free keys. */
const RUNNING_KINDS = ["svc", "vol"];

/** The look of a card of a picker: picked, the accent outline on its soft tint. */
// A card of a radio group, the source chosen: checked rather than pressed.
const RADIO_CARD = "flex min-w-0 flex-col items-start gap-0.5 rounded-(--radius-panel) border border-line bg-surface-raised p-2 text-left hover:border-line-strong aria-checked:border-accent aria-checked:bg-accent-soft";
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
 * into it, replacing what it holds. Without `onChange`, the place to drop or pick a
 * file only.
 */
function ConfigDropZone({value = "", onChange, onFile, fileName}) {
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
            {onChange && <ConfigEditor label={t("createObject.config")} value={value} onChange={onChange}/>}
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
    // An action on it is taken by the monitor of one of its instances: the api answers
    // "object not found" until one is known, its status alone not enough.
    const ready = (s) => s.objectStatus?.[path] !== undefined
        && Object.keys(s.instanceMonitor ?? {}).some((key) => key.slice(key.indexOf(":") + 1) === path);
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
 * Creates an object, as `ox <path> create` does through the daemon, in three steps,
 * named in a header leading back. Its name: its namespace, among those of the user
 * (admin of it, every one for root), or a new one for who may make one; its kind,
 * each said its part in an application; its name, checked as om checks it and
 * against the objects known, as it is typed. What its configuration starts from:
 * nothing, a copy of an object, a file. Then that one configuration, configured as
 * a design (ObjectDesigner) or as a text, the two views of it: the text what is
 * sent and validated, the design read from it, its changes written to it, comments
 * not kept. A cfg or a sec starts empty, its keys added in its panel: one step. The new object gets an id of its own; a
 * service or a volume can be deployed: provisioned once created. The creation waits for the
 * configuration to reach the nodes, as `om --wait`.
 *
 * `paths` are the objects known, offered as sources and refused as new paths;
 * `namespaces`, those known. `onCreated` receives the path created; the creation and
 * the provisioning, the actions tray says.
 */
/** The draft of a creation kept under `key` in the tab (sessionStorage): none without a key, or unreadable. */
const readDraft = (key) => {
    if (!key) return null;
    try {
        return JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
        return null;
    }
};
const writeDraft = (key, value) => {
    if (!key) return;
    try {
        if (value === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage refused (a private window full, say): the draft lives as long as the page.
    }
};

const CreateObject = ({onClose, defaultKind = "svc", defaultNamespace = "root", namespaces = [], paths = [], onCreated, draftKey, step: stepProp, onStepChange}) => {
    const {t} = useTranslation();
    const ids = useId();
    // What a reload of the page finds again: the draft of the tab, once read.
    const [draft] = useState(() => readDraft(draftKey));
    const [kind, setKind] = useState(draft?.kind ?? defaultKind);
    // A cfg or a sec: created empty, its keys added in its panel.
    const datastore = kind === "cfg" || kind === "sec";
    const [namespace, setNamespace] = useState(draft?.namespace ?? defaultNamespace);
    const [name, setName] = useState(draft?.name ?? "");
    const [source, setSource] = useState(draft?.source ?? "empty");
    const [copyFrom, setCopyFrom] = useState(draft?.copyFrom ?? "");
    const [fileName, setFileName] = useState(draft?.fileName ?? "");
    const [config, setConfig] = useState(draft?.config ?? "");
    // The configuration of the object copied, `from` it, as read then edited; none until
    // read, nor when it could not be: apart from the one written, never another's posted.
    const [copied, setCopied] = useState(draft?.copied ?? null);
    const [design, setDesign] = useState(() => {
        const start = designStart(RUNNING_KINDS.includes(draft?.kind ?? defaultKind));
        return draft?.config ? parseDesign(draft.config, start) : start;
    });
    // What it is, then how its configuration starts: the page's, in its address, else its own.
    const [ownStep, setOwnStep] = useState(draft?.step ?? "what");
    const step = stepProp ?? ownStep;
    const setStep = (next, options) => (onStepChange ? onStepChange(next, options) : setOwnStep(next));
    const [view, setView] = useState(draft?.view ?? "design");
    const [fileText, setFileText] = useState(draft?.fileText ?? null);
    const [commentsDropped, setCommentsDropped] = useState(false);
    const [loadingSource, setLoadingSource] = useState(false);
    // Deployed: provisioned once created, the button clicked last, kept for a retry past a refusal.
    const [deploying, setDeploying] = useState(false);
    // The errors the daemon finds in the configuration drafted: none to create it, or deploy it.
    const [draftErrors, setDraftErrors] = useState(0);
    // Root's choice of the keywords only root may set, offered to add: the lock of the steps line.
    const [showRoot, setShowRoot] = useState(false);
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
    // The design it started from: another one, the user designed it.
    const designAtStart = useRef(design);
    // What the configuration was filled from: the same again, its edits kept.
    const filledFrom = useRef(draft?.filledFrom ?? "");
    // The name to type first, a new creation.
    useEffect(() => {
        if (step === "what") nameRef.current?.focus();
        // At the start only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const path = objectPath(namespace.trim(), kind, name.trim());
    const errors = pathErrors(namespace.trim(), kind, name.trim());
    // A namespace configuration listed `<namespace>/`: known as the path it is made at.
    const known = useMemo(() => new Set(paths.map(knownPath)), [paths]);
    const exists = known.has(path);
    const existsError = exists ? t("createObject.errors.exists", {path}) : null;
    // A namespace configuration's name is om's: one that exists said on its namespace, the one to change.
    const nameError = errors.name
        ? t(`createObject.errors.${errors.name}`)
        : kind === "nscfg" ? null : existsError;
    const namespaceError = errors.namespace
        ? t(`createObject.errors.${errors.namespace}`)
        : kind === "nscfg" ? existsError : null;
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
    // The configuration filled from what it starts from, at the step that configures it;
    // the same start again, its edits kept. Nothing to start from: designed; else, its text.
    const fill = () => {
        const key = source === "copy" ? `copy:${copyFrom}` : source === "file" ? `file:${fileName}` : "empty";
        if (filledFrom.current === key) return;
        filledFrom.current = key;
        setCommentsDropped(false);
        setConfig(source === "copy" ? copied?.text ?? "" : source === "file" ? fileText ?? "" : "");
        if (source === "empty") {
            setDesign(designStart(RUNNING_KINDS.includes(kind)));
            setView("design");
        } else {
            setView("text");
        }
    };
    // The design read from the text as it is shown; the text untouched until it changes.
    const showView = (next) => {
        if (next === view) return;
        if (next === "design") setDesign(parseDesign(config, designStart(RUNNING_KINDS.includes(kind))));
        setView(next);
    };
    // A design changed: its text the configuration, the comments of the one before gone, said once.
    const editDesign = (next) => {
        setDesign(next);
        const text = designText(next);
        if (text !== config && /^\s*[#;]/m.test(config)) setCommentsDropped(true);
        setConfig(text);
    };
    const next = (event) => {
        event?.preventDefault();
        if (step === "what") {
            setTouched({name: true, namespace: true});
            if (invalid) {
                if (nameError !== null) nameRef.current?.focus();
                return;
            }
            setStep("from");
            return;
        }
        if (!sourceReady) return;
        fill();
        setStep("configure");
    };
    const canProvision = PROVISIONABLE_KINDS.includes(kind);

    const copyOptions = useMemo(
        () => [...paths].sort((a, b) => a.localeCompare(b)).map((p) => ({value: p, label: p})),
        [paths]
    );

    // The cards of the sources, and what a source not ready yet takes next: the object
    // to copy, the file to read.
    const cardsRef = useRef(null);
    const focusCard = () => cardsRef.current?.querySelector('[aria-checked="true"]')?.focus();
    // At the step, the source chosen focused: Enter, as at the name, goes on.
    useEffect(() => {
        if (step === "from") focusCard();
    }, [step]);
    // The arrows choose among the sources, Tab leaves them; Enter goes on with the one
    // chosen once it is ready, or to what it still takes.
    const sourceKey = (event, src) => {
        const moves = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};
        if (event.key in moves) {
            event.preventDefault();
            const to = SOURCES[(SOURCES.indexOf(src) + moves[event.key] + SOURCES.length) % SOURCES.length];
            chooseSource(to);
            cardsRef.current?.querySelector(`[data-source=${to}]`)?.focus();
            return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (src !== source) {
            chooseSource(src);
            return;
        }
        if (sourceReady) {
            next();
            return;
        }
        const follow = cardsRef.current?.closest("form")?.querySelector(src === "file" ? "[data-drop-zone] input[type=file]" : "[data-copy-from] input");
        if (src === "file") follow?.click();
        else follow?.focus();
    };
    const chooseSource = (next) => {
        setSource(next);
        setError(null);
        if (next !== "copy") {
            copying.current = "";
            setLoadingSource(false);
        }
    };

    const copy = async (from) => {
        setError(null);
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

    /** A file dropped or chosen: its text what the configuration starts from, or, `set`, the text edited. */
    const readFile = async (file, set = setFileText) => {
        if (!file) return;
        setFileName(file.name);
        setError(null);
        try {
            set(await file.text());
            // Read at the step of the source: Enter, from its card, goes on.
            if (set === setFileText) focusCard();
        } catch (err) {
            setError(t("createObject.feedback.readFailed", {message: err.message}));
        }
    };

    // A copy starts from the configuration read of the object picked, and that only:
    // none picked, being read, or not read, nothing to start from; a file, once read.
    const hasCopy = copied !== null && copied.from === copyFrom;
    const sourceReady = source === "empty" || (source === "copy" && hasCopy && !loadingSource) || (source === "file" && fileText !== null);

    // The draft kept in the tab as it changes: a reload, or a way back, finds it again.
    useEffect(() => {
        writeDraft(draftKey, {kind, namespace, name, source, copyFrom, fileName, fileText, config, copied, view, step, filledFrom: filledFrom.current});
    }, [draftKey, kind, namespace, name, source, copyFrom, fileName, fileText, config, copied, view, step]);
    // A step asked for by the address, back or forward, not reached yet: the one it takes
    // before. Reached forward, the configuration filled from its start, as Next does.
    useEffect(() => {
        if (step === "what" || datastore) {
            if (step !== "what") setStep("what", {replace: true});
            return;
        }
        if (invalid) {
            setStep("what", {replace: true});
            return;
        }
        if (step !== "configure") return;
        if (!sourceReady) {
            if (!loadingSource) setStep("from", {replace: true});
            return;
        }
        fill();
        // On the step asked: what it takes is read above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, invalid, sourceReady, loadingSource, datastore]);

    // `force`, created anyway past a refusal force lifts; `deploy`, provisioned once created.
    const submit = async (event, force = false, deploy = false) => {
        event?.preventDefault();
        setTouched({name: true, namespace: true});
        if (invalid || submitting) {
            if (nameError !== null) nameRef.current?.focus();
            return;
        }
        // Errors the daemon would refuse it for: not sent, unless forced past a refusal.
        if (draftErrors > 0 && !force) return;
        setDeploying(deploy);
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
                    datastore ? "" : config,
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
            if (deploy && canProvision) {
                try {
                    await waitForObject(path);
                    await postAction({path, action: "provision"});
                } catch (err) {
                    trackRefused({action: "provision", subject: path, reason: err.message});
                }
            }
            writeDraft(draftKey, null);
            onCreated?.(path);
        } catch (err) {
            trackRefused({...creation, reason: err.message});
            setError(t("createObject.feedback.failed", {message: err.message}));
        } finally {
            setSubmitting(false);
        }
    };

    // A cfg or a sec has no second step: created at the first.
    const last = datastore || step === "configure";
    const at = STEPS.indexOf(step);
    // Something typed, picked or designed: asked before it is lost.
    const dirty = name.trim() !== "" || config !== "" || copied !== null || copyFrom !== "" || fileName !== "" || design !== designAtStart.current;
    const [leaving, setLeaving] = useState(false);
    const discardRef = useRef(null);
    useEffect(() => {
        if (leaving) discardRef.current?.focus();
    }, [leaving]);
    // Left on purpose: the draft goes with it.
    const leave = () => {
        writeDraft(draftKey, null);
        onClose?.();
    };
    // The tab closed or reloaded with something done: the browser asks first.
    useEffect(() => {
        if (!dirty || submitting) return undefined;
        const ask = (event) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", ask);
        return () => window.removeEventListener("beforeunload", ask);
    }, [dirty, submitting]);
    return (
        <section aria-labelledby={`${ids}-title`} data-create-object="" className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3 sm:p-4">
            {/* Its path, once named, in the title: the steps after the name say it there. */}
            <h1 id={`${ids}-title`} className="text-title font-semibold">
                {at > 0 ? (
                    <>
                        {t("createObject.title")} <span className="text-ink-muted">·</span> <code className="font-mono">{path}</code>
                    </>
                ) : t("createObject.title")}
            </h1>
            <form id={`${ids}-form`} onSubmit={last ? submit : next} noValidate className="space-y-4">
                {/* The steps, those done a way back to them. */}
                {/* The steps; at the last, on the same line, the view of the configuration and,
                    to root, the keywords only root may set. */}
                {!datastore && (
                    <div className="flex flex-wrap items-center gap-2">
                        <nav aria-label={t("createObject.stepsLabel")}>
                            <ol className="flex flex-wrap items-center gap-1 text-data">
                                {STEPS.map((s, i) => (
                                    <li key={s} className="flex items-center gap-1">
                                        {i > 0 && <span aria-hidden="true" className="text-ink-muted">›</span>}
                                        <button
                                            type="button"
                                            data-step={s}
                                            aria-current={s === step ? "step" : undefined}
                                            disabled={i >= at || submitting}
                                            onClick={() => setStep(s)}
                                            className="rounded-(--radius-control) px-1.5 py-0.5 text-ink-muted enabled:hover:text-accent aria-[current=step]:font-semibold aria-[current=step]:text-ink disabled:cursor-default"
                                        >
                                            {t(`createObject.steps.${s}`)}
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        </nav>
                        {step === "configure" && (
                            <DesignViewToggle
                                className="ml-auto"
                                view={view}
                                onView={showView}
                                showRoot={showRoot}
                                onShowRoot={isRoot && !rootOnlyKind(kind) ? setShowRoot : undefined}
                            />
                        )}
                    </div>
                )}
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
                            {!invalid && (kind === "nscfg" || name.trim() !== "") && <CheckIcon aria-label={t("createObject.free")} className="h-3.5 w-3.5 text-state-up"/>}
                        </p>
                        {datastore && <p className="text-ink-muted">{t("createObject.datastoreHint")}</p>}
                    </>
                ) : step === "from" ? (
                    <>
                        <fieldset>
                            <legend className="mb-1 font-medium">{t("createObject.source")}</legend>
                            <div ref={cardsRef} role="radiogroup" aria-label={t("createObject.source")} className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                                {SOURCES.map((src) => (
                                    <button
                                        key={src}
                                        type="button"
                                        role="radio"
                                        aria-checked={source === src}
                                        tabIndex={source === src ? 0 : -1}
                                        onClick={() => chooseSource(src)}
                                        onKeyDown={(e) => sourceKey(e, src)}
                                        className={RADIO_CARD}
                                        data-source={src}
                                    >
                                        <span className="font-medium">{t(`createObject.sources.${src}`)}</span>
                                        <span className="text-data text-ink-muted">{t(`createObject.sourceHints.${src}`)}</span>
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        {source === "copy" && (
                            <div data-copy-from="" className="flex flex-wrap items-center gap-2">
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
                                {hasCopy && !loadingSource && (
                                    <span className="text-data text-ink-muted">{t("createObject.copyRead", {path: copyFrom, count: copied.text.split("\n").filter((l) => l.trim() !== "").length})}</span>
                                )}
                            </div>
                        )}
                        {source === "file" && <ConfigDropZone onFile={(file) => readFile(file)} fileName={fileText === null ? "" : fileName}/>}
                    </>
                ) : (
                    <>
                        {commentsDropped && <Alert tone="info">{t("createObject.commentsDropped")}</Alert>}
                        {/* Kept while the text is shown: back to the design, its section and choices as left. */}
                        <div hidden={view !== "design"}>
                            <ObjectDesigner kind={kind} namespace={namespace.trim()} sections={design} onChange={editDesign} keywordsUrl={keywordsUrl} isRoot={isRoot} showRoot={showRoot} onShowRoot={setShowRoot}/>
                        </div>
                        {view === "text" && (
                            <ConfigDropZone value={config} onChange={setConfig} onFile={(file) => readFile(file, setConfig)} fileName={fileName}/>
                        )}
                        {/* What the daemon would refuse of it, or warn of, said before it is created. */}
                        <DraftValidation url={keywordsUrl.replace(/\/config\/keywords$/, "/config/validate")} text={config} onErrors={setDraftErrors}/>
                    </>
                )}

                {error !== null && (
                    <ForceRefusal
                        messages={[error]}
                        lifts={lifts}
                        isRoot={isRoot}
                        onForce={() => submit(undefined, true, deploying)}
                        disabled={submitting}
                        forceLabel={t(held ? "createObject.force.held" : "createObject.force.replace")}
                    />
                )}
            </form>
            {/* The way on, or out: at the foot of the page, where the form ends. */}
            <div data-create-footer="" className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface py-3">
                {/* Pressed, it keeps the focus where it is: a field left would say its error, the
                    page growing, the button moved from under the pointer before it is released.
                    Something done, it asks before it is lost. */}
                {leaving ? (
                    <div role="group" aria-label={t("createObject.discardQuestion")} className="mr-auto flex flex-wrap items-center gap-2">
                        <span>{t("createObject.discardQuestion")}</span>
                        <Button variant="delete" onClick={leave} ref={discardRef}>{t("createObject.discard")}</Button>
                        <Button onClick={() => setLeaving(false)}>{t("createObject.keepEditing")}</Button>
                    </div>
                ) : (
                    <Button className="mr-auto" onMouseDown={(e) => e.preventDefault()} onClick={() => (dirty ? setLeaving(true) : leave())} disabled={submitting}>{t("common.cancel")}</Button>
                )}
                {at > 0 && !datastore && (
                    <Button onClick={() => setStep(STEPS[at - 1])} disabled={submitting || leaving}>{t("createObject.back")}</Button>
                )}
                {last ? (
                    <>
                        {/* Created only: provisioned later, from its actions. */}
                        <Button
                            variant="create"
                            type="submit"
                            form={`${ids}-form`}
                            disabled={submitting || draftErrors > 0}
                            icon={submitting && !deploying ? <Spinner label={t("createObject.creating")}/> : undefined}
                        >
                            {t("createObject.submit")}
                        </Button>
                        {/* Created, then provisioned once the daemons know it: the choice on the
                            button clicked, not in a box left behind the configuration. */}
                        {canProvision && (
                            <Button
                                variant="create"
                                onClick={() => submit(undefined, false, true)}
                                disabled={submitting || draftErrors > 0}
                                icon={submitting && deploying ? <Spinner label={t("createObject.deploying")}/> : undefined}
                            >
                                {t("createObject.deploy")}
                            </Button>
                        )}
                    </>
                ) : (
                    <Button type="submit" form={`${ids}-form`} disabled={step === "from" && !sourceReady}>{t("createObject.next")}</Button>
                )}
            </div>
        </section>
    );
};

export default CreateObject;
