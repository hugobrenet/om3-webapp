import {facetCounts} from "./facets";

/*
 * The facets of the list of objects: for each value of a filter, how many objects
 * it would keep, the other filters as they are. Clicked, a value shows that many.
 */

const AVAILS = ["up", "down", "warn"];

/**
 * Whether an instance of the object is not provisioned: all of them (false), or some
 * (mixed, provisioned on a node, not on another).
 */
const hasUnprovisioned = (status) => [false, "false", "mixed"].includes(status?.provisioned);

/**
 * The global states an object has: its availability, n/a when none of up, down, warn;
 * and unprovisioned when one of its instances is.
 */
export function globalStatesOf(status) {
    const states = [AVAILS.includes(status?.avail) ? status.avail : "n/a"];
    if (hasUnprovisioned(status)) states.push("unprovisioned");
    return states;
}

/**
 * The counts of the values of each filter over `names`: those of the global states
 * among the objects the name, namespace and kind filters keep; those of the
 * namespaces among the objects the others keep; those of the kinds likewise.
 * `useGlobalState` and `useKind` false, those filters keep every object, as on the
 * tabs that have them not. An object of no status has no global state: kept by no
 * global state chosen.
 */
export function objectFacets(names, filters, {objects, namespaceOf, kindOf, useGlobalState = true, useKind = true}) {
    const {search = "", namespaces = [], kinds = [], globalStates = []} = filters;
    const searchLower = search.toLowerCase();
    return facetCounts(names, {
        match: (name) => searchLower === "" || name.toLowerCase().includes(searchLower),
        facets: {
            globalState: {
                selected: useGlobalState ? globalStates : [],
                valuesOf: (name) => (objects[name] ? globalStatesOf(objects[name]) : []),
            },
            namespace: {selected: namespaces, valuesOf: (name) => [namespaceOf(name)]},
            kind: {selected: useKind ? kinds : [], valuesOf: (name) => [kindOf(name)]},
        },
    });
}
