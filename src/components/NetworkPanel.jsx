import React, {useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_NETWORK, URL_NETWORK_IP, URL_NETWORK_NODE} from "../config/apiPath.js";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {useClusterNodes} from "../hooks/usePgUsage";
import {useMenuState} from "../hooks/useSidebarAlerts";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {addressesSignature} from "../app/network-addresses";
import {NetworkSketch} from "./NetworkSketch";
import {NetworkWizard} from "./NetworkWizard";
import {SectionConfig, read, readNodes, useClusterSection} from "./SectionConfig";
import {UsageRing as Ring, formatCount} from "./UsageRing";

export {formatCount};

/**
 * The section of a network in the cluster configuration, `[network#<name>]`: its text,
 * null for a network of none (the built-in `lo` and `default`), undefined while read.
 */
export const useNetworkSection = (name) => useClusterSection("network", name);

/** The usage of a network as a ring: the share of its addresses used, how many used and free. */
export function UsageRing({used, size, free, label}) {
    const {t, i18n} = useTranslation();
    return (
        <Ring
            used={used}
            size={size}
            label={label}
            usedText={t("networks.panel.used", {count: used, value: formatCount(used, i18n.language)})}
            freeText={t("networks.panel.free", {count: free, value: formatCount(free, i18n.language)})}
        />
    );
}

/** How long the addresses are let settle before the networks are read again: a start reports a burst. */
export const ADDRESSES_SETTLE_MS = 1000;

/** The events a node says it set a network up, or tore it down, with: their deletions come with them. */
const SETUP_EVENTS = ["NodeNetworkStatusUpdated"];

/**
 * What the setup of a network made on each node: what was read at first
 * (`/api/network/node`, `read` at `readAt`), each node then as its events said it
 * since, set up again or torn down (`said`, the store's `networkStatus`). A node said
 * before the read, the read wins: it may have gone since, which the event cache does
 * not say again. The read failed, the events alone.
 */
export function mergeNetworkReports(name, read, readAt, said) {
    const nodes = new Set([...Object.keys(read ?? {}), ...Object.keys(said ?? {})]);
    const reports = [];
    for (const node of [...nodes].sort()) {
        const event = said?.[node];
        const status = event && (read === null || event.at > readAt) ? event.status : read?.[node];
        if (status) reports.push({...status, name, node});
    }
    return reports;
}

/** The events the addresses of the instances come with: their status, and its delete. */
const ADDRESS_EVENTS = ["InstanceStatusUpdated", "InstanceStatusDeleted"];

/**
 * A count of the changes a view of the networks reads again on: of the cluster
 * configuration the menu stream reads, a subnet the daemon chose for a node of a
 * routed bridge written there (`subnet@<node>`); of the addresses the ip resources
 * report in the status of their instances, once a burst of them is over
 * (ADDRESSES_SETTLE_MS), the daemon matching and counting them its own way; of the
 * network lists the menu polls, what an event missed.
 */
export function useNetworkChanges() {
    const polled = useMenuState((s) => s.networks);
    const config = useMenuState((s) => s.clusterConfig);
    // The status of the instances, carried by the stream while a view of the networks is shown.
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, ADDRESS_EVENTS) : null;
        return () => release?.();
    }, []);
    const addresses = useEventStore((s) => addressesSignature(s.objectInstanceStatus));
    const [changes, setChanges] = useState(0);
    // What was there at first is what the view reads at first: a change is from it on.
    const seen = useRef({polled, config, addresses});
    useEffect(() => {
        if (seen.current.polled === polled && seen.current.config === config) return;
        seen.current = {...seen.current, polled, config};
        setChanges((n) => n + 1);
    }, [polled, config]);
    useEffect(() => {
        if (seen.current.addresses === addresses) return undefined;
        const timer = setTimeout(() => {
            seen.current = {...seen.current, addresses};
            setChanges((n) => n + 1);
        }, ADDRESSES_SETTLE_MS);
        return () => clearTimeout(timer);
    }, [addresses]);
    return changes;
}

/**
 * What a network hands out: its usage, as a ring, and its sketch, the addresses in
 * use on each node; read again as the networks or the cluster configuration change,
 * what was read kept shown meanwhile.
 */
export function NetworkOverview({name}) {
    const {t} = useTranslation();
    const [network, setNetwork] = useState(undefined);
    const [addresses, setAddresses] = useState(null);
    // What the setups made, read once: by node, null unread, and when.
    const [readSetups, setReadSetups] = useState({byNode: null, at: 0});
    const [error, setError] = useState(null);
    // Read again by itself as the cluster configuration changes (useClusterSection).
    const {section} = useNetworkSection(name);
    const storeNodes = useClusterNodes();
    const [clusterNodes, setClusterNodes] = useState(null);
    const changes = useNetworkChanges();

    useEffect(() => {
        let live = true;
        // Read again: a failure keeps what was read, said only when nothing was.
        const again = changes > 0;
        read(`${URL_NETWORK}?name=${encodeURIComponent(name)}`).then(
            (data) => live && (setError(null), setNetwork((data.items ?? []).find((n) => n.name === name) ?? null)),
            (err) => live && !again && (setError(err.message), setNetwork(null)),
        );
        // The nodes of the cluster, all of them in the sketch, those holding no address too.
        readNodes().then((nodes) => live && setClusterNodes(nodes), () => live && !again && setClusterNodes([]));
        read(URL_NETWORK_IP).then(
            (data) => live && setAddresses((data.items ?? []).filter((ip) => ip.network?.name === name)),
            () => live && !again && setAddresses([]),
        );
        return () => {
            live = false;
        };
    }, [name, changes]);

    // What the setup of the network made on each node, its podnet's peers and tunnels
    // with it: read once, then as the nodes say it, set up again or torn down, by their
    // events (root's, as the read).
    const said = useEventStore((s) => s.networkStatus?.[name]);
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token, SETUP_EVENTS) : null;
        return () => release?.();
    }, []);
    useEffect(() => {
        let live = true;
        const at = Date.now();
        read(`${URL_NETWORK_NODE}?name=${encodeURIComponent(name)}&node=*`).then(
            (data) => {
                if (!live) return;
                const byNode = {};
                for (const item of Array.isArray(data.items) ? data.items : []) {
                    if (item.name === name && item.node) byNode[item.node] = item;
                }
                setReadSetups({byNode, at});
            },
            () => live && setReadSetups({byNode: null, at}),
        );
        return () => {
            live = false;
        };
    }, [name]);
    const reports = useMemo(
        () => mergeNetworkReports(name, readSetups.byNode, readSetups.at, said),
        [name, readSetups, said],
    );

    // The nodes of the sketch: those of the cluster; unread, those the page knows, or those holding addresses.
    const sketchNodes = useMemo(() => {
        if (clusterNodes?.length) return clusterNodes;
        if (storeNodes.length) return storeNodes;
        return [...new Set((addresses ?? []).map((ip) => ip.node).filter(Boolean))].sort();
    }, [clusterNodes, storeNodes, addresses]);

    if (network === undefined) return <Spinner label={t("networks.panel.loading")}/>;
    if (network === null) return <Alert tone="error">{error ? t("networks.panel.readFailed", {message: error}) : t("networks.panel.none", {name})}</Alert>;

    return (
        <div className="space-y-5">
            {/* Its type and range in the band of the sketch. */}
            <section aria-labelledby={`network-usage-${name}`} className="space-y-2">
                <h3 id={`network-usage-${name}`} className="font-semibold">{t("networks.panel.usage")}</h3>
                <UsageRing used={network.used ?? 0} size={network.size} free={network.free ?? 0} label={t("networks.usageOf", {name})}/>
            </section>

            {addresses !== null && section !== undefined && clusterNodes !== null && (
                <section aria-labelledby={`network-sketch-${name}`} className="space-y-2">
                    <h3 id={`network-sketch-${name}`} className="font-semibold">{t("networks.sketch.title")}</h3>
                    <NetworkSketch network={network} section={section} nodes={sketchNodes} addresses={addresses} reports={reports}/>
                </section>
            )}
        </div>
    );
}

/** The addresses a network still hands out, said before it is deleted. */
const addressesInUse = async (name) => (await read(`${URL_NETWORK}?name=${encodeURIComponent(name)}`)).items?.find((n) => n.name === name)?.used ?? 0;

/**
 * The section of a network in the cluster configuration (`SectionConfig`): root edits
 * it, modifies it in the network wizard, deletes it (`onDeleted`, then).
 */
export function NetworkConfig({name, onDeleted}) {
    return (
        <SectionConfig
            section="network"
            name={name}
            prefix="networks.panel"
            listUrl={URL_NETWORK}
            inUse={addressesInUse}
            onDeleted={onDeleted}
            renderWizard={({items, ...props}) => <NetworkWizard networks={items} {...props}/>}
        />
    );
}
