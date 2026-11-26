/*
 * The facets of a list: for each value of each filter, how many items it would keep,
 * the other filters as they are, so that a value clicked shows that many. Each facet,
 * the values chosen (none keeps every item) and the values of an item (several: an
 * item kept by any of them); `reversed`, an item kept by none of them instead.
 */

/**
 * The counts of the values of each facet over the items `match` keeps (the words
 * searched): those of a facet among the items every other facet keeps.
 */
export function facetCounts(items, {match = () => true, facets}) {
    const names = Object.keys(facets);
    const counts = Object.fromEntries(names.map((name) => [name, {}]));
    for (const item of items) {
        if (!match(item)) continue;
        const values = names.map((name) => facets[name].valuesOf(item));
        const kept = names.map((name, i) => {
            const {selected, reversed = false} = facets[name];
            return selected.length === 0 || values[i].some((value) => selected.includes(value)) !== reversed;
        });
        names.forEach((name, i) => {
            if (!kept.every((ok, j) => j === i || ok)) return;
            for (const value of values[i]) counts[name][value] = (counts[name][value] ?? 0) + 1;
        });
    }
    return counts;
}

/** A value chosen in a facet, or no longer: the list of the values chosen, toggled. */
export const toggled = (selected, value) => (selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

/** Whether the words searched are in one of the values, any case; no words, every item. */
export const matches = (filter, ...values) => {
    const q = filter.trim().toLowerCase();
    return q === "" || values.some((v) => String(v ?? "").toLowerCase().includes(q));
};
