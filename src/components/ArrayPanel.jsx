import React, {useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_ARRAY, URL_CLUSTER} from "../config/apiPath.js";
import {ARRAY_RULES, arrayEndpoint, arraySections, poolsOfArray} from "../app/array-config";
import {CrossLink} from "../app/CrossLink";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {SectionConfig, read} from "./SectionConfig";
import {SectionWizard} from "./SectionWizard";
import {useClusterConfigChanges} from "../hooks/useLiveChanges";

/**
 * The arrays of the cluster (GET /api/array, root only), and its configuration, its
 * secrets redacted: the sections of the arrays and of the pools naming them. `data`
 * undefined while read; `reload`, read again. Not `enabled`, nothing read.
 */
export function useArrays(enabled = true) {
    const [state, setState] = useState({data: undefined, error: null});
    const [version, setVersion] = useState(0);
    // The arrays and the pools on them, sections of the cluster configuration: read again as it changes.
    const changes = useClusterConfigChanges();
    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        Promise.all([read(URL_ARRAY), read(`${URL_CLUSTER}/config/file?redact-secrets=true`, "text")]).then(
            ([list, config]) => live && setState({data: {items: list.items ?? [], config}, error: null}),
            // A failure keeps what was read, said only when nothing was.
            (err) => live && setState((s) => (s.data && !s.error ? s : {data: s.data ?? {items: [], config: ""}, error: err.message})),
        );
        return () => {
            live = false;
        };
    }, [enabled, version, changes]);
    return {...state, reload: () => setVersion((v) => v + 1)};
}

/** An array as the page and its panel show it: its type, where it is reached, as whom, the pools on it. */
export function arrayFacts(item, config) {
    const values = arraySections(config)[item.name] ?? {};
    return {
        name: item.name,
        type: item.type,
        endpoint: arrayEndpoint(values),
        user: values.username || values.client_id,
        pools: poolsOfArray(config, item.name),
    };
}

/** A fact: its label in the column of the labels, its value beside. */
const Fact = ({label, children}) => (
    <>
        <dt className="text-ink-muted">{label}</dt>
        <dd className="min-w-0 break-words">{children}</dd>
    </>
);

/**
 * What an array is: its type, where the nodes reach it and as whom, and the pools
 * making their disks on it, each opening its panel.
 */
export function ArrayOverview({name}) {
    const {t} = useTranslation();
    const {data, error} = useArrays();
    const item = data?.items.find((a) => a.name === name);
    const facts = useMemo(() => (item ? arrayFacts(item, data.config) : null), [item, data]);
    if (data === undefined) return <Spinner label={t("arrays.panel.loading")}/>;
    if (error) return <Alert>{t("arrays.loadError", {message: error})}</Alert>;
    if (!facts) return <p className="text-ink-muted">{t("arrays.panel.none", {name})}</p>;
    return (
        <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1 max-md:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] max-md:gap-x-3">
            <Fact label={t("common.type")}>{facts.type || "–"}</Fact>
            <Fact label={t("arrays.facts.endpoint")}><span className="font-mono text-data">{facts.endpoint || "–"}</span></Fact>
            <Fact label={t("arrays.facts.user")}>{facts.user || "–"}</Fact>
            <Fact label={t("arrays.facts.pools")}>
                {facts.pools.length === 0 ? (
                    <span className="text-ink-muted">{t("arrays.noPool")}</span>
                ) : (
                    <span className="flex flex-wrap gap-1.5">
                        {facts.pools.map((pool) => <CrossLink key={pool} kind="pool" id={pool}>{pool}</CrossLink>)}
                    </span>
                )}
            </Fact>
        </dl>
    );
}

/**
 * The wizard of an array of the cluster configuration (`SectionWizard`): its name and
 * type, then the keys of its type. `arrays`, those there are, their names taken; `edit`,
 * one to modify.
 */
export function ArrayWizard({arrays, nodes, edit, onClose, onSaved}) {
    return (
        <SectionWizard
            section="array"
            rules={ARRAY_RULES}
            prefix="arrays.wizard"
            items={arrays.map((a) => ({name: a.name}))}
            nodes={nodes}
            edit={edit}
            onClose={onClose}
            onSaved={onSaved}
        />
    );
}

/** The pools still naming an array, said before it is deleted. */
const poolsInUse = async (name) => poolsOfArray(await read(`${URL_CLUSTER}/config/file?redact-secrets=true`, "text"), name).length;

/**
 * The section of an array in the cluster configuration (`SectionConfig`): root edits
 * it, modifies it in the array wizard, deletes it (`onDeleted`, then).
 */
export function ArrayConfig({name, onDeleted}) {
    return (
        <SectionConfig
            section="array"
            name={name}
            prefix="arrays.panel"
            listUrl={URL_ARRAY}
            inUse={poolsInUse}
            onDeleted={onDeleted}
            renderWizard={({items, ...props}) => <ArrayWizard arrays={items} {...props}/>}
        />
    );
}
