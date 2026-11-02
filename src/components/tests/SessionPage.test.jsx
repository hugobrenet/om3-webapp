import React from "react";
import {fireEvent, render, screen} from "@testing-library/react";
import {MemoryRouter, Route, Routes} from "react-router-dom";
import {afterEach, describe, expect, test, vi} from "vitest";
import SessionPage from "../SessionPage";
import {markOpening} from "../../app/resource-sessions";

vi.mock("../ConsoleTerminal.jsx", () => ({
    default: ({target}) => <div data-testid="session">{`console of ${target.rid} on ${target.node} of ${target.namespace}/${target.kind}/${target.name}`}</div>,
    CONSOLE_STATUS: {connecting: "connecting", open: "open", ended: "ended", failed: "failed"},
}));
vi.mock("../ConsoleDisplay.jsx", () => ({default: () => <div data-testid="session">display</div>}));

const SEARCH = "?path=prod%2Fsvc%2Fweb&rid=container%231&node=n1";
const show = (url = `/session/console${SEARCH}`) => render(
    <MemoryRouter initialEntries={[url]}>
        <Routes>
            <Route path="/session/:kind" element={<SessionPage/>}/>
            <Route path="/" element={<div>home</div>}/>
        </Routes>
    </MemoryRouter>,
);

describe("SessionPage", () => {
    afterEach(() => {
        localStorage.clear();
    });

    test("by its URL alone, nothing opens: Connect does", () => {
        show();
        expect(screen.queryByTestId("session")).toBeNull();
        fireEvent.click(screen.getByRole("button", {name: "Connect"}));
        expect(screen.getByTestId("session")).toHaveTextContent("console of container#1 on n1 of prod/svc/web");
    });

    test("opened by a click, it connects at once", () => {
        markOpening(SEARCH);
        show();
        expect(screen.getByTestId("session")).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Disconnect"})).toBeInTheDocument();
    });

    test("the browser tab named after the session", () => {
        show();
        expect(document.title).toBe("container#1 @ n1 · prod/svc/web");
    });

    test("leaving a session live is asked first, not one ended", () => {
        markOpening(SEARCH);
        show();
        const live = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(live);
        expect(live.defaultPrevented).toBe(true);
        fireEvent.click(screen.getByRole("button", {name: "Disconnect"}));
        const ended = new Event("beforeunload", {cancelable: true});
        window.dispatchEvent(ended);
        expect(ended.defaultPrevented).toBe(false);
    });

    test("a session of no known kind, or missing a part, goes home", () => {
        show("/session/shell?path=a&rid=b&node=c");
        expect(screen.getByText("home")).toBeInTheDocument();
    });

    test("the display of a guest", () => {
        show(`/session/display${SEARCH}`);
        expect(screen.getByText("Connect opens the screen of the guest on n1.")).toBeInTheDocument();
    });
});
