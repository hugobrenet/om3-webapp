import React from "react";
import {act, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConsoleDisplay from "../ConsoleDisplay.jsx";
import {requestConsoleTicket} from "../../services/console-service.js";

// The client of the display protocol draws in a canvas the test environment
// does not have: what the component asks of it is recorded instead.
const clients = [];
vi.mock("@novnc/novnc", () => ({
    default: class extends EventTarget {
        constructor(target, channel) {
            super();
            this.target = target;
            this.channel = channel;
            this.ctrlAltDels = 0;
            this.disconnected = false;
            clients.push(this);
        }

        focus() {
        }

        sendCtrlAltDel() {
            this.ctrlAltDels += 1;
        }

        disconnect() {
            this.disconnected = true;
        }
    },
}));

vi.mock("../../services/console-service.js", async (importOriginal) => ({
    ...(await importOriginal()),
    requestConsoleTicket: vi.fn(),
}));

class FakeWebSocket extends EventTarget {
    constructor(url) {
        super();
        this.url = url;
        this.closed = false;
    }

    close() {
        this.closed = true;
    }
}

const TARGET = {node: "n1", namespace: "ns1", kind: "svc", name: "vm", rid: "container#1"};

describe("ConsoleDisplay", () => {
    beforeEach(() => {
        clients.length = 0;
        localStorage.setItem("authToken", "tok");
        vi.stubGlobal("WebSocket", FakeWebSocket);
        requestConsoleTicket.mockResolvedValue({ticket: "t1", port: 1216});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const opened = async () => {
        render(<ConsoleDisplay target={TARGET}/>);
        await waitFor(() => expect(clients).toHaveLength(1));
        return clients[0];
    };

    test("asks a display ticket, and hands the client a websocket of its own", async () => {
        const client = await opened();
        expect(requestConsoleTicket).toHaveBeenCalledWith(expect.objectContaining({graphics: true, rid: "container#1"}));
        expect(client.channel.url).toContain("ticket=t1");
        expect(client.channel.binaryType).toBe("arraybuffer");
        expect(client.scaleViewport).toBe(true);
    });

    test("Ctrl+Alt+Del goes to the guest once connected", async () => {
        const client = await opened();
        const button = screen.getByRole("button", {name: "Send Ctrl+Alt+Del"});
        expect(button).toBeDisabled();
        act(() => {
            client.dispatchEvent(new Event("connect"));
        });
        await userEvent.click(button);
        expect(client.ctrlAltDels).toBe(1);
    });

    test("what refuses the display is said", async () => {
        const client = await opened();
        act(() => {
            client.channel.dispatchEvent(new CloseEvent("close", {reason: "the guest has a spice display, and a vnc one is needed"}));
        });
        expect(await screen.findByText(/a spice display/)).toBeInTheDocument();
    });

    test("a console port not reached tells where to accept its certificate", async () => {
        const client = await opened();
        act(() => {
            client.channel.dispatchEvent(new CloseEvent("close"));
        });
        expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
    });

    test("a session ending is said, and closing ends it", async () => {
        const {unmount} = render(<ConsoleDisplay target={TARGET}/>);
        await waitFor(() => expect(clients).toHaveLength(1));
        const client = clients[0];
        act(() => {
            client.channel.dispatchEvent(new Event("open"));
            client.channel.dispatchEvent(new CloseEvent("close"));
        });
        expect(await screen.findByText("The display session ended.")).toBeInTheDocument();
        unmount();
        expect(client.disconnected).toBe(true);
        expect(client.channel.closed).toBe(true);
    });
});

