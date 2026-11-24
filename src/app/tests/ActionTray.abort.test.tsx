import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "../../i18n";
import { ActionTray, abortable } from "../ActionTray";
import { type Tracked, useActionTracker } from "../action-tracker";

const postAction = vi.fn();
const postNodeAction = vi.fn();
vi.mock("../../components/objectActions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  postAction: (...args: unknown[]) => postAction(...args) as unknown,
}));
vi.mock("../node-actions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  postNodeAction: (...args: unknown[]) => postNodeAction(...args) as unknown,
}));

const running: Tracked = {
  id: "a1",
  action: "stop",
  subject: "prod/svc/web",
  kind: "orchestration",
  followedId: "11111111-1111-1111-1111-111111111111",
  node: "dev5n1",
  path: "prod/svc/web",
  state: "running",
  startedAt: Date.now(),
  steps: [],
};
const drain: Tracked = { ...running, id: "a2", action: "drain", subject: "dev5n2", node: "dev5n2", path: undefined };

beforeEach(() => {
  postAction.mockResolvedValue(null);
  postNodeAction.mockResolvedValue(undefined);
});

afterEach(() => {
  useActionTracker.setState({ tracked: [] });
  vi.clearAllMocks();
});

function openTray(tracked: Tracked[]) {
  useActionTracker.setState({ tracked });
  render(
    <MemoryRouter>
      <ActionTray />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
}

describe("what the tray can abort", () => {
  test("an orchestration in progress, of an object or of a node", () => {
    expect(abortable(running)).toBe(true);
    expect(abortable(drain)).toBe(true);
  });
  test("not one ended, an exec, an abort, or one whose node is not known", () => {
    expect(abortable({ ...running, state: "succeeded" })).toBe(false);
    expect(abortable({ ...running, kind: "exec" })).toBe(false);
    expect(abortable({ ...running, action: "abort" })).toBe(false);
    expect(abortable({ ...drain, node: "localhost" })).toBe(false);
  });
});

describe("the abort of an orchestration in progress", () => {
  test("asks first, then aborts the object's", async () => {
    openTray([running]);
    fireEvent.click(screen.getByRole("button", { name: "Abort Stop prod/svc/web" }));
    expect(postAction).not.toHaveBeenCalled();
    const question = screen.getByRole("group", { name: /^Abort Stop prod\/svc\/web\?/ });
    const yes = screen.getByRole("button", { name: "Abort" });
    expect(question).toContainElement(yes);
    expect(yes).toHaveFocus();
    await act(async () => {
      fireEvent.click(yes);
    });
    expect(postAction).toHaveBeenCalledWith({ path: "prod/svc/web", action: "abort" });
    expect(postNodeAction).not.toHaveBeenCalled();
    // Posted, the question goes.
    expect(screen.queryByRole("group", { name: /^Abort Stop/ })).toBeNull();
  });
  test("aborts a node's on its node", async () => {
    openTray([drain]);
    fireEvent.click(screen.getByRole("button", { name: "Abort Drain dev5n2" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abort" }));
    });
    expect(postNodeAction).toHaveBeenCalledWith("dev5n2", "abort", expect.objectContaining({ Authorization: expect.any(String) as string }));
    expect(postAction).not.toHaveBeenCalled();
  });
  test("aborts nothing on a no", () => {
    openTray([running]);
    fireEvent.click(screen.getByRole("button", { name: "Abort Stop prod/svc/web" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group", { name: /^Abort Stop/ })).toBeNull();
    expect(postAction).not.toHaveBeenCalled();
  });
  test("is offered on none ended", () => {
    openTray([{ ...running, state: "failed", endedAt: Date.now() }]);
    expect(screen.queryByRole("button", { name: /^Abort/ })).toBeNull();
  });
});
