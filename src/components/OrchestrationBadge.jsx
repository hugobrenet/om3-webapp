import React from "react";
import {useTranslation} from "react-i18next";
import {MenuButton} from "../ui/components/MenuButton";
import {CloseIcon, FileIcon} from "../ui/icons";

const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

/** The orchestration of a monitor, if one runs: its global expect and its id. */
export const NO_ORCHESTRATION = {globalExpect: null, orchestrationId: null};
const NIL_ID = "00000000-0000-0000-0000-000000000000";

/** The orchestration the monitors say runs: the first that expects something. */
export function orchestrationOf(monitors) {
    for (const monitor of monitors) {
        const expect = monitor?.global_expect;
        if (expect && expect !== "none") {
            const id = monitor.orchestration_id;
            return {globalExpect: expect, orchestrationId: id && id !== NIL_ID ? id : null};
        }
    }
    return NO_ORCHESTRATION;
}

/**
 * The orchestration in progress, by what it expects (stopped, frozen…), in the
 * place of the abort action the menus no longer offer: its logs, or its abort.
 * Nothing while none runs.
 */
export function OrchestrationBadge({globalExpect, orchestrationId, onLogs, onAbort, disabled = false}) {
    const {t} = useTranslation();
    if (!globalExpect || globalExpect === "none") return null;
    const items = [
        ...(onLogs ? [{
            key: "logs",
            label: t("orchestration.logs"),
            icon: <span aria-hidden="true" className={ICON}><FileIcon/></span>,
            onSelect: () => onLogs(orchestrationId),
        }] : []),
        {
            key: "abort",
            label: t("orchestration.abort"),
            icon: <span aria-hidden="true" className={DANGER_ICON}><CloseIcon/></span>,
            disabled,
            onSelect: onAbort,
        },
    ];
    return (
        <MenuButton
            label={t("orchestration.label", {expect: globalExpect})}
            align="end"
            trigger={
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-accent"/>
                    {globalExpect}
                </span>
            }
            items={items}
        />
    );
}
