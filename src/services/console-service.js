import {URL_NODE} from "../config/apiPath.js";
import {getResponseErrorMessage} from "./api.jsx";

// A console session is a websocket opened beside the api, with a ticket the
// api issues. Its binary messages are the bytes of the terminal, both ways.
// Its text messages are json control messages: the terminal size from the
// client, and how the session ended from the node.
export const CONSOLE_MSG_RESIZE = "resize";
export const CONSOLE_MSG_EXIT = "exit";
export const CONSOLE_REASON_ERROR = "error";

const WS_OPEN = 1;

/**
 * Ask the api for the ticket a console session of the resource is opened
 * with. The ticket opens one session, and expires in seconds.
 *
 * @param {{node: string, namespace: string, kind: string, name: string, rid?: string, graphics?: boolean, token: string}} target
 * @returns {Promise<{ticket: string, port: number, url?: string, expired_at?: string}>}
 */
export async function requestConsoleTicket({node, namespace, kind, name, rid, graphics, token}) {
    const enc = encodeURIComponent;
    let url = `${URL_NODE}/${enc(node)}/instance/path/${enc(namespace)}/${enc(kind)}/${enc(name)}/console`;
    const query = new URLSearchParams();
    if (rid) query.set("rid", rid);
    if (graphics) query.set("graphics", "true");
    if (query.size > 0) url += `?${query}`;
    const response = await fetch(url, {
        method: "POST",
        headers: {Authorization: `Bearer ${token}`},
    });
    if (!response.ok) {
        const detail = await getResponseErrorMessage(response);
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const ticket = await response.json();
    if (!ticket || !ticket.ticket) {
        throw new Error("no console ticket in the answer");
    }
    return ticket;
}

/**
 * The url to open the session of a ticket on: the one the cluster
 * configures, which is where a site access proxy publishes the console, or
 * the console port of the host the api is reached on.
 *
 * @param {{ticket: string, port: number, url?: string}} ticket
 * @param {{hostname: string}} [location]
 * @returns {string}
 */
export function consoleUrl(ticket, location = window.location) {
    const base = ticket.url || `wss://${location.hostname}:${ticket.port}/`;
    const u = new URL(base);
    if (u.protocol === "https:") {
        u.protocol = "wss:";
    }
    u.searchParams.set("ticket", ticket.ticket);
    return u.toString();
}

/**
 * The https url of a console endpoint, less its ticket. A browser that does
 * not trust the certificate of the console port refuses the websocket with
 * no way to say so, and opening this url is how the certificate is accepted.
 *
 * @param {string} url the websocket url of the console
 * @returns {string}
 */
export function consoleCertificateUrl(url) {
    const u = new URL(url);
    u.protocol = "https:";
    u.search = "";
    return u.toString();
}

/**
 * Open a console session.
 *
 * @param {string} url the websocket url of the console, with its ticket
 * @param {{
 *   onOpen?: () => void,
 *   onData?: (bytes: Uint8Array) => void,
 *   onEnd?: (end: {opened: boolean, exit: null | {code: number, reason: string, text: string}}) => void,
 * }} handlers
 * @param {typeof WebSocket} [WebSocketImpl]
 * @returns {{send: (data: string) => void, resize: (cols: number, rows: number) => void, close: () => void}}
 */
export function openConsoleSession(url, handlers = {}, WebSocketImpl = WebSocket) {
    const ws = new WebSocketImpl(url);
    ws.binaryType = "arraybuffer";
    const encoder = new TextEncoder();
    let opened = false;
    let exit = null;

    ws.onopen = () => {
        opened = true;
        handlers.onOpen?.();
    };
    ws.onmessage = (event) => {
        if (typeof event.data !== "string") {
            handlers.onData?.(new Uint8Array(event.data));
            return;
        }
        let message;
        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }
        if (message?.type === CONSOLE_MSG_EXIT) {
            exit = {
                code: message.code || 0,
                reason: message.reason || "",
                text: message.text || "",
            };
        }
    };
    // An error is followed by the close that says the session is over.
    ws.onerror = () => {
    };
    ws.onclose = () => {
        handlers.onEnd?.({opened, exit});
    };

    return {
        send(data) {
            if (ws.readyState === WS_OPEN) {
                ws.send(encoder.encode(data));
            }
        },
        resize(cols, rows) {
            if (ws.readyState === WS_OPEN) {
                ws.send(JSON.stringify({type: CONSOLE_MSG_RESIZE, cols, rows}));
            }
        },
        close() {
            ws.close();
        },
    };
}
