import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ActionTray, formatDuration } from "../ActionTray";
import { trackAccepted, trackPoll, trackRefused, trackResponse, useActionTracker } from "../action-tracker";
import { resetClusterStatus } from "../../hooks/clusterStatusOnce";
import useEventStore from "../../hooks/useEventStore.js";

// The logs of an id, tested with the daemon tab: here, which id, of which kind, on which node.
vi.mock("../../components/DaemonIdLogs", () => ({
  DaemonIdLogs: ({ target }: { target: { kind: string; id: string; node: string; subject: string } }) => (
    <div role="dialog" aria-label={`logs ${target.subject}`} data-kind={target.kind} data-id={target.id} data-node={target.node} />
  ),
}));

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);

const ORCH = "11111111-1111-1111-1111-111111111111";
const EXEC = "22222222-2222-2222-2222-222222222222";

/** The daemon of dev3: an orchestration running once, then succeeded, a run on each node. */
function daemon({ orchestration = ["running", "succeeded"], exec = ["running", "failed"] } = {}) {
  let orchestrationReads = 0;
  let execReads = 0;
  const handler = vi.fn((url: string) => {
    if (url === "/api/cluster/status?selector=cluster") {
      return json(200, { cluster: { config: { nodes: ["dev3n1", "dev3n2"] }, node: { dev3n1: {}, dev3n2: {} } } });
    }
    if (url.includes(`/daemon/orchestration/id/${ORCH}`)) {
      const state = orchestration[Math.min(orchestrationReads, orchestration.length - 1)];
      orchestrationReads += 1;
      if (state === "408" || state === "410") return json(Number(state), {});
      return json(200, { orchestration_id: ORCH, node: "dev3n1", state, error: state === "refused" ? "no candidate" : undefined });
    }
    if (url.includes(`exec?orchestration_id=${ORCH}`)) {
      const node = url.includes("/dev3n1/") ? "dev3n1" : "dev3n2";
      return json(200, {
        items: [
          {
            exec_id: `${node}-run`,
            node,
            title: node === "dev3n1" ? "provision leader" : "provision non leader",
            state: "succeeded",
            exit_code: 0,
            started_at: node === "dev3n1" ? "2026-10-19T12:00:00Z" : "2026-10-19T12:00:01Z",
            ended_at: "2026-10-19T12:00:02Z",
          },
        ],
      });
    }
    if (url.includes(`/daemon/exec/id/${EXEC}`)) {
      const state = exec[Math.min(execReads, exec.length - 1)];
      execReads += 1;
      return json(200, {
        exec_id: EXEC,
        node: "dev3n2",
        title: "start",
        state,
        exit_code: state === "failed" ? 1 : undefined,
        error: state === "failed" ? "fs#1: mount failed" : undefined,
        started_at: "2026-10-19T12:00:00Z",
        ended_at: state === "running" ? undefined : "2026-10-19T12:00:03Z",
      });
    }
    return json(404, {});
  });
  return handler as unknown as typeof fetch;
}

const tracked = () => useActionTracker.getState().tracked;

beforeEach(() => {
  resetClusterStatus();
  useActionTracker.setState({ tracked: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  useActionTracker.setState({ tracked: [] });
});

describe("trackAccepted", () => {
  test("an orchestration is followed to its end, read again until then, its runs on each node read", async () => {
    globalThis.fetch = daemon();
    trackAccepted({ orchestration_id: ORCH, node: "dev3n1" }, { action: "provision", subject: "foo" });
    expect(tracked()[0]).toMatchObject({ action: "provision", subject: "foo", kind: "orchestration", node: "dev3n1", state: "running" });
    await waitFor(() => {
      expect(tracked()[0]?.state).toBe("succeeded");
    }, { timeout: 3000 });
    expect(tracked()[0]?.steps.map((s) => [s.node, s.title, s.state])).toEqual([
      ["dev3n1", "provision leader", "succeeded"],
      ["dev3n2", "provision non leader", "succeeded"],
    ]);
    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    // Not held by the daemon: a held read per action would queue a batch behind its own waits.
    expect(urls).toContain(`/api/node/name/dev3n1/daemon/orchestration/id/${ORCH}`);
    expect(urls.some((url) => url.includes("wait="))).toBe(false);
  });

  test("a wait run out (408) is read again; a refusal says why", async () => {
    globalThis.fetch = daemon({ orchestration: ["408", "refused"] });
    trackAccepted({ orchestration_id: ORCH, node: "dev3n1" }, { action: "start", subject: "foo" });
    await waitFor(() => {
      expect(tracked()[0]?.state).toBe("refused");
    });
    expect(tracked()[0]?.error).toBe("no candidate");
  });

  test("an orchestration the daemon dropped (410) ends unknown", async () => {
    globalThis.fetch = daemon({ orchestration: ["410"] });
    trackAccepted({ orchestration_id: ORCH, node: "dev3n1" }, { action: "start", subject: "foo" });
    await waitFor(() => {
      expect(tracked()[0]?.state).toBe("unknown");
    });
  });

  test("an instance action is the run of its node, its failure said", async () => {
    globalThis.fetch = daemon();
    trackAccepted({ exec_id: EXEC, session_id: "s" }, { action: "start", subject: "foo on dev3n2", node: "dev3n2" });
    await waitFor(() => {
      expect(tracked()[0]?.state).toBe("failed");
    }, { timeout: 3000 });
    expect(tracked()[0]).toMatchObject({ kind: "exec", node: "dev3n2", error: "fs#1: mount failed" });
    expect(tracked()[0]?.steps[0]).toMatchObject({ node: "dev3n2", exitCode: 1 });
  });

  test("an action refused is said at once, ended, with its reason", () => {
    trackRefused({ action: "start", subject: "foo", reason: "HTTP 409 already started" });
    expect(tracked()[0]).toMatchObject({ action: "start", subject: "foo", state: "refused", error: "HTTP 409 already started" });
    expect(tracked()[0]?.endedAt).toBeDefined();
  });

  test("over the limit, the oldest ended actions go, never the running ones", () => {
    // 40 orchestrations running, asked of a selection; an older refusal under them.
    const running = Array.from({ length: 40 }, (_, i) => ({
      id: `run-${String(i)}`, action: "stop", subject: `svc${String(i)}`, kind: "orchestration" as const,
      node: "dev3n1", state: "running" as const, startedAt: 0, steps: [],
    }));
    const old = { id: "old", action: "start", subject: "web", kind: "exec" as const, node: "", state: "refused" as const, startedAt: 0, endedAt: 0, steps: [] };
    useActionTracker.setState({ tracked: [...running, old] });
    trackRefused({ action: "stop", subject: "svc40", reason: "HTTP 409" });
    const ids = tracked().map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(running.map((t) => t.id)));
    expect(ids).not.toContain("old");
  });

  test("an answer naming nothing to follow is done: the daemon acted before it answered (enable, 204)", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    await trackResponse({ status: 204, clone: () => ({ json: () => Promise.reject(new Error("no body")) }) } as unknown as Response, {
      action: "enable",
      subject: "foo",
      path: "foo",
    });
    expect(tracked()[0]).toMatchObject({ action: "enable", subject: "foo", state: "succeeded" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("an answer naming an orchestration is followed", async () => {
    globalThis.fetch = daemon();
    await trackResponse(
      { status: 200, clone: () => ({ json: () => Promise.resolve({ orchestration_id: ORCH, node: "dev3n1" }) }) } as unknown as Response,
      { action: "start", subject: "foo" },
    );
    expect(tracked()[0]).toMatchObject({ kind: "orchestration", state: "running" });
    await waitFor(() => {
      expect(tracked()[0]?.state).toBe("succeeded");
    }, { timeout: 3000 });
  });

  test("an answer naming nothing to follow is not followed", () => {
    globalThis.fetch = vi.fn();
    trackAccepted(null, { action: "status", subject: "foo" });
    trackAccepted({}, { action: "status", subject: "foo" });
    expect(tracked()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("trackPoll", () => {
  test("read again until done, a read failing tried again (a listener restarting answers nothing)", async () => {
    const answers = [Promise.reject(new Error("down")), Promise.resolve(false), Promise.resolve(true)];
    const probe = vi.fn(() => answers.shift() ?? Promise.resolve(true));
    trackPoll({ action: "restart", label: "Restart", subject: "the api.inet listener of dev3n1" }, probe, { lost: "lost", everyMs: 1 });
    expect(tracked()[0]).toMatchObject({ state: "running", label: "Restart" });
    await waitFor(() => {
      expect(tracked()[0]?.state).toBe("succeeded");
    });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  test("never done: its outcome unknown past the timeout", async () => {
    trackPoll({ action: "terminate", subject: "sleep on dev3n1" }, () => Promise.resolve(false), { lost: "no news", everyMs: 1, timeoutMs: 20 });
    await waitFor(() => {
      expect(tracked()[0]).toMatchObject({ state: "unknown", error: "no news" });
    });
  });
});

/** The button of the header that opens the actions asked. */
const trayButton = () => screen.queryByRole("button", { name: /^Actions: / });

/** The dialog of the actions, opened from its button. */
const openTray = () => {
  fireEvent.click(trayButton() as HTMLElement);
  return screen.getByRole("dialog", { name: /^Actions/ });
};

describe("ActionTray", () => {
  test("nothing asked, nothing shown", () => {
    render(<ActionTray />);
    expect(trayButton()).not.toBeInTheDocument();
  });

  test("says how each action goes, its runs, and lets the ended ones go", async () => {
    globalThis.fetch = daemon();
    render(<ActionTray />);
    act(() => {
      trackAccepted({ orchestration_id: ORCH, node: "dev3n1" }, { action: "provision", subject: "foo" });
      trackAccepted({ exec_id: EXEC }, { action: "start", subject: "foo on dev3n2", node: "dev3n2" });
    });
    // The button says how many run, no dialog opened by the actions asked.
    expect(trayButton()).toHaveAccessibleName("Actions: 2 running");
    expect(trayButton()).toHaveTextContent(/^2$/);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The trash can in the dialog only.
    expect(screen.queryByRole("button", { name: "Clear the ended actions" })).toBeNull();
    await waitFor(() => {
      expect(trayButton()).toHaveAccessibleName("Actions: 2 ended");
    }, { timeout: 3000 });
    const tray = openTray();
    const runs = within(tray).getByRole("list", { name: "The runs of Provision on the nodes" });
    expect(within(runs).getByText("provision leader")).toBeInTheDocument();
    expect(within(runs).getByText("provision non leader")).toBeInTheDocument();
    expect(within(tray).getByText("fs#1: mount failed · exit code 1")).toHaveClass("text-state-down");
    fireEvent.click(within(tray).getByRole("button", { name: "Clear the ended actions" }));
    expect(trayButton()).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ActionTray, the logs of each action", () => {
  test("an orchestration's logs and an exec's, in a modal, by their id; none for an action refused", () => {
    // Never answered: never ends while the test looks.
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    render(<ActionTray />);
    act(() => {
      trackAccepted({ orchestration_id: ORCH, node: "dev3n1" }, { action: "provision", subject: "foo" });
      trackAccepted({ exec_id: EXEC }, { action: "start", subject: "foo on dev3n2", node: "dev3n2" });
      trackRefused({ action: "stop", subject: "bar", reason: "HTTP 403" });
    });
    const tray = openTray();
    fireEvent.click(within(tray).getByRole("button", { name: "Logs of Provision foo" }));
    const orchestration = screen.getByRole("dialog", { name: "logs Provision foo" });
    expect(orchestration).toHaveAttribute("data-kind", "orchestration");
    expect(orchestration).toHaveAttribute("data-id", ORCH);
    fireEvent.click(within(tray).getByRole("button", { name: "Logs of Start foo on dev3n2" }));
    const exec = screen.getByRole("dialog", { name: "logs Start foo on dev3n2" });
    expect(exec).toHaveAttribute("data-kind", "exec");
    expect(exec).toHaveAttribute("data-id", EXEC);
    expect(exec).toHaveAttribute("data-node", "dev3n2");
    expect(within(tray).queryByRole("button", { name: /^Logs of Stop/ })).toBeNull();
    act(() => {
      useActionTracker.setState({ tracked: [] });
    });
  });
});

describe("ActionTray, an orchestration running nothing yet", () => {
  afterEach(() => {
    useEventStore.setState({ instanceMonitor: {} });
  });

  test("says where the monitor of each node stands, the delays it keeps", () => {
    // Never answered: never ends while the test looks.
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    useEventStore.setState({
      instanceMonitor: { "dev3n1:foo": { state: "ready" }, "dev3n2:foo": { state: "idle" }, "dev3n1:bar": { state: "starting" } },
    });
    render(<ActionTray />);
    act(() => {
      trackAccepted({ orchestration_id: ORCH, node: "dev3n1" }, { action: "start", subject: "foo", path: "foo" });
    });
    const runs = within(openTray()).getByRole("list", { name: "The runs of Start on the nodes" });
    // Idle says nothing; another object's monitor is not of it.
    expect(within(runs).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["dev3n1: the monitor is readydev3n1ready"]);
  });
});

describe("formatDuration", () => {
  test.each([
    [400, "0.4 s"],
    [12_000, "12 s"],
    [185_000, "3 min 05 s"],
  ])("%d ms is %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
