import React, {useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_ARRAY} from "../config/apiPath.js";
import {usePanelSearch} from "../app/panel-search";
import {useIsRoot} from "../hooks/useGrants";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Spinner} from "../ui/components/Spinner";
import {ObjectIcon} from "../ui/components/ObjectIcon";
import {PlusIcon} from "../ui/icons";
import {ArrayDetailPanel} from "./RecordPanels";
import {ArrayWizard, arrayFacts, useArrays} from "./ArrayPanel";
import {read, readNodes} from "./SectionConfig";
import {BADGE} from "./ObjectCells";
import {useSettle} from "../hooks/useSettle";

/**
 * An array as a card: its name and type over where the nodes reach it; at its foot,
 * the pools making their disks on it. Clicked, its panel.
 */
function ArrayCard({facts, selected, onOpen}) {
    const {t} = useTranslation();
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-current={selected || undefined}
            aria-label={t("arrays.open", {name: facts.name})}
            className={`flex h-full w-full min-w-0 flex-col gap-3 rounded-(--radius-panel) border bg-surface-raised p-3 text-left hover:border-line-strong ${selected ? "border-accent" : "border-line"}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <ObjectIcon kind="array" className="h-4 w-4"/>
                <span className="min-w-0 flex-1 truncate font-semibold">{facts.name}</span>
                <span className={BADGE}>{facts.type}</span>
            </span>
            <span className="-mt-2 truncate font-mono text-data text-ink-muted">{facts.endpoint ?? t("arrays.noEndpoint")}</span>
            <span className="mt-auto flex min-w-0 flex-col gap-1 border-t border-line pt-2 text-data text-ink-muted">
                <span>{t("arrays.poolsOn", {count: facts.pools.length})}</span>
                {facts.pools.length > 0 && (
                    <span className="flex min-w-0 flex-wrap gap-1">
                        {facts.pools.map((pool) => (
                            <span key={pool} className="rounded-(--radius-control) bg-surface-sunken px-1.5">{pool}</span>
                        ))}
                    </span>
                )}
            </span>
        </button>
    );
}

/**
 * The storage arrays of the cluster configuration (GET /api/array), root only: a card
 * each, its type, where it is reached, the pools on it, opening its panel; one added
 * from the plus card, its wizard.
 */
export default function Arrays() {
    const {t} = useTranslation();
    const isRoot = useIsRoot();
    // Read by root alone, once known to be: its grants not read, nothing asked.
    const {data, error, reload} = useArrays(isRoot === true);
    const {sel, select, tab, setTab} = usePanelSearch();
    const [adding, setAdding] = useState(null);
    const items = data?.items ?? [];

    /**
     * The list read until `settled` says the array is there, or gone, no more once the
     * page is left; the page read again then.
     */
    const settleList = useSettle();
    const settle = async (settled) => {
        try {
            return await settleList(async () => (await read(URL_ARRAY)).items ?? [], settled);
        } catch {
            return false;
        } finally {
            reload();
        }
    };
    const added = async (name) => {
        setAdding(null);
        if (await settle((now) => now.some((a) => a.name === name))) select(name);
    };
    const deleted = async (name) => {
        select(undefined);
        await settle((now) => !now.some((a) => a.name === name));
    };
    const startAdding = async () => {
        let nodes = [];
        try {
            nodes = await readNodes();
        } catch {
            // Without the nodes, a per-node key is asked of none.
        }
        setAdding({nodes});
    };

    // The grants not read yet: neither the arrays nor that they are root's.
    if (isRoot === undefined) {
        return <div className="flex justify-center p-4"><Spinner label={t("arrays.loading")}/></div>;
    }
    if (!isRoot) {
        return <div className="p-4"><Alert tone="info">{t("arrays.rootOnly")}</Alert></div>;
    }
    return (
        <div className="p-4 space-y-3">
            {error && (
                <Alert action={<Button size="sm" onClick={reload}>{t("common.retry")}</Button>}>
                    {t("arrays.loadError", {message: error})}
                </Alert>
            )}
            {data === undefined ? (
                <div className="flex justify-center py-8"><Spinner label={t("arrays.loading")}/></div>
            ) : (
                <ul aria-label={t("arrays.caption")} className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
                    {items.map((item) => (
                        <li key={item.name} data-array={item.name} className="min-w-0">
                            <ArrayCard facts={arrayFacts(item, data.config)} selected={sel === item.name} onOpen={() => select(item.name)}/>
                        </li>
                    ))}
                    {/* A new one: a light card, its wizard, as on the stores page. */}
                    <li className="min-w-0">
                        <button
                            type="button"
                            data-new-array=""
                            onClick={startAdding}
                            className="flex h-full min-h-24 w-full items-center justify-center gap-1.5 rounded-(--radius-panel) border border-dashed border-line px-2 py-1.5 text-ink-muted hover:border-accent hover:text-accent"
                        >
                            <PlusIcon className="h-4 w-4"/>
                            {t("arrays.add")}
                        </button>
                    </li>
                </ul>
            )}
            {data !== undefined && items.length === 0 && <p className="text-ink-muted">{t("arrays.empty")}</p>}
            <ArrayDetailPanel name={sel} tab={tab} onTabChange={setTab} onClose={() => select(undefined)} onDeleted={deleted}/>
            {adding && <ArrayWizard arrays={items} nodes={adding.nodes} onClose={() => setAdding(null)} onSaved={added}/>}
        </div>
    );
}
