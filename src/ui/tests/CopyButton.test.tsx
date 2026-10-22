import { afterEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "../../i18n";
import { CopyButton } from "../components/CopyButton";

const setClipboard = (value: unknown) => {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
};
const setSecure = (value: boolean | undefined) => {
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });
};

describe("CopyButton", () => {
  afterEach(() => {
    setClipboard(undefined);
    setSecure(undefined);
  });

  test("copies its text, a check said in the place of its icon for a while", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<CopyButton text="host = db1" label="Copy the content" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the content" }));
    });
    expect(writeText).toHaveBeenCalledWith("host = db1");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copy the content" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  test("not shown without the clipboard api, nor out of a secure context", () => {
    setClipboard(undefined);
    const { unmount } = render(<CopyButton text="x" label="Copy" />);
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    setClipboard({ writeText: vi.fn() });
    setSecure(false);
    render(<CopyButton text="x" label="Copy" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
