import React from "react";
import {act, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import {ResourceConsole} from "../ResourceConsole";
import {takeOpening} from "../../app/resource-sessions";

// The terminal and the screen are tested on their own: here, what they are opened on.
const mounted = vi.hoisted(() => ({sessions: [], gone: []}));
vi.mock("../ConsoleTerminal.jsx", async () => {
    const {useEffect} = await import("react");
    const Session = ({target, onStatus}) => {
        useEffect(() => {
            mounted.sessions.push({target, onStatus});
            return () => mounted.gone.push(target);
        }, [target, onStatus]);
        return <div data-testid="session">{`console of ${target.rid} on ${target.node}`}</div>;
    };
    return {default: Session, CONSOLE_STATUS: {connecting: "connecting", open: "open", ended: "ended", failed: "failed"}};
});
vi.mock("../ConsoleDisplay.jsx", () => ({
    default: ({target}) => <div data-testid="session">{`display of ${target.rid} on ${target.node}`}</div>,
}));

const panel = (props = {}) => (
    <MemoryRouter>
        <ResourceConsole kind="console" path="prod/svc/web" rid="container#1" nodes={["n1", "n2"]} upNodes={["n2"]} {...props}/>
    </MemoryRouter>
);
const connect = () => fireEvent.click(screen.getByRole("button", {name: "Connect"}));

describe("ResourceConsole", () => {
    beforeEach(() => {
        mounted.sessions.length = 0;
        mounted.gone.length = 0;
    });

    afterEach(() => {
        localStorage.clear();
    });

    test("opens nothing by itself: a link to the tab is no shell", () => {
        render(panel());
        expect(screen.queryByTestId("session")).toBeNull();
        expect(mounted.sessions).toEqual([]);
    });

    test("the node at first, the first where the resource runs; Connect opens the session there", () => {
        render(panel());
        expect(screen.getByRole("combobox", {name: "Node of the session"})).toHaveValue("n2");
        connect();
        expect(screen.getByTestId("session")).toHaveTextContent("console of container#1 on n2");
        expect(mounted.sessions[0].target).toEqual({node: "n2", namespace: "prod", kind: "svc", name: "web", rid: "container#1"});
    });

    test("not running on the node: said, and no Connect", () => {
        render(panel());
        fireEvent.change(screen.getByRole("combobox", {name: "Node of the session"}), {target: {value: "n1"}});
        expect(screen.getByRole("button", {name: "Connect"})).toBeDisabled();
        expect(screen.getByText("Not running on n1.")).toBeInTheDocument();
    });

    test("a node alone is named, no picker; nowhere running, it still is the one shown", () => {
        render(panel({nodes: ["n1"], upNodes: []}));
        expect(screen.queryByRole("combobox")).toBeNull();
        expect(screen.getByText("n1")).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Connect"})).toBeDisabled();
    });

    test("a session holds its node, tells it is live, and Disconnect ends it", () => {
        const onLive = vi.fn();
        render(panel({onLive}));
        connect();
        expect(onLive).toHaveBeenLastCalledWith("console", true);
        expect(screen.getByRole("combobox", {name: "Node of the session"})).toBeDisabled();
        fireEvent.click(screen.getByRole("button", {name: "Disconnect"}));
        expect(screen.queryByTestId("session")).toBeNull();
        expect(mounted.gone).toHaveLength(1);
        expect(onLive).toHaveBeenLastCalledWith("console", false);
    });

    test("ended, it stays on display, for what it said, and Connect opens another", () => {
        const onLive = vi.fn();
        render(panel({onLive}));
        connect();
        act(() => mounted.sessions[0].onStatus("ended"));
        expect(screen.getByTestId("session")).toBeInTheDocument();
        expect(onLive).toHaveBeenLastCalledWith("console", false);
        connect();
        expect(mounted.sessions).toHaveLength(2);
        expect(mounted.gone).toHaveLength(1);
    });

    test("hidden, the session goes on", () => {
        const {rerender} = render(panel());
        connect();
        rerender(panel({hidden: true}));
        expect(mounted.gone).toEqual([]);
        expect(document.querySelector("[data-resource-session]")).toHaveClass("hidden");
        rerender(panel());
        expect(document.querySelector("[data-resource-session]")).not.toHaveClass("hidden");
        expect(mounted.sessions).toHaveLength(1);
    });

    test("gone, it tells it is no longer live", () => {
        const onLive = vi.fn();
        const {unmount} = render(panel({onLive}));
        connect();
        unmount();
        expect(onLive).toHaveBeenLastCalledWith("console", false);
    });

    test("the keys of a session are its own: an Escape closes no panel", () => {
        const onDocument = vi.fn();
        document.addEventListener("keydown", onDocument);
        render(panel());
        connect();
        fireEvent.keyDown(screen.getByTestId("session"), {key: "Escape"});
        document.removeEventListener("keydown", onDocument);
        expect(onDocument).not.toHaveBeenCalled();
    });

    test("a tab of its own, on the node picked: a link, the click leaving word to connect", () => {
        render(panel());
        const link = screen.getByRole("link", {name: "Open in a new tab"});
        expect(link).toHaveAttribute("href", "/session/console?path=prod%2Fsvc%2Fweb&rid=container%231&node=n2");
        expect(link).toHaveAttribute("target", "_blank");
        fireEvent.click(link);
        expect(takeOpening("?path=prod%2Fsvc%2Fweb&rid=container%231&node=n2")).toBe(true);
        // Whatever session runs here goes on: it is another one.
        expect(mounted.sessions).toEqual([]);
    });

    test("not running on the node, no tab either", () => {
        render(panel({upNodes: []}));
        expect(screen.queryByRole("link", {name: "Open in a new tab"})).toBeNull();
        expect(screen.getByRole("button", {name: "Open in a new tab"})).toBeDisabled();
    });

    test("no node: said", () => {
        render(panel({nodes: [], upNodes: []}));
        expect(screen.queryByRole("button", {name: "Connect"})).toBeNull();
    });

    test("the display, on a guest", () => {
        render(panel({kind: "display"}));
        expect(within(document.body).getByText("Connect opens the screen of the guest on n2.")).toBeInTheDocument();
        connect();
        expect(screen.getByTestId("session")).toHaveTextContent("display of container#1 on n2");
    });
});
