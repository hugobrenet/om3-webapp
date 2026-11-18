/*
 * The actions on a node, as its menus offer them and as they are posted: in the
 * groups of NODE_ACTIONS (the node, its inventory, its daemon), each with what it does,
 * the harmful ones red; evict posted to the cluster, which orders the node out.
 */

import {URL_CLUSTER, URL_NODE} from "../config/apiPath.js";
import {NODE_ACTION_GROUPS, NODE_ACTIONS} from "../constants/actions";
import {actionKeywords, impactBadges, keyOf} from "./action-menu";
import {trackPending, trackRefused, trackResponse} from "./action-tracker";
import {refusalReason} from "../components/objectActions";
import {getResponseErrorMessage} from "../services/api.jsx";
import {pacedFetch} from "../services/paced-fetch.js";

/** The definition of a node action, by its name. */
export const nodeAction = (name) => NODE_ACTIONS.find((action) => action.name === name);

/**
 * The request of an action on a node: its url, its body. Evict goes to the api node,
 * the cluster evicting the node; the others to the node. `names`, the networks a
 * network setup sets up, all of them when none.
 */
export function nodeActionRequest(node, name, {names = []} = {}) {
    const action = nodeAction(name);
    if (action?.cluster === "evict") {
        return {url: `${URL_CLUSTER}/evict`, body: JSON.stringify({nodename: node})};
    }
    const query = names.map((n) => `name=${encodeURIComponent(n)}`).join("&");
    return {url: `${URL_NODE}/${encodeURIComponent(node)}/${action?.endpoint ?? `action/${name}`}${query ? `?${query}` : ""}`};
}

/**
 * Posts an action on a node with the `headers` of the user, what comes of it,
 * accepted or refused, said by the actions tray: an action held (a network setup)
 * in it from its request on, ended by the answer of the node. `names`, the networks
 * of a network setup; `subject`, what the tray says it acts on, the node by default.
 */
export async function postNodeAction(node, name, headers, {names, subject = node} = {}) {
    const {url, body} = nodeActionRequest(node, name, {names});
    const pending = nodeAction(name)?.held ? trackPending({action: name, subject, node}) : null;
    const refuse = (reason, status) => {
        if (pending) pending.refused(reason, status);
        else trackRefused({action: name, subject, reason});
    };
    try {
        const response = await pacedFetch(url, {
            method: "POST",
            headers: {...headers, "Content-Type": "application/json"},
            ...(body === undefined ? {} : {body}),
        });
        if (!response.ok) {
            const detail = await getResponseErrorMessage(response);
            refuse(refusalReason({status: response.status, detail}), response.status);
            return;
        }
        if (pending) pending.ended();
        else await trackResponse(response, {action: name, subject, node});
    } catch (error) {
        refuse(error.message);
    }
}

/**
 * The entries of the menu of the actions on nodes, their groups in a masonry in a wide window,
 * each group under its heading, each entry with what it does, freeze and unfreeze
 * both. `offered`, whether an action is offered; `apiNode`, the node serving
 * the webapp, which cannot be evicted from here: another of the cluster evicts it.
 */
export function nodeMenuItems({t, nodes, offered = () => true, apiNode, renderIcon, onSelect}) {
    const items = [];
    NODE_ACTION_GROUPS.forEach((group) => {
        const actions = NODE_ACTIONS.filter((action) => action.group === group && action.menu !== false && offered(action.name));
        actions.forEach((action, i) => {
            const key = keyOf(action.name);
            const fromHere = action.cluster === "evict" && apiNode !== undefined && nodes.includes(apiNode);
            items.push({
                key: action.name,
                label: t(`nodeActions.${key}.label`),
                description: fromHere ? t("nodeActions.evict.fromHere") : t(`nodeActions.${key}.description`),
                icon: renderIcon(action),
                danger: action.color === "red",
                badges: impactBadges(t, action.impacts),
                keywords: actionKeywords(action),
                disabled: fromHere,
                ...(i === 0 ? {heading: t(`nodeActions.groups.${group}`)} : {}),
                onSelect: () => onSelect(action.name),
            });
        });
    });
    return items;
}
