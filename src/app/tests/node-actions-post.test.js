import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {waitFor} from "@testing-library/react";
import {nodeActionRequest, postNodeAction} from "../node-actions";
import {useActionTracker} from "../action-tracker";

const answer = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    clone() {
        return answer(status, body);
    },
    headers: {get: () => "application/json"},
});

const tracked = () => useActionTracker.getState().tracked;

beforeEach(() => {
    useActionTracker.setState({tracked: []});
});

afterEach(() => {
    vi.restoreAllMocks();
    useActionTracker.setState({tracked: []});
});

describe("network setup", () => {
    test("posted to the network setup of the node", () => {
        expect(nodeActionRequest("dev2n1", "network setup").url).toMatch(/\/node\/name\/dev2n1\/network\/setup$/);
    });

    test("running in the tray from its request on, done by the 204 of the node", async () => {
        let reply;
        globalThis.fetch = vi.fn(() => new Promise((resolve) => {
            reply = resolve;
        }));
        const posted = postNodeAction("dev2n1", "network setup", {Authorization: "Bearer x"});
        expect(tracked()[0]).toMatchObject({action: "network setup", subject: "dev2n1", node: "dev2n1", state: "running"});
        // Sent on its turn (paced-fetch): a tick later.
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(url).toMatch(/\/network\/setup$/);
        expect(init).toMatchObject({method: "POST", headers: {Authorization: "Bearer x"}});
        reply(answer(204, null));
        await posted;
        expect(tracked()).toHaveLength(1);
        expect(tracked()[0]).toMatchObject({state: "succeeded"});
    });

    test("a server error after it ran is a failure, a wait run out unknown, a 403 refused", async () => {
        for (const [status, state] of [[500, "failed"], [408, "unknown"], [403, "refused"]]) {
            useActionTracker.setState({tracked: []});
            globalThis.fetch = vi.fn(() => Promise.resolve(answer(status, {detail: "nope"})));
            await postNodeAction("dev2n1", "network setup", {});
            await waitFor(() => {
                expect(tracked()[0]?.state).toBe(state);
            });
            expect(tracked()).toHaveLength(1);
            expect(tracked()[0].error).toMatch(new RegExp(`HTTP ${status}`));
        }
    });
});

describe("an action answered at once", () => {
    test("in the tray once answered, refused with its reason", async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(answer(403, {detail: "nope"})));
        await postNodeAction("dev2n1", "freeze", {});
        expect(tracked()[0]).toMatchObject({action: "freeze", state: "refused"});
    });
});
