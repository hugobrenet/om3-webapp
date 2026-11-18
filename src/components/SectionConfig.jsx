import React, {useCallback, useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_CLUSTER, URL_NODES} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {extractSection} from "../utils/configSections.js";
import {trackRefused, trackWrite} from "../app/action-tracker";
import {opsQuery} from "../app/namespace-claims";
import {bodyOps, parseBody, sectionBody} from "../app/section-config";
import {useGrants} from "../hooks/useGrants";
import {useClusterConfigChanges} from "../hooks/useLiveChanges";
import {refusalReason} from "./objectActions";
import {ConfigText} from "./ConfigText";
import {Alert} from "../ui/components/Alert";
import {Button, IconButton} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Textarea} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {PencilIcon, SlidersIcon, TrashIcon} from "../ui/icons";

const KEYWORDS_URL = `${URL_CLUSTER}/config/keywords`;

const headers = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

/** The answer of a read, its JSON or its text; an error said by the daemon thrown. */
export async function read(url, as = "json") {
    const response = await fetch(url, {headers: headers()});
    if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
    return as === "json" ? response.json() : response.text();
}

/** The nodes of the cluster, sorted (GET /api/node). */
export const readNodes = async () => ((await read(URL_NODES)).items ?? []).map((n) => n.meta?.node).filter(Boolean).sort();

/**
 * A section of the cluster configuration, `[<section>#<name>]`: its text, null for one
 * of none (one built in, as the network `lo`), undefined while read; `reload`, read again.
 * Read again as the cluster configuration changes, what was read kept shown meanwhile.
 */
export function useClusterSection(section, name) {
    const [state, setState] = useState({section: undefined, error: null, of: undefined});
    const [version, setVersion] = useState(0);
    const changes = useClusterConfigChanges();
    useEffect(() => {
        let live = true;
        const of = `${section}#${name}`;
        read(`${URL_CLUSTER}/config/file?redact-secrets=true`, "text").then(
            (text) => live && setState({section: extractSection(text, of), error: null, of}),
            // A failure keeps the section read, said only when none was.
            (err) => live && setState((s) => (s.of === of ? s : {section: null, error: err.message, of: undefined})),
        );
        return () => {
            live = false;
        };
    }, [section, name, version, changes]);
    const reload = useCallback(() => setVersion((v) => v + 1), []);
    return {section: state.section, error: state.error, reload};
}

/**
 * The delete of a section, root only: a tool removing it from the cluster
 * configuration, confirmed first, said how much it still hands out (`inUse`, read
 * when asked).
 */
function SectionDelete({section, name, prefix, inUse, onDeleted}) {
    const {t} = useTranslation();
    const p = (key, options) => t(`${prefix}.${key}`, options);
    const [confirming, setConfirming] = useState(false);
    const [used, setUsed] = useState(0);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);

    const ask = () => {
        setDeleteError(null);
        setUsed(0);
        setConfirming(true);
        inUse?.(name).then((count) => setUsed(count ?? 0), () => {});
    };

    const remove = async () => {
        const write = {action: "config", label: p("tray", {name}), subject: name};
        setDeleting(true);
        setDeleteError(null);
        try {
            const response = await fetch(`${URL_CLUSTER}/config?${opsQuery({delete: [`${section}#${name}`]})}`, {method: "PATCH", headers: headers()});
            const ok = await trackWrite(response, write, async (r) => {
                const detail = await getResponseErrorMessage(r);
                setDeleteError(detail || `HTTP ${r.status}`);
                return refusalReason({status: r.status, detail});
            });
            if (ok) {
                setConfirming(false);
                onDeleted?.(name);
            }
        } catch (err) {
            trackRefused({...write, reason: err.message});
            setDeleteError(err.message);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            <IconButton tone="delete" label={p("delete")} onClick={ask}>
                <TrashIcon/>
            </IconButton>
            <Dialog
                open={confirming}
                size="sm"
                title={p("confirmTitle", {name})}
                onClose={() => !deleting && setConfirming(false)}
                footer={(
                    <>
                        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={deleting}>{t("common.cancel")}</Button>
                        <Button variant="delete" onClick={remove} disabled={deleting}>
                            {deleting ? p("deleting") : p("delete")}
                        </Button>
                    </>
                )}
            >
                <div className="space-y-3">
                    <p>{p("confirmText", {name})}</p>
                    {used > 0 && <Alert tone="warning">{p("inUse", {count: used})}</Alert>}
                    {deleteError && <Alert tone="error">{p("deleteFailed", {message: deleteError})}</Alert>}
                </div>
            </Dialog>
        </>
    );
}

/**
 * A section of the cluster configuration, `[<section>#<name>]`, each key with its help;
 * a built-in one said so. Root edits it in place, its lines but its header: written as
 * the keys changed set and those gone unset, in one write, the rest of the file left
 * alone; a section changed since the edit started not overwritten. Root modifies it in
 * the wizard too, `renderWizard({items, nodes, edit, onClose, onSaved})` seeded with
 * it, `listUrl` the sections there are; and deletes it, `inUse(name)` how much it still
 * hands out, `onDeleted`, then. `prefix`, the keys of its texts.
 */
export function SectionConfig({section, name, prefix, listUrl, renderWizard, inUse, onDeleted}) {
    const {t} = useTranslation();
    const p = (key, options) => t(`${prefix}.${key}`, options);
    const isRoot = Object.prototype.hasOwnProperty.call(useGrants(), "root");
    // Read again as it changes; an edit open keeps its draft, checked against the stored section on save.
    const {section: text, error, reload} = useClusterSection(section, name);
    const [edit, setEdit] = useState(null);
    const [saving, setSaving] = useState(false);
    const [editError, setEditError] = useState(null);
    const header = `[${section}#${name}]`;

    // The section as stored, its secrets in clear: what an edit starts from and is checked against.
    const readStored = async () => sectionBody(extractSection(await read(`${URL_CLUSTER}/config/file?redact-secrets=false`, "text"), `${section}#${name}`));

    // The wizard seeded with the section as stored, the sections and the nodes it checks against.
    const [wizard, setWizard] = useState(null);
    const startWizard = async () => {
        setEditError(null);
        try {
            const [body, list, nodes] = await Promise.all([readStored(), read(listUrl), readNodes()]);
            setWizard({values: parseBody(body).values, items: list.items ?? [], nodes});
        } catch (err) {
            setEditError(p("readFailed", {message: err.message}));
        }
    };

    const startEdit = async () => {
        setEditError(null);
        try {
            const body = await readStored();
            setEdit({base: body, text: body});
        } catch (err) {
            setEditError(p("readFailed", {message: err.message}));
        }
    };

    const save = async () => {
        const ops = bodyOps(section, name, edit.base, edit.text);
        if (ops.invalid.length > 0) {
            setEditError(p("invalidLines", {lines: ops.invalid.join(" · ")}));
            return;
        }
        const write = {action: "config", label: p("trayEdit", {name}), subject: name};
        setSaving(true);
        setEditError(null);
        try {
            if ((await readStored()) !== edit.base) {
                setEditError(t("config.feedback.conflict"));
                return;
            }
            const response = await fetch(`${URL_CLUSTER}/config?${opsQuery({set: ops.set, unset: ops.unset})}`, {method: "PATCH", headers: headers()});
            const ok = await trackWrite(response, write, async (r) => {
                const detail = await getResponseErrorMessage(r);
                setEditError(t("config.feedback.updateFailed", {message: detail || `HTTP ${r.status}`}));
                return refusalReason({status: r.status, detail});
            });
            if (ok) {
                setEdit(null);
                reload();
            }
        } catch (err) {
            trackRefused({...write, reason: err.message});
            setEditError(t("config.feedback.updateFailed", {message: err.message}));
        } finally {
            setSaving(false);
        }
    };

    if (error) return <Alert tone="error">{p("readFailed", {message: error})}</Alert>;
    if (text === undefined) return <Spinner/>;

    if (edit !== null) {
        const ops = bodyOps(section, name, edit.base, edit.text);
        const unchanged = ops.set.length === 0 && ops.unset.length === 0 && ops.invalid.length === 0;
        return (
            <div className="space-y-2">
                {editError && <Alert tone="error">{editError}</Alert>}
                {/* The header fixed: the name of the section is not edited here. */}
                <p className="font-mono text-data text-ink-muted">{header}</p>
                <Textarea
                    aria-label={p("configOf", {name})}
                    value={edit.text}
                    onChange={(e) => setEdit({...edit, text: e.target.value})}
                    disabled={saving}
                    spellCheck={false}
                    rows={Math.min(30, Math.max(8, edit.text.split("\n").length + 1))}
                    className="font-mono text-data whitespace-pre"
                />
                <p className="text-data text-ink-muted">{p("editHint")}</p>
                <div className="flex justify-end gap-2">
                    <Button onClick={() => {
                        setEdit(null);
                        setEditError(null);
                    }} disabled={saving}>{t("common.cancel")}</Button>
                    <Button onClick={save} disabled={saving || unchanged}
                            icon={saving ? <Spinner label={t("config.view.saving")}/> : undefined}>
                        {t("common.save")}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {isRoot && (
                <div className="flex items-center justify-end gap-1">
                    {/* A section of its own: modified in the wizard, seeded with it. */}
                    {text && (
                        <IconButton label={p("modify", {name})} onClick={startWizard}>
                            <SlidersIcon/>
                        </IconButton>
                    )}
                    <IconButton label={p("edit", {name})} onClick={startEdit}>
                        <PencilIcon/>
                    </IconButton>
                    {/* A built-in one has no section to delete. */}
                    {text && <SectionDelete section={section} name={name} prefix={prefix} inUse={inUse} onDeleted={onDeleted}/>}
                </div>
            )}
            {wizard && renderWizard({
                items: wizard.items,
                nodes: wizard.nodes,
                edit: {name, values: wizard.values},
                onClose: () => setWizard(null),
                onSaved: () => {
                    setWizard(null);
                    reload();
                },
            })}
            {editError && <Alert tone="error">{editError}</Alert>}
            {text === null
                ? <p className="text-ink-muted">{p("builtIn", {name})}</p>
                : <ConfigText text={text} keywordsUrl={KEYWORDS_URL} label={p("configOf", {name})}/>}
        </div>
    );
}
