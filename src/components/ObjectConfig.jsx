import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {Alert} from "../ui/components/Alert";
import {IconButton} from "../ui/components/Button";
import {CloseIcon} from "../ui/icons";
import ConfigSection from "./ConfigSection";

/** The feedback message hides itself after a while, as in the other views. */
const FEEDBACK_DURATION_MS = 5000;

const TONES = ["error", "warning", "info", "success"];

/**
 * The configuration of an object, in a tab of its panel: the file as a node holding
 * an instance has it, its tools in place (ConfigSection, inline), read again when
 * an event says it changed. `statusPath` is the key the cluster status lists the
 * object under, when it is not its path: "ns1/" for ns1/nscfg/namespace. `section`,
 * the section of a resource alone, shown and edited in place in the file. `absent`,
 * no configuration yet: created by the first change written.
 */
const ObjectConfig = ({path, statusPath = path, section = null, absent = false}) => {
    const {t} = useTranslation();
    const instances = useEventStore((s) => s.objectInstanceStatus?.[statusPath]);
    const configs = useEventStore((s) => s.instanceConfig?.[statusPath]);
    const nodes = useMemo(() => Object.keys(instances ?? {}).sort(), [instances]);
    const [configNode, setConfigNode] = useState(null);
    const [refresh, setRefresh] = useState(0);
    const [feedback, setFeedback] = useState(null);

    useEffect(() => {
        if (nodes.length > 0 && (configNode === null || !nodes.includes(configNode))) setConfigNode(nodes[0]);
    }, [nodes, configNode]);

    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        setRefresh((n) => n + 1);
    }, [configs]);

    useEffect(() => {
        if (feedback === null) return undefined;
        const timer = setTimeout(() => setFeedback(null), FEEDBACK_DURATION_MS);
        return () => clearTimeout(timer);
    }, [feedback]);

    const openSnackbar = useCallback((message, severity = "success") => {
        setFeedback({tone: TONES.includes(severity) ? severity : "info", message});
    }, []);

    return (
        <div className="space-y-3">
            {feedback !== null && (
                <Alert
                    tone={feedback.tone}
                    action={
                        <IconButton label={t("common.close")} onClick={() => setFeedback(null)}>
                            <CloseIcon className="h-4 w-4"/>
                        </IconButton>
                    }
                >
                    {feedback.message}
                </Alert>
            )}
            <ConfigSection
                decodedObjectName={path}
                configNode={configNode}
                setConfigNode={setConfigNode}
                openSnackbar={openSnackbar}
                configDialogOpen
                setConfigDialogOpen={() => {}}
                configRefreshTrigger={refresh}
                inline
                section={section}
                absent={absent}
            />
        </div>
    );
};

export default ObjectConfig;
