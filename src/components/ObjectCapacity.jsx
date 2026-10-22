import React, {useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_OBJECT} from "../config/apiPath.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {getResponseErrorMessage} from "../services/api.jsx";
import {trackRefused, trackResponse} from "../app/action-tracker";
import {refusalReason} from "./objectActions";
import {Button} from "../ui/components/Button";
import {Field, Input} from "../ui/components/Field";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {Table, HeaderRow, HeaderCell, Row, Cell} from "../ui/components/Table";
import {Section} from "./NodePanel";
import {cn} from "../ui/cn";

/*
 * The capacity of an object, a tab of its panel: the size of a volume, resized
 * (`om <path> resize`), and the process group caps of a service or a volume, set and
 * applied to its running instances (`om <path> cap`). Each an orchestration,
 * followed in the actions tray; refused, its form says why.
 */

/** The kinds that have a capacity tab: the ones the daemon caps. */
export const CAPACITY_KINDS = ["svc", "vol"];
/** The kinds the daemon resizes. */
const RESIZE_KINDS = ["vol"];

/** A size as the daemon parses it: "11g", "11GB", "12Gi", or an amount to add, "+1g". */
export const SIZE = /^\+?\d+(\.\d+)?\s*([kmgtpe]i?b?|b)?$/i;

const objectUrl = (path, rest) => {
    const {namespace, kind, name} = parseObjectPath(path);
    return `${URL_OBJECT}/${[namespace, kind, name].map(encodeURIComponent).join("/")}/${rest}`;
};
const headers = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`});

/** The values of keywords of the configuration of an object, by keyword as asked. */
async function readKeywords(path, keywords) {
    const query = keywords.map((kw) => `kw=${encodeURIComponent(kw)}`).join("&");
    const response = await fetch(`${objectUrl(path, "config")}?${query}`, {headers: headers(), cache: "no-cache"});
    if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
    const items = (await response.json())?.items ?? [];
    return Object.fromEntries(items.map((item) => [item.keyword, item.value ?? ""]));
}

/**
 * Posts the action, followed in the actions tray once accepted; resolves to the
 * reason it was refused, null when accepted.
 */
async function post(path, action, url, init) {
    const info = {action, subject: path, path};
    try {
        const response = await fetch(url, {method: "POST", ...init, headers: {...headers(), ...(init.headers ?? {})}});
        if (!response.ok) {
            const reason = refusalReason({status: response.status, detail: await getResponseErrorMessage(response)});
            trackRefused({...info, reason});
            return reason;
        }
        await trackResponse(response, info);
        return null;
    } catch (err) {
        trackRefused({...info, reason: err.message});
        return err.message;
    }
}

/** A form asking, in its section: what it acts with, the error it was refused with, its submit. */
function ParamForm({submitLabel, submitting, disabled, onSubmit, error, children}) {
    return (
        <form
            noValidate
            className="space-y-3"
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
        >
            {children}
            {error && <Alert tone="error">{error}</Alert>}
            <Button
                type="submit"
                disabled={submitting || disabled}
                icon={submitting ? <Spinner label={submitLabel}/> : undefined}
            >
                {submitLabel}
            </Button>
        </form>
    );
}

/**
 * A volume resized (`om <path> resize`): to a size, or by an amount to add; left
 * empty, to the size configured, which finishes a resize that stopped part way. The
 * size is written to the configuration, then every node converges to it.
 */
function ResizeForm({path}) {
    const {t} = useTranslation();
    const [size, setSize] = useState("");
    const [current, setCurrent] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    // Read again once a resize is accepted: the size it wrote.
    const [read, setRead] = useState(0);

    useEffect(() => {
        let live = true;
        readKeywords(path, ["size"]).then((values) => {
            if (live) setCurrent(values.size || "");
        }).catch(() => {});
        return () => {
            live = false;
        };
    }, [path, read]);

    const value = size.trim();
    const invalid = value !== "" && !SIZE.test(value);
    const submit = async () => {
        if (invalid || submitting) return;
        setSubmitting(true);
        setError("");
        const refused = await post(path, "resize", objectUrl(path, "action/resize"), {
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(value === "" ? {} : {size: value}),
        });
        setSubmitting(false);
        if (refused !== null) {
            setError(refused);
            return;
        }
        setSize("");
        setRead((n) => n + 1);
    };

    return (
        <ParamForm
            submitLabel={t("paramActions.resize.submit")}
            submitting={submitting}
            disabled={invalid}
            onSubmit={submit}
            error={error}
        >
            <p className="text-ink">{t("paramActions.resize.intro")}</p>
            <p className="text-ink-muted">
                {t("paramActions.resize.current")}{" "}
                <span className="font-mono text-ink">{current === null ? "…" : current || t("paramActions.resize.none")}</span>
            </p>
            <Field
                label={t("paramActions.resize.size")}
                hint={t("paramActions.resize.sizeHint")}
                error={invalid ? t("paramActions.resize.invalid") : null}
            >
                {(control) => (
                    <Input
                        {...control}
                        value={size}
                        placeholder="+1g"
                        onChange={(e) => setSize(e.target.value)}
                        className="w-48 font-mono"
                        autoComplete="off"
                        spellCheck={false}
                    />
                )}
            </Field>
        </ParamForm>
    );
}

/** The first sentence of the help of a keyword. */
const firstSentence = (text) => (text ?? "").split(/\n\n|(?<=\.)\s/)[0].trim();

/**
 * The process group caps of a service or a volume set, and applied to its running
 * instances (`om <path> cap`): the pg_* keywords, their value configured and the one
 * to set, of a section (DEFAULT when none, a subset or a resource) and of a node or
 * of all; "default" lifts a cap. Nothing changed, the caps configured are applied.
 */
function CapForm({path, nodes}) {
    const {t} = useTranslation();
    const [keywords, setKeywords] = useState(null);
    const [section, setSection] = useState("");
    const [node, setNode] = useState("");
    const [current, setCurrent] = useState({});
    const [values, setValues] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    // Read again once caps are accepted: the values they wrote.
    const [read, setRead] = useState(0);

    // The pg_* keywords the object takes, with their example and help.
    useEffect(() => {
        let live = true;
        fetch(objectUrl(path, "config/keywords"), {headers: headers()})
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
            .then((body) => {
                const items = (body?.items ?? body ?? []).filter((k) => String(k.option ?? "").startsWith("pg_"));
                // Once each, as the DEFAULT section describes it: the first the daemon lists.
                const unique = [...new Map(items.reverse().map((k) => [k.option, k])).values()].sort((a, b) => a.option.localeCompare(b.option));
                if (live) setKeywords(unique);
            })
            .catch((err) => {
                if (live) {
                    setKeywords([]);
                    setError(err.message);
                }
            });
        return () => {
            live = false;
        };
    }, [path]);

    /** A keyword as set and read: [<section>.]<option>[@<node>]. */
    const address = useMemo(() => {
        const prefix = section.trim() === "" ? "" : `${section.trim()}.`;
        const suffix = node === "" ? "" : `@${node}`;
        return (option) => `${prefix}${option}${suffix}`;
    }, [section, node]);

    // What the configuration holds for the section and the node chosen.
    useEffect(() => {
        if (keywords === null || keywords.length === 0) return undefined;
        let live = true;
        const asked = keywords.map((k) => address(k.option));
        readKeywords(path, asked).then((read) => {
            if (live) setCurrent(Object.fromEntries(keywords.map((k) => [k.option, read[address(k.option)] ?? ""])));
        }).catch(() => {
            if (live) setCurrent({});
        });
        return () => {
            live = false;
        };
    }, [path, keywords, address, read]);

    const sets = (keywords ?? [])
        .filter((k) => (values[k.option] ?? "").trim() !== "")
        .map((k) => `${address(k.option)}=${values[k.option].trim()}`);

    const submit = async () => {
        if (submitting) return;
        setSubmitting(true);
        setError("");
        const query = sets.map((s) => `set=${encodeURIComponent(s)}`).join("&");
        const refused = await post(path, "cap", `${objectUrl(path, "action/cap")}${query ? `?${query}` : ""}`, {});
        setSubmitting(false);
        if (refused !== null) {
            setError(refused);
            return;
        }
        setValues({});
        setRead((n) => n + 1);
    };

    const setValue = (option, value) => setValues((v) => ({...v, [option]: value}));
    /** Whether a new value is asked of a keyword. */
    const changed = (option) => (values[option] ?? "").trim() !== "";

    return (
        <ParamForm
            submitLabel={sets.length === 0 ? t("paramActions.cap.apply") : t("paramActions.cap.submit", {count: sets.length})}
            submitting={submitting}
            disabled={keywords === null}
            onSubmit={submit}
            error={error}
        >
            <p className="text-ink">{t("paramActions.cap.intro")}</p>
            <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
                <Field label={t("paramActions.cap.section")} hint={t("paramActions.cap.sectionHint")}>
                    {(control) => (
                        <Input
                            {...control}
                            value={section}
                            placeholder="DEFAULT"
                            onChange={(e) => setSection(e.target.value)}
                            className="font-mono"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    )}
                </Field>
                <Field label={t("paramActions.cap.node")} hint={t("paramActions.cap.nodeHint")}>
                    {(control) => (
                        <select
                            {...control}
                            value={node}
                            onChange={(e) => setNode(e.target.value)}
                            className="h-8 w-full rounded-(--radius-control) border border-line bg-surface px-1"
                        >
                            <option value="">{t("paramActions.cap.allNodes")}</option>
                            {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    )}
                </Field>
            </div>
            {keywords === null ? (
                <div className="flex justify-center py-4"><Spinner label={t("paramActions.cap.loading")}/></div>
            ) : (
                <Table aria-label={t("paramActions.cap.table")}>
                    <thead>
                        <HeaderRow>
                            <HeaderCell>{t("paramActions.cap.keyword")}</HeaderCell>
                            <HeaderCell>{t("paramActions.cap.configured")}</HeaderCell>
                            <HeaderCell>{t("paramActions.cap.value")}</HeaderCell>
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {keywords.map((k) => (
                            <Row key={k.option}>
                                <Cell>
                                    <span className="font-mono font-medium">{k.option}</span>
                                    <span className="block text-data text-ink-muted">{firstSentence(k.text)}</span>
                                </Cell>
                                <Cell className="font-mono text-data">{current[k.option] || "–"}</Cell>
                                <Cell>
                                    <Input
                                        aria-label={t("paramActions.cap.valueOf", {keyword: k.option})}
                                        value={values[k.option] ?? ""}
                                        placeholder={k.example || ""}
                                        onChange={(e) => setValue(k.option, e.target.value)}
                                        // Changed, white on the grey of the others: what the button under the table sets stands out.
                                        data-changed={changed(k.option) || undefined}
                                        className={cn("h-7 w-28 font-mono", changed(k.option) && "bg-surface-raised")}
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </Cell>
                            </Row>
                        ))}
                    </tbody>
                </Table>
            )}
            <p className="text-ink-muted">{t("paramActions.cap.liftHint")}</p>
            {sets.length === 0 && <p className="text-ink-muted">{t("paramActions.cap.nothingSet")}</p>}
        </ParamForm>
    );
}

/**
 * The capacity tab of a service or a volume: a volume's size, then the process
 * group caps, a section each.
 */
export function ObjectCapacity({path, nodes = []}) {
    const {t} = useTranslation();
    const {kind} = parseObjectPath(path);
    return (
        <div className="space-y-6">
            {RESIZE_KINDS.includes(kind) && (
                <Section id={`capacity-size-${path}`} title={t("paramActions.resize.heading")}>
                    <ResizeForm path={path}/>
                </Section>
            )}
            <Section id={`capacity-caps-${path}`} title={t("paramActions.cap.heading")}>
                <CapForm path={path} nodes={nodes}/>
            </Section>
        </div>
    );
}
