import { describe, expect, test } from "vitest";
import { HEARTBEAT_PACKAGES, heartbeatLogs, type HeartbeatStatus } from "../heartbeat-logs";

/** Two nodes, a unicast hb#1 and a disk hb#2, each sending to and receiving from the other. */
const STATUS: HeartbeatStatus = {
  n2: {
    streams: [
      { id: "hb#1.rx", type: "unicast", peers: { n1: {} } },
      { id: "hb#1.tx", type: "unicast", peers: { n1: {} } },
      { id: "hb#2.rx", type: "disk", peers: { n1: {} } },
    ],
  },
  n1: {
    streams: [
      { id: "hb#1.rx", type: "unicast", peers: { n2: {} } },
      { id: "hb#1.tx", type: "unicast", peers: { n2: {} } },
      { id: "hb#2.tx", type: "disk", peers: { n2: {} } },
    ],
  },
};

const PACKAGES = HEARTBEAT_PACKAGES.map((pkg) => `PKG=${pkg}`);

describe("heartbeat logs", () => {
  test("nothing selected: the packages of the heartbeats, on all the nodes", () => {
    expect(heartbeatLogs(STATUS, {}, false)).toEqual({ nodes: ["n1", "n2"], filters: PACKAGES });
  });

  test("a heartbeat: its name besides the packages", () => {
    expect(heartbeatLogs(STATUS, { hb: "hb#2" }, false).filters).toEqual([...PACKAGES, "HB_NAME=hb#2"]);
  });

  test("a side of a node: the journal of the node, its streams of that side", () => {
    expect(heartbeatLogs(STATUS, { side: { node: "n2", dir: "rx" } }, false)).toEqual({ nodes: ["n2"], filters: [...PACKAGES, "HB_FUNC=rx"] });
    // With a heartbeat: both.
    expect(heartbeatLogs(STATUS, { hb: "hb#1", side: { node: "n1", dir: "tx" } }, false)).toEqual({
      nodes: ["n1"],
      filters: [...PACKAGES, "HB_NAME=hb#1", "HB_FUNC=tx"],
    });
  });

  test("a node: its journal, both its sides", () => {
    expect(heartbeatLogs(STATUS, { side: { node: "n1" } }, false)).toEqual({ nodes: ["n1"], filters: PACKAGES });
    expect(heartbeatLogs(STATUS, { side: { node: "n1" } }, true).filters).toEqual([
      "PKG=daemon/hbctrl:peerWatch",
      "HB_PEER_WATCH=hb#1.rx-n2",
      "HB_PEER_WATCH=hb#1.tx-n2",
      "HB_PEER_WATCH=hb#2.tx-n2",
    ]);
  });

  test("a link: the journals of its two nodes only", () => {
    expect(heartbeatLogs(STATUS, { link: { from: "n2", to: "n1" } }, false)).toEqual({ nodes: ["n2", "n1"], filters: PACKAGES });
  });

  test("the changes only: the peer watchers, all of them when nothing is selected", () => {
    expect(heartbeatLogs(STATUS, {}, true)).toEqual({ nodes: ["n1", "n2"], filters: ["PKG=daemon/hbctrl:peerWatch"] });
  });

  test("the changes of a selection: the watchers of its streams named", () => {
    expect(heartbeatLogs(STATUS, { hb: "hb#2" }, true).filters).toEqual([
      "PKG=daemon/hbctrl:peerWatch",
      "HB_PEER_WATCH=hb#2.rx-n1",
      "HB_PEER_WATCH=hb#2.tx-n2",
    ]);
    expect(heartbeatLogs(STATUS, { side: { node: "n2", dir: "rx" } }, true)).toEqual({
      nodes: ["n2"],
      filters: ["PKG=daemon/hbctrl:peerWatch", "HB_PEER_WATCH=hb#1.rx-n1", "HB_PEER_WATCH=hb#2.rx-n1"],
    });
    // The side and the heartbeat: the watchers of both.
    expect(heartbeatLogs(STATUS, { hb: "hb#1", side: { node: "n2", dir: "rx" } }, true).filters).toEqual([
      "PKG=daemon/hbctrl:peerWatch",
      "HB_PEER_WATCH=hb#1.rx-n1",
    ]);
    // The beats of n1 to n2: sent by the tx of n1, received by the rx of n2.
    expect(heartbeatLogs(STATUS, { link: { from: "n1", to: "n2" } }, true)).toEqual({
      nodes: ["n1", "n2"],
      filters: [
        "PKG=daemon/hbctrl:peerWatch",
        "HB_PEER_WATCH=hb#1.rx-n1",
        "HB_PEER_WATCH=hb#1.tx-n2",
        "HB_PEER_WATCH=hb#2.rx-n1",
        "HB_PEER_WATCH=hb#2.tx-n2",
      ],
    });
  });
});
