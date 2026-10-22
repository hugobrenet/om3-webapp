import React from "react";
import {useTranslation} from "react-i18next";
import {CrossLink} from "../app/CrossLink";
import {instanceId, resourceId} from "../app/peek";

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
