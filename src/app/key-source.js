import {parseObjectPath} from "../utils/objectUtils.jsx";

/** The kinds of the datastores, what a key is read from. */
const DATASTORE_KINDS = ["cfg", "sec", "usr"];
/** What only the node resolves: a pattern, a reference. */
const UNRESOLVED = /[*?[{]/;
/** Where `from <datastore> key <name>` stands in a value. */
export const KEY_SOURCE = /(^|\s)(from)(\s+)(\S+)(\s+)(key)(\s+)(\S+)/;

/**
 * The path of the datastore a word after `from` names in the configuration of
 * `self`, as om reads it (ParsePathRel, ParseKeyMetaRelSelf): "." is self, `./sec/ca`
 * is of the namespace of self, and `sec/ca` of the root namespace, whatever self's.
 * The path as the objects are known by, which the root namespace is not part of.
 * Undefined when it names no datastore known here.
 */
export function datastorePath(word, self) {
    if (UNRESOLVED.test(word)) return undefined;
    const own = parseObjectPath(self);
    if (word === ".") return DATASTORE_KINDS.includes(own.kind) ? self : undefined;
    const parts = word.split("/");
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => part === "")) return undefined;
    const [namespace, kind, name] = parts.length === 3 ? parts : ["root", ...parts];
    if (!DATASTORE_KINDS.includes(kind)) return undefined;
    const resolved = namespace === "." ? own.namespace : namespace;
    return resolved === "root" ? `${kind}/${name}` : `${resolved}/${kind}/${name}`;
}

/** A key of a datastore, by its name: not a pattern of names, nor a reference. */
export const isKeyName = (word) => !UNRESOLVED.test(word);
