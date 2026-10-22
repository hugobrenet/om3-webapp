import React from "react";
import {useTranslation} from "react-i18next";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import LogsViewer from "./LogsViewer";
import {OrchestrationLogsFilter} from "./OrchestrationLogsFilter";

/**
 * The logs of an object on the nodes given, merged in the order of their time as
 * `ox <path> logs` shows them: the nodes of its instances for the object or one of
 * its resources, its node for an instance. `filters`, the journal fields to match
 * (`RID=…` for a resource); `orchestration`, the logs of that orchestration only.
 */
export function ObjectLogs({path, nodes, filters = [], orchestration = null, onClearOrchestration}) {
    const {t} = useTranslation();
    const {namespace, kind, name} = parseObjectPath(path);
    if (nodes.length === 0) return <p className="py-4 text-center text-ink-muted">{t("panel.logs.noNode")}</p>;
    const matches = orchestration ? [...filters, `ORCHESTRATION_ID=${orchestration}`] : filters;
    return (
        <div className="flex h-[calc(100dvh-10rem)] flex-col gap-2">
            {onClearOrchestration && <OrchestrationLogsFilter id={orchestration} onClear={onClearOrchestration}/>}
            <div className="min-h-0 flex-1">
                <LogsViewer
                    key={`${nodes.join(",")}/${matches.join(",")}`}
                    nodenames={nodes}
                    type="instance"
                    namespace={namespace}
                    kind={kind}
                    instanceName={name}
                    height="100%"
                    filters={matches}
                />
            </div>
        </div>
    );
}
