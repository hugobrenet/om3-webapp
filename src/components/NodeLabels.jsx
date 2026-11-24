import React, {useCallback, useEffect, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {Button, IconButton} from "../ui/components/Button";
import {CloseIcon, PencilIcon, PlusIcon, ResetIcon} from "../ui/icons";
import {URL_CLUSTER, URL_NODE} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {trackRefused, trackWrite} from "../app/action-tracker";
import {refusalReason} from "./objectActions";
import {setOp} from "../app/keyop";
import {anyOf, useClusterConfigChanges, useNodeConfigChanges} from "../hooks/useLiveChanges";

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") ?? ""}`});

/** A label key: letters, digits, dot, dash, underscore; no space, no equal sign. */
const KEY = /^[A-Za-z0-9_.-]+$/;

/**
 * A label typed in one field, `key=value` or `key value`, spaces allowed around the
 * equal sign; a key alone, an empty value. Null when the key is not one.
 */
export function parseLabel(text) {
    const m = text.trim().match(/^([^\s=]+)(?:\s*=\s*|\s+|$)([\s\S]*)$/);
    if (!m || !KEY.test(m[1])) return null;
    return {key: m[1], value: m[2].trim()};
}

/** The labels of a configuration answer (`labels.<key>`), as a map. */
const labelsOf = (items = []) => Object.fromEntries(items
    .filter((i) => i.keyword?.startsWith("labels."))
    .map((i) => [i.keyword.slice("labels.".length), i.value ?? ""]));

/**
 * The labels of `node` and those of the cluster: read from the node configuration
 * (its own) and the cluster configuration (the defaults its own override). Read
 * again as either changes, by om or another user: what was read kept shown
 * meanwhile, and when a read again fails; only the last read asked shown.
 */
export function useNodeLabels(node) {
    const [state, setState] = useState(null);
    const asked = useRef(0);
    const reload = useCallback(async () => {
        asked.current += 1;
        const mine = asked.current;
        const read = async (url) => {
            const response = await fetch(url, {headers: authHeaders()});
            return response.ok ? labelsOf((await response.json()).items) : null;
        };
        let own = null;
        let cluster = null;
        try {
            [own, cluster] = await Promise.all([
                read(`${URL_NODE}/${encodeURIComponent(node)}/config`),
                read(`${URL_CLUSTER}/config`),
            ]);
        } catch {
            // Neither read: what was shown kept.
        }
        if (mine !== asked.current) return;
        setState((shown) => ({own: own ?? shown?.own ?? {}, cluster: cluster ?? shown?.cluster ?? {}}));
    }, [node]);
    // Another node: nothing of the one before shown while its labels are read.
    useEffect(() => {
        setState(null);
    }, [node]);
    const changes = anyOf(useNodeConfigChanges(node), useClusterConfigChanges());
    useEffect(() => {
        void reload();
    }, [reload, changes]);
    return {labels: state, reload};
}

const BADGE = "inline-flex items-center gap-1 rounded-(--radius-control) border px-1.5 py-0.5 text-data";

/**
 * The labels of the node as badges, the key bold before the value (a key has no
 * space: no separator needed): its own solid, those it takes from
 * the cluster dashed and muted. Root edits them in a buffer: a value changed, a
 * label of its own removed, one of the cluster given a value of its own, a label
 * added; applied at once, in one write of the node configuration.
 */
export function NodeLabels({node, mayEdit}) {
    const {t} = useTranslation();
    const {labels, reload} = useNodeLabels(node);
    const [editing, setEditing] = useState(false);
    // The changes by key: a value, or null for a label removed.
    const [buffer, setBuffer] = useState({});
    // The label typed in the field the plus card opens; null, the card closed.
    const [draft, setDraft] = useState(null);
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState(null);

    if (labels === null) return null;
    const merged = {...labels.cluster, ...labels.own};
    const keys = [...new Set([...Object.keys(merged), ...Object.keys(buffer)])].sort((a, b) => a.localeCompare(b));
    const count = Object.keys(buffer).length;
    const draftInvalid = draft !== null && draft.trim() !== "" && parseLabel(draft) === null;

    const change = (key, value) => setBuffer((b) => {
        const next = {...b};
        const current = key in labels.own ? labels.own[key] : undefined;
        if (value === current) delete next[key];
        else next[key] = value;
        return next;
    });
    const revert = (key) => setBuffer((b) => {
        const next = {...b};
        delete next[key];
        return next;
    });
    // The label typed added to the buffer, the card closed; an empty field just closes it.
    const add = () => {
        if (draft === null || draft.trim() === "") {
            setDraft(null);
            return;
        }
        const label = parseLabel(draft);
        if (!label) return;
        change(label.key, label.value);
        setDraft(null);
    };
    const discard = () => {
        setBuffer({});
        setDraft(null);
        setError(null);
        setEditing(false);
    };
    const apply = async () => {
        if (count === 0 || applying) return;
        const query = Object.entries(buffer)
            .map(([key, value]) => (value === null
                ? `unset=${encodeURIComponent(`labels.${key}`)}`
                : `set=${encodeURIComponent(setOp(`labels.${key}`, value))}`))
            .join("&");
        const write = {action: "config", label: t("nodeLabels.tray", {count}), subject: node};
        setApplying(true);
        setError(null);
        try {
            const response = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/config?${query}`, {method: "PATCH", headers: authHeaders()});
            const ok = await trackWrite(response, write, async (r) => {
                const detail = await getResponseErrorMessage(r);
                setError(detail || `HTTP ${r.status}`);
                return refusalReason({status: r.status, detail});
            });
            if (ok) {
                setBuffer({});
                setEditing(false);
                await reload();
            }
        } catch (err) {
            trackRefused({...write, reason: err.message});
            setError(err.message);
        } finally {
            setApplying(false);
        }
    };

    const badge = (key) => {
        const removed = buffer[key] === null;
        const value = key in buffer && !removed ? buffer[key] : merged[key];
        const own = key in labels.own || (key in buffer && !removed);
        const changed = key in buffer;
        if (!editing) {
            return (
                <span
                    key={key}
                    data-label={key}
                    className={`${BADGE} ${own ? "border-line text-ink" : "border-dashed border-line text-ink-muted"}`}
                >
                    <span className="font-medium">{key}</span>
                    {value !== "" && <span>{value}</span>}
                </span>
            );
        }
        return (
            <span key={key} data-label={key}
                  className={`${BADGE} ${changed ? "border-accent bg-accent-soft" : own ? "border-line" : "border-dashed border-line"} ${removed ? "line-through opacity-60" : ""}`}>
                <span className="font-medium">{key}</span>
                <input
                    aria-label={t("nodeLabels.valueOf", {key})}
                    value={removed ? merged[key] ?? "" : value ?? ""}
                    disabled={removed}
                    onChange={(e) => change(key, e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    size={Math.max(4, String(value ?? "").length + 1)}
                    className="min-w-0 bg-transparent outline-none"
                />
                {changed ? (
                    <IconButton size="sm" label={t("nodeLabels.revert", {key})} onClick={() => revert(key)}>
                        <ResetIcon className="h-3 w-3"/>
                    </IconButton>
                ) : key in labels.own ? (
                    // Its own removed; one of the cluster stays, its default.
                    <IconButton size="sm" label={t("nodeLabels.remove", {key})} onClick={() => change(key, null)}>
                        <CloseIcon className="h-3 w-3"/>
                    </IconButton>
                ) : null}
            </span>
        );
    };

    return (
        <section aria-labelledby={`node-labels-${node}`} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <h3 id={`node-labels-${node}`} className="font-semibold">
                    {t("nodeLabels.title")}
                    <span className="ml-1.5 font-normal text-ink-muted tabular-nums">{Object.keys(merged).length}</span>
                </h3>
                {mayEdit && !editing && (
                    <IconButton size="sm" label={t("nodeLabels.edit")} onClick={() => setEditing(true)}>
                        <PencilIcon className="h-3 w-3"/>
                    </IconButton>
                )}
            </div>
            {keys.length === 0 && !editing && <p className="text-ink-muted">{t("nodeLabels.none")}</p>}
            <div className="flex flex-wrap gap-1.5">
                {keys.map(badge)}
                {/* A new one: a plus card among the badges, opening one field. A plus card keeps this look, out of the rule of the buttons (`Button`). */}
                {editing && (draft === null ? (
                    <button
                        type="button"
                        onClick={() => setDraft("")}
                        className={`${BADGE} border-dashed border-line text-ink-muted hover:border-accent hover:text-accent`}
                    >
                        <PlusIcon className="h-3 w-3"/>
                        {t("nodeLabels.add")}
                    </button>
                ) : (
                    <span className={`${BADGE} ${draftInvalid ? "border-state-down" : "border-accent"}`}>
                        <input
                            aria-label={t("nodeLabels.new")}
                            placeholder={t("nodeLabels.newHint")}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    add();
                                } else if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setDraft(null);
                                }
                            }}
                            onBlur={add}
                            aria-invalid={draftInvalid || undefined}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            size={Math.max(16, draft.length + 1)}
                            className="min-w-0 bg-transparent outline-none"
                        />
                    </span>
                ))}
            </div>
            {editing && (
                <div className="space-y-2">
                    {draftInvalid && <p className="text-data text-state-down">{t("nodeLabels.keyInvalid")}</p>}
                    <div role="region" aria-label={t("nodeLabels.bar")}
                         className="flex flex-wrap items-center gap-2 rounded-(--radius-panel) border border-accent bg-accent-soft px-3 py-2">
                        <span className="mr-auto">{t("nodeLabels.pending", {count})}</span>
                        <Button size="sm" onClick={discard} disabled={applying}>{t("nodePanel.orgEdit.discard")}</Button>
                        <Button size="sm" onClick={apply} disabled={count === 0 || applying}>
                            {applying ? t("nodePanel.orgEdit.applying") : t("nodePanel.orgEdit.apply", {count})}
                        </Button>
                    </div>
                    {error && <Alert>{t("nodePanel.orgEdit.refused", {message: error})}</Alert>}
                </div>
            )}
        </section>
    );
}
