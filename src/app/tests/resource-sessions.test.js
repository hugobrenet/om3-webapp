import {describe, expect, test} from "vitest";
import {afterEach, vi} from "vitest";
import {isContainerResource, isRunning, markOpening, mayOpenSession, sessionKinds, sessionPage, takeOpening} from "../resource-sessions";

describe("the sessions of a resource", () => {
    test("a container has a console, a virtual machine a screen too, another resource none", () => {
        expect(sessionKinds("container#1", "container.docker")).toEqual(["console"]);
        expect(sessionKinds("container#1", "container.kvm")).toEqual(["console", "display"]);
        expect(sessionKinds("container#1", undefined)).toEqual(["console"]);
        expect(sessionKinds("app#1", "app.simple")).toEqual([]);
        expect(isContainerResource("disk#1", "disk.loop")).toBe(false);
    });

    test("opened by root, or an admin of the namespace or of all, as the api asks", () => {
        expect(mayOpenSession({root: null}, "prod/svc/web")).toBe(true);
        expect(mayOpenSession({admin: ["prod"]}, "prod/svc/web")).toBe(true);
        expect(mayOpenSession({admin: [""]}, "prod/svc/web")).toBe(true);
        expect(mayOpenSession({admin: null}, "prod/svc/web")).toBe(true);
        expect(mayOpenSession({admin: ["test"]}, "prod/svc/web")).toBe(false);
        expect(mayOpenSession({operator: ["prod"], guest: ["prod"]}, "prod/svc/web")).toBe(false);
        expect(mayOpenSession({}, "prod/svc/web")).toBe(false);
    });

    test("a container on a standby node runs", () => {
        expect(isRunning("up")).toBe(true);
        expect(isRunning("stdby up")).toBe(true);
        expect(isRunning("stdby down")).toBe(false);
        expect(isRunning("down")).toBe(false);
    });

    describe("a tab of its own", () => {
        afterEach(() => {
            localStorage.clear();
            vi.useRealTimers();
        });

        test("its page says all it needs, the node with it", () => {
            expect(sessionPage("display", {path: "prod/svc/web", rid: "container#1", node: "n1"}))
                .toBe("/session/display?path=prod%2Fsvc%2Fweb&rid=container%231&node=n1");
        });

        test("a click connects the tab it opens, once", () => {
            markOpening("?a");
            expect(takeOpening("?a")).toBe(true);
            expect(takeOpening("?a")).toBe(false);
        });

        test("a URL alone, another session, or a word gone stale connect nothing", () => {
            expect(takeOpening("?a")).toBe(false);
            markOpening("?a");
            expect(takeOpening("?b")).toBe(false);
            vi.useFakeTimers();
            markOpening("?a");
            vi.advanceTimersByTime(16000);
            expect(takeOpening("?a")).toBe(false);
        });
    });
});
