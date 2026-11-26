import {facetCounts} from "./facets";

/*
 * The facets of the list of objects: for each value of a filter, how many objects
 * it would keep, the other filters as they are. Clicked, a value shows that many.
 *
 * The fields of an object's status in two kinds: those of closed values, a section
 * each of the State filter or of the Config one, a value chosen or not; those of open
 * values, a field typed in (the instances up).
 */

/** The key of the validation of an object's configuration, beside its status (useConfigValidations). */
export const VALIDATION_KEY = "config_validation";

/**
 * The fields of closed values of an object's status, as om says them: its key in
 * the status, its parameter in the address, its values in the order shown (any
 * other value an object has after them, by name), those `offered` even none has
 * them, and its `group`, the filter it is a section of: State, what the object is
 * in; Config, what its configuration says, and its validation.
 */
export const STATE_FIELDS = [
    {key: "avail", param: "avail", group: "state", order: ["up", "down", "warn", "stdby up", "stdby down", "n/a", "undef"]},
    {key: "overall", param: "overall", group: "state", order: ["up", "down", "warn", "stdby up", "stdby down", "n/a", "undef"]},
    {key: "provisioned", param: "provisioned", group: "state", order: ["mixed", "true", "false", "n/a", "undef"]},
    {key: "frozen", param: "frozen", group: "state", order: ["mixed", "frozen", "unfrozen", "n/a"]},
    {key: "placement_state", param: "placement", group: "state", order: ["optimal", "non-optimal", "n/a", "undef"]},
    {key: "topology", param: "topology", group: "config", order: ["failover", "flex"]},
    {key: "orchestrate", param: "orchestrate", group: "config", order: ["ha", "start", "no"]},
    {key: "placement_policy", param: "policy", group: "config", order: ["nodes order", "last start", "load avg", "shift", "spread", "score", "none"]},
    {key: VALIDATION_KEY, param: "validation", group: "config", order: ["warning", "error", "valid"], offered: ["warning"]},
];

/** The fields of a filter, by its group. */
export const fieldsOf = (group) => STATE_FIELDS.filter((field) => field.group === group);

/** The value of a field of an object's status, as a string: none, an object without it. */
export function fieldValueOf(status, key) {
    const value = status?.[key];
    return value === undefined || value === null || value === "" ? undefined : String(value);
}

/**
 * The values of a field to offer: those the objects have, those chosen and those it
 * offers anyway, in the order of the field, any other after them by name.
 */
export function fieldValues(field, statuses, selected = []) {
    const present = new Set([...selected, ...(field.offered ?? [])]);
    for (const status of statuses) {
        const value = fieldValueOf(status, field.key);
        if (value !== undefined) present.add(value);
    }
    const known = field.order.filter((v) => present.has(v));
    const others = [...present].filter((v) => !field.order.includes(v)).sort((a, b) => a.localeCompare(b));
    return [...known, ...others];
}

/**
 * A count of instances typed in: a number, or one after a comparison (=, <, <=, >,
 * >=). Null when nothing is typed, undefined when what is typed is not one.
 */
export function parseCount(text) {
    const typed = (text ?? "").trim();
    if (typed === "") return null;
    const m = typed.match(/^(<=|>=|<|>|=)?\s*(\d+)$/);
    if (!m) return undefined;
    return {op: m[1] ?? "=", value: Number(m[2])};
}

/** Whether a count passes a comparison typed in (parseCount); none typed, or not one, every count. */
export function countKept(count, comparison) {
    if (!comparison) return true;
    if (typeof count !== "number") return false;
    const {op, value} = comparison;
    if (op === "<") return count < value;
    if (op === "<=") return count <= value;
    if (op === ">") return count > value;
    if (op === ">=") return count >= value;
    return count === value;
}

/**
 * Whether an object's status passes the State filter, `selected` the values chosen of
 * each field by its key: any of them in a field, every field; none chosen in a field,
 * every object. A field `reversed` (its key in it), none of them in that field instead.
 * An object of no status kept by no value chosen, by every one reversed.
 */
export function stateKept(status, selected, reversed = []) {
    return STATE_FIELDS.every(({key}) => {
        const values = selected[key] ?? [];
        return values.length === 0 || values.includes(fieldValueOf(status, key)) !== reversed.includes(key);
    });
}

/**
 * The counts of the values of each filter over `names`: those of each field of the
 * State filter among the objects the name, up instances, other fields, namespace and
 * kind filters keep; those of the namespaces among the objects the others keep; those
 * of the kinds likewise. `useState` and `useKind` false, those filters keep every
 * object, as on the tabs that have them not. `states`, the values chosen of each field
 * by its key; `reversed`, the keys of the fields reversed (stateKept); `upInstances`, a
 * comparison of the instances up (parseCount).
 */
export function objectFacets(names, filters, {objects, namespaceOf, kindOf, useState = true, useKind = true}) {
    const {search = "", namespaces = [], kinds = [], states = {}, reversed = [], upInstances = null} = filters;
    const searchLower = search.toLowerCase();
    const fields = Object.fromEntries(STATE_FIELDS.map(({key}) => [key, {
        selected: useState ? states[key] ?? [] : [],
        reversed: reversed.includes(key),
        valuesOf: (name) => {
            const value = fieldValueOf(objects[name], key);
            return value === undefined ? [] : [value];
        },
    }]));
    return facetCounts(names, {
        match: (name) => (searchLower === "" || name.toLowerCase().includes(searchLower))
            && (!useState || countKept(objects[name]?.up_instances_count, upInstances)),
        facets: {
            ...fields,
            namespace: {selected: namespaces, valuesOf: (name) => [namespaceOf(name)]},
            kind: {selected: useKind ? kinds : [], valuesOf: (name) => [kindOf(name)]},
        },
    });
}

/**
 * The State filter of an address: the values chosen of each field, by its key, from
 * its parameter; those of the global state an older address holds (`globalState`), its
 * availabilities, and unprovisioned, the object not provisioned.
 */
export function statesOf(params) {
    const list = (param) => {
        const value = params.get(param);
        return !value || value === "all" ? [] : value.split(",").filter(Boolean);
    };
    const legacy = list("globalState");
    const states = Object.fromEntries(STATE_FIELDS.map(({key, param}) => [key, list(param)]));
    const union = (a, b) => [...new Set([...a, ...b])];
    states.avail = union(states.avail, legacy.filter((v) => v !== "unprovisioned"));
    if (legacy.includes("unprovisioned")) states.provisioned = union(states.provisioned, ["false"]);
    return states;
}

/** The parameter of an address naming the fields of the State filter reversed, by their parameters. */
export const REVERSED_PARAM = "not";

/**
 * The fields of the State filter an address reverses, by their keys: those `not` names
 * by their parameters, a value chosen in them; a field of none chosen, reversed of nothing.
 */
export function reversedOf(params, states = statesOf(params)) {
    const named = (params.get(REVERSED_PARAM) ?? "").split(",").filter(Boolean);
    return STATE_FIELDS.filter(({key, param}) => named.includes(param) && (states[key] ?? []).length > 0).map(({key}) => key);
}
