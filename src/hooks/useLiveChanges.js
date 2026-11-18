import {useEffect, useRef, useState} from "react";
import {useMenuState, kindOf} from "./useSidebarAlerts";
import useEventStore from "./useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {pageSeen} from "./usePagePoll";

/*
 * What a view read once is read again as it changes, the user doing nothing: each
 * hook here a count of the changes of something, 0 at first, one more on each
 * change after. A view reads again when the count goes up (an effect on it), what
 * it read kept shown meanwhile, a failure to read again keeping it too.
 *
 * The signals are those the page has already: the stream of the menu (the
 * configuration of the cluster, of each node), its polls (the pools), the stream of
 * the views (the configuration and the status of the instances); what no event
 * says (the runs of a schedule, a sync to a store), a poll, stopped while the page
 * is hidden.
 */

/** A count of the changes of `value` after the first one seen, compared by `same`. */
export function useChangeCount(value, same = Object.is) {
    const [count, setCount] = useState(0);
    const seen = useRef(value);
    useEffect(() => {
        if (same(seen.current, value)) return;
        seen.current = value;
        setCount((n) => n + 1);
        // `same` is a comparison, not a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    return count;
}

/** The sum of counts: a view read again on any of them. */
export const anyOf = (...counts) => counts.reduce((sum, n) => sum + n, 0);

/**
 * The changes of the cluster configuration (cluster.conf), an edit of any section by
 * om, by another user or by the daemon (a subnet@<node> it chose): each one a
 * ClusterConfigUpdated on the stream of the menu, whatever section changed.
 */
export const useClusterConfigChanges = () => useChangeCount(useMenuState((s) => s.clusterConfig));

const signature = (value) => (value === undefined ? "" : JSON.stringify(value));

/**
 * The changes of the configuration of `node` (all the nodes when none is given), as
 * NodeConfigUpdated says it: node.conf, or the cluster configuration for it. Compared
 * by value: the stream opening again replays the same.
 */
export function useNodeConfigChanges(node) {
    const value = useMenuState((s) => signature(node ? s.nodeConfig?.[node] : s.nodeConfig));
    return useChangeCount(value);
}

/** The paths of the vols, joined: one created or deleted changes it. */
const volPaths = (objects) => Object.keys(objects ?? {}).filter((path) => kindOf(path) === "vol").sort().join(",");

/**
 * The changes of the pools: their usage, as the menu polls it (every
 * SIDEBAR_USAGE_REFRESH_MS), compared by value; a vol created or deleted, its volumes
 * changing, as the stream of the menu says it.
 */
export function usePoolChanges() {
    const pools = useChangeCount(useMenuState((s) => signature(s.pools)));
    const vols = useChangeCount(useMenuState((s) => volPaths(s.objects)));
    return anyOf(pools, vols);
}

/**
 * A count going up every `everyMs`, for what no event says: none while the page is
 * hidden; seen again after a wait longer than that, one at once.
 */
export function usePollTicks(everyMs) {
    const [ticks, setTicks] = useState(0);
    useEffect(() => {
        let last = Date.now();
        const tick = () => {
            if (!pageSeen()) return;
            last = Date.now();
            setTicks((n) => n + 1);
        };
        const timer = setInterval(tick, everyMs);
        const onVisibility = () => {
            if (pageSeen() && Date.now() - last >= everyMs) tick();
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [everyMs]);
    return ticks;
}

/** The events of an object claimed from the stream of the views while `path` is shown. */
function useObjectEvents(path, events) {
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token && path ? retainEventReception(token, events, path) : null;
        return () => release?.();
        // The events are a constant of each caller.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path]);
}

const INSTANCE_CONFIG_EVENTS = ["InstanceConfigUpdated"];
const INSTANCE_STATUS_EVENTS = ["InstanceStatusUpdated"];

/**
 * The changes of the configuration of the object `path` on any node
 * (InstanceConfigUpdated): its file written by om, by another user, by a node.
 */
export function useInstanceConfigChanges(path) {
    useObjectEvents(path, INSTANCE_CONFIG_EVENTS);
    return useChangeCount(useEventStore((s) => (path ? s.instanceConfig?.[path] : undefined)));
}

/**
 * The changes of the status of the instances of `path` (InstanceStatusUpdated), of its
 * resource `rid` only when given, compared by value: a status the daemon sends again
 * unchanged reads nothing.
 */
export function useInstanceStatusChanges(path, rid) {
    useObjectEvents(path, INSTANCE_STATUS_EVENTS);
    const value = useEventStore((s) => {
        const byNode = path ? s.objectInstanceStatus?.[path] : undefined;
        if (!byNode) return "";
        if (!rid) return signature(byNode);
        return signature(Object.fromEntries(Object.entries(byNode).map(([node, status]) => [node, status?.resources?.[rid]])));
    });
    return useChangeCount(value);
}
