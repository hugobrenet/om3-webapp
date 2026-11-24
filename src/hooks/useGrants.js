import {useEffect, useState} from "react";
import {URL_AUTH_WHOAMI} from "../config/apiPath.js";

/**
 * The grants of the user, as /auth/whoami says them ({"root": null, "admin":
 * ["ns1"], …}): read once per token, shared by every view asking, a view opened
 * after given them at once (`value`). Empty while read, or when it could not be.
 */
let cache = {token: null, read: null, value: undefined};

/** The wait before the read of a view is tried again, doubled at each failure up to the last. */
export const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

/** Forgets what was read: for the tests. */
export const clearGrants = () => {
    cache = {token: null, read: null, value: undefined};
};

/**
 * The grants of the token, null when they could not be read: a failure is not
 * kept, the next to ask reads them again. Kept, a 502 at load left root with no
 * Add nor Edit until the page was reloaded.
 */
function readGrants(token) {
    if (cache.token !== token || cache.read === null) {
        const read = fetch(URL_AUTH_WHOAMI, {headers: {Authorization: `Bearer ${token}`}, cache: "no-cache"})
            .then((response) => {
                if (!response.ok) throw new Error(`whoami: ${response.status}`);
                return response.json();
            })
            .then((whoami) => {
                const grants = whoami?.grant ?? {};
                if (cache.read === read) cache.value = grants;
                return grants;
            })
            .catch(() => {
                if (cache.read === read) cache = {token: null, read: null, value: undefined};
                return null;
            });
        cache = {token, read, value: undefined};
    }
    return cache.read;
}

/** No grant: one object, the same from a render to the next. */
const NONE = Object.freeze({});

/** The grants read for `token`, undefined while they are not. */
const readFor = (token) => (cache.token === token ? cache.value : undefined);

/**
 * The grants of the user, and whether they are read: until they are, the grants
 * are empty, whatever the user may do. Without a token, nothing to read.
 */
function useGrantsState() {
    const token = localStorage.getItem("authToken") || "";
    const [state, setState] = useState(() => ({token, grants: readFor(token)}));
    // Another token: its own grants, none of the one before.
    const current = state.token === token ? state.grants : readFor(token);
    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        let timer;
        const read = (failures) => {
            readGrants(token).then((got) => {
                if (cancelled) return;
                if (got !== null) {
                    setState({token, grants: got});
                    return;
                }
                timer = setTimeout(() => read(failures + 1), RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)]);
            });
        };
        read(0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [token]);
    return {grants: current ?? NONE, read: !token || current !== undefined};
}

export function useGrants() {
    return useGrantsState().grants;
}

/**
 * Whether the user is root, which the daemon actions on its threads ask for:
 * undefined while the grants are read, for a view root alone may see to wait
 * rather than say it is root's.
 */
export const useIsRoot = () => {
    const {grants, read} = useGrantsState();
    return read ? Object.prototype.hasOwnProperty.call(grants, "root") : undefined;
};
