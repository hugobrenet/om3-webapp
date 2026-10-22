/**
 * The journal of the heartbeats, as the node logs API filters it: the journal fields
 * the daemon logs them with, a selection of the page narrowing them. Fields of the
 * same name are ORed, of different names ANDed, as journalctl does.
 */

/** The packages logging for the heartbeats: their main, their drivers, their control. */
export const HEARTBEAT_PACKAGES = [
  "daemon/hb",
  "daemon/hb/hbucast",
  "daemon/hb/hbmcast",
  "daemon/hb/hbdisk",
  "daemon/hb/hbrelay",
  "daemon/hbctrl",
];

/** The package of the peer watchers, logging each change of a peer beating or not. */
export const PEER_WATCH_PACKAGE = "daemon/hbctrl:peerWatch";

interface Stream {
  id?: string;
  type?: string;
  peers?: Record<string, unknown>;
}

export type HeartbeatStatus = Record<string, { streams?: Stream[] } | undefined>;

/**
 * What the page selected: a heartbeat ("hb#1"), and where, a node, a side of it (its
 * tx streams), or a link of the mesh, the one or the other.
 */
export interface HeartbeatSelection {
  hb?: string | null;
  side?: { node: string; dir?: "tx" | "rx" | null } | null;
  link?: { from: string; to: string } | null;
}

/** A stream watching a peer, on a node, in the selection: the heartbeat, the side, the link. */
function watched(node: string, stream: Stream, peer: string, selection: HeartbeatSelection): boolean {
  const id = stream.id ?? "";
  if (selection.hb && id.replace(/\.(rx|tx)$/, "") !== selection.hb) return false;
  const side = selection.side;
  if (side && (node !== side.node || (side.dir && !id.endsWith(`.${side.dir}`)))) return false;
  const link = selection.link;
  if (link) {
    // The beats of from to to: sent by the tx of from, received by the rx of to.
    const sends = node === link.from && id.endsWith(".tx") && peer === link.to;
    const receives = node === link.to && id.endsWith(".rx") && peer === link.from;
    if (!sends && !receives) return false;
  }
  return true;
}

/**
 * The nodes whose journals to read, and the fields to match, for the logs of the
 * heartbeats in a selection: all the nodes, the one of a node or a side of it, the two
 * of a link. The logs of a side are those of its streams, as the drivers log them. `changes`, the
 * changes of the peers beating only, as the peer watchers log them, the watchers of
 * the streams selected named (`HB_PEER_WATCH=hb#1.rx-n2`).
 */
export function heartbeatLogs(
  status: HeartbeatStatus,
  selection: HeartbeatSelection,
  changes: boolean,
): { nodes: string[]; filters: string[] } {
  const { link, side } = selection;
  const nodes = link ? [...new Set([link.from, link.to])] : side ? [side.node] : Object.keys(status).sort();
  if (changes) {
    const filters = [`PKG=${PEER_WATCH_PACKAGE}`];
    if (selection.hb || side || link) {
      const watchers = new Set<string>();
      for (const [node, data] of Object.entries(status)) {
        for (const stream of data?.streams ?? []) {
          for (const peer of Object.keys(stream.peers ?? {})) {
            if (watched(node, stream, peer, selection)) watchers.add(`${stream.id}-${peer}`);
          }
        }
      }
      filters.push(...[...watchers].sort().map((watcher) => `HB_PEER_WATCH=${watcher}`));
    }
    return { nodes, filters };
  }
  const filters = HEARTBEAT_PACKAGES.map((pkg) => `PKG=${pkg}`);
  if (selection.hb) filters.push(`HB_NAME=${selection.hb}`);
  if (side?.dir) filters.push(`HB_FUNC=${side.dir}`);
  return { nodes, filters };
}
