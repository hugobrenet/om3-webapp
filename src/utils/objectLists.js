/*
 * The tabs of the Objects page, an entry each in the menu too. The first one, All,
 * lists them all; then the objects split by what they are: the services running on
 * the nodes, the volumes, the configurations (with the cluster object), the
 * secrets, the users. The tab is in the URL, `list=…` ("any" for All); the
 * services tab, the one shown by default, without it. The namespaces are a view
 * of the cluster of their own (/namespaces), no longer a tab.
 */

export const OBJECT_LISTS = ["services", "volumes", "configs", "secrets", "users"];

/** The tab listing the objects of all the others. */
export const ALL_LIST = "any";

export const OBJECTS_TABS = [ALL_LIST, ...OBJECT_LISTS];

/** The address of the Objects page on a list: the services one without `list`. */
export const listUrl = (list) => (list === OBJECT_LISTS[0] ? "/objects" : `/objects?list=${list}`);

const LIST_OF_KIND = {vol: "volumes", cfg: "configs", ccfg: "configs", sec: "secrets", usr: "users"};

/** The tab an object of `kind` is listed in, besides All. */
export const listOfKind = (kind) => LIST_OF_KIND[kind] ?? "services";
