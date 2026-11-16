import {useTranslation} from "react-i18next";
import {activityState, useAiActivity} from "../context/AiChatContext.js";
import {cn} from "../ui/cn";

/**
 * What the assistant does while no view shows it, at the end of its entry in the
 * menu: a dot, orange for an action waiting for the user, beating while a turn
 * runs, plain once it ended; its words for screen readers. Nothing otherwise.
 */
export default function AiActivityBadge() {
    const {t} = useTranslation();
    const state = activityState(useAiActivity());
    if (state === null) return null;
    const label = t(`ai.activity.${state}`);
    return (
        <span className="ml-auto flex items-center" title={label}>
            <span
                aria-hidden="true"
                className={cn(
                    "h-2 w-2 rounded-full",
                    state === "waiting" ? "bg-state-warn" : state === "answering" ? "animate-pulse bg-accent" : "bg-accent"
                )}
            />
            <span className="sr-only">{label}</span>
        </span>
    );
}
