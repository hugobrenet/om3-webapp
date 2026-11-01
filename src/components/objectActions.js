import {URL_CLUSTER, URL_NODE, URL_OBJECT} from "../config/apiPath.js";
import {INSTANCE_ACTIONS, NODE_ACTIONS, OBJECT_ACTIONS, RESOURCE_ACTIONS, objectActionsFor} from "../constants/actions";
import {getResponseErrorMessage} from "../services/api.jsx";
import {isActionAllowedForSelection, parseObjectPath} from "../utils/objectUtils.jsx";
import {trackRefused, trackResponse} from "../app/action-tracker";
import {optionsRequest} from "../app/action-options";
import {configStamp} from "../app/config-stamps";
import i18n from "../i18n";

/*
 * The actions on an object, as om runs them: on the object (the orchestration
 * deciding where), on the instance of a node, or on a resource of an instance,
 * `om <path> <action> [--node <node>] [--rid <rid>]`.
 */

const pathParts = (path) => {
    const {namespace, kind, name} = parseObjectPath(path);
    return [namespace, kind, name].map(encodeURIComponent).join("/");
};

/**
 * Clears the failed state of an instance monitor, for the orchestration to try
 * again: no action of the instance, it has an address of its own.
 */
export const CLEAR_ACTION = {name: "clear", icon: NODE_ACTIONS.find((a) => a.name === "clear")?.icon};

/**
 * The action a note of a status board asks for (`NoteFix`), where the menus offer it:
 * on instances, the instance actions, the clear its note says failed among them, the
 * cluster object's freeze and unfreeze alone; on the object, its menu's. Undefined
 * where none offers it.
 */
export function noteFixAction(path, {action, nodes}) {
    const {kind} = parseObjectPath(path);
    if (nodes.length === 0) {
        return objectActionsFor(kind).find((a) => a.name === action && isActionAllowedForSelection(a.name, [path]));
    }
    if (kind === "ccfg") return INSTANCE_ACTIONS.find((a) => a.name === action && (action === "freeze" || action === "unfreeze"));
    return [CLEAR_ACTION, ...INSTANCE_ACTIONS].find((a) => a.name === action);
}

/** The address of an action, given what it acts on. */
export function actionUrl({path, action, node, rid}) {
    // The cluster object is acted on as the cluster, on all the nodes: `om cluster
    // freeze`, not the freeze of an object.
    // Its instance on a node stands for the node: `om node freeze`. The cluster
    // object's own instance freeze is no node freeze, nothing a user would see.
    if (parseObjectPath(path).kind === "ccfg" && rid === undefined) {
        return node === undefined
            ? `${URL_CLUSTER}/action/${encodeURIComponent(action)}`
            : `${URL_NODE}/${encodeURIComponent(node)}/action/${encodeURIComponent(action)}`;
    }
    if (node === undefined) {
        const endpoint = OBJECT_ACTIONS.find((a) => a.name === action)?.endpoint ?? `action/${action}`;
        return `${URL_OBJECT}/${pathParts(path)}/${endpoint}`;
    }
    const base = `${URL_NODE}/${encodeURIComponent(node)}/instance/path/${pathParts(path)}`;
    if (action === CLEAR_ACTION.name && rid === undefined) return `${base}/clear`;
    const instance = `${base}/action`;
    // On resources: the endpoint of the action, "sync update" at "update", the resources picked by `rid`.
    if (rid !== undefined) {
        const endpoint = RESOURCE_ACTIONS.find((a) => a.name === action)?.endpoint
            ?? INSTANCE_ACTIONS.find((a) => a.name === action)?.endpoint ?? encodeURIComponent(action);
        return `${instance}/${endpoint}?rid=${encodeURIComponent(rid)}`;
    }
    const endpoint = INSTANCE_ACTIONS.find((a) => a.name === action)?.endpoint ?? action;
    return `${instance}/${endpoint}`;
}

/** The instance actions asking for no configuration in particular: they change nothing of it. */
const UNSTAMPED = [CLEAR_ACTION.name, "status", "info"];

/** What an action runs on, for its options: the object, instances, resources of instances. */
export const actionScope = ({node, rid}) => (rid !== undefined ? "resource" : node !== undefined ? "instance" : "object");

/**
 * The request of an action, its `options` set (app/action-options): the address
 * with the options read from the query, and the json body of the ones read from
 * it, none when no option goes there. An instance action asks for the
 * configuration last written here of the object (app/config-stamps), refused by an
 * instance not holding it yet, but for the ones only reading it (a refresh of the
 * status, the info). The cluster object's actions take none.
 */
export function actionRequest({path, action, node, rid, options}) {
    const url = actionUrl({path, action, node, rid});
    if (parseObjectPath(path).kind === "ccfg" && rid === undefined) return {url};
    const scope = actionScope({node, rid});
    const {query, body} = optionsRequest(action, scope, options);
    const params = new URLSearchParams(query);
    const stamp = scope === "object" || UNSTAMPED.includes(action) ? undefined : configStamp(path);
    if (stamp !== undefined) params.append("config_updated_at", stamp);
    const extra = params.toString();
    return {
        url: extra === "" ? url : `${url}${url.includes("?") ? "&" : "?"}${extra}`,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    };
}

/** Actions with nothing to follow: a refresh of the status, a clear of a failed monitor. */
const UNTRACKED = ["status", CLEAR_ACTION.name];

/** What an action acts on, in words, for the actions tray. */
export function actionSubject({path, node, rid}) {
    if (parseObjectPath(path).kind === "ccfg" && rid === undefined) return node ?? i18n.t("actionTray.subjects.cluster");
    if (rid !== undefined) return i18n.t("actionTray.subjects.resource", {rid, path, node});
    if (node !== undefined) return i18n.t("actionTray.subjects.instance", {path, node});
    return path;
}

/** A refusal in words: its status and the reason the daemon gave. */
export const refusalReason = ({status, detail}) => [status ? `HTTP ${status}` : "", detail ?? ""].join(" ").trim();

/**
 * Posts an action, with its `options` if any (actionRequest); resolves to null when
 * the daemon accepted it, to the reason it gave otherwise ({status, detail}).
 * Accepted, it is followed to its end in the actions tray; refused, or not sent, it
 * is said there too.
 */
export async function postAction(target) {
    const tracked = !UNTRACKED.includes(target.action);
    const subject = actionSubject(target);
    const {url, body} = actionRequest(target);
    const headers = {Authorization: `Bearer ${localStorage.getItem("authToken")}`};
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: body === undefined ? headers : {...headers, "Content-Type": "application/json"},
            ...(body === undefined ? {} : {body}),
        });
    } catch (err) {
        if (tracked) trackRefused({action: target.action, subject, reason: err.message});
        return {detail: err.message};
    }
    if (response.ok) {
        if (tracked) {
            await trackResponse(response, {action: target.action, subject, node: target.node, path: target.path});
        }
        return null;
    }
    const refusal = {status: response.status, detail: await getResponseErrorMessage(response)};
    if (tracked) trackRefused({action: target.action, subject, reason: refusalReason(refusal)});
    return refusal;
}

/** The actions whose words differ for a store: a sync of a store backs up, into the store, no peer. */
const STORE_WORDED = ["sync update", "sync full"];

/**
 * The words of the action `name` on resources of these driver `types`: "Store", a
 * backup into their store, all of them `sync.store`; "Either", to the peers or into a
 * store, some of them; "", to the peers.
 */
export function syncVariant(name, types) {
    if (!STORE_WORDED.includes(name)) return "";
    const syncs = types.filter((type) => /^(sync|disk)\./.test(String(type)) || String(type) === "sync");
    const stores = syncs.filter((type) => type === "sync.store").length;
    if (stores === 0) return "";
    return stores === syncs.length ? "Store" : "Either";
}

/**
 * The actions a resource takes, by its driver `type` ("sync.rsync", `RESOURCE_ACTIONS`):
 * a task runs, a sync resource replicates, a disk reserves its devices, a container
 * has a console. Its type unknown, the group of its id: the actions of its group alone.
 */
export function resourceActions(rid, type) {
    const known = type && String(type).includes(".") ? String(type).toLowerCase() : rid.split("#")[0].toLowerCase();
    return RESOURCE_ACTIONS.filter((a) => a.on(known));
}
