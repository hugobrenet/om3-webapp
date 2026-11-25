import {useCallback, useEffect, useRef, useState} from "react";
import {URL_NODE} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {trackRefused, trackResponse, trackWrite} from "../app/action-tracker";
import {refusalReason} from "./objectActions";
import {setOp} from "../app/keyop";

/**
 * The keyword of the node configuration a property of the organisation comes from,
 * as `om node push asset` reads it: node.<name>, but for the environment and the
 * listener port.
 */
export function propertyKeyword(name) {
    if (name === "node_env") return "node.env";
    if (name === "listener_port") return "listener.port";
    return `node.${name}`;
}

const authHeaders = () => ({Authorization: `Bearer ${localStorage.getItem("authToken") ?? ""}`});

/** How long, and how often, the properties are read again after a change, for the asset pushed to say it. */
const REFRESH_EVERY_MS = 2000;
const REFRESH_TIMES = 10;

/**
 * The edition of the properties of the organisation of `node`, in a buffer: the
 * changes kept until applied all at once, in one write of the node configuration,
 * so that each change does not make a version of its own to spread. A value
 * emptied unsets its keyword, the property then back to its default. Applied, the
 * asset is pushed again for the properties to say the new values, read again by
 * `reload` until then. The values written not read, no form: `readError` why, and
 * `retry` reads them again.
 */
export function useOrgEdit(node, {reload, t}) {
    const [editing, setEditing] = useState(false);
    // The values as written in the configuration, by keyword: empty when not set.
    const [written, setWritten] = useState({});
    const [buffer, setBuffer] = useState({});
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState(null);
    const [readError, setReadError] = useState(null);
    // The properties of the last edit asked: read again by retry.
    const asked = useRef([]);

    const start = useCallback(async (properties) => {
        asked.current = properties;
        setError(null);
        setReadError(null);
        setBuffer({});
        const keywords = properties.map((p) => propertyKeyword(p.name));
        const query = new URLSearchParams(keywords.map((kw) => ["kw", kw]));
        try {
            const response = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/config?${query}`, {headers: authHeaders()});
            if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
            const {items = []} = await response.json();
            setWritten(Object.fromEntries(keywords.map((kw) => [kw, items.find((i) => i.keyword === kw)?.value ?? ""])));
        } catch (err) {
            // Not read: no form, its fields would stand for values not set, a change against nothing.
            setReadError(err.message || String(err));
            return;
        }
        setEditing(true);
    }, [node]);
    const retry = useCallback(() => start(asked.current), [start]);
    // Another node: why the one before's values were not read, not said of it.
    useEffect(() => {
        setReadError(null);
    }, [node]);

    /** The value of a keyword in the form: the one changed, else the one written. */
    const valueOf = (kw) => (kw in buffer ? buffer[kw] : written[kw] ?? "");
    const change = (kw, value) => setBuffer((b) => {
        const next = {...b};
        if (value === (written[kw] ?? "")) delete next[kw];
        else next[kw] = value;
        return next;
    });
    const revert = (kw) => setBuffer((b) => {
        const next = {...b};
        delete next[kw];
        return next;
    });
    const discard = () => {
        setBuffer({});
        setError(null);
        setEditing(false);
    };

    const apply = async () => {
        const entries = Object.entries(buffer);
        if (entries.length === 0 || applying) return;
        const query = entries
            .map(([kw, value]) => (value.trim() === "" ? `unset=${encodeURIComponent(kw)}` : `set=${encodeURIComponent(setOp(kw, value.trim()))}`))
            .join("&");
        const write = {action: "config", label: t("nodePanel.orgEdit.tray", {count: entries.length}), subject: node};
        setApplying(true);
        setError(null);
        try {
            const response = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/config?${query}`, {method: "PATCH", headers: authHeaders()});
            const ok = await trackWrite(response, write, async (r) => {
                const detail = await getResponseErrorMessage(r);
                setError(detail || `HTTP ${r.status}`);
                return refusalReason({status: r.status, detail});
            });
            if (!ok) return;
            setBuffer({});
            setEditing(false);
            // The properties are those the asset last pushed: pushed again, read again until they say it.
            const pushed = await fetch(`${URL_NODE}/${encodeURIComponent(node)}/action/push/asset`, {method: "POST", headers: authHeaders()});
            await trackResponse(pushed, {action: "asset", subject: node});
            for (let i = 1; i <= REFRESH_TIMES; i += 1) {
                setTimeout(reload, i * REFRESH_EVERY_MS);
            }
        } catch (err) {
            trackRefused({...write, reason: err.message});
            setError(err.message);
        } finally {
            setApplying(false);
        }
    };

    return {
        editing, applying, error, readError, start, retry, discard, apply, change, revert, valueOf,
        changed: (kw) => kw in buffer,
        count: Object.keys(buffer).length,
    };
}
