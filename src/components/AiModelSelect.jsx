import {useTranslation} from "react-i18next";
import {Select} from "../ui/components/Field";

/**
 * The choice of the model of the messages sent, among those the agent
 * offers, shown when it offers two or more and the user can run on one. A
 * model the user cannot run on is shown, not offered. The labels are the
 * operator's, shown as text. The choice stays open while a run streams: it
 * goes with the next message, or the one queued, the run keeping its model.
 */
export default function AiModelSelect({chat, disabled}) {
    const {t} = useTranslation();
    if (!chat.models || !chat.model) return null;
    return (
        <Select
            aria-label={t("ai.composer.model")}
            title={t("ai.composer.modelHint")}
            className="h-8 max-w-56 text-data"
            value={chat.model ?? ""}
            disabled={disabled}
            onChange={(event) => chat.selectModel(event.target.value)}
        >
            {chat.models.map((model) => (
                <option key={model.id} value={model.id} disabled={!model.ready}>
                    {model.label}
                </option>
            ))}
        </Select>
    );
}
