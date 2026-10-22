import React, {useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_CLUSTER} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {extractSection} from "../utils/configSections.js";
import {
    COMMON_FIELDS,
    HB_FIELDS,
    HB_TYPES,
    hbOps,
    hbPreview,
    hbSections,
    missingFields,
    nextHbName,
    sectionValues,
} from "../app/heartbeat-config";
import {opsQuery} from "../app/namespace-claims";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Checkbox, Field, Input} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {ConfigText, findKeyword} from "./ConfigText";

const KEYWORDS_URL = `${URL_CLUSTER}/config/keywords`;

const headers = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

/** The cluster configuration file, its secrets told or not; an error said by the daemon thrown. */
async function readClusterConfig(redactSecrets) {
    const response = await fetch(`${URL_CLUSTER}/config/file?redact-secrets=${redactSecrets}`, {headers: headers()});
    if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
    return response.text();
}

/**
 * The configuration of a heartbeat, its `[hb#N]` section of the cluster configuration,
 * each key with its help. For root, `onEdit` opens the wizard on it; `onDeleted`, its
 * deletion, offered when `deletable`, another heartbeat having all its streams up, and
 * confirmed first; otherwise said why not.
 */
export function HeartbeatConfigDialog({name, onClose, onEdit, onDeleted, deletable = false}) {
    const {t} = useTranslation();
    const [section, setSection] = useState(undefined);
    const [error, setError] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);

    const remove = async () => {
        setDeleting(true);
        setDeleteError(null);
        try {
            const response = await fetch(`${URL_CLUSTER}/config?${opsQuery({delete: [name]})}`, {method: "PATCH", headers: headers()});
            if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
            onDeleted(name);
        } catch (err) {
            setDeleteError(err.message);
            setDeleting(false);
        }
    };
    useEffect(() => {
        let live = true;
        readClusterConfig(true).then(
            (text) => live && setSection(extractSection(text, name)),
            (err) => live && setError(err.message),
        );
        return () => {
            live = false;
        };
    }, [name]);
    return (
        <Dialog
            open
            size="md"
            title={t("heartbeats.config.title", {name})}
            onClose={onClose}
            footer={confirming ? (
                <>
                    <Button variant="secondary" onClick={() => setConfirming(false)} disabled={deleting}>{t("common.cancel")}</Button>
                    <Button variant="delete" onClick={remove} disabled={deleting}>
                        {deleting ? t("heartbeats.config.deleting") : t("heartbeats.config.delete")}
                    </Button>
                </>
            ) : (
                <>
                    {onDeleted && deletable && (
                        <Button variant="delete" className="mr-auto" onClick={() => setConfirming(true)} disabled={!section}>
                            {t("heartbeats.config.delete")}
                        </Button>
                    )}
                    <Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>
                    {onEdit && <Button onClick={onEdit} disabled={!section}>{t("heartbeats.config.edit")}</Button>}
                </>
            )}
        >
            {error && <Alert tone="error">{t("heartbeats.config.readFailed", {message: error})}</Alert>}
            {!error && section === undefined && <Spinner/>}
            {section === null && <p className="text-ink-muted">{t("heartbeats.config.none", {name})}</p>}
            {confirming ? (
                <div className="space-y-3">
                    <Alert tone="warning">{t("heartbeats.config.confirmDelete", {name})}</Alert>
                    {deleteError && <Alert tone="error">{t("heartbeats.config.deleteFailed", {message: deleteError})}</Alert>}
                </div>
            ) : (
                <>
                    {section && <ConfigText text={section} keywordsUrl={KEYWORDS_URL} label={t("heartbeats.config.title", {name})}/>}
                    {/* Root, no other heartbeat all up: why it may not be deleted. */}
                    {onDeleted && !deletable && section && (
                        <p className="mt-2 text-data text-ink-muted" data-delete-hint="">{t("heartbeats.config.notDeletable")}</p>
                    )}
                </>
            )}
        </Dialog>
    );
}

const STEPS = ["type", "settings", "review"];

/**
 * The wizard of a heartbeat, root only: its driver, the keys of it, the section as it
 * will be written, written to the cluster configuration, which the daemons apply. `name`,
 * the heartbeat its keys seed; none, a new one, named after the others. `nodes`, the
 * nodes of the cluster, an address each for a unicast heartbeat.
 */
export function HeartbeatWizard({name, nodes, onClose, onSaved}) {
    const {t} = useTranslation();
    const [file, setFile] = useState(undefined);
    const [keywords, setKeywords] = useState([]);
    const [values, setValues] = useState(null);
    const [step, setStep] = useState("type");
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    // The file, its secrets told, the wizard writing them back as they are; the help of the keywords.
    useEffect(() => {
        let live = true;
        readClusterConfig(false).then((text) => live && setFile(text), (err) => live && setError(err.message));
        fetch(KEYWORDS_URL, {headers: headers()})
            .then((response) => (response.ok ? response.json() : {items: []}))
            .then((data) => live && setKeywords(data.items ?? []), () => {});
        return () => {
            live = false;
        };
    }, []);
    const hbName = useMemo(() => name ?? (file === undefined ? null : nextHbName(hbSections(file))), [name, file]);
    const original = useMemo(() => (name && file !== undefined ? sectionValues(extractSection(file, name)) : {}), [name, file]);
    useEffect(() => {
        if (file !== undefined && values === null) setValues({...original});
    }, [file, original, values]);

    const type = values?.type;
    const missing = type ? missingFields(type, values) : [];
    const ops = values && type ? hbOps(hbName, original, values) : {rewrite: false, set: [], unset: []};
    const canNext = step === "type" ? Boolean(type) : step === "settings" ? missing.length === 0 : false;
    const index = STEPS.indexOf(step);
    const set = (key, value) => setValues((prev) => ({...prev, [key]: value}));
    const help = (key) => findKeyword(keywords, {section: hbName ?? "hb", key, type});

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const patch = async (query) => {
                const response = await fetch(`${URL_CLUSTER}/config?${query}`, {method: "PATCH", headers: headers()});
                if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
            };
            // Another driver: the section of the former gone first, its keys meaning nothing to the new one.
            if (ops.rewrite) await patch(opsQuery({delete: [hbName]}));
            if (ops.set.length > 0 || ops.unset.length > 0) await patch(opsQuery({set: ops.set, unset: ops.unset}));
            onSaved(hbName);
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    /** A field of a keyword: its help under it, its default as a placeholder. */
    const field = (key, label, kind) => {
        const keyword = help(key.split("@")[0]);
        const placeholder = keyword?.defaultText || keyword?.default || "";
        if (kind === "bool") {
            return (
                <div key={key}>
                    <Checkbox label={label} checked={values[key] === "true"} onChange={(event) => set(key, event.target.checked ? "true" : "")}/>
                    {keyword?.text && <p className="mt-1 text-data text-ink-muted">{keyword.text}</p>}
                </div>
            );
        }
        return (
            <Field key={key} label={label} hint={keyword?.text || undefined}>
                {(control) => (
                    <Input
                        {...control}
                        inputMode={kind === "number" ? "numeric" : undefined}
                        value={values[key] ?? ""}
                        placeholder={String(placeholder)}
                        onChange={(event) => set(key, event.target.value)}
                    />
                )}
            </Field>
        );
    };

    return (
        <Dialog
            open
            size="md"
            title={name ? t("heartbeats.wizard.editTitle", {name}) : t("heartbeats.wizard.newTitle", {name: hbName ?? "hb"})}
            onClose={onClose}
            footer={(
                <>
                    <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
                    {index > 0 && <Button variant="secondary" onClick={() => setStep(STEPS[index - 1])} disabled={saving}>{t("heartbeats.wizard.back")}</Button>}
                    {step === "review" ? (
                        <Button onClick={save} disabled={saving || (ops.set.length === 0 && ops.unset.length === 0 && !ops.rewrite)}>
                            {saving ? t("heartbeats.wizard.saving") : t("heartbeats.wizard.save")}
                        </Button>
                    ) : (
                        <Button onClick={() => setStep(STEPS[index + 1])} disabled={!canNext}>{t("heartbeats.wizard.next")}</Button>
                    )}
                </>
            )}
        >
            {values === null && !error && <Spinner/>}
            {values === null && error && <Alert tone="error">{t("heartbeats.config.readFailed", {message: error})}</Alert>}
            {values !== null && (
                <div className="space-y-4">
                    <ol aria-label={t("heartbeats.wizard.steps")} className="flex flex-wrap gap-x-3 gap-y-1 text-data">
                        {STEPS.map((s, i) => (
                            <li key={s} aria-current={s === step ? "step" : undefined} className={s === step ? "font-semibold text-ink" : "text-ink-muted"}>
                                {`${i + 1}. ${t(`heartbeats.wizard.step.${s}`)}`}
                            </li>
                        ))}
                    </ol>

                    {step === "type" && (
                        <fieldset className="space-y-2">
                            <legend className="mb-1 font-medium">{t("heartbeats.wizard.typeQuestion")}</legend>
                            {HB_TYPES.map((kind) => (
                                <label key={kind} className="flex cursor-pointer items-start gap-2 rounded-(--radius-control) border border-line p-2 hover:bg-surface-sunken">
                                    <input type="radio" name="hb-type" value={kind} checked={type === kind} onChange={() => set("type", kind)} className="mt-1"/>
                                    <span>
                                        <span className="block font-medium">{kind}</span>
                                        <span className="block text-data text-ink-muted">{t(`heartbeats.wizard.types.${kind}`)}</span>
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                    )}

                    {step === "settings" && (
                        <div className="space-y-4" data-step="settings">
                            {HB_FIELDS[type].map((one) => (one.perNode ? (
                                // An address a node: one for all would not do.
                                <fieldset key={one.key} className="space-y-2">
                                    <legend className="mb-1 font-medium">{one.key}</legend>
                                    <p className="text-data text-ink-muted">{t("heartbeats.wizard.perNode")}</p>
                                    {nodes.map((node) => field(`${one.key}@${node}`, t("heartbeats.wizard.onNode", {key: one.key, node})))}
                                </fieldset>
                            ) : field(one.key, one.required ? t("heartbeats.wizard.required", {key: one.key}) : one.key, one.kind)))}
                            {COMMON_FIELDS.map((one) => field(one.key, one.key, one.kind))}
                        </div>
                    )}

                    {step === "review" && (
                        <div className="space-y-3">
                            {ops.rewrite && <Alert tone="warning">{t("heartbeats.wizard.rewrite", {from: original.type, to: type})}</Alert>}
                            <div>
                                <p className="mb-1 text-data text-ink-muted">{t("heartbeats.wizard.written")}</p>
                                <pre data-testid="hb-preview" className="rounded-(--radius-control) border border-line bg-surface-sunken p-2 font-mono text-data">
                                    {hbPreview(hbName, original, values)}
                                </pre>
                            </div>
                            {ops.set.length === 0 && ops.unset.length === 0 && !ops.rewrite && <p className="text-ink-muted">{t("heartbeats.wizard.unchanged")}</p>}
                            {error && <Alert tone="error">{t("heartbeats.wizard.saveFailed", {message: error})}</Alert>}
                        </div>
                    )}
                </div>
            )}
        </Dialog>
    );
}
