import React, {useMemo} from "react";
import {useTranslation} from "react-i18next";
import {usePeek} from "../app/panel-search";
import {sectionValues} from "../app/heartbeat-config";
import {CHAR_WIDTH, routeVias, sketchLayout, tunnelModes} from "../app/network-sketch";
import {TOUCH_QUERY, useMediaQuery} from "../ui/lib/media";
import {Sketch} from "./Sketch";

/**
 * The sketch of a network (`network-sketch.ts`): its range in a band over the nodes,
 * what it is on each node in a box under it, routed between them for a routed bridge,
 * and the objects holding its addresses under the boxes, each opening its panel.
 * `network`, as the network list gives it; `section`, its section of the cluster
 * configuration; `addresses`, those it handed out; `reports`, what its setup made on
 * each node, the tunnels and routes between them as the nodes made them.
 */
export function NetworkSketch({network, section, nodes, addresses, reports}) {
    const {t} = useTranslation();
    const peek = usePeek();
    const touch = useMediaQuery(TOUCH_QUERY);
    const computed = t("networks.sketch.computed");
    const values = useMemo(() => sectionValues(section ?? null), [section]);
    // The routes between the nodes as they reported them; of no report, those of a routed
    // bridge, through a mesh of tunnels unless never, its policy and mode said when set.
    const routeLabel = useMemo(() => {
        const vias = routeVias(reports);
        if (!reports?.length) {
            return values.tunnel === "never"
                ? t("networks.sketch.routedLabel")
                : [t("networks.sketch.tunnelMesh"), values.tunnel, values.tunnel_mode].filter(Boolean).join(" · ");
        }
        // The modes of the tunnels the nodes made, ipip over ipv6 being ip6ip6.
        const tunnelMesh = [t("networks.sketch.tunnelMesh"), values.tunnel, ...tunnelModes(reports)].filter(Boolean).join(" · ");
        if (vias.includes("vxlan")) return t("networks.sketch.vxlanMesh");
        if (vias.includes("tunnel") && vias.includes("route")) return t("networks.sketch.tunnelsAndRoutes");
        if (vias.includes("tunnel")) return tunnelMesh;
        return t("networks.sketch.routedLabel");
    }, [reports, values, t]);
    const layout = useMemo(() => sketchLayout({
        name: network.name,
        type: network.type,
        network: network.network,
        values,
        nodes,
        addresses,
        reports,
        touch,
    }, computed.length * CHAR_WIDTH, routeLabel.length * CHAR_WIDTH), [network, values, nodes, addresses, reports, touch, computed, routeLabel]);

    return (
        <Sketch
            layout={layout}
            title={`${network.name} · ${network.type}`}
            caption={t("networks.sketch.label", {name: network.name, count: nodes.length})}
            computed={computed}
            route={{label: routeLabel}}
            texts={{
                count: (count) => t("networks.sketch.addresses", {count}),
                shared: (count) => t("networks.sketch.sharedOn", {count}),
                group: (block) => t("networks.sketch.shared", {count: block.count}),
                object: (o) => t("networks.sketch.object", {path: o.path, node: o.node, count: o.count}),
                sharedObject: (o) => t("networks.sketch.sharedObject", {path: o.path, count: o.count, nodes: o.nodes.join(", ")}),
                more: (count) => t("networks.sketch.more", {count}),
            }}
            onOpen={(path) => peek("object", path)}
        />
    );
}
