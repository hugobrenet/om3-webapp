import {URL_NODE} from "../config/apiPath.js";
import {consoleCertificateUrl, consoleUrl} from "./console-service.js";
import {authHeaders, getResponseErrorMessage} from "./api.jsx";
import {parseObjectPath} from "../utils/objectUtils.jsx";

/**
 * The address of the files of a volume on a node: of the directory `dir` of it, its
 * top by default; of the file `name` there if given, replacing one of that name with
 * `replace`; `sub` an address under it (`directory`).
 */
export function filesUrl(path, node, name, {replace = false, dir = "", sub = ""} = {}) {
    const {namespace, kind, name: object} = parseObjectPath(path);
    const parts = [namespace, kind, object].map(encodeURIComponent).join("/");
    const url = `${URL_NODE}/${encodeURIComponent(node)}/instance/path/${parts}/file${sub ? `/${sub}` : ""}`;
    const query = new URLSearchParams();
    if (dir) query.set("dir", dir);
    if (name !== undefined) query.set("name", name);
    if (replace) query.set("replace", "true");
    const q = query.toString().replaceAll("+", "%20");
    return q ? `${url}?${q}` : url;
}

/**
 * An error the answer of a refusal says, its status kept, and whether it is a file of
 * that name there already: a 409 of the title "File exists", a 409 saying too that the
 * volume is not available.
 */
async function refusal(response) {
    const problem = await response.clone().json().catch(() => null);
    return Object.assign(new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`), {
        status: response.status,
        exists: response.status === 409 && problem?.title === "File exists",
        installed: response.status === 409 && problem?.title === "Installed file",
    });
}

/** A file of that name there already, which an upload replaces only when told to. */
export const isFileExists = (error) => error?.exists === true;

/**
 * What a directory of a volume holds, its top by default, as the node holding it says:
 * its entries, a `type` each (`file`, `dir`, `link`; a node telling none, files), and
 * whether there are more than it lists.
 */
export async function listFiles(path, node, dir = "") {
    const response = await fetch(filesUrl(path, node, undefined, {dir}), {headers: authHeaders(), cache: "no-cache"});
    if (!response.ok) throw await refusal(response);
    const list = await response.json();
    return {items: (list?.items ?? []).map((item) => ({type: "file", ...item})), truncated: list?.truncated === true};
}

/** Removes a file, a link (not what it points to), or an empty directory. */
export async function deleteFile(path, node, name, dir = "") {
    const response = await fetch(filesUrl(path, node, name, {dir}), {method: "DELETE", headers: authHeaders()});
    if (!response.ok) throw await refusal(response);
}

/** Creates a directory in a directory of a volume, its parents there already. */
export async function makeDirectory(path, node, name, dir = "") {
    const response = await fetch(filesUrl(path, node, name, {dir, sub: "directory"}), {method: "POST", headers: authHeaders()});
    if (!response.ok) throw await refusal(response);
}

/**
 * The ticket a file is sent with. The transfer is not the api's: it goes to the
 * console endpoint, served by a process of its own, for the daemon not to carry it.
 */
export async function requestUploadTicket(path, node, name, {replace = false, dir = ""} = {}) {
    const response = await fetch(filesUrl(path, node, name, {replace, dir}), {method: "POST", headers: authHeaders()});
    if (!response.ok) throw await refusal(response);
    return response.json();
}

/** The ticket a file of a volume is read with, on the console port as an upload is. */
export async function requestDownloadTicket(path, node, name, dir = "") {
    const response = await fetch(filesUrl(path, node, name, {dir, sub: "download"}), {method: "POST", headers: authHeaders()});
    if (!response.ok) throw await refusal(response);
    return response.json();
}

/** A fetch the browser refused, a certificate of the console port it does not trust, said with where to accept it. */
function unreachable(url) {
    const error = new Error("the console port could not be reached");
    error.certificateUrl = consoleCertificateUrl(url);
    return error;
}

/**
 * The first `limit` bytes of a file of a volume, and its whole size: what its dialog
 * shows. A range asked; a node answering the whole file, read up to the limit alone.
 *
 * @returns {Promise<{blob: Blob, total: number, partial: boolean}>}
 */
export async function readFileHead(path, node, name, dir = "", limit = 1024 * 1024) {
    const url = uploadUrl(await requestDownloadTicket(path, node, name, dir));
    let response;
    try {
        response = await fetch(url, {headers: {Range: `bytes=0-${limit - 1}`}});
    } catch {
        throw unreachable(url);
    }
    if (!response.ok) throw Object.assign(new Error((await response.text()).trim() || `HTTP ${response.status}`), {status: response.status});
    const range = /\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
    const total = range ? Number(range[1]) : Number(response.headers.get("Content-Length") ?? 0);
    const reader = response.body.getReader();
    const chunks = [];
    let read = 0;
    while (read < limit) {
        const {value, done} = await reader.read();
        if (done) break;
        chunks.push(value);
        read += value.length;
    }
    await reader.cancel().catch(() => {});
    const blob = new Blob(chunks).slice(0, limit);
    return {blob, total, partial: total > blob.size};
}

/** Saves a file of a volume, its own ticket asked: the node answers it as an attachment, the page staying. */
export async function downloadFile(path, node, name, dir = "") {
    const a = document.createElement("a");
    a.href = uploadUrl(await requestDownloadTicket(path, node, name, dir));
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
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
 * A file of that name there already, it rejects with a 409 (`isFileExists`), before
 * anything is sent or at the end, unless `replace`. Into the directory `dir`, the top
 * by default.
 *
 * @returns {{done: Promise<void>, abort: () => void}}
 */
export function uploadFile(path, node, file, onProgress, {replace = false, dir = ""} = {}) {
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
            else {
                // The console port says a file there already as "file exists: …", a volume
                // not available with a 409 too.
                const text = xhr.responseText.trim();
                reject(Object.assign(new Error(text || `HTTP ${xhr.status}`), {
                    status: xhr.status,
                    exists: xhr.status === 409 && /^file exists/i.test(text),
                    installed: xhr.status === 409 && /^installed file/i.test(text),
                }));
            }
        };
        xhr.onerror = () => {
            const error = new Error("the console port could not be reached");
            error.certificateUrl = consoleCertificateUrl(url);
            reject(error);
        };
        xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
        xhr.send(file);
    });
    const done = requestUploadTicket(path, node, file.name, {replace, dir}).then((ticket) => {
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
