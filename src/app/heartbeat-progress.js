/*
 * What says an action on a heartbeat stream done, the daemon queuing it with
 * nothing to follow, read in the heartbeat status the events bring: started, the
 * stream runs; stopped, it stops; restarted, it runs again, created anew since it
 * was asked (its creation time read before, the clocks of the browser and the node
 * apart). Shared by the Links page and the daemon tab of a node.
 */

/** The stream `id` ("hb#1.rx") of `node`, as the events held report it. */
export const streamOf = (store, node, id) =>
    (store?.heartbeatStatus?.[node]?.streams ?? []).find((stream) => stream.id === id);

/** Whether the store shows the stream in the state `action` asks. */
export const streamReached = ({node, id, action, createdBefore}) => (store) => {
    const stream = streamOf(store, node, id);
    if (action === "stop") return stream?.state === "stopped";
    if (stream?.state !== "running") return false;
    return action === "start" || stream.created_at !== createdBefore;
};
