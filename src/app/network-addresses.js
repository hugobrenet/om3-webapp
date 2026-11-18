/**
 * The addresses a resource reports in its status, as the daemon reads them for its
 * networks (`Status.IPAddrs`, core/resource/ipaddrs.go): all of them under
 * `info.ipaddrs`, else the one of `info.ipaddr`. None while it is down.
 */
export function resourceAddresses(resource) {
    const info = resource?.info;
    if (Array.isArray(info?.ipaddrs)) return info.ipaddrs.filter((a) => typeof a === "string" && a !== "");
    return typeof info?.ipaddr === "string" && info.ipaddr !== "" ? [info.ipaddr] : [];
}

/**
 * The addresses the instances report, one string: `path@node rid=addr,…` a resource
 * holding some, sorted. It changes with an address handed out or given back, not
 * with the rest of a status.
 */
export function addressesSignature(instanceStatus) {
    const lines = [];
    for (const [path, byNode] of Object.entries(instanceStatus ?? {})) {
        for (const [node, status] of Object.entries(byNode ?? {})) {
            for (const [rid, resource] of Object.entries(status?.resources ?? {})) {
                const addresses = resourceAddresses(resource);
                if (addresses.length > 0) lines.push(`${path}@${node} ${rid}=${addresses.join(",")}`);
            }
        }
    }
    return lines.sort().join("\n");
}
