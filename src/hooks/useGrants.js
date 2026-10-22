import {useEffect, useState} from "react";
import {URL_AUTH_WHOAMI} from "../config/apiPath.js";

/**
 * The grants of the user, as /auth/whoami says them ({"root": null, "admin":
 * ["ns1"], …}): read once per token, shared by every view asking. Empty while
 * read, or when it could not be.
 */
let cache = {token: null, read: null};

/** Forgets what was read: for the tests. */
export const clearGrants = () => {
    cache = {token: null, read: null};
};

function readGrants(token) {
    if (cache.token !== token || cache.read === null) {
        cache = {
            token,
            read: fetch(URL_AUTH_WHOAMI, {headers: {Authorization: `Bearer ${token}`}, cache: "no-cache"})
                .then((response) => (response.ok ? response.json() : {}))
                .then((whoami) => whoami?.grant ?? {})
                .catch(() => ({})),
        };
    }
    return cache.read;
}

export function useGrants() {
    const token = localStorage.getItem("authToken") || "";
    const [grants, setGrants] = useState({});
    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        readGrants(token).then((read) => {
            if (!cancelled) setGrants(read);
        });
        return () => {
            cancelled = true;
        };
    }, [token]);
    return grants;
}

/** Whether the user is root, which the daemon actions on its threads ask for. */
export const useIsRoot = () => Object.prototype.hasOwnProperty.call(useGrants(), "root");
