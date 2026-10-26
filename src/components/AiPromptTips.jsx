import {useTranslation} from "react-i18next";

const TIPS = ["target", "goal", "scope", "symptom", "oneAction", "limits"];

/** How to word a request to the assistant: a few short tips. */
export default function AiPromptTips({className}) {
    const {t} = useTranslation();
    return (
        <ul aria-label={t("ai.tips.title")} className={className ?? "flex flex-col gap-1.5"}>
            {TIPS.map((tip) => (
                <li key={tip}>
                    <span className="font-medium text-ink">{t(`ai.tips.${tip}.lead`)}</span>{" "}
                    <span className="text-ink-muted">{t(`ai.tips.${tip}.text`)}</span>
                </li>
            ))}
        </ul>
    );
}
