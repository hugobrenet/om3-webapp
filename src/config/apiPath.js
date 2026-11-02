export const URL_AUTH_INFO = '/api/auth/info';
export const URL_AUTH_WHOAMI = '/api/auth/whoami';
export const URL_NODE_EVENT = "/api/node/name/localhost/daemon/event";
export const URL_TOKEN = '/api/auth/token';
export const URL_REFRESH = '/api/auth/refresh';
export const URL_CLUSTER = '/api/cluster';
export const URL_CLUSTER_STATUS = '/api/cluster/status';
// The cluster status without its objects: the cluster, its nodes and the daemon
// answering, which every reader of the status reads. Its size grows with the
// nodes, where the whole status grows with the objects on each node.
export const URL_CLUSTER_STATUS_NODES = `${URL_CLUSTER_STATUS}?selector=cluster`;
export const URL_POOL = '/api/pool';
export const URL_RESOURCE = '/api/resource';
// The resources of every service and volume, the objects holding some. Not unfiltered nor
// "**": a selection reaching a cfg, sec, usr, nscfg or ccfg breaks the read on daemons
// up to v3.0.0-rc46 at least (no instance configuration to range over); "*" names the
// services alone.
export const URL_RESOURCES = `${URL_RESOURCE}?path=${encodeURIComponent('*/svc/*,*/vol/*')}`;
export const URL_NODE_INFO = '/api/node/info';
export const URL_OBJECT = '/api/object/path';
export const URL_NODE = '/api/node/name';
// The nodes of the cluster, a list.
export const URL_NODES = '/api/node';
export const URL_NETWORK = "/api/network";
export const URL_NETWORK_IP = "/api/network/ip";
export const URL_STORE = "/api/store";
export const URL_STORE_SNAPSHOT = "/api/store/snapshot";
export const URL_STORE_OBJECT = "/api/store/object";
// Not under /api: the per cgroup metrics, served unauthenticated by the node listener.
export const URL_METRICS_PG = "/metrics/pg";
