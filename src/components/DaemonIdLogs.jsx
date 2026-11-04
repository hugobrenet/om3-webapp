import React from "react";
import {useTranslation} from "react-i18next";
import {CopyButton} from "../ui/components/CopyButton";
import {Dialog} from "../ui/components/Dialog";
import {useClusterNodes} from "../hooks/usePgUsage";
import LogsViewer from "./LogsViewer";

/** The journal field an id of each kind is logged under, as `om daemon <kind> logs` matches it. */
const LOG_KEY = {orchestration: "ORCHESTRATION_ID", exec: "EXEC_ID"};

/**
 * What was logged under one id the daemon ran something with, in a modal, as `om
 * daemon orchestration logs` and `om daemon exec logs` show it: an orchestration
 * on every node of the cluster, its steps taken wherever they were, merged in the
 * order of their time; an exec on its node, the one it ran on. `target`, the
 * `{kind, id, node, subject}` to show the logs of, null for none.
 */
export function DaemonIdLogs({target, onClose}) {
    const {t} = useTranslation();
    const clusterNodes = useClusterNodes();
    if (!target) return null;
    const nodes = target.kind === "orchestration" && clusterNodes.length > 0 ? clusterNodes : [target.node];
    const filter = `${LOG_KEY[target.kind]}=${target.id}`;
    return (
        <Dialog
            open
            size="xl"
            onClose={onClose}
            title={t(`nodeDaemon.logs.${target.kind}`, {id: target.id.slice(0, 8), subject: target.subject})}
        >
            <div className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 text-data text-ink-muted">
                    <span className="font-mono">{target.id}</span>
                    <CopyButton text={target.id} label={t("nodeDaemon.logs.copyId")}/>
                    <span>{t("nodeDaemon.logs.nodes", {count: nodes.length, nodes: nodes.join(", ")})}</span>
                </p>
                <LogsViewer
                    key={`${nodes.join(",")}/${filter}`}
                    nodenames={nodes}
                    type="node"
                    height="60dvh"
                    filters={[filter]}
                />
            </div>
        </Dialog>
    );
}
