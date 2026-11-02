import {describe, expect, test} from "vitest";
import i18n from "../../i18n";
import {actionDescription, actionKeywords, explainedItems, explainedMenu, menuColumns} from "../action-menu";
import {NODE_ACTIONS} from "../../constants/actions";

const t = i18n.t.bind(i18n);
const items = (...names) => names.map((name) => ({key: name, label: name}));
const shape = (entries) => entries.map((e) => [e.key, e.heading ?? null, e.danger]);

describe("explained action menus", () => {
    test("the object actions by the grant om3 asks: operator, then admin, what each does said, the destructive ones red", () => {
        const out = explainedItems(t, "object", items("delete", "start", "freeze", "provision", "stop", "enable", "unprovision", "purge"));
        // Within a group, the order of the list.
        expect(shape(out)).toEqual([
            ["start", "Operator", false],
            ["stop", null, false],
            ["freeze", null, false],
            ["provision", "Admin", false],
            ["unprovision", null, true],
            ["enable", null, false],
            ["delete", null, true],
            ["purge", null, true],
        ]);
        expect(out[0].description).toBe("Ask the daemon to start it, on the nodes its placement elects.");
    });

    test("the instance actions by grant, the operator ones by what they act on; the clear of a failed monitor after unfreeze", () => {
        const out = explainedItems(t, "instance", items("clear", "start", "pg reset", "run", "unfreeze", "sync split", "prstop", "boot", "status"));
        expect(shape(out).map(([key, heading]) => [key, heading])).toEqual([
            ["start", "Operator · instance"],
            ["unfreeze", null],
            ["clear", null],
            ["status", null],
            ["prstop", "Operator · disk"],
            ["run", "Operator · task"],
            ["sync split", "Operator · sync"],
            ["boot", "Admin"],
            ["pg reset", "Admin · pg"],
        ]);
        expect(out.find((e) => e.key === "sync split").description).toBe("Make both ends of a replicated pair read-write.");
    });

    test("the resource actions: described, under the headings of the instance's; what the menu set itself kept", () => {
        const out = explainedItems(t, "resource", [
            {key: "sync update", label: "Sync update"},
            {key: "start", label: "Start"},
            {key: "restart", label: "Restart", description: "mine", danger: true},
            {key: "unprovision", label: "Unprovision"},
        ]);
        expect(out.map((e) => [e.key, e.heading])).toEqual([
            ["start", "Operator"],
            ["restart", undefined],
            ["sync update", "Operator · sync"],
            ["unprovision", "Admin"],
        ]);
        expect(out[0].description).toBe("Bring up the resources picked.");
        expect(out[1]).toMatchObject({description: "mine", danger: true});
        expect(out[2].description).toBe("Copy the changes of the resources picked to the peers.");
    });

    test("a variant of its words, for what it acts on; its plain words without one", () => {
        expect(actionDescription(t, "resource", "sync update", "Store")).toBe("Back up the changes of the resources picked into their store.");
        expect(actionDescription(t, "instance", "sync full", "Either")).toBe("Copy its whole datasets to the peers, or back them up into their stores.");
        expect(actionDescription(t, "resource", "start", "Store")).toBe("Bring up the resources picked.");
        expect(actionDescription(t, "resource", "sync update")).toBe("Copy the changes of the resources picked to the peers.");
    });

    test("the masonry: none for one group, two columns for a few, three for many", () => {
        expect(menuColumns(explainedItems(t, "object", items("delete", "purge")))).toBeUndefined();
        expect(explainedMenu(t, "object", items("start", "freeze", "delete")).columns).toBe(2);
        expect(explainedMenu(t, "instance", items("start", "prstart", "run", "sync full", "provision")).columns).toBe(3);
    });

    test("what an action costs, badged: data-loss, down-time", () => {
        const badges = (scope, name) => explainedItems(t, scope, items(name))[0].badges.map((b) => b.label);
        expect(badges("object", "purge")).toEqual(["data-loss", "down-time"]);
        expect(badges("object", "switch")).toEqual(["down-time"]);
        expect(badges("object", "delete")).toEqual([]);
        expect(badges("instance", "unprovision")).toEqual(["data-loss", "down-time"]);
        expect(badges("instance", "shutdown")).toEqual(["down-time"]);
        expect(badges("instance", "start")).toEqual([]);
        expect(explainedItems(t, "object", items("purge"))[0].badges[0].tone).toBe("down");
    });

    test("the names of an action as the API and om say them, for the filter", () => {
        const kw = (scope, name) => explainedItems(t, scope, items(name))[0].keywords;
        expect(kw("instance", "start standby")).toEqual(["start standby", "startstandby"]);
        expect(kw("instance", "sync update")).toEqual(["sync update", "update"]);
        expect(kw("instance", "pg reset")).toEqual(["pg reset"]);
        expect(kw("object", "enable")).toEqual(["enable"]);
        expect(kw("object", "start")).toEqual(["start"]);
        expect(kw("instance", "clear")).toEqual(["clear"]);
        const node = (name) => actionKeywords(NODE_ACTIONS.find((a) => a.name === name));
        expect(node("asset")).toEqual(["asset", "push asset"]);
        expect(node("scsi scan")).toEqual(["scsi scan"]);
        expect(node("restart daemon")).toEqual(["restart daemon", "daemon restart"]);
        expect(node("stop")).toEqual(["stop", "daemon stop"]);
        expect(node("evict")).toEqual(["evict"]);
    });

    test("an action without a word for it has no description", () => {
        expect(actionDescription(t, "object", "bogus")).toBeUndefined();
        expect(actionDescription(t, "instance", "start standby")).toBe("Activate the resources meant to stay up on a standby node.");
    });
});
