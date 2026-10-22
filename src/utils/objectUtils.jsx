const COMMON_SVC_ACTIONS = [
    "start",
    "stop",
    "restart",
    "freeze",
    "unfreeze",
    "delete",
    "provision",
    "unprovision",
    "purge",
    "switch",
    "giveback",
    "abort",
];

const ALLOWED_ACTIONS_BY_KIND = {
    // The cluster object stands for the cluster: its actions are the cluster's, on
    // all the nodes (`om cluster freeze`), not an object's (see actionUrl).
    ccfg: ["abort", "freeze", "unfreeze"],
    cfg: ["abort", "delete"],
    vol: ["abort", "delete", "freeze", "provision", "purge", "unfreeze", "unprovision"],
    sec: ["abort", "delete"],
    usr: ["abort", "delete"],
    // svc-only actions enable / disable are mounted directly at the object
    // path (not under /action) and are declared with `kinds: ["svc"]` in
    // OBJECT_ACTIONS. They must be listed here too, otherwise
    // isActionAllowedForSelection rejects them and the menu entries stay
    // disabled or hidden.
    svc: [...COMMON_SVC_ACTIONS, "enable", "disable"],
    default: COMMON_SVC_ACTIONS,
};

export const parseObjectPath = (objName) => {
    if (!objName || typeof objName !== "string") {
        return {namespace: "root", kind: "svc", name: ""};
    }
    // A namespace configuration, as om3 writes it: "<namespace>/", "/" for the root one.
    if (objName.endsWith("/")) {
        return {namespace: objName === "/" ? "root" : objName.slice(0, -1), kind: "nscfg", name: "namespace"};
    }
    const parts = objName.split("/");
    let name, kind, namespace;
    if (parts.length === 3) {
        namespace = parts[0];
        kind = parts[1];
        name = parts[2];
    } else if (parts.length === 2) {
        namespace = "root";
        kind = parts[0];
        name = parts[1];
    } else {
        namespace = "root";
        name = parts[0];
        kind = name === "cluster" ? "ccfg" : "svc";
    }
    return {namespace, kind, name};
};

const extractNamespace = (name) => {
    const {namespace} = parseObjectPath(name);
    return namespace;
};

const extractKind = (name) => {
    const {kind} = parseObjectPath(name);
    return kind;
};

const isActionAllowedForSelection = (actionName, selectedObjects) => {
    if (selectedObjects.length === 0) return false;

    const selectedKinds = [...new Set(selectedObjects.map(extractKind))];

    if (selectedKinds.length === 1) {
        const kind = selectedKinds[0];
        const allowedActions = ALLOWED_ACTIONS_BY_KIND[kind] || ALLOWED_ACTIONS_BY_KIND.default;
        return allowedActions.includes(actionName);
    }

    const allowedActions = new Set();
    selectedKinds.forEach(kind => {
        const actions = ALLOWED_ACTIONS_BY_KIND[kind] || ALLOWED_ACTIONS_BY_KIND.default;
        actions.forEach(action => allowedActions.add(action));
    });

    return allowedActions.has(actionName);
};

export {extractNamespace, extractKind, isActionAllowedForSelection, ALLOWED_ACTIONS_BY_KIND};
