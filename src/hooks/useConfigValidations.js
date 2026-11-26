import {useEffect, useMemo, useRef, useState} from "react";
import {URL_NODE} from "../config/apiPath.js";
import {authHeaders} from "../services/api.jsx";
import {parseObjectPath} from "../utils/objectUtils.jsx";

/*
 * The configurations of the objects of a list validated, as `om <path> config
 * validate` does it on a node of the object (GET `.../instance/path/.../config/validate`
 * of that node): one request an object, a few at a time, its result kept while its
 * configuration is the same, validated again once it changed (its checksum, as the
 * node says it).
 */

/** How many validations asked at once. */
const PARALLEL = 4;

/** What a validation found: an error, else a warning, else valid; undefined, none known. */
export const validationLevel = (alerts) => {
    if (!Array.isArray(alerts)) return undefined;
    if (alerts.some((a) => a.level === "error")) return "error";
    if (alerts.some((a) => a.level === "warning")) return "warning";
    return "valid";
};

/** The node an object is validated on: the first by name of those it has an instance or a configuration on. */
const nodeOf = (instances, configs) => [...new Set([...Object.keys(instances ?? {}), ...Object.keys(configs ?? {})])].sort()[0];

/**
 * The validation of the configuration of each object of `names`, by its name, as
 * validationLevel says it, read while `enabled`: one validated not yet, or that could
 * not be, has none. `instances` and `configs`, the instance statuses and the
 * configurations of the objects by name and node, as the event store holds them.
 */
export function useConfigValidations(names, {instances, configs, enabled = true}) {
    const [levels, setLevels] = useState(() => new Map());
    // The result of each object and the configuration it was of: `node@csum`.
    const done = useRef(new Map());
    const asked = useRef(new Set());
    // An answer come after the list left kept anyway, but not one come after the page left.
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // What to validate: each object its node, and the stamp of its configuration there.
    const wanted = useMemo(() => {
        if (!enabled) return [];
        return names.map((name) => {
            const node = nodeOf(instances?.[name], configs?.[name]);
            return node && {name, node, stamp: `${node}@${configs?.[name]?.[node]?.csum ?? ""}`};
        }).filter(Boolean);
    }, [names, instances, configs, enabled]);

    useEffect(() => {
        let live = true;
        const queue = wanted.filter(({name, stamp}) => done.current.get(name) !== stamp && !asked.current.has(`${name}#${stamp}`));
        const validate = async ({name, node, stamp}) => {
            const key = `${name}#${stamp}`;
            asked.current.add(key);
            const {namespace, kind, name: short} = parseObjectPath(name);
            let level;
            try {
                const response = await fetch(
                    `${URL_NODE}/${encodeURIComponent(node)}/instance/path/${namespace}/${kind}/${short}/config/validate`,
                    {headers: authHeaders(), cache: "no-cache"},
                );
                if (response.ok) level = validationLevel((await response.json())?.items);
            } catch {
                // Not known: no validation for it.
            }
            asked.current.delete(key);
            if (!mounted.current) return;
            done.current.set(name, stamp);
            setLevels((prev) => {
                if (prev.get(name) === level) return prev;
                const next = new Map(prev);
                if (level === undefined) next.delete(name); else next.set(name, level);
                return next;
            });
        };
        const run = async () => {
            while (live && queue.length > 0) await validate(queue.shift());
        };
        for (let i = 0; i < PARALLEL; i++) void run();
        // Those not asked yet, left to the next run; those asked, answered still.
        return () => {
            live = false;
        };
    }, [wanted]);

    return levels;
}
