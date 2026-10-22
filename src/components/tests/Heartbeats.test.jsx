import React from "react";
import {render, screen, waitFor, within, fireEvent, act, cleanup} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import userEvent from "@testing-library/user-event";
import Heartbeats from "../Heartbeats";
import {clearGrants} from "../../hooks/useGrants";
import i18n from "../../i18n";
import useEventStore from "../../hooks/useEventStore.js";
import {useActionTracker} from "../../app/action-tracker";
import {vi} from "vitest";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock("../../hooks/useEventStore.js", () => ({
    __esModule: true,
    default: vi.fn(),
}));

const {mockRetainEventReception, mockReleaseEventReception} = vi.hoisted(() => ({
    mockRetainEventReception: vi.fn(),
    mockReleaseEventReception: vi.fn(),
}));

vi.mock("../../eventSourceManager.jsx", () => ({
    retainEventReception: (...args) => {
        mockRetainEventReception(...args);
        return mockReleaseEventReception;
    },
    startLoggerReception: vi.fn(),
    closeLoggerEventSource: vi.fn(),
}));

const mockLocalStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
};
Object.defineProperty(window, "localStorage", {value: mockLocalStorage});

/** The logs viewer, its props told: the nodes and the journal fields it reads. */
const {mockLogsViewer} = vi.hoisted(() => ({mockLogsViewer: vi.fn()}));
vi.mock("../LogsViewer", async () => {
    const {createElement} = await import("react");
    return {
        default: (props) => {
            mockLogsViewer(props);
            return createElement("div", {"data-testid": "logs-viewer"});
        },
    };
});
const logsProps = () => mockLogsViewer.mock.calls.at(-1)[0];

/**
 * Renders the page at `route`, on its Data tab unless the route names one: the tests
 * are about the streams. `overview`, on the Overview, the page's own default.
 */
const renderWithRouter = (ui, {route = "/", overview = false} = {}) => {
    const at = overview || /[?&]view=/.test(route) ? route : `${route}${route.includes("?") ? "&" : "?"}view=data`;
    const Wrapper = ({children}) => (
        <MemoryRouter initialEntries={[at]}>
            {children}
        </MemoryRouter>
    );
    return render(ui, {wrapper: Wrapper});
};

const buildStatus = (streamDefs) => {
    const status = {};
    streamDefs.forEach(({node, streams}) => {
        status[node] = {streams: streams.map(s => ({...s}))};
    });
    return status;
};

// The view reads the MUI breakpoints it used through matchMedia: below md (900px) is
// mobile, from lg (1200px) wide.
const MOBILE_QUERY = "(max-width:899.95px)";
const WIDE_QUERY = "(min-width:1200px)";

const setMedia = ({mobile = false, wide = false} = {}) => {
    window.matchMedia = vi.fn((query) => ({
        matches: (query === MOBILE_QUERY && mobile) || (query === WIDE_QUERY && wide),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
    }));
};

const SELECT_LABEL = {running: "Routine", beating: "Beating", node: "Node", id: "ID", driver: "Driver"};

const getFilter = (selectKey, options) =>
    screen.getByRole("combobox", {name: SELECT_LABEL[selectKey], ...options});

const selectFilterOption = async (user, selectKey, optionName) => {
    const select = getFilter(selectKey);
    await user.selectOptions(select, within(select).getByRole("option", {name: optionName}));
};

const EMPTY_MESSAGE = "No heartbeats found matching the current filters.";

/** The heartbeat rows of the body, without the row telling the table is empty, nor those of the details of the mesh. */
const getDataRows = () =>
    screen.getAllByRole("row").filter((row) => !row.closest("[data-details]")).slice(1).filter(row => !row.textContent.includes(EMPTY_MESSAGE));

/** Shows a tab of the page, by the start of its name. */
const showTab = (name) => fireEvent.click(screen.getByRole("tab", {name: new RegExp(`^${name}`)}));

const getScrollContainer = () => screen.getAllByRole("table").find((table) => !table.closest("[data-details]")).parentElement;

/** The side of a row from its direction: the node sends on a tx, receives on an rx. */
const sideOf = (cells) => ({"sends to": "tx", "receives from": "rx"})[cells[3]] ?? "";

/** The stream of a row as its id says it, "1.rx": its heartbeat, hb# dropped, and its side. */
const streamOf = (row) => {
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    return `${cells[0].replace(/^hb#/, "")}.${sideOf(cells)}`;
};

const stoppedStreamWithCacheScenario = ({
                                            cachedPeer = {
                                                is_beating: true,
                                                desc: ":10011 ← peer1",
                                                changed_at: "t1",
                                                last_beating_at: "t2"
                                            },
                                            cachedType = "unicast",
                                            stoppedType = "unicast",
                                        } = {}) => {
    const initialStatus = buildStatus([{
        node: "node1",
        streams: [{
            id: "hb#1.rx",
            state: "running",
            type: cachedType,
            peers: {peer1: cachedPeer}
        }]
    }]);
    const stoppedStatus = buildStatus([{
        node: "node1",
        streams: [{id: "hb#1.rx", state: "stopped", type: stoppedType, peers: {}}]
    }]);
    return {initialStatus, stoppedStatus};
};

describe("Heartbeats Component", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLocalStorage.getItem.mockReturnValue("valid-token");
        mockNavigate.mockClear();
        setMedia();
        useActionTracker.setState({tracked: [], revealed: 0});
        storeListeners.clear();
    });

    afterEach(() => {
        delete window.matchMedia;
    });

    // The store as the page and the actions tray read it: selected, read, and listened to.
    let storeState = {heartbeatStatus: {}};
    const storeListeners = new Set();
    const mockHeartbeatStore = (heartbeatStatus) => {
        storeState = {heartbeatStatus};
        useEventStore.mockImplementation((selector) => selector(storeState));
        useEventStore.getState = () => storeState;
        useEventStore.subscribe = (listener) => {
            storeListeners.add(listener);
            return () => storeListeners.delete(listener);
        };
    };
    /** The status the events bring next, heard by the listeners. */
    const pushHeartbeatStatus = (heartbeatStatus) => act(() => {
        storeState = {heartbeatStatus};
        storeListeners.forEach((listener) => listener(storeState));
    });
    /** What the actions tray holds, the latest first: label, subject, state, reason. */
    const tray = () => useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state, e.error ?? null]);

    // ==================== STRUCTURE & BASIC RENDER ====================
    test("the Overview, the default tab: the mesh, its details, the heartbeats, the routines, four boxes in columns, each in one piece", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state: "running", type: "unicast", peers: {peer1: {is_beating: true}}}],
        }]));
        renderWithRouter(<Heartbeats/>, {overview: true});
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Data1", "Logs"]);
        expect(screen.getByRole("tab", {name: "Overview"})).toHaveAttribute("aria-selected", "true");
        expect(screen.queryByRole("table")).toBeNull();
        const mesh = screen.getByRole("region", {name: "Mesh"});
        const boxes = mesh.parentElement;
        expect([...boxes.children].map((box) => box.querySelector("h2").textContent)).toEqual(["Mesh", "Streams", "Heartbeats", "Routines"]);
        expect(boxes).toHaveClass("md:columns-[28rem]", "*:break-inside-avoid");
        expect(boxes).toHaveAttribute("role", "tabpanel");
        // The Data tab clicked: shown at once, the URL after.
        showTab("Data");
        expect(screen.getByRole("table")).toBeInTheDocument();
        expect(screen.queryByRole("region", {name: "Mesh"})).toBeNull();
        expect(mockNavigate).toHaveBeenCalledWith("/?view=data", {replace: true});
        expect(mesh.querySelector("[data-legend]").parentElement).toHaveClass("bg-surface-raised");
        expect(document.querySelector("details")).toBeNull();
    });

    test("the streams in the Data tab, their count in its name; the Logs tab named in the URL", () => {
        mockHeartbeatStore(buildStatus([{node: "node1", streams: [
            {id: "hb#1.rx", state: "running", type: "unicast", peers: {p: {is_beating: true, desc: "d"}}},
            {id: "hb#1.tx", state: "running", type: "unicast", peers: {p: {is_beating: true, desc: "d"}}},
        ]}]));
        renderWithRouter(<Heartbeats/>, {route: "/heartbeats?node=node1"});
        expect(screen.getByRole("tab", {name: "Data 2"})).toHaveAttribute("aria-selected", "true");
        expect(within(screen.getByRole("tabpanel")).getByRole("table")).toBeInTheDocument();
        expect(screen.queryByTestId("logs-viewer")).toBeNull();
        fireEvent.click(screen.getByRole("tab", {name: "Logs"}));
        expect(mockNavigate).toHaveBeenCalledWith("/heartbeats?node=node1&view=logs", {replace: true});
    });

    describe("the Logs tab", () => {
        const THREE_NODES = () => buildStatus(["n1", "n2", "n3"].map((node) => ({node, streams: [
            {id: "hb#1.tx", state: "running", type: "unicast", peers: Object.fromEntries(["n1", "n2", "n3"].filter((peer) => peer !== node).map((peer) => [peer, {is_beating: true, desc: "d"}]))},
            {id: "hb#2.rx", state: "running", type: "disk", peers: Object.fromEntries(["n1", "n2", "n3"].filter((peer) => peer !== node).map((peer) => [peer, {is_beating: true, desc: "d"}]))},
        ]})));

        beforeEach(() => mockLogsViewer.mockClear());

        test("the logs of the heartbeats of all the nodes merged, in place of the streams", () => {
            mockHeartbeatStore(THREE_NODES());
            renderWithRouter(<Heartbeats/>, {route: "/heartbeats?view=logs"});
            expect(screen.getByRole("tab", {name: "Logs"})).toHaveAttribute("aria-selected", "true");
            expect(screen.queryByRole("table")).toBeNull();
            expect(logsProps()).toMatchObject({type: "node", nodenames: ["n1", "n2", "n3"]});
            expect(logsProps().filters).toEqual(expect.arrayContaining(["PKG=daemon/hb", "PKG=daemon/hb/hbdisk", "PKG=daemon/hbctrl"]));
            // No selection across the tabs.
            expect(screen.queryByRole("group", {name: "Selection"})).toBeNull();
        });

        test("the changes only: the peer watchers of all the nodes", () => {
            mockHeartbeatStore(THREE_NODES());
            renderWithRouter(<Heartbeats/>, {route: "/heartbeats?view=logs"});
            fireEvent.click(screen.getByRole("checkbox", {name: "State changes only"}));
            expect(logsProps()).toMatchObject({nodenames: ["n1", "n2", "n3"], filters: ["PKG=daemon/hbctrl:peerWatch"]});
        });
    });

    test("a driver in the URL filters the streams", () => {
        mockHeartbeatStore(buildStatus([{node: "n1", streams: [
            {id: "hb#1.rx", state: "running", type: "unicast", peers: {n2: {is_beating: true, desc: "d"}}},
            {id: "hb#2.rx", state: "running", type: "disk", peers: {n2: {is_beating: true, desc: "d"}}},
        ]}]));
        renderWithRouter(<Heartbeats/>, {route: "/heartbeats?type=disk"});
        expect(getDataRows().map(streamOf)).toEqual(["2.rx"]);
    });

    test("renders table structure and basic heartbeat rows", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [
                {
                    id: "hb#1.rx", state: "running", type: "unicast",
                    peers: {peer1: {is_beating: true, desc: ":10011 ← peer1"}}
                },
                {
                    id: "hb#2.rx", state: "stopped", type: "unicast",
                    peers: {peer2: {is_beating: false, desc: ":10012 ← peer2"}}
                },
            ],
        }]));

        renderWithRouter(<Heartbeats/>);

        const table = screen.getByRole("table");
        expect(table).toBeInTheDocument();
        const headerRow = within(table).getByRole("row", {name: /Heartbeat Type Node Direction Peer Desc Routine Beating Since Last Beat/i});
        ["Heartbeat", "Type", "Node", "Direction", "Peer", "Desc", "Routine", "Beating", "Since", "Last Beat"].forEach(text =>
            expect(within(headerRow).getByText(text)).toBeInTheDocument()
        );

        ["Heartbeat", "Type", "Node", "Direction", "Peer", "Desc", "Routine", "Beating", "Since", "Last Beat"].forEach(name =>
            expect(within(headerRow).getByRole("button", {name})).toBeInTheDocument()
        );
        // Sorted by node, ascending, at first.
        expect(within(headerRow).getByRole("columnheader", {name: "Node"})).toHaveAttribute("aria-sort", "ascending");
        expect(within(headerRow).getByRole("columnheader", {name: "Heartbeat"})).toHaveAttribute("aria-sort", "none");

        const dataRows = getDataRows();
        expect(dataRows).toHaveLength(2);
        expect(streamOf(dataRows[0])).toBe("1.rx");
        expect(streamOf(dataRows[1])).toBe("2.rx");
        expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    });

    test("speaks French to a French browser", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state: "running", type: "unicast", peers: {}}],
        }]));
        await i18n.changeLanguage("fr");
        try {
            renderWithRouter(<Heartbeats/>);
            expect(screen.getByRole("columnheader", {name: "Dernier battement"})).toBeInTheDocument();
            expect(screen.getByText("Aucun heartbeat ne correspond aux filtres actuels.")).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage("en");
        }
    });

    // ==================== STATE ICONS ====================
    test.each([
        ["running", "started", "up", "text-ink"],
        ["warning", "warning", "warn", "text-state-warn"],
        ["stopped", "stopped", "down", "text-state-down"],
        ["failed", "failed", "down", "text-state-down"],
        ["unknown", "unknown", "unknown", "text-state-unknown"],
        ["invalid-state", "invalid-state", "unknown", "text-state-unknown"],
    ])("renders the %s routine as %s in the %s tint", async (state, word, status, ink) => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state, type: "unicast", peers: {p: {is_beating: true, desc: "d"}}}],
        }]));
        renderWithRouter(<Heartbeats/>);
        const stateCell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[6];
        const mark = within(stateCell).getByText(word);
        expect(mark).toHaveAttribute("data-state", status);
        expect(mark).toHaveClass(ink);
    });

    test("keeps the dates on one line", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running", type: "unicast",
                peers: {p: {is_beating: true, desc: "d", changed_at: "2025-06-03T04:25:31+00:00", last_beating_at: "2025-06-03T04:25:32+00:00"}},
            }],
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[8]).toHaveClass("whitespace-nowrap");
        expect(cells[9]).toHaveClass("whitespace-nowrap");
    });

    // ==================== BEATING ICON ====================
    test("renders the down status dot for a stale heartbeat in multi-node", async () => {
        mockHeartbeatStore(buildStatus([
            {
                node: "node1",
                streams: [{
                    id: "hb#1.rx", state: "running", type: "unicast",
                    peers: {peer1: {is_beating: false, desc: "desc1"}}
                }]
            },
            {
                node: "node2",
                streams: [{
                    id: "hb#2.rx", state: "running", type: "unicast",
                    peers: {peer2: {is_beating: true, desc: "desc2"}}
                }]
            }
        ]));
        renderWithRouter(<Heartbeats/>);
        const rows = getDataRows();
        const staleRow = rows.find(row => streamOf(row) === "1.rx");
        expect(staleRow).toBeInTheDocument();
        const beatingCell = within(staleRow).getAllByRole("cell")[7];
        const mark = within(beatingCell).getByText("Stale");
        expect(mark).toHaveAttribute("data-state", "down");
        expect(mark).toHaveClass("text-state-down");
        const beatingRow = rows.find(row => streamOf(row) === "2.rx");
        expect(within(within(beatingRow).getAllByRole("cell")[7]).getByText("Beating"))
            .toHaveAttribute("data-state", "up");
    });

    test("single node always shows healthy beating icon", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running", type: "unicast",
                peers: {
                    peer1: {
                        is_beating: false, desc: ":10011 ← peer1",
                        changed_at: "2025-06-03T04:25:31+00:00",
                        last_beating_at: "2025-06-03T04:25:31+00:00"
                    }
                }
            }]
        }]));
        renderWithRouter(<Heartbeats/>);
        const beatingCell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[7];
        const mark = within(beatingCell).getByText("Healthy (single node)");
        expect(mark).toHaveAttribute("data-state", "up");
    });

    // ==================== FILTERS FROM URL ====================
    const filterStreams = [
        {
            id: "hb#1.rx", state: "running", type: "unicast",
            peers: {
                peer1: {
                    is_beating: true, desc: ":10011 ← peer1",
                    changed_at: "2025-06-03T04:25:31+00:00",
                    last_beating_at: "2025-06-03T04:25:31+00:00"
                }
            }
        },
        {
            id: "hb#2.rx", state: "stopped", type: "unicast",
            peers: {
                peer2: {
                    is_beating: false, desc: ":10012 ← peer2",
                    changed_at: "2025-06-03T04:25:31+00:00",
                    last_beating_at: "2025-06-03T04:25:31+00:00"
                }
            }
        },
    ];

    test.each([
        ["/?status=stale", 1, "2.rx"],
        ["/?status=beating", 1, "1.rx"],
        ["/?node=node1", 2, "1.rx"],
        ["/?state=stopped", 1, "2.rx"],
        ["/?id=1.rx", 1, "1.rx"],
        ["/?id=hb%231.rx", 1, "1.rx"],
        ["/?id=3.tx", 0, null],
    ])("filter from URL %s", async (route, expectedLength, expectedText) => {
        mockHeartbeatStore(buildStatus([{node: "node1", streams: filterStreams}]));
        renderWithRouter(<Heartbeats/>, {route});

        const dataRows = getDataRows();
        expect(dataRows).toHaveLength(expectedLength);
        if (expectedText) {
            expect(streamOf(dataRows[0])).toBe(expectedText);
        } else {
            expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
        }
    });

    test("filter by id with .tx suffix", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#3.tx", state: "running", type: "unicast",
                peers: {
                    peer3: {
                        is_beating: true, desc: ":10013 ← peer3",
                        changed_at: "2025-06-03T04:25:31+00:00",
                        last_beating_at: "2025-06-03T04:25:31+00:00"
                    }
                }
            }]
        }]));
        renderWithRouter(<Heartbeats/>, {route: "/?id=3.tx"});
        expect(getDataRows()).toHaveLength(1);
        expect(getDataRows().map(streamOf)).toContain("3.tx");
    });

    test("filter by id without hb# prefix and without rx/tx suffix", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#5.rx", state: "running", type: "unicast",
                peers: {p: {is_beating: true, desc: "d", changed_at: "t", last_beating_at: "t"}}
            }]
        }]));
        renderWithRouter(<Heartbeats/>, {route: "/?id=5"});
        expect(getDataRows()).toHaveLength(1);
        expect(getDataRows().map(streamOf)).toContain("5.rx");
    });

    test("invalid status defaults to all", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running", type: "unicast",
                peers: {
                    peer1: {
                        is_beating: true, desc: ":10011 ← peer1",
                        changed_at: "2025-06-03T04:25:31+00:00",
                        last_beating_at: "2025-06-03T04:25:31+00:00"
                    }
                }
            }]
        }]));
        renderWithRouter(<Heartbeats/>, {route: "/?status=invalid"});
        await waitFor(() => expect(getDataRows().map(streamOf)).toContain("1.rx"));
    });

    test("does not update URL if filter unchanged", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state: "running", peers: {}, type: "t"}]
        }]));
        renderWithRouter(<Heartbeats/>, {route: "/?node=node1"});
        await waitFor(() => {
        }, {timeout: 500});
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    test("updates URL and rows when node filter changes", async () => {
        const user = userEvent.setup();
        mockHeartbeatStore(buildStatus([
            {
                node: "node1",
                streams: [{
                    id: "hb#1.rx", state: "running", type: "unicast",
                    peers: {peer1: {is_beating: true, desc: "desc1"}}
                }]
            },
            {
                node: "node2",
                streams: [{
                    id: "hb#2.rx", state: "running", type: "unicast",
                    peers: {peer2: {is_beating: true, desc: "desc2"}}
                }]
            }
        ]));
        renderWithRouter(<Heartbeats/>);

        expect(getDataRows()).toHaveLength(2);
        await selectFilterOption(user, "node", "node2");

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith("/?view=data&node=node2", {replace: true});
        }, {timeout: 1500});

        const rows = getDataRows();
        expect(rows).toHaveLength(1);
        expect(streamOf(rows[0])).toBe("2.rx");
    });

    test("changes state filter via UI and updates URL", async () => {
        const user = userEvent.setup();
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [
                {id: "hb#1.rx", state: "running", type: "t", peers: {p1: {is_beating: true, desc: "d1"}}},
                {id: "hb#2.rx", state: "stopped", type: "t", peers: {p2: {is_beating: false, desc: "d2"}}}
            ]
        }]));
        renderWithRouter(<Heartbeats/>);

        await selectFilterOption(user, "running", "stopped");

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith("/?view=data&state=stopped", {replace: true});
        }, {timeout: 1500});
    });

    test("changes beating filter via UI and updates URL", async () => {
        const user = userEvent.setup();
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [
                {id: "hb#1.rx", state: "running", type: "t", peers: {p1: {is_beating: true, desc: "d1"}}},
                {id: "hb#2.rx", state: "running", type: "t", peers: {p2: {is_beating: false, desc: "d2"}}}
            ]
        }]));
        renderWithRouter(<Heartbeats/>);

        await selectFilterOption(user, "beating", "Beating");

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith("/?view=data&status=beating", {replace: true});
        }, {timeout: 1500});

        const rows = getDataRows();
        expect(rows).toHaveLength(1);
        expect(streamOf(rows[0])).toBe("1.rx");
    });

    test("changes id filter via UI and updates URL", async () => {
        const user = userEvent.setup();
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [
                {id: "hb#1.rx", state: "running", type: "t", peers: {p1: {is_beating: true, desc: "d1"}}},
                {id: "hb#2.rx", state: "running", type: "t", peers: {p2: {is_beating: true, desc: "d2"}}}
            ]
        }]));
        renderWithRouter(<Heartbeats/>);

        await selectFilterOption(user, "id", "2");

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith("/?view=data&id=2", {replace: true});
        }, {timeout: 1500});
    });

    test("clears URL when all filters are reset to all", async () => {
        const user = userEvent.setup();
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running", type: "t",
                peers: {p: {is_beating: true, desc: "d"}}
            }]
        }]));
        renderWithRouter(<Heartbeats/>, {route: "/?node=node1"});

        await selectFilterOption(user, "node", "All");

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith("/?view=data", {replace: true});
        }, {timeout: 1500});
    });

    test("multiple URL filters apply together", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [
                {id: "hb#1.rx", state: "running", type: "t", peers: {p1: {is_beating: true, desc: "d1"}}},
                {id: "hb#2.rx", state: "stopped", type: "t", peers: {p2: {is_beating: false, desc: "d2"}}}
            ]
        }]));
        renderWithRouter(<Heartbeats/>, {route: "/?status=beating&node=node1&state=running&id=1"});
        const rows = getDataRows();
        expect(rows).toHaveLength(1);
        expect(streamOf(rows[0])).toBe("1.rx");
    });

    // ==================== EDGE CASES: STOPPED STREAMS & CACHE ====================
    test("handles stopped stream with cached peers", async () => {
        const {initialStatus, stoppedStatus} = stoppedStreamWithCacheScenario();

        useEventStore.mockImplementation(selector => selector({heartbeatStatus: initialStatus}));
        const {rerender} = renderWithRouter(<Heartbeats/>);

        let cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[4]).toHaveTextContent("peer1");

        useEventStore.mockImplementation(selector => selector({heartbeatStatus: stoppedStatus}));
        rerender(<Heartbeats/>);
        await waitFor(() => {
            const updatedCells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
            expect(updatedCells[4]).toHaveTextContent("peer1");
            expect(updatedCells[5]).toHaveTextContent(":10011 ← peer1");
        }, {timeout: 2000});
    });

    test("displays N/A for stopped stream with no cached peers", async () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state: "stopped", type: "unicast", peers: {}}]
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[4]).toHaveTextContent("N/A");
        expect(cells[1]).toHaveTextContent("unicast");
        expect(cells[5]).toHaveTextContent("N/A");
        expect(cells[8]).toHaveTextContent(/^-$/);
        expect(cells[9]).toHaveTextContent(/^-$/);
    });

    test("stopped stream with no cache and null type falls back to N/A", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state: "stopped", type: null, peers: {}}]
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[1]).toHaveTextContent("N/A");
    });

    test("stopped stream with cached peer missing fields shows a dash in timestamp columns", async () => {
        const {initialStatus, stoppedStatus} = stoppedStreamWithCacheScenario({
            cachedPeer: {is_beating: true}, // no desc, no changed_at, no last_beating_at
        });

        useEventStore.mockImplementation(selector => selector({heartbeatStatus: initialStatus}));
        const {rerender} = renderWithRouter(<Heartbeats/>);
        useEventStore.mockImplementation(selector => selector({heartbeatStatus: stoppedStatus}));
        rerender(<Heartbeats/>);

        await waitFor(() => {
            const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
            expect(cells[5]).toHaveTextContent("N/A");
            expect(cells[8]).toHaveTextContent(/^-$/);
            expect(cells[9]).toHaveTextContent(/^-$/);
        }, {timeout: 2000});
    });

    test("stopped stream without peers field", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state: "stopped", type: "unicast"}]
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[4]).toHaveTextContent("N/A");
    });

    test("running stream without peers field produces no rows", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{id: "hb#1.rx", state: "running", type: "unicast"}]
        }]));
        renderWithRouter(<Heartbeats/>);
        expect(getDataRows()).toHaveLength(0);
        expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    });

    // ==================== EMPTY / MISSING DATA ====================
    test("handles empty or null streams", () => {
        mockHeartbeatStore({node1: {streams: []}, node2: {streams: null}});
        renderWithRouter(<Heartbeats/>);
        expect(getDataRows()).toHaveLength(0);
        expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    });

    test("shows message when no heartbeats match filters", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running",
                peers: {peer1: {is_beating: true, desc: "desc"}},
                type: "unicast"
            }]
        }]));
        renderWithRouter(<Heartbeats/>, {route: "/?node=nonexistent"});
        expect(screen.getByRole("cell", {name: EMPTY_MESSAGE})).toHaveAttribute("colspan", "10");
    });

    test("stream without state does not add empty entry to available states", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [
                {id: "hb#1.rx", type: "unicast", peers: {p: {is_beating: true, desc: "d"}}}
            ]
        }]));
        renderWithRouter(<Heartbeats/>);
        const options = within(getFilter("running")).getAllByRole("option");
        expect(options.map(o => o.value)).toEqual(["all"]);
    });

    test("stream with id 'all' is skipped by availableIds", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [
                {id: "all", state: "running", type: "unicast", peers: {p: {is_beating: true, desc: "d"}}},
                {id: "hb#1.rx", state: "running", type: "unicast", peers: {p: {is_beating: true, desc: "d"}}}
            ]
        }]));
        renderWithRouter(<Heartbeats/>);
        // The five filters, and the page size.
        expect(screen.getAllByRole("combobox")).toHaveLength(6);
        const ids = within(getFilter("id")).getAllByRole("option").map(o => o.value);
        expect(ids).toEqual(["all", "1"]);
    });

    test("empty string peer key shows N/A for peer", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running", type: "unicast",
                peers: {"": {is_beating: true, desc: "d", changed_at: "t", last_beating_at: "t"}}
            }]
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[4]).toHaveTextContent("N/A");
    });

    test("times show as the nodes table shows them: their age, the full date on hover", () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running", type: "unicast",
                peers: {peer1: {is_beating: true, changed_at: twoHoursAgo, last_beating_at: twoHoursAgo}}
            }]
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[8]).toHaveTextContent("2h ago");
        expect(within(cells[9]).getByText("2h ago")).toHaveAttribute("title", new Date(twoHoursAgo).toLocaleString(i18n.language));
    });

    test("peer without desc/changed_at/last_beating_at shows N/A", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx", state: "running", type: "unicast",
                peers: {peer1: {}}
            }]
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[5]).toHaveTextContent("N/A");
        expect(cells[8]).toHaveTextContent(/^-$/);
        expect(cells[9]).toHaveTextContent(/^-$/);
    });

    test("stream without type or state falls back to N/A and unknown", () => {
        mockHeartbeatStore(buildStatus([{
            node: "node1",
            streams: [{
                id: "hb#1.rx",
                peers: {peer1: {is_beating: true, desc: "d", changed_at: "t", last_beating_at: "t"}}
            }]
        }]));
        renderWithRouter(<Heartbeats/>);
        const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
        expect(cells[1]).toHaveTextContent("N/A");
        expect(within(cells[6]).getByText("unknown")).toHaveAttribute("data-state", "unknown");
    });

    // ==================== SORTING ====================
    const sortTestData = [
        ["id", "Heartbeat", "a.rx", "b.rx"],
        ["peer", "Peer", "a_peer", "b_peer"],
        ["type", "Type", "a_type", "b_type"],
        ["desc", "Desc", "a_desc", "b_desc"],
        ["changed_at", "Since", "2024-01-01", "2024-02-01"],
        ["last_beating_at", "Last Beat", "2024-01-01", "2024-02-01"],
    ];

    test.each(sortTestData)("sorts by %s column", async (key, headerText, ascValue, descValue) => {
        const status = {
            node1: {
                streams: [
                    {
                        id: key === "id" ? "hb#b.rx" : "hb#1.rx",
                        state: "running",
                        peers: {
                            [key === "peer" ? "b_peer" : "peer1"]: {
                                is_beating: true,
                                desc: key === "desc" ? "b_desc" : "desc1",
                                changed_at: key === "changed_at" ? "2024-02-01" : "2024-01-01",
                                last_beating_at: key === "last_beating_at" ? "2024-02-01" : "2024-01-01",
                            },
                        },
                        type: key === "type" ? "b_type" : "type1",
                    },
                    {
                        id: key === "id" ? "hb#a.rx" : "hb#2.rx",
                        state: "running",
                        peers: {
                            [key === "peer" ? "a_peer" : "peer2"]: {
                                is_beating: true,
                                desc: key === "desc" ? "a_desc" : "desc2",
                                changed_at: key === "changed_at" ? "2024-01-01" : "2024-01-02",
                                last_beating_at: key === "last_beating_at" ? "2024-01-01" : "2024-01-02",
                            },
                        },
                        type: key === "type" ? "a_type" : "type2",
                    },
                ],
            },
        };
        mockHeartbeatStore(status);
        renderWithRouter(<Heartbeats/>);
        // A time older than a week shows as its date, as the nodes table shows it.
        const shown = (v) => key.endsWith("_at") ? new Date(v).toLocaleDateString(i18n.language) : v;
        ascValue = shown(ascValue);
        descValue = shown(descValue);

        const header = screen.getByRole("button", {name: headerText});
        await userEvent.click(header);
        expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending");
        // The id is the heartbeat and the side of the row, in two cells.
        const shows = (row, value) => key === "id"
            ? expect(streamOf(row)).toBe(value)
            : expect(within(row).getByText(value)).toBeInTheDocument();
        let rows = getDataRows();
        shows(rows[0], ascValue);
        shows(rows[1], descValue);

        await userEvent.click(header);
        expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");
        rows = getDataRows();
        shows(rows[0], descValue);
        shows(rows[1], ascValue);
    });

    test("sorts by beating column", async () => {
        mockHeartbeatStore({
            node1: {
                streams: [
                    {id: "hb#1.rx", state: "running", peers: {peer1: {is_beating: true, desc: "desc1"}}, type: "type1"},
                    {
                        id: "hb#2.rx",
                        state: "running",
                        peers: {peer2: {is_beating: false, desc: "desc2"}},
                        type: "type2"
                    },
                ],
            },
        });
        renderWithRouter(<Heartbeats/>);

        const beatingHeader = screen.getByRole("button", {name: "Beating"});
        await userEvent.click(beatingHeader);
        let rows = getDataRows();
        expect(streamOf(rows[0])).toBe("2.rx");
        expect(streamOf(rows[1])).toBe("1.rx");

        await userEvent.click(beatingHeader);
        rows = getDataRows();
        expect(streamOf(rows[0])).toBe("1.rx");
        expect(streamOf(rows[1])).toBe("2.rx");
    });

    test("sorting by state column", async () => {
        const states = ["running", "warning", "stopped", "failed", "unknown"];
        const status = {
            node1: {
                streams: states.map((s, i) => ({
                    id: `hb#${i + 1}.rx`,
                    state: s,
                    peers: {peer: {is_beating: false, desc: `desc${i + 1}`}},
                    type: `type${i + 1}`,
                })),
            },
        };
        mockHeartbeatStore(status);
        renderWithRouter(<Heartbeats/>);

        const stateHeader = screen.getByRole("button", {name: "Routine"});
        await userEvent.click(stateHeader);
        let rows = getDataRows();
        ["5.rx", "4.rx", "3.rx", "2.rx", "1.rx"].forEach((id, idx) =>
            expect(streamOf(rows[idx])).toBe(id)
        );

        await userEvent.click(stateHeader);
        rows = getDataRows();
        ["1.rx", "2.rx", "3.rx", "4.rx", "5.rx"].forEach((id, idx) =>
            expect(streamOf(rows[idx])).toBe(id)
        );
    });

    test("sorting different column resets direction to asc", async () => {
        mockHeartbeatStore({
            node1: {
                streams: [
                    {id: "hb#b.rx", state: "running", peers: {p: {is_beating: true}}, type: "t"},
                    {id: "hb#a.rx", state: "running", peers: {p: {is_beating: true}}, type: "t"},
                ],
            },
        });
        renderWithRouter(<Heartbeats/>);

        const beatingHeader = screen.getByRole("button", {name: "Beating"});
        await userEvent.click(beatingHeader);
        await userEvent.click(beatingHeader);
        await userEvent.click(screen.getByRole("button", {name: "Heartbeat"}));
        const rows = getDataRows();
        expect(streamOf(rows[0])).toBe("a.rx");
    });

    test("third click on same header toggles direction back to ascending", async () => {
        mockHeartbeatStore({
            node1: {
                streams: [
                    {id: "hb#b.rx", state: "running", peers: {p: {is_beating: true}}, type: "t"},
                    {id: "hb#a.rx", state: "running", peers: {p: {is_beating: true}}, type: "t"},
                ],
            },
        });
        renderWithRouter(<Heartbeats/>);

        const idHeader = screen.getByRole("button", {name: "Heartbeat"});
        await userEvent.click(idHeader); // asc
        await userEvent.click(idHeader); // desc
        await userEvent.click(idHeader); // back to asc
        const rows = getDataRows();
        expect(streamOf(rows[0])).toBe("a.rx");
        expect(streamOf(rows[1])).toBe("b.rx");
    });

    test("sorts by node column", async () => {
        mockHeartbeatStore(buildStatus([
            {
                node: "nodeB",
                streams: [{id: "hb#1.rx", state: "running", type: "t", peers: {p: {is_beating: true, desc: "d"}}}]
            },
            {
                node: "nodeA",
                streams: [{id: "hb#2.rx", state: "running", type: "t", peers: {p: {is_beating: true, desc: "d"}}}]
            },
        ]));
        renderWithRouter(<Heartbeats/>);
        let rows = getDataRows();
        expect(within(rows[0]).getByText("nodeA")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", {name: "Node"}));
        rows = getDataRows();
        expect(within(rows[0]).getByText("nodeB")).toBeInTheDocument();
    });

    // ==================== MULTIPLE NODES & SINGLE NODE ====================
    test("handles multiple nodes and ordering", async () => {
        mockHeartbeatStore(buildStatus([
            {
                node: "nodeB",
                streams: [{
                    id: "hb#2.rx", state: "running", type: "unicast",
                    peers: {
                        peer2: {
                            is_beating: true, desc: ":10012 ← peer2",
                            changed_at: "2025-06-03T04:25:31+00:00",
                            last_beating_at: "2025-06-03T04:25:31+00:00"
                        }
                    }
                }]
            },
            {
                node: "nodeA",
                streams: [{
                    id: "hb#1.rx", state: "running", type: "unicast",
                    peers: {
                        peer1: {
                            is_beating: true, desc: ":10011 ← peer1",
                            changed_at: "2025-06-03T04:25:31+00:00",
                            last_beating_at: "2025-06-03T04:25:31+00:00"
                        }
                    }
                }]
            },
        ]));
        renderWithRouter(<Heartbeats/>);
        const dataRows = getDataRows();
        expect(dataRows).toHaveLength(2);
        expect(within(dataRows[0]).getByText("nodeA")).toBeInTheDocument();
        expect(within(dataRows[1]).getByText("nodeB")).toBeInTheDocument();
    });

    // ==================== AUTH & CLEANUP ====================
    test("initializes with auth token and cleans up on unmount", () => {
        mockHeartbeatStore({});
        const {unmount} = renderWithRouter(<Heartbeats/>);
        expect(mockLocalStorage.getItem).toHaveBeenCalledWith("authToken");
        expect(mockRetainEventReception).toHaveBeenCalledWith("valid-token", expect.any(Array));
        unmount();
        expect(mockReleaseEventReception).toHaveBeenCalled();
    });

    test("does not start event reception without auth token", () => {
        mockLocalStorage.getItem.mockReturnValue(null);
        mockHeartbeatStore({});
        renderWithRouter(<Heartbeats/>);
        expect(mockRetainEventReception).not.toHaveBeenCalled();
    });

    // ==================== MESH LINES AND STREAM ACTIONS ====================
    const TWO_NODES = () => buildStatus([
        {node: "n1", streams: [
            {id: "hb#1.tx", state: "running", type: "unicast", peers: {n2: {is_beating: true, desc: "→ n2"}}},
            {id: "hb#1.rx", state: "running", type: "unicast", peers: {n2: {is_beating: true, desc: "← n2"}}},
        ]},
        {node: "n2", streams: [
            {id: "hb#1.tx", state: "stopped", type: "unicast", peers: {n1: {is_beating: false, desc: "→ n1"}}},
            {id: "hb#1.rx", state: "running", type: "unicast", peers: {n1: {is_beating: true, desc: "← n1"}}},
        ]},
    ]);

    /** A status with a stream of a node changed, as the events bring it. */
    const withStream = (status, node, id, change) => ({
        ...status,
        [node]: {...status[node], streams: status[node].streams.map((s) => (s.id === id ? {...s, ...change} : s))},
    });

    /** The API: whoami saying the grants given, the stream actions answered ok. */
    const mockApi = (grant) => {
        clearGrants();
        const calls = [];
        global.fetch = vi.fn(async (url, options = {}) => {
            calls.push({url, method: options.method ?? "GET"});
            if (url === "/api/auth/whoami") return {ok: true, json: async () => ({grant})};
            return {ok: true, json: async () => ({})};
        });
        return calls;
    };

    test("a line of the mesh clicked filters nothing: the streams all of them, no selection", async () => {
        mockApi({});
        mockHeartbeatStore(TWO_NODES());
        const {container} = renderWithRouter(<Heartbeats/>, {overview: true});
        fireEvent.click(container.querySelector('[data-group="n1 n2"] [data-hover="tx"]'));
        // Its details kept in the Streams box only.
        expect(screen.getByRole("region", {name: "Streams"})).toHaveTextContent("Seen from n1, outgoing to n2");
        expect(screen.queryByRole("group", {name: "Selection"})).toBeNull();
        showTab("Data");
        expect(getDataRows()).toHaveLength(4);
        expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining("link="), expect.anything());
    });

    test("root stops a routine started, starts one stopped, by clicking its card, confirmed first, by the API of the daemon thread", async () => {
        const calls = mockApi({root: null});
        mockHeartbeatStore(TWO_NODES());
        renderWithRouter(<Heartbeats/>, {overview: true});
        const boxes = () => document.querySelector("[data-boxes]");
        await waitFor(() => expect(within(boxes()).getByRole("button", {name: "Stop n1 hb#1 tx"})).toBeInTheDocument());
        // How to: a hint over the routines; the card itself the action, as its routine runs or not.
        expect(boxes().querySelector("[data-hint]")).toHaveTextContent("Click a routine to stop it, or to start it.");
        expect(within(boxes().querySelector('[data-card="n1 hb#1.tx"]')).getAllByRole("button").map((b) => b.dataset.action)).toEqual(["stop"]);
        expect(within(boxes().querySelector('[data-card="n2 hb#1.tx"]')).getAllByRole("button").map((b) => b.dataset.action)).toEqual(["start"]);
        // No selection: the names of the nodes no buttons; a heartbeat card its configuration only.
        expect(within(boxes().querySelector('[data-zone="n1"]')).queryAllByRole("button")).toHaveLength(0);
        expect(within(boxes().querySelector('[data-card="hb#1"]')).getAllByRole("button").map((b) => b.getAttribute("aria-label")))
            .toEqual(["Show the configuration of hb#1"]);
        // The table: no action, the routine a word, started in the ink of the text, stopped in the tint of down.
        showTab("Data");
        expect(within(screen.getByRole("table")).queryAllByRole("checkbox")).toHaveLength(0);
        expect(within(screen.getByRole("table")).queryAllByRole("button", {name: /Stop|Start/})).toHaveLength(0);
        const row = (id, node) => getDataRows().find((r) => {
            const cells = within(r).getAllByRole("cell").map((c) => c.textContent);
            return `${cells[0].replace(/^hb#/, "")}.${sideOf(cells)}` === id && cells[2] === node;
        });
        expect(within(row("1.tx", "n1")).getAllByRole("cell")[6].firstElementChild).toHaveClass("text-ink");
        expect(within(row("1.tx", "n2")).getAllByRole("cell")[6]).toHaveTextContent(/^stopped$/);
        expect(within(row("1.tx", "n2")).getAllByRole("cell")[6].firstElementChild).toHaveClass("text-state-down");
        expect(within(row("1.tx", "n1")).getAllByRole("cell")[3]).toHaveTextContent(/^sends to$/);
        expect(within(row("1.rx", "n1")).getAllByRole("cell")[3]).toHaveTextContent(/^receives from$/);
        showTab("Overview");

        // Started: the stop, confirmed; the dialog names a stream as om does, "1.tx".
        fireEvent.click(within(boxes()).getByRole("button", {name: "Stop n1 hb#1 tx"}));
        const stop = screen.getByRole("dialog", {name: "Stop a heartbeat stream"});
        expect(stop).toHaveTextContent("Stop the 1.tx stream of n1?");
        expect(calls.some((c) => c.method === "POST")).toBe(false);
        fireEvent.click(within(stop).getByRole("button", {name: "Stop"}));
        await waitFor(() => expect(calls).toContainEqual({url: "/api/node/name/n1/daemon/hb/name/1.tx/action/stop", method: "POST"}));
        // Queued by the daemon: followed in the actions tray until the stream is seen stopped.
        await waitFor(() => expect(tray()).toEqual([["Stop", "the 1.tx stream of n1", "running", null]]));
        expect(screen.queryByText(/requested/)).not.toBeInTheDocument();
        pushHeartbeatStatus(withStream(TWO_NODES(), "n1", "hb#1.tx", {state: "stopped"}));
        expect(tray()).toEqual([["Stop", "the 1.tx stream of n1", "succeeded", null]]);
        pushHeartbeatStatus(TWO_NODES());

        // Stopped: the start, confirmed too; cancelled, nothing asked.
        fireEvent.click(within(boxes()).getByRole("button", {name: "Start n2 hb#1 tx"}));
        let start = screen.getByRole("dialog", {name: "Start a heartbeat stream"});
        expect(start).toHaveTextContent("Start the 1.tx stream of n2?");
        fireEvent.click(within(start).getByRole("button", {name: "Cancel"}));
        expect(calls.some((c) => c.url.endsWith("/action/start"))).toBe(false);
        fireEvent.click(within(boxes()).getByRole("button", {name: "Start n2 hb#1 tx"}));
        start = screen.getByRole("dialog", {name: "Start a heartbeat stream"});
        fireEvent.click(within(start).getByRole("button", {name: "Start"}));
        await waitFor(() => expect(calls).toContainEqual({url: "/api/node/name/n2/daemon/hb/name/1.tx/action/start", method: "POST"}));
    });

    test("the card of a routine pulses while its request runs, then the outcome said in the actions tray", async () => {
        clearGrants();
        let answer;
        global.fetch = vi.fn((url) => {
            if (url === "/api/auth/whoami") return Promise.resolve({ok: true, json: async () => ({grant: {root: null}})});
            return new Promise((resolve) => {
                answer = resolve;
            });
        });
        mockHeartbeatStore(TWO_NODES());
        renderWithRouter(<Heartbeats/>, {overview: true});
        fireEvent.click(await screen.findByRole("button", {name: "Start n2 hb#1 tx"}));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Start"}));
        const card = document.querySelector('[data-card="n2 hb#1.tx"]');
        // Running: the card busy, pulsing, not to be clicked again.
        expect(card).toHaveAttribute("aria-busy", "true");
        expect(card).toHaveClass("animate-pulse");
        expect(within(card).getByRole("button")).toBeDisabled();
        // Refused: said in the actions tray with its reason, the card as before.
        await act(async () => answer({ok: false, status: 500, json: async () => ({detail: "boom"}), text: async () => "boom"}));
        await waitFor(() => expect(tray()).toEqual([["Start", "the 1.tx stream of n2", "refused", expect.stringContaining("boom")]]));
        expect(card).not.toHaveAttribute("aria-busy");
    });

    test("a heartbeat card clicked shows its configuration; root edits it with the wizard, or starts a new one from the light card", async () => {
        clearGrants();
        const calls = [];
        global.fetch = vi.fn(async (url, options = {}) => {
            calls.push({url, method: options.method ?? "GET"});
            if (url === "/api/auth/whoami") return {ok: true, json: async () => ({grant: {root: null}})};
            if (url.startsWith("/api/cluster/config/file")) return {ok: true, text: async () => "[hb#1]\ntype = unicast\nport = 10011\n"};
            return {ok: true, json: async () => ({items: []})};
        });
        mockHeartbeatStore(TWO_NODES());
        renderWithRouter(<Heartbeats/>, {overview: true});
        fireEvent.click(await screen.findByRole("button", {name: "Show the configuration of hb#1"}));
        const config = screen.getByRole("dialog", {name: "hb#1 configuration"});
        await waitFor(() => expect(config).toHaveTextContent("port = 10011"));
        // From there, the wizard seeded by it.
        fireEvent.click(within(config).getByRole("button", {name: "Edit with the wizard"}));
        expect(await screen.findByRole("dialog", {name: "Edit heartbeat hb#1"})).toBeInTheDocument();
        expect(await screen.findByRole("radio", {name: /^unicast/})).toBeChecked();
        fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
        // A new one: the light card after the heartbeats, the wizard blank.
        fireEvent.click(screen.getByRole("button", {name: "New heartbeat"}));
        expect(await screen.findByRole("dialog", {name: "New heartbeat hb#2"})).toBeInTheDocument();
        expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    });

    test("root deletes a heartbeat from its configuration only while another has all its streams up", async () => {
        clearGrants();
        const calls = [];
        global.fetch = vi.fn(async (url, options = {}) => {
            calls.push({url, method: options.method ?? "GET"});
            if (url === "/api/auth/whoami") return {ok: true, json: async () => ({grant: {root: null}})};
            if (url.startsWith("/api/cluster/config/file")) return {ok: true, text: async () => "[hb#1]\ntype = unicast\n\n[hb#2]\ntype = disk\ndev = /dev/sdb\n"};
            return {ok: true, json: async () => ({items: []})};
        });
        // hb#1 a stream stopped, hb#2 all up.
        mockHeartbeatStore(buildStatus([
            {node: "n1", streams: [
                {id: "hb#1.tx", state: "running", type: "unicast", peers: {n2: {is_beating: true, desc: "d"}}},
                {id: "hb#2.tx", state: "running", type: "disk", peers: {n2: {is_beating: true, desc: "d"}}},
            ]},
            {node: "n2", streams: [
                {id: "hb#1.rx", state: "stopped", type: "unicast", peers: {n1: {is_beating: false, desc: "d"}}},
                {id: "hb#2.rx", state: "running", type: "disk", peers: {n1: {is_beating: true, desc: "d"}}},
            ]},
        ]));
        renderWithRouter(<Heartbeats/>, {overview: true});
        // hb#1: hb#2 all up, its deletion offered.
        fireEvent.click(await screen.findByRole("button", {name: "Show the configuration of hb#1"}));
        await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("type = unicast"));
        fireEvent.click(screen.getByRole("button", {name: "Delete"}));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", {name: "Delete"}));
        // Done as the daemon answered: said in the actions tray.
        await waitFor(() => expect(tray()).toEqual([["Delete", "hb#1", "succeeded", null]]));
        expect(calls.filter((c) => c.method === "PATCH").map((c) => c.url)).toEqual(["/api/cluster/config?delete=hb%231"]);
        // hb#2: hb#1 not all up, not offered.
        fireEvent.click(screen.getByRole("button", {name: "Show the configuration of hb#2"}));
        await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("type = disk"));
        expect(screen.queryByRole("button", {name: "Delete"})).toBeNull();
        expect(screen.getByText("It may be deleted once another heartbeat has all its streams up.")).toBeInTheDocument();
    });

    test("not root: a heartbeat's configuration only, no wizard, no new one", async () => {
        clearGrants();
        const calls = [];
        global.fetch = vi.fn(async (url, options = {}) => {
            calls.push({url, method: options.method ?? "GET"});
            if (url === "/api/auth/whoami") return {ok: true, json: async () => ({grant: {}})};
            if (url.startsWith("/api/cluster/config/file")) return {ok: true, text: async () => "[hb#1]\ntype = unicast\n"};
            return {ok: true, json: async () => ({items: []})};
        });
        mockHeartbeatStore(TWO_NODES());
        renderWithRouter(<Heartbeats/>, {overview: true});
        await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/whoami")).toBe(true));
        expect(screen.queryByRole("button", {name: "New heartbeat"})).toBeNull();
        fireEvent.click(screen.getByRole("button", {name: "Show the configuration of hb#1"}));
        await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("type = unicast"));
        expect(screen.queryByRole("button", {name: "Edit with the wizard"})).toBeNull();
    });

    test("no actions for those who are not root", async () => {
        const calls = mockApi({});
        mockHeartbeatStore(TWO_NODES());
        renderWithRouter(<Heartbeats/>, {overview: true});
        await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/whoami")).toBe(true));
        expect(document.querySelector("[data-boxes]")).not.toBeNull();
        expect(screen.queryByRole("button", {name: /^(Start|Stop) n/})).toBeNull();
        expect(document.querySelector("[data-hint]")).toBeNull();
        expect(document.querySelector("[data-hint-icon]")).toBeNull();
    });

    test("a tool clearing all the filters of the streams, in their row, shown when there are some", () => {
        mockHeartbeatStore(TWO_NODES());
        renderWithRouter(<Heartbeats/>);
        expect(screen.queryByRole("button", {name: "Clear all filters"})).toBeNull();
        cleanup();
        renderWithRouter(<Heartbeats/>, {route: "/heartbeats?id=1&node=n1&state=running&status=beating"});
        expect(getDataRows()).toHaveLength(2);
        const clear = screen.getByRole("button", {name: "Clear all filters"});
        expect(clear.closest("#heartbeats-filters")).not.toBeNull();
        fireEvent.click(clear);
        expect(getFilter("node")).toHaveValue("all");
        expect(getFilter("id")).toHaveValue("all");
        expect(getDataRows()).toHaveLength(4);
        expect(screen.queryByRole("button", {name: "Clear all filters"})).toBeNull();
    });

    // ==================== PAGES ====================
    const makeManyStreams = (n = 50) => {
        const many = {};
        for (let i = 1; i <= n; i++) {
            many[`node${i}`] = {
                streams: [{
                    id: `hb#${i}.rx`, state: "running", type: "unicast",
                    peers: {
                        peer1: {
                            is_beating: true, desc: `desc${i}`,
                            changed_at: "2025-06-03T04:25:31+00:00",
                            last_beating_at: "2025-06-03T04:25:31+00:00"
                        }
                    },
                }],
            };
        }
        return many;
    };

    test("no stop nor start for a user who is not root", async () => {
        const calls = mockApi({admin: ["ns1"]});
        mockHeartbeatStore(TWO_NODES());
        renderWithRouter(<Heartbeats/>);
        await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/whoami")).toBe(true));
        await act(async () => {});
        expect(screen.queryByRole("button", {name: /Stop$/})).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: /Start$/})).not.toBeInTheDocument();
        // The routine as a word only.
        expect(screen.getAllByText("started").length).toBeGreaterThan(0);
    });

    // ==================== FOLDED STREAMS ====================
    test("pages the rows, 50 a page, as oc3 does: the next page, another size", () => {
        mockHeartbeatStore(makeManyStreams(60));
        renderWithRouter(<Heartbeats/>);
        expect(getDataRows()).toHaveLength(50);
        expect(screen.getByText("1–50 of 60")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", {name: "Next"}));
        expect(getDataRows()).toHaveLength(10);
        expect(screen.getByText("51–60 of 60")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Per page"), {target: {value: "25"}});
        expect(getDataRows()).toHaveLength(25);
        expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });

    test("a filter changed starts the list over from its first page, the page size kept", async () => {
        mockHeartbeatStore(makeManyStreams(60));
        renderWithRouter(<Heartbeats/>, {route: "/heartbeats?limit=25&offset=50"});
        expect(screen.getByText("51–60 of 60")).toBeInTheDocument();
        fireEvent.change(getFilter("running"), {target: {value: "running"}});
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/heartbeats?limit=25&view=data&state=running", {replace: true}));
    });

    // ==================== RESPONSIVE FILTERS ====================
    test.each([
        ["mobile", true, false, true, false],
        ["wide screen", false, true, false, true],
        ["desktop", false, false, false, true],
    ])("filter visibility on %s", async (_, isMobile, isWide, buttonExists, initiallyVisible) => {
        setMedia({mobile: isMobile, wide: isWide});
        mockHeartbeatStore({node1: {streams: []}});
        renderWithRouter(<Heartbeats/>);

        const filterButton = screen.queryByRole("button", {name: /filters/i});
        expect(!!filterButton).toBe(buttonExists);

        const nodeFilter = getFilter("node", {hidden: true});
        if (initiallyVisible) {
            expect(nodeFilter).toBeVisible();
        } else {
            expect(nodeFilter).not.toBeVisible();
            expect(filterButton).toHaveAttribute("aria-expanded", "false");
        }
    });

    test("mobile filter button toggles visibility", async () => {
        setMedia({mobile: true});
        mockHeartbeatStore({node1: {streams: []}});
        renderWithRouter(<Heartbeats/>);

        const filterButton = screen.getByRole("button", {name: "Show filters"});
        expect(filterButton).toHaveAttribute("aria-controls", "heartbeats-filters");
        expect(getFilter("node", {hidden: true})).not.toBeVisible();

        await userEvent.click(filterButton);
        expect(filterButton).toHaveAccessibleName("Hide filters");
        expect(filterButton).toHaveAttribute("aria-expanded", "true");
        expect(getFilter("node")).toBeVisible();

        await userEvent.click(filterButton);
        expect(filterButton).toHaveAccessibleName("Show filters");
        expect(getFilter("node", {hidden: true})).not.toBeVisible();
    });
});
