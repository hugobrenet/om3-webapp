import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "../../i18n";
import { ActionTray, failedActionQuestion } from "../ActionTray";
import { type Tracked, useActionTracker } from "../action-tracker";
import { MAX_LINK_PROMPT } from "../../config/ai-agent.js";

vi.mock("../../hooks/useAiAvailable.js", () => ({ default: () => true }));

const ORCH = "11111111-1111-1111-1111-111111111111";
const failed: Tracked = {
  id: "a1",
  action: "start",
  subject: "prod/svc/web",
  kind: "orchestration",
  followedId: ORCH,
  node: "dev5n1",
  state: "failed",
  error: "resource fs#1 failed to mount",
  startedAt: 0,
  endedAt: 1000,
  steps: [],
};
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

function Location() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="location" data-pathname={pathname} data-prompt={new URLSearchParams(search).get("prompt") ?? ""} />
  );
}

afterEach(() => {
  useActionTracker.setState({ tracked: [] });
});

describe("the question to the assistant about a failed action", () => {
  test("names the action, its object, its node, its id and its error", () => {
    expect(failedActionQuestion(t, failed)).toBe(
      `Explain why the action Start on prod/svc/web failed, and suggest a fix. Node: dev5n1. orchestration: ${ORCH}. Error: “resource fs#1 failed to mount”.`,
    );
  });
  test("goes without what it has not: a node, an id, an error the tray words itself", () => {
    expect(failedActionQuestion(t, { ...failed, node: "", followedId: undefined, error: undefined })).toBe(
      "Explain why the action Start on prod/svc/web failed, and suggest a fix.",
    );
    expect(failedActionQuestion(t, { ...failed, error: "gone" })).toBe(
      `Explain why the action Start on prod/svc/web failed, and suggest a fix. Node: dev5n1. orchestration: ${ORCH}.`,
    );
  });
  test("says a refusal, nothing ran, with the reason given", () => {
    // A bulk freeze refused: no node, no orchestration.
    expect(
      failedActionQuestion(t, { ...failed, action: "freeze", subject: "dev5n1", state: "refused", kind: "exec", node: "", followedId: undefined, error: "not allowed" }),
    ).toBe("Explain why the daemon refused the action Freeze on dev5n1: it did not run. Say what to do about it. Reason given: “not allowed”.");
  });
  test("quotes an error as it is, never read as a placeholder", () => {
    expect(failedActionQuestion(t, { ...failed, error: "{{node}} gone" })).toContain("Error: “{{node}} gone”.");
  });
  test("cuts the error to what the bound of a link leaves, the sentence whole", () => {
    const long = { ...failed, subject: `prod/svc/${"a".repeat(150)}`, error: "x".repeat(400) };
    const question = failedActionQuestion(t, long);
    expect(question.length).toBeLessThanOrEqual(MAX_LINK_PROMPT);
    expect(question).toMatch(/^Explain why .* failed, and suggest a fix\. Node: dev5n1\. orchestration: .*\. Error: “x+…”\.$/);
    // No room left: no error rather than a few letters of it.
    expect(failedActionQuestion(t, { ...long, subject: "a".repeat(420) })).not.toContain("Error");
  });
});

describe("the link of a failed action", () => {
  test("opens the assistant with its question, and closes the dialog", () => {
    useActionTracker.setState({ tracked: [failed, { ...failed, id: "a2", state: "succeeded", error: undefined }] });
    render(
      <MemoryRouter>
        <ActionTray />
        <Location />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
    // The failed one only.
    const links = screen.getAllByRole("link", { name: "Analyze with the assistant" });
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]!);
    const location = screen.getByTestId("location");
    expect(location).toHaveAttribute("data-pathname", "/ai");
    expect(location).toHaveAttribute("data-prompt", failedActionQuestion(t, failed));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  test("leaves the dialog open on a click with a modifier, which opens another tab", () => {
    useActionTracker.setState({ tracked: [failed] });
    render(
      <MemoryRouter>
        <ActionTray />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
    // The browser would open the link in another tab; jsdom cannot.
    const leave = (event: MouseEvent) => {
      event.preventDefault();
    };
    document.addEventListener("click", leave);
    fireEvent.click(screen.getByRole("link", { name: "Analyze with the assistant" }), { ctrlKey: true });
    document.removeEventListener("click", leave);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
