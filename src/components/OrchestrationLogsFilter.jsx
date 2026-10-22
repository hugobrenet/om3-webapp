import React from "react";
import {useTranslation} from "react-i18next";
import {IconButton} from "../ui/components/Button";
import {CloseIcon} from "../ui/icons";

/** Says the logs shown are of one orchestration only, and shows them all again. */
export function OrchestrationLogsFilter({id, onClear}) {
    const {t} = useTranslation();
    if (!id) return null;
    return (
        <p className="flex items-center gap-2 text-ink-muted">
            <span>{t("orchestration.logsOf")}</span>
            <code className="font-mono text-data text-ink">{id}</code>
            <IconButton size="sm" label={t("orchestration.allLogs")} onClick={onClear}>
                <CloseIcon className="h-3.5 w-3.5"/>
            </IconButton>
        </p>
    );
}
