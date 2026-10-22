import React, {useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Trans, useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Combobox} from "../ui/components/Combobox";
import {Checkbox} from "../ui/components/Field";
import {Dialog} from "../ui/components/Dialog";
import {MenuButton} from "../ui/components/MenuButton";
import {Spinner} from "../ui/components/Spinner";
import {LockIcon} from "../ui/icons";
import {URL_OBJECT} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {parseObjectPath} from "../utils/objectUtils";
import useEventStore from "../hooks/useEventStore.js";
import {trackDone, trackRefused, trackWrite} from "../app/action-tracker";
import {refusalReason} from "./objectActions";

/** How long a certificate is waited for: an ACME directory proving the domains takes tens of seconds. */
export const CERTIFICATE_TIMEOUT_MS = 300_000;

/** The ca of the cluster, signing the certificates of its nodes and listeners. */
export const CLUSTER_CA = "system/sec/ca";

const objectUrl = (path) => {
    const {namespace, kind, name} = parseObjectPath(path);
    return `${URL_OBJECT}/${encodeURIComponent(namespace)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
};

/** The request of a certificate action of the sec `path`: create, renew, or renew forced. */
export const certificateUrl = (path, action) => {
    const base = `${objectUrl(path)}/certificate`;
    if (action === "create") return `${base}/create`;
    return `${base}/renew?force=${action === "force" ? "true" : "false"}`;
};

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") ?? ""}`});

/** A refusal in words, for the actions tray: its status, and the detail the daemon gave. */
const refusal = async (response) => refusalReason({status: response.status, detail: await getResponseErrorMessage(response)});

/** The ca the sec names in its DEFAULT section, "" for none; undefined when it could not be read. */
async function readCa(path) {
    try {
        const response = await fetch(`${objectUrl(path)}/config`, {headers: authHeaders(), cache: "no-cache"});
        if (!response.ok) return undefined;
        const {items = []} = await response.json();
        return items.find((item) => item.keyword === "ca")?.value ?? "";
    } catch {
        return undefined;
    }
}

const LINK = "font-medium text-accent hover:underline";

/**
 * What signs the certificate to create: the ca of the cluster, checked; another, a
 * sec of the namespace picked; else none, self-signed. `secs`, the secs to pick from.
 */
function CaChoice({ca, onChange, secs, disabled}) {
    const {t} = useTranslation();
    const other = ca !== "" && ca !== CLUSTER_CA;
    const [picking, setPicking] = useState(other);
    useEffect(() => {
        if (other) setPicking(true);
    }, [other]);
    return (
        <fieldset className="space-y-2" disabled={disabled}>
            <legend className="mb-1 font-medium">{t("secCertificate.ca.legend")}</legend>
            <Checkbox
                checked={ca === CLUSTER_CA}
                onChange={(event) => onChange(event.target.checked ? CLUSTER_CA : "")}
                label={(
                    <span>
                        <Trans
                            i18nKey="secCertificate.ca.cluster"
                            components={{a: <Link to={`/objects?${new URLSearchParams({sel: CLUSTER_CA})}`} className={LINK}/>}}
                        />
                    </span>
                )}
            />
            <p>
                <Trans
                    i18nKey="secCertificate.ca.other"
                    components={{a: <button type="button" className={LINK} aria-expanded={picking} onClick={() => setPicking(true)}/>}}
                />
            </p>
            {picking && (
                <Combobox
                    options={secs.map((sec) => ({value: sec, label: sec}))}
                    value={other ? ca : ""}
                    onChange={onChange}
                    label={t("secCertificate.ca.pick")}
                    placeholder={t("secCertificate.ca.pick")}
                    emptyText={t("secCertificate.ca.none")}
                    className="w-80 max-w-full"
                />
            )}
            <p className="text-ink-muted">
                {ca ? t("secCertificate.ca.signedBy", {ca}) : t("secCertificate.ca.selfSigned")}
            </p>
        </fieldset>
    );
}

/**
 * The certificate of a sec, created or renewed by the daemon: its private_key,
 * certificate, certificate_chain and fullpem keys written, as `om <sec> certificate`
 * does. A creation says what signs it, the ca of the sec written first when it
 * changes. A renewal says why it issued a certificate, or why none; refused because
 * the current certificate was not issued by the sec, it offers to force. `keyNames`,
 * the keys of the sec, say whether a certificate is there to replace.
 */
export function SecCertificate({path, keyNames, disabled, onWritten}) {
    const {t} = useTranslation();
    const [busy, setBusy] = useState(null);
    // The action to confirm: "create", or "force"; with why, for a force the daemon asked.
    const [confirm, setConfirm] = useState(null);
    const [understood, setUnderstood] = useState(false);
    useEffect(() => setUnderstood(false), [confirm]);
    // The ca of the sec as read (null while read, undefined unread), and as chosen.
    const [currentCa, setCurrentCa] = useState(null);
    const [ca, setCa] = useState("");
    const hasCertificate = keyNames.includes("certificate");
    const hasPrivateKey = keyNames.includes("private_key");

    // The secs of its namespace, but itself; the ca it names, from elsewhere, too.
    const {namespace, name: own} = parseObjectPath(path);
    const objectNames = useEventStore((s) => s.objectStatus);
    const secs = useMemo(() => {
        const listed = Object.keys(objectNames ?? {}).filter((name) => {
            const p = parseObjectPath(name);
            return p.kind === "sec" && p.namespace === namespace && p.name !== own;
        });
        if (currentCa && currentCa !== CLUSTER_CA && !listed.includes(currentCa)) listed.push(currentCa);
        return listed.sort((a, b) => a.localeCompare(b));
    }, [objectNames, namespace, own, currentCa]);

    useEffect(() => {
        if (confirm?.action !== "create") return undefined;
        let live = true;
        setCurrentCa(null);
        void readCa(path).then((read) => {
            if (!live) return;
            setCurrentCa(read);
            setCa(read ?? "");
        });
        return () => {
            live = false;
        };
    }, [confirm?.action, path]);

    /** The ca chosen written in the sec, when it changed: false if refused. */
    const writeCa = async () => {
        if (currentCa !== undefined && ca === currentCa) return true;
        const info = ca
            ? {action: "config", label: t("actionTray.writes.set", {keyword: "ca", value: ca}), subject: path, path}
            : {action: "config", label: t("actionTray.writes.unset", {keyword: "ca"}), subject: path, path};
        try {
            const query = ca ? `set=${encodeURIComponent(`ca=${ca}`)}` : "unset=ca";
            const response = await fetch(`${objectUrl(path)}/config?${query}`, {method: "PATCH", headers: authHeaders()});
            return await trackWrite(response, info, refusal);
        } catch (err) {
            trackRefused({...info, reason: err.message});
            return false;
        }
    };

    const run = async (action) => {
        setConfirm(null);
        const info = {action: "certificate", subject: path, path, label: t(`secCertificate.${action}.label`)};
        if (!localStorage.getItem("authToken")) {
            trackRefused({...info, reason: t("keys.errors.noToken")});
            return;
        }
        setBusy(action);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CERTIFICATE_TIMEOUT_MS);
        try {
            if (action === "create" && !(await writeCa())) return;
            const response = await fetch(certificateUrl(path, action), {
                method: "POST",
                headers: authHeaders(),
                signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await getResponseErrorMessage(response);
                trackRefused({...info, reason: refusalReason({status: response.status, detail})});
                // Not issued by the sec: only a forced renewal replaces it, said what it costs.
                if (response.status === 409 && action === "renew") setConfirm({action: "force", why: detail});
                return;
            }
            if (action === "create") {
                trackDone(info);
            } else {
                const renewal = await response.json().catch(() => ({}));
                const reason = renewal.reason || "";
                trackDone({
                    ...info,
                    label: renewal.renewed
                        ? t("secCertificate.renewed", {reason})
                        : t("secCertificate.notRenewed", {reason}),
                });
            }
            onWritten?.();
        } catch (err) {
            trackRefused({
                ...info,
                reason: err.name === "AbortError"
                    ? t("secCertificate.timeout", {seconds: CERTIFICATE_TIMEOUT_MS / 1000})
                    : err.message,
            });
        } finally {
            clearTimeout(timer);
            setBusy(null);
        }
    };

    // A creation says what signs it; a forced renewal what it costs. A renewal when due goes at once.
    const ask = (action) => (action === "renew" ? void run(action) : setConfirm({action}));

    const items = [
        {key: "create", label: t("secCertificate.create.label"), description: t("secCertificate.create.description"), onSelect: () => ask("create")},
        {key: "renew", label: t("secCertificate.renew.label"), description: t("secCertificate.renew.description"), disabled: !hasCertificate, onSelect: () => ask("renew")},
        {key: "force", label: t("secCertificate.force.label"), description: t("secCertificate.force.description"), danger: true, onSelect: () => ask("force")},
    ];
    const pending = confirm?.action;
    const harmful = pending === "force";
    const reading = pending === "create" && currentCa === null;

    return (
        <>
            {busy ? (
                <Spinner label={t(`secCertificate.${busy}.busy`)}/>
            ) : (
                <MenuButton
                    label={t("secCertificate.menu")}
                    prominent
                    icon={<LockIcon/>}
                    align="end"
                    items={items}
                    disabled={disabled}
                />
            )}
            {pending && (
                <Dialog
                    open
                    title={t("secCertificate.confirmTitle", {label: t(`secCertificate.${pending}.label`), path})}
                    onClose={() => setConfirm(null)}
                    footer={(
                        <>
                            <Button variant="secondary" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
                            <Button
                                variant={pending === "create" ? "create" : "secondary"}
                                disabled={(harmful && !understood) || reading}
                                onClick={() => run(pending)}
                            >
                                {t(`secCertificate.${pending}.label`)}
                            </Button>
                        </>
                    )}
                >
                    <div className="space-y-3">
                        {confirm.why && <Alert>{confirm.why}</Alert>}
                        <p>{t(`secCertificate.${pending}.description`)}</p>
                        {pending === "create" && (reading
                            ? <Spinner label={t("secCertificate.ca.reading")}/>
                            : <CaChoice ca={ca} onChange={setCa} secs={secs}/>)}
                        {pending === "create" && hasCertificate && (
                            <Alert tone="warning">
                                {t(hasPrivateKey ? "secCertificate.create.replaceKeepKey" : "secCertificate.create.replace")}
                            </Alert>
                        )}
                        {harmful && (
                            <>
                                <Alert tone="warning">{t("secCertificate.force.warning")}</Alert>
                                <Checkbox
                                    label={t("nodeActions.understood")}
                                    checked={understood}
                                    onChange={(event) => setUnderstood(event.target.checked)}
                                />
                            </>
                        )}
                    </div>
                </Dialog>
            )}
        </>
    );
}
