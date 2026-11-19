import React, {useCallback, useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {forceFlush} from "../eventSourceManager";
import logger from "../utils/logger.js";
import {isActionAllowedForSelection, parseObjectPath} from "../utils/objectUtils";
import {KEY_KINDS, OBJECT_ACTIONS, actionLabel, isKeyKindAction} from "../constants/actions";
import {trackRefused, trackResponse} from "../app/action-tracker";
import {actionRequest, refusalReason} from "./objectActions";
import {getResponseErrorMessage} from "../services/api.jsx";
import ActionDialogManager from "./ActionDialogManager";
import {Alert} from "../ui/components/Alert";
import {IconButton} from "../ui/components/Button";
import {CloseIcon} from "../ui/icons";
import {explainedItems} from "../app/action-menu";
import {pacedFetch} from "../services/paced-fetch.js";

/** How long a feedback message stays, as the snackbar it replaces. */
const FEEDBACK_DURATION_MS = 4000;

/** Feedback tones, from the severities of the snackbar it replaces. */
const TONES = {info: "info", success: "success", warning: "warning", error: "error"};

/** Icons of the action menus, the destructive ones in the down colour. */
const ACTION_ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ACTION_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

const actionIcon = ({icon, color}) => (
    <span aria-hidden="true" className={color === "red" ? DANGER_ACTION_ICON : ACTION_ICON}>{icon}</span>
);

const selectObjectStatus = (state) => state.objectStatus;

/**
 * The objects acted on alone, never swept along with others by a select all or the
 * tick of a namespace: the cluster object, acted on as the cluster, on all the nodes;
 * a namespace configuration, its row not shown, its namespace's panel acting on it.
 */
const isAlone = (objectName) => ["ccfg", "nscfg"].includes(parseObjectPath(objectName).kind);

/** The objects an action on a selection goes to: those acted on alone only when they are the whole of it. */
const actedOn = (objects) => objects.length > 1 ? objects.filter((obj) => !isAlone(obj)) : objects;

/** Whether an object takes the action: its kind does (a vol no switch, a cfg no start). */
const takes = (objectName, action) => isActionAllowedForSelection(action, [objectName]);

/** How often the changes an action on a selection makes to the page are applied, gathered. */
export const APPLY_EVERY_MS = 250;

/**
 * What an action on a selection changes at once in what the page shows, before the
 * daemon says it: an object deleted dropped, one frozen or thawed marked so. Gathered,
 * applied together every APPLY_EVERY_MS and at the end (`apply`): applied as each
 * answer came, hundreds of answers arriving together drew the list as many times in
 * a row, React taking it for an update loop (#185) and the object whose answer it
 * was said refused, deleted all the same.
 */
function pageChanges() {
    const deleted = [];
    const frozen = new Map();
    let timer = null;
    const apply = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        try {
            const store = useEventStore.getState();
            const marked = [...frozen].filter(([name]) => store.objectStatus[name]);
            frozen.clear();
            if (marked.length > 0) {
                const next = {...store.objectStatus};
                for (const [name, value] of marked) next[name] = {...next[name], frozen: value};
                store.setObjectStatuses(next);
            }
            if (deleted.length > 0) store.removeObjects(deleted.splice(0));
        } catch (error) {
            // What the page shows ahead of the daemon only: its events say it all the same.
            logger.error("Failed to show the outcome of an action on the selection:", error);
        }
    };
    const later = () => {
        if (timer === null) timer = setTimeout(apply, APPLY_EVERY_MS);
    };
    return {
        deleted: (objectName) => {
            deleted.push(objectName);
            later();
        },
        frozen: (objectName, value) => {
            frozen.set(objectName, value);
            later();
        },
        apply,
    };
}

/**
 * The actions on the objects selected in a list, as the Objects page offers them:
 * the items of its Actions menu, the dialog confirming the one chosen, and the
 * feedback strip saying how it went. Shared by the Objects page and the object
 * lists of a namespace panel. `onDone` clears the selection once an action ran;
 * `notify` lets the list say something of its own in the same strip.
 */
export function useObjectBulkActions({selectedObjects, onDone}) {
    const {t} = useTranslation();
    const objectStatus = useEventStore(selectObjectStatus);
    const [pendingAction, setPendingAction] = useState(null);
    const [snackbar, setSnackbar] = useState({open: false, message: "", severity: "info"});

    const notify = useCallback((message, severity = "info") => {
        setSnackbar({open: true, message, severity});
    }, []);
    const closeFeedback = useCallback(() => {
        setSnackbar((prev) => ({...prev, open: false}));
    }, []);

    // The feedback message hides itself after a while, as the snackbar did.
    useEffect(() => {
        if (!snackbar.open) return undefined;
        const timer = setTimeout(closeFeedback, FEEDBACK_DURATION_MS);
        return () => clearTimeout(timer);
    }, [snackbar, closeFeedback]);

    // The menus close themselves once an entry is chosen.
    const handleActionClick = useCallback((action) => {
        setPendingAction({action, target: null});
    }, []);

    const execute = useCallback(async (action, options) => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            notify(t("objects.feedback.authTokenNotFound"), "error");
            return;
        }
        // What comes of each object, accepted, refused or left alone, the actions tray says.
        const objectsToProcess = pendingAction?.target ? [pendingAction.target] : selectedObjects;
        // The selection let go as the action is confirmed, its dialog closing (ActionDialogManager):
        // not once the requests end, a burst on hundreds of objects lasting, the user meanwhile
        // ticking others and opening another dialog, both then lost.
        onDone?.();
        const refuse = (objectName, reason) => trackRefused({action, subject: objectName, reason});
        const selected = actedOn(objectsToProcess);
        objectsToProcess.filter((obj) => !selected.includes(obj))
            .forEach((obj) => refuse(obj, t("actionTray.reasons.clusterInSelection")));
        // Of a mixed selection, those of a kind the action is not for are left out, said so:
        // the menu offers an action some of them take, never sent to the others.
        const targets = selected.filter((obj) => takes(obj, action));
        selected.filter((obj) => !targets.includes(obj))
            .forEach((obj) => refuse(obj, t("actionTray.reasons.notForKind", {kind: parseObjectPath(obj).kind})));
        const changes = pageChanges();
        const promises = targets.map(async (objectName) => {
            const rawObj = objectStatus[objectName];
            if (!rawObj) {
                refuse(objectName, t("actionTray.reasons.unknownObject"));
                return;
            }
            if (action === "freeze" && rawObj.frozen === "frozen") {
                refuse(objectName, t("actionTray.reasons.alreadyFrozen"));
                return;
            }
            if (action === "unfreeze" && rawObj.frozen === "unfrozen") {
                refuse(objectName, t("actionTray.reasons.alreadyUnfrozen"));
                return;
            }
            const {url, body} = actionRequest({path: objectName, action, options});
            try {
                // Paced, refused for asking too often asked again: an action on hundreds of objects loses none.
                const response = await pacedFetch(url, {
                    method: "POST",
                    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
                    ...(body === undefined ? {} : {body}),
                });
                if (!response.ok) {
                    const detail = await getResponseErrorMessage(response);
                    logger.error(`Failed to execute ${action} on ${objectName}: HTTP ${response.status}`);
                    refuse(objectName, refusalReason({status: response.status, detail}));
                    return;
                }
                await trackResponse(response, {action, subject: objectName, path: objectName});
                if (action === "freeze") changes.frozen(objectName, "frozen");
                else if (action === "unfreeze") changes.frozen(objectName, "unfrozen");
                else if (action === "delete") changes.deleted(objectName);
            } catch (error) {
                logger.error(`Failed to execute ${action} on ${objectName}:`, error);
                refuse(objectName, error.message);
            }
        });
        await Promise.all(promises);
        changes.apply();

        forceFlush();
    }, [pendingAction, selectedObjects, objectStatus, notify, onDone, t]);

    // Kind-limited actions (svc-only enable / disable) are offered when the whole selection is of that kind.
    const items = useMemo(() => {
        const objects = actedOn(selectedObjects);
        const selectedKinds = new Set(objects.map((obj) => parseObjectPath(obj).kind));
        // Keys held on all the nodes are deleted, or the orchestration on them aborted: nothing else.
        const keysOnly = selectedKinds.size > 0 && [...selectedKinds].every((kind) => KEY_KINDS.includes(kind));
        const built = OBJECT_ACTIONS
            .filter((action) => !keysOnly || action.name === "abort"
                || [...selectedKinds].every((kind) => isKeyKindAction(kind, action.name)))
            .filter((action) => !action.kinds ||
                (selectedKinds.size > 0 && [...selectedKinds].every((kind) => action.kinds.includes(kind))))
            .map((action) => ({
                key: action.name,
                label: actionLabel(action.name),
                icon: actionIcon(action),
                disabled: !isActionAllowedForSelection(action.name, objects),
                onSelect: () => handleActionClick(action.name),
            }));
        return explainedItems(t, "object", built);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedObjects, handleActionClick, t]);

    const feedback = snackbar.open ? (
        <Alert
            tone={TONES[snackbar.severity] ?? "info"}
            className="shrink-0"
            action={
                <IconButton label={t("common.close")} onClick={closeFeedback}>
                    <CloseIcon className="h-4 w-4"/>
                </IconButton>
            }
        >
            {snackbar.message}
        </Alert>
    ) : null;

    // The objects the action goes to: those of a kind taking it, the others left out.
    const dialogNames = useMemo(() => actedOn(selectedObjects)
        .filter((obj) => !pendingAction || takes(obj, pendingAction.action)), [selectedObjects, pendingAction]);
    // The nodes of the objects acted on, for the options naming one (switch --to): a
    // node not one of an object's, the daemon refuses the action on that one.
    const dialogNodes = useMemo(() => {
        const objects = pendingAction?.target ? [pendingAction.target] : dialogNames;
        return [...new Set(objects.flatMap((obj) => objectStatus[obj]?.scope ?? []))];
    }, [pendingAction, dialogNames, objectStatus]);
    const dialog = (
        <ActionDialogManager
            pendingAction={pendingAction}
            handleConfirm={execute}
            target={pendingAction?.target
                ? t("objects.dialogTarget.object", {name: pendingAction.target})
                : t("objects.dialogTarget.objects", {count: dialogNames.length})}
            names={pendingAction?.target ? undefined : dialogNames}
            supportedActions={OBJECT_ACTIONS.map((action) => action.name)}
            nodes={dialogNodes}
            onClose={() => setPendingAction(null)}
        />
    );

    return {items, feedback, dialog, notify};
}
