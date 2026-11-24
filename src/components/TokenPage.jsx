import React, {useState} from "react";
import {useSearchParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {Button, IconButton} from "../ui/components/Button";
import {CopyButton} from "../ui/components/CopyButton";
import {Checkbox, Field, Input, Select, Textarea} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {EyeIcon, EyeOffIcon, KeyIcon} from "../ui/icons";
import {URL_AUTH_WHOAMI, URL_TOKEN} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {basicAuthorization} from "../utils/basicAuth.js";
import {useGrants} from "../hooks/useGrants";

/** The lifetime of a token by default: a join one must outlive the drain of the node. */
const DEFAULT_DURATION = {join: "1h"};

/** The lifetimes offered at once, an API token short-lived; any other typed, 24h at most. */
const DURATIONS = ["10m", "1h", "8h"];

/** The roles om3 grants (api Role), in the order offered; those of a namespace narrowed by a scope. */
const ROLES = ["root", "admin", "operator", "guest", "prioritizer", "squatter", "blacklistadmin", "heartbeat", "join", "leave"];
const NAMESPACED = ["admin", "operator", "guest"];

/**
 * How to try a token without it landing in the history of the shell: read, unseen,
 * into a variable, then sent with a request telling who it is.
 */
const tryIt = (url) => `read -rs TOKEN    # paste the token, then Enter
curl -H "Authorization: Bearer $TOKEN" ${url}`;

/** Ignored by the password managers but for the credentials themselves. */
const NOT_A_LOGIN = {
    autoComplete: "off",
    spellCheck: false,
    "data-protonpass-ignore": "true",
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
};

/**
 * A token of this node, created by its own api (`/api/auth/token`): of the role the
 * address names (`?role=join`), for its lifetime, then copied. The node to enroll
 * into a cluster is opened here, from the Enroll dialog of that cluster: its
 * certificate accepted on the way, no other origin asked anything.
 *
 * om3 creates a token for a user signed in with a password, or from a refresh
 * token: the one of a password session of this webapp is used when there is one;
 * otherwise, the username and password of a user of this node are asked, sent to
 * this node alone. A session opened with OpenID cannot create one.
 *
 * Without a role named, an API token, for a script or a quick test: its lifetime
 * short, its roles any of the user's (none picked, all of them), those of a namespace
 * narrowed to one; created, shown once, with a request to try it, the token kept out
 * of the history of the shell.
 */
export default function TokenPage() {
    const {t, i18n} = useTranslation();
    const [params] = useSearchParams();
    const role = params.get("role") ?? "";
    const [duration, setDuration] = useState(DEFAULT_DURATION[role] ?? "10m");
    const refresh = (() => {
        try {
            return localStorage.getItem("refreshToken") || "";
        } catch {
            return "";
        }
    })();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);
    const [token, setToken] = useState(null);
    const [shown, setShown] = useState(false);
    // An API token: the roles picked among the user's, none all of them; a namespace to narrow them to.
    const grants = useGrants();
    const held = ROLES.filter((r) => Object.prototype.hasOwnProperty.call(grants, r));
    const [roles, setRoles] = useState([]);
    const [scope, setScope] = useState("");
    const namespaces = [...new Set(roles.filter((r) => NAMESPACED.includes(r)).flatMap((r) => (Array.isArray(grants[r]) ? grants[r] : [])))].sort();
    const toggleRole = (r) => setRoles((list) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]));

    const useCredentials = refresh === "";
    const ready = !creating && duration.trim() !== "" && (!useCredentials || (username !== "" && password !== ""));

    const create = async (event) => {
        event?.preventDefault();
        if (!ready) return;
        setCreating(true);
        setError(null);
        setToken(null);
        setShown(false);
        try {
            const query = new URLSearchParams({access_duration: duration.trim(), refresh: "false"});
            if (role) query.set("role", role);
            for (const r of role ? [] : roles) query.append("role", r);
            if (!role && scope && namespaces.includes(scope)) query.set("scope", scope);
            const response = await fetch(`${URL_TOKEN}?${query}`, {
                method: "POST",
                headers: {
                    Authorization: useCredentials ? basicAuthorization(username, password) : `Bearer ${refresh}`,
                },
            });
            if (!response.ok) {
                setError(await getResponseErrorMessage(response) || `HTTP ${response.status}`);
                return;
            }
            const data = await response.json();
            setToken({value: data.access_token, expires: data.access_expired_at});
            setPassword("");
        } catch (err) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-4 p-4">
            <div className="flex items-center gap-2">
                <KeyIcon className="text-ink-muted"/>
                <h1 className="text-title font-semibold">{t("tokenPage.title", {host: window.location.host})}</h1>
            </div>
            <p>{role === "join" ? t("tokenPage.joinIntro") : t("tokenPage.intro")}</p>

            <form onSubmit={create} noValidate className="space-y-3 rounded-(--radius-panel) border border-line bg-surface-raised p-3">
                <div className="flex flex-wrap gap-3">
                    {role ? (
                        <Field label={t("tokenPage.role")}>
                            {(control) => <Input {...control} {...NOT_A_LOGIN} value={role} readOnly className="w-40"/>}
                        </Field>
                    ) : held.length > 0 ? (
                        // The roles of the token, among the user's; none picked, all of them.
                        <fieldset className="space-y-1">
                            <legend className="font-medium">{t("tokenPage.role")}</legend>
                            <div className="flex flex-wrap gap-x-3">
                                {held.map((r) => (
                                    <Checkbox key={r} label={r} checked={roles.includes(r)} onChange={() => toggleRole(r)}/>
                                ))}
                            </div>
                            <p className="text-data text-ink-muted">{roles.length === 0 ? t("tokenPage.allRolesHint") : t("tokenPage.someRolesHint")}</p>
                        </fieldset>
                    ) : (
                        <Field label={t("tokenPage.role")}>
                            {(control) => <Input {...control} {...NOT_A_LOGIN} value={t("tokenPage.allRoles")} readOnly className="w-40"/>}
                        </Field>
                    )}
                    {!role && namespaces.length > 0 && (
                        <Field label={t("tokenPage.scope")} hint={t("tokenPage.scopeHint")}>
                            {(control) => (
                                <Select {...control} value={scope} onChange={(e) => setScope(e.target.value)} className="h-8 w-44">
                                    <option value="">{t("tokenPage.scopeAll")}</option>
                                    {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
                                </Select>
                            )}
                        </Field>
                    )}
                    <Field label={t("tokenPage.duration")} hint={t(role ? "tokenPage.durationHint" : "tokenPage.apiDurationHint")}>
                        {(control) => (
                            <span className="flex items-center gap-1.5">
                                <Input {...control} {...NOT_A_LOGIN} name="token-duration" value={duration}
                                       onChange={(e) => setDuration(e.target.value)} className="w-24"/>
                                {!role && DURATIONS.map((d) => (
                                    <Button key={d} size="sm" aria-pressed={duration === d} onClick={() => setDuration(d)}>{d}</Button>
                                ))}
                            </span>
                        )}
                    </Field>
                </div>
                {useCredentials ? (
                    <>
                        <p className="text-ink-muted">{t("tokenPage.credentialsWhy")}</p>
                        <div className="flex flex-wrap gap-3">
                            <Field label={t("tokenPage.username")}>
                                {(control) => (
                                    <Input {...control} name="username" autoComplete="username" value={username}
                                           onChange={(e) => setUsername(e.target.value)} className="w-56"/>
                                )}
                            </Field>
                            <Field label={t("tokenPage.password")}>
                                {(control) => (
                                    <Input {...control} type="password" name="password" autoComplete="current-password"
                                           value={password} onChange={(e) => setPassword(e.target.value)} className="w-56"/>
                                )}
                            </Field>
                        </div>
                    </>
                ) : (
                    <p className="text-ink-muted">{t("tokenPage.fromSession")}</p>
                )}
                <div className="flex items-center gap-2">
                    <Button type="submit" variant="create" disabled={!ready}
                            icon={creating ? <Spinner label={t("tokenPage.creating")}/> : undefined}>
                        {creating ? t("tokenPage.creating") : t("tokenPage.create")}
                    </Button>
                </div>
                {error && <Alert>{t("tokenPage.refused", {message: error})}</Alert>}
            </form>

            {token && (
                <section aria-labelledby="token-result" className="space-y-2 rounded-(--radius-panel) border border-line bg-surface-raised p-3">
                    <div className="flex items-center gap-2">
                        <h2 id="token-result" className="font-semibold">{t("tokenPage.token")}</h2>
                        {token.expires && (
                            <span className="text-data text-ink-muted">{t("tokenPage.expires", {at: new Date(token.expires).toLocaleString(i18n.language)})}</span>
                        )}
                        <span className="ml-auto flex items-center gap-1">
                            <IconButton label={shown ? t("tokenPage.hide") : t("tokenPage.reveal")} aria-pressed={shown}
                                        onClick={() => setShown((s) => !s)}>
                                {shown ? <EyeOffIcon/> : <EyeIcon/>}
                            </IconButton>
                            <CopyButton size="md" text={token.value} label={t("tokenPage.copy")}/>
                        </span>
                    </div>
                    <Textarea
                        {...NOT_A_LOGIN}
                        aria-label={t("tokenPage.token")}
                        readOnly
                        rows={4}
                        value={shown ? token.value : "•".repeat(Math.min(token.value.length, 64))}
                        className="font-mono text-data break-all"
                    />
                    {role === "join" && <p className="text-ink-muted">{t("tokenPage.joinNext")}</p>}
                    {/* An API token: a request to try it, the token read unseen, out of the history of the shell. */}
                    {!role && (
                        <div data-try="" className="space-y-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-medium">{t("tokenPage.tryIt")}</h3>
                                <span className="ml-auto"><CopyButton text={tryIt(`${window.location.origin}${URL_AUTH_WHOAMI}`)} label={t("tokenPage.copyTry")}/></span>
                            </div>
                            <pre className="overflow-x-auto rounded-(--radius-control) border border-line bg-surface-sunken p-2 font-mono text-data">
                                {tryIt(`${window.location.origin}${URL_AUTH_WHOAMI}`)}
                            </pre>
                            <p className="text-data text-ink-muted">{t("tokenPage.tryItHint")}</p>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
