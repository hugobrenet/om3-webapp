import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
import useAiAvailable from "../hooks/useAiAvailable.js";
import {linkPrompt} from "../config/ai-agent.js";
import {SparklesIcon} from "../ui/icons";
import {useAiDock} from "../context/AiChatContext.js";

/**
 * Asks the assistant about the record on display, on a new conversation. Shown
 * only to a user who can use the assistant now.
 *
 * A plain click opens the dock, over the page on display, and sends the question
 * at once: the answer comes there, a turn the user stops as any. The link stays a
 * link to the page of the assistant, for a click with a modifier, the middle
 * button or the menu of the browser, which open the page as they would, the
 * question in the message box, not sent: one an address carries, which anyone
 * may write, never starts a turn alone.
 * `onClick`, what the caller does then, such as close its dialog: on a plain
 * click only, a click with a modifier leaving the page as it is.
 *
 * @param {{prompt: string, onClick?: () => void}} props
 */
export default function AskAssistantLink({prompt, onClick}) {
    const {t} = useTranslation();
    const available = useAiAvailable();
    const dock = useAiDock();
    const question = linkPrompt(prompt);
    if (!available || question === "") return null;
    return (
        <Link
            to={{pathname: "/ai", search: `?${new URLSearchParams({prompt: question})}`}}
            title={question}
            onClick={(event) => {
                if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                )
                    return;
                if (dock !== null) {
                    event.preventDefault();
                    dock.openWith(question, event.currentTarget);
                }
                onClick?.();
            }}
            className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-(--radius-control) border border-line px-2 text-ink-muted hover:border-line-strong hover:text-ink"
        >
            <SparklesIcon width={14} height={14} className="text-accent"/>
            {t("ai.ask")}
        </Link>
    );
}
