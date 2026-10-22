/*
 * The actions on a node, as its menus offer them and as they are posted: in the
 * groups of NODE_ACTIONS (the node, its inventory, its daemon), each with what it does,
 * the harmful ones red; leave posted to the cluster, which evicts the node.
 */

import {URL_CLUSTER, URL_NODE} from "../config/apiPath.js";
import {NODE_ACTION_GROUPS, NODE_ACTIONS} from "../constants/actions";

/** The key of an action in the texts of the node actions: "restart daemon" is restartDaemon. */
export const nodeActionKey = (name) => name.replace(/\s+(\w)/g, (_, c) => c.toUpperCase());

/** The definition of a node action, by its name. */
export const nodeAction = (name) => NODE_ACTIONS.find((action) => action.name === name);

/**
 * The request of an action on a node: its url, its body. Leave goes to the api node,
 * the cluster evicting the node; the others to the node.
 */
export function nodeActionRequest(node, name) {
    const action = nodeAction(name);
    if (action?.cluster === "evict") {
        return {url: `${URL_CLUSTER}/evict`, body: JSON.stringify({node})};
    }
    return {url: `${URL_NODE}/${encodeURIComponent(node)}/${action?.endpoint ?? `action/${name}`}`};
}

/**
 * The entries of the menu of the actions on nodes, a column a group in a wide window,
 * each group under its heading, each entry with what it does. `offered`, whether an
 * action is offered (freeze or unfreeze, by their state); `apiNode`, the node serving
 * the webapp, which cannot be asked to leave: another of the cluster evicts it.
 */
export function nodeMenuItems({t, nodes, offered = () => true, apiNode, renderIcon, onSelect}) {
    const items = [];
    NODE_ACTION_GROUPS.forEach((group, index) => {
        const actions = NODE_ACTIONS.filter((action) => action.group === group && action.menu !== false && offered(action.name));
        actions.forEach((action, i) => {
            const key = nodeActionKey(action.name);
            const fromHere = action.cluster === "evict" && apiNode !== undefined && nodes.includes(apiNode);
            items.push({
                key: action.name,
                label: t(`nodeActions.${key}.label`),
                description: fromHere ? t("nodeActions.leave.fromHere") : t(`nodeActions.${key}.description`),
                icon: renderIcon(action),
                danger: action.color === "red",
                disabled: fromHere,
                column: index + 1,
                ...(i === 0 ? {heading: t(`nodeActions.groups.${group}`)} : {}),
                onSelect: () => onSelect(action.name),
            });
        });
    });
    return items;
}
