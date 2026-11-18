import {URL_NODE} from "../config/apiPath.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";

/**
 * The drivers telling devices (`om <path> instance device ls`): the disks, the
 * filesystems and the volumes, by their group; of the containers, the virtual
 * machines alone.
 */
const DEVICE_GROUPS = ["disk", "fs", "volume"];
const DEVICE_CONTAINERS = ["container.kvm", "container.vbox"];

/** The roles of a device to a resource, in the order they are listed: what it makes, then what it stands on. */
export const DEVICE_ROLES = ["exposed", "sub", "base", "claimed"];

/** The group of a resource: by its type (`disk.vg`), else by its section (`disk#1`). */
const groupOf = (rid, type) => (type ? type.split(".")[0] : rid.split("#")[0]);

/** Whether a resource may tell devices, by its group. */
export const hasDevices = (rid, type) => DEVICE_GROUPS.includes(groupOf(rid, type)) || DEVICE_CONTAINERS.includes(type);

/** The address of an instance endpoint of the object on `node`. */
export function instanceUrl(path, node, suffix) {
    const {namespace, kind, name} = parseObjectPath(path);
    return `${URL_NODE}/${encodeURIComponent(node)}/instance/path/${[namespace, kind, name].map(encodeURIComponent).join("/")}/${suffix}`;
}

/** The address of the devices of the instance of the object on `node`, its resources all. */
export const devicesUrl = (path, node) => instanceUrl(path, node, "device");

/** The address of a file a resource of the instance on `node` lists in its status (root only). */
export const resourceFileUrl = (path, node, rid, name) =>
    instanceUrl(path, node, `resource/file?${new URLSearchParams({rid, name}).toString().replaceAll("+", "%20")}`);

/**
 * The devices of a resource, out of the answers of its nodes (`{node: items}`): a row
 * each, by node, then by role, then by device; its driver `group.name`.
 */
export function resourceDevices(byNode, rid) {
    const rank = (role) => {
        const i = DEVICE_ROLES.indexOf(role);
        return i < 0 ? DEVICE_ROLES.length : i;
    };
    return Object.entries(byNode)
        .flatMap(([node, items]) => (items ?? [])
            .map((item) => item?.data ?? item)
            .filter((d) => d?.rid === rid)
            .map((d) => ({
                node,
                role: d.role ?? "",
                device: d.device ?? "",
                driver: [d.driver?.group, d.driver?.name].filter(Boolean).join("."),
            })))
        .sort((a, b) => a.node.localeCompare(b.node) || rank(a.role) - rank(b.role) || a.device.localeCompare(b.device));
}

/** The files a resource lists in its status on its nodes: a row each, by node then by name. */
export function resourceFiles(instances, rid, nodes) {
    return nodes
        .flatMap((node) => (instances?.[node]?.resources?.[rid]?.files ?? []).map((f) => ({node, ...f})))
        .filter((f) => f.name)
        .sort((a, b) => a.node.localeCompare(b.node) || a.name.localeCompare(b.name));
}
