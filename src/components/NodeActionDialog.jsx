import React, {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Checkbox} from "../ui/components/Field";
import {Dialog} from "../ui/components/Dialog";
import {nodeAction, nodeActionKey} from "../app/node-actions";

/**
 * The confirmation of an action on nodes: what it does; for a harmful one, what it
 * costs, in a warning, and a box to tick saying it is understood before it may go.
 * `pending`, the action asked, or null; `target`, the nodes it is asked on, in words.
 */
export function NodeActionDialog({pending, target, onConfirm, onClose}) {
    const {t} = useTranslation();
    const [understood, setUnderstood] = useState(false);
    useEffect(() => setUnderstood(false), [pending?.action]);
    if (!pending) return null;
    const action = nodeAction(pending.action);
    const key = nodeActionKey(pending.action);
    const harmful = action?.color === "red";
    const label = t(`nodeActions.${key}.label`);
    return (
        <Dialog
            open
            title={t("nodeActions.confirmTitle", {label, target})}
            onClose={onClose}
            footer={(
                <>
                    <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button
                        variant={pending.action === "leave" ? "delete" : "secondary"}
                        disabled={harmful && !understood}
                        onClick={() => onConfirm(pending.action)}
                    >
                        {label}
                    </Button>
                </>
            )}
        >
            <div className="space-y-3">
                <p>{t(`nodeActions.${key}.description`)}</p>
                {harmful && (
                    <>
                        <Alert tone="warning">{t(`nodeActions.${key}.warning`)}</Alert>
                        <Checkbox
                            label={t("nodeActions.understood")}
                            checked={understood}
                            onChange={(event) => setUnderstood(event.target.checked)}
                        />
                    </>
                )}
            </div>
        </Dialog>
    );
}
