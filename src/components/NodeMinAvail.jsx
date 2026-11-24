import React, {useCallback, useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Field, Input} from "../ui/components/Field";
import {URL_NODE} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {trackRefused, trackWrite} from "../app/action-tracker";
import {refusalReason} from "./objectActions";
import {setOp} from "../app/keyop";

/**
 * The minimum free memory and swap of a node (`node.min_avail_mem`,
 * `node.min_avail_swap`): below it, the node is overloaded and the daemon starts
 * nothing on it. A share of the total, a percentage or a size; a size of memory read
 * as 50% at most, a percentage as written; 0 turns the check off.
 */
export const MIN_AVAIL = {
    mem: {keyword: "node.min_avail_mem", fallback: "2%", cap: 50},
    swap: {keyword: "node.min_avail_swap", fallback: "10%", cap: 100},
};

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") ?? ""}`});

/**
 * The thresholds of `node` as its configuration has them: per kind, the value
 * written (empty for the default) and the one in force (`10%`). `reload` reads them
 * again, after a change.
 */
export function useMinAvail(node) {
    const [state, setState] = useState(null);
    const reload = useCallback(async () => {
        try {
            const query = new URLSearchParams([["kw", MIN_AVAIL.mem.keyword], ["kw", MIN_AVAIL.swap.keyword], ["evaluate", "true"]]);
            const response = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/config?${query}`, {headers: authHeaders()});
            if (!response.ok) return;
            const {items = []} = await response.json();
            const of = (kind) => {
                const item = items.find((i) => i.keyword === MIN_AVAIL[kind].keyword) ?? {};
                return {written: item.value ?? "", text: item.evaluated_text || MIN_AVAIL[kind].fallback};
            };
            setState({mem: of("mem"), swap: of("swap")});
        } catch {
            // Not read: the thresholds are not shown, the rest of the health is.
        }
    }, [node]);
    useEffect(() => {
        void reload();
    }, [reload]);
    return {thresholds: state, reload};
}

const UNITS = {k: 1 / 1024, m: 1, g: 1024, t: 1024 * 1024};

/**
 * The percentage of `totalMiB` a threshold amounts to, as the daemon reads it
 * (sizeconv.Share): a percentage as is, a whole number from 0 to 100, never capped;
 * a size as the whole percentage of the total, at `cap` most, none (0) of a total
 * of 0, as a node without swap; null when it cannot be read, or the total is not
 * known yet.
 */
export function thresholdPct(text, totalMiB, cap) {
    const value = String(text ?? "").trim().toLowerCase();
    if (value === "") return null;
    const pct = /^(\d+)\s*%?$/.exec(value);
    if (pct) {
        const n = Number(pct[1]);
        return n <= 100 ? n : null;
    }
    const size = /^(\d+(?:\.\d+)?)\s*([kmgt])i?b?$/.exec(value);
    if (!size || typeof totalMiB !== "number") return null;
    if (totalMiB <= 0) return 0;
    return Math.min(cap, Math.floor((Number(size[1]) * UNITS[size[2]] * 100) / totalMiB));
}

/**
 * Sets the minimum free memory or swap (`kind`) of `node`: typed, as a percentage
 * or a size, or chosen; empty, the default. Said with what the node has free now
 * (`freePct` of `totalMiB`), and whether it would be overloaded with the value typed.
 */
export function MinAvailDialog({node, kind, written, freePct, totalMiB, onClose, onSaved}) {
    const {t} = useTranslation();
    const {keyword, fallback, cap} = MIN_AVAIL[kind];
    const [value, setValue] = useState(written ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const pct = thresholdPct(value === "" ? fallback : value, totalMiB, cap);
    const invalid = value.trim() !== "" && pct === null;
    const choices = [["", t("nodeHealth.default", {value: fallback})], ["5%", "5%"], ["10%", "10%"], ["20%", "20%"], ["0", t("nodeHealth.off")]];

    const save = async (event) => {
        event?.preventDefault();
        if (invalid || saving) return;
        const next = value.trim();
        const write = {
            action: "config",
            label: next === "" ? t("actionTray.writes.unset", {keyword}) : t("actionTray.writes.set", {keyword, value: next}),
            subject: node,
        };
        setSaving(true);
        setError(null);
        try {
            const query = next === "" ? `unset=${encodeURIComponent(keyword)}` : `set=${encodeURIComponent(setOp(keyword, next))}`;
            const response = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/config?${query}`, {method: "PATCH", headers: authHeaders()});
            const ok = await trackWrite(response, write, async (r) => {
                const detail = await getResponseErrorMessage(r);
                setError(detail || `HTTP ${r.status}`);
                return refusalReason({status: r.status, detail});
            });
            if (ok) {
                onSaved?.();
                onClose();
            }
        } catch (err) {
            trackRefused({...write, reason: err.message});
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open
            onClose={onClose}
            title={t(`nodeHealth.${kind}.title`, {node})}
            footer={(
                <>
                    <Button onMouseDown={(e) => e.preventDefault()} onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
                    <Button type="submit" form="min-avail-form" disabled={invalid || saving}>{t("common.save")}</Button>
                </>
            )}
        >
            <form id="min-avail-form" onSubmit={save} noValidate className="space-y-3">
                <p>{t(`nodeHealth.${kind}.why`)}</p>
                {freePct !== undefined && <p className="text-ink-muted">{t("nodeHealth.now", {pct: freePct})}</p>}
                <Field label={t("nodeHealth.minimum")} hint={t(`nodeHealth.${kind}.hint`, {value: fallback})}
                       error={invalid ? t("nodeHealth.invalid") : null}>
                    {(control) => (
                        <Input {...control} value={value} placeholder={fallback} autoComplete="off" spellCheck={false}
                               onChange={(e) => setValue(e.target.value)} className="w-40"/>
                    )}
                </Field>
                <div role="group" aria-label={t("nodeHealth.choices")} className="flex flex-wrap gap-1">
                    {choices.map(([choice, label]) => (
                        <button
                            key={label}
                            type="button"
                            aria-pressed={value.trim() === choice}
                            onClick={() => setValue(choice)}
                            className="rounded-(--radius-control) border border-line px-2 py-0.5 text-data text-ink-muted hover:text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink"
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {!invalid && pct !== null && freePct !== undefined && (
                    <p className={pct > 0 && freePct < pct ? "text-state-warn" : "text-ink-muted"}>
                        {pct === 0
                            ? t("nodeHealth.previewOff")
                            : freePct < pct
                                ? t("nodeHealth.previewOverloaded", {pct})
                                : t("nodeHealth.previewFine", {pct})}
                    </p>
                )}
                {error && <Alert>{t("nodeHealth.refused", {message: error})}</Alert>}
            </form>
        </Dialog>
    );
}
