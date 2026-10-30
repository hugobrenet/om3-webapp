import React, {useCallback, useState} from "react";
import {useTranslation} from "react-i18next";
import {IconButton} from "../ui/components/Button";
import {RefreshIcon} from "../ui/icons";
import {ONE_RESOURCE_ACTIONS, INSTANCE_ACTIONS, OBJECT_ACTIONS, RESOURCE_ACTIONS} from "../constants/actions";
import {CrossLink} from "../app/CrossLink";
import ActionDialogManager from "./ActionDialogManager";
import ConsoleTerminal from "./ConsoleTerminal.jsx";
import ConsoleDisplay from "./ConsoleDisplay.jsx";
import {CLEAR_ACTION, postAction} from "./objectActions";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import useEventStore from "../hooks/useEventStore.js";

/** Icon of an action in a menu: the action icons are sized to the menu line. */
const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

export const actionIcon = ({icon, color}) => (
    <span aria-hidden="true" className={color === "red" ? DANGER_ICON : ICON}>{icon}</span>
);

/** Every action the dialogs may have to confirm. */
const SUPPORTED_ACTIONS = [...new Set([...OBJECT_ACTIONS, ...INSTANCE_ACTIONS, ...RESOURCE_ACTIONS, CLEAR_ACTION].map((a) => a.name))];

/**
 * The actions on the instances and resources of an object, as the status board
 * runs them: `ask` an action on its targets — one entry per node, with the
 * resources it runs on there as `rid` — confirmed first, then posted; what comes
 * of it, the actions tray says (postAction). A console opens a terminal on its
 * resource at once. `onDone` follows a run, to clear a selection. Render `dialogs`
 * once. A target of another object names it (`path`): the resources of many
 * objects acted on together; `names`, what they are, listed in the confirmation.
 */
export function useActionRunner(path) {
    const [pending, setPending] = useState(null);
    const [running, setRunning] = useState(false);
    const [consoleTarget, setConsoleTarget] = useState(null);
    const [displayTarget, setDisplayTarget] = useState(null);

    const ask = useCallback((action, {targets, subject, onDone, variant, names}) => {
        if (ONE_RESOURCE_ACTIONS.includes(action)) {
            const {namespace, kind, name} = parseObjectPath(targets[0].path ?? path);
            const open = action === "console" ? setConsoleTarget : setDisplayTarget;
            open({node: targets[0].node, namespace, kind, name, rid: targets[0].rid});
            return;
        }
        setPending({action, targets, subject, onDone, variant, names});
    }, [path]);

    // The nodes of the object, for the options naming one (stop --move-to).
    const scope = useEventStore((s) => s.objectStatus?.[path]?.scope);

    const run = useCallback(async (_action, options) => {
        if (pending === null) return;
        const {action, targets, onDone} = pending;
        setPending(null);
        setRunning(true);
        await Promise.all(targets.map(({path: of = path, node, rid}) => postAction({path: of, action, node, rid, options})));
        onDone?.();
        setRunning(false);
    }, [pending, path]);

    const dialogs = (
        <>
            <ActionDialogManager
                pendingAction={pending}
                handleConfirm={run}
                target={pending?.subject ?? ""}
                names={pending?.names}
                instances={pending?.targets?.some(({node}) => node !== undefined) ?? false}
                supportedActions={SUPPORTED_ACTIONS}
                nodes={scope ?? []}
                onClose={() => setPending(null)}
            />
            <ConsoleTerminal open={consoleTarget !== null} target={consoleTarget} onClose={() => setConsoleTarget(null)}/>
            <ConsoleDisplay open={displayTarget !== null} target={displayTarget} onClose={() => setDisplayTarget(null)}/>
        </>
    );
    return {ask, running, dialogs};
}

/**
 * Refreshes the status of the instances of an object on the nodes given, as `om
 * <path> instance status -r` does on each: no confirmation, it changes nothing but the
 * status, which the events then bring. Turning while asked; a node refusing, said.
 */
export function RefreshStatusButton({path, nodes}) {
    const {t} = useTranslation();
    const [refreshing, setRefreshing] = useState(false);
    const [failure, setFailure] = useState(null);
    if (nodes.length === 0) return null;
    const refresh = async () => {
        setRefreshing(true);
        setFailure(null);
        const results = await Promise.all(nodes.map((node) => postAction({path, action: "status", node})
            .catch((err) => ({detail: err.message}))));
        const failures = results
            .map((r, i) => (r === null ? null : `${nodes[i]}: ${r.status ? `HTTP ${r.status}` : ""}${r.detail ? ` ${r.detail}` : ""}`.trim()))
            .filter((r) => r !== null);
        setFailure(failures.length > 0 ? failures.join("; ") : null);
        setRefreshing(false);
    };
    return (
        <span className="inline-flex shrink-0 items-center gap-2">
            {failure && (
                <span role="alert" className="text-data text-state-down">{t("statusBoard.refreshFailed", {detail: failure})}</span>
            )}
            <IconButton
                label={nodes.length > 1 ? t("statusBoard.refreshAll") : t("statusBoard.refresh")}
                onClick={refresh}
                disabled={refreshing}
                aria-busy={refreshing || undefined}
            >
                <RefreshIcon className={refreshing ? "animate-spin" : undefined}/>
            </IconButton>
        </span>
    );
}

/** The objects the resources given name in `field`, once each, sorted. */
const pathsOf = (resources, field) => [...new Set(resources.flatMap((r) => r?.[field] ?? []))].sort((a, b) => a.localeCompare(b));

/** The datastores the resources given use — the cfg and sec objects they install from — once each, sorted. */
export const datastoresOf = (resources) => pathsOf(resources, "datastores");

/** The vol objects the resources given use — a volume resource, the one it is — once each, sorted. */
export const volumesOf = (resources) => pathsOf(resources, "volumes");

/** Objects, the datastores or the volumes of resources, a badge each opening its object panel. */
export function DatastoreLinks({paths}) {
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {paths.map((p) => <CrossLink key={p} kind="object" id={p}>{p}</CrossLink>)}
        </span>
    );
}
