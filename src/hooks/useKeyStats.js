import {useEffect, useState} from "react";
import useEventStore from "./useEventStore.js";
import {URL_OBJECT} from "../config/apiPath.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";

/** The kinds holding keys, whose keys are counted. */
const KEYED_KINDS = ["cfg", "sec", "usr"];

/**
 * The key count and size of each object read so far, by path: kept across the rows
 * and the pages of a list, read again when the configuration of the object changes
 * (`stamp`, from its InstanceConfigUpdated events).
 */
const cache = new Map();
const pending = new Map();

/** Forgets what was read: for the tests. */
export const clearKeyStats = () => {
    cache.clear();
    pending.clear();
};

const stampOf = (configs) => Object.values(configs ?? {})
    .map((c) => `${c?.csum ?? ""}@${c?.updated_at ?? ""}`)
    .sort()
    .join(",");

async function readKeys(path) {
    const {namespace, kind, name} = parseObjectPath(path);
    const response = await fetch(
        `${URL_OBJECT}/${encodeURIComponent(namespace)}/${kind}/${encodeURIComponent(name)}/data/keys`,
        {headers: {Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`}, cache: "no-cache"},
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = (await response.json()).items ?? [];
    return {count: items.length, size: items.reduce((n, item) => n + (item.size ?? 0), 0)};
}

/**
 * How many keys a cfg, sec or usr object holds and their size as stored, the
 * encoding included (what /data/keys says of each): `{count, size}`, `null` while
 * read, `undefined` for an object of another kind or one that could not be read.
 */
export function useKeyStats(path) {
    const {kind} = parseObjectPath(path);
    const keyed = KEYED_KINDS.includes(kind);
    const stamp = useEventStore((s) => (keyed ? stampOf(s.instanceConfig?.[path]) : ""));
    const key = `${path}#${stamp}`;
    const [stats, setStats] = useState(() => (keyed ? cache.get(key) ?? null : undefined));

    useEffect(() => {
        if (!keyed) {
            setStats(undefined);
            return undefined;
        }
        if (cache.has(key)) {
            setStats(cache.get(key));
            return undefined;
        }
        let cancelled = false;
        setStats(null);
        // One read for every row showing the object, the same configuration.
        let read = pending.get(key);
        if (!read) {
            read = readKeys(path).catch(() => undefined).then((value) => {
                cache.set(key, value);
                pending.delete(key);
                return value;
            });
            pending.set(key, read);
        }
        read.then((value) => {
            if (!cancelled) setStats(value);
        });
        return () => {
            cancelled = true;
        };
    }, [key, keyed, path]);

    return stats;
}
