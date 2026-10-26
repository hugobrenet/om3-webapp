/**
 * A sentence of the catalog filled with untrusted values, such as object
 * paths or what the MCP and the model return. i18next interpolates its
 * placeholders one after the other, over the text already filled: a value
 * holding "{{node}}" would be filled again. Each value goes in its place as a
 * marker the values cannot hold, the markers are replaced in one pass, and a
 * value is never read again.
 */
export function untrustedT(t, key, values = {}, options = {}) {
    const names = Object.keys(values);
    const markers = Object.fromEntries(names.map((name, index) => [name, `\u0000${index}\u0000`]));
    const sentence = t(key, {...options, ...markers});
    return String(sentence).replace(/\u0000(\d+)\u0000/g, (_, index) => String(values[names[Number(index)]]));
}
