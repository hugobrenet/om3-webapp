import {parseObjectPath} from "../utils/objectUtils.jsx";

/** A resource is a container by its type (`container.docker`…), else by its section. */
export const isContainerResource = (rid, type) => (type ? type.startsWith("container") : rid.startsWith("container#"));

/** The sessions a resource opens, a tab each of its panel: a console, the screen of a guest. */
export const sessionKinds = (rid, type) => (!isContainerResource(rid, type)
    ? []
    : type === "container.kvm" ? ["console", "display"] : ["console"]);

/** Whether the grants of the user open a session on an object, as the api asks: root, or admin of its namespace or of all. */
export function mayOpenSession(grants, path) {
    if (Object.prototype.hasOwnProperty.call(grants, "root")) return true;
    if (!Object.prototype.hasOwnProperty.call(grants, "admin")) return false;
    const {admin} = grants;
    return !Array.isArray(admin) || admin.includes("") || admin.includes(parseObjectPath(path).namespace);
}

/** A resource running in that status: up, on a standby node too. */
export const isRunning = (status) => status === "up" || status === "stdby up";

/** The page of a session in a browser tab of its own: the node is part of it, the tab standing alone. */
export const sessionPage = (kind, {path, rid, node}) => `/session/${kind}?${new URLSearchParams({path, rid, node})}`;

/** Where the click opening a session in a tab leaves word for it, and how long the word lasts. */
const OPENING = "sessionOpening";
const OPENING_MS = 15000;

/** Asks the tab about to open on `search` to connect at once. */
export function markOpening(search) {
    try {
        localStorage.setItem(OPENING, JSON.stringify({search, at: Date.now()}));
    } catch {
        // No word left: the tab asks for Connect.
    }
}

/**
 * Whether a click asked this tab to connect, the word used up. A link carries no such
 * word: a reload, a tab restored or a URL passed on opens no shell by itself.
 */
export function takeOpening(search) {
    try {
        const word = JSON.parse(localStorage.getItem(OPENING) ?? "null");
        if (word?.search !== search) return false;
        localStorage.removeItem(OPENING);
        return Date.now() - word.at < OPENING_MS;
    } catch {
        return false;
    }
}
