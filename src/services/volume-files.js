import {URL_NODE} from "../config/apiPath.js";
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
 * Sends a file to a volume, `onProgress` told the part sent (0 to 1), which a
 * fetch does not tell. Resolves once the node holds it whole.
 *
 * @returns {{done: Promise<void>, abort: () => void}}
 */
export function uploadFile(path, node, file, onProgress) {
    const xhr = new XMLHttpRequest();
    const done = new Promise((resolve, reject) => {
        xhr.open("PUT", filesUrl(path, node, file.name));
        for (const [key, value] of Object.entries(authHeaders())) xhr.setRequestHeader(key, value);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
                return;
            }
            let detail = "";
            try {
                detail = JSON.parse(xhr.responseText)?.detail ?? "";
            } catch {
                detail = xhr.responseText;
            }
            reject(new Error(detail || `HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("the connection was lost"));
        xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
        xhr.send(file);
    });
    return {done, abort: () => xhr.abort()};
}
