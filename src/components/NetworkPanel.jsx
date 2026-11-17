import React, {useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_NETWORK, URL_NETWORK_IP} from "../config/apiPath.js";
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
    const [error, setError] = useState(null);
    const {section, reload: reloadSection} = useNetworkSection(name);
    const storeNodes = useClusterNodes();
    const [clusterNodes, setClusterNodes] = useState(null);
    const changes = useNetworkChanges();

    useEffect(() => {
        if (changes > 0) reloadSection();
    }, [changes, reloadSection]);

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
                    <NetworkSketch network={network} section={section} nodes={sketchNodes} addresses={addresses}/>
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
