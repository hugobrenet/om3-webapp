import React from "react";
import {useTranslation} from "react-i18next";
import {CrossLink} from "../app/CrossLink";
import {instanceId, resourceId} from "../app/peek";
import {usePeek} from "../app/panel-search";
import {mayOpenSession, sessionKinds} from "../app/resource-sessions";
import {useGrants} from "../hooks/useGrants";
import useEventStore from "../hooks/useEventStore.js";
import {IconButton} from "../ui/components/Button";
import {DisplayIcon, TerminalIcon} from "../ui/icons";

/**
 * The instance of an object on a node, as a badge opening its panel: "on <node>",
 * a node name alone reading as the node itself; `label` where the object says it.
 */
export const InstanceLink = ({path, node, label}) => {
    const {t} = useTranslation();
    return <CrossLink kind="instance" id={instanceId(path, node)}>{label ?? t("instance.on", {node})}</CrossLink>;
};

/** A resource of an object, as a badge opening its panel. */
export const ResourceLink = ({path, rid}) => <CrossLink kind="resource" id={resourceId(path, rid)}>{rid}</CrossLink>;

const SESSION_ICONS = {console: TerminalIcon, display: DisplayIcon};

/**
 * What a row of a resource offers to reach a session on it, for who may open one: a
 * small button a session, opening the panel of the resource on that tab, on `node`
 * when given. `type` when the row knows it, else read from the instances.
 */
export const ResourceSessionLinks = ({path, rid, node, type}) => {
    const {t} = useTranslation();
    const peek = usePeek();
    const grants = useGrants();
    const known = useEventStore((s) => Object.values(s.objectInstanceStatus?.[path] ?? {})
        .map((instance) => instance?.resources?.[rid]?.type).find(Boolean));
    if (!mayOpenSession(grants, path)) return null;
    return sessionKinds(rid, type ?? known).map((session) => {
        const Icon = SESSION_ICONS[session];
        return (
            <IconButton
                key={session}
                size="sm"
                label={t(`console.open.${session}`, {rid})}
                onClick={(event) => {
                    event.stopPropagation();
                    peek("resource", resourceId(path, rid, node), session);
                }}
            >
                <Icon className="h-3.5 w-3.5"/>
            </IconButton>
        );
    });
};
