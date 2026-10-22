import React, {useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_OBJECT} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {trackDone, trackRefused} from "../app/action-tracker";
import {refusalReason} from "./objectActions";
import i18n from "../i18n";
import {useNamespaceClaims, useNamespacePg} from "../hooks/useNamespaceUsage";
import {useGrants} from "../hooks/useGrants";
import {computeLimit, formatCpu, networkUsage, poolUsage} from "../app/namespace-usage";
import {
    CLAIM_TYPES,
    SIZE_UNITS,
    canWriteClaims,
    claimOps,
    formatLimit,
    isNamed,
    limitError,
    limitValue,
    nextSection,
    opsQuery,
    toInput,
} from "../app/namespace-claims";
import {newId, withId} from "../app/object-create";
import {Alert} from "../ui/components/Alert";
import {Button, IconButton} from "../ui/components/Button";
import {PlusIcon} from "../ui/icons";
import {Dialog} from "../ui/components/Dialog";
import {Field, Input, Select} from "../ui/components/Field";
import {UsageBar} from "../ui/components/UsageBar";
import {formatBytes} from "../ui/lib/format";
import {DataTable, Section} from "./NodePanel";
import {CrossLink} from "../app/CrossLink";

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});
const configUrl = (namespace) => `${URL_OBJECT}/${encodeURIComponent(namespace)}/nscfg/namespace/config`;

/**
 * What a namespace claims and takes of the cluster, a line each: every claim of its
 * configuration, and the pools and networks it uses without claiming of them, out
 * of their size then. The cpu and memory are the usage now, against the claimed cap.
 * Each line carries its claim, if any: what an edit or a removal acts on.
 */
export function claimLines(namespace, claims, pg) {
    const own = claims.claims[namespace] ?? [];
    const lines = [];
    for (const [type, usage] of [
        ["pool", poolUsage(namespace, claims.poolsHeld, claims.pools, own)],
        ["network", networkUsage(namespace, claims.networksHeld, claims.networks, own)],
    ]) {
        for (const s of usage.segments) {
            const claim = own.find((c) => c.type === type && c.name === s.name);
            lines.push({type, name: s.name, used: s.used, limit: s.total, claimed: s.claimed, claim});
        }
    }
    for (const type of ["cpu", "memory"]) {
        const claim = own.find((c) => c.type === type);
        const limit = computeLimit(own, type);
        // Over every node of the cluster; the cpu none until a second reading.
        const used = pg[namespace]?.[type] ?? undefined;
        if (claim !== undefined || used !== undefined) {
            lines.push({type, used, limit, claimed: limit !== undefined, claim});
        }
    }
    return lines;
}

/** An amount in the unit of a claim type: a size, addresses, cpus. */
function useAmount() {
    const {i18n} = useTranslation();
    const locale = i18n.language;
    return (type, value) => {
        if (value === undefined) return "–";
        if (type === "pool" || type === "memory") return value > 0 ? formatBytes(value, locale) : "0";
        if (type === "cpu") return formatCpu(value, locale);
        return value.toLocaleString(locale);
    };
}

/**
 * The second tab of a namespace: its claims, what it takes of each and what is left.
 * Root and the squatters, who alone may write a namespace configuration, add,
 * change and remove them, each in a wizard.
 */
export function NamespaceClaims({namespace}) {
    const {t} = useTranslation();
    const namespaces = useMemo(() => [namespace], [namespace]);
    const claims = useNamespaceClaims(namespaces);
    const pg = useNamespacePg();
    const grants = useGrants();
    const canWrite = canWriteClaims(grants);
    const amount = useAmount();
    const lines = claimLines(namespace, claims, pg);
    const own = claims.claims[namespace] ?? [];
    const hasClaims = own.length > 0;
    // The wizard open: a new claim, its type or pool already chosen or not, or an edit.
    const [wizard, setWizard] = useState(null);
    const [removing, setRemoving] = useState(null);

    const nameOf = (line) => line.name ?? t(`namespaces.panel.types.${line.type}`);
    const columns = [
        {key: "type", label: t("namespaces.panel.resource"), className: "font-medium", render: (line) => (
            <span className="whitespace-nowrap">
                {t(`namespaces.panel.types.${line.type}`)}
                {line.name && (
                    <span className="ml-1.5 font-mono text-data">
                        {line.type === "network" ? <CrossLink kind="network" id={line.name}>{line.name}</CrossLink> : line.name}
                    </span>
                )}
            </span>
        )},
        {key: "used", label: t("namespaces.usage.used"), numeric: true, render: (line) => amount(line.type, line.used)},
        {key: "limit", label: t("namespaces.panel.limit"), numeric: true, render: (line) => (line.claimed
            ? amount(line.type, line.limit)
            : line.limit === undefined
                ? t("namespaces.usage.noClaim")
                : t("namespaces.panel.sizeOf", {size: amount(line.type, line.limit), of: t(`namespaces.panel.sizeOfType.${line.type}`)}))},
        {key: "share", label: t("namespaces.panel.share"), render: (line) => (
            <UsageBar
                value={line.limit > 0 && line.used !== undefined ? (line.used / line.limit) * 100 : undefined}
                label={t("namespaces.panel.shareOf", {name: nameOf(line)})}
            />
        )},
        {key: "free", label: t("namespaces.usage.free"), numeric: true, render: (line) => (line.limit > 0
            ? amount(line.type, Math.max(0, line.limit - (line.used ?? 0)))
            : "–")},
    ];
    if (canWrite) {
        columns.push({key: "actions", label: <span className="sr-only">{t("namespaces.claims.actions")}</span>, render: (line) => (
            <span className="flex justify-end gap-1">
                {line.claim ? (
                    <>
                        <Button size="sm" variant="secondary" onClick={() => setWizard({mode: "edit", claim: line.claim})}
                                aria-label={t("namespaces.claims.editOf", {name: nameOf(line)})}>
                            {t("namespaces.claims.edit")}
                        </Button>
                        <Button size="sm" variant="delete" onClick={() => setRemoving(line.claim)}
                                aria-label={t("namespaces.claims.removeOf", {name: nameOf(line)})}>
                            {t("namespaces.claims.remove")}
                        </Button>
                    </>
                ) : isNamed(line.type) ? (
                    // Used without a claim: claimed of in a step, the pool or the network already chosen.
                    <Button size="sm" variant="secondary" onClick={() => setWizard({mode: "add", type: line.type, name: line.name})}
                            aria-label={t("namespaces.claims.claimOf", {name: nameOf(line)})}>
                        {t("namespaces.claims.claim")}
                    </Button>
                ) : null}
            </span>
        )});
    }

    const done = () => {
        setWizard(null);
        setRemoving(null);
        claims.reload();
    };

    return (
        <div className="space-y-6" data-testid="namespace-claims">
            <Section
                id={`namespace-claims-${namespace}`}
                title={t("namespaces.panel.claims")}
                tools={canWrite && claims.loaded ? (
                    <IconButton solid label={t("namespaces.claims.add")} className="ml-auto" onClick={() => setWizard({mode: "add"})}>
                        <PlusIcon/>
                    </IconButton>
                ) : null}
            >
                {claims.error && <Alert tone="error">{t("namespaces.usage.error", {message: claims.error})}</Alert>}
                {claims.loaded && !hasClaims && <p className="text-ink-muted">{t("namespaces.panel.noClaim")}</p>}
                <DataTable
                    label={t("namespaces.panel.claims")}
                    rowKey={(line) => `${line.type}:${line.name ?? ""}`}
                    rows={lines}
                    empty={claims.loaded ? t("namespaces.panel.nothing") : t("nodePanel.loading")}
                    columns={columns}
                />
                <p className="text-ink-muted">{t("namespaces.panel.pgNode")}</p>
                {!canWrite && claims.loaded && <p className="text-ink-muted">{t("namespaces.claims.readOnly")}</p>}
            </Section>
            {wizard !== null && (
                <ClaimWizard
                    namespace={namespace}
                    start={wizard}
                    own={own}
                    configured={claims.configured[namespace] !== false}
                    lines={lines}
                    pools={claims.pools}
                    networks={claims.networks}
                    onClose={() => setWizard(null)}
                    onSaved={done}
                />
            )}
            {removing !== null && (
                <RemoveClaim namespace={namespace} claim={removing} onClose={() => setRemoving(null)} onRemoved={done}/>
            )}
        </div>
    );
}

/**
 * Writes keyword operations to the namespace configuration, creating it first if it
 * has none. What came of it, the actions tray says; refused, it throws the reason
 * for the dialog to say it too.
 */
async function writeClaim(namespace, ops, configured) {
    const write = {action: "config", label: i18n.t("actionTray.writes.claimsUpdate"), subject: namespace};
    let response;
    try {
        response = await requestClaim(namespace, ops, configured);
    } catch (err) {
        trackRefused({...write, reason: err.message});
        throw err;
    }
    if (!response.ok) {
        const detail = await getResponseErrorMessage(response);
        trackRefused({...write, reason: refusalReason({status: response.status, detail})});
        throw new Error(detail || `HTTP ${response.status}`);
    }
    trackDone(write);
}

/** The request of a claim: the keywords patched, or the configuration created with them. */
function requestClaim(namespace, ops, configured) {
    return configured
        ? fetch(`${configUrl(namespace)}?${opsQuery(ops)}`, {method: "PATCH", headers: authHeaders()})
        // No configuration yet: created with its id, the claim written in it.
        : fetch(`${configUrl(namespace)}/file?${opsQuery({set: ops.set})}`, {
            method: "POST",
            headers: {...authHeaders(), "Content-Type": "application/octet-stream"},
            body: withId("", newId()),
        });
}

/** The steps of the wizard, in order; the pool or network one for those only. */
const STEPS = ["type", "target", "limit", "review"];

/**
 * A claim, added or changed in steps: what it is about, which pool or network, how
 * much, then what will be written, read back before it is. An edit starts at the
 * limit, its type and name fixed; a pool or network already chosen skips its steps.
 */
function ClaimWizard({namespace, start, own, configured, lines, pools, networks, onClose, onSaved}) {
    const {t} = useTranslation();
    const amount = useAmount();
    const editing = start.mode === "edit";
    const [type, setType] = useState(editing ? start.claim.type : start.type ?? null);
    const [name, setName] = useState(editing ? start.claim.name : start.name ?? null);
    const [limit, setLimit] = useState(() => (editing ? toInput(start.claim.type, start.claim.raw) : {amount: "", unit: "g"}));
    const [defaultLimit, setDefaultLimit] = useState(() => (editing ? toInput(start.claim.type, start.claim.defaultRaw) : {amount: "", unit: "m"}));
    const first = editing || (start.type && (!isNamed(start.type) || start.name)) ? "limit" : start.type ? "target" : "type";
    const [step, setStep] = useState(first);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const claimedType = (kind) => own.some((c) => c.type === kind);
    const claimedName = (kind, n) => own.some((c) => c.type === kind && c.name === n);
    const candidates = type === "pool" ? pools : type === "network" ? networks : [];
    const free = candidates.filter((item) => !claimedName(type, item.name));
    // A type the namespace claims already, cpu or memory, is changed, not claimed twice;
    // a pool or network type is offered while one of them is left to claim.
    const available = (kind) => (isNamed(kind)
        ? (kind === "pool" ? pools : networks).some((item) => !claimedName(kind, item.name))
        : !claimedType(kind));

    const line = lines.find((l) => l.type === type && (!isNamed(type) || l.name === name));
    const used = line?.used;
    const size = isNamed(type) ? candidates.find((item) => item.name === name)?.size : undefined;
    const limitProblem = type ? limitError(type, limit) : null;
    const hasDefault = !isNamed(type) && defaultLimit.amount.trim() !== "";
    const defaultProblem = hasDefault ? limitError(type, defaultLimit) : null;
    const value = type ? limitValue(type, limit) : undefined;
    const section = editing ? start.claim.section : nextSection(own);
    const subject = name ?? t(`namespaces.panel.types.${type}`);

    const steps = STEPS.filter((s) => (s === "target" ? isNamed(type ?? "pool") : true));
    const index = steps.indexOf(step);
    const canNext = step === "type" ? type !== null
        : step === "target" ? name !== null
            : step === "limit" ? limitProblem === null && defaultProblem === null
                : true;
    const back = () => setStep(steps[index - 1]);
    const next = () => setStep(steps[index + 1]);
    const firstStep = steps.indexOf(first);

    const ops = type && limitProblem === null ? claimOps({
        section,
        type,
        name,
        limit: formatLimit(type, limit),
        defaultLimit: hasDefault && defaultProblem === null ? formatLimit(type, defaultLimit) : undefined,
    }) : {set: [], unset: []};
    // A default only unset where there was one: om3 has nothing else to remove.
    const unset = editing && start.claim.defaultRaw ? ops.unset : [];

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await writeClaim(namespace, {set: ops.set, unset}, configured);
            onSaved();
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    const title = editing
        ? t("namespaces.claims.wizard.editTitle", {name: subject, namespace})
        : t("namespaces.claims.wizard.addTitle", {namespace});
    const unitLabel = (unit) => t(`namespaces.claims.units.${unit}`);

    return (
        <Dialog
            open
            size="md"
            title={title}
            onClose={onClose}
            footer={(
                <>
                    <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
                    {index > firstStep && <Button variant="secondary" onClick={back} disabled={saving}>{t("namespaces.claims.wizard.back")}</Button>}
                    {step === "review" ? (
                        <Button variant={editing ? "secondary" : "create"} onClick={save} disabled={saving}>
                            {saving ? t("namespaces.claims.wizard.saving") : t("namespaces.claims.wizard.save")}
                        </Button>
                    ) : (
                        <Button onClick={next} disabled={!canNext}>{t("namespaces.claims.wizard.next")}</Button>
                    )}
                </>
            )}
        >
            <div className="space-y-4">
                <ol aria-label={t("namespaces.claims.wizard.steps")} className="flex flex-wrap gap-x-3 gap-y-1 text-data">
                    {steps.slice(firstStep).map((s, i) => (
                        <li key={s} aria-current={s === step ? "step" : undefined}
                            className={s === step ? "font-semibold text-ink" : "text-ink-muted"}>
                            {`${i + 1}. ${t(`namespaces.claims.wizard.step.${s}`)}`}
                        </li>
                    ))}
                </ol>

                {step === "type" && (
                    <fieldset className="space-y-2">
                        <legend className="mb-1 font-medium">{t("namespaces.claims.wizard.typeQuestion")}</legend>
                        {CLAIM_TYPES.map((kind) => (
                            <label key={kind} className={`flex items-start gap-2 rounded-(--radius-control) border border-line p-2 ${available(kind) ? "cursor-pointer hover:bg-surface-sunken" : "opacity-60"}`}>
                                <input
                                    type="radio"
                                    name="claim-type"
                                    value={kind}
                                    checked={type === kind}
                                    disabled={!available(kind)}
                                    onChange={() => {
                                        setType(kind);
                                        setName(null);
                                        setLimit({amount: "", unit: "g"});
                                        setDefaultLimit({amount: "", unit: "m"});
                                    }}
                                    className="mt-1"
                                />
                                <span>
                                    <span className="block font-medium">{t(`namespaces.claims.types.${kind}.label`)}</span>
                                    <span className="block text-data text-ink-muted">
                                        {available(kind) ? t(`namespaces.claims.types.${kind}.help`) : t(`namespaces.claims.types.${kind}.taken`)}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                )}

                {step === "target" && (
                    <fieldset className="space-y-2">
                        <legend className="mb-1 font-medium">{t(`namespaces.claims.wizard.targetQuestion.${type}`)}</legend>
                        {free.length === 0 && <p className="text-ink-muted">{t(`namespaces.claims.wizard.noTarget.${type}`)}</p>}
                        {free.map((item) => {
                            const held = lines.find((l) => l.type === type && l.name === item.name)?.used ?? 0;
                            return (
                                <label key={item.name} className="flex cursor-pointer items-center gap-2 rounded-(--radius-control) border border-line p-2 hover:bg-surface-sunken">
                                    <input type="radio" name="claim-target" value={item.name} checked={name === item.name} onChange={() => setName(item.name)}/>
                                    <span className="font-mono text-data font-medium">{item.name}</span>
                                    <span className="ml-auto text-data text-ink-muted tabular-nums">
                                        {t("namespaces.claims.wizard.targetFigures", {used: amount(type, held), size: amount(type, item.size)})}
                                    </span>
                                </label>
                            );
                        })}
                    </fieldset>
                )}

                {step === "limit" && (
                    <div className="space-y-4">
                        <LimitField
                            type={type}
                            input={limit}
                            onChange={setLimit}
                            label={t(`namespaces.claims.wizard.limitLabel.${type}`, {name: subject})}
                            hint={[
                                t("namespaces.claims.wizard.usedNow", {used: amount(type, used)}),
                                size !== undefined ? t(`namespaces.claims.wizard.sizeOf.${type}`, {size: amount(type, size)}) : null,
                                type === "cpu" ? t("namespaces.claims.wizard.cpuHint") : null,
                            ].filter(Boolean).join(" ")}
                            error={limit.amount.trim() !== "" && limitProblem ? t(`namespaces.claims.errors.${limitProblem}`) : null}
                            unitLabel={unitLabel}
                        />
                        {value !== undefined && used !== undefined && value < used && (
                            <Alert tone="warning">{t("namespaces.claims.wizard.belowUsage", {used: amount(type, used)})}</Alert>
                        )}
                        {value !== undefined && size !== undefined && value > size && (
                            <Alert tone="info">{t(`namespaces.claims.wizard.aboveSize.${type}`, {size: amount(type, size)})}</Alert>
                        )}
                        {!isNamed(type) && (
                            <LimitField
                                type={type}
                                input={defaultLimit}
                                onChange={setDefaultLimit}
                                label={t(`namespaces.claims.wizard.defaultLabel.${type}`)}
                                hint={t("namespaces.claims.wizard.defaultHint")}
                                error={hasDefault && defaultProblem ? t(`namespaces.claims.errors.${defaultProblem}`) : null}
                                unitLabel={unitLabel}
                                optional
                            />
                        )}
                    </div>
                )}

                {step === "review" && (
                    <div className="space-y-3">
                        <p>{t(`namespaces.claims.wizard.summary.${type}`, {namespace, name: subject, limit: amount(type, value)})}</p>
                        {hasDefault && (
                            <p>{t(`namespaces.claims.wizard.summaryDefault.${type}`, {value: amount(type, limitValue(type, defaultLimit))})}</p>
                        )}
                        {!configured && <p className="text-ink-muted">{t("namespaces.claims.wizard.createsConfig", {namespace})}</p>}
                        <div>
                            <p className="mb-1 text-data text-ink-muted">{t("namespaces.claims.wizard.written")}</p>
                            <pre data-testid="claim-preview" className="rounded-(--radius-control) border border-line bg-surface-sunken p-2 font-mono text-data">
                                {[`[${section}]`, ...ops.set.map((op) => op.slice(section.length + 1).replace("=", " = "))].join("\n")}
                            </pre>
                        </div>
                        {error && <Alert tone="error">{t("namespaces.claims.saveFailed", {message: error})}</Alert>}
                    </div>
                )}
            </div>
        </Dialog>
    );
}

/** A limit: its amount, and for a size its unit; cpus for cpu, addresses for a network. */
function LimitField({type, input, onChange, label, hint, error, unitLabel, optional = false}) {
    const {t} = useTranslation();
    const sized = type === "pool" || type === "memory";
    return (
        <Field label={optional ? t("namespaces.claims.wizard.optional", {label}) : label} hint={hint} error={error}>
            {(control) => (
                <div className="flex items-center gap-2">
                    <Input
                        {...control}
                        inputMode="decimal"
                        value={input.amount}
                        onChange={(e) => onChange({...input, amount: e.target.value})}
                        className="w-40"
                    />
                    {sized ? (
                        <Select
                            aria-label={t("namespaces.claims.wizard.unit")}
                            value={input.unit}
                            onChange={(e) => onChange({...input, unit: e.target.value})}
                            className="w-24"
                        >
                            {SIZE_UNITS.map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}
                        </Select>
                    ) : (
                        <span className="text-ink-muted">{t(`namespaces.claims.wizard.unitOf.${type}`)}</span>
                    )}
                </div>
            )}
        </Field>
    );
}

/** A claim removed, confirmed first: the namespace is then capped by the pool or network alone, or not at all. */
function RemoveClaim({namespace, claim, onClose, onRemoved}) {
    const {t} = useTranslation();
    const amount = useAmount();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const subject = claim.name ?? t(`namespaces.panel.types.${claim.type}`);
    const remove = async () => {
        setSaving(true);
        setError(null);
        const write = {action: "config", label: t("actionTray.writes.claimDelete", {section: claim.section}), subject: namespace};
        // What came of it, the actions tray says; refused, the dialog stays open and says why.
        const refuse = (reason, message) => {
            trackRefused({...write, reason});
            setError(message);
            setSaving(false);
        };
        let response;
        try {
            response = await fetch(`${configUrl(namespace)}?${opsQuery({delete: [claim.section]})}`, {method: "PATCH", headers: authHeaders()});
        } catch (err) {
            refuse(err.message, err.message);
            return;
        }
        if (!response.ok) {
            const detail = await getResponseErrorMessage(response);
            refuse(refusalReason({status: response.status, detail}), detail || `HTTP ${response.status}`);
            return;
        }
        trackDone(write);
        onRemoved();
    };
    return (
        <Dialog
            open
            title={t("namespaces.claims.removeTitle", {name: subject})}
            onClose={onClose}
            footer={(
                <>
                    <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button variant="delete" onClick={remove} disabled={saving}>{t("namespaces.claims.remove")}</Button>
                </>
            )}
        >
            <div className="space-y-3">
                <p>{t("namespaces.claims.removeText", {namespace, name: subject, limit: amount(claim.type, claim.limit)})}</p>
                <p className="text-ink-muted">{t(`namespaces.claims.removeEffect.${claim.type}`)}</p>
                {error && <Alert tone="error">{t("namespaces.claims.removeFailed", {message: error})}</Alert>}
            </div>
        </Dialog>
    );
}
