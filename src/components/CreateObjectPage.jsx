import React, {useEffect, useMemo} from "react";
import {useLocation, useNavigate, useSearchParams} from "react-router-dom";
import CreateObject from "./CreateObject";
import useEventStore from "../hooks/useEventStore.js";
import {retainEventReception} from "../eventSourceManager";
import {extractNamespace, parseObjectPath} from "../utils/objectUtils.jsx";
import {ALL_LIST, OBJECT_LISTS, listOfKind} from "../utils/objectLists";
import {CREATABLE_KINDS} from "../app/object-create";

const STEPS = ["what", "from", "configure"];

/** Where the page was opened from, kept with its draft: Cancel goes back there. */
const fromKey = (draft) => `om3-webapp.create.${draft}.from`;

const readFrom = (draft) => {
    try {
        return sessionStorage.getItem(fromKey(draft));
    } catch {
        return null;
    }
};

const newDraftId = () => Math.random().toString(36).slice(2, 10);

/**
 * A new object, created on a page of its own (`/create`) rather than over the list:
 * the width of the window for its design, a new tab for it beside the objects it is
 * compared with or copied from. Its address says where it starts (`ns`, `kind`), the
 * step it is at (`step`, the Back button going back a step) and its draft (`draft`):
 * a reload finds the draft of the tab again, another "New object" starts its own.
 * Created, the object opens in its panel, in the list of its kind; cancelled, the
 * page goes back where it was opened from.
 */
export default function CreateObjectPage() {
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const draft = params.get("draft");

    // A draft of its own, named in the address so that a reload finds it.
    useEffect(() => {
        if (draft) return;
        const id = newDraftId();
        try {
            const from = location.state?.from;
            if (from) sessionStorage.setItem(fromKey(id), from);
        } catch {
            // No storage: Cancel goes to the objects.
        }
        setParams((previous) => {
            const out = new URLSearchParams(previous);
            out.set("draft", id);
            return out;
        }, {replace: true});
    }, [draft, location.state, setParams]);

    // The objects of the cluster, as they come: the namespaces offered, the paths copied
    // from and refused, the instance a deployment waits for. Opened in a tab of its own,
    // the page holds the stream itself, released once left.
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const release = token ? retainEventReception(token) : null;
        return () => {
            release?.();
        };
    }, []);

    const objectStatus = useEventStore((s) => s.objectStatus);
    const paths = useMemo(
        () => Object.keys(objectStatus ?? {}).filter((key) => key && typeof objectStatus[key] === "object"),
        [objectStatus]
    );
    const namespaces = useMemo(() => [...new Set(paths.map(extractNamespace))].sort(), [paths]);

    const kindParam = params.get("kind");
    const defaultKind = CREATABLE_KINDS.includes(kindParam) ? kindParam : "svc";
    const defaultNamespace = params.get("ns") || "root";
    const stepParam = params.get("step");
    const step = STEPS.includes(stepParam) ? stepParam : "what";

    // A step a navigation of its own, the Back button undoing it; one corrected, replaced.
    const onStepChange = (next, {replace = false} = {}) => {
        setParams((previous) => {
            const out = new URLSearchParams(previous);
            if (next === "what") out.delete("step");
            else out.set("step", next);
            return out;
        }, {replace});
    };

    const leave = () => {
        const from = draft ? readFrom(draft) : null;
        try {
            if (draft) sessionStorage.removeItem(fromKey(draft));
        } catch {
            // Nothing kept to forget.
        }
        return from;
    };

    const onClose = () => navigate(leave() ?? "/objects");

    // Created: in its panel, over the list it was asked from (its filters kept) when it
    // lists it (All does), else over the list of its kind; a datastore on its keys, to
    // add them.
    const onCreated = (path) => {
        const from = leave();
        const {kind} = parseObjectPath(path);
        const back = from?.startsWith("/objects") ? new URL(from, window.location.origin) : null;
        const search = new URLSearchParams(back?.search ?? "");
        const asked = search.get("list") ?? OBJECT_LISTS[0];
        const list = asked === ALL_LIST ? ALL_LIST : listOfKind(kind);
        if (list !== asked) search.delete("kind");
        if (list === OBJECT_LISTS[0]) search.delete("list");
        else search.set("list", list);
        ["tab", "peek", "peektab", "full"].forEach((key) => search.delete(key));
        search.set("sel", path);
        if (kind === "cfg" || kind === "sec") search.set("tab", "keys");
        navigate(`/objects?${search.toString()}`, {replace: true});
    };

    if (!draft) return null;
    return (
        <CreateObject
            key={draft}
            draftKey={`om3-webapp.create.${draft}`}
            defaultKind={defaultKind}
            defaultNamespace={defaultNamespace}
            namespaces={namespaces}
            paths={paths}
            step={step}
            onStepChange={onStepChange}
            onClose={onClose}
            onCreated={onCreated}
        />
    );
}
