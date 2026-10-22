import React from "react";
import {act, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConsoleTerminal from "../ConsoleTerminal.jsx";
import i18n from "../../i18n";
import {
    consoleCertificateUrl,
    consoleUrl,
    openConsoleSession,
    requestConsoleTicket,
} from "../../services/console-service.js";

// The terminal draws in a canvas the test environment does not have: what
// the component asks of it is recorded instead.
const terminals = [];
vi.mock("@xterm/xterm", () => ({
    Terminal: class {
        constructor(options) {
            this.options = options;
            this.cols = 100;
            this.rows = 30;
            this.written = [];
            this.opened = null;
            this.focused = false;
            this.disposed = false;
            this.dataDisposed = false;
            this.resizeDisposed = false;
            terminals.push(this);
        }

        loadAddon(addon) {
            this.addon = addon;
        }

        open(element) {
            this.opened = element;
        }

        write(bytes) {
            this.written.push(bytes);
        }

        focus() {
            this.focused = true;
        }

        onData(cb) {
            this.dataCb = cb;
            return {dispose: () => { this.dataDisposed = true; }};
        }

        onResize(cb) {
            this.resizeCb = cb;
            return {dispose: () => { this.resizeDisposed = true; }};
        }

        dispose() {
            this.disposed = true;
        }
    },
}));

const fits = [];
vi.mock("@xterm/addon-fit", () => ({
    FitAddon: class {
        constructor() {
            this.calls = 0;
            this.fail = false;
            fits.push(this);
        }

        fit() {
            this.calls += 1;
            if (this.fail) {
                throw new Error("no size yet");
            }
        }
    },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("../../services/console-service.js", () => ({
    CONSOLE_REASON_ERROR: "error",
    requestConsoleTicket: vi.fn(),
    consoleUrl: vi.fn(),
    consoleCertificateUrl: vi.fn(),
    openConsoleSession: vi.fn(),
}));

const target = {node: "n1", namespace: "ns1", kind: "svc", name: "web", rid: "container#1"};
const ticket = {ticket: "T", port: 1216};

// startSession renders an open console whose ticket was issued, and returns
// the session the component opened and the handlers it gave it.
const startSession = async (onClose = vi.fn()) => {
    const session = {send: vi.fn(), resize: vi.fn(), close: vi.fn()};
    let handlers;
    requestConsoleTicket.mockResolvedValue(ticket);
    consoleUrl.mockReturnValue("wss://n1:1216/?ticket=T");
    consoleCertificateUrl.mockReturnValue("https://n1:1216/");
    openConsoleSession.mockImplementation((url, h) => {
        handlers = h;
        return session;
    });
    const view = render(<ConsoleTerminal open target={target} onClose={onClose}/>);
    await waitFor(() => expect(openConsoleSession).toHaveBeenCalled());
    return {session, handlers: () => handlers, view, onClose};
};

describe("ConsoleTerminal", () => {
    beforeEach(() => {
        terminals.length = 0;
        fits.length = 0;
        localStorage.setItem("authToken", "tok");
    });

    afterEach(() => {
        localStorage.clear();
    });

    test("renders nothing of a session while closed", () => {
        render(<ConsoleTerminal open={false} target={target} onClose={vi.fn()}/>);
        expect(requestConsoleTicket).not.toHaveBeenCalled();
        expect(terminals).toHaveLength(0);
    });

    test("opens no session without a target", () => {
        render(<ConsoleTerminal open target={null} onClose={vi.fn()}/>);
        expect(screen.getByText("Console")).toBeInTheDocument();
        expect(requestConsoleTicket).not.toHaveBeenCalled();
    });

    test("speaks French in a French browser", async () => {
        requestConsoleTicket.mockReturnValue(new Promise(() => {}));
        await i18n.changeLanguage("fr");
        try {
            render(<ConsoleTerminal open target={target} onClose={vi.fn()}/>);
            expect(screen.getByText("Console container#1 sur n1")).toBeInTheDocument();
            expect(screen.getByText("Ouverture de la console...")).toBeInTheDocument();
        } finally {
            await act(() => i18n.changeLanguage("en"));
        }
    });

    test("asks for a ticket and opens the session on the console url", async () => {
        const {session, handlers} = await startSession();
        expect(requestConsoleTicket).toHaveBeenCalledWith({...target, token: "tok"});
        expect(consoleUrl).toHaveBeenCalledWith(ticket);
        expect(openConsoleSession.mock.calls[0][0]).toBe("wss://n1:1216/?ticket=T");
        expect(screen.getByText("Console container#1 on n1")).toBeInTheDocument();
        expect(screen.getByText("Opening console...")).toBeInTheDocument();

        const term = terminals[0];
        expect(term.opened).toBe(screen.getByTestId("console-terminal"));

        act(() => handlers().onOpen());
        expect(screen.queryByText("Opening console...")).not.toBeInTheDocument();
        expect(session.resize).toHaveBeenCalledWith(100, 30);
        expect(term.focused).toBe(true);
    });

    test("connects the terminal and the session both ways", async () => {
        const {session, handlers} = await startSession();
        const term = terminals[0];
        act(() => handlers().onOpen());

        const bytes = new Uint8Array([104, 105]);
        handlers().onData(bytes);
        expect(term.written).toEqual([bytes]);

        term.dataCb("ls\n");
        expect(session.send).toHaveBeenCalledWith("ls\n");
        term.resizeCb({cols: 132, rows: 43});
        expect(session.resize).toHaveBeenLastCalledWith(132, 43);
    });

    test("fits the terminal when the window is resized, whatever the fit says", async () => {
        await startSession();
        const fit = fits[0];
        const before = fit.calls;
        act(() => {
            window.dispatchEvent(new Event("resize"));
        });
        expect(fit.calls).toBe(before + 1);
        fit.fail = true;
        act(() => {
            window.dispatchEvent(new Event("resize"));
        });
        expect(fit.calls).toBe(before + 2);
    });

    test("says the session ended with the exit code of its command", async () => {
        const {handlers} = await startSession();
        act(() => handlers().onOpen());
        act(() => handlers().onEnd({opened: true, exit: {code: 3, reason: "exited", text: ""}}));
        expect(screen.getByText("Session ended (exit code 3).")).toBeInTheDocument();
    });

    test("says what the node said of a session that failed", async () => {
        const {handlers} = await startSession();
        act(() => handlers().onEnd({opened: true, exit: {code: 1, reason: "error", text: "the container is not running"}}));
        expect(screen.getByText("the container is not running")).toBeInTheDocument();

        act(() => handlers().onEnd({opened: true, exit: {code: 1, reason: "error", text: ""}}));
        expect(screen.getByText("The console session failed.")).toBeInTheDocument();
    });

    test("says a lost connection is one", async () => {
        const {handlers} = await startSession();
        act(() => handlers().onOpen());
        act(() => handlers().onEnd({opened: true, exit: null}));
        expect(screen.getByText("The console connection was lost.")).toBeInTheDocument();
    });

    test("points at the certificate of the console port when it can not be reached", async () => {
        const {handlers} = await startSession();
        act(() => handlers().onEnd({opened: false, exit: null}));
        expect(screen.getByText(/The console could not be reached\./)).toBeInTheDocument();
        expect(consoleCertificateUrl).toHaveBeenCalledWith("wss://n1:1216/?ticket=T");
        const link = screen.getByRole("link", {name: "https://n1:1216/"});
        expect(link).toHaveAttribute("href", "https://n1:1216/");
        expect(link).toHaveAttribute("target", "_blank");
    });

    test("says why the ticket was refused", async () => {
        requestConsoleTicket.mockRejectedValue(new Error("HTTP 403: not allowed"));
        render(<ConsoleTerminal open target={target} onClose={vi.fn()}/>);
        expect(await screen.findByText("Failed to open console: HTTP 403: not allowed")).toBeInTheDocument();
        expect(openConsoleSession).not.toHaveBeenCalled();
    });

    test("opens no session without an auth token", async () => {
        localStorage.clear();
        render(<ConsoleTerminal open target={target} onClose={vi.fn()}/>);
        expect(await screen.findByText("Auth token not found.")).toBeInTheDocument();
        expect(requestConsoleTicket).not.toHaveBeenCalled();
    });

    test("ends the session and the terminal when it is closed", async () => {
        const {session, view, onClose, handlers} = await startSession();
        const term = terminals[0];
        await userEvent.click(screen.getByRole("button", {name: "Close"}));
        expect(onClose).toHaveBeenCalled();

        view.rerender(<ConsoleTerminal open={false} target={target} onClose={onClose}/>);
        await waitFor(() => expect(session.close).toHaveBeenCalled());
        expect(term.disposed).toBe(true);
        expect(term.dataDisposed).toBe(true);
        expect(term.resizeDisposed).toBe(true);

        // What the session says after the dialog closed is not shown.
        act(() => handlers().onEnd({opened: true, exit: null}));
        expect(screen.queryByText("The console connection was lost.")).not.toBeInTheDocument();
    });

    test("is a dialog named after the console", async () => {
        await startSession();
        expect(screen.getByRole("dialog", {name: "Console container#1 on n1"})).toBeInTheDocument();
    });

    test("closes on Escape", async () => {
        const {onClose} = await startSession();
        await userEvent.keyboard("{Escape}");
        expect(onClose).toHaveBeenCalled();
    });

    test("draws the terminal in the colours of the design tokens, and follows the theme", async () => {
        const root = document.documentElement;
        root.style.setProperty("--surface-sunken", "#101010");
        root.style.setProperty("--ink", "#eeeeee");
        root.style.setProperty("--accent", "#00aaaa");
        root.style.setProperty("--state-down", "#ff0000");
        try {
            const {view} = await startSession();
            const term = terminals[0];
            expect(term.options.theme).toMatchObject({
                background: "#101010",
                foreground: "#eeeeee",
                cursor: "#00aaaa",
                red: "#ff0000",
            });
            // A token not defined leaves the xterm default.
            expect(term.options.theme).not.toHaveProperty("magenta");

            root.style.setProperty("--ink", "#222222");
            root.classList.add("dark");
            await waitFor(() => expect(term.options.theme.foreground).toBe("#222222"));

            // The theme is no longer followed once the console closed.
            view.unmount();
            root.style.setProperty("--ink", "#333333");
            root.classList.remove("dark");
            await new Promise((r) => setTimeout(r, 0));
            expect(term.options.theme.foreground).toBe("#222222");
        } finally {
            root.removeAttribute("style");
            root.classList.remove("dark");
        }
    });

    test("opens no session for a ticket issued after the dialog closed", async () => {
        let resolve;
        requestConsoleTicket.mockReturnValue(new Promise((r) => {
            resolve = r;
        }));
        const view = render(<ConsoleTerminal open target={target} onClose={vi.fn()}/>);
        await waitFor(() => expect(requestConsoleTicket).toHaveBeenCalled());
        view.unmount();
        await act(async () => {
            resolve(ticket);
        });
        expect(openConsoleSession).not.toHaveBeenCalled();
    });

    test("shows nothing of a ticket refused after the dialog closed", async () => {
        let reject;
        requestConsoleTicket.mockReturnValue(new Promise((_, r) => {
            reject = r;
        }));
        const view = render(<ConsoleTerminal open target={target} onClose={vi.fn()}/>);
        await waitFor(() => expect(requestConsoleTicket).toHaveBeenCalled());
        view.unmount();
        await act(async () => {
            reject(new Error("HTTP 500"));
        });
        expect(screen.queryByText(/Failed to open console/)).not.toBeInTheDocument();
    });
});
