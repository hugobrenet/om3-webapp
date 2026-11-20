import {useEffect, useState} from "react";
import {URL_AUTH_WHOAMI} from "../config/apiPath.js";

/**
 * The grants of the user, as /auth/whoami says them ({"root": null, "admin":
 * ["ns1"], …}): read once per token, shared by every view asking. Empty while
 * read, or when it could not be.
 */
let cache = {token: null, read: null};

/** The wait before the read of a view is tried again, doubled at each failure up to the last. */
export const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

/** Forgets what was read: for the tests. */
export const clearGrants = () => {
    cache = {token: null, read: null};
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
            .then((whoami) => whoami?.grant ?? {})
            .catch(() => {
                if (cache.read === read) cache = {token: null, read: null};
                return null;
            });
        cache = {token, read};
    }
    return cache.read;
}

export function useGrants() {
    const token = localStorage.getItem("authToken") || "";
    const [grants, setGrants] = useState({});
    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        let timer;
        const read = (failures) => {
            readGrants(token).then((got) => {
                if (cancelled) return;
                if (got !== null) {
                    setGrants(got);
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
    return grants;
}

/** Whether the user is root, which the daemon actions on its threads ask for. */
export const useIsRoot = () => Object.prototype.hasOwnProperty.call(useGrants(), "root");
