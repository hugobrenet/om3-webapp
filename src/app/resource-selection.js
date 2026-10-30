import {ONE_RESOURCE_ACTIONS} from "../constants/actions";
import {resourceActions} from "../components/objectActions";

/*
 * The resources selected in the list of the resources of the cluster, acted on
 * together: an action posted once per instance, its resources there picked by a
 * rid expression, the actions offered those every resource selected takes.
 */

/**
 * The instances the selected lines are resources of, each the object, its node and
 * the rids picked there (`fs#1,app#2`, a rid expression of om): one request each.
 */
export function resourceTargets(lines) {
    const byInstance = new Map();
    for (const l of lines) {
        const key = `${l.object}@${l.hostNode}`;
        if (!byInstance.has(key)) byInstance.set(key, {path: l.object, node: l.hostNode, rids: []});
        const instance = byInstance.get(key);
        if (!instance.rids.includes(l.rid)) instance.rids.push(l.rid);
    }
    return [...byInstance.values()]
        .sort((a, b) => a.path.localeCompare(b.path) || a.node.localeCompare(b.node))
        .map(({path, node, rids}) => ({path, node, rid: rids.sort((a, b) => a.localeCompare(b)).join(",")}));
}

/**
 * The actions every selected resource takes, by its driver, in the order of the
 * actions; a console, of one resource alone.
 */
export function commonResourceActions(lines) {
    if (lines.length === 0) return [];
    const [first, ...others] = lines.map((l) => resourceActions(l.rid, l.type));
    return first
        .filter((action) => others.every((actions) => actions.some((a) => a.name === action.name)))
        .filter((action) => !ONE_RESOURCE_ACTIONS.includes(action.name) || lines.length === 1);
}
