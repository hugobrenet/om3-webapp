import {createContext, useContext, useEffect, useState} from "react";
import {URL_POOL} from "../config/apiPath.js";
import {authHeaders} from "../services/api.jsx";

/** How often the sizes are read again: a resize changes one. */
const REFRESH_MS = 60000;

/**
 * The size each volume was made with, by its path, as the pools tell them
 * (`GET /api/pool/volume`): read while `enabled`, again every while; an empty map
 * while read, or when they could not be.
 */
export function useVolumeSizes(enabled) {
    const [sizes, setSizes] = useState(() => new Map());
    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        const read = () => fetch(`${URL_POOL}/volume`, {headers: authHeaders(), cache: "no-cache"})
            .then((response) => (response.ok ? response.json() : {items: []}))
            .then((data) => {
                if (live) setSizes(new Map((data?.items ?? []).filter((v) => v.path).map((v) => [v.path, v.size])));
            })
            .catch(() => {});
        void read();
        const timer = setInterval(read, REFRESH_MS);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, [enabled]);
    return sizes;
}

/** The sizes of the volumes, for the cells of a list showing them. */
export const VolumeSizesContext = createContext(new Map());
export const useVolumeSize = (path) => useContext(VolumeSizesContext).get(path);
