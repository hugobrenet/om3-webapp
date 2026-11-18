import React, {useCallback, useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_STORE} from "../config/apiPath.js";
import {usePanelSearch} from "../app/panel-search";
import {storeSource} from "../app/store-config";
import {useGrants} from "../hooks/useGrants";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Spinner} from "../ui/components/Spinner";
import {ObjectIcon} from "../ui/components/ObjectIcon";
import {AgeTime} from "./AgeTime";
import {useBytes, useStoreChanges} from "./StorePanel";
import {PlusIcon} from "../ui/icons";
import {StoreDetailPanel} from "./RecordPanels";
import {StoreWizard} from "./StoreWizard";
import {read, readNodes} from "./SectionConfig";
import {BADGE} from "./ObjectCells";

/** A store written or deleted: the list read again until it says so, the daemons applying the configuration. */
const SETTLE_TRIES = 10;
const SETTLE_EVERY_MS = 1000;

/** A figure of a card: its number, its name under it. */
const Figure = ({name, label, children}) => (
    <div data-figure={name} className="min-w-0">
        <div className="truncate text-lg font-semibold leading-tight tabular-nums">{children}</div>
        <div className="truncate text-data text-ink-muted">{label}</div>
    </div>
);

/**
 * The space a store has left: the backend's; on a store of each node's own, the least
 * a node has, the one to fill first. Undefined, none said.
 */
function freeOf(store) {
    if (store.stats?.free_bytes !== undefined) return {bytes: store.stats.free_bytes};
    const nodes = Object.entries(store.node_stats ?? {})
        .filter(([, s]) => s.free_bytes !== undefined)
        .sort(([a, x], [b, y]) => x.free_bytes - y.free_bytes || a.localeCompare(b));
    return nodes.length > 0 ? {bytes: nodes[0][1].free_bytes, node: nodes[0][0]} : undefined;
}

/**
 * A store as a card: its name and type over where it is; its figures as the daemon
 * sums them up, never its snapshots: how many, of how many objects, the latest, the
 * space left or else saved; unreached or holding incomplete runs, said; whom it serves
 * and where it is declared at its foot. Clicked, its panel.
 */
function StoreCard({store, selected, onOpen}) {
    const {t} = useTranslation();
    const bytes = useBytes();
    const stats = store.stats;
    const free = freeOf(store);
    const source = storeSource(store.ref);
    const share = store.share?.includes("*") ? [t("stores.everyNamespace")] : (store.share ?? []);
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-current={selected || undefined}
            aria-label={t("stores.open", {name: source.name})}
            className={`flex h-full w-full min-w-0 flex-col gap-3 rounded-(--radius-panel) border bg-surface-raised p-3 text-left hover:border-line-strong ${selected ? "border-accent" : "border-line"}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <ObjectIcon kind="store" className="h-4 w-4"/>
                <span className="min-w-0 flex-1 truncate font-semibold">{source.name}</span>
                {/* A fact of the store, a tag: no pill, a pill being a count filtering a page. */}
                <span className={BADGE}>{store.type}</span>
            </span>
            <span className="-mt-2 truncate font-mono text-data text-ink-muted">{store.url}</span>
            {!stats ? (
                <span className="text-data text-ink-muted">{t("stores.panel.noStats")}</span>
            ) : (
                // Two a row: a label of each a word or two, a compact age, room enough.
                <span data-metrics="" className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <Figure name="runs" label={t("stores.figures.snapshots", {count: stats.runs})}>{stats.runs}</Figure>
                    <Figure name="objects" label={t("stores.figures.objects", {count: stats.objects})}>{stats.objects}</Figure>
                    <Figure name="latest" label={t("stores.figures.latest")}>
                        {stats.last_created_at ? <AgeTime value={stats.last_created_at}/> : "–"}
                    </Figure>
                    {free !== undefined ? (
                        // A store of each node's own: the node with the least, the one to fill first.
                        <Figure name="free" label={free.node ? t("stores.figures.freeOn", {node: free.node}) : t("stores.figures.free")}>{bytes(free.bytes)}</Figure>
                    ) : (
                        <Figure name="saved" label={t("stores.figures.saved")}>{stats.logical_bytes > 0 ? bytes(stats.logical_bytes) : "–"}</Figure>
                    )}
                </span>
            )}
            {stats?.check_error && <span className="-mt-1 truncate text-data text-state-warn">{t("stores.check.unreached")}</span>}
            {stats?.incomplete > 0 && <span className="-mt-1 text-data text-state-warn">{t("stores.counts.incomplete", {count: stats.incomplete})}</span>}
            {/* Its foot, the same on every card: where it is declared, then whom it serves. */}
            <span className="mt-auto flex min-w-0 flex-col gap-1 border-t border-line pt-2 text-data text-ink-muted">
                <span className="truncate">
                    {source.kind === "cluster" ? t("stores.card.cluster") : t("stores.card.sec", {sec: source.sec})}
                </span>
                <span className="flex min-w-0 flex-wrap gap-1">
                    {share.length === 0 ? <span>{t("stores.none")}</span> : share.map((ns) => (
                        <span key={ns} className="rounded-(--radius-control) bg-surface-sunken px-1.5">{ns}</span>
                    ))}
                </span>
            </span>
        </button>
    );
}

/**
 * The stores the requester may use or read (GET /api/store), where the `sync.store`
 * resources keep their backups: a card each, what it is, where, whom it serves, where
 * it is declared, opening its panel; root adds one to the cluster configuration from
 * the plus card, its wizard.
 */
export default function Stores() {
    const {t} = useTranslation();
    const [stores, setStores] = useState(null);
    const [error, setError] = useState(null);
    const {sel, select, tab, setTab} = usePanelSearch();
    const isRoot = Object.prototype.hasOwnProperty.call(useGrants(), "root");
    const [adding, setAdding] = useState(null);
    /** The stores read, set and answered; none on an error, said. */
    const refresh = useCallback(async () => {
        try {
            const items = (await read(URL_STORE)).items ?? [];
            setStores(items);
            setError(null);
            return items;
        } catch (err) {
            setError(err.message);
            setStores((current) => current ?? []);
            return [];
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Read again as runs and prunes change them: a failure keeps the cards shown.
    const changes = useStoreChanges();
    useEffect(() => {
        if (changes === 0) return undefined;
        let live = true;
        read(URL_STORE).then(
            (data) => live && (setStores(data.items ?? []), setError(null)),
            () => {},
        );
        return () => {
            live = false;
        };
    }, [changes]);

    /** The list read until `settled` says the store is there, or gone. */
    const settle = async (settled) => {
        for (let i = 0; i < SETTLE_TRIES; i += 1) {
            if (settled(await refresh())) return true;
            await new Promise((resolve) => setTimeout(resolve, SETTLE_EVERY_MS));
        }
        return false;
    };
    const added = async (name) => {
        setAdding(null);
        if (await settle((items) => items.some((s) => s.ref === name))) select(name);
    };
    const deleted = async (name) => {
        select(undefined);
        await settle((items) => !items.some((s) => s.ref === name));
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

    const sorted = [...(stores ?? [])].sort((a, b) => a.ref.localeCompare(b.ref));
    return (
        <div className="p-4 space-y-3">
            {error && (
                <Alert action={<Button size="sm" onClick={() => void refresh()}>{t("common.retry")}</Button>}>
                    {t("stores.loadError", {message: error})}
                </Alert>
            )}
            {stores === null ? (
                <div className="flex justify-center py-8"><Spinner label={t("stores.loading")}/></div>
            ) : (
                <ul aria-label={t("stores.caption")} className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
                    {sorted.map((store) => (
                        <li key={store.ref} data-store={store.ref} className="min-w-0">
                            <StoreCard store={store} selected={sel === store.ref} onOpen={() => select(store.ref)}/>
                        </li>
                    ))}
                    {/* A new one, root only: a light card, its wizard. A plus card adding to a card list keeps this look, out of the rule of the buttons (`Button`). */}
                    {isRoot && (
                        <li className="min-w-0">
                            <button
                                type="button"
                                data-new-store=""
                                onClick={startAdding}
                                className="flex h-full min-h-24 w-full items-center justify-center gap-1.5 rounded-(--radius-panel) border border-dashed border-line px-2 py-1.5 text-ink-muted hover:border-accent hover:text-accent"
                            >
                                <PlusIcon className="h-4 w-4"/>
                                {t("stores.add")}
                            </button>
                        </li>
                    )}
                    {sorted.length === 0 && !isRoot && <li className="text-ink-muted">{t("stores.empty")}</li>}
                </ul>
            )}
            <StoreDetailPanel name={sel} tab={tab} onTabChange={setTab} onClose={() => select(undefined)} onDeleted={deleted}/>
            {adding && <StoreWizard stores={stores ?? []} nodes={adding.nodes} onClose={() => setAdding(null)} onSaved={added}/>}
        </div>
    );
}
