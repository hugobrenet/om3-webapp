import {URL_NODE} from "../config/apiPath.js";
import {consoleCertificateUrl, consoleUrl} from "./console-service.js";
import {authHeaders, getResponseErrorMessage} from "./api.jsx";
import {parseObjectPath} from "../utils/objectUtils.jsx";

/** The address of the files of a volume on a node, of the file `name` if given. */
export function filesUrl(path, node, name) {
    const {namespace, kind, name: object} = parseObjectPath(path);
    const parts = [namespace, kind, object].map(encodeURIComponent).join("/");
    const url = `${URL_NODE}/${encodeURIComponent(node)}/instance/path/${parts}/file`;
    return name === undefined ? url : `${url}?name=${encodeURIComponent(name)}`;
}

/** The files at the top of a volume, as the node holding it says. */
export async function listFiles(path, node) {
    const response = await fetch(filesUrl(path, node), {headers: authHeaders(), cache: "no-cache"});
    if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
    return (await response.json())?.items ?? [];
}

export async function deleteFile(path, node, name) {
    const response = await fetch(filesUrl(path, node, name), {method: "DELETE", headers: authHeaders()});
    if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
}

/**
 * The ticket a file is sent with. The transfer is not the api's: it goes to the
 * console endpoint, served by a process of its own, for the daemon not to carry it.
 */
export async function requestUploadTicket(path, node, name) {
    const response = await fetch(filesUrl(path, node, name), {method: "POST", headers: authHeaders()});
    if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
    return response.json();
}

/** The https address a ticket sends a file to. */
export function uploadUrl(ticket, location = window.location) {
    const u = new URL(consoleUrl(ticket, location));
    u.protocol = "https:";
    return u.toString();
}

/**
 * Sends a file to a volume, `onProgress` told the part sent (0 to 1), which a
 * fetch does not tell. Resolves once the node holds it whole. A connection
 * refused rejects with `certificateUrl`, the page accepting the certificate of
 * the console port: a browser does not say why it refused one it does not trust.
 *
 * @returns {{done: Promise<void>, abort: () => void}}
 */
export function uploadFile(path, node, file, onProgress) {
    const xhr = new XMLHttpRequest();
    let aborted = false;
    const send = (url) => new Promise((resolve, reject) => {
        xhr.open("PUT", url);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(xhr.responseText.trim() || `HTTP ${xhr.status}`));
        };
        xhr.onerror = () => {
            const error = new Error("the console port could not be reached");
            error.certificateUrl = consoleCertificateUrl(url);
            reject(error);
        };
        xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
        xhr.send(file);
    });
    const done = requestUploadTicket(path, node, file.name).then((ticket) => {
        if (aborted) throw new DOMException("aborted", "AbortError");
        return send(uploadUrl(ticket));
    });
    return {
        done,
        abort: () => {
            aborted = true;
            xhr.abort();
        },
    };
}
