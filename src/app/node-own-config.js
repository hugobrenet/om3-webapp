/*
 * What the configuration of a node sets itself, apart from what it takes from the
 * cluster's. Asked keyword by keyword (?kw=), the daemon answers the value in force,
 * from node.conf or cluster.conf alike (configkeywords.Node, the merged config);
 * asked whole, it lists the keys node.conf sets, and those alone.
 */

import {URL_NODE} from "../config/apiPath.js";

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") ?? ""}`});

/** The keywords the configuration of `node` sets, with their values; null when not read. */
export async function readOwnKeywords(node) {
    try {
        const response = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/config`, {headers: authHeaders()});
        if (!response.ok) return null;
        const {items = []} = await response.json();
        return new Map(items.map((i) => [i.keyword, i.value ?? ""]));
    } catch {
        return null;
    }
}

/**
 * A keyword of a node as it is written and in force: `written`, the value node.conf
 * sets, empty when it sets none; `inherited`, the value in force the cluster
 * configuration sets, empty when node.conf sets one or neither does. `own` not read
 * (null), the value in force taken as written, as nothing then tells them apart.
 */
export function ownOrInherited(keyword, value, own) {
    if (own === null) return {written: value ?? "", inherited: ""};
    if (own.has(keyword)) return {written: own.get(keyword), inherited: ""};
    return {written: "", inherited: value ?? ""};
}
