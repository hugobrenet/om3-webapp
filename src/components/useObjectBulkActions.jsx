import React, {useCallback, useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {forceFlush} from "../eventSourceManager";
import logger from "../utils/logger.js";
import {isActionAllowedForSelection, parseObjectPath} from "../utils/objectUtils";
import {KEY_KINDS, OBJECT_ACTIONS, actionLabel, isKeyKindAction} from "../constants/actions";
import {trackRefused, trackResponse} from "../app/action-tracker";
import {actionUrl, refusalReason} from "./objectActions";
import {getResponseErrorMessage} from "../services/api.jsx";
import ActionDialogManager from "./ActionDialogManager";
import {Alert} from "../ui/components/Alert";
import {IconButton} from "../ui/components/Button";
import {CloseIcon} from "../ui/icons";

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
const selectRemoveObject = (state) => state.removeObject;

/** The frozen state an action gives an object at once, before the daemon says it. */
const updateFrozenStatusOptimistic = (objectName, newFrozenValue) => {
    const store = useEventStore.getState();
    const currentStatus = store.objectStatus[objectName];
    if (currentStatus) {
        store.setObjectStatuses({
            ...store.objectStatus,
            [objectName]: {...currentStatus, frozen: newFrozenValue},
        });
    }
};

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
    const removeObject = useEventStore(selectRemoveObject);
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

    const execute = useCallback(async (action) => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            notify(t("objects.feedback.authTokenNotFound"), "error");
            return;
        }
        // What comes of each object, accepted, refused or left alone, the actions tray says.
        const objectsToProcess = pendingAction?.target ? [pendingAction.target] : selectedObjects;
        const refuse = (objectName, reason) => trackRefused({action, subject: objectName, reason});
        const promises = objectsToProcess.map(async (objectName) => {
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
            const url = actionUrl({path: objectName, action});
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
                });
                if (!response.ok) {
                    const detail = await getResponseErrorMessage(response);
                    logger.error(`Failed to execute ${action} on ${objectName}: HTTP ${response.status}`);
                    refuse(objectName, refusalReason({status: response.status, detail}));
                    return;
                }
                await trackResponse(response, {action, subject: objectName, path: objectName});
                if (action === "freeze") {
                    updateFrozenStatusOptimistic(objectName, "frozen");
                } else if (action === "unfreeze") {
                    updateFrozenStatusOptimistic(objectName, "unfrozen");
                } else if (action === "delete") {
                    removeObject(objectName);
                }
            } catch (error) {
                logger.error(`Failed to execute ${action} on ${objectName}:`, error);
                refuse(objectName, error.message);
            }
        });
        await Promise.all(promises);

        forceFlush();

        onDone?.();
        setPendingAction(null);
    }, [pendingAction, selectedObjects, objectStatus, removeObject, notify, onDone, t]);

    // Kind-limited actions (svc-only enable / disable) are offered when the whole selection is of that kind.
    const items = useMemo(() => {
        const selectedKinds = new Set(selectedObjects.map((obj) => parseObjectPath(obj).kind));
        // Keys held on all the nodes are deleted, or the orchestration on them aborted: nothing else.
        const keysOnly = selectedKinds.size > 0 && [...selectedKinds].every((kind) => KEY_KINDS.includes(kind));
        return OBJECT_ACTIONS
            .filter((action) => !keysOnly || action.name === "abort"
                || [...selectedKinds].every((kind) => isKeyKindAction(kind, action.name)))
            .filter((action) => !action.kinds ||
                (selectedKinds.size > 0 && [...selectedKinds].every((kind) => action.kinds.includes(kind))))
            .map((action) => ({
                key: action.name,
                label: actionLabel(action.name),
                icon: actionIcon(action),
                disabled: !isActionAllowedForSelection(action.name, selectedObjects),
                onSelect: () => handleActionClick(action.name),
            }));
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

    const dialog = (
        <ActionDialogManager
            pendingAction={pendingAction}
            handleConfirm={execute}
            target={pendingAction?.target
                ? t("objects.dialogTarget.object", {name: pendingAction.target})
                : t("objects.dialogTarget.objects", {count: selectedObjects.length})}
            names={pendingAction?.target ? undefined : selectedObjects}
            supportedActions={OBJECT_ACTIONS.map((action) => action.name)}
            onClose={() => setPendingAction(null)}
        />
    );

    return {items, feedback, dialog, notify};
}
